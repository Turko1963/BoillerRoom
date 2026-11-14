// Small HTTP helper for the data sources: timeout, JSON, and an in-memory
// cache so a burst of rounds does not hammer the free APIs.

const cache = new Map();

export class SourceError extends Error {
  constructor(source, message, status) { super(`${source}: ${message}`); this.source = source; this.status = status; }
}

/**
 * GET a URL and parse JSON.
 * opts: { source, headers, ttl (ms, 0 = no cache), timeout (ms) }
 */
export async function getJSON(url, { source = 'http', headers = {}, ttl = 0, timeout = 12000 } = {}) {
  const key = ttl ? url : null;
  if (key) {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.val;
  }
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw new SourceError(source, e.name === 'TimeoutError' ? 'timed out' : (e.cause?.code || e.message));
  }
  if (!res.ok) throw new SourceError(source, `HTTP ${res.status}`, res.status);
  const val = await res.json();
  if (key) {
    cache.set(key, { val, exp: Date.now() + ttl });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
  }
  return val;
}

/** Cache any async function result for ttl ms. */
export function memo(fn, ttl) {
  const m = new Map();
  return async (...args) => {
    const k = JSON.stringify(args), hit = m.get(k);
    if (hit && hit.exp > Date.now()) return hit.val;
    const val = await fn(...args);
    m.set(k, { val, exp: Date.now() + ttl });
    return val;
  };
}

export const clearCache = () => cache.clear();

/**
 * Circuit breaker for optional sources: when a call fails with a block (401, 402, 403, 429), skip the source for
 * `pause` ms and return null, so a blocked feed costs nothing on the next rounds. Other failures return null once.
 */
export function breaker(label, fn, pause = 6 * 3600e3) {
  let until = 0;
  return async (...args) => {
    if (Date.now() < until) return null;
    try { return await fn(...args); } catch (e) {
      if ([401, 402, 403, 429].includes(e.status)) { until = Date.now() + (e.status === 429 ? 60e3 : pause); console.warn(`[${label}] blocked (HTTP ${e.status}), paused`); }
      else console.warn(`[${label}] ${e.message}`);
      return null;
    }
  };
}

/** Wait at most ms for a promise; past that return null (the call keeps running and fills its cache for next time). */
export const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => setTimeout(r, ms, null).unref?.())]);
