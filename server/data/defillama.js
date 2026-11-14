// DefiLlama (free, no key): what a crypto protocol actually earns and holds.
//   TVL             value locked in the protocol, now and 30 days ago
//   Fees, revenue   what users paid in the last 24h / 30 days, and what the protocol kept
//   Chain TVL       for layer-1 coins (Solana, Ethereum...): value locked on the whole chain
// Coins map to DefiLlama by their CoinGecko id: chains and protocols list it as gecko_id; parent protocols
// (Uniswap, Aave...) are not in the list, but their slug is usually the CoinGecko id itself.
import { getJSON, memo } from './http.js';

const BASE = 'https://api.llama.fi';
const get = (path, ttl, timeout = 15000) => getJSON(BASE + path, { source: 'DefiLlama', ttl, timeout });
const soft = (p, label) => p.catch(e => (console.warn(`[defillama] ${label}: ${e.message}`), null));
const n = v => (v == null || !isFinite(v) ? null : +v);

/** gecko_id -> { slug, name, category, chains } for protocols, and gecko_id -> chain name for chains. Cached 12h. */
const maps = memo(async () => {
  const [protos, chains] = await Promise.all([soft(get('/protocols', 0, 30000), 'protocols'), soft(get('/v2/chains', 0), 'chains')]);
  const p = new Map(), c = new Map();
  for (const x of protos || []) if (x.gecko_id && !p.has(x.gecko_id)) p.set(x.gecko_id, { slug: x.slug, name: x.name, category: x.category, chains: (x.chains || []).slice(0, 5) });
  for (const x of chains || []) if (x.gecko_id) c.set(x.gecko_id, x.name);
  return { p, c, ok: !!(protos || chains) };
}, 12 * 3600e3);

const change30 = series => {
  if (!series?.length) return { now: null, ago: null };
  const now = series.at(-1), cut = now.date - 30 * 86400, ago = [...series].reverse().find(d => d.date <= cut) || series[0];
  return { now: n(now.tvl ?? now.totalLiquidityUSD), ago: n(ago.tvl ?? ago.totalLiquidityUSD) };
};

/** Fees or revenue summary: { d24, d30, prev30 (the 30 days before) } */
async function flow(slug, type) {
  const j = await soft(get(`/summary/fees/${slug}?dataType=${type}`, 60 * 60e3), `${type} ${slug}`);
  if (!j) return null;
  const chart = (j.totalDataChart || []).map(r => n(r[1])).filter(v => v != null);
  const sum = a => a.reduce((s, v) => s + v, 0);
  return { d24: n(j.total24h), d30: n(j.total30d), prev30: chart.length >= 60 ? sum(chart.slice(-60, -30)) : null };
}

/**
 * Everything DefiLlama knows about a coin, by CoinGecko id. null when it is neither a protocol nor a chain.
 * { kind: 'protocol'|'chain', name, category, chains, tvl, tvl30dAgo, fees, revenue }
 */
export async function forCoin(geckoId) {
  if (!geckoId) return null;
  const { p, c } = await maps();
  const chain = c.get(geckoId);
  if (chain) {
    const [hist, fees] = await Promise.all([soft(get(`/v2/historicalChainTvl/${encodeURIComponent(chain)}`, 60 * 60e3), `chain ${chain}`), soft(get(`/overview/fees/${encodeURIComponent(chain)}`, 60 * 60e3), `chain fees ${chain}`)]);
    const t = change30(hist);
    const ch = (fees?.totalDataChart || []).map(r => n(r[1])).filter(v => v != null), sum = a => a.reduce((s, v) => s + v, 0);
    return { kind: 'chain', name: chain, category: 'Chain', chains: [chain], tvl: t.now, tvl30dAgo: t.ago, fees: fees ? { d24: n(fees.total24h), d30: n(fees.total30d), prev30: ch.length >= 60 ? sum(ch.slice(-60, -30)) : null } : null, revenue: null };
  }
  const proto = p.get(geckoId);
  // not listed: try the CoinGecko id as the slug (a 400/404 means it is not a protocol)
  const slug = proto?.slug || (/^[a-z0-9-]+$/.test(geckoId) ? geckoId : null);
  if (!slug) return null;
  const detail = await get(`/protocol/${slug}`, 60 * 60e3, 25000).catch(e => (e.status >= 400 && e.status < 500 ? null : (console.warn(`[defillama] protocol ${slug}: ${e.message}`), null)));
  if (!detail?.name) return null;
  const [fees, revenue] = await Promise.all([flow(slug, 'dailyFees'), flow(slug, 'dailyRevenue')]);
  // parent protocols carry their TVL per chain only; sum the chain series when there is no top-level one
  const series = detail.tvl?.length ? detail.tvl : sumChains(detail.chainTvls);
  const t = change30(series);
  return { kind: 'protocol', name: proto?.name || detail.name, category: proto?.category || detail.category || null, chains: proto?.chains || (detail.chains || []).slice(0, 5), tvl: t.now, tvl30dAgo: t.ago, fees, revenue };
}

/** Add up per-chain TVL series by date (skipping borrowed/staking/pool2 double counts). */
function sumChains(chainTvls = {}) {
  const by = new Map();
  for (const [k, v] of Object.entries(chainTvls)) {
    if (/-|borrowed|staking|pool2|vesting|treasury/i.test(k)) continue;
    for (const d of v.tvl || []) by.set(d.date, (by.get(d.date) || 0) + (d.totalLiquidityUSD || 0));
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([date, tvl]) => ({ date, tvl }));
}
