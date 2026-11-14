import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openStore } from '../server/store/db.js';
import * as market from '../server/market/demo.js';
import { makeCase } from '../server/engine/case.js';

let server, base, store;
before(async () => {
  store = openStore(':memory:');
  server = createApp({ store, market }).listen(0);
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
  assert.equal((await get('/api/market/chart/TOOLONG1')).status, 400);
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
  assert.deepEqual({ ...r.body, id: undefined, createdAt: undefined }, { ...makeCase('Should we buy HLXN?', 'investor'), id: undefined, createdAt: undefined });
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

test('serves the frontend', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>Boiler Room<\/title>/);
});
