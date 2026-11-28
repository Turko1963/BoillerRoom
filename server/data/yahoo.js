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

// POST (the screener) with the session; cached in memory by body
const posted = new Map();
async function ypost(path, body, ttl) {
  const key = path + JSON.stringify(body), hit = posted.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSession(attempt > 0);
    const r = await fetch(`${BASE}${path}?crumb=${encodeURIComponent(s.crumb)}`, { method: 'POST', headers: { 'User-Agent': UA, Cookie: s.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) })
      .catch(e => { throw new SourceError('Yahoo Finance', e.cause?.code || e.message); });
    if (r.ok) { const val = await r.json(); posted.set(key, { val, exp: Date.now() + ttl }); if (posted.size > 200) posted.delete(posted.keys().next().value); return val; }
    if (attempt === 0 && [401, 403, 429].includes(r.status)) continue;
    throw new SourceError('Yahoo Finance', `HTTP ${r.status}`, r.status);
  }
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

// Tel Aviv shares are quoted in agorot (ILA, 1/100 of a shekel): every price leaving this module is in shekels
const scale = currency => (currency === 'ILA' ? 0.01 : 1);
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
  const m = res.meta, f = scale(m.currency);
  if (f !== 1) for (const k of candles) { k.o *= f; k.h *= f; k.l *= f; k.c *= f; }
  // Tel Aviv: today's session can be missing from the daily candles while it trades; add it from the live quote
  const price = m.regularMarketPrice != null ? m.regularMarketPrice * f : candles.at(-1).c, day = t => new Date(t).toISOString().slice(0, 10);
  if (range !== 'max' && m.regularMarketTime && day(m.regularMarketTime * 1000) > day(candles.at(-1).t)) {
    const last = candles.at(-1).c, hi = m.regularMarketDayHigh != null ? m.regularMarketDayHigh * f : price, lo = m.regularMarketDayLow != null ? m.regularMarketDayLow * f : price;
    candles.push({ t: m.regularMarketTime * 1000, o: last, h: Math.max(hi, price, last), l: Math.min(lo, price, last), c: price, v: m.regularMarketVolume ?? null, live: true });
  }
  return {
    symbol: m.symbol, name: m.longName || m.shortName || '', currency: f !== 1 ? 'ILS' : m.currency, type: m.instrumentType,
    exchange: m.fullExchangeName || m.exchangeName || null, asOf: m.regularMarketTime ? m.regularMarketTime * 1000 : candles.at(-1).t,
    // chartPreviousClose is the close before the *range* starts, so use the previous daily candle
    price, prevClose: candles.at(-2)?.c ?? candles.at(-1).o, candles
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
  const sc = scale(p.currency), px = v => (num(v) == null ? null : num(v) * sc); // prices only: statements are in shekels already
  return {
    name: p.longName || p.shortName || '', sector: r.assetProfile?.sector || '', industry: r.assetProfile?.industry || '',
    marketCap: num(p.marketCap) ?? num(d.marketCap), price: px(p.regularMarketPrice), currency: sc !== 1 ? 'ILS' : p.currency || null,
    // the currency of the company's statements (Teva reports in dollars while its Tel Aviv shares trade in shekels)
    financialCurrency: f.financialCurrency || null,
    targetMean: px(f.targetMeanPrice), targetLow: px(f.targetLowPrice), targetHigh: px(f.targetHighPrice),
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

/** Candles at any interval: '1wk' for the weekly trend, '60m' for the intraday volume profile. */
export async function candles(symbol, range, interval) {
  const j = await yget(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`, { ttl: interval === '60m' ? 10 * 60e3 : 6 * 3600e3 });
  const res = j?.chart?.result?.[0];
  if (!res) throw new SourceError('Yahoo Finance', `no ${interval} chart for ${symbol}`, 404);
  const q = res.indicators.quote[0], f = scale(res.meta?.currency), m = v => (v == null ? null : v * f);
  return (res.timestamp || []).map((t, i) => ({ t: t * 1000, o: m(q.open[i]), h: m(q.high[i]), l: m(q.low[i]), c: m(q.close[i]), v: q.volume[i] })).filter(k => k.c != null && k.o != null);
}

/**
 * The deeper company modules: earnings surprises and estimate revisions, institutional holders,
 * insider buying and selling, and the live quote (bid, ask, pre-market). Missing parts are null.
 */
export async function insights(symbol) {
  const mods = 'earningsHistory,earningsTrend,institutionOwnership,majorHoldersBreakdown,insiderTransactions,netSharePurchaseActivity,price,summaryDetail';
  const j = await yget(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mods}`, { ttl: 30 * 60e3, crumb: true });
  const r = j?.quoteSummary?.result?.[0] || {};
  const eh = (r.earningsHistory?.history || []).map(h => ({ quarter: h.quarter?.fmt || null, actual: num(h.epsActual), estimate: num(h.epsEstimate), surprisePct: num(h.surprisePercent) != null ? +(num(h.surprisePercent) * 100).toFixed(1) : null })).filter(h => h.actual != null);
  const cy = (r.earningsTrend?.trend || []).find(t => t.period === '0y') || null;
  const rev = cy && { period: '0y', epsNow: num(cy.epsTrend?.current), eps30dAgo: num(cy.epsTrend?.['30daysAgo']), eps90dAgo: num(cy.epsTrend?.['90daysAgo']), up30d: num(cy.epsRevisions?.upLast30days), down30d: num(cy.epsRevisions?.downLast30days), growth: num(cy.growth) };
  const holders = (r.institutionOwnership?.ownershipList || []).slice(0, 5).map(h => ({ name: h.organization, pctHeld: num(h.pctHeld), changePct: num(h.pctChange) }));
  const mh = r.majorHoldersBreakdown || {}, ns = r.netSharePurchaseActivity || {};
  const since = Date.now() - 182 * 864e5;
  const ins = (r.insiderTransactions?.transactions || []).filter(t => num(t.startDate) * 1000 >= since).map(t => ({ who: t.filerName, role: t.filerRelation, text: t.transactionText || '', shares: num(t.shares), value: num(t.value), date: new Date(num(t.startDate) * 1000).toISOString().slice(0, 10) }));
  const buys = ins.filter(t => /purchase|buy/i.test(t.text)), sells = ins.filter(t => /sale|sell/i.test(t.text));
  const p = r.price || {}, d = r.summaryDetail || {}, sc = scale(p.currency), px = v => (num(v) == null ? null : num(v) * sc);
  return {
    earnings: eh.slice(-4), revisions: rev,
    holders, institutionsPct: num(mh.institutionsPercentHeld), insidersPct: num(mh.insidersPercentHeld), institutionCount: num(mh.institutionsCount),
    insider: { buys: buys.length, sells: sells.length, buyValue: buys.reduce((s, t) => s + (t.value || 0), 0), sellValue: sells.reduce((s, t) => s + (t.value || 0), 0), netShares6m: num(ns.netInfoShares), latest: ins.slice(0, 4) },
    quote: { bid: px(d.bid), ask: px(d.ask), bidSize: num(d.bidSize), askSize: num(d.askSize), preMarket: px(p.preMarketPrice), preMarketChangePct: num(p.preMarketChangePercent) != null ? +(num(p.preMarketChangePercent) * 100).toFixed(2) : null, postMarket: px(p.postMarketPrice), marketState: p.marketState || null }
  };
}

/** Options chain for the nearest expiry: put/call ratios and the implied volatility at the money. */
export async function options(symbol) {
  const j = await yget(`/v7/finance/options/${encodeURIComponent(symbol)}`, { ttl: 15 * 60e3, crumb: true });
  const r = j?.optionChain?.result?.[0], o = r?.options?.[0];
  if (!o) return null;
  return optionStats(o.calls || [], o.puts || [], num(r.quote?.regularMarketPrice), o.expirationDate);
}

/** Put/call ratios and at-the-money implied volatility from a chain. Exported for tests. */
export function optionStats(calls, puts, price, expiry) {
  const sum = (a, k) => a.reduce((s, x) => s + (num(x[k]) || 0), 0);
  const atm = side => side.filter(x => num(x.impliedVolatility) > 0).sort((a, b) => Math.abs(num(a.strike) - price) - Math.abs(num(b.strike) - price))[0];
  const c = atm(calls), p = atm(puts), ivs = [c, p].filter(Boolean).map(x => num(x.impliedVolatility));
  const cv = sum(calls, 'volume'), pv = sum(puts, 'volume'), co = sum(calls, 'openInterest'), po = sum(puts, 'openInterest');
  return {
    expiry: expiry ? new Date(expiry * 1000).toISOString().slice(0, 10) : null,
    putCallVolume: cv ? +(pv / cv).toFixed(2) : null, putCallOI: co ? +(po / co).toFixed(2) : null,
    atmIvPct: ivs.length && price ? +(ivs.reduce((s, v) => s + v, 0) / ivs.length * 100).toFixed(1) : null
  };
}

/**
 * The peer group: the biggest US companies in the same industry (Yahoo's screener), with their forward P/E.
 * [{symbol, name, forwardPe, marketCap}]. Without an industry: the stocks Yahoo users also look at, [{symbol, score}].
 */
export async function peers(symbol, industry) {
  if (industry) {
    const j = await ypost('/v1/finance/screener', { size: 9, offset: 0, sortField: 'intradaymarketcap', sortType: 'DESC', quoteType: 'EQUITY',
      query: { operator: 'AND', operands: [{ operator: 'eq', operands: ['region', 'us'] }, { operator: 'eq', operands: ['industry', industry] }] } }, 24 * 3600e3);
    const q = (j?.finance?.result?.[0]?.quotes || []).filter(x => x.symbol !== symbol).slice(0, 6);
    if (q.length >= 2) return q.map(x => ({ symbol: x.symbol, name: x.shortName || x.longName || x.symbol, forwardPe: num(x.forwardPE) ?? null, marketCap: num(x.marketCap) ?? null }));
  }
  const j = await yget(`/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}`, { ttl: 24 * 3600e3 });
  return (j?.finance?.result?.[0]?.recommendedSymbols || []).slice(0, 5).map(x => ({ symbol: x.symbol, score: x.score }));
}
