import { env } from '../config/env.js';
import { AI_TASKS, AiRunLog } from '../models/index.js';
import { getSettings, saveNextRun } from '../services/ai/aiSettings.js';
import { randInt, TASK_RUNNERS } from '../services/ai/aiTasks.js';

/**
 * Admin → AI টাস্ক scheduler. Three independent loops (post, comment, like),
 * each firing at a random time inside its own [minMinutes, maxMinutes] range
 * from the AiSettings document. A loop runs only while the master Auto switch
 * and the task's own switch are on; work happens only inside the active hours
 * (Asia/Dhaka). Next run times are stored, so a restart keeps the schedule.
 * Assumes one API process (like the persona batch queue).
 */

const state = Object.fromEntries(
  AI_TASKS.map((task) => [task, { timer: null, nextAt: null, busy: false, pausedUntil: 0 }])
);
let started = false;

// ---- run history --------------------------------------------------------

/** Saves one run for the admin history (AiRunLog keeps 7 days). */
export function recordRun(entry) {
  AiRunLog.create({ at: new Date(), ...entry }).catch((err) => console.error('[ai] run log failed:', err.message));
}

export async function recentRuns(limit = 50) {
  const runs = await AiRunLog.find().sort({ at: -1 }).limit(limit).lean();
  return runs.map(({ _id, ...r }) => ({ id: String(_id), ...r }));
}

// ---- helpers ------------------------------------------------------------

function dhakaHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Dhaka' }).format(date));
}

const withinActiveHours = (settings) => {
  const { start, end } = settings.activeHours;
  const hour = dhakaHour();
  return hour >= start && hour < end;
};

const loopOn = (settings, task) => Boolean(settings.autoEnabled && settings[task]?.enabled);

/** Pauses only this task on errors that will repeat (quota); auth errors are logged loudly. */
function handleError(task, err) {
  if (err.kind === 'auth') console.error(`[ai] ${task}: ${err.message} — check NODE_AGENT_TOKEN in backend/.env`);
  else if (err.kind === 'rate_limit') {
    const waitMs = (err.retryAfter || 30 * 60) * 1000;
    state[task].pausedUntil = Date.now() + waitMs;
    console.warn(`[ai] ${task}: ${err.message} — pausing ${Math.round(waitMs / 60_000)} min`);
  } else console.error(`[ai] ${task} failed:`, err.message);
}

// ---- running a task -----------------------------------------------------

/**
 * Runs one task now and records it. `manual` runs (admin button) ignore the
 * switches, active hours and pause. Returns the recorded entry.
 */
export async function runTask(task, { manual = false } = {}) {
  if (!TASK_RUNNERS[task]) throw new Error(`unknown AI task ${task}`);
  const s = state[task];
  if (s.busy) return { what: task, ok: false, manual, error: 'আগের রান এখনো চলছে' };
  s.busy = true;
  let entry;
  try {
    const settings = await getSettings();
    const { skipped, ...result } = await TASK_RUNNERS[task](settings);
    entry = { what: task, ok: true, manual, ...result, ...(skipped && { note: skipped }) };
    console.log(`[ai] ${task}${manual ? ' (manual)' : ''}: ${entry.note || entry.persona || 'done'}`);
  } catch (err) {
    handleError(task, err);
    entry = { what: task, ok: false, manual, error: err.message, kind: err.kind };
  } finally {
    s.busy = false;
  }
  recordRun(entry);
  return entry;
}

async function fire(task) {
  const s = state[task];
  s.timer = null;
  try {
    const settings = await getSettings();
    if (!loopOn(settings, task)) return;
    if (Date.now() < s.pausedUntil) recordRun({ what: task, ok: true, note: 'বিরতিতে আছে (কোটা), বাদ দেওয়া হলো' });
    else if (!withinActiveHours(settings)) {
      // quiet hours: skip silently
    } else await runTask(task);
  } catch (err) {
    console.error(`[ai] ${task} tick failed:`, err);
  } finally {
    await schedule(task).catch((err) => console.error(`[ai] could not schedule ${task}:`, err.message));
  }
}

/**
 * Sets the next run of `task`. `resume` uses the stored time when it is still
 * ahead (an overdue one runs in ~1 min); otherwise a fresh random delay.
 */
async function schedule(task, { resume = false } = {}) {
  const s = state[task];
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;

  const settings = await getSettings();
  if (!started || !loopOn(settings, task)) {
    s.nextAt = null;
    if (settings.nextRunAt?.[task]) await saveNextRun(task, null);
    return;
  }

  const cfg = settings[task];
  const saved = settings.nextRunAt?.[task] ? new Date(settings.nextRunAt[task]).getTime() : 0;
  const maxAhead = cfg.maxMinutes * 60_000 + 60_000;
  let at;
  if (resume && saved > Date.now() && saved - Date.now() <= maxAhead) at = saved;
  else if (resume && saved && saved <= Date.now()) at = Date.now() + randInt(30, 90) * 1000;
  else at = Date.now() + randInt(cfg.minMinutes * 60, cfg.maxMinutes * 60) * 1000;

  s.nextAt = new Date(at);
  s.timer = setTimeout(() => void fire(task), Math.max(at - Date.now(), 1000));
  s.timer.unref();
  await saveNextRun(task, s.nextAt);
}

// ---- public -------------------------------------------------------------

export async function startAiCommunity() {
  if (started) return;
  started = true;
  if (!env.nodeAgent.url) console.warn('[ai] NODE_AGENT_URL is empty — AI post/comment tasks will fail until it is set');
  for (const task of AI_TASKS) await schedule(task, { resume: true });
  const settings = await getSettings();
  const on = AI_TASKS.filter((t) => loopOn(settings, t));
  console.log(`[ai] AI tasks: auto ${settings.autoEnabled ? 'on' : 'off'}${on.length ? ` (${on.join(', ')})` : ''}`);
}

/**
 * Applies changed settings: tasks switched off stop, tasks switched on get a
 * fresh random time, and a pending run outside the new range is re-drawn.
 */
export async function reschedule() {
  if (!started) return;
  const settings = await getSettings();
  for (const task of AI_TASKS) {
    const s = state[task];
    const on = loopOn(settings, task);
    const tooLate = s.nextAt && s.nextAt.getTime() - Date.now() > settings[task].maxMinutes * 60_000 + 60_000;
    if (!on || !s.timer || tooLate) await schedule(task);
  }
}

export function stopAiCommunity() {
  for (const task of AI_TASKS) {
    if (state[task].timer) clearTimeout(state[task].timer);
    state[task].timer = null;
  }
  started = false;
}

export async function schedulerState() {
  const settings = await getSettings();
  return {
    autoEnabled: settings.autoEnabled,
    activeHours: settings.activeHours,
    inActiveHours: withinActiveHours(settings),
    tasks: Object.fromEntries(
      AI_TASKS.map((task) => {
        const s = state[task];
        return [
          task,
          {
            enabled: Boolean(settings[task]?.enabled),
            scheduled: Boolean(s.timer),
            nextRunAt: s.nextAt ? s.nextAt.toISOString() : null,
            busy: s.busy,
            pausedUntil: s.pausedUntil > Date.now() ? new Date(s.pausedUntil).toISOString() : null,
          },
        ];
      })
    ),
  };
}
