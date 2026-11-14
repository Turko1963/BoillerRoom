// Members' gate: a six digit code, checked on the server, opens a session.
//
//   POST /api/unlock  {code}  -> 200 + session cookie | 401 wrong | 429 too many | 503 not configured
//   GET  /api/session         -> 200 | 401
//   POST /api/logout          -> clears the session and the cookie
//
// The code lives only in the ACCESS_CODE environment variable. Sessions are random
// tokens; the database stores only their SHA-256, so a leaked database opens nothing.
// Failed attempts are limited to 5 per 15 minutes per IP, and every attempt is logged.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'bsc_session';
const SESSION_MS = 12 * 3600e3;
const WINDOW_MS = 15 * 60e3;
const MAX_FAILS = 5;

const sha = s => createHash('sha256').update(String(s)).digest();
const shaHex = s => createHash('sha256').update(String(s)).digest('hex');

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function createAuth({ store, code = process.env.ACCESS_CODE, now = () => Date.now(), log = console.log }) {
  const fails = new Map(); // ip -> timestamps of failed attempts in the window
  const configured = /^\d{6}$/.test(code || '');
  if (!configured) log(`[auth] ACCESS_CODE is ${code ? 'not six digits' : 'not set'}: the room stays locked until it is set`);

  const recentFails = ip => {
    const t = now(), a = (fails.get(ip) || []).filter(x => t - x < WINDOW_MS);
    a.length ? fails.set(ip, a) : fails.delete(ip);
    return a;
  };
  const record = (ip, result) => {
    store.logAttempt(now(), ip, result);
    log(`[auth] ${new Date(now()).toISOString()} unlock ${result} from ${ip}`);
  };
  const cookie = (token, maxAge) =>
    `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

  /** The session behind this request, or null. */
  function session(req) {
    const token = readCookie(req, COOKIE);
    if (!token || token.length > 100) return null;
    return store.getSession(shaHex(token), now()) || null;
  }

  function unlock(req, res) {
    const ip = req.ip || 'unknown';
    if (!configured) { record(ip, 'not-configured'); return res.status(503).json({ error: 'The members code is not set up on the server' }); }
    if (recentFails(ip).length >= MAX_FAILS) { record(ip, 'blocked'); res.set('Retry-After', String(WINDOW_MS / 1000)); return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes' }); }
    const given = typeof req.body?.code === 'string' ? req.body.code : '';
    // compare fixed-length digests so the time taken says nothing about the code
    const ok = timingSafeEqual(sha('bsc:' + given), sha('bsc:' + code)) && /^\d{6}$/.test(given);
    if (!ok) {
      fails.set(ip, [...recentFails(ip), now()]);
      record(ip, 'wrong');
      return res.status(401).json({ error: 'Not on the list' });
    }
    fails.delete(ip);
    const token = randomBytes(32).toString('base64url'), t = now();
    store.pruneSessions(t);
    store.addSession(shaHex(token), t, t + SESSION_MS, ip);
    record(ip, 'ok');
    res.set('Set-Cookie', cookie(token, SESSION_MS / 1000)).json({ ok: true });
  }

  function logout(req, res) {
    const token = readCookie(req, COOKIE);
    if (token) store.dropSession(shaHex(token));
    res.set('Set-Cookie', cookie('', 0)).json({ ok: true });
  }

  /** For /room: no session, back to the intro. */
  const pageGuard = (req, res, next) => (session(req) ? next() : res.redirect(302, '/'));
  /** For /api/*: no session, 401. */
  const apiGuard = (req, res, next) => (session(req) ? next() : res.status(401).json({ error: 'Sign in first' }));

  return { session, unlock, logout, pageGuard, apiGuard, configured };
}
