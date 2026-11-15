// Asset performance for the side panel: how the asset moved today, this week, month to date, year to date and
// over 1, 3, 6 and 12 months, next to its benchmark (S&P 500 for stocks, Bitcoin for coins).
// Works from daily candles [{t, c, h, l}] (t in ms), newest last. Periods are by calendar date, not candle count,
// so stocks (5 sessions a week) and coins (7 days) both read right.

const DAY = 864e5;
const r2 = v => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);

/** Close of the last candle on or before time t (null when the history does not reach back that far). */
function closeAt(k, t) {
  if (!k.length || k[0].t > t) return null;
  let lo = 0, hi = k.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (k[m].t <= t) lo = m; else hi = m - 1; }
  return k[lo].c;
}

/** The periods: [{id, label, from (ms)}], relative to the last candle. */
export function periods(lastT) {
  const d = new Date(lastT), y = d.getUTCFullYear(), m = d.getUTCMonth();
  return [
    { id: '1d', label: 'Today', from: null },
    { id: '1w', label: 'This week', from: lastT - 7 * DAY },
    { id: 'mtd', label: 'Month to date', from: Date.UTC(y, m, 1) - 1 },
    { id: '1m', label: '1 month', from: lastT - 30 * DAY },
    { id: '3m', label: '3 months', from: lastT - 91 * DAY },
    { id: '6m', label: '6 months', from: lastT - 182 * DAY },
    { id: 'ytd', label: 'Year to date', from: Date.UTC(y, 0, 1) - 1 },
    { id: '1y', label: '1 year', from: lastT - 365 * DAY }
  ];
}

/** Returns per period for candles k, against benchmark candles b (optional). */
export function performance(k, b = null) {
  k = (k || []).filter(x => x && x.t != null && x.c != null);
  if (k.length < 2) return null;
  const last = k.at(-1), year = k.filter(x => x.t > last.t - 365 * DAY);
  const ret = (series, p) => {
    if (!series?.length) return null;
    const end = series.at(-1).c, start = p.from == null ? series.at(-2)?.c : closeAt(series, p.from);
    return start ? r2((end / start - 1) * 100) : null;
  };
  const hi = Math.max(...year.map(x => x.h ?? x.c)), lo = Math.min(...year.map(x => x.l ?? x.c));
  return {
    price: last.c, asOf: new Date(last.t).toISOString(),
    periods: periods(last.t).map(p => ({ id: p.id, label: p.label, pct: ret(k, p), bench: b ? ret(b, p) : null })),
    high52: hi, low52: lo, fromHighPct: r2((last.c / hi - 1) * 100), fromLowPct: r2((last.c / lo - 1) * 100)
  };
}
