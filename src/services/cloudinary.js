import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

// Signed uploads through Cloudinary's REST API (no SDK needed).
// https://cloudinary.com/documentation/upload_images#authenticated_requests

const DATA_URL_RE = /^data:(image|video)\/[\w.+-]+;base64,/;

export const isMediaDataUrl = (value) => typeof value === 'string' && DATA_URL_RE.test(value);

export const cloudinaryEnabled = () => Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

// Clients re-send whole collections on sync, so the same data URL can arrive
// many times. Content hash → URL keeps repeats off the network.
const cache = new Map();
const CACHE_MAX = 500;

/**
 * Uploads a base64 data URL and returns its https URL. The public id is the
 * content hash, so identical files map to one Cloudinary asset.
 */
export async function uploadDataUrl(dataUrl) {
  const hash = createHash('sha1').update(dataUrl).digest('hex');
  const hit = cache.get(hash);
  if (hit) return hit;

  const { cloudName, apiKey, apiSecret, folder } = env.cloudinary;
  const params = { folder, overwrite: 'false', public_id: hash, timestamp: String(Math.floor(Date.now() / 1000)) };
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const signature = createHash('sha1').update(toSign + apiSecret).digest('hex');

  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.append(k, v);
  form.append('api_key', apiKey);
  form.append('signature', signature);
  form.append('file', dataUrl);

  let res;
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method: 'POST', body: form });
  } catch (err) {
    console.error('[cloudinary] network error', err);
    throw new HttpError(502, 'ছবি আপলোড করা যায়নি। আবার চেষ্টা করুন।', 'UPLOAD_FAILED');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.secure_url) {
    console.error('[cloudinary] upload failed', res.status, body?.error?.message);
    throw new HttpError(502, 'ছবি আপলোড করা যায়নি। আবার চেষ্টা করুন।', 'UPLOAD_FAILED');
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(hash, body.secure_url);
  return body.secure_url;
}

// https://res.cloudinary.com/<cloud>/<image|video>/upload/v123/<folder>/<hash>.jpg
const ASSET_URL_RE = /^https:\/\/res\.cloudinary\.com\/([^/]+)\/(image|video)\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i;

/**
 * Deletes uploaded assets by their URLs (best effort). Only files in this
 * app's own cloud and folder are touched; everything else is ignored.
 */
export async function destroyByUrls(urls) {
  if (!cloudinaryEnabled()) return 0;
  const { cloudName, apiKey, apiSecret, folder } = env.cloudinary;
  const targets = new Map();
  for (const url of urls) {
    const m = typeof url === 'string' && ASSET_URL_RE.exec(url);
    if (!m || m[1] !== cloudName || !m[3].startsWith(`${folder}/`)) continue;
    targets.set(m[3], m[2].toLowerCase());
  }

  let deleted = 0;
  for (const [publicId, resourceType] of targets) {
    const params = { public_id: publicId, timestamp: String(Math.floor(Date.now() / 1000)) };
    const toSign = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) form.append(k, v);
    form.append('api_key', apiKey);
    form.append('signature', createHash('sha1').update(toSign + apiSecret).digest('hex'));
    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, { method: 'POST', body: form });
      if (res.ok) deleted += 1;
    } catch (err) {
      console.error('[cloudinary] destroy failed', publicId, err?.message);
    }
    for (const [hash, cached] of cache) if (cached.includes(publicId)) cache.delete(hash);
  }
  return deleted;
}
