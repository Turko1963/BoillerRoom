// Base rate: before trusting a story, ask what usually happened next. In the asset's own price history, find the days
// that looked like today (above or below the 50 day average, the same RSI zone, the same 20 day direction) and measure
// the move over the holding period that followed (10 sessions for traders, 60 for investors).
// Pure and deterministic: works for every brain, and the AI debate is given it as evidence.

const H = { trader: 10, investor: 60 };
const zone = r => (r < 35 ? 'oversold' : r > 65 ? 'overbought' : 'middle');

/** RSI 14 (Wilder) for every index; null before there is enough history. */
function rsiSeries(c, n = 14) {
  const out = new Array(c.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) out[i] = l ? 100 - 100 / (1 + g / l) : 100; continue; }
    g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l ? 100 - 100 / (1 + g / l) : 100;
  }
  return out;
}

/** { horizon, matches, upPct, avgRet, medRet, setup, text } or null when there are too few similar days. */
export function baseRate(closes, mode = 'trader') {
  const c = (closes || []).filter(v => v > 0), h = H[mode] || 10;
  if (c.length < 50 + 14 + h + 20) return null;
  const rsi = rsiSeries(c), sma = i => { let s = 0; for (let k = i - 49; k <= i; k++) s += c[k]; return s / 50; };
  const feat = i => ({ above: c[i] > sma(i), z: zone(rsi[i]), up: c[i] > c[i - 20] });
  const now = feat(c.length - 1), rets = [];
  for (let i = 49; i < c.length - 1 - h; i++) {
    if (rsi[i] == null || i < 20) continue;
    const f = feat(i);
    if (f.above === now.above && f.z === now.z && f.up === now.up) rets.push((c[i + h] / c[i] - 1) * 100);
  }
  if (rets.length < 12) return null;
  const up = rets.filter(r => r > 0).length, avg = rets.reduce((s, r) => s + r, 0) / rets.length, med = [...rets].sort((a, b) => a - b)[Math.floor(rets.length / 2)];
  const setup = `${now.above ? 'above' : 'below'} its 50 day average, RSI ${now.z}, ${now.up ? 'up' : 'down'} over 20 days`;
  const r1 = v => Math.round(v * 10) / 10;
  return { horizon: h, matches: rets.length, upPct: Math.round(up / rets.length * 100), avgRet: r1(avg), medRet: r1(med), setup,
    text: `on ${rets.length} past days that looked like today (${setup}), the price was higher ${h} sessions later ${Math.round(up / rets.length * 100)}% of the time, ${avg >= 0 ? '+' : ''}${r1(avg)}% on average` };
}
