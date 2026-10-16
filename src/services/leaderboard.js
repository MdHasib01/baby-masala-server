import { User } from '../models/index.js';

/** Ranked by total earned points; redemptions (spentPoints) never lower a rank. */
export async function getLeaderboard(viewer, limit = 10) {
  const top = await User.find({ earnedPoints: { $gt: 0 } })
    .sort({ earnedPoints: -1, createdAt: 1 })
    .limit(limit)
    .select('name avatar earnedPoints')
    .lean();

  const entries = top.map((u, i) => ({
    rank: i + 1,
    userId: u._id,
    name: u.name,
    avatar: u.avatar,
    earned: u.earnedPoints,
    isMe: u._id === viewer._id,
  }));

  if (!entries.some((e) => e.isMe)) {
    const ahead = await User.countDocuments({ earnedPoints: { $gt: viewer.earnedPoints } });
    entries.push({
      rank: ahead + 1,
      userId: viewer._id,
      name: viewer.name,
      avatar: viewer.avatar,
      earned: viewer.earnedPoints,
      isMe: true,
    });
  }
  return entries;
}
