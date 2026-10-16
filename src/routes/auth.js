import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { env } from '../config/env.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { Otp, User } from '../models/index.js';
import { serializeUser } from '../services/serializers.js';
import { provisionNewUser } from '../services/starterData.js';
import { badRequest, conflict, forbidden, notFound, tooMany } from '../utils/httpError.js';
import { normalizeContact, requireString } from '../utils/validate.js';

const router = Router();

const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_MS = 30_000;
const OTP_MAX_ATTEMPTS = 5;

const hashCode = (contact, code) => createHmac('sha256', env.jwtSecret).update(`${contact}:${code}`).digest('hex');

const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Sends a 6-digit code. No SMS/email provider is wired up yet, so the code is
 * written to the server log; plug a provider in here.
 */
async function deliverOtp(contact, method, code) {
  console.log(`[otp] ${method} ${contact} -> ${code}`);
}

// POST /api/auth/request-otp  { contact, mode: 'signup' | 'login', name? }
router.post('/request-otp', async (req, res) => {
  const { mode = 'login' } = req.body || {};
  if (!['signup', 'login'].includes(mode)) throw badRequest('Invalid mode.');
  const { contact, method } = normalizeContact(req.body?.contact);

  const existing = await User.exists({ contact });
  let pendingName;
  if (mode === 'signup') {
    pendingName = requireString(req.body?.name, 'নাম', { max: 80 });
    if (existing) throw conflict('এই নম্বর/ইমেইল দিয়ে ইতিমধ্যে অ্যাকাউন্ট আছে। লগইন করুন।', 'ACCOUNT_EXISTS');
  } else if (!existing) {
    throw notFound('এই নম্বর/ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি। প্রথমে অ্যাকাউন্ট খুলুন।');
  }

  const recent = await Otp.findOne({ contact }).sort({ createdAt: -1 }).lean();
  if (recent && Date.now() - new Date(recent.createdAt).getTime() < OTP_RESEND_MS) {
    throw tooMany('একটু অপেক্ষা করে আবার কোড পাঠান।');
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await Otp.deleteMany({ contact });
  await Otp.create({
    contact,
    contactMethod: method,
    purpose: mode,
    pendingName,
    codeHash: hashCode(contact, code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  await deliverOtp(contact, method, code);

  res.json({ ok: true, contact, expiresInSeconds: OTP_TTL_MS / 1000 });
});

// POST /api/auth/verify-otp  { contact, code } -> { token, user, isNewUser }
router.post('/verify-otp', async (req, res) => {
  const { contact } = normalizeContact(req.body?.contact);
  const code = String(req.body?.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw badRequest('দয়া করে ৬ ডিজিটের কোডটি সম্পূর্ণ করুন।');

  const otp = await Otp.findOne({ contact, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
  if (!otp) throw badRequest('কোডের মেয়াদ শেষ হয়েছে। নতুন কোড পাঠান।', 'OTP_EXPIRED');
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await otp.deleteOne();
    throw tooMany('অনেকবার ভুল কোড দেওয়া হয়েছে। নতুন কোড পাঠান।');
  }

  const valid = safeEqual(otp.codeHash, hashCode(contact, code)) || (env.demoMode && code === env.demoOtp);
  if (!valid) {
    otp.attempts += 1;
    await otp.save();
    const hint = env.demoMode ? ` ডেমো কোড হিসেবে ${env.demoOtp} ব্যবহার করুন।` : '';
    throw badRequest(`ভুল কোড!${hint}`, 'OTP_INVALID');
  }
  await Otp.deleteMany({ contact });

  const role = env.adminContacts.includes(contact) ? 'admin' : undefined;
  let user = await User.findOne({ contact });
  let isNewUser = false;
  if (!user) {
    if (otp.purpose !== 'signup') throw notFound('অ্যাকাউন্ট পাওয়া যায়নি।');
    user = await User.create({
      name: otp.pendingName,
      contact,
      contactMethod: otp.contactMethod,
      isVerified: true,
      ...(role && { role }),
    });
    isNewUser = true;
    await provisionNewUser(user);
  } else {
    user.isVerified = true;
    if (role) user.role = role;
    await user.save();
  }

  res.json({ token: signToken(user._id), user: serializeUser(user.toObject()), isNewUser });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: serializeUser(req.user.toObject()) });
});

// POST /api/auth/activate-membership  { couponCode }
router.post('/activate-membership', requireAuth, async (req, res) => {
  const couponCode = String(req.body?.couponCode || '').trim().toUpperCase();
  if (!couponCode) throw badRequest('দয়া করে কুপন কোড লিখুন।');
  if (couponCode !== env.membershipCoupon) {
    const hint = env.demoMode ? ` সঠিক ডেমো কুপন হিসেবে ${env.membershipCoupon} ব্যবহার করুন।` : '';
    throw badRequest(`ভুল কুপন কোড!${hint}`, 'COUPON_INVALID');
  }
  Object.assign(req.user, {
    isMember: true,
    membershipExpiry: 'প্রিমিয়াম মেম্বারশিপ (ফ্রি কুপন)',
    couponUsed: couponCode,
  });
  await req.user.save();
  res.json({ user: serializeUser(req.user.toObject()) });
});

// POST /api/auth/demo-purchase — fictional paid activation, only in demo mode.
router.post('/demo-purchase', requireAuth, async (req, res) => {
  if (!env.demoMode) throw forbidden('ডেমো পেমেন্ট বন্ধ আছে।');
  Object.assign(req.user, { isMember: true, membershipExpiry: 'প্রিমিয়াম মেম্বারশিপ (ডেমো পেমেন্ট)' });
  await req.user.save();
  res.json({ user: serializeUser(req.user.toObject()) });
});

export default router;
