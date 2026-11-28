// Grading at the decision's own horizon, against its benchmark, net of costs; and the calibration of conviction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store/db.js';
import { evaluate, excessOf, calibration, scoreboard, COSTS } from '../server/engine/scoreboard.js';
import { entryFor } from '../server/engine/predictions.js';
import { RING } from '../server/engine/team.js';

const DAY = 864e5, T0 = Date.UTC(2026, 9, 1), NOW0 = Math.floor(Date.now() / DAY) * DAY - 5 * DAY;
const series = (start, step, n = 60, t0 = T0) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * DAY, o: start + i * step, h: start + i * step + 1, l: start + i * step - 1, c: start + i * step }));

test('excess: what the call earned minus holding the benchmark, net of costs; shorts pay to borrow', () => {
  assert.equal(excessOf({ dir: 1, ret: 5, benchRet: 2, horizon: 10, assetClass: 'stock' }), +(5 - COSTS.stock - 2).toFixed(2));
  assert.equal(excessOf({ dir: -1, ret: -4, benchRet: 1, horizon: 252, assetClass: 'stock' }), +(4 - COSTS.stock - COSTS.borrowPerYear - 1).toFixed(2));
  assert.equal(excessOf({ dir: 0, ret: 3, benchRet: 2, horizon: 10 }), -2, 'staying out costs what the benchmark made');
  assert.equal(excessOf({ dir: 1, ret: 3, benchRet: null, horizon: 10 }), null);
});

test('a call is graded at its own horizon against its benchmark, as fixed in the prediction log', async () => {
  const store = openStore(':memory:');
  const round = { brief: 'UPCO?', live: true, assetClass: 'stock', tk: 'UPCO', p: 100, call: 'Buy', conv: 72, mode: 'trader', R: Object.fromEntries(RING.map(id => [id, { stance: 'bull', conf: 60 }])), debate: [], ticket: { Horizon: '4 days to 3 weeks' } };
  const { id } = store.saveRound(round);
  store.logPrediction(id, entryFor(round, { version: 't' }));
  // the stock climbs 1 a day, the S&P 500 0.5 a day from 100
  // the round is saved now: candles from five days before it (the first one at 100), and some after
  const market = { history: async k => (k === '^GSPC' ? series(97.5, 0.5, 40, NOW0) : series(95, 1, 40, NOW0)) };
  const r = await evaluate({ store, market });
  assert.equal(r.graded, 1);
  const o = store.listOutcomes()[0];
  assert.equal(o.horizon, 15, 'the far end of "4 days to 3 weeks"');
  assert.equal(o.benchRet, 7.5);
  assert.equal(o.excess, +(o.ret - COSTS.stock - 7.5).toFixed(2));
  const sb = scoreboard(store);
  assert.equal(sb.calls.avgExcess, o.excess);
  assert.equal(sb.calls.excessN, 1);
});

test('calibration: the fixed split by decision date (train, calibration, test); thin bands are unknown, not guessed', async () => {
  const { SPLITS, splitOf } = await import('../server/execution/assumptions.js');
  assert.deepEqual([splitOf('2026-12-15'), splitOf(SPLITS.calibrationFrom), splitOf('2027-02-01'), splitOf(SPLITS.testFrom)], ['train', 'calibration', 'calibration', 'test']);
  const at = (base, i) => new Date(Date.parse(base) + i * DAY).toISOString();
  const mk = (base, n) => Array.from({ length: n }, (_, i) => ({ call: 'Buy', conviction: i % 2 ? 75 : 55, callRight: i % 3 !== 0, createdAt: at(base, i), evaluatedAt: at(base, i + 20) }));
  const outs = [...mk('2026-12-01', 10), ...mk('2027-01-05', 30), ...mk('2027-04-05', 30)];
  const c = calibration(outs);
  assert.deepEqual([c.trades, c.trainSet, c.calibrationSet, c.testSet], [70, 10, 30, 30], 'by date, never by halves');
  const b70 = c.bands.find(b => b.band === '70-79%'), b80 = c.bands.find(b => b.band === '80-100%');
  assert.equal(b70.test.n, 15);
  assert.ok(b70.test.hitRate != null && b70.test.interval[0] <= b70.test.hitRate && b70.test.interval[1] >= b70.test.hitRate);
  assert.equal(b80.test.hitRate, null, 'no trades in the band: unknown');
  assert.equal(calibration(mk('2027-04-05', 8)).bands[0].test.hitRate, null, 'under the minimum: unknown');
});

test('survivorship: a call on an asset that has no prices any more is counted as ungradable, not dropped', async () => {
  const store = openStore(':memory:');
  const round = { brief: 'GONE?', live: true, assetClass: 'stock', tk: 'GONE', p: 10, call: 'Buy', conv: 60, mode: 'trader', R: Object.fromEntries(RING.map(id => [id, { stance: 'bull', conf: 60 }])), debate: [], ticket: { Horizon: '4 days to 2 weeks' } };
  store.saveRound(round);
  const r = await evaluate({ store, market: { history: async () => null }, now: Date.now() + 60 * DAY });
  assert.equal(r.graded, 0);
  assert.equal(store.ungradable().length, 1);
  assert.equal(scoreboard(store).ungradable, 1);
  assert.equal(scoreboard(store).calls.graded, 0, 'not counted as right or wrong');
});
