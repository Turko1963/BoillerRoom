// The trade plan: entry, stop, targets and management from the room's call (pure, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradePlan, TESTED } from '../server/engine/plan.js';
import { positionSize } from '../server/execution/sizing.js';
import * as demo from '../server/market/demo.js';

const round = o => ({ call: 'Buy', p: 100, stop: 95, tgt: 111, conv: 70, mode: 'trader', assetClass: 'stock', ticket: { Horizon: '4 days to 2 weeks' }, backdrop: { events: [] }, ...o });

test('a buy: stop, take profit at +1.5R, break-even at +1R, trail 2 ATR, the scale-in add at -0.5R', () => {
  const p = tradePlan(round());
  assert.deepEqual([p.side, p.entry, p.stop, p.R, p.target, p.rr, p.riskPct], ['buy', 100, 95, 5, 111, 2.2, 5]);
  assert.deepEqual([p.managed.partial, p.managed.breakEven, p.managed.trailDistance, p.managed.minProgress, p.managed.timeStop, p.managed.maxHold], [107.5, 105, 5, 102.5, 10, 30]);
  assert.deepEqual([p.scaleIn.add, p.scaleIn.avgIfAdded, p.scaleIn.riskIfAddedR], [97.5, 98.75, 0.75]);
  assert.deepEqual(p.entryZone, [98.75, 101.25]);
  assert.deepEqual(p.managed.tested, TESTED.managed);
});

test('a short is the mirror image', () => {
  const p = tradePlan(round({ call: 'Short', stop: 105, tgt: 89 }));
  assert.deepEqual([p.side, p.managed.partial, p.managed.breakEven, p.scaleIn.add], ['sell', 92.5, 95, 102.5]);
});

test('hold: no trade, the levels the desks are watching; warnings for earnings, coins, investor mode, a thin reward', () => {
  const h = tradePlan(round({ call: 'Hold', ticket: null, ANN: { technical: { price: 104, label: '200 day average' }, fundamental: { price: 90, label: 'Fair value' } } }));
  assert.equal(h.side, 'none');
  assert.deepEqual(h.watch.map(w => [w.label, w.above]), [['200 day average', true], ['Fair value', false]]);
  const w = tradePlan(round({ backdrop: { events: ['Earnings on Dec 1 (in 3 days)'] }, assetClass: 'crypto', mode: 'investor', tgt: 106 })).warnings.map(x => x.id);
  assert.deepEqual(w, ['earnings', 'crypto', 'investor', 'rr']);
  assert.deepEqual(tradePlan(round()).warnings, []);
});

// sizeFor() was replaced by positionSize() (server/execution/sizing.js): it divided an account of an unstated currency by a
// stop distance in the share's currency, which is the bug behind "145.54 USD" for 145.54 ILS. Same numbers here, with the
// account's currency stated (the same as the plan's, so no rate is needed). Currencies are covered in test/sizing.test.js.
test('size: 1% of the account over 1R, whole shares; coins in small units; a plan states its currency', () => {
  const p = tradePlan(round({ currency: 'USD' })), acct = { equity: 1000, currency: 'USD' };
  const s = positionSize({ plan: p, account: acct, riskPct: 1 });
  assert.deepEqual([s.budget.account, s.units, s.notional.account], [10, 2, 200]);
  assert.equal(positionSize({ plan: { ...p, assetClass: 'crypto' }, account: acct }).units, 2);
  assert.equal(positionSize({ plan: { ...p, assetClass: 'crypto', R: 3 }, account: acct }).units, 3.333333);
  assert.equal(positionSize({ plan: tradePlan(round({ call: 'Hold', ticket: null })), account: acct }).status, 'n/a');
  assert.equal(tradePlan(round()).currency, null, 'a live round without a currency: none assumed');
  assert.equal(tradePlan(round({ assetClass: 'demo' })).currency, 'USD', 'the demo is priced in dollars');
});

test('every demo round gets a plan that matches its ticket', async () => {
  const c = await demo.round('Should we buy HLXN?', 'trader'), p = tradePlan(c);
  assert.equal(p.stop, +c.stop.toFixed(2));
  assert.equal(p.side, c.call === 'Buy' ? 'buy' : 'sell');
});

test('Investor mode, bearish: Sell means exit a holding; no entry, stop or target for a short', () => {
  const p = tradePlan(round({ call: 'Short', direction: 'Sell', mode: 'investor', stop: 110, tgt: 80, ticket: { Horizon: '1 to 3 years' }, vote: { shortAt: -0.12, overrides: [] } }));
  assert.equal(p.side, 'exit');
  assert.equal(p.stop, undefined);
  assert.equal(p.entry, undefined);
  assert.match(p.trigger, /If you hold it/);
  assert.match(p.invalidation, /back above the sell line/);
});
