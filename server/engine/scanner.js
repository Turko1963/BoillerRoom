// The scanner: which names on a fixed list deserve a debate today. Two stages, and only the first runs on its own:
//   1. cheap, no AI: the same data checks as a round (tradable, fresh, enough history, liquid), a catalyst with its source
//      and time (an earnings date, a recent headline), the move against the name's own volatility, and the cost under the
//      selected execution profile (or "unknown")
//   2. an AI debate, only on the top N, only when a person clicks, within a daily budget shown on the page
// The ranking is attention (how unusual, with what evidence), never an expected value, and never a recommendation.
// External text (headlines) is data: headlines that give orders are dropped and listed.
import { preflight, cleanExternal, LIMITS } from './checks.js';
import { counterpart } from '../data/tase.js';

// The universe: an explicit list, changed here or with SCAN_UNIVERSE (comma separated), plus the person's watch list.
// Liquid US shares and funds, the larger Tel Aviv shares, and the two largest coins.
export const UNIVERSE = {
  list: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'AMD', 'NFLX', 'JPM', 'V', 'XOM', 'LLY', 'UNH', 'COST', 'WMT', 'PLTR', 'INTC', 'BA',
    'SPY', 'QQQ', 'LUMI.TA', 'POLI.TA', 'TEVA.TA', 'ESLT.TA', 'NICE.TA', 'ICL.TA', 'BTC', 'ETH'],
  why: 'Large, liquid names where a plan\'s prices can hold; a short list keeps the free data sources within their limits.'
};
export const SCAN = {
  maxSymbols: 40,      // per scan, to stay within the free sources' rate limits
  topN: 3,             // how many of the ranked names may go to an AI debate
  aiPerDay: 3,         // AI debates started from the scanner per day (each is a paid model call); Rules debates are free
  catalystDays: 14,    // an earnings date this many days ahead counts as a catalyst
  newsHours: 48        // a headline this recent counts as a catalyst
};
export const symbolsOf = (env = process.env) => (env.SCAN_UNIVERSE ? env.SCAN_UNIVERSE.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : UNIVERSE.list);
export const settingsOf = (env = process.env) => ({ ...SCAN, topN: +env.SCAN_TOP_N || SCAN.topN, aiPerDay: env.SCAN_AI_BUDGET != null && env.SCAN_AI_BUDGET !== '' ? Math.max(0, +env.SCAN_AI_BUDGET || 0) : SCAN.aiPerDay });
export const SYMBOL = /^[A-Z0-9]{1,6}([.-][A-Z]{1,3})?$/;

const FX_ILS = 3.5, r2 = v => +v.toFixed(2);
const mean = a => a.reduce((t, v) => t + v, 0) / (a.length || 1);

/** Cost of a round trip under a profile, before any position exists (commission both ways plus the spread), or unknown. */
export function scanCost(profile) {
  if (!profile || profile.id === 'nobroker') return { status: 'n/a', text: 'No broker selected: no cost applied, nothing here is net.' };
  const F = profile.fields, need = ['commission', 'spread'], missing = need.filter(k => !F[k] || F[k].status === 'unknown');
  if (missing.length) return { status: 'unknown', missing, text: `Not verified for ${profile.name}: ${missing.join(', ')}.` };
  const status = need.map(k => F[k].status).includes('assumed') ? 'assumed' : need.map(k => F[k].status).includes('configured') ? 'configured' : 'observed';
  return { status, pct: r2(2 * F.commission.value + F.spread.value), text: `Commission both ways plus the spread under ${profile.name} (${status}).` };
}

/** One name through the cheap stage: { candidate } or { excluded: { symbol, why } }. */
export async function screen(symbol, sources, { profile = null, now = Date.now(), settings = SCAN, watched = false } = {}) {
  const px = await Promise.resolve(sources.prices(symbol)).catch(e => ({ error: e.message }));
  if (!px || px.error || !px.candles?.length) return { excluded: { symbol, why: `No price data (${px?.error || 'no candles'}).` } };
  const crypto = px.kind === 'crypto', c = px.candles;
  const x = { kind: px.kind, p: px.price, prevClose: c.at(-2)?.c, candles: c, currency: px.currency, instrument: { type: px.type || (crypto ? 'CRYPTO' : null), exchange: px.exchange, asOf: px.asOf } };
  const { vetoes } = preflight(x, now);
  if (vetoes.length) return { excluded: { symbol, why: vetoes.map(v => v.why).join(' ') } };
  // what the price did, against the name's own volatility (measured)
  const rets = c.slice(-21).map((k, i, a) => (i ? k.c / a[i - 1].c - 1 : null)).slice(1), vol = Math.sqrt(mean(rets.map(v => v * v))) * 100;
  const day = (px.price / c.at(-2).c - 1) * 100, week = c.length > 5 ? (px.price / c.at(-6).c - 1) * 100 : null, z = vol > 0 ? day / vol : 0;
  const last = c.slice(-20), traded = crypto ? mean(last.map(k => k.qv || k.v * k.c)) : mean(last.map(k => (k.v || 0) * k.c)) / (px.currency === 'ILS' ? FX_ILS : 1);
  // catalysts, each with its source and time
  const [sum, heads] = await Promise.all([crypto || !sources.summary ? null : Promise.resolve(sources.summary(symbol)).catch(() => null), sources.news ? Promise.resolve(sources.news(symbol)).catch(() => []) : []]);
  const clean = cleanExternal(heads || [], 'news'), catalysts = [];
  const ed = sum?.earningsDate, days = ed ? (ed - now) / 864e5 : null;
  if (days != null && days >= -1 && days <= settings.catalystDays) catalysts.push({ kind: 'earnings', what: `Earnings report ${days < 0.5 ? 'today or just out' : `in ${Math.round(days)} days`}`, when: new Date(ed).toISOString().slice(0, 10), source: 'Yahoo Finance calendar', readAt: new Date(now).toISOString() });
  // a headline counts only when it names the company or its ticker (a list of "stocks to buy" that mentions it does not)
  const base = symbol.replace(/[.-].*$/, ''), word = String(px.name || '').split(/[\s,.]+/).find(w => w.length > 2 && !/^(the|inc|corp|ltd)$/i.test(w)) || base;
  const names = new RegExp(`\\b(${[base, word].map(w => w.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean).join('|')})\\b`, 'i');
  const fresh = clean.items.filter(h => h.time && now - h.time <= settings.newsHours * 36e5 && names.test(h.title || '')).sort((a, b) => b.time - a.time);
  for (const h of fresh.slice(0, 2)) catalysts.push({ kind: 'news', what: String(h.title).slice(0, 160), when: new Date(h.time).toISOString(), source: h.publisher || 'news', link: h.link || null });
  // a hypothesis is "measured" when it rests on a dated event from a named source; a move with no known cause is "unverified"
  const unusual = Math.abs(z) >= 2;
  const basis = catalysts.length ? 'measured' : 'unverified';
  const hypothesis = catalysts.length ? `${catalysts[0].kind === 'earnings' ? catalysts[0].what : `A headline from the last ${settings.newsHours} hours names it`}: the room can test whether it moves ${symbol}.`
    : unusual ? `An unusual move (${r2(day)}% today, ${r2(Math.abs(z))}× its usual day) with no dated catalyst found: cause unknown.` : 'Nothing unusual found today.';
  const attention = r2(Math.min(3, Math.abs(z)) + (catalysts.some(k => k.kind === 'earnings') ? 1 : 0) + Math.min(1, fresh.length * 0.25) + (watched ? 0.5 : 0));
  return { candidate: {
    symbol, name: px.name || symbol, kind: px.kind, currency: px.currency || 'USD', price: px.price, asOf: px.asOf ? new Date(px.asOf).toISOString() : null, watched,
    measured: { dayPct: r2(day), weekPct: week == null ? null : r2(week), dailyVolPct: r2(vol), moveVsUsual: r2(z), tradedPerDay: Math.round(traded), tradedUnit: crypto ? 'USDT' : 'USD (shekels converted at 3.5)' },
    catalysts, basis, hypothesis, attention, cost: scanCost(profile),
    unverified: ['direction: not decided until a debate', ...(profile && profile.id !== 'nobroker' && scanCost(profile).status === 'unknown' ? ['costs under the selected broker'] : []), ...(catalysts.length ? [] : ['the cause of the move'])],
    dropped: clean.alerts
  } };
}

/**
 * The whole cheap stage over a list. sources: { prices(sym), summary(sym)?, news(sym)? } (injected, so tests never touch the
 * network). The same company listed twice (a Tel Aviv share and its New York twin) is kept once, the more traded listing.
 */
export async function scan({ symbols, sources, profile = null, now = Date.now(), settings = SCAN, watch = [], concurrency = 6 }) {
  const all = [...new Set([...symbols, ...watch].map(s => String(s).toUpperCase()))].filter(s => SYMBOL.test(s)), list = all.slice(0, settings.maxSymbols);
  const results = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => { while (next < list.length) { const i = next++; results[i] = await screen(list[i], sources, { profile, now, settings, watched: watch.includes(list[i]) }); } }));
  const excluded = results.filter(r => r.excluded).map(r => r.excluded).concat(all.slice(settings.maxSymbols).map(symbol => ({ symbol, why: `Over the ${settings.maxSymbols} names a scan reads.` })));
  // dedupe dual listings: one entry per company
  const byKey = new Map();
  for (const { candidate: k } of results.filter(r => r.candidate)) {
    const cp = counterpart(k.symbol), key = cp ? [k.symbol, cp.symbol].sort().join('|') : k.symbol, prev = byKey.get(key);
    if (!prev) byKey.set(key, k);
    else { const [keep, drop] = prev.measured.tradedPerDay >= k.measured.tradedPerDay ? [prev, k] : [k, prev]; keep.alsoListed = drop.symbol; byKey.set(key, keep); excluded.push({ symbol: drop.symbol, why: `The same company as ${keep.symbol}, which trades more.` }); }
  }
  // measured hypotheses first, then by attention; the top N are the only ones offered for an AI debate
  const ranked = [...byKey.values()].sort((a, b) => (a.basis === b.basis ? b.attention - a.attention : a.basis === 'measured' ? -1 : 1)).map((k, i) => ({ ...k, rank: i + 1, debate: i < settings.topN }));
  return {
    asOf: new Date(now).toISOString(), universe: { n: all.length, why: UNIVERSE.why }, profile: profile ? { id: profile.id, name: profile.name } : null,
    candidates: ranked, excluded, topN: settings.topN,
    limits: { minDollarVolume: LIMITS.minDollarVolume, catalystDays: settings.catalystDays, newsHours: settings.newsHours },
    note: 'Ranked by attention (how unusual, and whether a dated catalyst from a named source explains it), not by expected return. Not a recommendation; nothing here is traded.'
  };
}
