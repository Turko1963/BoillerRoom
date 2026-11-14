// Regime, events, chart levels, the scoreboard, the paper portfolio and the "Both" brain.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store/db.js';
import { makeCase, decide } from '../server/engine/case.js';
import { adjustFor, eventsFor, labelFor } from '../server/engine/regime.js';
import { chartLevels } from '../server/engine/indicators.js';
import { evaluate, weightsFor, scoreboard, portfolio, EVAL_SESSIONS } from '../server/engine/scoreboard.js';
import { PROVIDERS } from '../server/engine/ai.js';
import { createLive } from '../server/market/live.js';
import { RING } from '../server/engine/team.js';

const DAY = 864e5;
const calm = { label: 'neutral', available: true, vix: 16, spxAbove200: true, btcAbove200: true };
const fear = { label: 'risk-off', available: true, vix: 31, spxAbove200: false, btcAbove200: false };

test('regime and earnings shrink the size and raise the bar for buying', () => {
  const none = adjustFor({ g: calm, events: [], levels: null, mode: 'trader', kind: 'stock' });
  assert.equal(none.sizeMult, 1);
  const off = adjustFor({ g: fear, events: [], levels: null, mode: 'trader', kind: 'stock' });
  assert.equal(off.sizeMult, 0.5);
  assert.equal(off.buyAt, 0.2);
  const earn = adjustFor({ g: fear, events: [{ type: 'earnings', date: Date.now() + DAY, days: 1 }], levels: null, mode: 'trader', kind: 'stock' });
  assert.equal(earn.sizeMult, 0.25);
  assert.equal(earn.convPenalty, 15);
  // crypto: Bitcoin under its 200 day average is risk-off even when stocks are calm
  assert.equal(labelFor({ ...calm, btcAbove200: false }, 'crypto'), 'risk-off');
  assert.equal(labelFor({ ...calm, btcAbove200: false }, 'stock'), 'neutral');
});

test('only events inside the horizon count', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  const x = { summary: { earningsDate: now + 3 * DAY, exDividendDate: now - 20 * DAY } };
  assert.deepEqual(eventsFor(x, 'trader', now).map(e => [e.type, e.days]), [['earnings', 3]]);
  assert.deepEqual(eventsFor({ summary: { earningsDate: now + 40 * DAY } }, 'trader', now), []);
  assert.equal(eventsFor({ summary: { earningsDate: now + 40 * DAY } }, 'investor', now).length, 1);
});

test('chart levels put the stop beyond support and the target at resistance', () => {
  const c = []; let x = 100;
  for (let i = 0; i < 300; i++) { const o = x; x *= 1 + Math.sin(i / 9) * 0.01; c.push({ o, c: x, h: Math.max(o, x) * 1.01, l: Math.min(o, x) * 0.99 }); }
  const p = c.at(-1).c, L = chartLevels(c, p);
  assert.ok(L.long.stop < p && L.long.target > p);
  assert.ok(L.short.stop > p && L.short.target < p);
  assert.ok(p - L.long.stop >= L.atr * 1.5 - 1e-9, 'at least 1.5 ATR of room');
  assert.ok(L.long.stop >= p * 0.85 - 1e-9, 'never more than the max stop');
});

test('decide: adjust changes size, thresholds and levels; poor reward to risk becomes a hold', () => {
  // find a demo round that buys, then replay its inputs through decide with adjustments
  let base;
  for (let i = 0; i < 400 && !base; i++) { const c = makeCase(`Brief ${i} on HLXN?`, 'trader'); if (c.call === 'Buy' && c.net < 0.3) base = { c, brief: `Brief ${i} on HLXN?` }; }
  assert.ok(base, 'a buy round exists');
  const { c } = base;
  const again = (adjust, weights) => decide({ ...c, r: () => 0.5, plan: c.debate.map(x => ({ a: x.a, b: x.b, lines: x.lines, effect: null })), adjust, weights });
  const plain = again(null);
  assert.equal(plain.call, 'Buy');
  const half = again({ sizeMult: 0.5 });
  assert.equal(half.size, Math.max(0.5, +(plain.size * 0.5).toFixed(1)));
  assert.equal(again({ buyAt: 0.95 }).call, 'Hold', 'a higher bar turns a weak buy into a hold');
  const lv = again({ levels: { long: { stop: c.p * 0.95, target: c.p * 1.2 }, short: { stop: c.p * 1.05, target: c.p * 0.8 } } });
  assert.equal(lv.ticket['Reward to risk'], '4 to 1');
  assert.equal(+lv.stop.toFixed(4), +(c.p * 0.95).toFixed(4));
  const poor = again({ levels: { long: { stop: c.p * 0.9, target: c.p * 1.05 }, short: { stop: c.p * 1.1, target: c.p * 0.95 } } });
  assert.equal(poor.call, 'Hold');
  assert.equal(poor.ticket, null);
  assert.match(poor.why, /only 0.5 times the risk/);
});

// a stock that climbs 1% a day from 100, with candles from 5 days ago to 70 days ahead
const climbing = (now) => Array.from({ length: 75 }, (_, i) => { const c = 100 * 1.01 ** i; return { t: now + (i - 5) * DAY, o: c / 1.01, h: c * 1.005, l: c / 1.012, c }; });

test('calls are graded after their holding period, and good desks gain weight', async () => {
  const store = openStore(':memory:'), now = Date.now();
  const market = { history: async () => climbing(now) };
  const bulls = Object.fromEntries(RING.map(id => [id, { stance: id === 'risk' ? 'bear' : 'bull' }]));
  for (let i = 0; i < 6; i++) store.saveRound({ brief: 'b' + i, mode: 'trader', tk: 'UP', call: 'Buy', conv: 70, p: 100 * 1.01 ** 5, live: true, assetClass: 'stock', R: bulls, debate: [] });
  // nothing to grade before enough sessions have passed
  const early = await evaluate({ store, market: { history: async () => climbing(now).slice(0, 8) } });
  assert.equal(early.graded, 0);
  const r = await evaluate({ store, market });
  assert.equal(r.graded, 6);
  const sb = scoreboard(store);
  assert.equal(sb.calls.graded, 6);
  assert.equal(sb.calls.hitRate, 100);
  assert.ok(sb.calls.avgEdge > 5);
  const w = weightsFor(store, 'trader');
  assert.ok(w.analyst > 1.3, 'a desk that was right gains weight');
  assert.ok(w.risk < 1.2, 'a desk that was wrong loses weight');
  assert.equal(sb.modes.trader.learning, true);
  assert.equal(weightsFor(store, 'investor'), null, 'no learning without graded investor calls');
  assert.equal(EVAL_SESSIONS.trader, 10);
  store.close();
});

test('the paper portfolio replays tickets: target hit, stop hit, still open', async () => {
  const store = openStore(':memory:'), now = Date.now();
  // 15 sessions since the fill: fewer than the 20 a trader position is held
  const market = { history: async () => climbing(now).slice(0, 20) };
  const mk = (side, stop, target) => {
    const { id } = store.saveRound({ brief: side, mode: 'trader', tk: 'UP', call: side === 'buy' ? 'Buy' : 'Short', conv: 70, p: 105, live: true, assetClass: 'stock', R: {}, debate: [] });
    store.saveOrder({ roundId: id, ticker: 'UP', side, sizePct: 2, leverage: 1, entry: 105, stop, target, avgPrice: 105, fills: [] });
  };
  mk('buy', 95, 110);      // climbs into the target
  mk('short', 108, 90);    // climbs into the stop
  mk('buy', 50, 1000);     // still open
  const pf = await portfolio({ store, market });
  const by = Object.fromEntries(pf.positions.map(p => [p.side + p.target, p]));
  assert.equal(by.buy110.status, 'target');
  assert.ok(by.buy110.pnlPct > 4);
  assert.equal(by.short90.status, 'stopped');
  assert.ok(by.short90.pnlPct < 0);
  assert.equal(by.buy1000.status, 'open');
  assert.equal(pf.totals.open, 1);
  assert.equal(pf.totals.closed, 2);
  assert.equal(pf.totals.winRate, 50);
  store.close();
});

/* ---------- the Both brain ---------- */
const candles = (start, drift, n = 300) => {
  const out = []; let c = start;
  for (let i = 0; i < n; i++) { const o = c; c = c * (1 + drift + (i % 2 ? 0.006 : -0.004)); out.push({ t: Date.now() - (n - i) * DAY, o, h: Math.max(o, c) * 1.005, l: Math.min(o, c) * 0.995, c, v: 2e6, qv: c * 2e6, takerBuyQv: c * 1e6 }); }
  return out;
};
const sources = {
  yahoo: {
    chart: async s => { const k = candles(s === '^GSPC' ? 5000 : s === '^VIX' ? 16 : 100, 0.001); return { symbol: s, name: 'Up Corp', price: k.at(-1).c, prevClose: k.at(-2).c, candles: k }; },
    summary: async () => ({ targetMean: 150, analysts: 10, trend: { strongBuy: 3, buy: 3, hold: 3, sell: 1, strongSell: 0 }, operatingMargin: 0.2 }),
    news: async () => [], search: async () => [], screener: async () => []
  },
  binance: { tickers: async () => [], liquidBases: async () => new Set(), chart: async () => { throw new Error('none'); } },
  sec: { lookup: async t => (t === 'UP' ? { cik: '1', name: 'UP' } : null), annualFacts: async () => null, filings: async () => [] }
};
const fake = (label, stanceFor) => ({
  id: label.toLowerCase(), label, ready: () => true, model: () => label.toLowerCase() + '-model', describe: e => label + ': ' + e.message, calls: 0,
  async ask({ system, schema }) {
    this.calls++;
    const p = schema.properties;
    if (p.stance) { const st = stanceFor(system); return { data: { stance: st, confidence: 70, headline: `${label} says ${st}`, findings: ['a 1', 'b 2', 'c 3'] } }; }
    if (p.exchanges) return { data: { exchanges: [] } };
    return { data: { why: `${label} memo` } };
  }
});
let saved;
beforeEach(() => { saved = { ...PROVIDERS }; });
afterEach(() => { Object.assign(PROVIDERS, saved); });

test('Both: agreement raises confidence, disagreement lowers it and records the dissent', async () => {
  PROVIDERS.claude = fake('Claude', () => 'bull');
  PROVIDERS.gemini = fake('Gemini', sys => (sys.includes('Technical') ? 'bear' : 'bull'));
  const c = await createLive(sources).round('Should we buy UP?', 'trader', { brain: 'both' });
  assert.equal(c.brain.id, 'both');
  assert.equal(c.brain.model, 'claude-model + gemini-model');
  assert.deepEqual(c.brain.agreement, { both: 7, agree: 6 });
  assert.equal(c.R.analyst.conf, 75, 'agreement: average plus 5');
  assert.equal(c.R.technical.conf, 60, 'disagreement: average minus 10');
  assert.match(c.R.technical.findings[2], /Gemini sees it bearish/);
  assert.equal(PROVIDERS.claude.calls, 7 + 2, '7 desks + debate + memo');
  assert.equal(PROVIDERS.gemini.calls, 7, 'Gemini reads the desks only');
  assert.equal(c.why, 'Claude memo');
  assert.ok(c.backdrop && 'regime' in c.backdrop);
});

test('history: every brief, with what would have happened if we had followed the ticket', async () => {
  const { history } = await import('../server/engine/scoreboard.js');
  const store = openStore(':memory:'), now = Date.now();
  const market = { history: async () => climbing(now).slice(0, 20) };
  const base = { mode: 'trader', tk: 'UP', conv: 70, p: 105, live: true, assetClass: 'stock', R: {}, debate: [], size: 4, lev: 1 };
  store.saveRound({ ...base, brief: 'buy it ', call: 'Buy', callLabel: 'Buy', stop: 95, tgt: 110, ticket: {} });
  store.saveRound({ ...base, brief: 'short it', call: 'Short', callLabel: 'Short', stop: 108, tgt: 90, ticket: {} });
  store.saveRound({ ...base, brief: 'hold it', call: 'Hold', callLabel: 'Hold', ticket: null });
  store.saveRound({ ...base, brief: 'fictional', call: 'Buy', callLabel: 'Buy', stop: 95, tgt: 110, ticket: {}, live: false, assetClass: 'demo' });
  const h = await history({ store, market });
  const by = Object.fromEntries(h.items.map(i => [i.brief, i]));
  assert.equal(by['buy it'].whatIf.status, 'target');
  assert.ok(by['buy it'].whatIf.pnlPct > 4);
  assert.equal(by['buy it'].whatIf.bookPnlPct, +(by['buy it'].whatIf.pnlPct * 4 / 100).toFixed(2));
  assert.equal(by['short it'].whatIf.status, 'stopped');
  assert.ok(by['short it'].whatIf.pnlPct < 0);
  assert.equal(by['hold it'].whatIf, null);
  assert.ok(by['hold it'].since.movePct > 0, 'what the price did while we stayed flat');
  assert.equal(by.fictional.whatIf, null);
  assert.equal(by.fictional.live, false);
  assert.equal(h.summary.trades, 2);
  assert.equal(h.summary.won, 1);
  assert.equal(h.summary.lost, 1);
  assert.equal(h.summary.best.pnlPct, by['buy it'].whatIf.pnlPct);
  assert.equal(h.summary.demo, 1);
  store.close();
});
