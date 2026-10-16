import { RewardTransaction, User } from '../models/index.js';

/** Point-award rules from FRONTEND_HANDOFF.md §5. */
export const POINT_RULES = {
  textOrImagePost: 5,
  videoPost: 10,
  reaction: 2,
  comment: 2,
  contestDefault: 50,
  /** Fallback for products without their own `pointsEarned`: 1 point per ৳10. */
  orderTakaPerPoint: 10,
};

/**
 * Credits (or, with negative points, reverses) earned points and records the
 * transaction. The leaderboard ranks by `earnedPoints`, so redemptions never
 * pass through here.
 */
export async function awardPoints(userId, points, description, { source, refId } = {}) {
  if (!points) return null;
  const tx = await RewardTransaction.create({ user: userId, points, description, type: 'earn', source, refId });
  await User.updateOne({ _id: userId }, { $inc: { earnedPoints: points } });
  return tx.toObject();
}

/**
 * Atomically reserves `cost` points if the available balance
 * (earnedPoints - spentPoints) covers it. Returns false when it does not.
 */
export async function reservePoints(userId, cost) {
  const res = await User.updateOne(
    { _id: userId, $expr: { $gte: [{ $subtract: ['$earnedPoints', '$spentPoints'] }, cost] } },
    { $inc: { spentPoints: cost } }
  );
  return res.modifiedCount === 1;
}

export const releasePoints = (userId, cost) => User.updateOne({ _id: userId }, { $inc: { spentPoints: -cost } });
