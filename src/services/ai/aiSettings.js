import { env } from '../../config/env.js';
import { AiSettings } from '../../models/index.js';
import { badRequest } from '../../utils/httpError.js';

/**
 * Admin-editable settings for the AI tasks (Admin → AI টাস্ক), stored in one
 * MongoDB document. The first read creates it, seeded from the old env vars.
 */

const ID = 'global';
let cache = null;

const toPlain = (doc) => {
  const o = doc.toObject ? doc.toObject() : doc;
  delete o.__v;
  return o;
};

export async function getSettings() {
  if (cache) return cache;
  let doc = await AiSettings.findById(ID);
  if (!doc) {
    const [start, end] = env.aiCommunity.activeHours;
    doc = await AiSettings.create({
      _id: ID,
      autoEnabled: env.aiCommunity.enabled,
      activeHours: { start, end },
      post: { imagePercent: env.aiCommunity.imagePercent },
    });
    console.log('[ai] created AI task settings (Admin → AI টাস্ক)');
  }
  cache = toPlain(doc);
  return cache;
}

/** Only nextRunAt is written by the scheduler; everything else comes from the admin. */
export async function saveNextRun(task, date) {
  await AiSettings.updateOne({ _id: ID }, { $set: { [`nextRunAt.${task}`]: date } });
  if (cache) cache = { ...cache, nextRunAt: { ...cache.nextRunAt, [task]: date } };
}

// ---- validation ---------------------------------------------------------

function int(value, field, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.round(n) !== n) throw badRequest(`${field}: পূর্ণ সংখ্যা দিন।`);
  if (n < min || n > max) throw badRequest(`${field}: ${min} থেকে ${max} এর মধ্যে দিন।`);
  return n;
}

const bool = (value) => Boolean(value);

function range(src, cur, prefix, label, keys, min, max, set) {
  const [lowKey, highKey] = keys;
  const low = src[lowKey] !== undefined ? int(src[lowKey], `${label} (কম)`, min, max) : cur[lowKey];
  const high = src[highKey] !== undefined ? int(src[highKey], `${label} (বেশি)`, min, max) : cur[highKey];
  if (low > high) throw badRequest(`${label}: কম সংখ্যাটি বেশি সংখ্যার চেয়ে বড় হতে পারবে না।`);
  if (src[lowKey] !== undefined) set[`${prefix}.${lowKey}`] = low;
  if (src[highKey] !== undefined) set[`${prefix}.${highKey}`] = high;
}

function modelChoice(src, prefix, set) {
  if (!src || typeof src !== 'object') return;
  for (const key of ['cli', 'model']) {
    if (src[key] === undefined) continue;
    const value = String(src[key] ?? '').trim();
    if (value.length > (key === 'cli' ? 60 : 120) || /[^\w.:/@\-[\] ]/.test(value)) throw badRequest(`মডেলের নাম ঠিক নেই: ${value}`);
    set[`${prefix}.${key}`] = value;
  }
}

/**
 * Applies a partial update from the admin. Throws 400 with a Bangla message on
 * bad input (min > max, out of range). Returns the new settings.
 */
export async function updateSettings(patch = {}) {
  const cur = await getSettings();
  const set = {};

  if (patch.autoEnabled !== undefined) set.autoEnabled = bool(patch.autoEnabled);
  if (patch.activeHours) {
    const start = patch.activeHours.start !== undefined ? int(patch.activeHours.start, 'শুরুর সময়', 0, 23) : cur.activeHours.start;
    const end = patch.activeHours.end !== undefined ? int(patch.activeHours.end, 'শেষের সময়', 1, 24) : cur.activeHours.end;
    if (start >= end) throw badRequest('সক্রিয় সময়: শুরু শেষের আগে হতে হবে।');
    set['activeHours.start'] = start;
    set['activeHours.end'] = end;
  }

  const p = patch.post;
  if (p) {
    if (p.enabled !== undefined) set['post.enabled'] = bool(p.enabled);
    range(p, cur.post, 'post', 'পোস্টের বিরতি (মিনিট)', ['minMinutes', 'maxMinutes'], 5, 24 * 60, set);
    if (p.imagePercent !== undefined) set['post.imagePercent'] = int(p.imagePercent, 'ছবিসহ পোস্ট %', 0, 100);
    modelChoice(p.textModel, 'post.textModel', set);
    modelChoice(p.imageModel, 'post.imageModel', set);
  }

  const c = patch.comment;
  if (c) {
    if (c.enabled !== undefined) set['comment.enabled'] = bool(c.enabled);
    if (c.includeAiPosts !== undefined) set['comment.includeAiPosts'] = bool(c.includeAiPosts);
    range(c, cur.comment, 'comment', 'কমেন্টের বিরতি (মিনিট)', ['minMinutes', 'maxMinutes'], 2, 24 * 60, set);
    range(c, cur.comment, 'comment', 'কমেন্টের সংখ্যা', ['minCount', 'maxCount'], 1, 15, set);
    if (c.recentPosts !== undefined) set['comment.recentPosts'] = int(c.recentPosts, 'সাম্প্রতিক পোস্ট', 1, 200);
    if (c.maxAiCommentsPerPost !== undefined) {
      set['comment.maxAiCommentsPerPost'] = int(c.maxAiCommentsPerPost, 'প্রতি পোস্টে সর্বোচ্চ AI কমেন্ট', 1, 100);
    }
    modelChoice(c.model, 'comment.model', set);
  }

  const l = patch.like;
  if (l) {
    if (l.enabled !== undefined) set['like.enabled'] = bool(l.enabled);
    range(l, cur.like, 'like', 'লাইকের বিরতি (মিনিট)', ['minMinutes', 'maxMinutes'], 1, 24 * 60, set);
    range(l, cur.like, 'like', 'লাইকের সংখ্যা', ['minCount', 'maxCount'], 1, 100, set);
    if (l.recentPosts !== undefined) set['like.recentPosts'] = int(l.recentPosts, 'সাম্প্রতিক পোস্ট', 1, 200);
    if (l.reactionMix) {
      const mix = { ...cur.like.reactionMix };
      for (const type of ['like', 'love', 'care', 'haha']) {
        if (l.reactionMix[type] !== undefined) mix[type] = int(l.reactionMix[type], `রিঅ্যাকশন ${type} %`, 0, 100);
      }
      if (!Object.values(mix).some((v) => v > 0)) throw badRequest('অন্তত একটি রিঅ্যাকশনের ভাগ ০ এর বেশি দিন।');
      for (const [type, v] of Object.entries(mix)) set[`like.reactionMix.${type}`] = v;
    }
  }

  if (patch.persona) {
    modelChoice(patch.persona.profileModel, 'persona.profileModel', set);
    modelChoice(patch.persona.portraitModel, 'persona.portraitModel', set);
  }

  if (!Object.keys(set).length) return cur;
  const doc = await AiSettings.findByIdAndUpdate(ID, { $set: set }, { returnDocument: 'after', runValidators: true });
  cache = toPlain(doc);
  return cache;
}

/** { cli, model } for node-agent, or {} for the .env defaults. */
export const modelOpts = (choice) => ({
  ...(choice?.cli ? { cli: choice.cli } : {}),
  ...(choice?.model ? { model: choice.model } : {}),
});
