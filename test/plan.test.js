// The trade plan: entry, stop, targets and management from the room's call (pure, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradePlan, sizeFor, TESTED } from '../server/engine/plan.js';
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

test('size: 1% of the account over 1R, whole shares; coins in small units', () => {
  const p = tradePlan(round());
  assert.deepEqual(sizeFor(p, 1000, 1), { risk: 10, units: 2, value: 200 });
  assert.equal(sizeFor({ ...p, assetClass: 'crypto' }, 1000, 1).units, 2);
  assert.equal(sizeFor({ ...p, assetClass: 'crypto', R: 3 }, 1000, 1).units, 3.333333);
  assert.equal(sizeFor(tradePlan(round({ call: 'Hold', ticket: null })), 1000), null);
});

test('every demo round gets a plan that matches its ticket', async () => {
  const c = await demo.round('Should we buy HLXN?', 'trader'), p = tradePlan(c);
  assert.equal(p.stop, +c.stop.toFixed(2));
  assert.equal(p.side, c.call === 'Buy' ? 'buy' : 'sell');
});
