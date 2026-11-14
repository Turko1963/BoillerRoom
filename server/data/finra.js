// FINRA daily short sale volume (free, no key): the share of each stock's off-exchange volume
// that was sold short, from FINRA's consolidated Reg SHO file. A day's file covers every US
// stock (about 1 MB), so it is fetched once and kept for 12 hours. Cloudflare blocks some server IPs:
// after a block the source pauses itself for 6 hours.
import { memo } from './http.js';

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Parse "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market" lines into symbol -> { short, total }. */
export function parseShortFile(txt) {
  const m = new Map();
  for (const line of txt.split('\n')) {
    const [, sym, sv, , tv] = line.trim().split('|');
    if (!sym || !isFinite(+sv) || !isFinite(+tv) || +tv <= 0 || sym === 'Symbol') continue;
    m.set(sym, { short: +sv, total: +tv });
  }
  return m;
}

let blockedUntil = 0;
const day = memo(async date => {
  try {
    const r = await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${date}.txt`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    if (r.status === 403 || r.status === 429) { blockedUntil = Date.now() + 6 * 3600e3; console.warn(`[FINRA] blocked (HTTP ${r.status}), paused`); return null; }
    return r.ok ? parseShortFile(await r.text()) : null;
  } catch { return null; }
}, 12 * 3600e3);

/** Short volume share for the last 5 trading days found: { latestPct, avgPct, days, date } or null. */
export async function shortVolume(symbol, now = Date.now()) {
  const sym = symbol.toUpperCase().replace('-', '.'), rows = [];
  for (let back = 0; back < 10 && rows.length < 5 && Date.now() >= blockedUntil; back++) {
    const d = new Date(now - back * 864e5);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const m = await day(ymd(d));
    const x = m?.get(sym);
    if (x) rows.push({ date: d.toISOString().slice(0, 10), pct: x.short / x.total * 100 });
    else if (!m && back > 6 && !rows.length) break;
  }
  if (!rows.length) return null;
  return { latestPct: +rows[0].pct.toFixed(1), avgPct: +(rows.reduce((s, r) => s + r.pct, 0) / rows.length).toFixed(1), days: rows.length, date: rows[0].date };
}
