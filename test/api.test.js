import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openStore } from '../server/store/db.js';
import * as market from '../server/market/demo.js';
import { makeCase } from '../server/engine/case.js';

let server, base, store;
before(async () => {
  store = openStore(':memory:');
  server = createApp({ store, market, openRoom: true }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); store.close(); });

const get = p => fetch(base + p).then(async r => ({ status: r.status, body: await r.json() }));
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
  .then(async r => ({ status: r.status, body: await r.json() }));

test('engine is deterministic per brief and mode', () => {
  assert.deepEqual(makeCase('Should we buy HLXN?', 'trader'), makeCase('Should we buy HLXN?', 'trader'));
  assert.notDeepEqual(makeCase('Should we buy HLXN?', 'trader'), makeCase('Should we buy HLXN?', 'investor'));
});

test('engine output has everything the frontend animates', () => {
  const c = makeCase('Is VRDA a short into earnings?', 'trader');
  for (const id of ['analyst', 'filings', 'fundamental', 'risk', 'dealer', 'ma', 'technical']) {
    assert.ok(['bull', 'bear', 'neutral'].includes(c.R[id].stance), id);
    assert.equal(c.R[id].findings.length, 3);
    assert.ok(['int', 'pct', 'pct1', 'usd', 'bps'].includes(c.M[id].fmt), id);
  }
  assert.ok(['Buy', 'Short', 'Hold'].includes(c.call));
  assert.ok(c.debate.length >= 4);
  assert.equal(c.tally.bull + c.tally.bear + c.tally.neutral, 7);
  assert.equal(c.ticket === null, c.call === 'Hold');
});

test('health, movers and chart', async () => {
  assert.equal((await get('/api/health')).body.ok, true);
  const m = await get('/api/market/movers');
  assert.equal(m.body.movers.length, 16);
  const ch = await get('/api/market/chart/hlxn');
  assert.equal(ch.status, 200);
  assert.equal(ch.body.candles.length, 56);
  assert.equal(ch.body.name, 'Helixon Semiconductors');
  assert.equal((await get('/api/market/chart/TOO_LONG_TICKER')).status, 400);
});

test('round validation', async () => {
  assert.equal((await post('/api/rounds', {})).status, 400);
  assert.equal((await post('/api/rounds', { brief: '   ' })).status, 400);
  assert.equal((await post('/api/rounds', { brief: 'x'.repeat(301) })).status, 400);
  assert.equal((await post('/api/rounds', { brief: 'Buy HLXN?', mode: 'yolo' })).status, 400);
  const bad = await fetch(base + '/api/rounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400);
  assert.equal((await get('/api/nope')).status, 404);
});

test('round is saved, listed and fetched', async () => {
  const r = await post('/api/rounds', { brief: 'Should we buy HLXN?', mode: 'investor' });
  assert.equal(r.status, 201);
  assert.ok(r.body.id);
  // the round is the demo case unchanged, plus its trade plan
  assert.ok(r.body.tradePlan);
  // plus the conviction's calibration band as known when it was saved
  assert.equal(r.body.vote.calibration.hitRate, null); // nothing graded yet: not enough data
  const body = { ...r.body, vote: { ...r.body.vote, calibration: undefined } }, demo = makeCase('Should we buy HLXN?', 'investor');
  assert.deepEqual({ ...body, id: undefined, createdAt: undefined, tradePlan: undefined, lang: undefined }, { ...demo, vote: { ...demo.vote, calibration: undefined }, assetClass: 'demo', id: undefined, createdAt: undefined, tradePlan: undefined, lang: undefined });
  const one = await get('/api/rounds/' + r.body.id);
  assert.equal(one.body.call, r.body.call);
  assert.equal(one.body.order, null);
  assert.ok((await get('/api/rounds')).body.rounds.some(x => x.id === r.body.id));
  assert.equal((await get('/api/rounds/missing')).status, 404);
});

test('execute fills a ticket once; hold rounds cannot be executed', async () => {
  let withTicket, hold;
  for (let i = 0; i < 200 && !(withTicket && hold); i++) {
    const c = makeCase(`Brief ${i} on HLXN?`, 'trader');
    if (c.ticket && !withTicket) withTicket = `Brief ${i} on HLXN?`;
    if (!c.ticket && !hold) hold = `Brief ${i} on HLXN?`;
  }
  const r = (await post('/api/rounds', { brief: withTicket })).body;
  const ex = await post(`/api/rounds/${r.id}/execute`, {});
  assert.equal(ex.status, 201);
  assert.equal(ex.body.fills.length, r.slices);
  assert.equal(ex.body.side, r.call === 'Buy' ? 'buy' : 'short');
  assert.ok(Math.abs(ex.body.avgPrice / r.p - 1) < 0.05);
  const again = await post(`/api/rounds/${r.id}/execute`, {});
  assert.equal(again.status, 409);
  assert.equal(again.body.order.id, ex.body.id);
  assert.ok((await get('/api/orders')).body.orders.some(o => o.id === ex.body.id));

  const h = (await post('/api/rounds', { brief: hold })).body;
  assert.equal((await post(`/api/rounds/${h.id}/execute`, {})).status, 409);
});

test('serves the gate at / and the room at /room', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>BackStage Capital<\/title>/);
  const room = await fetch(base + '/room');
  assert.equal(room.status, 200);
  assert.match(room.headers.get('cache-control'), /no-store/);
  assert.match(await room.text(), /<title>Boiler Room \| BackStage Capital<\/title>/);
});

test('ACCESS_PASSWORD protects the page and the API', async () => {
  const s = openStore(':memory:'), srv = createApp({ store: s, market, password: 'open sesame', openRoom: true }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}`, auth = p => ({ Authorization: 'Basic ' + Buffer.from('any:' + p).toString('base64') });
  try {
    const none = await fetch(url + '/');
    assert.equal(none.status, 401);
    assert.match(none.headers.get('www-authenticate'), /Basic/);
    assert.equal((await fetch(url + '/api/health', { headers: auth('wrong') })).status, 401);
    assert.equal((await fetch(url + '/api/health', { headers: auth('open sesame') })).status, 200);
    assert.equal((await fetch(url + '/', { headers: auth('open sesame') })).status, 200);
  } finally { srv.close(); s.close(); }
});

test('health reports the running version', async () => {
  const v = (await get('/api/health')).body.version;
  assert.match(v.commit, /^([0-9a-f]{7,}|unknown)$/);
});

test('GET /api/market/performance: periods for the asset (demo prices), validation', async () => {
  const r = await get('/api/market/performance/HLXN');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.periods.map(p => p.id), ['1d', '1w', 'mtd', '1m', '3m', '6m', 'ytd', '1y', '2y', '3y', '5y', 'all']);
  assert.ok(typeof r.body.periods[0].pct === 'number');
  assert.ok(r.body.high52 >= r.body.price && r.body.low52 <= r.body.price);
  assert.equal((await get('/api/market/performance/BAD!')).status, 400);
  assert.equal((await get('/api/market/performance/HLXN?assetClass=bond')).status, 400);
});
