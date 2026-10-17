import { cloudinaryEnabled, isMediaDataUrl, uploadDataUrl } from '../services/cloudinary.js';

const MAX_DEPTH = 6;

/** Collects setters for every image/video data URL inside `node`. */
function collect(node, depth, out) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (isMediaDataUrl(value)) out.push({ value, set: (url) => (node[key] = url) });
    else if (value && typeof value === 'object') collect(value, depth + 1, out);
  }
}

/**
 * Clients send photos as base64 data URLs (posts, avatar/cover, complaints,
 * children, messages, contest entries, …). Before any route sees the body,
 * upload each one to Cloudinary and swap in its URL, so MongoDB only stores links.
 * Without Cloudinary config the data URLs pass through unchanged (dev fallback).
 */
export async function uploadMedia(req, _res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method) || !cloudinaryEnabled()) return next();
  const found = [];
  collect(req.body, 0, found);
  if (found.length) {
    const urls = await Promise.all(found.map((f) => uploadDataUrl(f.value)));
    found.forEach((f, i) => f.set(urls[i]));
  }
  next();
}
