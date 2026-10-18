import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { env } from '../config/env.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { Otp, User } from '../models/index.js';
import { mailEnabled, sendOtpEmail } from '../services/mailer.js';
import { serializeUser } from '../services/serializers.js';
import { provisionNewUser } from '../services/starterData.js';
import { badRequest, conflict, HttpError, notFound, tooMany } from '../utils/httpError.js';
import { normalizeContact, requireString } from '../utils/validate.js';

const router = Router();

const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_MS = 30_000;
const OTP_MAX_ATTEMPTS = 5;

const hashCode = (contact, code) => createHmac('sha256', env.jwtSecret).update(`${contact}:${code}`).digest('hex');

const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const isReviewContact = (contact) => Boolean(env.reviewContact && env.reviewOtp && contact === env.reviewContact);

/** Phone numbers need an SMS/WhatsApp provider, which isn't wired up yet. */
function assertDeliverable(method) {
  if (method !== 'email' && !env.smsEnabled) {
    throw badRequest('এখন শুধু ইমেইল দিয়ে অ্যাকাউন্ট খোলা ও লগইন করা যাবে। আপনার ইমেইল ঠিকানা দিন।', 'EMAIL_ONLY');
  }
}

/** Sends a 6-digit code. Email goes over SMTP; plug an SMS provider in for phone numbers. */
async function deliverOtp(contact, method, code) {
  if (isReviewContact(contact)) return; // reviewer uses the fixed REVIEW_OTP
  if (method === 'email') {
    if (!mailEnabled()) {
      if (env.demoMode) return console.log(`[otp] ${method} ${contact} -> ${code}`);
      throw new HttpError(503, 'কোড পাঠানোর ব্যবস্থা এখন চালু নেই। পরে আবার চেষ্টা করুন।', 'OTP_UNAVAILABLE');
    }
    return sendOtpEmail(contact, code, OTP_TTL_MS / 60_000);
  }
  if (env.demoMode) return console.log(`[otp] ${method} ${contact} -> ${code}`);
  throw badRequest('এই মাধ্যমে কোড পাঠানো যাচ্ছে না।', 'EMAIL_ONLY');
}

// POST /api/auth/request-otp  { contact, mode: 'signup' | 'login', name? }
router.post('/request-otp', async (req, res) => {
  const { mode = 'login' } = req.body || {};
  if (!['signup', 'login'].includes(mode)) throw badRequest('Invalid mode.');
  const { contact, method } = normalizeContact(req.body?.contact);

  const existing = await User.exists({ contact });
  // Existing phone accounts may still log in while demo mode is on; new ones need email.
  if (!(existing && env.demoMode)) assertDeliverable(method);
  let pendingName;
  if (mode === 'signup') {
    pendingName = requireString(req.body?.name, 'নাম', { max: 80 });
    if (existing) throw conflict('এই ইমেইল দিয়ে ইতিমধ্যে অ্যাকাউন্ট আছে। লগইন করুন।', 'ACCOUNT_EXISTS');
  } else if (!existing) {
    throw notFound('এই ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি। প্রথমে অ্যাকাউন্ট খুলুন।');
  }

  const recent = await Otp.findOne({ contact }).sort({ createdAt: -1 }).lean();
  if (recent && Date.now() - new Date(recent.createdAt).getTime() < OTP_RESEND_MS) {
    throw tooMany('একটু অপেক্ষা করে আবার কোড পাঠান।');
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await Otp.deleteMany({ contact });
  const otp = await Otp.create({
    contact,
    contactMethod: method,
    purpose: mode,
    pendingName,
    codeHash: hashCode(contact, code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  try {
    await deliverOtp(contact, method, code);
  } catch (err) {
    await otp.deleteOne();
    throw err;
  }

  res.json({ ok: true, contact, expiresInSeconds: OTP_TTL_MS / 1000 });
});

// POST /api/auth/verify-otp  { contact, code } -> { token, user, isNewUser }
router.post('/verify-otp', async (req, res) => {
  const { contact } = normalizeContact(req.body?.contact);
  const code = String(req.body?.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw badRequest('দয়া করে ৬ ডিজিটের কোডটি সম্পূর্ণ করুন।');

  const otp = await Otp.findOne({ contact, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
  if (!otp) throw badRequest('কোডের মেয়াদ শেষ হয়েছে। নতুন কোড পাঠান।', 'OTP_EXPIRED');
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await otp.deleteOne();
    throw tooMany('অনেকবার ভুল কোড দেওয়া হয়েছে। নতুন কোড পাঠান।');
  }

  const valid =
    safeEqual(otp.codeHash, hashCode(contact, code)) ||
    (isReviewContact(contact) && safeEqual(code, env.reviewOtp)) ||
    (env.demoMode && code === env.demoOtp);
  if (!valid) {
    otp.attempts += 1;
    await otp.save();
    throw badRequest('ভুল কোড! ইমেইলে পাঠানো কোডটি আবার দেখে লিখুন।', 'OTP_INVALID');
  }
  await Otp.deleteMany({ contact });

  const role = env.adminContacts.includes(contact) && !isReviewContact(contact) ? 'admin' : undefined;
  let user = await User.findOne({ contact });
  let isNewUser = false;
  if (!user) {
    if (otp.purpose !== 'signup') throw notFound('অ্যাকাউন্ট পাওয়া যায়নি।');
    user = await User.create({
      name: otp.pendingName,
      contact,
      contactMethod: otp.contactMethod,
      isVerified: true,
      // The app is free; the flag stays for older clients that still check it.
      isMember: true,
      ...(role && { role }),
    });
    isNewUser = true;
    await provisionNewUser(user);
  } else {
    user.isVerified = true;
    user.isMember = true;
    if (role) user.role = role;
    await user.save();
  }

  res.json({ token: signToken(user._id), user: serializeUser(user.toObject()), isNewUser });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: serializeUser(req.user.toObject()) });
});

// POST /api/auth/activate-membership — kept for older clients; membership is now free for everyone.
router.post('/activate-membership', requireAuth, async (req, res) => {
  Object.assign(req.user, { isMember: true });
  await req.user.save();
  res.json({ user: serializeUser(req.user.toObject()) });
});

export default router;
