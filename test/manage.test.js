// Money and position management engine: each rule on hand-made price paths (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, stats, backtest, signals } from '../server/engine/manage.js';

// candles from a list of closes; each day's range is the close +/- w, the open is the previous close
const path = (closes, w = 0.2) => closes.map((c, i) => { const o = i ? closes[i - 1] : c; return { t: Date.UTC(2024, 0, 1 + i), o, c, h: Math.max(o, c) + w, l: Math.min(o, c) - w }; });
// entry at 100, ATR 1, so R = 2 (stop at 98)
const run = (closes, m, o) => simulate(path(closes), 0, 1, m, { cost: 0, ...o });

test('a losing trade: plain loses 1R, the managed plan only 0.5R because it never added', () => {
  const down = [100, 99.5, 99, 98.5, 97.5, 97];
  assert.equal(run(down, 'plain').r, -1);
  assert.equal(run(down, 'managed').r, -0.5);
  assert.match(run(down, 'managed').events.join(' '), /stop: sell 0.5 at 98/);
});

test('a winner: the managed plan adds once proven, takes half at +1.5R and trails the rest', () => {
  const up = [100, 101, 102.5, 103.5, 104, 105, 106, 107, 108, 107.5, 106, 104.5, 103];
  const m = run(up, 'managed');
  const ev = m.events.join(' | ');
  assert.match(ev, /add \(proven\): buy 0.5 at 102.5/);
  assert.match(ev, /take half: sell 0.5 at 103/);
  assert.match(ev, /stop \(protected\)/);
  assert.ok(m.r > 0.9, `r ${m.r}`);
  assert.equal(run(up, 'plain').r, 2.2, 'plain sells everything at the 2.2R target');
});

test('averaging down loses more on the way down than the managed plan', () => {
  const down = [100, 99.5, 98.8, 98.6, 97.9];
  const a = run(down, 'avgDown');
  assert.match(a.events.join(' '), /average down: buy 0.5 at 99/);
  assert.equal(a.r, -0.75);
  assert.ok(a.r < run(down, 'managed').r);
});

test('time stop: a trade that goes nowhere is closed after 10 sessions', () => {
  const flat = [100, 100.3, 99.8, 100.2, 100, 99.9, 100.1, 100.2, 99.9, 100, 100.1, 100, 100.2];
  const m = run(flat, 'managed');
  assert.equal(m.hold, 10);
  assert.match(m.events.at(-1), /time stop/);
});

test('costs are charged on every unit traded; a gap through the stop fills at the open', () => {
  const c = path([100, 99.5]); c[1] = { ...c[1], o: 96, l: 95.5, h: 96.5, c: 96 };
  const g = simulate(c, 0, 1, 'plain', { cost: 0 });
  assert.equal(g.r, -2, 'gapped to 96: two R lost, not one');
  const withCost = simulate(path([100, 99.5, 99, 98.5, 97.5]), 0, 1, 'plain', { cost: .001 });
  assert.ok(withCost.r < -1);
});

test('stats and backtest: the same entries for every method', () => {
  const s = stats([{ r: 2, t: 1, hold: 3 }, { r: -1, t: 2, hold: 2 }, { r: -1, t: 3, hold: 1 }, { r: 1.5, t: 4, hold: 5 }]);
  assert.deepEqual([s.trades, s.winRate, s.avgR, s.totalR, s.profitFactor, s.maxDrawdownR], [4, 50, 0.38, 1.5, 1.75, -2]);
  // a long uptrend with regular pullbacks gives signals
  const closes = Array.from({ length: 700 }, (_, i) => 100 * Math.pow(1.0015, i) * (1 + Math.sin(i / 6) * .04));
  const c = path(closes, 1);
  assert.ok(signals(c).length > 5);
  const b = backtest([{ symbol: 'X', kind: 'stock', candles: c }]);
  assert.deepEqual(Object.keys(b.methods), ['plain', 'managed', 'noScale', 'avgDown']);
  const n = b.methods.plain.trades;
  assert.ok(n > 0 && Object.values(b.methods).every(m => Math.abs(m.trades - n) <= 1), 'about the same trades for each method');
});
