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
  demoMode: process.env.DEMO_MODE !== 'false',
  demoOtp: process.env.DEMO_OTP || '123456',
  membershipCoupon: (process.env.MEMBERSHIP_COUPON || 'BABYCARE').toUpperCase(),
  adminContacts: list(process.env.ADMIN_CONTACTS),
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
