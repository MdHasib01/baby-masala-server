import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { recentRuns, recordRun, schedulerState, tick } from '../jobs/aiCommunity.js';
import { Comment, Post, User } from '../models/index.js';
import { deleteAccount } from '../services/accountDeletion.js';
import { ping } from '../services/ai/nodeAgentClient.js';
import { getBatch, isGenerating, listBatches, MAX_PER_BATCH, regeneratePhoto, startBatch } from '../services/ai/personaBatches.js';
import { destroyByUrls } from '../services/cloudinary.js';
import {
  AI_CONTACT_DOMAIN,
  activePersonas,
  cleanTopics,
  labeledBio,
  labeledName,
  pickPersonaFor,
  publishAiComment,
  publishAiPost,
  serializePersona,
} from '../services/ai/personas.js';
import { serializeComment, serializePost } from '../services/serializers.js';
import { badRequest, HttpError, notFound } from '../utils/httpError.js';
import { optionalString, requireString } from '../utils/validate.js';

// Mounted at /api/admin/ai behind requireAuth + requireAdmin.
const router = Router();

/** node-agent errors become readable admin errors (429 for quota, 502 otherwise). */
function agentHttpError(err) {
  if (!err?.kind) return err;
  return new HttpError(err.kind === 'rate_limit' ? 429 : 502, `AI: ${err.message}`, `AGENT_${err.kind.toUpperCase()}`);
}

async function loadPersona(id) {
  const persona = await User.findOne({ _id: id, isAiPersona: true });
  if (!persona) throw notFound('AI ইউজার খুঁজে পাওয়া যায়নি।');
  return persona;
}

function personaFields(body, { partial }) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = labeledName(requireString(body.name, 'নাম', { max: 60 }));
  if (body.avatar !== undefined) out.avatar = requireString(body.avatar, 'avatar', { max: 2000 });
  if (!partial || body.bio !== undefined) out.bio = labeledBio(optionalString(body.bio, 'bio', { max: 400 }));
  if (body.voice !== undefined) out['persona.voice'] = optionalString(body.voice, 'voice', { max: 1000 }) || '';
  if (body.focusTopics !== undefined) out['persona.focusTopics'] = cleanTopics(body.focusTopics);
  if (body.active !== undefined) out['persona.active'] = Boolean(body.active);
  return out;
}

// GET /api/admin/ai/status — node-agent reachability + token, scheduler state, recent runs
router.get('/status', async (_req, res) => {
  const [agent, personas, aiPosts, aiComments] = await Promise.all([
    ping(),
    User.countDocuments({ isAiPersona: true }),
    Post.countDocuments({ isAi: true }),
    Comment.countDocuments({ isAi: true }),
  ]);
  res.json({
    agent,
    scheduler: schedulerState(),
    generating: await isGenerating(),
    counts: { personas, aiPosts, aiComments },
    runs: recentRuns(),
  });
});

// GET /api/admin/ai/personas?active=true|false — newest first
router.get('/personas', async (req, res) => {
  const filter = { isAiPersona: true };
  if (req.query.active === 'true') filter['persona.active'] = { $ne: false };
  if (req.query.active === 'false') filter['persona.active'] = false;
  const [personas, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).limit(500).lean(),
    User.countDocuments({ isAiPersona: true }),
  ]);
  res.json({ personas: personas.map(serializePersona), total });
});

// POST /api/admin/ai/personas/generate  { count: 1-20, guidance? } — creates AI users in the background
router.post('/personas/generate', async (req, res) => {
  const count = Number(req.body?.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_PER_BATCH) {
    throw badRequest(`একবারে ১ থেকে ${MAX_PER_BATCH} জন তৈরি করা যাবে।`);
  }
  const guidance = optionalString(req.body?.guidance, 'guidance', { max: 500 }) || '';
  res.status(202).json({ batch: await startBatch({ count, guidance }) });
});

router.get('/batches', async (_req, res) => {
  res.json({ batches: await listBatches(), generating: await isGenerating() });
});

router.get('/batches/:id', async (req, res) => {
  const batch = await getBatch(req.params.id);
  if (!batch) throw notFound('ব্যাচটি খুঁজে পাওয়া যায়নি।');
  res.json({ batch });
});

// POST /api/admin/ai/personas/:id/photo — new AI portrait (takes a few minutes)
router.post('/personas/:id/photo', async (req, res) => {
  const persona = await loadPersona(req.params.id);
  let avatar;
  try {
    avatar = await regeneratePhoto(persona);
  } catch (err) {
    throw agentHttpError(err);
  }
  const oldAvatar = persona.avatar;
  persona.avatar = avatar;
  await persona.save();
  await Promise.all([
    Post.updateMany({ author: persona._id }, { authorAvatar: avatar }),
    Comment.updateMany({ author: persona._id }, { authorAvatar: avatar }),
  ]);
  if (oldAvatar && oldAvatar !== avatar) destroyByUrls([oldAvatar]).catch(() => {});
  res.json({ persona: serializePersona(persona.toObject()) });
});

// POST /api/admin/ai/personas  { name, avatar?, bio?, voice?, focusTopics?, active? }
router.post('/personas', async (req, res) => {
  const fields = personaFields(req.body || {}, { partial: false });
  const persona = await User.create({
    name: fields.name,
    contact: `persona-${randomBytes(4).toString('hex')}@${AI_CONTACT_DOMAIN}`,
    contactMethod: 'email',
    isVerified: true,
    isMember: true,
    isAiPersona: true,
    ...(fields.avatar && { avatar: fields.avatar }),
    bio: fields.bio,
    persona: {
      voice: fields['persona.voice'] || '',
      focusTopics: fields['persona.focusTopics'] || [],
      active: fields['persona.active'] ?? true,
    },
    notificationPrefs: { push: false, sms: false, email: false, communityAlerts: false },
  });
  res.status(201).json({ persona: serializePersona(persona.toObject()) });
});

// PATCH /api/admin/ai/personas/:id — name/avatar changes are copied onto its posts and comments.
router.patch('/personas/:id', async (req, res) => {
  const persona = await loadPersona(req.params.id);
  const fields = personaFields(req.body || {}, { partial: true });
  if (!Object.keys(fields).length) throw badRequest('কিছুই পরিবর্তন করা হয়নি।');
  persona.set(fields);
  await persona.save();

  if (fields.name || fields.avatar) {
    const author = { authorName: persona.name, authorAvatar: persona.avatar };
    await Promise.all([Post.updateMany({ author: persona._id }, author), Comment.updateMany({ author: persona._id }, author)]);
  }
  res.json({ persona: serializePersona(persona.toObject()) });
});

// DELETE /api/admin/ai/personas/:id — removes the persona with all its posts and comments.
router.delete('/personas/:id', async (req, res) => {
  const persona = await loadPersona(req.params.id);
  await deleteAccount(persona);
  res.json({ ok: true });
});

// POST /api/admin/ai/personas/:id/post-now  { topic? } — publishes one post right away.
router.post('/personas/:id/post-now', async (req, res) => {
  const persona = await loadPersona(req.params.id);
  try {
    const post = await publishAiPost(persona, req.body?.topic);
    recordRun({ what: 'post', persona: persona.name, ok: true, postId: post._id, topic: post.topic, manual: true });
    res.status(201).json({ post: serializePost(post, req.user._id) });
  } catch (err) {
    recordRun({ what: 'post', persona: persona.name, ok: false, error: err.message, manual: true });
    throw agentHttpError(err);
  }
});

// POST /api/admin/ai/reply/:postId  { personaId? } — an AI reply on that post right away.
router.post('/reply/:postId', async (req, res) => {
  const post = await Post.findById(req.params.postId).lean();
  if (!post) throw notFound('পোস্টটি খুঁজে পাওয়া যায়নি।');
  if (post.isAi) throw badRequest('AI পোস্টে AI উত্তর দেওয়া হয় না।');

  const persona = req.body?.personaId
    ? await loadPersona(String(req.body.personaId))
    : pickPersonaFor(await activePersonas(), post.topic);
  if (!persona) throw badRequest('কোনো সক্রিয় AI ইউজার নেই।');

  let comment;
  try {
    comment = await publishAiComment(persona, post._id);
  } catch (err) {
    recordRun({ what: 'reply', persona: persona.name, ok: false, error: err.message, manual: true });
    throw agentHttpError(err);
  }
  if (!comment) throw badRequest('এই পোস্টে ইতিমধ্যে একটি AI উত্তর আছে।');
  recordRun({ what: 'reply', persona: persona.name, ok: true, postId: post._id, commentId: comment._id, manual: true });
  res.status(201).json({ comment: serializeComment(comment) });
});

// POST /api/admin/ai/run — one scheduler tick now (ignores active hours / pause).
router.post('/run', async (_req, res) => {
  await tick({ force: true });
  res.json({ ok: true, runs: recentRuns().slice(0, 10) });
});

// GET /api/admin/ai/activity — latest AI posts and comments
router.get('/activity', async (req, res) => {
  const [posts, comments] = await Promise.all([
    Post.find({ isAi: true }).sort({ createdAt: -1 }).limit(30).lean(),
    Comment.find({ isAi: true }).sort({ createdAt: -1 }).limit(30).lean(),
  ]);
  res.json({ posts: posts.map((p) => serializePost(p, req.user._id)), comments: comments.map(serializeComment) });
});

export default router;
