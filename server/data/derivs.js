// Crypto derivatives and order books (free, no key):
//   Funding and open interest   Binance USDT-M futures; Bybit, then OKX, when Binance futures is blocked
//   Long/short ratio            Binance: share of accounts long against short (a crowding gauge)
//   DVOL                        Deribit's 30-day implied volatility index (BTC and ETH only)
//   Order-book depth            Binance spot book: how much money sits within 1% and 2% of the price
// Every function returns null when its sources fail.
import { getJSON } from './http.js';

const soft = (p, label) => p.catch(e => (label && console.warn(`[derivs] ${label}: ${e.message}`), null));
const n = v => (v == null || v === '' || !isFinite(v) ? null : +v);

/** Perpetual futures: { venue, fundingPct (per 8h), fundingAnnualPct, openInterestUsd, oiChange1dPct, longPct } or null. */
export async function perp(base) {
  const sym = base.toUpperCase() + 'USDT', F = 'https://fapi.binance.com';
  const [prem, oi, oiHist, ls] = await Promise.all([
    soft(getJSON(`${F}/fapi/v1/premiumIndex?symbol=${sym}`, { source: 'Binance futures', ttl: 5 * 60e3 })),
    soft(getJSON(`${F}/fapi/v1/openInterest?symbol=${sym}`, { source: 'Binance futures', ttl: 5 * 60e3 })),
    soft(getJSON(`${F}/futures/data/openInterestHist?symbol=${sym}&period=1d&limit=2`, { source: 'Binance futures', ttl: 30 * 60e3 })),
    soft(getJSON(`${F}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=1d&limit=2`, { source: 'Binance futures', ttl: 30 * 60e3 }))
  ]);
  if (prem && n(prem.lastFundingRate) != null) {
    const mark = n(prem.markPrice), f = n(prem.lastFundingRate) * 100, h = Array.isArray(oiHist) ? oiHist : [];
    const oiUsd = oi && mark ? n(oi.openInterest) * mark : n(h.at(-1)?.sumOpenInterestValue);
    const prevUsd = h.length >= 2 ? n(h.at(-2).sumOpenInterestValue) : null;
    const l = Array.isArray(ls) && ls.length ? n(ls.at(-1).longAccount) : null;
    return { venue: 'Binance futures', fundingPct: +f.toFixed(4), fundingAnnualPct: +(f * 3 * 365).toFixed(1), openInterestUsd: oiUsd, oiChange1dPct: oiUsd && prevUsd ? +((oiUsd / prevUsd - 1) * 100).toFixed(1) : null, longPct: l != null ? Math.round(l * 100) : null };
  }
  // Binance futures is geo-blocked in some regions: Bybit, then OKX
  const by = await soft(getJSON(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}`, { source: 'Bybit', ttl: 5 * 60e3 }));
  const t = by?.result?.list?.[0];
  if (t && n(t.fundingRate) != null) {
    const f = n(t.fundingRate) * 100;
    return { venue: 'Bybit', fundingPct: +f.toFixed(4), fundingAnnualPct: +(f * 3 * 365).toFixed(1), openInterestUsd: n(t.openInterestValue), oiChange1dPct: null, longPct: null };
  }
  const ok = await soft(getJSON(`https://www.okx.com/api/v5/public/funding-rate?instId=${base.toUpperCase()}-USDT-SWAP`, { source: 'OKX', ttl: 5 * 60e3 }));
  const o = ok?.data?.[0];
  if (o && n(o.fundingRate) != null) {
    const f = n(o.fundingRate) * 100;
    return { venue: 'OKX', fundingPct: +f.toFixed(4), fundingAnnualPct: +(f * 3 * 365).toFixed(1), openInterestUsd: null, oiChange1dPct: null, longPct: null };
  }
  return null;
}

/** Deribit DVOL for BTC or ETH: { value, weekAgo, high30, low30 } or null for other coins. */
export async function dvol(base) {
  const cur = base.toUpperCase();
  if (cur !== 'BTC' && cur !== 'ETH') return null;
  const end = Date.now(), start = end - 31 * 864e5;
  const j = await soft(getJSON(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${cur}&resolution=86400&start_timestamp=${start}&end_timestamp=${end}`, { source: 'Deribit', ttl: 30 * 60e3 }), 'Deribit');
  const rows = (j?.result?.data || []).map(r => ({ t: r[0], c: n(r[4]) })).filter(r => r.c != null).sort((a, b) => a.t - b.t);
  if (rows.length < 2) return null;
  const cs = rows.map(r => r.c);
  return { value: +cs.at(-1).toFixed(1), weekAgo: +(cs.at(-8) ?? cs[0]).toFixed(1), high30: +Math.max(...cs).toFixed(1), low30: +Math.min(...cs).toFixed(1) };
}

/** Binance spot order book: { mid, spreadBps, bid1, ask1, bid2, ask2 } (USD within 1% and 2% of mid) or null. */
export async function depth(base) {
  const sym = base.toUpperCase() + 'USDT';
  const j = await soft(getJSON(`https://data-api.binance.vision/api/v3/depth?symbol=${sym}&limit=1000`, { source: 'Binance', ttl: 60e3 }))
    ?? await soft(getJSON(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=1000`, { source: 'Binance', ttl: 60e3 }));
  return j ? bookStats(j.bids, j.asks) : null;
}

/** Order-book figures from [[price, qty]] levels. Exported for tests. */
export function bookStats(bids = [], asks = []) {
  const B = bids.map(([p, q]) => [+p, +q]), A = asks.map(([p, q]) => [+p, +q]);
  if (!B.length || !A.length) return null;
  const mid = (B[0][0] + A[0][0]) / 2, within = (side, pct, dir) => side.filter(([p]) => dir * (p - mid) / mid <= pct).reduce((s, [p, q]) => s + p * q, 0);
  return { mid, spreadBps: +((A[0][0] - B[0][0]) / mid * 1e4).toFixed(2), bid1: within(B, 0.01, -1), ask1: within(A, 0.01, 1), bid2: within(B, 0.02, -1), ask2: within(A, 0.02, 1) };
}

/** Deribit DVOL daily closes for the last 30 days (BTC, ETH), oldest first, for the volatility watch. */
export async function dvolSeries(base) {
  const cur = base.toUpperCase();
  if (cur !== 'BTC' && cur !== 'ETH') return null;
  const end = Date.now(), start = end - 31 * 864e5;
  const j = await soft(getJSON(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${cur}&resolution=86400&start_timestamp=${start}&end_timestamp=${end}`, { source: 'Deribit', ttl: 30 * 60e3 }), 'Deribit');
  return (j?.result?.data || []).sort((a, b) => a[0] - b[0]).map(r => +r[4]).filter(isFinite);
}

/** Binance top traders (the largest accounts): share of their futures positions that is long. { longPct, ratio } or null. */
export async function topTraders(base) {
  const sym = base.toUpperCase() + 'USDT';
  const j = await soft(getJSON(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${sym}&period=1d&limit=2`, { source: 'Binance futures', ttl: 30 * 60e3 }), 'Binance top traders');
  const r = Array.isArray(j) && j.length ? j.at(-1) : null;
  return r && isFinite(+r.longAccount) ? { longPct: Math.round(+r.longAccount * 100), ratio: +(+r.longShortRatio).toFixed(2) } : null;
}
