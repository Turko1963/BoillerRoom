// Volatility watch: the five checks, the 3-of-5 rule, and the API (the key keeps working after logout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../server/engine/volwatch.js';
import { createApp } from '../server/app.js';
import { openStore } from '../server/store/db.js';
import * as market from '../server/market/demo.js';

test('instrument: oil is the default; aliases, coins and stocks', () => {
  assert.equal(V.instrument().id, 'OIL');
  assert.equal(V.instrument('cl=f').y, 'CL=F');
  assert.equal(V.instrument('ukoil').id, 'BRENT');
  assert.equal(V.instrument('BTC').kind, 'crypto');
  assert.equal(V.instrument('NVDA').fear, '^VIX');
});

test('the five checks', () => {
  // 1. fear: OVX above 45, or +20% in 5 days
  assert.equal(V.fearCheck([30, 31, 30, 32, 31, 49.6], '^OVX', 'OVX').met, true);
  assert.equal(V.fearCheck([30, 30, 30, 30, 30, 37], '^OVX', 'OVX').met, true, '+23% in 5 days');
  assert.equal(V.fearCheck([30, 30, 30, 30, 30, 31], '^OVX', 'OVX').met, false);
  assert.equal(V.fearCheck(null, '^OVX', 'OVX').available, false);
  // 2. curve: front minus next in % of the front, moved a point in 5 days or flipped
  const day = i => ({ t: Date.UTC(2026, 10, 2 + i) });
  const front = [85, 85, 85, 85, 85, 85].map((c, i) => ({ ...day(i), c })), calm = front.map(k => ({ ...k, c: 84 }));
  assert.equal(V.curveCheck(front, calm).met, false);
  const wide = front.map((k, i) => ({ ...k, c: i < 5 ? 84 : 82.5 }));
  assert.equal(V.curveCheck(front, wide).met, true);
  const flip = front.map((k, i) => ({ ...k, c: i < 5 ? 84.5 : 85.6 }));
  assert.match(V.curveCheck(front, flip).text, /flipped/);
  assert.deepEqual(V.contracts('CL', 'NYM', Date.UTC(2026, 10, 16)), ['CLZ26.NYM', 'CLF27.NYM', 'CLG27.NYM', 'CLH27.NYM']);
  const quiet = Array.from({ length: 70 }, (_, i) => 100 + Math.sin(i) * .3), wild = [...quiet.slice(0, 65), 104, 97, 105, 96, 103];
  assert.equal(V.breakoutCheck(quiet).met, false);
  assert.equal(V.breakoutCheck(wild).met, true);
  // 3. events: EIA on Wednesday 10:30 New York, Fed days
  const tue = Date.UTC(2026, 10, 17, 20); // Tue Nov 17 2026, 15:00 New York
  const ev = V.upcomingEvents('oil', tue);
  assert.ok(ev.some(e => e.name === 'EIA weekly oil inventories' && e.at === Date.UTC(2026, 10, 18, 15, 30)), 'Wed 10:30 EST = 15:30 UTC');
  assert.equal(V.eventsCheck(ev, tue).met, true);
  assert.equal(V.nyTime('2026-07-01', 10, 30), Date.UTC(2026, 6, 1, 14, 30), 'summer time');
  assert.ok(V.upcomingEvents('macro', Date.UTC(2026, 11, 8, 20)).some(e => e.name === 'Fed rate decision'));
  assert.equal(V.eventsCheck(V.upcomingEvents('macro', Date.UTC(2026, 10, 20, 12)), Date.UTC(2026, 10, 20, 12)).met, false);
  // 4. crowding: hedge funds' net position in the top or bottom 10% of 3 years
  const rows = Array.from({ length: 150 }, (_, i) => ({ date: '2026-11-10', long: 100000 + i * 10, short: 100000 }));
  assert.equal(V.cotCheck([{ ...rows[0], long: 300000 }, ...rows.slice(1)]).met, true);
  assert.equal(V.cotCheck([{ ...rows[0], long: 100700 }, ...rows.slice(1)]).met, false);
  assert.equal(V.crowdCheck(76).met, true);
  // 5. news: three escalation headlines in 2 days
  assert.equal(V.newsCheck([{ title: 'Oil tankers burning in Hormuz' }, { title: 'New sanctions on Iran oil' }, { title: 'Drone strike hits refinery' }, { title: 'Oil steady' }]).met, true);
  assert.equal(V.newsCheck([{ title: 'Oil steady ahead of data' }]).met, false);
  // three of five = alert
  assert.equal(V.verdict([{ met: true }, { met: true }, { met: true }, { met: false }, { met: false }]).level, 'alert');
  assert.equal(V.verdict([{ met: true }, { met: true }, { met: false }, { met: false }, { met: false }]).level, 'watch');
});

test('createWatch puts it together from (fake) sources, and caches', async () => {
  let calls = 0;
  const k = (n, c0, step = 0) => Array.from({ length: n }, (_, i) => ({ t: Date.now() - (n - 1 - i) * 864e5, c: c0 + i * step }));
  const yahoo = {
    chart: async s => { calls++; if (s === '^OVX') return { candles: k(21, 40, .5) }; if (/^CL[A-Z]\d\d\.NYM$/.test(s)) return { candles: k(21, s.startsWith('CLZ') ? 85 : 84) }; return { price: 85, candles: k(120, 80, .05) }; },
    summary: async () => null
  };
  const news = { search: async q => (/OPEC\+ meeting/.test(q) ? [] : [{ title: 'Oil tankers burning in Hormuz' }, { title: 'Missile strike near Gulf terminal' }, { title: 'US adds sanctions on Iran crude' }]) };
  const w = V.createWatch({ yahoo, derivs: {}, cftc: { positions: async () => null }, news, now: () => Date.UTC(2026, 10, 18, 12) });
  const s = await w.check('OIL');
  assert.equal(s.symbol, 'OIL');
  assert.deepEqual(s.checks.map(c => c.id), ['fear', 'curve', 'events', 'crowding', 'news']);
  assert.equal(s.checks[0].met, true, 'OVX 50');
  assert.equal(s.checks[2].met, true, 'EIA in a few hours');
  assert.equal(s.checks[4].met, true);
  assert.equal(s.level, 'alert');
  const before = calls;
  await w.check('wti');
  assert.equal(calls, before, 'cached for 5 minutes');
});

test('API: start a watch with a session, read it with the key alone (after logout), stop it', async () => {
  const store = openStore(':memory:');
  const fake = { check: async sym => ({ symbol: sym, name: 'WTI crude oil', level: 'alert', met: 3, of: 5, checks: [], checkedAt: new Date().toISOString() }) };
  const server = createApp({ store, market, code: '123456', watch: fake }).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'members only');
    const u = await fetch(base + '/api/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '123456' }) });
    const cookie = u.headers.get('set-cookie').split(';')[0];
    const bad = await fetch(base + '/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ symbol: 'OIL; DROP' }) });
    assert.equal(bad.status, 400);
    const r = await fetch(base + '/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ symbol: 'oil' }) });
    assert.equal(r.status, 201);
    const j = await r.json();
    assert.equal(j.symbol, 'OIL');
    assert.equal(j.status.level, 'alert');
    await fetch(base + '/api/logout', { method: 'POST', headers: { Cookie: cookie } });
    const g = await fetch(base + '/api/watch/' + j.token);
    assert.equal(g.status, 200, 'the key works without a session');
    assert.equal((await g.json()).symbol, 'OIL');
    assert.equal((await fetch(base + '/api/rounds')).status, 401, 'the key opens nothing else');
    assert.equal((await fetch(base + '/api/watch/short')).status, 400);
    assert.equal((await (await fetch(base + '/api/watch/' + j.token, { method: 'DELETE' })).json()).ok, true);
    assert.equal((await fetch(base + '/api/watch/' + j.token)).status, 404);
  } finally { server.close(); store.close(); }
});
