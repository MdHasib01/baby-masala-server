import { Router } from 'express';
import {
  Comment,
  Contest,
  ContestSubmission,
  Doctor,
  Gift,
  GiftRedemption,
  Notification,
  Order,
  OWNED,
  Post,
  Product,
  Recipe,
  RewardTransaction,
  User,
} from '../models/index.js';
import { deleteAccount } from '../services/accountDeletion.js';
import { getLeaderboard } from '../services/leaderboard.js';
import {
  plain,
  serializeCart,
  serializeComment,
  serializeNotification,
  serializeOrder,
  serializeOwned,
  serializePost,
  serializeRecipe,
  serializeRedemption,
  serializeRewardTx,
  serializeSubmission,
  serializeUser,
} from '../services/serializers.js';
import { badRequest } from '../utils/httpError.js';
import { pick } from '../utils/validate.js';
import { visiblePostsFilter } from './posts.js';

const router = Router();

// GET /api/bootstrap — everything the app needs on first render, in one round trip.
router.get('/bootstrap', async (req, res) => {
  const me = req.user;
  const uid = me._id;
  const owned = (key) => OWNED[key].model.find({ owner: uid }).sort({ position: 1, createdAt: 1 }).lean();

  const [
    posts,
    recipes,
    products,
    contests,
    submissions,
    gifts,
    orders,
    rewardTx,
    redemptions,
    notifications,
    doctors,
    leaderboard,
    children,
    friends,
    conversations,
    messages,
    doctorQuestions,
  ] = await Promise.all([
    Post.find(visiblePostsFilter(uid, me.blockedUsers)).sort({ createdAt: -1 }).limit(100).lean(),
    Recipe.find().sort({ createdAt: 1 }).lean(),
    Product.find().sort({ createdAt: 1 }).lean(),
    Contest.find().sort({ createdAt: 1 }).lean(),
    ContestSubmission.find({ user: uid }).sort({ createdAt: -1 }).lean(),
    Gift.find().sort({ pointsCost: 1, createdAt: 1 }).lean(),
    Order.find({ user: uid }).sort({ createdAt: -1 }).lean(),
    RewardTransaction.find({ user: uid }).sort({ createdAt: -1 }).lean(),
    GiftRedemption.find({ user: uid }).sort({ createdAt: -1 }).lean(),
    Notification.find({ owner: uid }).sort({ createdAt: -1 }).limit(50).lean(),
    Doctor.find().sort({ createdAt: 1 }).lean(),
    getLeaderboard(me),
    owned('children'),
    owned('friends'),
    owned('conversations'),
    owned('messages'),
    owned('doctorQuestions'),
  ]);

  const comments = await Comment.find({ post: { $in: posts.map((p) => p._id) }, author: { $nin: me.blockedUsers } })
    .sort({ createdAt: 1 })
    .lean();
  const productsById = new Map(products.map((p) => [p._id, p]));
  const ownedOut = (key, docs) => docs.map((d) => serializeOwned(d, OWNED[key].fields));

  res.json({
    user: serializeUser(me.toObject()),
    posts: posts.map((p) => serializePost(p, uid)),
    comments: comments.map(serializeComment),
    recipes: recipes.map((r) => serializeRecipe(r, uid)),
    products: products.map(plain),
    contests: contests.map(plain),
    submissions: submissions.map(serializeSubmission),
    gifts: gifts.map(plain),
    orders: orders.map(serializeOrder),
    rewardTx: rewardTx.map(serializeRewardTx),
    giftRedemptions: redemptions.map(serializeRedemption),
    notifications: notifications.map(serializeNotification),
    cart: serializeCart(me.cart, productsById),
    doctors: doctors.map(plain),
    leaderboard,
    children: ownedOut('children', children),
    friends: ownedOut('friends', friends),
    conversations: ownedOut('conversations', conversations),
    messages: ownedOut('messages', messages),
    doctorQuestions: ownedOut('doctorQuestions', doctorQuestions),
  });
});

const PROFILE_FIELDS = [
  'name',
  'avatar',
  'bio',
  'coverPhoto',
  'location',
  'dateOfBirth',
  'addresses',
  'notificationPrefs',
  'privacySettings',
];

// PATCH /api/me — profile, addresses and settings. Points and membership are not writable here.
router.patch('/me', async (req, res) => {
  const me = req.user;
  const updates = pick(req.body, PROFILE_FIELDS);
  if (updates.name !== undefined && !String(updates.name).trim()) throw badRequest('নাম খালি রাখা যাবে না।');
  if (updates.addresses !== undefined && !Array.isArray(updates.addresses)) throw badRequest('addresses must be an array.');

  const authorChanged =
    (updates.name !== undefined && updates.name !== me.name) ||
    (updates.avatar !== undefined && updates.avatar !== me.avatar);

  me.set(updates);
  await me.save();

  if (authorChanged) {
    const author = { authorName: me.name, authorAvatar: me.avatar };
    await Promise.all([
      Post.updateMany({ author: me._id }, author),
      Comment.updateMany({ author: me._id }, author),
      ContestSubmission.updateMany({ user: me._id }, { userName: me.name }),
    ]);
  }
  res.json({ user: serializeUser(me.toObject()) });
});

// POST /api/users/:id/block — hides that user's posts and comments from me (UGC policy).
router.post('/users/:id/block', async (req, res) => {
  const target = String(req.params.id);
  if (target === req.user._id) throw badRequest('নিজেকে ব্লক করা যাবে না।');
  await User.updateOne({ _id: req.user._id }, { $addToSet: { blockedUsers: target } });
  res.json({ ok: true });
});

// DELETE /api/users/:id/block — unblocks.
router.delete('/users/:id/block', async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $pull: { blockedUsers: String(req.params.id) } });
  res.json({ ok: true });
});

// DELETE /api/me — permanently deletes the account and its data (Play Store requirement).
router.delete('/me', async (req, res) => {
  await deleteAccount(req.user);
  res.json({ ok: true });
});

// PUT /api/me/cart  { items: [{ productId, quantity }] }  (CartItem[] with `product` also accepted)
router.put('/me/cart', async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length > 50) throw badRequest('items must be an array of up to 50 entries.');

  const merged = new Map();
  for (const item of items) {
    const productId = item?.productId ?? item?.product?.id;
    const quantity = Number(item?.quantity);
    if (typeof productId !== 'string' || !Number.isInteger(quantity) || quantity < 1) {
      throw badRequest('Each cart item needs a productId and a positive quantity.');
    }
    merged.set(productId, Math.min(99, (merged.get(productId) || 0) + quantity));
  }

  const products = await Product.find({ _id: { $in: [...merged.keys()] } }).lean();
  const productsById = new Map(products.map((p) => [p._id, p]));
  req.user.cart = [...merged].filter(([id]) => productsById.has(id)).map(([product, quantity]) => ({ product, quantity }));
  await req.user.save();

  res.json({ cart: serializeCart(req.user.cart, productsById) });
});

router.get('/notifications', async (req, res) => {
  const items = await Notification.find({ owner: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ notifications: items.map(serializeNotification) });
});

router.post('/notifications/read-all', async (req, res) => {
  await Notification.updateMany({ owner: req.user._id, read: false }, { read: true });
  res.json({ ok: true });
});

export default router;
