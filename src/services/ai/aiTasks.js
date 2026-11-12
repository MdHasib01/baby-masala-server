import { Comment, Notification, Post } from '../../models/index.js';
import { modelOpts } from './aiSettings.js';
import { activePersonas, insertAiComment, publishAiPost } from './personas.js';
import { writeCommentBatch } from './personaWriter.js';

/**
 * The three automatic AI tasks run by jobs/aiCommunity.js (Admin → AI টাস্ক).
 * Everything is done by labeled "(AI)" users, as themselves: no points, no
 * likes without a reactor behind them.
 */

export const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const bnNum = (n) => Number(n).toLocaleString('bn-BD');
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- post ---------------------------------------------------------------

const RECENT_POSTER_MS = 3 * 3_600_000;

/** One post by a random active AI user (one who has not posted in the last 3 hours, when possible). */
export async function runPostTask(settings) {
  const personas = await activePersonas();
  if (!personas.length) return { skipped: 'কোনো সক্রিয় AI ইউজার নেই' };
  const rested = personas.filter((p) => !p.persona?.lastPostAt || Date.now() - new Date(p.persona.lastPostAt) > RECENT_POSTER_MS);
  const persona = pick(rested.length ? rested : personas);

  const cfg = settings.post;
  const withImage = Math.random() * 100 < cfg.imagePercent;
  const post = await publishAiPost(persona, undefined, {
    withImage,
    textAi: modelOpts(cfg.textModel),
    imageAi: modelOpts(cfg.imageModel),
  });
  return {
    persona: persona.name,
    postId: post._id,
    topic: post.topic,
    withImage: Boolean(post.mediaUrl),
    ...(post.imageError && { error: `ছবি হয়নি: ${post.imageError}` }),
  };
}

// ---- comments -----------------------------------------------------------

/** Spread a batch's comments over about two minutes so they do not land at once. */
const STAGGER_MS = [20_000, 120_000];

/**
 * Picks one recent post, writes rand(minCount..maxCount) comments for it in one
 * AI call and posts each from a different AI user. The comments are inserted in
 * the background over the next minutes; the summary is returned right away.
 */
export async function runCommentTask(settings) {
  const cfg = settings.comment;
  const personas = await activePersonas();
  if (!personas.length) return { skipped: 'কোনো সক্রিয় AI ইউজার নেই' };

  const posts = await Post.find({ status: 'approved', ...(cfg.includeAiPosts ? {} : { isAi: { $ne: true } }) })
    .sort({ createdAt: -1 })
    .limit(cfg.recentPosts)
    .lean();
  if (!posts.length) return { skipped: 'কোনো পোস্ট নেই' };

  const stats = await Comment.aggregate([
    { $match: { post: { $in: posts.map((p) => p._id) }, isAi: true } },
    { $group: { _id: '$post', n: { $sum: 1 }, authors: { $addToSet: '$author' } } },
  ]);
  const byPost = new Map(stats.map((s) => [s._id, s]));

  // Candidates: under the per-post cap and with at least one AI user left who
  // has not commented there yet (and is not the author).
  const candidates = [];
  for (const post of posts) {
    const s = byPost.get(post._id);
    const aiCount = s?.n || 0;
    const room = cfg.maxAiCommentsPerPost - aiCount;
    if (room < 1) continue;
    const done = new Set(s?.authors || []);
    const free = personas.filter((p) => p._id !== post.author && !done.has(p._id));
    if (free.length) candidates.push({ post, aiCount, room, free });
  }
  if (!candidates.length) return { skipped: 'সব সাম্প্রতিক পোস্টে AI কমেন্টের সীমা পূর্ণ' };

  // Fewest AI comments first; among those, members' posts nobody answered yet.
  const fewest = Math.min(...candidates.map((c) => c.aiCount));
  const pool = candidates.filter((c) => c.aiCount === fewest);
  const unanswered = pool.filter((c) => !c.post.isAi && !c.post.commentsCount);
  const target = pick(unanswered.length ? unanswered : pool);

  const n = Math.min(randInt(cfg.minCount, cfg.maxCount), target.room, target.free.length);
  const cast = shuffle(target.free).slice(0, n);
  const existing = await Comment.find({ post: target.post._id }).sort({ createdAt: 1 }).limit(30).lean();
  const mix = cfg.lengthMix || { reaction: 30, short: 35, medium: 25, long: 10 };
  const lengths = cast.map(() => pickWeighted(mix, 'short'));
  // A batch of only one-word reactions or only essays looks staged: make sure there is some of both.
  // (Only with lengths the admin's mix allows.)
  if (cast.length >= 3 && mix.medium > 0 && lengths.every((l) => l === 'reaction' || l === 'short')) lengths[randInt(0, cast.length - 1)] = 'medium';
  if (cast.length >= 3 && mix.reaction > 0 && lengths.every((l) => l === 'medium' || l === 'long')) lengths[randInt(0, cast.length - 1)] = 'reaction';
  const drafts = await writeCommentBatch(target.post, existing, cast, { ai: modelOpts(cfg.model), lengths });

  void publishStaggered(target.post, drafts, cfg.maxAiCommentsPerPost);
  return {
    postId: target.post._id,
    count: drafts.length,
    personas: drafts.map((d) => d.persona.name),
    note: `${bnNum(drafts.length)}টি কমেন্ট আগামী ~২ মিনিটে যাবে`,
  };
}

async function publishStaggered(post, drafts, cap) {
  const posted = [];
  for (const { persona, content } of drafts) {
    await sleep(randInt(...STAGGER_MS) / drafts.length + randInt(0, 15_000));
    try {
      if ((await Comment.countDocuments({ post: post._id, isAi: true })) >= cap) break;
      if (await Comment.exists({ post: post._id, author: persona._id, isAi: true })) continue;
      const comment = await insertAiComment(post._id, persona, content);
      if (!comment) break; // post was removed meanwhile
      posted.push(persona.name);
    } catch (err) {
      console.error(`[ai] comment by ${persona.name} on ${post._id} failed:`, err.message);
    }
  }
  console.log(`[ai] ${posted.length} AI comment(s) on ${post._id}`);

  // One grouped notification for a real member, not one per comment.
  if (posted.length && post.author && !post.isAi) {
    const others = posted.length - 1;
    await Notification.create({
      owner: post.author,
      title: 'আপনার পোস্টে নতুন কমেন্ট',
      message: others ? `${posted[0]} ও আরও ${bnNum(others)} জন আপনার পোস্টে কমেন্ট করেছেন।` : `${posted[0]} আপনার পোস্টে কমেন্ট করেছেন।`,
      type: 'community',
    }).catch((err) => console.error('[ai] notification failed', err.message));
  }
}

// ---- reactions ----------------------------------------------------------

/** A key of `mix` ({ key: weight }) drawn by weight; `fallback` when every weight is 0. */
function pickWeighted(mix, fallback) {
  const entries = Object.entries(mix || {}).filter(([, w]) => w > 0);
  if (!entries.length) return fallback;
  let roll = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [type, w] of entries) {
    roll -= w;
    if (roll < 0) return type;
  }
  return entries[0][0];
}

/**
 * rand(minCount..maxCount) reactions spread over the last `recentPosts` posts.
 * Each one is a real reaction by one AI user (at most one per AI user per post),
 * stored exactly like a member's, but without points or notifications.
 */
export async function runLikeTask(settings) {
  const cfg = settings.like;
  const personas = await activePersonas();
  if (!personas.length) return { skipped: 'কোনো সক্রিয় AI ইউজার নেই' };

  const posts = await Post.find({ status: 'approved' }, { author: 1, likedBy: 1 })
    .sort({ createdAt: -1 })
    .limit(cfg.recentPosts)
    .lean();
  if (!posts.length) return { skipped: 'কোনো পোস্ট নেই' };

  const wanted = randInt(cfg.minCount, cfg.maxCount);
  const liked = new Map(posts.map((p) => [p._id, new Set(p.likedBy || [])]));
  const touched = new Set();
  const reactors = new Set();
  let count = 0;

  for (let i = 0; i < wanted; i++) {
    const open = posts
      .map((post) => ({ post, free: personas.filter((p) => p._id !== post.author && !liked.get(post._id).has(p._id)) }))
      .filter((c) => c.free.length);
    if (!open.length) break;
    const { post, free } = pick(open);
    const persona = pick(free);
    const type = pickWeighted(cfg.reactionMix, 'like');

    // Same conditional update as POST /api/posts/:id/react, so the count stays exact.
    const r = await Post.updateOne(
      { _id: post._id, status: 'approved', likedBy: { $ne: persona._id } },
      { $push: { likedBy: persona._id, reactions: { user: persona._id, type } }, $inc: { likes: 1 } }
    );
    liked.get(post._id).add(persona._id);
    if (r.modifiedCount === 1) {
      count++;
      touched.add(post._id);
      reactors.add(persona.name);
    }
  }
  return { count, note: `${bnNum(touched.size)}টি পোস্টে ${bnNum(count)}টি রিঅ্যাকশন`, personas: [...reactors] };
}

export const TASK_RUNNERS = { post: runPostTask, comment: runCommentTask, like: runLikeTask };
