// Live market provider: real stocks (Yahoo Finance + SEC EDGAR) and crypto
// (Binance), all free and keyless. Exposes the same interface as demo.js, but
// async: movers(), chart(k), quote(k), round(brief, mode).
import * as yahooApi from '../data/yahoo.js';
import * as binanceApi from '../data/binance.js';
import * as secApi from '../data/sec.js';
import * as newsApi from '../data/news.js';
import * as coingeckoApi from '../data/coingecko.js';
import * as crowdApi from '../data/crowd.js';
import * as defillamaApi from '../data/defillama.js';
import * as derivsApi from '../data/derivs.js';
import * as finraApi from '../data/finra.js';
import * as ftcApi from '../data/ftc.js';

// stand-ins used when a test passes its own fake sources, so tests never reach the network
const NO_NEWS = { headlines: async ({ extra = [] }) => ({ items: extra, sources: extra.length ? { 'Yahoo Finance': extra.length } : {} }) };
const NO_COINGECKO = { coin: async () => null, markets: async () => null };
const NONE = new Proxy({}, { get: () => async () => null });
import { SourceError, within } from '../data/http.js';
import * as desks from '../engine/desks.js';
import { decide } from '../engine/case.js';
import { hash, rng } from '../engine/random.js';
import { think } from '../engine/ai.js';
import { regime, eventsFor, adjustFor, regimeLine, eventLine, labelFor } from '../engine/regime.js';
import { chartLevels } from '../engine/indicators.js';

export const name = 'live';

// Coins that are always crypto, even if a stock uses the same ticker.
const MAJORS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'SHIB', 'TON', 'SUI', 'XLM', 'NEAR', 'APT', 'UNI', 'PEPE', 'ATOM', 'ARB', 'OP', 'FIL', 'HBAR', 'ICP', 'ETC', 'INJ', 'AAVE']);
const COINS = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB', DOGE: 'Dogecoin', ADA: 'Cardano', TRX: 'TRON', AVAX: 'Avalanche', LINK: 'Chainlink', DOT: 'Polkadot', LTC: 'Litecoin', BCH: 'Bitcoin Cash', SHIB: 'Shiba Inu', TON: 'Toncoin', SUI: 'Sui', XLM: 'Stellar', NEAR: 'NEAR Protocol', APT: 'Aptos', UNI: 'Uniswap', PEPE: 'Pepe', ATOM: 'Cosmos', ARB: 'Arbitrum', OP: 'Optimism', FIL: 'Filecoin', HBAR: 'Hedera', ICP: 'Internet Computer', ETC: 'Ethereum Classic', INJ: 'Injective', AAVE: 'Aave' };
// Capitalised words that are never a company or coin name.
const COMMON = new Set(['should', 'would', 'could', 'what', 'when', 'where', 'which', 'why', 'how', 'is', 'are', 'was', 'can', 'will', 'does', 'did', 'the', 'this', 'that', 'these', 'those', 'buy', 'sell', 'short', 'hold', 'long', 'term', 'stock', 'stocks', 'share', 'shares', 'coin', 'crypto', 'today', 'now', 'scout', 'flagged', 'takeover', 'talk', 'around', 'after', 'before', 'our', 'we', 'about', 'tell', 'give', 'find', 'any', 'some', 'something', 'worth', 'owning', 'position', 'trade', 'trap', 'compounder', 'into', 'earnings']);
// Everyday English words that are also real tickers or would waste a lookup (GOOD, TIME, NOW, PLAY...).
const ENGLISH = new Set(('a an and or but if so as at by for from in into of on onto to up down out over with without ' +
  'i me my we us our you your he she it its they them their this that these those here there who whom whose what which ' +
  'be am is are was were been being do does did done have has had can could will would shall should may might must ' +
  'not no yes all any some more most less much many few each every other such own same than too very just only also ' +
  'good bad best better great big small new old high low top next last first open close real safe sure well fine ' +
  'time now then today soon later week month year day days long short hold buy sell trade play run fly see go get ' +
  'make take give look know think want need like love hate keep let put set try use work call tell ask say said ' +
  'money cash price stock stocks share shares coin coins crypto market markets fund funds bank deal gain loss risk ' +
  'win wins lose bet move moves jump drop rise fall rally crash pump dump moon dip dips hot cold fast slow ' +
  'about after again against before behind below between both during off once under until why how when where while ' +
  'yeah ok okay hey hi please thanks thank worth own owning entry exit stop target plan idea ideas view tip tips').split(' '));
// All-caps words that are not tickers.
// Yahoo sector -> SPDR sector ETF, for relative strength
const SECTOR_ETF = { Technology: 'XLK', 'Financial Services': 'XLF', Healthcare: 'XLV', 'Consumer Cyclical': 'XLY', 'Consumer Defensive': 'XLP', Energy: 'XLE', Industrials: 'XLI', 'Basic Materials': 'XLB', Utilities: 'XLU', 'Real Estate': 'XLRE', 'Communication Services': 'XLC' };
// Pearson correlation of two equal-length series (null when too short or flat)
function corr(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 20) return null;
  a = a.slice(-n); b = b.slice(-n);
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
}
const NOT_TICKERS = new Set(['I', 'A', 'OK', 'CEO', 'CFO', 'CTO', 'IPO', 'EPS', 'ETF', 'USD', 'US', 'USA', 'UK', 'EU', 'GDP', 'CPI', 'FED', 'FOMC', 'SEC', 'AGM', 'YOY', 'QOQ', 'ATH', 'DCA', 'FOMO', 'IMO', 'TLDR', 'PE', 'EV', 'ROI', 'NFT', 'DEFI']);

/**
 * Inject the data sources (tests pass fakes). Returns the provider.
 */
export function createLive({ yahoo = yahooApi, binance = binanceApi, sec = secApi, news, coingecko, crowd, defillama, derivs, finra, ftc } = {}) {
  const real = yahoo === yahooApi;
  news ??= real ? newsApi : NO_NEWS;
  coingecko ??= real ? coingeckoApi : NO_COINGECKO;
  crowd ??= real ? crowdApi : NONE;
  defillama ??= real ? defillamaApi : NONE;
  derivs ??= real ? derivsApi : NONE;
  finra ??= real ? finraApi : NONE;
  ftc ??= real ? ftcApi : NONE;

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
    // Tickers typed in lower or mixed case ("should we buy nvda?"). Only exact ticker lists
    // (SEC, Binance) count here, and everyday words are skipped, so "a good time" is not GOOD.
    const plain = [...new Set(brief.replace(/[^A-Za-z$\s.-]/g, ' ').split(/\s+/)
      .map(w => w.replace(/^\$/, '').replace(/[.-]+$/, '')).filter(w => /^[A-Za-z]{2,5}$/.test(w) && w !== w.toUpperCase()))]
      .filter(w => !COMMON.has(w.toLowerCase()) && !ENGLISH.has(w.toLowerCase()) && !NOT_TICKERS.has(w.toUpperCase()));
    for (const w of plain) {
      const k = w.toUpperCase();
      if (MAJORS.has(k)) return crypto(k);
      if (await sec.lookup(k).catch(() => null)) return stock(k);
      liquid ??= await binance.liquidBases().catch(() => new Set());
      if (liquid.has(k)) return crypto(k);
    }
    // No ticker: try a company or coin name ("Should we buy Apple?", "what about bitcoin")
    const words = brief.replace(/[^\p{L}\p{N}\s&-]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !COMMON.has(w.toLowerCase()) && !ENGLISH.has(w.toLowerCase()));
    for (const w of words.slice(0, 4)) {
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
  async function gather(ins, mode, book = []) {
    const soft = p => Promise.resolve(p).catch(e => (console.warn('[data]', e.message), null));
    // second-layer sources get a time cap: a slow one is skipped this round (and still fills its cache for the next)
    const call = (o, f, ...a) => (typeof o?.[f] === 'function' ? within(soft(o[f](...a)), f === 'newsTone' ? 4000 : 9000) : null);
    const px = await prices(ins);
    const isStock = ins.kind === 'stock';
    const [summary, secRef, yNews, bench, tick, g, cg] = await Promise.all([
      isStock ? soft(yahoo.summary(ins.yahoo)) : null,
      isStock ? soft(sec.lookup(ins.symbol)) : null,
      soft(yahoo.news(isStock ? ins.symbol : COINS[ins.base] || ins.base, 8)),
      soft(isStock ? yahoo.chart('^GSPC', '3mo') : binance.chart('BTC', 60)),
      isStock ? null : soft(binance.tickers()),
      soft(regime(yahoo, binance)),
      isStock ? null : soft(coingecko.coin(ins.base))
    ]);
    let secData = null;
    if (secRef) {
      const [facts, list] = await Promise.all([soft(sec.annualFacts(secRef.cik)), soft(sec.filings(secRef.cik))]);
      secData = { cik: secRef.cik, facts, filings: list || [] };
    }
    const rank = tick ? tick.findIndex(t => t.base === ins.base) + 1 : 0;
    const name = px.name || summary?.name || cg?.name || secRef?.name || ins.symbol;
    const ext = await extras(ins, { name, summary, secData, cg, book });
    // headlines from Yahoo, Google News, the FT, Investing.com (and Crypto Jungle for coins), merged
    const merged = await soft(news.headlines({ kind: ins.kind, symbol: ins.symbol, name, extra: yNews || [] }));
    return {
      kind: ins.kind, symbol: ins.symbol, mode, p: px.price, prevClose: px.prevClose,
      name,
      candles: px.candles, closes: px.candles.map(k => k.c),
      summary, sec: secData, news: merged?.items || yNews || [], newsSources: merged?.sources || {}, coingecko: cg || null, bench: bench ? bench.candles.map(k => k.c) : [],
      cryptoRank: rank || null, quoteVolume24h: tick?.[rank - 1]?.quoteVolume ?? null,
      regime: g || null, ext
    };

    /** The second layer of sources, one or more per desk. Every entry may be null. */
    async function extras(ins, { name, summary, secData, cg, book }) {
      const sym = ins.symbol, Y = ins.yahoo, sector = summary?.sector, etf = SECTOR_ETF[sector] || null;
      const [twits, tone, fg, insights, opts, peerList, weekly, hourly, etfChart, vix9d, vix3m, insider, deals, dealNews, shortVol, ftcHits, defi, perp, dvol, depth, markets, corr] = await Promise.all([
        call(crowd, 'stocktwits', sym, ins.kind),
        call(crowd, 'newsTone', name),
        isStock ? null : call(crowd, 'fearGreed'),
        isStock ? call(yahoo, 'insights', Y) : null,
        isStock ? call(yahoo, 'options', Y) : null,
        isStock ? call(yahoo, 'peers', Y, summary?.industry) : null,
        isStock ? call(yahoo, 'candles', Y, '5y', '1wk') : null,
        isStock ? call(yahoo, 'candles', Y, '1mo', '60m') : null,
        etf ? call(yahoo, 'chart', etf, '6mo') : null,
        isStock ? call(yahoo, 'chart', '^VIX9D', '1mo') : null,
        isStock ? call(yahoo, 'chart', '^VIX3M', '1mo') : null,
        secData ? call(sec, 'insiderTrades', secData.cik, secData.filings) : null,
        isStock ? call(sec, 'dealMentions', name) : null,
        isStock ? call(news, 'dealNews', sym, name) : null,
        isStock ? call(finra, 'shortVolume', sym) : null,
        isStock ? call(ftc, 'mergerNotices', name) : null,
        cg?.id ? call(defillama, 'forCoin', cg.id) : null,
        isStock ? null : call(derivs, 'perp', ins.base),
        isStock ? null : call(derivs, 'dvol', ins.base),
        isStock ? null : call(derivs, 'depth', ins.base),
        isStock ? null : call(coingecko, 'markets', ins.base),
        within(correlations(ins, book), 9000)
      ]);
      // peers: their forward P/E and 3 month move, for the Fundamental desk
      // industry peers come with their P/E; the fallback list ("also viewed") needs a lookup per name
      const peers = peerList?.length && 'forwardPe' in peerList[0] ? peerList : peerList?.length ? (await within(Promise.all(peerList.slice(0, 4).map(async q => {
        const [sm, ch] = await Promise.all([soft(yahoo.summary(q.symbol)), soft(yahoo.chart(q.symbol, '3mo'))]);
        return sm || ch ? { symbol: q.symbol, forwardPe: sm?.forwardPe ?? null, change3mPct: ch ? +((ch.candles.at(-1).c / ch.candles[0].c - 1) * 100).toFixed(1) : null } : null;
      })), 6000) || []).filter(Boolean) : null;
      const vix = g?.vix != null && (vix9d || vix3m) ? { vix: g.vix, vix9d: vix9d?.price ?? null, vix3m: vix3m?.price ?? null } : null;
      return {
        stocktwits: twits, gdelt: tone, fearGreed: fg, insights, options: opts, peers, weekly, hourly,
        sector: etf ? { etf, closes: etfChart?.candles?.map(k => k.c) || null } : null, vix, insider, deals, dealNews, shortVol,
        defi, ftc: ftcHits, perp, dvol, depth, markets, correlation: corr
      };
    }
  }

  /** How closely this asset has moved with the tickets we approved in the last 90 days (daily returns, 90 sessions). */
  async function correlations(ins, book) {
    const mine = (book || []).filter(b => b.ticker !== ins.symbol && (b.assetClass === 'stock' || b.assetClass === 'crypto')).slice(0, 6);
    if (!mine.length) return null;
    const rets = k => k.slice(-91).map((x, i, a) => (i ? x.c / a[i - 1].c - 1 : null)).slice(1);
    const own = await history(ins.symbol, ins.kind).catch(() => null);
    if (!own) return null;
    const out = [];
    for (const b of mine) {
      const h = await history(b.ticker, b.assetClass).catch(() => null);
      if (!h) continue;
      const n = Math.min(own.length, h.length, 91), c = corr(rets(own.slice(-n)), rets(h.slice(-n)));
      if (c != null) out.push({ ticker: b.ticker, side: b.side, corr: +c.toFixed(2) });
    }
    return out.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));
  }

  /** brain: 'rules' (default), 'claude' or 'gemini'. */
  async function round(brief, mode, { brain = 'rules', weights = null, book = [] } = {}) {
    const ins = await resolve(brief);
    if (!ins) throw Object.assign(new Error('No ticker found in the brief. Name a stock or coin, for example NVDA, Apple or BTC'), { source: 'brief', status: 422 });
    const x = await gather(ins, mode, book);
    const inv = mode === 'investor';
    x.events = eventsFor(x, mode);
    x.levels = chartLevels(x.candles, x.p, { investor: inv, maxStop: inv ? 0.25 : 0.15, extraTarget: x.summary?.targetMean, fallbackRR: inv ? 3 : 2.2 });
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
      extra: {
        assetClass: x.kind, open: x.prevClose, asOf: new Date().toISOString(), live: true,
        backdrop: { regime: labelFor(x.regime, x.kind) || null, line: regimeLine(x.regime, x.kind), events: x.events.map(eventLine) },
        learned: !!weights, weights: weights || null
      },
      plan: ai?.plan, weights, adjust: adjustFor({ g: x.regime, events: x.events, levels: x.levels, mode, kind: x.kind })
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

  /** About a year of daily candles with timestamps, for grading calls and replaying tickets. */
  async function history(k, assetClass) {
    const c = assetClass === 'crypto' ? await binance.chart(k, 400) : await yahoo.chart(k.replace('.', '-'), '2y');
    return c.candles.filter(x => x.t != null);
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

  return { name, resolve, gather, round, movers, chart, quote, history };
}

const live = createLive();
export const { resolve, round, movers, chart, quote, history } = live;
