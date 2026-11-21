// Money and position management: one engine for the backtest and, later, for live trading.
// Everything is measured in R: 1R is the money lost if the full planned size is stopped out at the first stop
// (for a 1% risk per trade, 1R = 1% of the account).
//
// Methods (the same entry, managed differently):
//   plain    all in at the entry, fixed stop and target, time stop
//   managed  half at the entry, the other half only once the trade is +1R (within a few sessions), then break-even,
//            half the position taken off at +1.5R, the rest on a trailing stop, time stop when it goes nowhere
//   noScale  all in at the entry, then managed like "managed"
//   avgDown  half at the entry, the other half when the price falls 0.5R, fixed stop and target (averaging down
//            within the same risk budget)
// Daily candles only: inside a day we cannot tell which came first, so a candle that touches the stop counts as
// stopped before anything else (the cautious reading), and a gap through the stop fills at the open.

export const RULES = { target: 2.2, addAt: 1, addWithin: 5, breakEvenAt: 1, partialAt: 1.5, partialFrac: 0.5, trailAtr: 2, timeStop: 10, minProgress: 0.5, maxHold: 30 };

/**
 * Simulate one long trade entered at the open of candle i. c: [{o,h,l,c}], atr: ATR at the signal (the day before).
 * Returns { r, exitIdx, hold, events } with r in R (costs included), or null when there is no room to run.
 */
export function simulate(c, i, atr, method = 'managed', { cost = 0.001, rules = RULES } = {}) {
  if (!c[i] || !(atr > 0)) return null;
  const E = c[i].o, R = 2 * atr, stop0 = E - R;
  if (!(stop0 > 0)) return null;
  const ev = [], costR = px => cost * px / R; // a cost per unit traded, both ways
  let units = 0, avg = 0, pnl = 0, stop = stop0, added = false, partial = false, high = E, done = null;
  const buy = (u, px, why) => { avg = (avg * units + px * u) / (units + u); units += u; pnl -= costR(px) * u; ev.push(`${why}: buy ${u} at ${px.toFixed(2)}`); };
  const sell = (u, px, why) => { pnl += u * (px - avg) / R - costR(px) * u; units -= u; ev.push(`${why}: sell ${u} at ${px.toFixed(2)}`); };
  buy(method === 'plain' || method === 'noScale' ? 1 : 0.5, E, 'entry');
  const tgt = E + rules.target * R, managed = method === 'managed' || method === 'noScale';
  for (let k = i; k < c.length && !done; k++) {
    const b = c[k], age = k - i;
    // 1. the stop, first (gap through it: filled at the open)
    if (b.l <= stop) { sell(units, Math.min(stop, b.o), stop >= avg ? 'stop (protected)' : 'stop'); done = k; break; }
    if (!managed) {
      if (method === 'avgDown' && !added && b.l <= E - 0.5 * R) { buy(0.5, E - 0.5 * R, 'average down'); added = true; }
      if (b.h >= tgt) { sell(units, Math.max(tgt, b.o), 'target'); done = k; break; }
      if (age >= rules.timeStop) { sell(units, b.c, 'time stop'); done = k; break; }
      continue;
    }
    // 2. managed: take half off at +1.5R (from the first entry), during the day
    if (!partial && b.h >= E + rules.partialAt * R && age > 0) { sell(units * rules.partialFrac, Math.max(E + rules.partialAt * R, b.o), 'take half'); partial = true; }
    // 3. at the close: add to a winner, break-even, trail, time stop
    high = Math.max(high, b.c);
    if (method === 'managed' && !added && age > 0 && age <= rules.addWithin && b.c >= E + rules.addAt * R) { buy(0.5, b.c, 'add (proven)'); added = true; stop = Math.max(stop, E); }
    if (b.c >= E + rules.breakEvenAt * R) stop = Math.max(stop, Math.min(avg, b.c - 0.1 * R));
    if (partial) stop = Math.max(stop, high - rules.trailAtr * atr);
    if ((age >= rules.timeStop && b.c < E + rules.minProgress * R) || age >= rules.maxHold) { sell(units, b.c, age >= rules.maxHold ? 'max hold' : 'time stop'); done = k; break; }
  }
  if (done == null) return null; // the history ended with the trade still open
  return { r: +pnl.toFixed(4), exitIdx: done, hold: done - i, events: ev };
}

/* ---------- signals and the backtest ---------- */
const smaAt = (c, i, n) => { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += c[k].c; return s / n; };
function indicators(c) {
  const n = c.length, rsi = new Array(n).fill(null), atr = new Array(n).fill(null);
  let g = 0, l = 0, a = 0;
  for (let i = 1; i < n; i++) {
    const d = c[i].c - c[i - 1].c, up = Math.max(d, 0), dn = Math.max(-d, 0), tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    if (i <= 14) { g += up / 14; l += dn / 14; a += tr / 14; if (i === 14) { rsi[i] = l ? 100 - 100 / (1 + g / l) : 100; atr[i] = a; } continue; }
    g = (g * 13 + up) / 14; l = (l * 13 + dn) / 14; a = (a * 13 + tr) / 14; rsi[i] = l ? 100 - 100 / (1 + g / l) : 100; atr[i] = a;
  }
  return { rsi, atr };
}
/** Pullback in an uptrend: above the 200 day average, 50 above 200, RSI under 40. Entry the next day; 10 day cooldown. */
export function signals(c) {
  const { rsi, atr } = indicators(c), out = [];
  let last = -1e9;
  for (let t = 200; t < c.length - 1; t++) {
    const s200 = smaAt(c, t, 200), s50 = smaAt(c, t, 50);
    if (c[t].c > s200 && s50 > s200 && rsi[t] < 40 && t - last >= 10) { out.push({ i: t + 1, atr: atr[t] }); last = t; }
  }
  return out;
}

/** Summary of a list of trade results [{r, t, hold}] in R. */
export function stats(trades) {
  const rs = trades.map(x => x.r), n = rs.length;
  if (!n) return { trades: 0 };
  const wins = rs.filter(r => r > 0), losses = rs.filter(r => r <= 0), sum = rs.reduce((s, r) => s + r, 0);
  let eq = 0, peak = 0, dd = 0;
  for (const x of [...trades].sort((a, b) => a.t - b.t)) { eq += x.r; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  const r2 = v => Math.round(v * 100) / 100;
  return { trades: n, winRate: Math.round(wins.length / n * 100), avgR: r2(sum / n), totalR: r2(sum),
    profitFactor: losses.length ? r2(wins.reduce((s, r) => s + r, 0) / -losses.reduce((s, r) => s + r, 0)) : null,
    maxDrawdownR: r2(dd), worstR: r2(Math.min(...rs)), avgHold: r2(trades.reduce((s, x) => s + x.hold, 0) / n) };
}

/** Run every method on the same entries. series: [{symbol, kind, candles}] -> { methods: {name: stats}, byPeriod } */
export function backtest(series, { methods = ['plain', 'managed', 'noScale', 'avgDown'], split = Date.UTC(2021, 0, 1) } = {}) {
  const res = Object.fromEntries(methods.map(m => [m, []]));
  for (const s of series) {
    const c = s.candles, cost = s.kind === 'crypto' ? 0.002 : 0.001;
    for (const sig of signals(c)) for (const m of methods) {
      const x = simulate(c, sig.i, sig.atr, m, { cost });
      if (x) res[m].push({ r: x.r, t: c[sig.i].t, hold: x.hold, symbol: s.symbol });
    }
  }
  const out = { methods: {}, byPeriod: {} };
  for (const m of methods) {
    out.methods[m] = stats(res[m]);
    out.byPeriod[m] = { before: stats(res[m].filter(x => x.t < split)), after: stats(res[m].filter(x => x.t >= split)) };
  }
  return out;
}
