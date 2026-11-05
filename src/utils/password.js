import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { badRequest } from './httpError.js';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

/** Stored as `scrypt$<salt hex>$<hash hex>`. */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, hex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scryptAsync(String(password), salt, expected.length);
  return timingSafeEqual(actual, expected);
}

export function requirePassword(value) {
  if (typeof value !== 'string' || !value) throw badRequest('পাসওয়ার্ড লিখুন।');
  if (value.length < PASSWORD_MIN) throw badRequest(`পাসওয়ার্ড কমপক্ষে ${PASSWORD_MIN} অক্ষরের হতে হবে।`);
  if (value.length > PASSWORD_MAX) throw badRequest(`পাসওয়ার্ড সর্বোচ্চ ${PASSWORD_MAX} অক্ষরের হতে পারে।`);
  return value;
}
