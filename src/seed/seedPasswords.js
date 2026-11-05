import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { hashPassword } from '../utils/password.js';

/** Password given to every seeded account. Development / demo data only. */
export const SEED_PASSWORD = 'password123';

/**
 * Gives SEED_PASSWORD to every real (non-AI) user that has no password yet.
 * Users who already chose a password keep it; AI personas never get one.
 * Refuses on NODE_ENV=production unless explicitly allowed, because a shared
 * known password lets anyone who knows an email address into that account.
 */
export async function backfillSeedPasswords({ allowProduction = false } = {}) {
  if (env.nodeEnv === 'production' && !allowProduction) {
    console.warn('[seed] NODE_ENV=production: seed passwords NOT set (pass --allow-production to override).');
    return 0;
  }
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const res = await User.updateMany(
    { isAiPersona: { $ne: true }, $or: [{ passwordHash: { $exists: false } }, { passwordHash: null }, { passwordHash: '' }] },
    { $set: { passwordHash } }
  );
  console.log(`[seed] password "${SEED_PASSWORD}" set for ${res.modifiedCount} user(s) without a password`);
  return res.modifiedCount;
}
