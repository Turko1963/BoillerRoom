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
import { baseRate } from '../engine/baserate.js';
import { withCurrency } from '../engine/currency.js';
import * as tase from '../data/tase.js';
import { preflight, sourcesOf, cleanExternal, cleanPassage, LIMITS as CHECKS } from '../engine/checks.js';

export const name = 'live';

// Coins that are always crypto, even if a stock uses the same ticker.
const MAJORS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'SHIB', 'TON', 'SUI', 'XLM', 'NEAR', 'APT', 'UNI', 'PEPE', 'ATOM', 'ARB', 'OP', 'FIL', 'HBAR', 'ICP', 'ETC', 'INJ', 'AAVE']);
const COINS = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB', DOGE: 'Dogecoin', ADA: 'Cardano', TRX: 'TRON', AVAX: 'Avalanche', LINK: 'Chainlink', DOT: 'Polkadot', LTC: 'Litecoin', BCH: 'Bitcoin Cash', SHIB: 'Shiba Inu', TON: 'Toncoin', SUI: 'Sui', XLM: 'Stellar', NEAR: 'NEAR Protocol', APT: 'Aptos', UNI: 'Uniswap', PEPE: 'Pepe', ATOM: 'Cosmos', ARB: 'Arbitrum', OP: 'Optimism', FIL: 'Filecoin', HBAR: 'Hedera', ICP: 'Internet Computer', ETC: 'Ethereum Classic', INJ: 'Injective', AAVE: 'Aave' };
// Company names that no longer trade, and old names of companies that do.
const GONE = { twitter: 'Twitter was taken private in October 2022 (it is now X Corp.) and no longer trades on any exchange.' };
const RENAMED = { facebook: 'META', google: 'GOOGL', alphabet: 'GOOGL' };
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
/** Both brain: when Claude and Gemini read the desks differently, the room is less sure, so the position gets smaller. */
export function splitBrains(adjust, agreement) {
  if (!agreement || agreement.both < 4 || agreement.agree / agreement.both >= 0.6) return adjust;
  const k = 0.6, a = { ...adjust, sizeMult: (adjust.sizeMult ?? 1) * k, notes: [...(adjust.notes || [])] };
  a.notes.push({ trade: `Claude and Gemini agreed on only ${agreement.agree} of ${agreement.both} desks, so the size is cut to ${Math.round(k * 100)}%.`, hold: '' });
  return a;
}

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
    // Tel Aviv: "LUMI.TA", a Hebrew name ("טבע", "בנק לאומי"), or an English one ("Leumi", "Teva on the TASE")
    const ta = brief.match(/\b([A-Za-z0-9]{2,8})\.TA\b/i);
    if (ta) return stock(ta[1].toUpperCase() + '.TA');
    const he = tase.fromHebrew(brief);
    if (he) return he.kind === 'crypto' ? crypto(he.symbol) : stock(preferTase(he.symbol, brief));
    const en = tase.fromEnglish(brief);
    if (en) return stock(en);
    const explicit = brief.match(/\b([A-Z0-9]{2,10})(?:-USD|USDT)\b/);
    if (explicit) return crypto(explicit[1]);
    const cands = [...brief.matchAll(/(\$)?\b([A-Z]{1,5}(?:[.-][A-Z]{1,2})?)\b/g)]
      .filter(m => (m[1] || m[2].length > 1) && !NOT_TICKERS.has(m[2])).map(m => m[2]);
    let liquid = null;
    for (const k of cands) {
      if (MAJORS.has(k)) return crypto(k);
      if (await sec.lookup(k).catch(() => null)) return stock(preferTase(k, brief));
      if (tase.taseTicker(k)) return stock(tase.taseTicker(k)); // LUMI, POLI: Tel Aviv tickers typed without .TA
      liquid ??= await binance.liquidBases().catch(() => new Set());
      if (liquid.has(k)) return crypto(k);
      if (await yahoo.chart(k, '5d').then(() => true, () => false)) return stock(preferTase(k, brief));
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
    const clarify = (msg, status = 409, options) => Object.assign(new Error(msg), { source: 'brief', status, ...(options ? { options } : {}) });
    for (const w of words.slice(0, 4)) {
      const lw = w.toLowerCase();
      // names that changed or stopped trading: say so instead of guessing
      if (GONE[lw]) throw clarify(GONE[lw], 422);
      if (RENAMED[lw]) return stock(RENAMED[lw]);
      // the match must start with this exact word: "Apple" -> "Apple Inc.", but "Should" must not match "Shoulder"
      const first = q => (q.name || '').split(/[\s,.]+/)[0].toLowerCase();
      const all = (await yahoo.search(w).catch(() => [])).filter(q => ['EQUITY', 'ETF', 'CRYPTOCURRENCY'].includes(q.type) && first(q) === lw);
      // the same company is listed in many places (AAPL, AAPL.TO, AAPL.MX...): when there are US listings, only they count
      const us = all.filter(q => q.type === 'CRYPTOCURRENCY' || !/\.[A-Z]{1,3}$/.test(q.symbol)), found = us.length ? us : all;
      if (!found.length) continue;
      // one company whose whole name is the word wins ("Apple" is Apple Inc., not Apple Hospitality REIT); several
      // different companies and no exact one: ask which, rather than pick one
      const core = q => (q.name || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\b(inc|corp|corporation|co|company|ltd|limited|plc|holdings|group|sa|nv|ag|the)\b/g, '').trim().replace(/\s+/g, ' ');
      // one entry per company, its first (main) listing
      const seen = new Map(); for (const q of found) if (!seen.has(core(q))) seen.set(core(q), q);
      const issuers = [...seen.values()], exact = issuers.filter(q => core(q) === lw);
      const hit = exact.length === 1 ? exact[0] : issuers.length === 1 ? issuers[0] : null;
      if (!hit) throw clarify(`"${w}" matches more than one company: ${issuers.slice(0, 4).map(q => `${q.name} (${q.symbol}${q.exchange ? ', ' + q.exchange : ''})`).join('; ')}. Brief the room with the ticker you mean.`, 409, issuers.slice(0, 4).map(q => ({ symbol: q.symbol, name: q.name, exchange: q.exchange || null })));
      if (hit.type === 'CRYPTOCURRENCY') return crypto(hit.symbol.replace(/-USD$/, ''));
      // found, but is it still trading? no price in two weeks means delisted or suspended
      const fresh = await yahoo.chart(stock(hit.symbol).yahoo, '5d').then(c => !c.asOf || Date.now() - c.asOf < 14 * 864e5, () => false);
      if (!fresh) throw clarify(`${hit.name} (${hit.symbol}) was found, but it has no recent prices: it may be delisted or suspended.`, 422);
      return stock(hit.symbol);
    }
    return null;
  }
  // a .TA symbol goes to Yahoo as it is; a US class share (BRK.B) as BRK-B
  const stock = k => (tase.isTase(k) ? { kind: 'stock', symbol: k, yahoo: k, market: 'TASE', currency: 'ILS' } : { kind: 'stock', symbol: k, yahoo: k.replace('.', '-'), market: 'US', currency: 'USD' });
  // a dual-listed share: the Tel Aviv listing when the brief asks about Tel Aviv, else the one named
  const preferTase = (k, brief) => { const c = tase.counterpart(k); return c && c.tase && tase.wantsTase(brief) ? c.symbol : k; };
  const crypto = k => ({ kind: 'crypto', symbol: k.toUpperCase(), base: k.toUpperCase() });

  async function prices(ins) {
    if (ins.kind === 'crypto') {
      const c = await binance.chart(ins.base, 365);
      return { ...c, name: COINS[ins.base] || ins.base };
    }
    return yahoo.chart(ins.yahoo, '1y');
  }

  /** Everything the seven desks need, fetched in parallel. Optional sources may fail. */
  async function gather(ins, mode, book = [], { deep = false } = {}) {
    const soft = p => Promise.resolve(p).catch(e => (console.warn('[data]', e.message), null));
    // second-layer sources get a time cap: a slow one is skipped this round (and still fills its cache for the next)
    const call = (o, f, ...a) => (typeof o?.[f] === 'function' ? within(soft(o[f](...a)), f === 'newsTone' ? 4000 : f === 'riskChanges' || f === 'earningsRelease' ? 15000 : 9000) : null);
    const px = await prices(ins);
    const isStock = ins.kind === 'stock';
    const isTA = ins.market === 'TASE', cp = isStock ? tase.counterpart(ins.symbol) : null;
    // a Tel Aviv share files with the SEC only through its New York listing (Teva, Elbit, NICE...)
    const secSym = isTA ? (cp && !cp.tase ? cp.symbol : null) : ins.symbol;
    const [summary, secRef, yNews, bench, tick, g, cg, twin] = await Promise.all([
      isStock ? soft(yahoo.summary(ins.yahoo)) : null,
      isStock && secSym ? soft(sec.lookup(secSym)) : null,
      soft(yahoo.news(isStock ? (isTA ? tase.NAMES[ins.symbol]?.en || ins.symbol.replace('.TA', '') : ins.symbol) : COINS[ins.base] || ins.base, 8)),
      soft(isStock ? yahoo.chart(isTA ? tase.BENCH.symbol : '^GSPC', '3mo') : binance.chart('BTC', 60)),
      isStock ? null : soft(binance.tickers()),
      soft(regime(yahoo, binance)),
      isStock ? null : soft(coingecko.coin(ins.base)),
      cp ? soft(twinQuote(px, cp)) : null
    ]);
    const summaryFixed = isTA ? await taseFigures(summary, cp) : summary;
    let secData = null;
    if (secRef) {
      const [facts, list] = await Promise.all([soft(sec.annualFacts(secRef.cik)), soft(sec.filings(secRef.cik))]);
      secData = { cik: secRef.cik, facts, filings: list || [] };
    }
    const rank = tick ? tick.findIndex(t => t.base === ins.base) + 1 : 0;
    const name = px.name || summary?.name || cg?.name || secRef?.name || ins.symbol;
    const ext = await extras(ins, { name: isTA ? tase.NAMES[ins.symbol]?.en || name : name, summary: summaryFixed, secData, cg, book });
    // the AI brains also read the words: what is new in the risk factors, and the latest earnings release
    if (deep && secData) [ext.riskChanges, ext.earningsRelease] = await Promise.all([call(sec, 'riskChanges', secData.cik, secData.filings), call(sec, 'earningsRelease', secData.cik, secData.filings)]);
    // headlines from Yahoo, Google News, the FT, Investing.com (and Crypto Jungle for coins), merged
    const merged = await soft(news.headlines({ kind: ins.kind, symbol: ins.symbol, name, extra: yNews || [] }));
    return {
      kind: ins.kind, symbol: ins.symbol, mode, p: px.price, prevClose: px.prevClose, market: ins.market || null,
      instrument: { type: px.type || null, exchange: px.exchange || null, asOf: px.asOf || null }, currency: ins.currency || 'USD', counterpart: twin || null,
      benchName: isStock ? (isTA ? tase.BENCH.name : 'S&P 500') : 'Bitcoin',
      name,
      candles: px.candles, closes: px.candles.map(k => k.c),
      summary: summaryFixed, sec: secData, news: merged?.items || yNews || [], newsSources: merged?.sources || {}, coingecko: cg || null, bench: bench ? bench.candles.map(k => k.c) : [],
      cryptoRank: rank || null, quoteVolume24h: tick?.[rank - 1]?.quoteVolume ?? null,
      regime: g ? (isTA ? { ...g, foreign: true } : g) : null, ext
    };

    /** The second layer of sources, one or more per desk. Every entry may be null. */
    async function extras(ins, { name, summary, secData, cg, book }) {
      // US sector funds say nothing about a Tel Aviv share: no sector comparison there (the TA-35 is its benchmark)
      const sym = ins.symbol, Y = ins.yahoo, sector = summary?.sector, etf = ins.market === 'TASE' ? null : SECTOR_ETF[sector] || null;
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
        secData ? call(sec, 'dealMentions', name, secData.cik) : null,
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

  /**
   * Company figures for a Tel Aviv share in shekels. Yahoo divides shekel prices by dollar earnings for companies that
   * report in dollars (Teva: a forward P/E of 47 instead of 15), so ratios and analyst targets come from the New York
   * listing when there is one (targets converted at the dollar rate), dollar amounts are converted, and ratios that cannot
   * be trusted are dropped.
   */
  async function taseFigures(sm, cp) {
    if (!sm) return sm;
    const usd = sm.financialCurrency && sm.financialCurrency !== 'ILS';
    const needUs = cp && !cp.tase;
    if (!usd && !needUs) return sm;
    const [fx, us] = await Promise.all([yahoo.chart('ILS=X', '5d').then(c => c.price, () => null), needUs ? yahoo.summary(cp.symbol).catch(() => null) : null]);
    const out = { ...sm };
    if (usd) {
      for (const k of ['fcf', 'ocf', 'netIncome', 'debt', 'cash', 'ebitda']) out[k] = sm[k] != null && fx ? sm[k] * fx : null;
      out.pe = out.forwardPe = out.evToEbitda = null;
    }
    if (us) {
      Object.assign(out, { pe: us.pe, forwardPe: us.forwardPe, evToEbitda: us.evToEbitda, roe: us.roe ?? out.roe, operatingMargin: us.operatingMargin ?? out.operatingMargin, revenueGrowth: us.revenueGrowth ?? out.revenueGrowth });
      if ((!out.analysts || out.targetMean == null) && us.targetMean != null && fx) Object.assign(out, { targetMean: us.targetMean * fx, targetLow: us.targetLow != null ? us.targetLow * fx : null, targetHigh: us.targetHigh != null ? us.targetHigh * fx : null, analysts: us.analysts, recommendation: us.recommendation, trend: us.trend, targetsFrom: cp.symbol });
    }
    return out;
  }

  /**
   * The same company on its other exchange: Tel Aviv in shekels against New York in dollars, through the dollar rate.
   * gap: how much the share we look at trades above (+) or below (-) its twin, in %.
   */
  async function twinQuote(px, cp) {
    const [other, fx] = await Promise.all([yahoo.chart(cp.symbol, '5d'), yahoo.chart('ILS=X', '5d')]);
    const rate = fx?.price, here = px.price;
    if (!(rate > 0) || !(other?.price > 0) || !(here > 0)) return null;
    // here is the share we look at; there is the twin; compare both in the currency of the share we look at
    const thereInHere = cp.tase ? other.price / rate : other.price * rate;
    return { symbol: cp.symbol, exchange: cp.tase ? 'Tel Aviv' : 'New York', price: +other.price.toFixed(4), currency: cp.tase ? 'ILS' : 'USD', fx: +rate.toFixed(4),
      equivalent: +thereInHere.toFixed(4), gap: +((here / thereInHere - 1) * 100).toFixed(2) };
  }

  /** brain: 'rules' (default), 'claude' or 'gemini'. */
  async function round(brief, mode, { brain = 'rules', weights = null, book = [], memory = null } = {}) {
    const ins = await resolve(brief);
    if (!ins) throw Object.assign(new Error('No ticker found in the brief. Name a stock or coin, for example NVDA, Apple or BTC'), { source: 'brief', status: 422 });
    const x = await gather(ins, mode, book, { deep: brain !== 'rules' });
    // outside text is data, never instructions: drop what tries to give orders, and say so
    const alerts = [];
    { const n = cleanExternal(x.news, 'news'); x.news = n.items; alerts.push(...n.alerts); }
    if (x.ext?.earningsRelease?.text) { const r = cleanPassage(x.ext.earningsRelease.text, 'SEC earnings release'); x.ext.earningsRelease = { ...x.ext.earningsRelease, text: r.text }; alerts.push(...r.alerts); }
    if (x.ext?.riskChanges?.added) { const r = cleanExternal(x.ext.riskChanges.added, 'SEC risk factors'); x.ext.riskChanges = { ...x.ext.riskChanges, added: r.items }; alerts.push(...r.alerts); }
    // the data checks before the debate: stale or missing prices, thin history, no liquidity, not a tradable instrument
    const pre = preflight(x);
    try { x.memory = memory ? memory(x.symbol) : null; } catch { x.memory = null; }
    x.baseRate = baseRate(x.closes, mode);
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
    const sym = x.currency === 'ILS' ? '₪' : '$';
    const { rk, dl } = withCurrency(sym, () => {
      for (const id of ['analyst', 'filings', 'fundamental', 'technical', 'ma']) put(id, desks[id](x));
      const rk = put('risk', desks.risk(x));
      return { rk, dl: put('dealer', desks.dealer(x, rk)) };
    });
    // The debate draws a few random choices; seed them with the brief and the day.
    const r = rng(hash(brief + '|' + mode + '|' + new Date().toISOString().slice(0, 10)));
    // an AI brain rewrites the desk views and the debate; the vote and ticket stay in decide()
    const ai = brain !== 'rules' ? await think({ brain, x, R, mode, brief }) : null;
    const c = withCurrency(sym, () => decide({
      brief, mode, tk: x.symbol, T: x.symbol, name: x.name, p: x.p, R, M, ANN,
      vol: rk.vol, size: rk.size, lev: rk.lev, stopPct: rk.stopPct, slices: dl.slices, days: dl.days, unit: dl.unit, r,
      extra: {
        assetClass: x.kind, open: x.prevClose, asOf: new Date().toISOString(), live: true,
        backdrop: { regime: labelFor(x.regime, x.kind) || null, line: regimeLine(x.regime, x.kind), events: x.events.map(eventLine) },
        learned: !!weights, weights: weights || null, baseRate: x.baseRate || null,
        // Tel Aviv: prices in shekels; counterpart: the same company on its other exchange
        currency: x.currency, exchange: x.market === 'TASE' ? 'TASE' : x.kind === 'crypto' ? 'Binance' : 'US', counterpart: x.counterpart, benchName: x.benchName,
        // where every number comes from and how fresh it is; what the data checks found; outside text that was dropped
        sources: sourcesOf(x), instrument: pre.instrument, checks: CHECKS, alerts
      },
      plan: ai?.plan, weights, adjust: { ...splitBrains(adjustFor({ g: x.regime, events: x.events, levels: x.levels, mode, kind: x.kind }), ai?.meta?.agreement), vetoes: pre.vetoes }
    }));
    const out = ai ? await ai.finish(c) : { ...c, brain: { id: 'rules', label: 'Rules' } };
    // an AI memo explains the call in its own words; the weighted score and any veto stay in it, so the text matches the count
    if (ai && out.vote) { const add = [out.vote.text, ...out.vote.overrides.map(o => o.why)].filter(t => t && !out.why.includes(t)); if (add.length) out.why = `${out.why} ${add.join(' ')}`.trim(); }
    // the seven views of one brain share one source: say so next to the vote
    out.vote.independence = brain === 'rules' ? 'Rules is one deterministic engine reading one data set: the seven views share their inputs and are not independent.'
      : brain === 'both' ? 'Claude and Gemini each wrote seven views: the views of one model are correlated, so the Scoreboard measures each model as one source, not fourteen voices.'
      : `${out.brain?.label || brain} wrote all seven views: they are correlated, not seven independent opinions; the Scoreboard measures the brain as one source.`;
    return out;
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
    const c = assetClass === 'crypto' ? await binance.chart(k, 400) : await yahoo.chart(stock(k).yahoo, '2y');
    return c.candles.filter(x => x.t != null);
  }

  /** Every daily candle there is: since the IPO for stocks (Yahoo "max"), since the Binance listing for coins. */
  async function fullHistory(k, assetClass) {
    if (assetClass === 'crypto') return binance.fullChart ? binance.fullChart(k) : history(k, assetClass);
    return (await yahoo.chart(stock(k).yahoo, 'max')).candles.filter(x => x.t != null);
  }

  /** Rolling 24 hour change in % for a coin (Binance), or null. */
  async function change24h(base) {
    const t = (await binance.tickers().catch(() => [])).find(x => x.base === base.toUpperCase());
    return t ? +t.c.toFixed(2) : null;
  }

  /** Last 56 daily candles for the chart. */
  async function chart(k) {
    const ins = tase.isTase(k) ? stock(k) : MAJORS.has(k) || (!(await sec.lookup(k).catch(() => null)) && (await binance.liquidBases().catch(() => new Set())).has(k)) ? crypto(k) : stock(k);
    const c = await prices(ins);
    return { ticker: ins.symbol, name: c.name, price: c.price, open: c.prevClose, assetClass: ins.kind, currency: ins.kind === 'crypto' ? 'USD' : ins.currency, candles: c.candles.slice(-56).map(({ o, h, l, c }) => ({ o, h, l, c })) };
  }

  /** Current price, used when a ticket is executed. */
  async function quote(k, assetClass) {
    const c = assetClass === 'crypto' ? await binance.chart(k, 2) : await yahoo.chart(stock(k).yahoo, '5d');
    return c.price;
  }

  return { name, resolve, gather, round, movers, chart, quote, history, fullHistory, change24h };
}

const live = createLive();
export const { resolve, round, movers, chart, quote, history, fullHistory, change24h } = live;
