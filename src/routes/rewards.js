import { Router } from 'express';
import {
  Contest,
  ContestSubmission,
  Gift,
  GiftRedemption,
  Notification,
  Order,
  RewardTransaction,
  User,
} from '../models/index.js';
import { getLeaderboard } from '../services/leaderboard.js';
import { awardPoints, POINT_RULES, releasePoints, reservePoints } from '../services/points.js';
import {
  plain,
  serializeRedemption,
  serializeRewardTx,
  serializeSubmission,
} from '../services/serializers.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { optionalString, requireString } from '../utils/validate.js';

const router = Router();

const balanceOf = (user) => ({
  earnedPoints: user.earnedPoints,
  spentPoints: user.spentPoints,
  availablePoints: user.earnedPoints - user.spentPoints,
});

// GET /api/rewards/summary — balance plus history
router.get('/rewards/summary', async (req, res) => {
  const uid = req.user._id;
  const [transactions, redemptions] = await Promise.all([
    RewardTransaction.find({ user: uid }).sort({ createdAt: -1 }).lean(),
    GiftRedemption.find({ user: uid }).sort({ createdAt: -1 }).lean(),
  ]);
  res.json({
    ...balanceOf(req.user),
    transactions: transactions.map(serializeRewardTx),
    redemptions: redemptions.map(serializeRedemption),
  });
});

router.get('/rewards/leaderboard', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  res.json({ leaderboard: await getLeaderboard(req.user, limit) });
});

router.get('/rewards/gifts', async (_req, res) => {
  const gifts = await Gift.find().sort({ pointsCost: 1, createdAt: 1 }).lean();
  res.json({ gifts: gifts.map(plain) });
});

// POST /api/rewards/redeem  { giftId, deliveryAddress? }
router.post('/rewards/redeem', async (req, res) => {
  const me = req.user;
  const giftId = requireString(req.body?.giftId, 'giftId', { max: 100 });
  const deliveryAddress = optionalString(req.body?.deliveryAddress, 'ডেলিভারি ঠিকানা', { max: 500 });

  const gift = await Gift.findById(giftId).lean();
  if (!gift) throw notFound('গিফটটি খুঁজে পাওয়া যায়নি।');
  if (gift.stock <= 0) throw conflict('এই গিফটটি বর্তমানে স্টকআউট রয়েছে।', 'OUT_OF_STOCK');

  // Reserve points first, then stock; undo the points if the stock is gone.
  if (!(await reservePoints(me._id, gift.pointsCost))) {
    throw conflict('আপনার পর্যাপ্ত পয়েন্ট নেই!', 'INSUFFICIENT_POINTS');
  }
  const updatedGift = await Gift.findOneAndUpdate(
    { _id: gift._id, stock: { $gt: 0 } },
    { $inc: { stock: -1 } },
    { returnDocument: 'after' }
  ).lean();
  if (!updatedGift) {
    await releasePoints(me._id, gift.pointsCost);
    throw conflict('এই গিফটটি বর্তমানে স্টকআউট রয়েছে।', 'OUT_OF_STOCK');
  }

  const redemption = await GiftRedemption.create({
    user: me._id,
    gift: gift._id,
    giftName: gift.name,
    pointsCost: gift.pointsCost,
    deliveryAddress,
  });
  const [tx] = await Promise.all([
    RewardTransaction.create({
      user: me._id,
      description: `গিফট রিডেম্পশন: ${gift.name}`,
      points: -gift.pointsCost,
      type: 'redeem',
      source: 'redemption',
      refId: redemption._id,
    }),
    Notification.create({
      owner: me._id,
      title: 'গিফট রিডিম সফল',
      message: `${gift.name} রিডিম করা হয়েছে। শীঘ্রই আপনার ঠিকানায় পৌঁছে যাবে।`,
      type: 'reward',
    }),
  ]);

  const fresh = await User.findById(me._id).select('earnedPoints spentPoints').lean();
  res.status(201).json({
    redemption: serializeRedemption(redemption.toObject()),
    rewardTx: serializeRewardTx(tx.toObject()),
    gift: plain(updatedGift),
    ...balanceOf(fresh),
  });
});

router.get('/contests', async (_req, res) => {
  const contests = await Contest.find().sort({ createdAt: 1 }).lean();
  res.json({ contests: contests.map(plain) });
});

router.get('/contests/submissions', async (req, res) => {
  const subs = await ContestSubmission.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
  res.json({ submissions: subs.map(serializeSubmission) });
});

// POST /api/contests/:id/submissions  { description, mediaUrl?, orderId? }
router.post('/contests/:id/submissions', async (req, res) => {
  const me = req.user;
  const contest = await Contest.findById(req.params.id).lean();
  if (!contest) throw notFound('কনটেস্টটি খুঁজে পাওয়া যায়নি।');
  if (contest.status !== 'active') throw badRequest('এই কনটেস্টটি শেষ হয়ে গেছে।');

  const description = requireString(req.body?.description, 'বিবরণ', { max: 2000 });
  const mediaUrl = optionalString(req.body?.mediaUrl, 'mediaUrl', { max: 2_000_000 });
  const orderId = optionalString(req.body?.orderId, 'orderId', { max: 100 });

  let order;
  if (contest.eligibility === 'delivered_order') {
    const filter = { user: me._id, status: 'delivered', ...(orderId && { _id: orderId }) };
    order = await Order.findOne(filter).select('_id').lean();
    if (!order) {
      throw badRequest('এই কনটেস্টে অংশগ্রহণের জন্য ডেলিভারি সম্পন্ন হওয়া অর্ডার নির্বাচন করা আবশ্যক।', 'NOT_ELIGIBLE');
    }
  }

  if (await ContestSubmission.exists({ contest: contest._id, user: me._id })) {
    throw conflict('আপনি এই কনটেস্টে ইতিমধ্যে অংশগ্রহণ করেছেন।', 'ALREADY_SUBMITTED');
  }

  const submission = await ContestSubmission.create({
    contest: contest._id,
    user: me._id,
    userName: me.name,
    mediaUrl,
    description,
    order: order?._id,
  });
  const points = contest.pointsReward ?? POINT_RULES.contestDefault;
  const tx = await awardPoints(me._id, points, `কনটেস্ট সাবমিশন (${contest.title})`, {
    source: 'contest',
    refId: submission._id,
  });

  res.status(201).json({
    submission: serializeSubmission(submission.toObject()),
    rewardTx: tx ? serializeRewardTx(tx) : null,
  });
});

export default router;
