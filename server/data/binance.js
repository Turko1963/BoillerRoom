// Binance public market data (free, no key): crypto prices, daily candles,
// taker buy/sell volume and the day's movers. Only USDT pairs are used.
// data-api.binance.vision is Binance's public market-data mirror; it also works
// where api.binance.com is geo-restricted.
import { getJSON, SourceError } from './http.js';

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

async function bget(path, ttl) {
  let last;
  for (const h of HOSTS) {
    try { return await getJSON(h + path, { source: 'Binance', ttl }); } catch (e) {
      last = e;
      if (e.status === 400) break; // bad symbol: no point trying the other host
    }
  }
  throw last;
}

/** All USDT pairs with their 24h stats, biggest volume first. */
export async function tickers() {
  const all = await bget('/api/v3/ticker/24hr', 60e3);
  return all.filter(t => t.symbol.endsWith('USDT') && +t.quoteVolume > 0 && +t.lastPrice > 0)
    .map(t => ({ base: t.symbol.slice(0, -4), symbol: t.symbol, p: +t.lastPrice, c: +t.priceChangePercent, quoteVolume: +t.quoteVolume, volume: +t.volume }))
    .filter(t => !/^(USDC|FDUSD|TUSD|BUSD|USDP|DAI|EUR|AEUR|USD1|XUSD|BFUSD|RLUSD)$/.test(t.base) && !/(UP|DOWN|BULL|BEAR)$/.test(t.base))
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
}

/** Bases that are liquid enough to treat as "crypto" when they appear in a brief. */
export async function liquidBases(min = 5e6) {
  return new Set((await tickers()).filter(t => t.quoteVolume >= min).map(t => t.base));
}

/** Daily candles for BASEUSDT. Returns { symbol, price, prevClose, candles:[{t,o,h,l,c,v,qv,takerBuyQv}] }. */
export async function chart(base, days = 365) {
  const sym = base.toUpperCase() + 'USDT';
  let rows;
  try { rows = await bget(`/api/v3/klines?symbol=${sym}&interval=1d&limit=${Math.min(1000, days)}`, 60e3); } catch (e) {
    if (e.status === 400) throw new SourceError('Binance', `no market for ${sym}`, 404);
    throw e;
  }
  if (!rows.length) throw new SourceError('Binance', `no prices for ${sym}`, 404);
  const candles = rows.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7], takerBuyQv: +k[10] }));
  return { symbol: sym, price: candles.at(-1).c, prevClose: candles.at(-2)?.c ?? candles.at(-1).o, candles };
}

/** Every daily candle since BASEUSDT was listed on Binance (pages of 1000), oldest first. Cached 30 minutes. */
const fullCache = new Map();
export async function fullChart(base) {
  const sym = base.toUpperCase() + 'USDT', hit = fullCache.get(sym);
  if (hit && hit.exp > Date.now()) return hit.val;
  const out = [];
  let start = 0;
  for (let page = 0; page < 8; page++) {
    let rows;
    try { rows = await bget(`/api/v3/klines?symbol=${sym}&interval=1d&limit=1000&startTime=${start}`, 30 * 60e3); } catch (e) {
      if (e.status === 400) throw new SourceError('Binance', `no market for ${sym}`, 404);
      throw e;
    }
    out.push(...rows.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })));
    if (rows.length < 1000) break;
    start = rows.at(-1)[0] + 1;
  }
  if (!out.length) throw new SourceError('Binance', `no prices for ${sym}`, 404);
  fullCache.set(sym, { val: out, exp: Date.now() + 30 * 60e3 });
  return out;
}
