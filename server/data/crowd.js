// The crowd's mood, for the Market Analyst (free, no key):
//   StockTwits          the last 30 messages on a ticker, with the bullish / bearish tags their authors chose
//                       (Cloudflare blocks some server IPs: then it pauses itself for 6 hours)
//   Fear & Greed        alternative.me's crypto Fear & Greed index (0 = extreme fear, 100 = extreme greed)
//   GDELT               the average tone of world news coverage over the last week (GDELT DOC 2.0 API,
//                       one request every 5 seconds at most, so calls are queued and cached for 30 minutes)
// Each call returns null when the source fails, so one blocked source never stops a round.
import { getJSON, memo, breaker } from './http.js';

const UA = { 'User-Agent': 'Mozilla/5.0' };

/** StockTwits stream: { messages, bull, bear, bullPct (of tagged), watchers, spanHours } or null. */
export const stocktwits = breaker('StockTwits', async (symbol, kind = 'stock') => {
  const sym = kind === 'crypto' ? `${symbol}.X` : symbol;
  const j = await getJSON(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(sym)}.json`, { source: 'StockTwits', ttl: 10 * 60e3, headers: UA, timeout: 6000 });
  return twitsStats(j);
});

/** Bullish / bearish counts from a StockTwits stream. Exported for tests. */
export function twitsStats(j) {
  const msgs = j?.messages;
  if (!Array.isArray(msgs) || !msgs.length) return null;
  let bull = 0, bear = 0;
  for (const m of msgs) { const s = m.entities?.sentiment?.basic; if (s === 'Bullish') bull++; else if (s === 'Bearish') bear++; }
  const times = msgs.map(m => Date.parse(m.created_at)).filter(isFinite);
  const spanH = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3600e3 : null;
  return { messages: msgs.length, bull, bear, bullPct: bull + bear ? Math.round(bull / (bull + bear) * 100) : null, watchers: j.symbol?.watchlist_count ?? null, spanHours: spanH != null ? +spanH.toFixed(1) : null };
}

/** Crypto Fear & Greed: { value, label, prev, prevLabel } or null. Shared by every coin. */
const fng = breaker('Fear & Greed', async () => {
  const j = await getJSON('https://api.alternative.me/fng/?limit=2', { source: 'Fear & Greed', ttl: 30 * 60e3, headers: UA, timeout: 6000 });
  const [a, b] = j?.data || [];
  return a ? { value: +a.value, label: a.value_classification, prev: b ? +b.value : null, prevLabel: b?.value_classification || null } : null;
});
export const fearGreed = () => fng();

// GDELT allows one request every 5 seconds: run them one after another, 5.5 seconds apart
let queue = Promise.resolve(), last = 0;
const gdeltGet = url => {
  const run = queue.then(async () => {
    const wait = last + 5500 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    return getJSON(url, { source: 'GDELT', headers: UA, timeout: 15000 });
  });
  queue = run.catch(() => {}); // a failed call must not block the ones after it
  return run;
};

/**
 * GDELT: average tone of English news about a name over 7 days (about -10..+10, most news sits between -3 and +3),
 * and the tone over the last day. { tone, recent, points } or null. Cached 30 minutes.
 */
export const newsTone = memo(breaker('GDELT', async name => {
  const q = `"${name.replace(/"/g, '')}" sourcelang:english`;
  const j = await gdeltGet(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=timelinetone&format=json&timespan=7d`);
  return toneStats(j);
}), 30 * 60e3);

/** Week and last-day tone from a GDELT timeline. Exported for tests. */
export function toneStats(j) {
  const pts = (j?.timeline?.[0]?.data || []).map(d => +d.value).filter(isFinite);
  if (pts.length < 4) return null;
  const avg = a => a.reduce((s, v) => s + v, 0) / a.length, day = Math.max(1, Math.round(pts.length / 7));
  return { tone: +avg(pts).toFixed(2), recent: +avg(pts.slice(-day)).toFixed(2), points: pts.length };
}
