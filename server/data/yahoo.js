// Yahoo Finance (unofficial, free, no key): stock prices, candles, company
// figures, analyst ratings, news and the day's movers.
// Some endpoints need a session cookie and a "crumb"; we get both once and
// refresh them when Yahoo rejects a request.
import { getJSON, SourceError } from './http.js';

// A plain UA works; a full desktop-browser string without the other browser headers gets 429.
const UA = 'Mozilla/5.0';
const BASE = 'https://query2.finance.yahoo.com';
let session = null; // { cookie, crumb, exp }

async function getSession(force) {
  if (!force && session && session.exp > Date.now()) return session;
  let cookie = '';
  try {
    const r = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  } catch { /* fc.yahoo.com can fail; try without a cookie */ }
  const r = await fetch(`${BASE}/v1/test/getcrumb`, { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(10000) })
    .catch(e => { throw new SourceError('Yahoo Finance', e.cause?.code || e.message); });
  const crumb = r.ok ? (await r.text()).trim() : '';
  if (!crumb) throw new SourceError('Yahoo Finance', `could not start a session (HTTP ${r.status})`, r.status);
  session = { cookie, crumb, exp: Date.now() + 6 * 3600e3 };
  return session;
}

async function yget(path, { ttl = 60e3, crumb = false } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSession(attempt > 0);
    const url = BASE + path + (crumb ? `${path.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(s.crumb)}` : '');
    try {
      return await getJSON(url, { source: 'Yahoo Finance', ttl, headers: { 'User-Agent': UA, Cookie: s.cookie } });
    } catch (e) {
      if (attempt === 0 && (e.status === 401 || e.status === 403 || e.status === 429)) continue;
      throw e;
    }
  }
}

const num = v => (v && typeof v === 'object' ? v.raw : v) ?? null;

/** Daily candles. Returns { symbol, name, currency, price, prevClose, candles:[{t,o,h,l,c,v}] }. */
export async function chart(symbol, range = '1y') {
  const j = await yget(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`, { ttl: 60e3 });
  const res = j?.chart?.result?.[0];
  if (!res) throw new SourceError('Yahoo Finance', `no chart for ${symbol}`, 404);
  const q = res.indicators.quote[0], ts = res.timestamp || [];
  const candles = ts.map((t, i) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] }))
    .filter(k => k.o != null && k.c != null && k.h != null && k.l != null);
  if (!candles.length) throw new SourceError('Yahoo Finance', `no prices for ${symbol}`, 404);
  const m = res.meta;
  return {
    symbol: m.symbol, name: m.longName || m.shortName || '', currency: m.currency, type: m.instrumentType,
    // chartPreviousClose is the close before the *range* starts, so use the previous daily candle
    price: m.regularMarketPrice ?? candles.at(-1).c, prevClose: candles.at(-2)?.c ?? candles.at(-1).o, candles
  };
}

/** Company figures, analyst targets and ratings. Missing modules come back as {}. */
export async function summary(symbol) {
  const mods = 'price,summaryDetail,financialData,defaultKeyStatistics,recommendationTrend,assetProfile,calendarEvents';
  const j = await yget(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mods}`, { ttl: 15 * 60e3, crumb: true });
  const r = j?.quoteSummary?.result?.[0] || {};
  const f = r.financialData || {}, k = r.defaultKeyStatistics || {}, d = r.summaryDetail || {}, p = r.price || {};
  const cal = r.calendarEvents || {}, toMs = v => (num(v) ? num(v) * 1000 : null);
  const t = r.recommendationTrend?.trend?.find(x => x.period === '0m') || r.recommendationTrend?.trend?.[0] || null;
  return {
    name: p.longName || p.shortName || '', sector: r.assetProfile?.sector || '', industry: r.assetProfile?.industry || '',
    marketCap: num(p.marketCap) ?? num(d.marketCap), price: num(p.regularMarketPrice),
    targetMean: num(f.targetMeanPrice), targetLow: num(f.targetLowPrice), targetHigh: num(f.targetHighPrice),
    analysts: num(f.numberOfAnalystOpinions), recommendation: f.recommendationKey || null,
    trend: t && { strongBuy: t.strongBuy, buy: t.buy, hold: t.hold, sell: t.sell, strongSell: t.strongSell },
    fcf: num(f.freeCashflow), ocf: num(f.operatingCashflow), netIncome: num(k.netIncomeToCommon),
    revenueGrowth: num(f.revenueGrowth), operatingMargin: num(f.operatingMargins), grossMargin: num(f.grossMargins),
    roe: num(f.returnOnEquity), debt: num(f.totalDebt), cash: num(f.totalCash), ebitda: num(f.ebitda),
    pe: num(d.trailingPE), forwardPe: num(d.forwardPE), evToEbitda: num(k.enterpriseToEbitda),
    institutions: num(k.heldPercentInstitutions), insiders: num(k.heldPercentInsiders), shortFloat: num(k.shortPercentOfFloat),
    avgVolume: num(d.averageVolume),
    // upcoming events: the next earnings report (first date of its window) and the ex-dividend date
    earningsDate: toMs(cal.earnings?.earningsDate?.[0]), exDividendDate: toMs(cal.exDividendDate) ?? toMs(d.exDividendDate)
  };
}

/** Latest news headlines for a query. */
export async function news(q, count = 8) {
  const j = await yget(`/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=${count}&quotesCount=0`, { ttl: 5 * 60e3 });
  return (j.news || []).map(n => ({ title: n.title, publisher: n.publisher, time: (n.providerPublishTime || 0) * 1000, link: n.link }));
}

/** Search symbols by name or ticker. */
export async function search(q) {
  const j = await yget(`/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=0&quotesCount=6`, { ttl: 60 * 60e3 });
  return (j.quotes || []).map(x => ({ symbol: x.symbol, name: x.longname || x.shortname || '', type: x.quoteType }));
}

/** Predefined screeners: day_gainers, day_losers, most_actives. */
export async function screener(id, count = 10) {
  const j = await yget(`/v1/finance/screener/predefined/saved?scrIds=${id}&count=${count}`, { ttl: 2 * 60e3, crumb: true });
  return (j?.finance?.result?.[0]?.quotes || []).map(x => ({
    k: x.symbol, name: x.longName || x.shortName || '', c: x.regularMarketChangePercent, p: x.regularMarketPrice,
    vol: x.averageDailyVolume3Month ? +(x.regularMarketVolume / x.averageDailyVolume3Month).toFixed(1) : 1
  }));
}
