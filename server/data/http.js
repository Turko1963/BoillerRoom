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
