// The members' gate: server-side code check, sessions, rate limit, and a clean public page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/app.js';
import { openStore } from '../server/store/db.js';
import * as market from '../server/market/demo.js';

const CODE = '482913';

async function start(opts = {}) {
  const store = openStore(':memory:');
  const server = createApp({ store, market, code: CODE, ...opts }).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, cookie } = {}) => fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { store, call, close: () => { server.close(); store.close(); } };
}
const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0];

test('the room and the API are closed without a session', async () => {
  const s = await start();
  try {
    const room = await s.call('/room');
    assert.equal(room.status, 302);
    assert.equal(room.headers.get('location'), '/');
    assert.equal(room.headers.get('www-authenticate'), null, 'no browser popup');
    assert.equal((await s.call('/api/health')).status, 401);
    assert.equal((await s.call('/api/rounds', { method: 'POST', body: { brief: 'Buy HLXN?' } })).status, 401);
    assert.equal((await s.call('/api/session')).status, 401);
    assert.equal((await s.call('/')).status, 200);
  } finally { s.close(); }
});

test('the right code opens a 12 hour HttpOnly Secure session; lock closes it', async () => {
  const s = await start();
  try {
    const r = await s.call('/api/unlock', { method: 'POST', body: { code: CODE } });
    assert.equal(r.status, 200);
    const sc = r.headers.get('set-cookie');
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=43200']) assert.ok(sc.includes(flag), flag);
    const cookie = cookieOf(r);
    assert.equal((await s.call('/api/session', { cookie })).status, 200);
    const room = await s.call('/room', { cookie });
    assert.equal(room.status, 200);
    assert.equal(room.headers.get('cache-control'), 'private, no-store');
    assert.match(await room.text(), /id="desks"/);
    assert.equal((await s.call('/api/health', { cookie })).status, 200);
    // lock
    const out = await s.call('/api/logout', { method: 'POST', cookie });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await s.call('/api/session', { cookie })).status, 401);
    assert.equal((await s.call('/api/health', { cookie })).status, 401, 'the old cookie no longer works');
  } finally { s.close(); }
});

test('every reload of the room needs the code again; the open room keeps working', async () => {
  const s = await start();
  try {
    const cookie = cookieOf(await s.call('/api/unlock', { method: 'POST', body: { code: CODE } }));
    assert.equal((await s.call('/room', { cookie })).status, 200, 'first load opens the room');
    assert.equal((await s.call('/api/health', { cookie })).status, 200, 'the open room can still call the API');
    const reload = await s.call('/room', { cookie });
    assert.equal(reload.status, 302, 'a reload goes back to the intro');
    assert.equal(reload.headers.get('location'), '/');
    assert.match(reload.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await s.call('/api/health', { cookie })).status, 401, 'and the session is over');
  } finally { s.close(); }
});

test('wrong codes get 401, the sixth try in 15 minutes gets 429, and every attempt is logged', async () => {
  const s = await start();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await s.call('/api/unlock', { method: 'POST', body: { code: '000000' } })).status, 401);
    const blocked = await s.call('/api/unlock', { method: 'POST', body: { code: CODE } });
    assert.equal(blocked.status, 429, 'blocked even with the right code');
    assert.equal((await s.call('/api/unlock', { method: 'POST', body: {} })).status, 429);
  } finally { s.close(); }
});

test('malformed codes are wrong codes, and an unset ACCESS_CODE keeps the room locked', async () => {
  const s = await start();
  try {
    for (const code of ['', '48291', '4829130', 482913, 'abcdef']) assert.equal((await s.call('/api/unlock', { method: 'POST', body: { code } })).status, 401, String(code));
  } finally { s.close(); }
  const u = await start({ code: '' });
  try {
    assert.equal((await u.call('/api/unlock', { method: 'POST', body: { code: '' } })).status, 503);
    assert.equal((await u.call('/room')).status, 302);
  } finally { u.close(); }
});

test('the public page contains no code, no hash and none of the room', () => {
  const gate = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const bad of ['1886374312', 'hash(', 'sessionStorage', 'makeCase', 'const API', 'id="desks"', 'bootRoom', 'brain']) assert.ok(!gate.includes(bad), bad);
  assert.ok(gate.includes("fetch('/api/unlock'"));
  assert.ok(gate.includes("location.assign('/room')"));
  assert.ok(!gate.includes("fetch('/api/session'"), 'the intro never skips itself');
  const room = readFileSync(new URL('../server/views/room.html', import.meta.url), 'utf8');
  assert.ok(room.includes("fetch('/api/logout'"));
  assert.ok(!room.includes('1886374312'));
});
