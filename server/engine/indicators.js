// Price-series maths used by the Technical, Risk and Dealer desks.

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
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(1)}tn`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}bn`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}m`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}k`;
  return `${s}$${a.toFixed(0)}`;
}

/** Compact count: 1.2bn, 34m, 12k. */
export function count(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'bn';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'm';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'k';
  return v.toFixed(0);
}

