// CoinGecko public API (free, no key needed): market cap, supply, all-time high, volume across
// all exchanges, and community sentiment votes for coins. The free API allows roughly 30 calls a
// minute, so the symbol lookup is cached for a day and coin data for 10 minutes.
// Optional: COINGECKO_API_KEY (a free "demo" key) raises the limits.
import { getJSON, memo } from './http.js';

const BASE = 'https://api.coingecko.com/api/v3';
const headers = () => (process.env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } : {});
const get = (path, ttl) => getJSON(BASE + path, { source: 'CoinGecko', ttl, headers: headers() });

/** Symbol (SOL) -> CoinGecko id (solana): the coin with that symbol and the best market cap rank. */
export const idFor = memo(async symbol => {
  const j = await get(`/search?query=${encodeURIComponent(symbol)}`, 24 * 3600e3);
  const c = (j.coins || []).filter(x => (x.symbol || '').toUpperCase() === symbol.toUpperCase())
    .sort((a, b) => (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9))[0];
  return c?.id || null;
}, 24 * 3600e3);

const n = v => (v == null || !isFinite(v) ? null : +v);

/** The figures the crypto desks use, or null if CoinGecko does not know the coin. */
export async function coin(symbol) {
  const id = await idFor(symbol);
  if (!id) return null;
  const j = await get(`/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`, 10 * 60e3);
  const m = j.market_data || {};
  return {
    id, name: j.name, rank: n(j.market_cap_rank), categories: (j.categories || []).filter(Boolean).slice(0, 4),
    genesis: j.genesis_date || null, hashing: j.hashing_algorithm || null,
    price: n(m.current_price?.usd), marketCap: n(m.market_cap?.usd), fdv: n(m.fully_diluted_valuation?.usd), volume24h: n(m.total_volume?.usd),
    circulating: n(m.circulating_supply), total: n(m.total_supply), max: n(m.max_supply),
    ath: n(m.ath?.usd), athChangePct: n(m.ath_change_percentage?.usd), athDate: m.ath_date?.usd || null,
    atl: n(m.atl?.usd), change7d: n(m.price_change_percentage_7d), change30d: n(m.price_change_percentage_30d), change1y: n(m.price_change_percentage_1y),
    sentimentUp: n(j.sentiment_votes_up_percentage)
  };
}
