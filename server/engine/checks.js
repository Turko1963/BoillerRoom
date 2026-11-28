// Checks before the debate, all deterministic: is the data good enough to decide on, where every number comes from and how
// fresh it is, and is any outside text trying to give orders.
//
// preflight(x)    vetoes that turn any call into "No action" or "Watch" (they beat a majority), and the instrument
// sourcesOf(x)    the sources behind the round: name, what it gave, as of when, and how fresh (live, delayed, last close)
// cleanExternal() drops headlines and passages that contain instructions, and reports them
// Missing critical data (the price and its history) blocks the decision; missing optional sources only switch off the part
// that needs them (the desks already say "not available").

export const LIMITS = {
  staleDays: { stock: 5, crypto: 2 },   // calendar days since the last price before it counts as stale (covers weekends)
  minHistory: 60,                       // daily candles needed to set a stop at all
  minDollarVolume: 1e6,                 // average daily traded value (in dollars, shekels converted) below which we do not trade
  maxJumpPct: 50,                       // a move from the last close bigger than this is treated as a bad print or a split
  tradable: ['EQUITY', 'ETF', 'CRYPTO', 'CRYPTOCURRENCY']
};
const DAY = 864e5, FX_ILS = 3.5; // a conservative shekel rate for the liquidity floor only

/** Vetoes and the instrument. Each veto: { rule, by, limit, value, why }. */
export function preflight(x, now = Date.now()) {
  const vetoes = [], kind = x.kind === 'crypto' ? 'crypto' : 'stock', c = x.candles || [];
  const inst = { type: x.instrument?.type || (kind === 'crypto' ? 'CRYPTO' : null), exchange: x.instrument?.exchange || (kind === 'crypto' ? 'Binance' : null), currency: x.currency || 'USD', asOf: x.instrument?.asOf || c.at(-1)?.t || null };
  const veto = (rule, limit, value, why) => vetoes.push({ rule, by: 'Data check', limit, value, why });
  if (!(x.p > 0) || !Number.isFinite(x.p)) veto('data', 'a price above zero', String(x.p), 'No valid price: there is nothing to decide on.');
  if (inst.asOf) {
    const age = (now - inst.asOf) / DAY;
    if (age > LIMITS.staleDays[kind]) veto('data', `a price from the last ${LIMITS.staleDays[kind]} days`, `${Math.floor(age)} days old`, `The last price is ${Math.floor(age)} days old: the market data is stale, or it no longer trades.`);
  }
  if (c.length < LIMITS.minHistory) veto('data', `${LIMITS.minHistory} days of prices`, `${c.length} days`, `Only ${c.length} days of price history: not enough to set a stop.`);
  if (x.prevClose > 0 && x.p > 0 && Math.abs(x.p / x.prevClose - 1) * 100 > LIMITS.maxJumpPct) veto('data', `a move under ${LIMITS.maxJumpPct}% from the last close`, `${Math.round((x.p / x.prevClose - 1) * 100)}%`, 'The price jumped more than 50% from the last close: check for a split or a bad print before deciding.');
  if (inst.type && !LIMITS.tradable.includes(inst.type)) veto('data', 'a share, fund or coin', inst.type.toLowerCase(), `This is a ${inst.type.toLowerCase()}, not something to buy or sell directly.`);
  // liquidity: average traded value over the last 20 sessions
  const last = c.slice(-20).filter(k => k.v > 0 && k.c > 0);
  if (kind === 'stock' && last.length >= 10) {
    const value = last.reduce((t, k) => t + k.v * k.c, 0) / last.length / (x.currency === 'ILS' ? FX_ILS : 1);
    if (value < LIMITS.minDollarVolume) vetoes.push({ rule: 'liquidity', by: 'Risk check', limit: '$1m traded a day', value: `$${Math.round(value / 1e3)}k a day`, why: `Only about $${Math.round(value / 1e3)}k trades a day: too thin to get in and out at these prices.` });
  }
  return { vetoes, instrument: inst };
}

const fmt = t => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : null);
/** Where the numbers come from: [{ name, what, asOf, freshness }] (asOf as an ISO time, or null when unknown). */
export function sourcesOf(x, now = Date.now()) {
  const out = [], crypto = x.kind === 'crypto', priceAt = x.instrument?.asOf || x.candles?.at(-1)?.t || null;
  const closed = priceAt && now - priceAt > 30 * 60e3;
  out.push({ name: crypto ? 'Binance' : 'Yahoo Finance', what: 'price and daily candles', asOf: fmt(priceAt),
    freshness: crypto ? 'live exchange data' : closed ? 'last close (market closed)' : x.market === 'TASE' ? 'delayed, usually 15 to 20 minutes' : 'delayed up to 15 minutes' });
  if (x.summary) out.push({ name: 'Yahoo Finance', what: 'company figures and analyst targets', asOf: fmt(now), freshness: 'as reported; read now, cached up to 15 minutes' });
  const fil = x.sec?.filings?.[0];
  if (x.sec) out.push({ name: 'SEC EDGAR', what: 'annual figures and filings', asOf: fil?.date || null, freshness: fil ? `latest filing ${fil.form} of ${fil.date}` : 'no recent filing' });
  if (x.coingecko) out.push({ name: 'CoinGecko', what: 'market cap, supply and sentiment', asOf: fmt(now), freshness: 'read now, cached up to 10 minutes' });
  const newest = Math.max(0, ...(x.news || []).map(n => n.time || 0));
  if (x.news?.length) out.push({ name: Object.keys(x.newsSources || {}).join(', ') || 'News feeds', what: `${x.news.length} headlines`, asOf: newest ? fmt(newest) : null, freshness: newest ? 'newest headline' : 'time unknown' });
  if (x.bench?.length) out.push({ name: crypto ? 'Binance' : 'Yahoo Finance', what: `benchmark (${x.benchName || (crypto ? 'Bitcoin' : 'S&P 500')})`, asOf: null, freshness: 'daily closes' });
  if (x.regime?.available) out.push({ name: 'Yahoo Finance', what: 'market backdrop (VIX, S&P 500 trend, 10 year yield)', asOf: null, freshness: 'daily, cached up to 10 minutes' });
  const ext = x.ext || {}, have = Object.entries(ext).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)).map(([k]) => k);
  if (have.length) out.push({ name: 'Second-layer sources', what: have.join(', '), asOf: fmt(now), freshness: 'read now; each one optional' });
  return out;
}

// text that tries to give orders to a model: never followed, dropped and reported
const ORDERS = /\b(ignore|disregard|forget)\b[^.]{0,40}\b(instructions?|prompts?|rules)\b|\b(system prompt|you are now|act as an?|new instructions|jailbreak)\b|<\s*\/?\s*(system|instructions?|assistant)\s*>/i;
/** items: [{ title, ... }] or strings. -> { items (clean), alerts: [{ source, text }] } */
export function cleanExternal(items, source = 'news') {
  const alerts = [], keep = [];
  for (const it of items || []) {
    const text = typeof it === 'string' ? it : it?.title || '';
    if (ORDERS.test(text)) alerts.push({ source: typeof it === 'string' ? source : it.publisher || it.via || source, text: text.slice(0, 160) });
    else keep.push(it);
  }
  return { items: keep, alerts };
}
/** A long passage (a filing, an earnings release): drop the sentences that give orders. */
export function cleanPassage(text, source) {
  if (!text) return { text, alerts: [] };
  const alerts = [], parts = String(text).split(/(?<=[.!?])\s+/);
  const kept = parts.filter(s => (ORDERS.test(s) ? (alerts.push({ source, text: s.slice(0, 160) }), false) : true));
  return { text: kept.join(' '), alerts };
}
