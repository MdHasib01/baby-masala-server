import { Router } from 'express';
import { Comment, Notification, Order, POST_TOPICS, Post, REACTION_TYPES } from '../models/index.js';
import { awardPoints, POINT_RULES } from '../services/points.js';
import { serializeComment, serializePost, serializeRewardTx } from '../services/serializers.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import { optionalString, requireString } from '../utils/validate.js';

const router = Router();

/** Approved posts the viewer has not hidden, plus the viewer's own posts in any state. */
export const visiblePostsFilter = (uid, blocked = []) => ({
  $or: [{ status: 'approved', hiddenBy: { $ne: uid }, author: { $nin: blocked } }, { author: uid }],
});

const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|$)|video/i;

const inferMediaType = (mediaUrl, requested) => {
  if (!mediaUrl) return undefined;
  if (requested === 'image' || requested === 'video') return requested;
  return VIDEO_RE.test(mediaUrl) ? 'video' : 'image';
};

const parseTopic = (topic) => {
  if (!POST_TOPICS.includes(topic)) throw badRequest(`topic must be one of: ${POST_TOPICS.join(', ')}`);
  return topic;
};

async function loadPost(id) {
  const post = await Post.findById(id);
  if (!post) throw notFound('পোস্টটি খুঁজে পাওয়া যায়নি।');
  return post;
}

const txOut = (tx) => (tx ? serializeRewardTx(tx) : null);

// GET /api/posts?limit=50&before=<ISO date>  — newest first
router.get('/', async (req, res) => {
  const uid = req.user._id;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const filter = visiblePostsFilter(uid, req.user.blockedUsers);
  if (req.query.before) {
    const before = new Date(String(req.query.before));
    if (Number.isNaN(before.getTime())) throw badRequest('before must be an ISO date.');
    filter.createdAt = { $lt: before };
  }
  if (req.query.topic) filter.topic = parseTopic(req.query.topic);

  const posts = await Post.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({
    posts: posts.map((p) => serializePost(p, uid)),
    nextCursor: posts.length === limit ? posts.at(-1).createdAt.toISOString() : null,
  });
});

// POST /api/posts  { content, topic, mediaUrl?, mediaType? }  → +5 text/image, +10 video
router.post('/', async (req, res) => {
  const me = req.user;
  const content = requireString(req.body?.content, 'পোস্টের বিষয়বস্তু', { max: 5000 });
  const topic = parseTopic(req.body?.topic);
  const mediaUrl = optionalString(req.body?.mediaUrl, 'mediaUrl', { max: 2_000_000 });
  const mediaType = inferMediaType(mediaUrl, req.body?.mediaType);

  const isVerifiedBuyer = Boolean(await Order.exists({ user: me._id, status: 'delivered' }));
  const post = await Post.create({
    author: me._id,
    authorName: me.name,
    authorAvatar: me.avatar,
    isVerifiedBuyer,
    topic,
    content,
    mediaUrl,
    mediaType,
  });

  const isVideo = mediaType === 'video';
  const tx = await awardPoints(
    me._id,
    isVideo ? POINT_RULES.videoPost : POINT_RULES.textOrImagePost,
    isVideo ? 'ভিডিও পোস্ট (+১০ পয়েন্ট)' : 'টেক্সট বা ছবি পোস্ট (+৫ পয়েন্ট)',
    { source: 'post', refId: post._id }
  );

  res.status(201).json({ post: serializePost(post.toObject(), me._id), rewardTx: txOut(tx) });
});

// PATCH /api/posts/:id  { content?, topic?, mediaUrl? }  — author only
router.patch('/:id', async (req, res) => {
  const post = await loadPost(req.params.id);
  if (post.author !== req.user._id) throw forbidden('শুধু নিজের পোস্ট এডিট করা যাবে।');

  if (req.body?.content !== undefined) post.content = requireString(req.body.content, 'পোস্টের বিষয়বস্তু', { max: 5000 });
  if (req.body?.topic !== undefined) post.topic = parseTopic(req.body.topic);
  if (req.body?.mediaUrl !== undefined) {
    post.mediaUrl = optionalString(req.body.mediaUrl, 'mediaUrl', { max: 2_000_000 });
    post.mediaType = inferMediaType(post.mediaUrl, req.body?.mediaType);
  }
  await post.save();
  res.json({ post: serializePost(post.toObject(), req.user._id) });
});

// DELETE /api/posts/:id  — author or admin. Points already earned are kept.
router.delete('/:id', async (req, res) => {
  const post = await loadPost(req.params.id);
  if (post.author !== req.user._id && req.user.role !== 'admin') throw forbidden('শুধু নিজের পোস্ট মুছে ফেলা যাবে।');
  await Promise.all([post.deleteOne(), Comment.deleteMany({ post: post._id })]);
  res.json({ ok: true });
});

// POST /api/posts/:id/react  { type? }  — Facebook-style reactions (like | love | haha | care).
// Same type again removes it, another type switches, no type toggles a plain like (older clients).
// +2 points only the first time per user per post.
router.post('/:id/react', async (req, res) => {
  const uid = req.user._id;
  const { id } = req.params;
  const requested = req.body?.type;
  if (requested !== undefined && !REACTION_TYPES.includes(requested)) throw badRequest('Invalid reaction type.');
  const type = requested || 'like';

  const existing = await Post.findById(id, { likedBy: 1, reactions: 1 }).lean();
  if (!existing) throw notFound('পোস্টটি খুঁজে পাওয়া যায়নি।');
  const current = (existing.likedBy || []).includes(uid)
    ? existing.reactions?.find((r) => r.user === uid)?.type || 'like'
    : null;

  // Conditional updates keep the counter correct under concurrent taps.
  let added = false;
  if (!current) {
    const r = await Post.updateOne(
      { _id: id, likedBy: { $ne: uid } },
      { $push: { likedBy: uid, reactions: { user: uid, type } }, $inc: { likes: 1 } }
    );
    added = r.modifiedCount === 1;
  } else if (current === type) {
    await Post.updateOne(
      { _id: id, likedBy: uid },
      { $pull: { likedBy: uid, reactions: { user: uid } }, $inc: { likes: -1 } }
    );
  } else {
    await Post.updateOne({ _id: id, likedBy: uid }, { $pull: { reactions: { user: uid } } });
    await Post.updateOne({ _id: id, likedBy: uid }, { $push: { reactions: { user: uid, type } } });
  }

  let tx = null;
  if (added) {
    const firstReaction = await Post.updateOne(
      { _id: id, reactionRewardedTo: { $ne: uid } },
      { $push: { reactionRewardedTo: uid } }
    );
    if (firstReaction.modifiedCount === 1) {
      tx = await awardPoints(uid, POINT_RULES.reaction, `পোস্ট রিঅ্যাকশন (+২ পয়েন্ট)`, { source: 'reaction', refId: id });
    }
  }

  const post = await Post.findById(id).lean();
  res.json({ post: serializePost(post, uid), rewardTx: txOut(tx) });
});

// POST /api/posts/:id/save  — toggles bookmark
router.post('/:id/save', async (req, res) => {
  const uid = req.user._id;
  const post = await loadPost(req.params.id);
  const update = post.savedBy.includes(uid) ? { $pull: { savedBy: uid } } : { $addToSet: { savedBy: uid } };
  const updated = await Post.findByIdAndUpdate(post._id, update, { returnDocument: 'after' }).lean();
  res.json({ post: serializePost(updated, uid) });
});

// POST /api/posts/:id/hide  — removes the post from this user's feed
router.post('/:id/hide', async (req, res) => {
  const result = await Post.updateOne({ _id: req.params.id }, { $addToSet: { hiddenBy: req.user._id } });
  if (result.matchedCount === 0) throw notFound('পোস্টটি খুঁজে পাওয়া যায়নি।');
  res.json({ ok: true });
});

// POST /api/posts/:id/report  { reason? }
router.post('/:id/report', async (req, res) => {
  const uid = req.user._id;
  const reason = optionalString(req.body?.reason, 'reason', { max: 500 });
  const result = await Post.updateOne(
    { _id: req.params.id, 'reports.user': { $ne: uid } },
    { $push: { reports: { user: uid, reason } } }
  );
  if (result.matchedCount === 0 && !(await Post.exists({ _id: req.params.id }))) {
    throw notFound('পোস্টটি খুঁজে পাওয়া যায়নি।');
  }
  res.json({ ok: true });
});

router.get('/:id/comments', async (req, res) => {
  const comments = await Comment.find({ post: req.params.id, author: { $nin: req.user.blockedUsers } })
    .sort({ createdAt: 1 })
    .lean();
  res.json({ comments: comments.map(serializeComment) });
});

// POST /api/posts/:id/comments  { content, parentId? }  → +2 points
// A reply to a reply attaches to the same top-level comment (Facebook-style, one level deep).
router.post('/:id/comments', async (req, res) => {
  const me = req.user;
  const content = requireString(req.body?.content, 'কমেন্ট', { max: 2000 });

  let parent = null;
  if (req.body?.parentId) {
    parent = await Comment.findOne({ _id: String(req.body.parentId), post: req.params.id }).lean();
    if (!parent) throw notFound('কমেন্টটি খুঁজে পাওয়া যায়নি।');
  }

  const post = await Post.findOneAndUpdate(
    { _id: req.params.id, ...visiblePostsFilter(me._id) },
    { $inc: { commentsCount: 1 } },
    { returnDocument: 'after' }
  ).lean();
  if (!post) throw notFound('পোস্টটি খুঁজে পাওয়া যায়নি।');

  const comment = await Comment.create({
    post: post._id,
    parent: parent ? parent.parent || parent._id : null,
    author: me._id,
    authorName: me.name,
    authorAvatar: me.avatar,
    content,
  });
  const [tx] = await Promise.all([
    awardPoints(me._id, POINT_RULES.comment, 'কমেন্ট (+২ পয়েন্ট)', { source: 'comment', refId: comment._id }),
    parent?.author && parent.author !== me._id
      ? Notification.create({
          owner: parent.author,
          title: 'কমেন্টের উত্তর',
          message: `${me.name} আপনার কমেন্টের উত্তর দিয়েছেন: "${content.slice(0, 80)}"`,
          type: 'community',
        })
      : null,
  ]);

  res.status(201).json({
    comment: serializeComment(comment.toObject()),
    post: serializePost(post, me._id),
    rewardTx: txOut(tx),
  });
});

export default router;
