import { env } from '../config/env.js';
import { Post } from '../models/index.js';
import { activePersonas, pickPersonaFor, publishAiComment, publishAiPost, unansweredPosts } from '../services/ai/personas.js';

/**
 * Keeps the community feed alive with labeled AI personas:
 *  - one post every AI_POST_EVERY_HOURS from the least recently used persona,
 *  - a first reply on members' posts that got no comment within AI_REPLY_AFTER_MINUTES.
 * Runs only during AI_ACTIVE_HOURS (Asia/Dhaka). Started from server.js when
 * AI_COMMUNITY_ENABLED=true.
 */

const MAX_RUNS = 50;
const runs = [];
let timer = null;
let running = false;
let pausedUntil = 0;

/** Remembers the last runs for the admin status panel. */
export function recordRun(entry) {
  runs.unshift({ at: new Date().toISOString(), ...entry });
  runs.length = Math.min(runs.length, MAX_RUNS);
}

export const recentRuns = () => runs.slice();

export const schedulerState = () => ({
  enabled: env.aiCommunity.enabled,
  running: Boolean(timer),
  busy: running,
  pausedUntil: pausedUntil > Date.now() ? new Date(pausedUntil).toISOString() : null,
  settings: env.aiCommunity,
});

function dhakaHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Dhaka' }).format(date));
}

const withinActiveHours = () => {
  const [start, end] = env.aiCommunity.activeHours;
  const hour = dhakaHour();
  return hour >= start && hour < end;
};

/** Stops this tick on errors that will repeat (quota, auth, agent down); the next tick retries. */
function handleError(err, what, persona) {
  recordRun({ what, persona: persona?.name, ok: false, error: err.message, kind: err.kind });
  if (err.kind === 'auth') {
    console.error(`[ai] ${err.message} — check NODE_AGENT_TOKEN in backend/.env`);
    return true;
  }
  if (err.kind === 'rate_limit') {
    const waitMs = (err.retryAfter || 30 * 60) * 1000;
    pausedUntil = Date.now() + waitMs;
    console.warn(`[ai] ${err.message} — pausing ${Math.round(waitMs / 60_000)} min`);
    return true;
  }
  console.error(`[ai] ${what} failed:`, err.message);
  return err.kind === 'transient';
}

export async function tick({ force = false } = {}) {
  if (running) return;
  if (!force && (Date.now() < pausedUntil || !withinActiveHours())) return;
  running = true;
  try {
    const personas = await activePersonas();
    if (!personas.length) return;
    const cfg = env.aiCommunity;

    // 1. A new post when none went up recently.
    const since = new Date(Date.now() - cfg.postEveryHours * 3_600_000);
    if (!(await Post.exists({ isAi: true, createdAt: { $gte: since } }))) {
      const persona = personas[0]; // least recently posted
      try {
        const withImage = Math.random() * 100 < cfg.imagePostPercent;
        const post = await publishAiPost(persona, undefined, { withImage });
        recordRun({
          what: 'post',
          persona: persona.name,
          ok: true,
          postId: post._id,
          topic: post.topic,
          withImage: Boolean(post.mediaUrl),
          ...(post.imageError && { error: `ছবি হয়নি: ${post.imageError}` }),
        });
        console.log(`[ai] ${persona.name} posted ${post._id} (${post.topic})`);
      } catch (err) {
        if (handleError(err, 'post', persona)) return;
      }
    }

    // 2. First replies on unanswered member posts.
    const posts = await unansweredPosts({ minAgeMinutes: cfg.replyAfterMinutes, limit: cfg.maxRepliesPerTick });
    for (const post of posts) {
      const persona = pickPersonaFor(personas, post.topic);
      try {
        const comment = await publishAiComment(persona, post._id);
        if (comment) {
          recordRun({ what: 'reply', persona: persona.name, ok: true, postId: post._id, commentId: comment._id });
          console.log(`[ai] ${persona.name} replied on ${post._id}`);
        }
      } catch (err) {
        if (handleError(err, 'reply', persona)) return;
      }
    }
  } catch (err) {
    console.error('[ai] tick failed:', err);
  } finally {
    running = false;
  }
}

export function startAiCommunity() {
  if (!env.aiCommunity.enabled || timer) return;
  if (!env.nodeAgent.url) {
    console.warn('[ai] AI_COMMUNITY_ENABLED=true but NODE_AGENT_URL is empty — AI personas stay off');
    return;
  }
  const everyMs = env.aiCommunity.tickMinutes * 60_000;
  timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  // First tick shortly after start, not immediately (lets the DB settle).
  setTimeout(() => void tick(), 30_000).unref();
  console.log(`[ai] AI personas on: every ${env.aiCommunity.tickMinutes} min via ${env.nodeAgent.url}`);
}

export function stopAiCommunity() {
  if (timer) clearInterval(timer);
  timer = null;
}
