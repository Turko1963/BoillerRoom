// The second layer of sources (crowd, insiders, earnings, peers, options, futures, order books, deal searches),
// with no network: parsers, fallbacks, the circuit breaker, and what each desk does with the data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as desks from '../server/engine/desks.js';
import { bookStats } from '../server/data/derivs.js';
import { optionStats } from '../server/data/yahoo.js';
import { parseForm4, eightK } from '../server/data/sec.js';
import { parseShortFile } from '../server/data/finra.js';
import { twitsStats, toneStats } from '../server/data/crowd.js';
import { matchNotices } from '../server/data/ftc.js';
import { breaker, within } from '../server/data/http.js';
import { createLive } from '../server/market/live.js';

const today = new Date().toISOString().slice(0, 10);

test('parsers: order book, options, Form 4, 8-K items, FINRA, StockTwits, GDELT, FTC', () => {
  const b = bookStats([['99.9', '100'], ['99', '1000'], ['97', '5000']], [['100.1', '100'], ['101', '1000'], ['103', '5000']]);
  assert.equal(Math.round(b.mid), 100);
  assert.equal(b.spreadBps, 20);
  assert.equal(Math.round(b.bid1), 99.9 * 100 + 99 * 1000);
  assert.equal(Math.round(b.ask2), 100.1 * 100 + 101 * 1000);

  const o = optionStats([{ strike: 100, impliedVolatility: 0.4, volume: 100, openInterest: 1000 }, { strike: 120, impliedVolatility: 0.5, volume: 50, openInterest: 500 }],
    [{ strike: 100, impliedVolatility: 0.44, volume: 120, openInterest: 900 }], 101, 1800000000);
  assert.equal(o.putCallVolume, 0.8);
  assert.equal(o.putCallOI, 0.6);
  assert.equal(o.atmIvPct, 42);

  const f4 = `<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId></reportingOwner>
    <nonDerivativeTable><nonDerivativeTransaction><transactionCoding><transactionCode>P</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>50</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>
    <nonDerivativeTransaction><transactionCoding><transactionCode>S</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>10</value></transactionShares><transactionPricePerShare><value>55</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>
    <nonDerivativeTransaction><transactionCoding><transactionCode>M</transactionCode></transactionCoding></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`;
  assert.deepEqual(parseForm4(f4), { owner: 'Doe Jane', buys: 1, sells: 1, buyValue: 50000, sellValue: 550 });

  const k = eightK([{ form: '8-K', date: today, items: '4.02,9.01' }, { form: '8-K', date: today, items: '5.02' }, { form: '8-K', date: '2001-01-01', items: '1.03' }, { form: '10-Q', date: today }]);
  assert.equal(k.count, 2);
  assert.deepEqual(k.red.map(r => r.code), ['4.02']);
  assert.equal(k.items['5.02'], 1);

  const m = parseShortFile('Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20261113|NVDA|4000|10|10000|B,Q,N\n20261113|BAD|x|0|0|Q\n');
  assert.deepEqual(m.get('NVDA'), { short: 4000, total: 10000 });
  assert.equal(m.has('BAD'), false);

  const tw = twitsStats({ symbol: { watchlist_count: 900 }, messages: [{ entities: { sentiment: { basic: 'Bullish' } }, created_at: '2026-11-14T10:00:00Z' }, { entities: { sentiment: { basic: 'Bullish' } }, created_at: '2026-11-14T12:00:00Z' }, { entities: { sentiment: { basic: 'Bearish' } }, created_at: '2026-11-14T11:00:00Z' }, { entities: {}, created_at: '2026-11-14T11:30:00Z' }] });
  assert.deepEqual(tw, { messages: 4, bull: 2, bear: 1, bullPct: 67, watchers: 900, spanHours: 2 });

  const tone = toneStats({ timeline: [{ data: [-2, -1, 0, 1, 2, 2, 3].map(value => ({ value })) }] });
  assert.equal(tone.tone, 0.71);
  assert.equal(tone.recent, 3);
  assert.equal(toneStats({ timeline: [] }), null);

  const notes = [{ title: 'Acme Robotics Inc. / Widget Holdings', date: '2026-11-01', text: '{"acquiring":"acme robotics inc.","acquired":"widget holdings"}' }, { title: 'Other / Thing', date: '2026-10-01', text: '{"acquiring":"acmes"}' }];
  assert.deepEqual(matchNotices(notes, 'Acme Robotics Inc.'), [{ title: 'Acme Robotics Inc. / Widget Holdings', date: '2026-11-01' }], 'the name without its Inc. suffix');
  assert.equal(matchNotices(notes, 'Widget Holdings').length, 1);
  assert.equal(matchNotices(notes, 'Acme').length, 1, 'whole word only: "acmes" does not match');
});

test('circuit breaker: a blocked source pauses itself; time cap returns null without waiting', async () => {
  let calls = 0;
  const f = breaker('test', async () => { calls++; throw Object.assign(new Error('blocked'), { status: 403 }); });
  assert.equal(await f(), null);
  assert.equal(await f(), null);
  assert.equal(calls, 1, 'paused after the first 403');
  let n = 0;
  const g = breaker('test2', async () => { n++; throw new Error('timed out'); });
  await g(); await g();
  assert.equal(n, 2, 'ordinary failures are retried next time');
  const t0 = Date.now();
  assert.equal(await within(new Promise(r => setTimeout(r, 2000, 'late')), 50), null);
  assert.ok(Date.now() - t0 < 1000);
});

test('DefiLlama: chains by CoinGecko id, parent protocols by slug; futures fall back to Bybit', async () => {
  const real = globalThis.fetch, day = 86400, now = Math.floor(Date.now() / 1000);
  const series = (a, b) => Array.from({ length: 40 }, (_, i) => ({ date: now - (39 - i) * day, tvl: i < 10 ? a : b }));
  globalThis.fetch = async url => {
    url = String(url);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (url.endsWith('/protocols')) return json([{ name: 'Uniswap V3', slug: 'uniswap-v3', gecko_id: null }]);
    if (url.endsWith('/v2/chains')) return json([{ name: 'Solana', gecko_id: 'solana' }]);
    if (url.includes('/v2/historicalChainTvl/Solana')) return json(series(8e9, 1e10));
    if (url.includes('/overview/fees/Solana')) return json({ total24h: 2e6, total30d: 6e7, totalDataChart: Array.from({ length: 60 }, (_, i) => [now - i * day, 1e6]) });
    if (url.includes('/protocol/uniswap')) return json({ name: 'Uniswap', category: 'Dexs', chains: ['Ethereum'], tvl: [], chainTvls: { Ethereum: { tvl: series(4e9, 5e9).map(d => ({ date: d.date, totalLiquidityUSD: d.tvl })) }, 'Ethereum-borrowed': { tvl: [{ date: now, totalLiquidityUSD: 9e12 }] } } });
    if (url.includes('/summary/fees/uniswap')) return json({ total24h: 3e6, total30d: 9e7, totalDataChart: [] });
    if (url.includes('/protocol/notaprotocol')) return json({ message: 'not found' }, 400);
    if (url.includes('fapi.binance.com')) return json({ code: 0, msg: 'restricted location' }, 451);
    if (url.includes('api.bybit.com')) return json({ retCode: 0, result: { list: [{ symbol: 'SOLUSDT', fundingRate: '0.0001', openInterestValue: '2500000000' }] } });
    return json({}, 404);
  };
  try {
    const { forCoin } = await import('../server/data/defillama.js');
    const sol = await forCoin('solana');
    assert.equal(sol.kind, 'chain');
    assert.equal(sol.tvl, 1e10);
    assert.equal(sol.tvl30dAgo, 8e9);
    assert.equal(sol.fees.d30, 6e7);
    const uni = await forCoin('uniswap');
    assert.equal(uni.kind, 'protocol');
    assert.equal(uni.tvl, 5e9, 'chain series summed, borrowed skipped');
    assert.equal(uni.fees.d30, 9e7);
    assert.equal(await forCoin('notaprotocol'), null);
    const { perp } = await import('../server/data/derivs.js');
    const p = await perp('SOL');
    assert.equal(p.venue, 'Bybit');
    assert.equal(p.fundingPct, 0.01);
    assert.equal(p.openInterestUsd, 2.5e9);
  } finally { globalThis.fetch = real; }
});

/* ---------- desks ---------- */
const candles = (n = 300, drift = 0.002) => { const out = []; let c = 100; for (let i = 0; i < n; i++) { const o = c; c *= 1 + drift + (i % 2 ? 0.006 : -0.004); out.push({ t: Date.now() - (n - i) * 864e5, o, h: Math.max(o, c) * 1.005, l: Math.min(o, c) * 0.995, c, v: 2e6, qv: c * 2e6, takerBuyQv: c * 1.1e6 }); } return out; };
const stock = ext => { const k = candles(); return { kind: 'stock', symbol: 'UP', name: 'Up Corp', mode: 'trader', p: k.at(-1).c, candles: k, closes: k.map(x => x.c), news: [], newsSources: {}, bench: k.map(x => x.c), coingecko: null,
  summary: { trend: { strongBuy: 8, buy: 8, hold: 3, sell: 1, strongSell: 0 }, targetMean: 400, analysts: 20, operatingMargin: 0.3, roe: 0.25, debt: 1e9, cash: 2e9, ebitda: 1.5e9, forwardPe: 40, marketCap: 5e9, evToEbitda: 8, netIncome: 1e9, ocf: 1.2e9 },
  sec: { cik: '1', facts: { fy: '2025-12-31', revenue: [1e10, 1.2e10], netIncome: [8e8, 1e9], ocf: [1e9, 1.3e9], capex: [2e8, 2e8], receivables: [1e9, 1.1e9] }, filings: [{ form: '10-Q', date: today }, { form: '8-K', date: today, items: '4.01' }] },
  regime: { label: 'neutral', vix: 22 }, events: [], levels: null, ext }; };

test('Analyst reads the crowd; Filings reads 8-K red flags and insider buying', () => {
  const plain = desks.analyst(stock({}));
  const x = stock({ stocktwits: { bull: 18, bear: 2, bullPct: 90 }, gdelt: { tone: 2.4, recent: 3 } });
  const a = desks.analyst(x);
  assert.match(a.findings[0], /StockTwits 90% bullish, news tone \+2\.4 \(GDELT\)/);
  assert.ok(a.score > plain.score, 'a bullish crowd lifts the score');
  assert.ok(a.sources.includes('StockTwits') && a.sources.includes('GDELT news tone'));

  const base = desks.filings(stock({}));
  assert.match(base.findings[2], /8-K on .*: auditor change/);
  const fl = desks.filings(stock({ insider: { filings: 6, buys: 3, sells: 1, buyers: ['A', 'B'] } }));
  assert.ok(fl.score > base.score, 'two insiders buying lifts the score');
  assert.ok(fl.sources.includes('SEC Form 4 insider trades') && fl.sources.includes('SEC 8-K items'));
  const clean = stock({ insider: { filings: 6, buys: 0, sells: 4, buyers: [] } });
  clean.sec.filings = [{ form: '10-Q', date: today }];
  assert.match(desks.filings(clean).findings[2], /Insiders: 0 open-market buys, 4 sales in 90 days \(Form 4\); 10-Q/);
});

test('Fundamental reads the earnings record, revisions and peers; DefiLlama for coins', () => {
  const x = stock({ insights: { earnings: [{ surprisePct: 5 }, { surprisePct: 3 }, { surprisePct: 1 }, { surprisePct: -1 }], revisions: { epsNow: 5.3, eps90dAgo: 5 } }, peers: [{ forwardPe: 20 }, { forwardPe: 25 }, { forwardPe: 30 }] });
  const fu = desks.fundamental(x);
  assert.match(fu.findings[1], /Beat estimates in 3 of the last 4 quarters; this year's EPS estimate \+6% in 90 days/);
  assert.match(fu.findings[2], /Operating margin 30%, net cash of \$1\.0bn, forward P\/E 40 against 25 for peers/);
  assert.ok(fu.sources.includes('Yahoo Finance peer group'));
  assert.equal(desks.fundamental(stock({})).findings.length, 3);

  const k = candles(365);
  const coin = { kind: 'crypto', symbol: 'SOL', name: 'Solana', mode: 'trader', p: k.at(-1).c, candles: k, closes: k.map(c => c.c), news: [], newsSources: {}, bench: [], quoteVolume24h: 4e9,
    coingecko: { rank: 7, marketCap: 4e10, ath: 293, athChangePct: -70, athDate: '2025-01-19' }, ext: { defi: { kind: 'chain', tvl: 1e10, tvl30dAgo: 8e9, fees: { d30: 6e7, prev30: 5e7 } } } };
  const cf = desks.fundamental(coin);
  assert.match(cf.findings[2], /TVL \$10\.0bn \(\+25% in 30 days\); fees \$60m in 30 days \(\+20%\)/);
  assert.ok(cf.sources.includes('DefiLlama TVL and fees'));
});

test('Technical, M&A, Risk and Dealer use their new sources', () => {
  const x0 = stock({}), w = candles(260, 0.004), sc = x0.p / w.at(-1).c, wk = w.map(c => ({ ...c, c: c.c * sc }));
  const t = desks.technical(stock({ weekly: wk, sector: { etf: 'XLK', closes: candles(130, 0).map(k => k.c) }, options: { putCallOI: 0.5 } }));
  assert.match(t.findings[2], /Weekly trend up; 3 months \+\d+% against [+-]?\d+% for XLK/);
  assert.ok(t.sources.includes('XLK sector ETF') && t.sources.includes('Yahoo Finance options'));

  const ma0 = desks.ma(stock({}));
  const ma = desks.ma(stock({ ftc: { matches: [{ title: 'Big Buyer / Up Corp', date: '2026-11-01' }] } }));
  assert.equal(ma.headline, 'A deal is already on file');
  assert.match(ma.findings[2], /FTC early termination notice on 2026-11-01/);
  assert.ok(ma.metric.v > ma0.metric.v);
  const news = desks.ma(stock({ dealNews: [{ title: 'Up Corp explores sale after takeover interest', publisher: 'Reuters' }] }));
  assert.match(news.findings[2], /Reuters: “Up Corp explores sale/);

  const r0 = desks.risk(stock({}));
  const r = desks.risk(stock({ vix: { vix: 22, vix9d: 25, vix3m: 20 }, options: { atmIvPct: 60 }, correlation: [{ ticker: 'TWIN', side: 'buy', corr: 0.85 }] }));
  assert.match(r.findings[1], /VIX curve inverted: stress now/);
  assert.match(r.findings[2], /Moves with our TWIN ticket \(correlation 0\.85\): size cut by a third/);
  assert.match(r.findings[0], /implied 60%/);
  assert.ok(r.size < r0.size && r.score < r0.score);

  const k = candles(365);
  const coin = { kind: 'crypto', symbol: 'SOL', name: 'Solana', mode: 'trader', p: k.at(-1).c, candles: k, closes: k.map(c => c.c), news: [], newsSources: {}, bench: [], coingecko: null, quoteVolume24h: 4e9,
    ext: { depth: { mid: 100, spreadBps: 1.2, bid1: 5e5, ask1: 4e5, bid2: 1e6, ask2: 9e5 }, perp: { venue: 'Binance futures', fundingPct: 0.08, openInterestUsd: 3e9, oiChange1dPct: 4, longPct: 74 } } };
  const d0 = desks.dealer({ ...coin, ext: {} }, { size: 5, lev: 1 }), d = desks.dealer(coin, { size: 5, lev: 1 });
  assert.match(d.findings[2], /spread 1\.2 bps; \$400k within 1% on Binance/);
  assert.ok(d.metric.v > d0.metric.v, 'a thin book adds slippage');
  const open = desks.dealer(stock({ insights: { quote: { bid: 100, ask: 100.02, marketState: 'REGULAR' } } }), { size: 5, lev: 1 });
  assert.match(open.findings[2], /spread 2 bps/);
  const closed = desks.dealer(stock({ insights: { quote: { bid: 90, ask: 100, marketState: 'CLOSED' } } }), { size: 5, lev: 1 });
  assert.doesNotMatch(closed.findings[2], /spread/, 'stale overnight quotes are ignored');
  const tc = desks.technical(coin);
  assert.match(tc.findings[2], /Funding 0\.080% per 8h, open interest \$3\.0bn \(\+4\.0% today\)/);
  assert.match(desks.risk(coin).findings[1], /74% of Binance accounts are long/);
});

test('a live round carries the new sources end to end (fake sources)', async () => {
  const k = candles();
  const yahoo = {
    chart: async s => ({ symbol: s, name: 'Up Corp', price: k.at(-1).c, prevClose: k.at(-2).c, candles: k }),
    summary: async () => ({ name: 'Up Corp', sector: 'Technology', marketCap: 5e9, targetMean: 400, analysts: 20, forwardPe: 30 }),
    news: async () => [], search: async () => [], screener: async () => [],
    candles: async (s, r, i) => (i === '1wk' ? candles(260, 0.004) : []), insights: async () => ({ earnings: [{ surprisePct: 2 }, { surprisePct: 2 }, { surprisePct: 2 }], revisions: null, insider: { buys: 1, sells: 0 }, quote: { bid: 99, ask: 99.1 } }),
    options: async () => ({ putCallOI: 0.9, atmIvPct: 35 }), peers: async () => [{ symbol: 'PEER' }, { symbol: 'PEER2' }]
  };
  const binance = { tickers: async () => [], liquidBases: async () => new Set(), chart: async () => ({ price: 1, prevClose: 1, candles: candles(60) }) };
  const sec = { lookup: async t => (t === 'UP' ? { cik: '1', name: 'UP CORP' } : null), annualFacts: async () => null, filings: async () => [], insiderTrades: async () => ({ filings: 2, buys: 2, sells: 0, buyers: ['A', 'B'] }), dealMentions: async () => ({ total: 0 }) };
  const crowd = { stocktwits: async () => ({ bull: 9, bear: 1, bullPct: 90 }), newsTone: async () => null, fearGreed: async () => null };
  const live = createLive({ yahoo, binance, sec, crowd });
  const c = await live.round('Should we buy UP?', 'trader');
  assert.ok(c.R.analyst.sources.includes('StockTwits'));
  assert.ok(c.R.filings.sources.includes('SEC Form 4 insider trades'));
  assert.ok(c.R.technical.sources.includes('XLK sector ETF'));
  assert.ok(c.R.fundamental.sources.includes('Yahoo Finance peer group'));
  assert.ok(c.R.dealer.sources.includes('Yahoo Finance bid and ask'));
  for (const id of Object.keys(c.R)) assert.equal(c.R[id].findings.length, 3, id);
});

test('a buy the chart overrules becomes a Hold with a pass-sized conviction, not the buy score', async () => {
  const { decide } = await import('../server/engine/case.js');
  const { rng } = await import('../server/engine/random.js');
  const ids = ['analyst', 'filings', 'fundamental', 'technical', 'ma', 'risk', 'dealer'];
  const R = Object.fromEntries(ids.map(id => [id, { score: 0.8, stance: 'bull', conf: 90, headline: 'Strong', findings: ['a', 'b', 'c'] }]));
  const M = Object.fromEntries(ids.map(id => [id, { v: 1, fmt: 'int' }])), ANN = { technical: { price: 95, label: 'Range floor' }, fundamental: { price: 120, label: 'Fair value' } };
  const base = { brief: 'x', mode: 'trader', tk: 'UP', T: 'UP', name: 'Up', p: 100, R, M, ANN, vol: 30, size: 5, lev: 1, stopPct: 5, slices: 4, days: 1, unit: 'session' };
  const buy = decide({ ...base, r: rng(1) });
  assert.equal(buy.call, 'Buy');
  assert.ok(buy.conv >= 90);
  const passed = decide({ ...base, r: rng(1), adjust: { levels: { long: { stop: 90, target: 104 } }, minRR: 1.5, notes: [] } });
  assert.equal(passed.call, 'Hold');
  assert.ok(passed.conv >= 55 && passed.conv <= 85, `conviction ${passed.conv}`);
  assert.match(passed.why, /reward is only 0\.4 times the risk/);
});

test('Yahoo headlines that do not name the stock are dropped; industry peers are named as such', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('<rss><channel></channel></rss>', { status: 200 });
  try {
    const { headlines } = await import('../server/data/news.js');
    const h = await headlines({ kind: 'stock', symbol: 'ZZZQ', name: 'Zedq Corp', extra: [{ title: 'Zedq beats estimates', time: 2, publisher: 'Reuters' }, { title: 'Five altcoins to buy now', time: 3, publisher: 'CryptoProwl' }] });
    assert.deepEqual(h.items.map(i => i.publisher), ['Reuters']);
  } finally { globalThis.fetch = real; }
  const x = stock({ peers: [{ symbol: 'TSM', name: 'TSMC', forwardPe: 17 }, { symbol: 'AVGO', name: 'Broadcom', forwardPe: 18 }, { symbol: 'AMD', name: 'AMD', forwardPe: 30 }] });
  x.summary.industry = 'Semiconductors';
  const fu = desks.fundamental(x);
  assert.match(fu.findings[2], /forward P\/E 40 against 18 for semiconductors peers/);
  assert.ok(fu.sources.includes('Yahoo Finance industry screener'));
});
