// News from several publishers, merged for the Market Analyst.
//
// Feeds (all public RSS, read only for headlines and links):
//   Financial Times   markets and companies sections
//   Investing.com     stock market news and cryptocurrency news
//   Google News       a search per stock or coin (the free, official RSS search)
//   Crypto Jungle     cryptojungle.co.il, Hebrew crypto news (crypto briefs only)
// Every feed is optional: one that fails or blocks us is skipped and logged once.
import { memo } from './http.js';

const UA = 'Mozilla/5.0';
const FEEDS = {
  ftMarkets: { name: 'Financial Times', url: 'https://www.ft.com/markets?format=rss' },
  ftCompanies: { name: 'Financial Times', url: 'https://www.ft.com/companies?format=rss' },
  invStocks: { name: 'Investing.com', url: 'https://www.investing.com/rss/news_25.rss' },
  invCrypto: { name: 'Investing.com', url: 'https://www.investing.com/rss/news_301.rss' },
  cryptoJungle: { name: 'Crypto Jungle', url: 'https://cryptojungle.co.il/feed' }
};

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m)
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? decode(m[1]) : ''; };

/** Parse RSS 2.0 items: [{ title, link, time, publisher }]. */
export function parseRss(xml, publisher) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(([it]) => {
    let title = tag(it, 'title'), pub = publisher;
    const src = tag(it, 'source');
    if (src) { pub = src; title = title.replace(new RegExp(`\\s+-\\s+${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), ''); }
    const t = Date.parse(tag(it, 'pubDate') || tag(it, 'dc:date'));
    return { title, link: tag(it, 'link'), time: isFinite(t) ? t : 0, publisher: pub };
  }).filter(i => i.title);
}

const warned = new Set();
async function fetchFeed(url, publisher) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(10000) });
    const body = await r.text();
    if (!r.ok || !/<rss|<feed|<item/i.test(body)) throw new Error(`HTTP ${r.status}${/cloudflare/i.test(body) ? ' (Cloudflare block)' : ''}`);
    return parseRss(body, publisher);
  } catch (e) {
    if (!warned.has(url)) { warned.add(url); console.warn(`[news] ${publisher} skipped: ${e.message}`); }
    return [];
  }
}
// section feeds are shared by every brief: refresh every 10 minutes
const section = memo(key => fetchFeed(FEEDS[key].url, FEEDS[key].name), 10 * 60e3);
const googleNews = memo(q => fetchFeed(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&hl=en-US&gl=US&ceid=US:en`, 'Google News'), 10 * 60e3);

/** Words that identify the asset in a headline: the ticker and the first word of its name ("Nvidia", "Bitcoin"). */
export function matchWords(symbol, name) {
  const w = [symbol];
  const first = (name || '').replace(/,?\s+(inc|corp|corporation|ltd|plc|co|company|holdings|group)\.?$/i, '').split(/\s+/)[0];
  if (first && first.length > 2 && first.toUpperCase() !== symbol) w.push(first);
  return w.filter(Boolean);
}
const mentions = (title, words) => words.some(w => new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`, 'i').test(title));
const norm = t => t.toLowerCase().replace(/[^a-z0-9֐-׿]+/g, ' ').trim().slice(0, 80);

/**
 * Headlines about one asset from every source, newest first and without duplicates.
 * extra: headlines already fetched elsewhere (Yahoo). Returns { items, sources: {publisher: count} }.
 */
export async function headlines({ kind, symbol, name, extra = [], limit = 14 }) {
  const words = matchWords(symbol, name), crypto = kind === 'crypto';
  const sections = crypto ? ['invCrypto', 'cryptoJungle'] : ['ftMarkets', 'ftCompanies', 'invStocks'];
  const q = crypto ? `${name || symbol} crypto` : `${symbol} stock`;
  const lists = await Promise.all([googleNews(q), ...sections.map(k => section(k))]);
  const [gn, ...secs] = lists;
  // section feeds carry everything: keep only the headlines that name this asset
  const relevant = secs.flatMap((l, i) => (sections[i] === 'cryptoJungle' ? l.filter(h => mentions(h.title, words) || mentions(h.title, [name || '']) || /ביטקוין|אתריום|סולנה/.test(h.title)) : l.filter(h => mentions(h.title, words))));
  const seen = new Set(), items = [];
  // Google News matches loosely: keep only results whose headline names the asset, and remember they came via Google News
  const google = gn.filter(h => mentions(h.title, words)).slice(0, 20).map(h => ({ ...h, via: 'Google News' }));
  // Yahoo's news search matches loosely too (crypto sites under a stock): keep only headlines that name the asset
  const yahoo = extra.filter(e => mentions(e.title || '', words) || (crypto && name && mentions(e.title || '', [name])));
  for (const h of [...yahoo.map(e => ({ ...e, publisher: e.publisher || 'Yahoo Finance' })), ...google, ...relevant]) {
    const k = norm(h.title);
    if (!k || seen.has(k)) continue;
    seen.add(k); items.push(h);
  }
  items.sort((a, b) => (b.time || 0) - (a.time || 0));
  const out = items.slice(0, limit), sources = {};
  // sources are the feeds we read (Google News, not every outlet behind it); the outlet stays on each headline
  for (const h of out) { const k = h.via || h.publisher; sources[k] = (sources[k] || 0) + 1; }
  return { items: out, sources };
}

const DEAL = /\b(acquir\w*|acquisition|merger|merge|takeover|buyout|bid|tender offer|stake|activist|deal talks|explor\w* (a )?sale|strategic (review|alternatives))\b/i;
/** Google News deal chatter in the last 30 days: headlines naming the company next to deal words. [{title, publisher, time, link}] */
export const dealNews = memo(async (symbol, name) => {
  const words = matchWords(symbol, name), q = `"${words.at(-1)}" (acquisition OR merger OR takeover OR buyout OR "tender offer" OR activist) when:30d`;
  const items = await fetchFeed(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, 'Google News');
  const seen = new Set();
  return items.filter(h => mentions(h.title, words) && DEAL.test(h.title)).filter(h => { const k = norm(h.title); return !seen.has(k) && seen.add(k); }).slice(0, 8);
}, 30 * 60e3);

/** Google News search (any query, Google's own operators like when:2d work), cached 10 minutes. [{title, publisher, time, link}] */
export const search = memo(q => fetchFeed(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, 'Google News'), 10 * 60e3);
