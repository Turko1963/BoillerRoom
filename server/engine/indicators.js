// Price-series maths used by the Technical, Risk and Dealer desks.
import { cur } from './currency.js';

export const mean = a => a.reduce((t, x) => t + x, 0) / (a.length || 1);

/** Simple moving average of the last n closes (or all of them if fewer). */
export const sma = (closes, n) => mean(closes.slice(-n));

/** Wilder's RSI over n periods. */
export function rsi(closes, n = 14) {
  if (closes.length <= n) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; d > 0 ? g += d : l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

/** Annualised volatility (%) of daily log returns over the last n days. */
export function realizedVol(closes, n = 30, periodsPerYear = 252) {
  const c = closes.slice(-(n + 1)), r = [];
  for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  if (r.length < 2) return 0;
  const m = mean(r), v = r.reduce((t, x) => t + (x - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * periodsPerYear) * 100;
}

/** % change over the last n periods. */
export const change = (closes, n) => closes.length > n ? (closes.at(-1) / closes.at(-1 - n) - 1) * 100 : 0;

/** Volume on up days divided by volume on down days, last n sessions. */
export function upDownVolume(candles, n = 20) {
  let up = 0, dn = 0;
  for (const k of candles.slice(-n)) (k.c >= k.o ? (up += k.v || 0) : (dn += k.v || 0));
  return dn ? up / dn : up ? 2 : 1;
}

/** Compact money: $1.2bn, $340m, $12k. */
export function money(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  const c = cur();
  if (a >= 1e12) return `${s}${c}${(a / 1e12).toFixed(1)}tn`;
  if (a >= 1e9) return `${s}${c}${(a / 1e9).toFixed(1)}bn`;
  if (a >= 1e6) return `${s}${c}${(a / 1e6).toFixed(0)}m`;
  if (a >= 1e3) return `${s}${c}${(a / 1e3).toFixed(0)}k`;
  return `${s}${c}${a.toFixed(0)}`;
}

/** Compact count: 1.2bn, 34m, 12k. */
export function count(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'bn';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'm';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'k';
  return v.toFixed(0);
}


/** Average true range over n sessions (Wilder), in price units. */
export function atr(candles, n = 14) {
  const c = candles.slice(-(n * 3 + 1));
  if (c.length < 2) return 0;
  const tr = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)));
  let a = mean(tr.slice(0, n));
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}

/**
 * Stop and target at real chart levels, for a long and for a short.
 * Long: stop half an ATR under the recent support (at least 1.5 ATR away, at most maxStop),
 *       target at the nearest resistance above, or an extra reference (analyst target) for investors.
 * Short: the mirror image. With no level on the far side (price at a high or low), the target
 * falls back to a multiple of the risk. Returns null when there are too few candles.
 */
export function chartLevels(candles, p, { investor = false, maxStop = 0.15, extraTarget = null, fallbackRR = 2.2 } = {}) {
  if (candles.length < 30) return null;
  const a = atr(candles), near = investor ? 60 : 20, far = investor ? 250 : 60;
  const lows = n => candles.slice(-n).map(k => k.l), highs = n => candles.slice(-n).map(k => k.h);
  const support = Math.min(...lows(near)), resist = Math.max(...highs(near));
  // long
  let ls = Math.min(support - a * 0.5, p - a * 1.5);
  ls = Math.max(ls, p * (1 - maxStop));
  const upLevels = [Math.max(...highs(far)), Math.max(...highs(Math.min(250, candles.length)))].filter(v => v > p * 1.01).sort((x, y) => x - y);
  let lt = upLevels[0] ?? p + (p - ls) * fallbackRR;
  if (investor && extraTarget && extraTarget > lt) lt = extraTarget;
  // short
  let ss = Math.max(resist + a * 0.5, p + a * 1.5);
  ss = Math.min(ss, p * (1 + maxStop));
  const downLevels = [Math.min(...lows(far)), Math.min(...lows(Math.min(250, candles.length)))].filter(v => v < p * 0.99).sort((x, y) => y - x);
  let st = downLevels[0] ?? Math.max(p * 0.05, p - (ss - p) * fallbackRR);
  return { atr: a, support, resist, long: { stop: ls, target: lt }, short: { stop: ss, target: st } };
}
