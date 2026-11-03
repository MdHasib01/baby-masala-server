import { randomBytes } from 'node:crypto';
import { AiBatch, User } from '../../models/index.js';
import { generatePortrait, generateProfile } from './personaGenerator.js';
import { AI_CONTACT_DOMAIN, labeledBio, labeledName } from './personas.js';

/**
 * Bulk creation of AI users ("Admin → AI ইউজার তৈরি করুন").
 * Batches queue and run one user at a time: a portrait takes minutes and
 * node-agent limits concurrency. Progress is stored in MongoDB (AiBatch) after
 * every step, so it survives restarts, and unfinished batches resume on start.
 * Assumes one API process runs the queue (the AI scheduler assumes the same).
 */

export const MAX_PER_BATCH = 20;
const KEEP_FINISHED = 50;
const UNFINISHED = ['queued', 'running'];
const FINISHED_ITEM = new Set(['done', 'failed', 'skipped']);
/** Errors that repeat for every item (quota, token, config): stop the batch instead of burning attempts. */
const isBatchStopper = (err) => err?.kind === 'auth' || err?.kind === 'rate_limit' || err?.kind === 'fatal';

let working = false;

const iso = (d) => (d ? new Date(d).toISOString() : null);

export function publicBatch(b) {
  const items = b.items || [];
  return {
    id: b._id,
    requested: b.requested,
    guidance: b.guidance || '',
    status: b.status,
    createdAt: iso(b.createdAt),
    startedAt: iso(b.startedAt),
    finishedAt: iso(b.finishedAt),
    done: items.filter((i) => i.status === 'done').length,
    failed: items.filter((i) => i.status === 'failed' || i.status === 'skipped').length,
    error: b.error || null,
    items: items.map((i) => ({
      index: i.index,
      status: i.status,
      ...(i.name && { name: i.name }),
      ...(i.avatar && { avatar: i.avatar }),
      ...(i.userId && { userId: i.userId }),
      ...(i.error && { error: i.error }),
    })),
  };
}

export async function listBatches(limit = 20) {
  const batches = await AiBatch.find().sort({ createdAt: -1 }).limit(limit).lean();
  return batches.map(publicBatch);
}

export async function getBatch(id) {
  const batch = await AiBatch.findById(String(id)).lean();
  return batch ? publicBatch(batch) : null;
}

export async function isGenerating() {
  return working || Boolean(await AiBatch.exists({ status: { $in: UNFINISHED } }));
}

export async function startBatch({ count, guidance = '' }) {
  const n = Math.min(Math.max(Math.floor(Number(count)) || 0, 1), MAX_PER_BATCH);
  const batch = await AiBatch.create({
    requested: n,
    guidance: String(guidance || '').trim().slice(0, 500),
    items: Array.from({ length: n }, (_, i) => ({ index: i + 1, status: 'pending' })),
  });
  void pruneFinished();
  void drain();
  return publicBatch(batch.toObject());
}

/** Called once at server start: continues batches a restart interrupted. */
export async function resumeBatches() {
  const pending = await AiBatch.countDocuments({ status: { $in: UNFINISHED } });
  if (!pending) return;
  console.log(`[ai] resuming ${pending} unfinished AI user batch(es)`);
  void drain();
}

async function pruneFinished() {
  try {
    const old = await AiBatch.find({ status: { $nin: UNFINISHED } }, { _id: 1 })
      .sort({ createdAt: -1 })
      .skip(KEEP_FINISHED)
      .lean();
    if (old.length) await AiBatch.deleteMany({ _id: { $in: old.map((b) => b._id) } });
  } catch (err) {
    console.error('[ai] could not prune old batches:', err.message);
  }
}

async function drain() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const batch = await AiBatch.findOne({ status: { $in: UNFINISHED } }).sort({ createdAt: 1 });
      if (!batch) break;
      try {
        await runBatch(batch);
      } catch (err) {
        // Unexpected (e.g. database) error: stop this batch so the loop cannot spin on it.
        console.error(`[ai] batch ${batch._id} crashed:`, err);
        await AiBatch.updateOne(
          { _id: batch._id },
          { status: 'stopped', error: err.message || 'unknown error', finishedAt: new Date() }
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[ai] batch queue stopped:', err.message);
  } finally {
    working = false;
  }
}

async function runBatch(batch) {
  const resumed = batch.status === 'running';
  batch.status = 'running';
  batch.startedAt = batch.startedAt || new Date();
  await batch.save();
  console.log(`[ai] ${resumed ? 'resuming' : 'generating'} ${batch.requested} AI user(s) (${batch._id})`);

  for (const item of batch.items) {
    if (FINISHED_ITEM.has(item.status)) continue;
    try {
      await createUser(batch, item);
    } catch (err) {
      item.status = 'failed';
      item.error = err.message;
      console.error(`[ai] AI user ${item.index}/${batch.requested} failed:`, err.message);
      if (isBatchStopper(err)) {
        for (const rest of batch.items) if (!FINISHED_ITEM.has(rest.status)) rest.status = 'skipped';
        batch.error = err.message;
        batch.status = 'stopped';
        batch.finishedAt = new Date();
        await batch.save();
        return;
      }
      await batch.save();
    }
  }
  batch.status = 'done';
  batch.finishedAt = new Date();
  await batch.save();
}

async function createUser(batch, item) {
  // An item cut off mid-way by a restart starts over; its user was never created
  // unless the restart hit right after User.create, which the contact check catches.
  if (item.userId) {
    const made = await User.findById(item.userId, { name: 1, avatar: 1 }).lean();
    if (made) return markDone(batch, item, made);
  }
  item.name = undefined;
  item.avatar = undefined;
  item.error = undefined;

  item.status = 'profile';
  await batch.save();
  const existing = await User.find({ isAiPersona: true }, { name: 1 }).lean();
  const profile = await generateProfile({ existingNames: existing.map((u) => u.name), guidance: batch.guidance });
  item.name = labeledName(profile.name);

  item.status = 'photo';
  await batch.save();
  let avatar;
  try {
    avatar = await generatePortrait(profile.photoPrompt);
  } catch (err) {
    if (isBatchStopper(err)) throw err;
    item.retried = true;
    avatar = await generatePortrait(profile.photoPrompt);
  }

  // Reserve the id first so a restart between create and save cannot make a duplicate.
  const user = new User({
    name: item.name,
    contact: `persona-${randomBytes(5).toString('hex')}@${AI_CONTACT_DOMAIN}`,
    contactMethod: 'email',
    isVerified: true,
    isMember: true,
    isAiPersona: true,
    avatar,
    bio: labeledBio(profile.bio),
    location: profile.location,
    persona: { voice: profile.voice, focusTopics: profile.focusTopics, active: true },
    notificationPrefs: { push: false, sms: false, email: false, communityAlerts: false },
  });
  item.userId = user._id;
  await batch.save();
  await user.save();
  await markDone(batch, item, user);
  console.log(`[ai] created AI user ${user.name} (${user._id})`);
}

async function markDone(batch, item, user) {
  item.status = 'done';
  item.name = user.name;
  item.avatar = user.avatar;
  item.error = undefined;
  await batch.save();
}

/** New portrait for an existing AI user (keeps the old one if generation fails). */
export async function regeneratePhoto(persona) {
  const description = `A Bangladeshi woman${persona.location ? ` from ${persona.location}` : ''}, age 22-40, in everyday clothes, at home.`;
  return generatePortrait(description);
}
