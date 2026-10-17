import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { forbidden, unauthorized } from '../utils/httpError.js';

export const signToken = (userId) =>
  jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn || '30d' });

/** Requires `Authorization: Bearer <token>` and loads the user into `req.user`. */
export async function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw unauthorized('সেশনের মেয়াদ শেষ হয়েছে। আবার লগইন করুন।');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw unauthorized('অ্যাকাউন্ট খুঁজে পাওয়া যায়নি। আবার লগইন করুন।');
  req.user = user;
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') throw forbidden('শুধুমাত্র অ্যাডমিন এই কাজটি করতে পারবেন।');
  next();
}
