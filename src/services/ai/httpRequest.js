import http from 'node:http';
import https from 'node:https';

/**
 * Minimal HTTP client on node:http, used for node-agent (copied from smash).
 *
 * Node's global fetch (undici) enforces the WHATWG "bad ports" list and refuses
 * to connect to ports such as 6000 (X11), 6665-6669 and 10080 with a bare
 * "fetch failed". A local agent can legitimately run on any of them, so this
 * talks to it without that restriction.
 *
 * Resolves with { status, headers, buffer, text() } for every HTTP status;
 * rejects only on transport failure. Timeouts reject with name 'TimeoutError'.
 */
export function httpRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 30000, signal } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(Object.assign(new Error(`Invalid URL: ${url}`), { code: 'ERR_INVALID_URL' }));
      return;
    }

    const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const transport = target.protocol === 'https:' ? https : http;

    const req = transport.request(
      target,
      {
        method,
        headers: {
          ...headers,
          ...(payload ? { 'Content-Length': payload.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', finishWithError);
        res.on('end', () => {
          cleanup();
          const buffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            headers: res.headers,
            buffer,
            text: () => buffer.toString('utf8'),
          });
        });
      }
    );

    const timer = setTimeout(() => {
      req.destroy(Object.assign(new Error(`Timed out after ${timeoutMs}ms`), { name: 'TimeoutError' }));
    }, timeoutMs);

    const onAbort = () => req.destroy(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }

    function finishWithError(err) {
      cleanup();
      reject(err);
    }

    req.on('error', finishWithError);
    if (payload) req.write(payload);
    req.end();
  });
}
