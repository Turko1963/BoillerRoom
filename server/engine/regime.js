// Market regime and upcoming events: the outside world the seven desks do not see.
//
// regime(): VIX, the S&P 500 against its 200 day average, the 10 year yield and the dollar
//   (and Bitcoin's trend for crypto) -> risk-on, neutral or risk-off.
// eventsFor(): the next earnings report and ex-dividend date inside the trade's horizon.
// adjustFor(): turns both, plus the chart levels, into the `adjust` input of decide():
//   smaller size and a higher bar for buying in risk-off, half size into earnings.
import { sma, change } from './indicators.js';
import { memo } from '../data/http.js';

const DAY = 864e5;
const r2 = v => Math.round(v * 100) / 100;
const fmtDate = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Cached for 10 minutes: every round shares the same market backdrop. */
export const regime = memo(async (yahoo, binance) => {
  const soft = p => p.catch(() => null);
  const [vix, spx, tnx, dxy, btc] = await Promise.all([
    soft(yahoo.chart('^VIX', '3mo')), soft(yahoo.chart('^GSPC', '1y')), soft(yahoo.chart('^TNX', '3mo')),
    soft(yahoo.chart('DX-Y.NYB', '3mo')), soft(binance.chart('BTC', 365))
  ]);
  const closes = c => c?.candles.map(k => k.c) || [];
  const s = closes(spx), b = closes(btc);
  const v = vix?.price ?? null, spxAbove = s.length >= 200 ? s.at(-1) > sma(s, 200) : null;
  const btcAbove = b.length >= 200 ? b.at(-1) > sma(b, 200) : null;
  let label = 'neutral';
  if (v != null && (v > 25 || (spxAbove === false && v > 20))) label = 'risk-off';
  else if (v != null && v < 18 && spxAbove !== false) label = 'risk-on';
  return {
    label, vix: v, spxAbove200: spxAbove, spx1m: s.length > 21 ? r2(change(s, 21)) : null,
    tnx: tnx?.price ?? null, tnx1m: tnx ? r2(tnx.price - tnx.candles.at(-22)?.c) : null,
    dxy1m: dxy ? r2(change(closes(dxy), 21)) : null, btcAbove200: btcAbove, available: v != null
  };
}, 10 * 60e3);

/** The regime that applies to this asset: for crypto, Bitcoin below its 200 day average is risk-off too. */
export const labelFor = (g, kind) => (kind === 'crypto' && g?.btcAbove200 === false && g.label !== 'risk-on' ? 'risk-off' : g?.label);

/** One plain sentence about the backdrop. */
export function regimeLine(g, kind) {
  if (!g?.available) return 'Market backdrop not available';
  const parts = [`VIX ${g.vix.toFixed(1)}`];
  if (g.spxAbove200 != null) parts.push(`S&P 500 ${g.spxAbove200 ? 'above' : 'below'} its 200 day average`);
  if (kind === 'crypto' && g.btcAbove200 != null) parts.push(`Bitcoin ${g.btcAbove200 ? 'above' : 'below'} its 200 day average`);
  else if (g.tnx != null) parts.push(`10 year yield ${g.tnx.toFixed(2)}%`);
  // a Tel Aviv share is judged on the US backdrop too (the VIX, the S&P 500): say so
  return `${g.foreign ? 'US market' : 'Market'} ${labelFor(g, kind)}: ${parts.join(', ')}`;
}

/** Events inside the horizon we would hold for. */
export function eventsFor(x, mode, now = Date.now()) {
  const sm = x.summary || {}, horizonDays = mode === 'investor' ? 45 : 21, out = [];
  const add = (type, t) => { if (t && t > now - DAY && t - now < horizonDays * DAY) out.push({ type, date: t, days: Math.max(0, Math.round((t - now) / DAY)) }); };
  add('earnings', sm.earningsDate);
  add('ex-dividend', sm.exDividendDate);
  return out.sort((a, b) => a.date - b.date);
}
export const eventLine = e => `${e.type === 'earnings' ? 'Earnings' : 'Ex-dividend'} on ${fmtDate(e.date)} (${e.days === 0 ? 'today' : e.days === 1 ? 'tomorrow' : `in ${e.days} days`})`;

/** The adjust input for decide(). */
export function adjustFor({ g, events, levels, mode, kind }) {
  const a = { sizeMult: 1, buyAt: 0.12, shortAt: -0.12, convPenalty: 0, notes: [], levels: levels ? { long: levels.long, short: levels.short } : null, minRR: 1.5 };
  if (g?.available) {
    const label = labelFor(g, kind);
    if (label === 'risk-off') {
      a.sizeMult *= 0.5; a.buyAt = 0.2; a.convPenalty += 5;
      a.notes.push({ trade: `${regimeLine(g, kind)}, so we trade at half size and needed a stronger case to buy.`, hold: `${regimeLine(g, kind)}, so the bar for buying is higher and any trade would be at half size.` });
    } else if (label === 'risk-on') a.notes.push(`${regimeLine(g, kind)}, a supportive backdrop.`);
  }
  const earn = events.find(e => e.type === 'earnings');
  if (earn) {
    a.sizeMult *= 0.5;
    if (mode === 'trader' && earn.days <= 2) a.convPenalty += 10;
    a.notes.push({ trade: `${eventLine(earn)}: half size, because the report can gap the price straight through the stop.`, hold: `${eventLine(earn)}: any trade before the report would be at half size, because it can gap the price through the stop.` });
  }
  a.sizeMult = Math.round(a.sizeMult * 100) / 100;
  return a;
}
