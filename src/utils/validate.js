import { badRequest } from './httpError.js';

const PHONE_RE = /^01\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toAsciiDigits = (s) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));

/** Normalises a phone number or email so the same person always maps to one account. */
export function normalizeContact(raw) {
  const value = toAsciiDigits(String(raw || '').trim());
  if (value.includes('@')) {
    const email = value.toLowerCase();
    if (!EMAIL_RE.test(email)) throw badRequest('সঠিক ইমেইল ঠিকানা দিন।');
    return { contact: email, method: 'email' };
  }
  let phone = value.replace(/[\s-]/g, '');
  if (phone.startsWith('+880')) phone = phone.slice(3);
  else if (phone.startsWith('880')) phone = phone.slice(2);
  if (!PHONE_RE.test(phone)) throw badRequest('সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন (যেমন: 01712345678)।');
  return { contact: phone, method: 'whatsapp' };
}

export function requireString(value, field, { max = 5000, min = 1 } = {}) {
  if (typeof value !== 'string') throw badRequest(`${field} অবশ্যই লেখা হতে হবে।`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`${field} খালি রাখা যাবে না।`);
  if (trimmed.length > max) throw badRequest(`${field} সর্বোচ্চ ${max} অক্ষরের হতে পারে।`);
  return trimmed;
}

export function optionalString(value, field, { max = 2000 } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, field, { max });
}

export function requirePositiveInt(value, field, { max = 1000 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw badRequest(`${field} সঠিক সংখ্যা নয়।`);
  return n;
}

/** Copies only the listed keys that are present on `source`. */
export const pick = (source, keys) =>
  Object.fromEntries(keys.filter((k) => source?.[k] !== undefined).map((k) => [k, source[k]]));
