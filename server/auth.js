// Members' gate: a six digit code, checked on the server, opens a session.
//
//   POST /api/unlock  {code}  -> 200 + session cookie | 401 wrong | 429 too many | 503 not configured
//   GET  /api/session         -> 200 | 401
//   POST /api/logout          -> clears the session and the cookie
//
// Two kinds of code, on the same six-digit screen:
//   the shared code (ACCESS_CODE)   opens the room as a viewer: everything except sending orders to a broker
//   a member's own code             opens it as that member, with a role: 'trader' can send orders, 'admin' also
// Member codes are stored only as a salted scrypt hash (scripts/members.mjs adds members and shows the code once).
// Sessions are random tokens; the database stores only their SHA-256, so a leaked database opens nothing.
// Failed attempts are limited to 5 per 15 minutes per IP, and every attempt is logged.
import { randomBytes, createHash, timingSafeEqual, scryptSync } from 'node:crypto';

export const ROLES = ['viewer', 'trader', 'admin'];
/** Salted hash of a member code (the same function checks it). */
export const hashCode = (code, salt) => scryptSync('bsc-member:' + code, Buffer.from(salt, 'hex'), 32).toString('hex');

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
  const shared = /^\d{6}$/.test(code || '');
  const members = () => store.activeMembers?.() || [];
  let configured = shared || members().length > 0;
  if (!configured) log(`[auth] ACCESS_CODE is ${code ? 'not six digits' : 'not set'} and there are no members: the room stays locked until one is set`);

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

  /** The session behind this request, or null. Adds who it is: { member: {id, name, role} | null, role }. */
  function session(req) {
    const token = readCookie(req, COOKIE);
    if (!token || token.length > 100) return null;
    const s = store.getSession(shaHex(token), now());
    if (!s) return null;
    return { ...s, member: s.member_id ? { id: s.member_id, name: s.member_name, role: s.member_role } : null, role: s.member_id ? s.member_role : 'viewer' };
  }
  /** Which member a code belongs to (scrypt with each member's salt; a handful of members, so a scan is fine). */
  function memberFor(given) {
    let hit = null;
    for (const m of members()) { const h = Buffer.from(hashCode(given, m.salt), 'hex'); if (timingSafeEqual(h, Buffer.from(m.code_hash, 'hex')) && !hit) hit = m; }
    return hit;
  }

  function unlock(req, res) {
    const ip = req.ip || 'unknown';
    configured = shared || members().length > 0;
    if (!configured) { record(ip, 'not-configured'); return res.status(503).json({ error: 'The members code is not set up on the server' }); }
    if (recentFails(ip).length >= MAX_FAILS) { record(ip, 'blocked'); res.set('Retry-After', String(WINDOW_MS / 1000)); return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes' }); }
    const given = typeof req.body?.code === 'string' ? req.body.code : '';
    // compare fixed-length digests so the time taken says nothing about the code
    const isShared = shared && timingSafeEqual(sha('bsc:' + given), sha('bsc:' + code)) && /^\d{6}$/.test(given);
    const member = !isShared && /^\d{6}$/.test(given) ? memberFor(given) : null;
    if (!isShared && !member) {
      fails.set(ip, [...recentFails(ip), now()]);
      record(ip, 'wrong');
      return res.status(401).json({ error: 'Not on the list' });
    }
    fails.delete(ip);
    const token = randomBytes(32).toString('base64url'), t = now();
    store.pruneSessions(t);
    store.addSession(shaHex(token), t, t + SESSION_MS, ip, member?.id ?? null);
    record(ip, member ? `ok (${member.name})` : 'ok');
    res.set('Set-Cookie', cookie(token, SESSION_MS / 1000)).json({ ok: true });
  }

  function logout(req, res) {
    const token = readCookie(req, COOKIE);
    if (token) store.dropSession(shaHex(token));
    res.set('Set-Cookie', cookie('', 0)).json({ ok: true });
  }

  /** For /room: no session, back to the intro. */
  // A code opens the room for one page load. Reloading the room (or opening it in another tab)
  // ends the session, so every refresh goes back through the intro and the code.
  const pageGuard = (req, res, next) => {
    const s = session(req);
    if (s && store.markRoomOpened(s.token_hash)) return next();
    if (s) store.dropSession(s.token_hash);
    res.set('Set-Cookie', cookie('', 0)).redirect(302, '/');
  };
  /** For /api/*: no session, 401. */
  const apiGuard = (req, res, next) => { const s = session(req); if (!s) return res.status(401).json({ error: 'Sign in first' }); req.who = s; next(); };
  /** Routes that need a role (sending orders: trader or admin). Use after apiGuard. */
  const requireRole = (...roles) => (req, res, next) => {
    const s = req.who || session(req);
    if (!s) return res.status(401).json({ error: 'Sign in first' });
    if (!roles.includes(s.role)) return res.status(403).json({ error: s.role === 'viewer' ? 'Sign in with your own code to trade (the shared code can only watch)' : 'Your role cannot do this' });
    req.who = s; next();
  };

  return { session, unlock, logout, pageGuard, apiGuard, requireRole, get configured() { return configured; } };
}
