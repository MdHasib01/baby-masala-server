import { env } from '../../config/env.js';
import { httpRequest } from './httpRequest.js';

/**
 * Thin client for node-agent (Agent Console), which runs the claude / codex / agy
 * CLIs behind a per-user API token (nak_...). Trimmed port of
 * Combined Harness/smash/server/src/services/providers/nodeAgentClient.js.
 *
 * Server-to-server only: node-agent sets no CORS headers, and NODE_AGENT_TOKEN
 * must never be sent to the web or mobile clients.
 */

/** kind: 'auth' | 'rate_limit' | 'transient' | 'fatal' */
export class AgentError extends Error {
  constructor(kind, message, { cause, retryAfter } = {}) {
    super(message, { cause });
    this.name = 'AgentError';
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

export const isConfigured = () => Boolean(env.nodeAgent.url);

const authHeaders = () => (env.nodeAgent.token ? { Authorization: `Bearer ${env.nodeAgent.token}` } : {});

const describe = (err) => err?.code ?? err?.message ?? 'unknown error';

/**
 * node-agent answers 502/504 with a normal JSON job body when a CLI run fails,
 * so the body is always read before deciding what happened.
 */
async function request(path, { method = 'GET', body, timeoutMs = 15_000 } = {}) {
  if (!isConfigured()) throw new AgentError('fatal', 'NODE_AGENT_URL is not set in backend/.env');
  const url = `${env.nodeAgent.url}${path}`;

  let response;
  try {
    response = await httpRequest(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...authHeaders(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs,
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new AgentError('transient', `node-agent did not respond within ${timeoutMs}ms`, { cause: err });
    throw new AgentError('transient', `node-agent unreachable at ${env.nodeAgent.url} (${describe(err)})`, { cause: err });
  }

  const text = response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text.slice(0, 300) };
  }
  const reason = payload?.error || payload?.message;

  if (response.status === 401) {
    throw new AgentError(
      'auth',
      env.nodeAgent.token
        ? `node-agent rejected NODE_AGENT_TOKEN (revoked, expired or mistyped): ${reason ?? ''}`.trim()
        : 'node-agent needs an API token: create one in the node-agent console (Tokens) and set NODE_AGENT_TOKEN in backend/.env'
    );
  }
  if (response.status === 403) throw new AgentError('fatal', reason ?? 'This token may not use that CLI');
  if (response.status === 429) throw new AgentError('rate_limit', reason ?? 'node-agent quota or limit reached');
  if (response.status === 503) {
    throw new AgentError('rate_limit', reason ?? 'No node-agent account is available right now', {
      retryAfter: Number(response.headers['retry-after']) || undefined,
    });
  }
  if (response.status === 400) throw new AgentError('fatal', `node-agent rejected the request: ${reason ?? 'bad request'}`);
  if (response.status >= 500 && !payload?.status) throw new AgentError('transient', `node-agent HTTP ${response.status}: ${reason ?? ''}`.trim());

  return { status: response.status, payload };
}

/** GET /api/clis — the CLIs this token may use, plus limits. Doubles as a token check. */
export async function listClis() {
  const { payload } = await request('/api/clis');
  return payload;
}

/** GET /api/models/:cli — { cli, models: [{ id, label, description }], warning }. Can take ~30 s the first time. */
export async function listModels(cli) {
  const { payload } = await request(`/api/models/${encodeURIComponent(cli)}`, { timeoutMs: 45_000 });
  return payload;
}

/** Reachability + token check for the admin status panel. Never throws. */
export async function ping() {
  const started = Date.now();
  if (!isConfigured()) return { configured: false, reachable: false, message: 'NODE_AGENT_URL is not set' };
  try {
    const clis = await listClis();
    return { configured: true, reachable: true, tokenOk: true, latencyMs: Date.now() - started, clis: clis.clis ?? [], defaults: clis.defaults ?? null };
  } catch (err) {
    return {
      configured: true,
      reachable: err.kind !== 'transient',
      tokenOk: err.kind !== 'auth',
      latencyMs: Date.now() - started,
      message: err.message,
    };
  }
}

const POLL_INTERVAL_MS = 2_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertSucceeded(job, status) {
  if (job?.status === 'succeeded') return job;
  const message = String(job?.error || job?.output || `job ${job?.status ?? status}`).slice(0, 500);
  if (/usage limit|rate limit|try again in|429/i.test(message)) throw new AgentError('rate_limit', `node-agent CLI: ${message}`);
  if (/not logged in|unauthori[sz]ed|401|token expired/i.test(message)) throw new AgentError('auth', `node-agent CLI is signed out: ${message}`);
  throw new AgentError('transient', `node-agent CLI ${job?.status === 'timed_out' ? 'timed out' : 'failed'}: ${message}`);
}

function jobBody({ type, prompt, context, cli, model }) {
  const runCli = cli || env.nodeAgent.cli;
  return {
    cli: runCli,
    // NODE_AGENT_MODEL belongs to NODE_AGENT_CLI; another CLI gets its own default.
    model: model || (runCli === env.nodeAgent.cli ? env.nodeAgent.model : 'default'),
    type,
    prompt,
    ...(context ? { context } : {}),
    async: true,
  };
}

/**
 * Runs one text prompt and returns the finished job ({ output, ... }).
 * Uses async + polling because a CLI run can take minutes.
 */
export const generateText = ({ prompt, context, cli, model }) =>
  runJob(jobBody({ type: 'text', prompt, context, cli, model }), env.nodeAgent.timeoutMs);

const IMAGE_RE = /\.(png|jpe?g|webp)(\?|$)/i;

/**
 * Generates one image and returns { url, job }: the URL node-agent serves it at
 * (fetch it with download(), it needs the token). Image runs take minutes.
 */
export async function generateImage({ prompt, context, cli, model }) {
  const job = await runJob(jobBody({ type: 'image', prompt, context, cli, model }), Math.max(env.nodeAgent.timeoutMs, 600_000));
  const url = job.imageUrl || job.files?.find((f) => IMAGE_RE.test(f.name || f.url || ''))?.url;
  if (!url) throw new AgentError('transient', `node-agent produced no image${job.output ? `: ${String(job.output).slice(0, 160)}` : ''}`);
  return { url: onAgentHost(url), job };
}

/**
 * node-agent builds output URLs from its own BASE_URL, which may be
 * http://localhost:6000 on that machine. Re-point /outputs/... at NODE_AGENT_URL.
 */
function onAgentHost(url) {
  const index = url.indexOf('/outputs/');
  return index === -1 ? url : `${env.nodeAgent.url}${url.slice(index)}`;
}

/** Downloads a file node-agent produced (served from its /outputs). */
export async function download(fileUrl, { maxBytes = 15 * 1024 * 1024 } = {}) {
  let response;
  try {
    response = await httpRequest(fileUrl, { headers: authHeaders(), timeoutMs: 60_000 });
  } catch (err) {
    throw new AgentError('transient', `Could not download node-agent output (${describe(err)})`, { cause: err });
  }
  if (!response.ok) throw new AgentError('transient', `node-agent output returned HTTP ${response.status}`);
  if (response.buffer.length > maxBytes) throw new AgentError('fatal', 'node-agent output is too large');
  const mimeType = String(response.headers['content-type'] ?? '').split(';')[0] || 'image/png';
  return { buffer: response.buffer, mimeType };
}

async function runJob(body, timeoutMs) {
  const { status, payload } = await request('/api/generate', { method: 'POST', body, timeoutMs: 30_000 });
  if (status !== 202 || !payload.jobId) return assertSucceeded(payload, status);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    const polled = await request(`/api/jobs/${encodeURIComponent(payload.jobId)}`);
    // Jobs live in node-agent's memory; a restart forgets them.
    if (polled.status === 404) throw new AgentError('transient', `node-agent no longer knows job ${payload.jobId} (restarted?)`);
    const job = polled.payload;
    if (job?.finishedAt || ['succeeded', 'failed', 'timed_out'].includes(job?.status)) return assertSucceeded(job, polled.status);
    if (Date.now() > deadline) throw new AgentError('transient', `node-agent job ${payload.jobId} did not finish in time`);
  }
}
