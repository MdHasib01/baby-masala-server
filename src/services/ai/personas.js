import { AI_NAME_SUFFIX, Comment, Notification, POST_TOPICS, Post, User } from '../../models/index.js';
import { writeComment, writePost } from './personaWriter.js';
import { generatePostPhoto } from './personaGenerator.js';
import { randomPhotoStyle } from './looks.js';

/**
 * Labeled AI personas: creating them with the label enforced, and publishing
 * their posts and comments. Personas never react, never earn points and never log in.
 */

export const AI_BIO_PREFIX = 'AI-তৈরি প্রোফাইল — সত্যিকারের মানুষ নন।';
const OLD_BIO_PREFIXES = ['আমি বেবি কেয়ার অ্যাপের একজন AI সহকারী — সত্যিকারের মানুষ নই।'];
// Not a deliverable domain, so no login code can ever reach a persona.
export const AI_CONTACT_DOMAIN = 'ai.babycare.internal';

/** Removes any AI label, current "(AI)" or older "(AI সহকারী)". */
export const stripAiLabel = (name) =>
  String(name || '')
    .replace(/\(\s*AI(\s*সহকারী)?\s*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

/** "নুসরাত জাহান" -> "নুসরাত জাহান (AI)"; never doubled. */
export const labeledName = (name) => `${stripAiLabel(name)} ${AI_NAME_SUFFIX}`;

export function labeledBio(bio) {
  let rest = String(bio || '');
  for (const prefix of [AI_BIO_PREFIX, ...OLD_BIO_PREFIXES]) rest = rest.replace(prefix, '');
  rest = rest.trim();
  return rest ? `${AI_BIO_PREFIX} ${rest}` : AI_BIO_PREFIX;
}

/**
 * Moves personas created with an older label to the current one and copies the
 * new name onto their posts and comments. Safe to run on every start.
 */
export async function relabelPersonas() {
  const personas = await User.find({ isAiPersona: true });
  let changed = 0;
  for (const persona of personas) {
    const name = labeledName(persona.name);
    const bio = labeledBio(persona.bio);
    if (name === persona.name && bio === persona.bio) continue;
    persona.name = name;
    persona.bio = bio;
    await persona.save();
    const author = { authorName: name, authorAvatar: persona.avatar };
    await Promise.all([Post.updateMany({ author: persona._id }, author), Comment.updateMany({ author: persona._id }, author)]);
    changed++;
  }
  if (changed) console.log(`[ai] relabeled ${changed} AI user(s) to "${AI_NAME_SUFFIX}"`);
  return changed;
}

export const cleanTopics = (topics) =>
  [...new Set((Array.isArray(topics) ? topics : []).filter((t) => POST_TOPICS.includes(t)))];

export const activePersonas = () =>
  User.find({ isAiPersona: true, 'persona.active': true }).sort({ 'persona.lastPostAt': 1, createdAt: 1 });

export function serializePersona(u) {
  return {
    id: u._id,
    name: u.name,
    avatar: u.avatar,
    bio: u.bio || '',
    voice: u.persona?.voice || '',
    focusTopics: u.persona?.focusTopics || [],
    active: u.persona?.active !== false,
    lastPostAt: u.persona?.lastPostAt || null,
    location: u.location || '',
    contact: u.contact,
  };
}

/** The persona whose focus topics include `topic`, else the least recently used one. */
export function pickPersonaFor(personas, topic) {
  const matching = personas.filter((p) => p.persona?.focusTopics?.includes(topic));
  const pool = matching.length ? matching : personas;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/** Generates and publishes one post for `persona`. */
/**
 * Writes and publishes one post. With `withImage` it also generates a photo (1-3 min);
 * if only the photo fails the post goes up as text and `imageError` says why.
 */
export async function publishAiPost(persona, topic, { withImage = false } = {}) {
  const focus = persona.persona?.focusTopics?.length ? persona.persona.focusTopics : POST_TOPICS;
  const chosenTopic = topic && POST_TOPICS.includes(topic) ? topic : focus[Math.floor(Math.random() * focus.length)];
  const recent = await Post.find({ author: persona._id }, { content: 1 }).sort({ createdAt: -1 }).limit(5).lean();

  const draft = await writePost(persona, chosenTopic, recent.map((p) => p.content), { withImage });
  let mediaUrl;
  let imageError;
  if (withImage) {
    try {
      if (!draft.photo) throw new Error('AI gave no photo description');
      mediaUrl = await generatePostPhoto(draft.photo, randomPhotoStyle());
    } catch (err) {
      imageError = err.message;
      console.error(`[ai] post photo failed for ${persona.name}:`, err.message);
    }
  }
  const post = await Post.create({
    author: persona._id,
    authorName: persona.name,
    authorAvatar: persona.avatar,
    isVerifiedBuyer: false,
    topic: draft.topic,
    content: draft.content,
    ...(mediaUrl && { mediaUrl, mediaType: 'image' }),
    status: 'approved',
    isAi: true,
  });
  await User.updateOne({ _id: persona._id }, { $set: { 'persona.lastPostAt': new Date() } });
  return { ...post.toObject(), ...(imageError && { imageError }) };
}

/**
 * Generates and publishes one top-level comment on `postId` and notifies the
 * post's author. Returns null when the post is gone or already has an AI comment.
 */
export async function publishAiComment(persona, postId) {
  const post = await Post.findOne({ _id: postId, status: 'approved' }).lean();
  if (!post || post.isAi) return null;
  if (await Comment.exists({ post: post._id, isAi: true })) return null;

  const existing = await Comment.find({ post: post._id }).sort({ createdAt: 1 }).limit(20).lean();
  const { content } = await writeComment(persona, post, existing);

  // Re-check after the (slow) generation, so two runs never both reply.
  if (await Comment.exists({ post: post._id, isAi: true })) return null;
  const updated = await Post.findOneAndUpdate({ _id: post._id }, { $inc: { commentsCount: 1 } }, { returnDocument: 'after' }).lean();
  if (!updated) return null;

  const comment = await Comment.create({
    post: post._id,
    parent: null,
    author: persona._id,
    authorName: persona.name,
    authorAvatar: persona.avatar,
    content,
    isAi: true,
  });

  if (post.author && post.author !== persona._id) {
    await Notification.create({
      owner: post.author,
      title: 'আপনার পোস্টে নতুন কমেন্ট',
      message: `${persona.name} আপনার পোস্টে কমেন্ট করেছেন: "${content.slice(0, 80)}"`,
      type: 'community',
    }).catch((err) => console.error('[ai] notification failed', err.message));
  }
  return comment.toObject();
}

/**
 * Approved posts by real members, aged between `minAgeMinutes` and 3 days,
 * with no comments yet and no AI comment. Oldest first.
 */
export async function unansweredPosts({ minAgeMinutes, limit }) {
  const now = Date.now();
  const candidates = await Post.find({
    status: 'approved',
    isAi: { $ne: true },
    commentsCount: 0,
    createdAt: { $lte: new Date(now - minAgeMinutes * 60_000), $gte: new Date(now - 3 * 24 * 3_600_000) },
  })
    .sort({ createdAt: 1 })
    .limit(limit * 3)
    .lean();

  const out = [];
  for (const post of candidates) {
    if (out.length >= limit) break;
    if (!(await Comment.exists({ post: post._id, isAi: true }))) out.push(post);
  }
  return out;
}
