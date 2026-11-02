import { Router } from 'express';
import { Notification, Order, Recipe } from '../models/index.js';
import { awardPoints, POINT_RULES } from '../services/points.js';
import { serializeOrder, serializeRecipe, serializeRewardTx } from '../services/serializers.js';
import { getStoreCatalog, getStoreCatalogOrEmpty, getStoreDelivery, linkRecipeProducts, placeStoreOrder } from '../services/storeCatalog.js';
import { toBnDigits } from '../utils/bnTime.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { optionalString, requirePositiveInt, requireString } from '../utils/validate.js';

const router = Router();

const DELIVERY_AREAS = ['inside', 'outside'];
const BD_MOBILE_RE = /^01[3-9]\d{8}$/;

const pointsFor = (product, quantity) =>
  product.pointsEarned != null
    ? product.pointsEarned * quantity
    : Math.floor((product.price * quantity) / POINT_RULES.orderTakaPerPoint);

/** 01XXXXXXXXX from "+880 1712-345678", Bengali digits, etc. */
function normalizeMobile(raw) {
  let phone = String(raw || '')
    .trim()
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
    .replace(/[\s()-]/g, '');
  if (phone.startsWith('+880')) phone = phone.slice(3);
  else if (phone.startsWith('880')) phone = phone.slice(2);
  if (!BD_MOBILE_RE.test(phone)) throw badRequest('সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন (যেমন: 01712345678)।', 'INVALID_PHONE');
  return phone;
}

// GET /api/products?category=&q=  — the Baby Masala store catalog, one listing per product.
router.get('/products', async (req, res) => {
  const [{ listings }, delivery] = await Promise.all([getStoreCatalog(), getStoreDelivery()]);
  const category = req.query.category ? String(req.query.category) : '';
  const q = req.query.q ? String(req.query.q).toLowerCase() : '';
  const products = listings.filter(
    (p) =>
      (!category || p.category === category) &&
      (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
  );
  res.json({ products, shop: { delivery } });
});

// GET /api/products/:id  — a listing, or a single pack by its variant id.
router.get('/products/:id', async (req, res) => {
  const { listings, variants } = await getStoreCatalog();
  const product = listings.find((p) => p.id === req.params.id || p.storeSlug === req.params.id) || variants.get(req.params.id);
  if (!product) throw notFound('প্রোডাক্টটি খুঁজে পাওয়া যায়নি।');
  res.json({ product });
});

router.get('/orders', async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
  res.json({ orders: orders.map(serializeOrder) });
});

/**
 * POST /api/orders
 * { items: [{ productId, quantity }], customerName?, phone, area: 'inside'|'outside',
 *   shippingAddress, notes?, paymentMethod?: 'cod' }
 *
 * The order is placed on the Baby Masala store, which prices it from its own catalog;
 * the store's total is what the customer pays. Points come from the catalog here.
 */
router.post('/orders', async (req, res) => {
  const me = req.user;
  const rawItems = req.body?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw badRequest('কার্ট খালি।');
  if (rawItems.length > 50) throw badRequest('একটি অর্ডারে সর্বোচ্চ ৫০টি আইটেম।');

  const customerName = requireString(req.body?.customerName ?? me.name, 'নাম', { max: 120 });
  const phone = normalizeMobile(req.body?.phone);
  const area = req.body?.area;
  if (!DELIVERY_AREAS.includes(area)) throw badRequest('ডেলিভারি এলাকা (ঢাকার ভিতরে / বাইরে) নির্বাচন করুন।');
  const shippingAddress = requireString(req.body?.shippingAddress, 'ডেলিভারি ঠিকানা', { max: 500 });
  if (shippingAddress.length < 5) throw badRequest('পূর্ণ ডেলিভারি ঠিকানা লিখুন।');
  const notes = optionalString(req.body?.notes, 'notes', { max: 400 });
  // Cash on delivery only; there is no online payment gateway.
  if (req.body?.paymentMethod && req.body.paymentMethod !== 'cod') throw badRequest('এখন শুধু ক্যাশ অন ডেলিভারি পাওয়া যাচ্ছে।');

  const quantities = new Map();
  for (const item of rawItems) {
    const productId = item?.productId ?? item?.product?.id;
    if (typeof productId !== 'string') throw badRequest('Each item needs a productId.');
    const quantity = requirePositiveInt(item?.quantity, 'পরিমাণ', { max: 99 });
    quantities.set(productId, Math.min(99, (quantities.get(productId) || 0) + quantity));
  }

  const { variants } = await getStoreCatalog();
  const items = [...quantities].map(([id, quantity]) => {
    const product = variants.get(id);
    if (!product) throw badRequest('কার্টের একটি পণ্য আর পাওয়া যাচ্ছে না। কার্ট থেকে সরিয়ে আবার চেষ্টা করুন।', 'PRODUCT_GONE');
    return { product, quantity };
  });

  const store = await placeStoreOrder({
    customerName,
    phone,
    address: shippingAddress,
    area,
    note: ['[Baby Care অ্যাপ]', notes].filter(Boolean).join(' ').slice(0, 500),
    lines: items.map((i) => ({ storeProductId: i.product.storeProductId, weight: i.product.weight, quantity: i.quantity })),
  });

  const subtotal = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
  const totalAmount = Number.isFinite(store.total) ? store.total : subtotal + (await getStoreDelivery())[area];
  const deliveryCharge = Math.max(0, totalAmount - subtotal);
  const pointsEarned = items.reduce((sum, i) => sum + pointsFor(i.product, i.quantity), 0);

  const order = await Order.create({
    user: me._id,
    items,
    subtotal,
    deliveryCharge,
    totalAmount,
    // The store starts every order as Pending until it is confirmed by phone.
    status: 'pending',
    shippingAddress,
    notes,
    paymentMethod: 'cod',
    pointsEarned,
    storeOrderNo: store.orderNo,
    customerName,
    phone,
    area,
  });

  const [tx] = await Promise.all([
    awardPoints(me._id, pointsEarned, `সফল অর্ডার #${store.orderNo} থেকে পয়েন্ট`, { source: 'order', refId: order._id }),
    Notification.create({
      owner: me._id,
      title: 'অর্ডার গ্রহণ করা হয়েছে',
      message: `আপনার অর্ডার #${store.orderNo} পেয়েছি। কনফার্ম করতে আমরা ${phone} নম্বরে ফোন করব। আপনি ${toBnDigits(pointsEarned)} পয়েন্ট অর্জন করেছেন।`,
      type: 'order',
    }),
  ]);
  me.cart = [];
  // Remember the phone so the next checkout is pre-filled.
  if (!me.addresses.some((a) => a.phone === phone)) {
    const target = me.addresses.find((a) => a.isDefault) || me.addresses[0];
    if (target && !target.phone) target.phone = phone;
  }
  await me.save();

  res.status(201).json({
    order: serializeOrder(order.toObject()),
    rewardTx: tx ? serializeRewardTx(tx) : null,
    // Kept for older app versions that read it; the store does not track stock.
    products: [],
  });
});

router.get('/recipes', async (req, res) => {
  const filter = req.query.ageGroup ? { ageGroup: String(req.query.ageGroup) } : {};
  const [recipes, { listings }] = await Promise.all([Recipe.find(filter).sort({ createdAt: 1 }).lean(), getStoreCatalogOrEmpty()]);
  res.json({ recipes: linkRecipeProducts(recipes.map((r) => serializeRecipe(r, req.user._id)), listings) });
});

// POST /api/recipes/:id/save — toggles bookmark
router.post('/recipes/:id/save', async (req, res) => {
  const uid = req.user._id;
  const recipe = await Recipe.findById(req.params.id).select('savedBy').lean();
  if (!recipe) throw notFound('রেসিপিটি খুঁজে পাওয়া যায়নি।');
  const update = recipe.savedBy.includes(uid) ? { $pull: { savedBy: uid } } : { $addToSet: { savedBy: uid } };
  const updated = await Recipe.findByIdAndUpdate(recipe._id, update, { returnDocument: 'after' }).lean();
  const { listings } = await getStoreCatalogOrEmpty();
  res.json({ recipe: linkRecipeProducts([serializeRecipe(updated, uid)], listings)[0] });
});

export default router;
