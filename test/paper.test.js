// The paper broker: cTrader's interface on real prices (here a fake price feed), under the unchanged broker service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPaperClient } from '../server/broker/paper.js';
import { createBroker, marketOpen } from '../server/broker/service.js';
import { openStore } from '../server/store/db.js';

const TUE10 = Date.UTC(2026, 10, 17, 15); // Tuesday 10:00 in New York
const ROUND = { id: '00000000-0000-4000-8000-0000000000a1', tk: 'NVDA', call: 'Buy', mode: 'trader', assetClass: 'stock', p: 180, stop: 175, tgt: 192, ticket: { Entry: '$180' } };
function setup(balance = 1000) {
  const store = openStore(':memory:'), px = { NVDA: 180 }, clock = { t: TUE10 };
  const client = createPaperClient({ store, quote: async k => px[k], isOpen: marketOpen, now: () => clock.t, balance });
  const b = createBroker({ store, client, now: () => clock.t, log: () => {}, benchHistory: async () => [{ t: TUE10 - 864e5, c: 6000 }, { t: TUE10 + 864e5, c: 6060 }] });
  return { store, px, clock, client, b };
}

test('paper broker: linked from the start, sized by the same rules, filled at the ask', async () => {
  const { b, store } = setup();
  const s = await b.status();
  assert.deepEqual([s.linked, s.env, s.balance], [true, 'paper', 1000]);
  const v = await b.preview(ROUND);
  assert.equal(v.ok, true, v.blocked.join('; '));
  assert.deepEqual([v.symbol, v.units, v.env], ['NVDA', 1, 'paper'], '$5.04 stop distance: one share for $10 of risk');
  const o = await b.send(ROUND, v.id, 'T');
  assert.equal(o.price, 180.036, 'the ask: half a 0.04% spread above 180');
  assert.equal(store.listBrokerOrders('open').length, 1);
  assert.equal((await b.status()).balance, 999.98, '$0.02 commission');
});

test('paper broker: the market must be open; a price through the stop closes at that price, not at the stop', async () => {
  const { b, px, clock, store } = setup();
  clock.t = Date.UTC(2026, 10, 21, 15); // Saturday
  assert.match((await b.preview(ROUND)).blocked.join(), /market is closed/);
  clock.t = TUE10;
  const v = await b.preview(ROUND); await b.send(ROUND, v.id, 'T');
  clock.t = TUE10 + 864e5; px.NVDA = 170; // gapped well under the 175 stop
  await b.tick();
  const c = store.listBrokerOrders('closed')[0];
  assert.ok(c, 'closed');
  assert.ok(c.pnl < -10, `filled at 170, not at the stop: lost more than the $10 planned (${c.pnl})`);
  const bm = await b.benchmark();
  assert.equal(bm.trades.trades, 1);
  assert.ok(bm.trades.totalR < -1.9, `about -2R: ${bm.trades.totalR}`);
  assert.equal(bm.bench.pct, 0, 'the demo started on the Saturday check, after the last S&P 500 move in this fake history');
});

test('paper broker: the manager takes half at +1.5R and the rest closes at the price', async () => {
  const { b, px, clock, store } = setup(10000);
  const v = await b.preview(ROUND); await b.send(ROUND, v.id, 'T'); // 19 shares
  px.NVDA = 188; clock.t = TUE10 + 3600e3;
  await b.tick();
  const o = store.listBrokerOrders('open')[0];
  assert.equal(o.plan.partial, true);
  assert.equal(o.volume, 1000, '9 of 19 taken off, 10 left');
  await b.close(o.id, 'all', 'T');
  const c = store.listBrokerOrders('closed')[0];
  assert.ok(c.pnl > 140, `two closes at about +8 a share, less commissions: ${c.pnl}`);
});
