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
  cloudinary: cloudinaryConfig(),
};

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
