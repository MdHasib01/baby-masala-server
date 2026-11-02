import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

/**
 * The Shop tab sells the Baby Masala store's products (store.babymasalabd.com).
 *
 * - Catalog: `GET {STORE_URL}/api/products`, cached here for 5 minutes. If the store is
 *   unreachable the last good copy keeps being served.
 * - Checkout: `POST {STORE_URL}/api/orders`, so app orders land in the store's admin
 *   (Steadfast, SMS and email work as for website orders).
 *
 * Every pack size of a store product becomes one cart-able "variant" in the app's
 * Product shape. A listing is the first pack plus `packs: [all variants]`.
 */

const CATALOG_TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 12_000;

const CATEGORY_BN = {
  herbs: 'হার্বস ও স্পাইস',
  nutrition: 'শিশুর পুষ্টি',
  'nuts-seeds': 'বাদাম ও বীজ',
  combos: 'কম্বো প্যাক',
};

const DEFAULT_DELIVERY = { inside: 70, outside: 110 };

let catalogCache = null; // { listings, variants: Map, at }
let catalogInflight = null;
let deliveryCache = null; // { delivery, at }

const storeUrl = (path) => new URL(path, env.storeUrl).toString();
const unavailable = () =>
  new HttpError(503, 'শপ এই মুহূর্তে লোড করা যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।', 'STORE_UNAVAILABLE');

async function storeFetch(path, init = {}) {
  const res = await fetch(storeUrl(path), {
    ...init,
    headers: { Accept: 'application/json', 'User-Agent': 'BabyCareApp/1.0 (+https://babymasalabd.com)', ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON (e.g. an HTML error page) */
  }
  return { res, body };
}

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pack';

/** Stable id for one pack of one store product. */
export const variantId = (storeProductId, weight) => `store_${storeProductId}_${slugify(weight)}`;

const absolute = (url) => {
  if (!url) return '';
  try {
    return new URL(url, env.storeUrl).toString();
  } catch {
    return url;
  }
};

const bn = (loc) => (loc && (loc.bn || loc.en)) || '';

function toVariants(p) {
  const options = p.weightOptions?.length
    ? p.weightOptions
    : [{ weight: p.weight || '', label: { bn: p.weight || '', en: p.weight || '' }, price: p.price, compareAt: p.compareAt }];
  const shared = {
    name: bn(p.name),
    category: CATEGORY_BN[p.category] || p.category || 'অন্যান্য',
    image: absolute(p.image),
    description: bn(p.description) || bn(p.short),
    short: bn(p.short),
    badge: bn(p.badge),
    age: bn(p.age),
    howToUse: bn(p.howToUse),
    benefits: p.benefits?.bn?.length ? p.benefits.bn : p.benefits?.en || [],
    includes: (p.comboIngredients || []).map((c) => bn(c.name)).filter(Boolean),
    rating: Number(p.rating) || 0,
    reviewsCount: Number(p.reviewsCount) || 0,
    // The store does not track stock; anything listed is available.
    stock: 99,
    type: p.type,
    storeProductId: p.id,
    storeSlug: p.slug,
    storeUrl: storeUrl(`/product/${encodeURIComponent(p.slug)}`),
  };
  return options.map((o) => ({
    id: variantId(p.id, o.weight),
    ...shared,
    price: Number(o.price) || 0,
    ...(Number(o.compareAt) > Number(o.price) ? { originalPrice: Number(o.compareAt) } : {}),
    weight: o.weight,
    packLabel: bn(o.label) || o.weight,
  }));
}

async function loadCatalog() {
  const { res, body } = await storeFetch('/api/products');
  if (!res.ok || !body?.success || !Array.isArray(body.data?.products)) {
    throw new Error(`store catalog HTTP ${res.status}`);
  }
  const variants = new Map();
  const listings = body.data.products.map((p) => {
    const packs = toVariants(p);
    for (const v of packs) variants.set(v.id, v);
    return { ...packs[0], packs };
  });
  return { listings, variants, at: Date.now() };
}

/** Listings + variant lookup. Serves the last good copy if the store is down. */
export async function getStoreCatalog() {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache;
  catalogInflight ??= loadCatalog()
    .then((c) => (catalogCache = c))
    .finally(() => {
      catalogInflight = null;
    });
  try {
    return await catalogInflight;
  } catch (err) {
    console.error('[store] catalog fetch failed:', err.message);
    if (catalogCache) return catalogCache;
    throw unavailable();
  }
}

/** Same as getStoreCatalog, but an empty catalog instead of an error (for bootstrap). */
export async function getStoreCatalogOrEmpty() {
  try {
    return await getStoreCatalog();
  } catch {
    return { listings: [], variants: new Map(), at: 0 };
  }
}

export function invalidateStoreCatalog() {
  catalogCache = null;
}

/** Delivery charges from the store's public settings ({ inside, outside }). */
export async function getStoreDelivery() {
  if (deliveryCache && Date.now() - deliveryCache.at < CATALOG_TTL_MS) return deliveryCache.delivery;
  try {
    const { res, body } = await storeFetch('/api/settings/public');
    const d = body?.data?.delivery;
    if (res.ok && Number.isFinite(d?.inside) && Number.isFinite(d?.outside)) {
      deliveryCache = { delivery: { inside: d.inside, outside: d.outside }, at: Date.now() };
      return deliveryCache.delivery;
    }
  } catch (err) {
    console.error('[store] settings fetch failed:', err.message);
  }
  return deliveryCache?.delivery || DEFAULT_DELIVERY;
}

/**
 * Places the order on the store. Returns { orderNo, total }.
 * The store re-prices every line from its own database.
 */
export async function placeStoreOrder({ customerName, phone, address, area, note, lines }) {
  let res;
  let body;
  try {
    ({ res, body } = await storeFetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName,
        phone,
        address,
        area,
        note,
        items: lines.map((l) => ({ productId: l.storeProductId, weight: l.weight, quantity: l.quantity })),
      }),
    }));
  } catch (err) {
    console.error('[store] order request failed:', err.message);
    throw unavailable();
  }
  if (res.status === 201 && body?.success && body.data?.orderNo) {
    return { orderNo: String(body.data.orderNo), total: Number(body.data.total) };
  }
  console.error('[store] order rejected:', res.status, body?.error);
  if (res.status === 409) {
    // A product or pack changed on the store since the app loaded it.
    invalidateStoreCatalog();
    throw new HttpError(409, 'কার্টের একটি পণ্য বা প্যাক বদলে গেছে। কার্ট থেকে সরিয়ে আবার যোগ করুন।', 'STORE_CART_CHANGED');
  }
  if (res.status === 400) {
    const msg = String(body?.error || '');
    if (/phone|mobile/i.test(msg)) throw new HttpError(400, 'সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন (যেমন: 01712345678)।', 'INVALID_PHONE');
    if (/address/i.test(msg)) throw new HttpError(400, 'পূর্ণ ডেলিভারি ঠিকানা লিখুন।', 'INVALID_ADDRESS');
    throw new HttpError(400, 'অর্ডারের তথ্য সঠিক নয়। আবার দেখে চেষ্টা করুন।', 'STORE_REJECTED');
  }
  throw unavailable();
}

// Recipes were written against the app's old local products (p1…p6). Point them at the
// store product that sells the same herb.
const LEGACY_PRODUCT_SLUG = {
  p1: 'sweet-basil-baby-herb',
  p2: 'organic-oregano',
  p3: '5-herbs-combo', // sage
  p4: '5-herbs-combo', // thyme
  p5: '5-herbs-combo', // rosemary
  p6: '5-herbs-combo', // mixed herbs
};

/** Rewrites each recipe's `shopProductId` to the matching store listing id. */
export function linkRecipeProducts(recipes, listings) {
  const bySlug = new Map(listings.map((p) => [p.storeSlug, p.id]));
  const ids = new Set(listings.map((p) => p.id));
  return recipes.map((r) => {
    if (!r.shopProductId || ids.has(r.shopProductId)) return r;
    const slug = LEGACY_PRODUCT_SLUG[r.shopProductId] || r.shopProductId;
    const id = bySlug.get(slug);
    return id ? { ...r, shopProductId: id } : { ...r, shopProductId: undefined };
  });
}
