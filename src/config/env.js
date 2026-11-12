import 'dotenv/config';

const list = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongodbUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  clientOrigins: list(
    process.env.CLIENT_ORIGIN ||
      'http://localhost:5173,http://localhost:3000,http://localhost:5174,http://127.0.0.1:5173,https://babymasalabd.com,https://www.babymasalabd.com'
  ),
  // Off unless explicitly enabled: the demo code is accepted for any account.
  demoMode: process.env.DEMO_MODE === 'true',
  demoOtp: process.env.DEMO_OTP || '123456',
  membershipCoupon: (process.env.MEMBERSHIP_COUPON || '').toUpperCase(),
  adminContacts: list(process.env.ADMIN_CONTACTS).map((c) => c.toLowerCase()),
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
  },
  // No SMS/WhatsApp provider yet, so phone numbers can't receive a code.
  smsEnabled: process.env.SMS_ENABLED === 'true',
  // Play Store reviewer account: this one email accepts REVIEW_OTP and is sent no email.
  reviewContact: (process.env.REVIEW_CONTACT || '').trim().toLowerCase(),
  reviewOtp: (process.env.REVIEW_OTP || '').trim(),
  // Baby Masala store: the Shop tab lists its products and places orders on it.
  storeUrl: (process.env.STORE_URL || 'https://store.babymasalabd.com').replace(/\/+$/, ''),
  cloudinary: cloudinaryConfig(),
  // node-agent (Agent Console): runs claude / codex CLIs behind a nak_... API token.
  // Server-to-server only: node-agent sends no CORS headers and the token must never reach a client.
  nodeAgent: {
    url: (process.env.NODE_AGENT_URL || '').trim().replace(/\/+$/, ''),
    token: (process.env.NODE_AGENT_TOKEN || '').trim(),
    timeoutMs: num(process.env.NODE_AGENT_TIMEOUT_MS, 300_000),
  },
  // Only the first defaults for Admin → AI টাস্ক (AiSettings in MongoDB); edit them in the admin panel.
  aiCommunity: {
    enabled: process.env.AI_COMMUNITY_ENABLED === 'true',
    // Share (0-100) of automatic AI posts that get a generated photo.
    imagePostPercent: Math.min(Math.max(num(process.env.AI_IMAGE_POST_PERCENT, 40), 0), 100),
    activeHours: hourRange(process.env.AI_ACTIVE_HOURS, [8, 23]),
  },
};

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** "8-23" -> [8, 23] (Asia/Dhaka hours, inclusive start, exclusive end). */
function hourRange(value, fallback) {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(value || '');
  if (!m) return fallback;
  const [start, end] = [Number(m[1]), Number(m[2])];
  return start >= 0 && end <= 24 && start < end ? [start, end] : fallback;
}

/** Throws a readable error when a required variable is missing. */
export function requireEnv(...names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Copy backend/.env.example to backend/.env and fill it in.'
    );
  }
}

/** CLOUDINARY_URL (cloudinary://key:secret@cloud) or the three separate variables. */
function cloudinaryConfig() {
  const fromUrl = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(process.env.CLOUDINARY_URL || '');
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || fromUrl?.[3],
    apiKey: process.env.CLOUDINARY_API_KEY || fromUrl?.[1],
    apiSecret: process.env.CLOUDINARY_API_SECRET || fromUrl?.[2],
    folder: process.env.CLOUDINARY_FOLDER || 'baby-care',
  };
}
