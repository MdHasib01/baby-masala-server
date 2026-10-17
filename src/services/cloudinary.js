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
