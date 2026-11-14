// Live market provider: real stocks (Yahoo Finance + SEC EDGAR) and crypto
// (Binance), all free and keyless. Exposes the same interface as demo.js, but
// async: movers(), chart(k), quote(k), round(brief, mode).
import * as yahooApi from '../data/yahoo.js';
import * as binanceApi from '../data/binance.js';
import * as secApi from '../data/sec.js';
import { SourceError } from '../data/http.js';
import * as desks from '../engine/desks.js';
import { decide } from '../engine/case.js';
import { hash, rng } from '../engine/random.js';
import { think } from '../engine/ai.js';

export const name = 'live';

// Coins that are always crypto, even if a stock uses the same ticker.
const MAJORS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'SHIB', 'TON', 'SUI', 'XLM', 'NEAR', 'APT', 'UNI', 'PEPE', 'ATOM', 'ARB', 'OP', 'FIL', 'HBAR', 'ICP', 'ETC', 'INJ', 'AAVE']);
const COINS = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB', DOGE: 'Dogecoin', ADA: 'Cardano', TRX: 'TRON', AVAX: 'Avalanche', LINK: 'Chainlink', DOT: 'Polkadot', LTC: 'Litecoin', BCH: 'Bitcoin Cash', SHIB: 'Shiba Inu', TON: 'Toncoin', SUI: 'Sui', XLM: 'Stellar', NEAR: 'NEAR Protocol', APT: 'Aptos', UNI: 'Uniswap', PEPE: 'Pepe', ATOM: 'Cosmos', ARB: 'Arbitrum', OP: 'Optimism', FIL: 'Filecoin', HBAR: 'Hedera', ICP: 'Internet Computer', ETC: 'Ethereum Classic', INJ: 'Injective', AAVE: 'Aave' };
// Capitalised words that are never a company or coin name.
const COMMON = new Set(['should', 'would', 'could', 'what', 'when', 'where', 'which', 'why', 'how', 'is', 'are', 'was', 'can', 'will', 'does', 'did', 'the', 'this', 'that', 'these', 'those', 'buy', 'sell', 'short', 'hold', 'long', 'term', 'stock', 'stocks', 'share', 'shares', 'coin', 'crypto', 'today', 'now', 'scout', 'flagged', 'takeover', 'talk', 'around', 'after', 'before', 'our', 'we', 'about', 'tell', 'give', 'find', 'any', 'some', 'something', 'worth', 'owning', 'position', 'trade', 'trap', 'compounder', 'into', 'earnings']);
// All-caps words that are not tickers.
const NOT_TICKERS = new Set(['I', 'A', 'OK', 'CEO', 'CFO', 'CTO', 'IPO', 'EPS', 'ETF', 'USD', 'US', 'USA', 'UK', 'EU', 'GDP', 'CPI', 'FED', 'FOMC', 'SEC', 'AGM', 'YOY', 'QOQ', 'ATH', 'DCA', 'FOMO', 'IMO', 'TLDR', 'PE', 'EV', 'ROI', 'NFT', 'DEFI']);

/**
 * Inject the data sources (tests pass fakes). Returns the provider.
 */
export function createLive({ yahoo = yahooApi, binance = binanceApi, sec = secApi } = {}) {

  /** Work out which instrument a brief is about. */
  async function resolve(brief) {
    const explicit = brief.match(/\b([A-Z0-9]{2,10})(?:-USD|USDT)\b/);
    if (explicit) return crypto(explicit[1]);
    const cands = [...brief.matchAll(/(\$)?\b([A-Z]{1,5}(?:[.-][A-Z]{1,2})?)\b/g)]
      .filter(m => (m[1] || m[2].length > 1) && !NOT_TICKERS.has(m[2])).map(m => m[2]);
    let liquid = null;
    for (const k of cands) {
      if (MAJORS.has(k)) return crypto(k);
      if (await sec.lookup(k).catch(() => null)) return stock(k);
      liquid ??= await binance.liquidBases().catch(() => new Set());
      if (liquid.has(k)) return crypto(k);
      if (await yahoo.chart(k, '5d').then(() => true, () => false)) return stock(k);
    }
    // No ticker: try a company or coin name ("Should we buy Apple?")
    const words = brief.replace(/[^\p{L}\p{N}\s&-]/gu, ' ').split(/\s+/).filter(w => /^\p{Lu}/u.test(w) && w.length > 2 && !COMMON.has(w.toLowerCase()));
    for (const w of words) {
      // the match must start with this exact word: "Apple" -> "Apple Inc.", but "Should" must not match "Shoulder"
      const first = q => (q.name || '').split(/[\s,.]+/)[0].toLowerCase();
      const hit = (await yahoo.search(w).catch(() => [])).find(q => ['EQUITY', 'ETF', 'CRYPTOCURRENCY'].includes(q.type) && first(q) === w.toLowerCase());
      if (hit) return hit.type === 'CRYPTOCURRENCY' ? crypto(hit.symbol.replace(/-USD$/, '')) : stock(hit.symbol);
    }
    return null;
  }
  const stock = k => ({ kind: 'stock', symbol: k, yahoo: k.replace('.', '-') });
  const crypto = k => ({ kind: 'crypto', symbol: k.toUpperCase(), base: k.toUpperCase() });

  async function prices(ins) {
    if (ins.kind === 'crypto') {
      const c = await binance.chart(ins.base, 365);
      return { ...c, name: COINS[ins.base] || ins.base };
    }
    return yahoo.chart(ins.yahoo, '1y');
  }

  /** Everything the seven desks need, fetched in parallel. Optional sources may fail. */
  async function gather(ins, mode) {
    const soft = p => p.catch(e => (console.warn('[data]', e.message), null));
    const px = await prices(ins);
    const isStock = ins.kind === 'stock';
    const [summary, secRef, news, bench, tick] = await Promise.all([
      isStock ? soft(yahoo.summary(ins.yahoo)) : null,
      isStock ? soft(sec.lookup(ins.symbol)) : null,
      soft(yahoo.news(isStock ? ins.symbol : COINS[ins.base] || ins.base, 8)),
      soft(isStock ? yahoo.chart('^GSPC', '3mo') : binance.chart('BTC', 60)),
      isStock ? null : soft(binance.tickers())
    ]);
    let secData = null;
    if (secRef) {
      const [facts, list] = await Promise.all([soft(sec.annualFacts(secRef.cik)), soft(sec.filings(secRef.cik))]);
      secData = { cik: secRef.cik, facts, filings: list || [] };
    }
    const rank = tick ? tick.findIndex(t => t.base === ins.base) + 1 : 0;
    return {
      kind: ins.kind, symbol: ins.symbol, mode, p: px.price, prevClose: px.prevClose,
      name: px.name || summary?.name || secRef?.name || ins.symbol,
      candles: px.candles, closes: px.candles.map(k => k.c),
      summary, sec: secData, news: news || [], bench: bench ? bench.candles.map(k => k.c) : [],
      cryptoRank: rank || null, quoteVolume24h: tick?.[rank - 1]?.quoteVolume ?? null
    };
  }

  /** brain: 'rules' (default), 'claude' or 'gemini'. */
  async function round(brief, mode, { brain = 'rules' } = {}) {
    const ins = await resolve(brief);
    if (!ins) throw Object.assign(new Error('No ticker found in the brief. Name a stock or coin, for example NVDA, Apple or BTC'), { source: 'brief', status: 422 });
    const x = await gather(ins, mode);
    const R = {}, M = {}, ANN = {};
    const put = (id, rep) => {
      const { metric, ann, score, conf, headline, findings, work, sources } = rep;
      R[id] = { score, stance: score > 0.2 ? 'bull' : score < -0.2 ? 'bear' : 'neutral', conf, headline, findings, work, sources };
      M[id] = metric;
      if (ann) ANN[id] = ann;
      return rep;
    };
    for (const id of ['analyst', 'filings', 'fundamental', 'technical', 'ma']) put(id, desks[id](x));
    const rk = put('risk', desks.risk(x));
    const dl = put('dealer', desks.dealer(x, rk));
    // The debate draws a few random choices; seed them with the brief and the day.
    const r = rng(hash(brief + '|' + mode + '|' + new Date().toISOString().slice(0, 10)));
    // an AI brain rewrites the desk views and the debate; the vote and ticket stay in decide()
    const ai = brain !== 'rules' ? await think({ brain, x, R, mode, brief }) : null;
    const c = decide({
      brief, mode, tk: x.symbol, T: x.symbol, name: x.name, p: x.p, R, M, ANN,
      vol: rk.vol, size: rk.size, lev: rk.lev, stopPct: rk.stopPct, slices: dl.slices, days: dl.days, unit: dl.unit, r,
      extra: { assetClass: x.kind, open: x.prevClose, asOf: new Date().toISOString(), live: true }, plan: ai?.plan
    });
    return ai ? ai.finish(c) : { ...c, brain: { id: 'rules', label: 'Rules' } };
  }

  /** Today's movers: top stock gainers and losers, plus the biggest crypto moves among liquid coins. */
  async function movers() {
    const [g, l, t] = await Promise.all([
      yahoo.screener('day_gainers', 6).catch(() => []), yahoo.screener('day_losers', 6).catch(() => []), binance.tickers().catch(() => [])
    ]);
    // Binance also lists tokenized stocks (NVDAB, SOXLB...): drop any base that is a stock ticker plus B
    const isStockToken = async x => {
      if (!/^[A-Z]{2,6}B$/.test(x.base)) return false;
      const stem = x.base.slice(0, -1);
      if (await sec.lookup(stem).catch(() => null)) return true;
      return (await yahoo.search(stem).catch(() => [])).some(q => q.symbol === stem && (q.type === 'EQUITY' || q.type === 'ETF'));
    };
    const top = t.slice(0, 50), flags = await Promise.all(top.map(isStockToken));
    const liquid = top.filter((x, i) => !flags[i]).slice(0, 40).sort((a, b) => b.c - a.c);
    const coin = x => ({ k: x.base, name: COINS[x.base] || x.base, c: +x.c.toFixed(2), p: x.p, vol: 1, cls: 'crypto' });
    const out = [
      ...g.map(x => ({ ...x, cls: 'stock' })), ...l.map(x => ({ ...x, cls: 'stock' })),
      ...liquid.slice(0, 4).filter(x => x.c > 0).map(coin), ...liquid.slice(-4).filter(x => x.c < 0).map(coin)
    ].filter(m => m.c != null && m.p != null);
    if (!out.length) throw new SourceError('Market data', 'no movers available right now', 503);
    return out;
  }

  /** Last 56 daily candles for the chart. */
  async function chart(k) {
    const ins = MAJORS.has(k) || (!(await sec.lookup(k).catch(() => null)) && (await binance.liquidBases().catch(() => new Set())).has(k)) ? crypto(k) : stock(k);
    const c = await prices(ins);
    return { ticker: ins.symbol, name: c.name, price: c.price, open: c.prevClose, assetClass: ins.kind, candles: c.candles.slice(-56).map(({ o, h, l, c }) => ({ o, h, l, c })) };
  }

  /** Current price, used when a ticket is executed. */
  async function quote(k, assetClass) {
    const c = assetClass === 'crypto' ? await binance.chart(k, 2) : await yahoo.chart(k.replace('.', '-'), '5d');
    return c.price;
  }

  return { name, resolve, gather, round, movers, chart, quote };
}

const live = createLive();
export const { resolve, round, movers, chart, quote } = live;
