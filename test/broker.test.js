// The broker link: cTrader client over a fake WebSocket, the position plan, and the service on a fake broker.
// Nothing here touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, PT } from '../server/broker/ctrader.js';
import { createBroker, manageStep, nextAction, pickSymbol, sessionsSince, marketOpen } from '../server/broker/service.js';
import { openStore } from '../server/store/db.js';
import { createApp } from '../server/app.js';
import * as demo from '../server/market/demo.js';

process.env.CTRADER_CLIENT_SECRET ||= 'test-secret';

/* ---------- the WebSocket client ---------- */
class FakeWS {
  static last = null;
  constructor(url) { this.url = url; this.sent = []; FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(s) {
    const m = JSON.parse(s); this.sent.push(m);
    if (m.payloadType === PT.HEARTBEAT) return;
    const reply = FakeWS.answer(m);
    if (reply) setTimeout(() => this.onmessage?.({ data: JSON.stringify({ clientMsgId: m.clientMsgId, ...reply }) }), 0);
  }
  close() { this.onclose?.(); }
}

test('ctrader client: app auth, then account auth; answers matched by clientMsgId; errors reject', async () => {
  FakeWS.answer = m => (m.payloadType === PT.APP_AUTH_REQ ? { payloadType: PT.APP_AUTH_RES, payload: {} }
    : m.payloadType === PT.ACCOUNT_AUTH_REQ ? { payloadType: PT.ACCOUNT_AUTH_RES, payload: {} }
    : m.payloadType === PT.TRADER_REQ ? { payloadType: PT.ERROR_RES, payload: { errorCode: 'CH_ACCESS_TOKEN_INVALID', description: 'Invalid token' } } : null);
  const c = await connect({ accessToken: 'tok', accountId: 7, WS: FakeWS, url: 'wss://fake' });
  const sent = FakeWS.last.sent;
  assert.deepEqual(sent.map(m => m.payloadType), [PT.APP_AUTH_REQ, PT.ACCOUNT_AUTH_REQ]);
  assert.equal(sent[1].payload.ctidTraderAccountId, 7);
  assert.notEqual(sent[0].clientMsgId, sent[1].clientMsgId);
  await assert.rejects(c.req(PT.TRADER_REQ, {}), /Invalid token/);
  c.close();
  FakeWS.answer = m => (m.payloadType === PT.APP_AUTH_REQ ? { payloadType: PT.ERROR_RES, payload: { errorCode: 'CH_CLIENT_AUTH_FAILURE' } } : null);
  await assert.rejects(connect({ WS: FakeWS, url: 'wss://fake' }), /CH_CLIENT_AUTH_FAILURE/);
});

/* ---------- the plan (method C, B) ---------- */
const plan = (o = {}) => ({ method: 'C', side: 'buy', E: 100, R: 2, stop: 98, high: 100, partial: false, added: true, ...o });

test('method C: half off at +1.5R during the day; break-even, trailing and time stop at the end of the day', () => {
  assert.deepEqual(manageStep(plan(), 102.5).map(a => a.type), [], 'under +1.5R and not the daily step: nothing');
  assert.deepEqual(manageStep(plan(), 103.1).map(a => a.type), ['partial']);
  const be = manageStep(plan(), 102.2, { daily: true, sessions: 2 });
  assert.equal(be[0].type, 'stop'); assert.equal(be[0].stop, 100, 'break-even after +1R');
  const tr = manageStep(plan({ partial: true, stop: 100, high: 106 }), 105.5, { daily: true, sessions: 4 });
  assert.equal(tr.find(a => a.type === 'stop').stop, 104, 'trail 2 ATR (ATR = R/2 = 1) behind the best close 106');
  assert.equal(manageStep(plan(), 100.5, { daily: true, sessions: 10 }).at(-1).type, 'close', 'time stop: 10 sessions under +0.5R');
  assert.equal(manageStep(plan(), 101.5, { daily: true, sessions: 10 }).length, 0, 'over +0.5R: keep it');
  assert.match(manageStep(plan(), 101, { daily: true, earningsNext: true }).at(-1).why, /earnings/);
  assert.equal(manageStep(plan({ partial: true, stop: 103 }), 104, { daily: true, sessions: 30 }).at(-1).why, '30 sessions: maximum hold');
});

test('a short is the mirror image; method B asks before adding', () => {
  const s = plan({ side: 'sell', E: 100, stop: 102 });
  assert.deepEqual(manageStep(s, 96.9).map(a => a.type), ['partial']);
  assert.equal(manageStep(s, 97.8, { daily: true, sessions: 1 })[0].stop, 100);
  const b = manageStep(plan({ method: 'B', added: false }), 102.1, { daily: true, sessions: 2 });
  assert.deepEqual(b.map(a => a.type), ['addReady', 'stop']);
  assert.match(nextAction(plan({ method: 'B', added: false }), 100, 1), /needs your OK/);
  assert.match(nextAction(plan(), 100), /break-even at 102/);
  assert.match(nextAction(plan({ stop: 100 }), 102), /Take half at 103/);
});

test('symbols, sessions and market hours', () => {
  const list = [{ symbolId: 1, name: 'NVDAX' }, { symbolId: 2, name: 'NVDA.US' }, { symbolId: 3, name: 'AAPL.US' }, { symbolId: 4, name: 'Meta_Platforms', description: 'Meta Platforms Inc (META.O)' }];
  assert.equal(pickSymbol(list, 'NVDA').symbolId, 2);
  assert.equal(pickSymbol(list, 'META').symbolId, 4);
  assert.equal(pickSymbol(list, 'TSLA'), null);
  assert.equal(sessionsSince(Date.UTC(2026, 10, 13, 15), Date.UTC(2026, 10, 17, 15)), 2, 'Friday to Tuesday: two sessions');
  assert.equal(marketOpen(Date.UTC(2026, 10, 17, 15)), true, 'Tuesday 10:00 New York');
  assert.equal(marketOpen(Date.UTC(2026, 10, 17, 22)), false);
  assert.equal(marketOpen(Date.UTC(2026, 10, 21, 15)), false, 'Saturday');
});

/* ---------- the service on a fake broker ---------- */
function fakeBroker({ balance = 1000, price = 180, minVolume = 100 } = {}) {
  const st = { balance, price, positions: [], orders: [], amends: [], closes: [], nextPos: 500 };
  const session = {
    close() {}, on() {},
    info: async () => ({ login: 5378004, balance: st.balance, leverage: 400 }),
    positions: async () => st.positions.map(p => ({ ...p, units: p.volume / 100 })),
    findSymbols: async () => [{ symbolId: 11, name: 'NVDA.US' }, { symbolId: 12, name: 'XOM.US' }],
    symbol: async id => ({ symbolId: id, digits: 2, minVolume, stepVolume: 100, maxVolume: 1e7, swapLong: -0.1, swapShort: -0.05 }),
    quote: async () => ({ bid: st.price - 0.05, ask: st.price + 0.05 }),
    marketOrder: async o => { st.orders.push(o); const id = st.nextPos++; st.positions.push({ positionId: id, symbolId: o.symbolId, side: o.side, volume: o.volume, price: st.price + 0.05, stop: null }); return { positionId: id, price: st.price + 0.05, volume: o.volume }; },
    amend: async (id, f) => { st.amends.push({ id, ...f }); return {}; },
    closePosition: async (id, vol) => { st.closes.push({ id, vol }); const p = st.positions.find(x => x.positionId === id); p.volume -= vol; if (!p.volume) st.positions = st.positions.filter(x => x !== p); return { price: st.price, volume: vol }; }
  };
  const client = {
    configured: () => true,
    authUrl: s => `https://id.example/grant?state=${s}`,
    exchangeCode: async code => { if (code !== 'good') throw new Error('bad code'); return { access: 'A', refresh: 'R', expiresAt: Date.now() + 30 * 864e5 }; },
    refreshToken: async () => ({ access: 'A2', refresh: 'R2', expiresAt: Date.now() + 30 * 864e5 }),
    accounts: async () => [{ accountId: 2, login: 999, live: true }, { accountId: 1, login: 5378004, live: false }],
    account: async () => session
  };
  return { st, client };
}
const ROUND = { id: '00000000-0000-4000-8000-000000000001', tk: 'NVDA', call: 'Buy', mode: 'trader', assetClass: 'stock', p: 180, stop: 170, tgt: 202, ticket: { Entry: '$180' } };
const TUE10 = Date.UTC(2026, 10, 17, 15); // Tuesday 10:00 in New York

async function linkedBroker(opts = {}, clock = { t: TUE10 }, earn = null) {
  const store = openStore(':memory:'), { st, client } = fakeBroker(opts);
  const b = createBroker({ store, client, now: () => clock.t, log: () => {}, earningsFor: async () => earn });
  const url = b.startConnect('Tester'), state = new URL(url).searchParams.get('state');
  const r = await b.finishConnect('good', state);
  return { b, st, store, r, clock };
}

test('connecting: the state must match, only the demo account is linked, tokens are stored encrypted', async () => {
  const { b, store, r } = await linkedBroker();
  assert.equal(r.login, 5378004, 'the demo account, not the live one');
  assert.ok(!store.kvGet('tokens').includes('"A"'), 'tokens are not stored in clear');
  await assert.rejects(b.finishConnect('good', 'wrong-state-123'), /expired/);
  const s = await b.status();
  assert.deepEqual([s.linked, s.env, s.balance, s.open, s.method], [true, 'demo', 1000, 0, 'C']);
});

test('preview: 1% risk sizing, and every rule that blocks a trade', async () => {
  const { b } = await linkedBroker();
  const v = await b.preview(ROUND);
  assert.equal(v.symbol, 'NVDA.US');
  assert.equal(v.ok, false, 'the stop is $10.05 away: one share would risk more than 1% of $1000');
  assert.match(v.blocked.join(), /smallest size the broker allows risks 10.05/);
  const { b: b2 } = await linkedBroker();
  const w = await b2.preview({ ...ROUND, stop: 175 });
  assert.deepEqual([w.units, w.riskUsd <= 10, w.ok], [1, true, true], 'stop $5 away: one share, $5 risk');
  assert.match((await b2.preview({ ...ROUND, assetClass: 'crypto', stop: 175 })).blocked.join(), /No crypto/);
  assert.match((await b2.preview({ ...ROUND, mode: 'investor', stop: 175 })).blocked.join(), /trader plan/);
  await assert.rejects(b2.preview({ ...ROUND, call: 'Hold', ticket: null }), /hold/);
  assert.match((await b2.preview({ ...ROUND, stop: 181 })).blocked.join(), /past the stop/);
  const { b: b3 } = await linkedBroker({}, { t: TUE10 }, TUE10 + 3 * 864e5);
  assert.match((await b3.preview({ ...ROUND, stop: 175 })).blocked.join(), /Earnings/);
});

test('send: places the market order with its stop, no take-profit; the plan then manages it', async () => {
  const { b, st, store, clock } = await linkedBroker({ balance: 10000 });
  const v = await b.preview(ROUND);
  assert.equal(v.units, 9, '1% of $10,000 over a $10.05 stop: 9 shares');
  await assert.rejects(b.send(ROUND, '00000000-0000-4000-8000-00000000dead', 'Tester'), /expired/);
  const o = await b.send(ROUND, v.id, 'Tester');
  assert.equal(st.orders[0].volume, 900);
  assert.equal(st.orders[0].targetDistance, null);
  assert.ok(Math.abs(st.orders[0].stopDistance - 10.05) < 1e-9);
  assert.equal(o.units, 9);
  await assert.rejects(b.preview(ROUND), /already sent/);
  assert.match(b.log(0).at(-1).text, /Bought 9 NVDA.US/);
  // the price runs to +1.5R in the day: take half (4 of 9, the step is one share)
  st.price = 196;
  await b.tick();
  assert.deepEqual(st.closes, [{ id: 500, vol: 400 }]);
  assert.equal(store.listBrokerOrders('open')[0].plan.partial, true);
  // end of the day: break-even and a trailing stop
  clock.t = Date.UTC(2026, 10, 17, 20, 50);
  await b.tick();
  assert.ok(st.amends.at(-1).stop > 180, `stop moved up: ${st.amends.at(-1)?.stop}`);
  const pos = await b.positions();
  assert.equal(pos.positions[0].units, 5);
  assert.ok(pos.positions[0].r > 1.5);
  // close all
  await b.closeAll('Tester');
  assert.equal(store.listBrokerOrders('open').length, 0);
  assert.match(b.log(0).at(-1).text, /Closed NVDA.US/);
});

test('a position stopped at the broker is marked closed; the market closed: the manager waits', async () => {
  const { b, st, store, clock } = await linkedBroker({ balance: 10000 });
  const v = await b.preview(ROUND); await b.send(ROUND, v.id, 'T');
  clock.t = Date.UTC(2026, 10, 21, 15);
  assert.equal((await b.tick()).closedMarket, true);
  clock.t = TUE10 + 7 * 864e5; st.positions = [];
  await b.tick();
  assert.equal(store.listBrokerOrders('closed')[0].plan.exitWhy, 'stopped or closed at the broker');
});

test('API: broker routes validate input, and answer 503 when no broker is set up', async () => {
  const store = openStore(':memory:'), market = demo;
  const start = app => new Promise(r => { const s = app.listen(0, () => r(s)); });
  const none = await start(createApp({ store, market, openRoom: true }));
  const base0 = `http://127.0.0.1:${none.address().port}/api`;
  assert.equal((await fetch(base0 + '/broker/status')).status, 503);
  none.close();
  const { b, st } = await linkedBroker({ balance: 10000 });
  const srv = await start(createApp({ store, market, openRoom: true, broker: b }));
  const base = `http://127.0.0.1:${srv.address().port}/api`, post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/broker/preview', {})).status, 400);
    assert.equal((await post('/broker/preview', { roundId: '00000000-0000-4000-8000-000000000999' })).status, 404);
    const { id } = store.saveRound({ ...ROUND, brief: 'NVDA', conv: 70 });
    const pv = await (await post('/broker/preview', { roundId: id })).json();
    assert.equal(pv.ok, true);
    assert.equal((await post('/broker/orders', { roundId: id })).status, 400, 'previewId is required');
    const sent = await post('/broker/orders', { roundId: id, previewId: pv.id });
    assert.equal(sent.status, 201);
    assert.equal(st.orders.length, 1);
    const pos = await (await fetch(base + '/broker/positions')).json();
    assert.equal(pos.positions.length, 1);
    assert.equal((await post(`/broker/positions/${pos.positions[0].id}/close`, { part: 'most' })).status, 400);
    assert.equal((await post(`/broker/positions/${pos.positions[0].id}/close`, { part: 'all' })).status, 200);
    assert.equal((await post('/broker/method', { method: 'Z' })).status, 400);
    assert.equal((await (await post('/broker/method', { method: 'B' })).json()).method, 'B');
    assert.ok((await (await fetch(base + '/broker/log')).json()).log.length >= 2);
  } finally { srv.close(); }
});
