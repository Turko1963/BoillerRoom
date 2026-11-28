// Live engine tests with fake data sources (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLive } from '../server/market/live.js';
import { createApp } from '../server/app.js';
import { openStore } from '../server/store/db.js';
import * as desks from '../server/engine/desks.js';
import { rsi, realizedVol, sma } from '../server/engine/indicators.js';

// 300 daily candles trending at `drift` per day.
const candles = (start, drift, n = 300) => {
  const out = []; let c = start;
  for (let i = 0; i < n; i++) {
    const o = c; c = c * (1 + drift + (i % 2 ? 0.006 : -0.004));
    out.push({ t: Date.now() - (n - 1 - i) * 864e5, o, h: Math.max(o, c) * 1.005, l: Math.min(o, c) * 0.995, c, v: 2e6 + (i % 5) * 1e5, qv: c * 2e6, takerBuyQv: c * 1.1e6 });
  }
  return out;
};

const fakes = () => {
  const yahoo = {
    chart: async (sym) => {
      if (sym === 'NOPE') throw Object.assign(new Error('no chart'), { source: 'Yahoo Finance', status: 404 });
      const k = candles(sym === '^GSPC' ? 5000 : 100, sym === 'DOWN' ? -0.003 : 0.002);
      return { symbol: sym, name: sym === 'UP' ? 'Up Corp' : sym + ' Inc', price: k.at(-1).c, prevClose: k.at(-2).c, candles: k };
    },
    summary: async () => ({
      name: 'Up Corp', marketCap: 5e9, targetMean: 400, analysts: 20, trend: { strongBuy: 8, buy: 8, hold: 3, sell: 1, strongSell: 0 },
      fcf: 9e8, ocf: 1.2e9, netIncome: 1e9, operatingMargin: 0.3, roe: 0.25, debt: 1e9, cash: 2e9, ebitda: 1.5e9, evToEbitda: 8, institutions: 0.7
    }),
    news: async () => [{ title: 'Up Corp beats estimates and raises guidance' }, { title: 'Analysts upgrade Up Corp' }],
    search: async (q) => (q.toLowerCase() === 'apple' ? [{ symbol: 'UP', name: 'Apple Inc.', type: 'EQUITY' }] : []),
    screener: async (id) => (id === 'day_gainers' ? [{ k: 'UP', name: 'Up Corp', c: 5.1, p: 120, vol: 2.1 }] : [{ k: 'DOWN', name: 'Down Co', c: -4.2, p: 80, vol: 1.4 }])
  };
  const binance = {
    tickers: async () => [{ base: 'BTC', p: 60000, c: 2.5, quoteVolume: 1e9 }, { base: 'ETH', p: 3000, c: -1.5, quoteVolume: 5e8 }, { base: 'NVDAB', p: 100, c: 9, quoteVolume: 4e8 }],
    liquidBases: async () => new Set(['BTC', 'ETH', 'NVDAB']),
    chart: async (base, days) => { const k = candles(base === 'BTC' ? 50000 : 2000, 0.001, days || 365); return { symbol: base + 'USDT', price: k.at(-1).c, prevClose: k.at(-2).c, candles: k }; }
  };
  const sec = {
    lookup: async (t) => ({ UP: { cik: '0000000001', name: 'UP CORP' }, DOWN: { cik: '0000000002', name: 'DOWN CO' }, NVDA: { cik: '3', name: 'NVIDIA' } }[t] || null),
    annualFacts: async () => ({ fy: '2025-12-31', revenue: [1e10, 1.2e10], netIncome: [8e8, 1e9], ocf: [1e9, 1.3e9], capex: [2e8, 2e8], receivables: [1e9, 1.1e9] }),
    filings: async () => [{ form: '10-Q', date: '2026-10-30' }, { form: 'SC 13D', date: new Date().toISOString().slice(0, 10) }]
  };
  return { yahoo, binance, sec };
};

test('indicators', () => {
  const up = candles(100, 0.004).map(k => k.c);
  assert.ok(rsi(up) > 55);
  assert.ok(sma(up, 50) > sma(up, 200));
  assert.ok(realizedVol(up) > 0);
});

test('resolves stocks, coins, explicit pairs and company names', async () => {
  const live = createLive(fakes());
  assert.deepEqual(await live.resolve('Should we buy UP?'), { kind: 'stock', symbol: 'UP', yahoo: 'UP', market: 'US', currency: 'USD' });
  assert.equal((await live.resolve('Is BTC a buy?')).kind, 'crypto');
  assert.equal((await live.resolve('What about ETH-USD now')).symbol, 'ETH');
  assert.equal((await live.resolve('Should we buy Apple?')).symbol, 'UP');
  assert.equal(await live.resolve('should we buy something?'), null);
  // lower and mixed case tickers, and everyday words that must not become tickers
  assert.equal((await live.resolve('should we buy nvda?')).symbol, 'NVDA');
  assert.equal((await live.resolve('is this a good time for Nvda')).symbol, 'NVDA');
  assert.equal((await live.resolve('is btc a buy now')).kind, 'crypto');
  assert.equal((await live.resolve('what about $eth')).symbol, 'ETH');
  assert.equal((await live.resolve('what about apple')).symbol, 'UP');
  assert.equal(await live.resolve('is it a good time to buy'), null);
});

test('stock round uses every desk with real figures', async () => {
  const c = await createLive(fakes()).round('Should we buy UP?', 'trader');
  assert.equal(c.tk, 'UP');
  assert.equal(c.assetClass, 'stock');
  assert.equal(c.live, true);
  for (const id of ['analyst', 'filings', 'fundamental', 'risk', 'dealer', 'ma', 'technical']) {
    assert.ok(c.R[id].findings.length === 3, id);
    assert.ok(c.R[id].work.length === 4, id);
    assert.ok(c.R[id].sources.length >= 1, id);
  }
  assert.match(c.R.analyst.findings[0], /16 of 20 analysts rate it a buy/);
  assert.match(c.R.filings.findings[0], /Free cash flow is 110% of net income/);
  assert.match(c.R.ma.findings[1], /13D/);
  assert.equal(c.R.technical.stance, 'bull');
  assert.ok(['Buy', 'Short', 'Hold'].includes(c.call));
  assert.ok(c.debate.length >= 4);
});

test('crypto round marks filings and M&A as not applicable', async () => {
  const c = await createLive(fakes()).round('Is BTC a buy?', 'investor');
  assert.equal(c.assetClass, 'crypto');
  assert.equal(c.M.filings.fmt, 'text');
  assert.equal(c.M.ma.v, 'n/a');
  assert.equal(c.R.filings.stance, 'neutral');
  assert.equal(c.R.risk.findings[0].includes('leverage capped at 1x'), true);
});

test('tickets always have a positive target, even for very volatile names', () => {
  const wild = candles(100, 0).map((k, i) => ({ ...k, c: k.c * (i % 2 ? 1.12 : 0.9) }));
  const x = { kind: 'stock', mode: 'investor', closes: wild.map(k => k.c), candles: wild, p: 50 };
  const rk = desks.risk(x);
  assert.ok(rk.stopPct <= 25);
  assert.ok(50 * (1 - rk.stopPct * 3 / 100) > 0);
});

test('movers mix stocks and crypto and drop tokenized stocks', async () => {
  const m = await createLive(fakes()).movers();
  assert.deepEqual(m.map(x => x.k).sort(), ['BTC', 'DOWN', 'ETH', 'UP']);
  assert.ok(m.find(x => x.k === 'BTC').cls === 'crypto');
});

test('API: unknown ticker is a clear 422, live rounds execute at the current price', async () => {
  const store = openStore(':memory:'), market = createLive(fakes());
  const server = createApp({ store, market, openRoom: true }).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, body: await r.json() }));
  try {
    const bad = await post('/api/rounds', { brief: 'should we buy something?' });
    assert.equal(bad.status, 422);
    assert.match(bad.body.error, /No ticker found/);
    let r;
    for (let i = 0; i < 30; i++) { r = (await post('/api/rounds', { brief: `Should we buy UP? ${i}` })).body; if (r.ticket) break; }
    assert.ok(r.ticket, 'expected a round with a ticket');
    const ex = await post(`/api/rounds/${r.id}/execute`, {});
    assert.equal(ex.status, 201);
    assert.ok(Math.abs(ex.body.avgPrice / r.p - 1) < 0.05);
    const ch = await fetch(base + '/api/market/chart/BTC').then(x => x.json());
    assert.equal(ch.assetClass, 'crypto');
    assert.equal(ch.candles.length, 56);
  } finally { server.close(); store.close(); }
});

test('Tel Aviv: Hebrew and English names, .TA tickers, shekels in the findings, TA-35 and the New York counterpart', async () => {
  const f = fakes(), live = createLive(f);
  assert.equal((await live.resolve('האם לקנות את בנק לאומי?')).symbol, 'LUMI.TA');
  assert.equal((await live.resolve('מה דעתכם על טבע?')).symbol, 'TEVA.TA', 'a Hebrew name means the Tel Aviv share');
  assert.equal((await live.resolve('ומה עם ביטקוין')).kind, 'crypto');
  assert.equal((await live.resolve('ואפל?')).symbol, 'AAPL');
  assert.equal((await live.resolve('Should we buy POLI.TA?')).symbol, 'POLI.TA');
  assert.equal((await live.resolve('Should we buy LUMI?')).symbol, 'LUMI.TA', 'a Tel Aviv ticker typed without .TA');
  assert.equal((await live.resolve('Is Bank Leumi a buy?')).symbol, 'LUMI.TA');
  assert.equal((await live.resolve('Teva on the Tel Aviv exchange')).symbol, 'TEVA.TA');
  assert.equal((await live.resolve('Should we buy TEVA?')).yahoo, 'TEVA', 'the ticker alone: New York');
  const asked = [];
  f.yahoo.chart = (orig => async sym => { asked.push(sym); if (sym === 'ILS=X') return { price: 3.5, candles: candles(3.5, 0) }; return orig(sym); })(f.yahoo.chart);
  const c = await live.round('מה עם טבע?', 'trader');
  assert.equal(c.tk, 'TEVA.TA');
  assert.equal(c.currency, 'ILS');
  assert.equal(c.exchange, 'TASE');
  assert.ok(asked.includes('TA35.TA'), 'the TA-35 is the benchmark');
  assert.equal(c.benchName, 'TA-35');
  assert.equal(c.counterpart.symbol, 'TEVA');
  assert.equal(c.counterpart.exchange, 'New York');
  assert.ok(Math.abs(c.counterpart.equivalent - c.counterpart.price * 3.5) < 0.01, 'New York price in shekels');
  assert.match(c.ticket ? c.ticket.Entry : c.R.fundamental.findings.join(' '), /₪/);
  assert.doesNotMatch(JSON.stringify(c.R), /\$\d/, 'no dollar prices for a Tel Aviv share');
  const us = await live.round('Should we buy UP?', 'trader');
  assert.equal(us.currency, 'USD');
  assert.doesNotMatch(JSON.stringify(us.R), /₪/);
});

test('Tel Aviv: ratios and targets from the New York listing, dollar figures in shekels, no US sector fund, honest backdrop', async () => {
  const f = fakes(), base = f.yahoo.summary, asked = [];
  f.yahoo.summary = async sym => (sym === 'TEVA.TA' ? { ...(await base()), financialCurrency: 'USD', forwardPe: 47, pe: 50, evToEbitda: 37, targetMean: null, analysts: 0, debt: 1e9 }
    : sym === 'TEVA' ? { ...(await base()), financialCurrency: 'USD', forwardPe: 15, pe: 16, evToEbitda: 11, targetMean: 40, analysts: 12 } : base());
  f.yahoo.chart = (orig => async sym => { asked.push(sym); if (sym === 'ILS=X') return { price: 3.5, candles: candles(3.5, 0) }; return orig(sym); })(f.yahoo.chart);
  const live = createLive(f), ins = await live.resolve('מה עם טבע?');
  const x = await live.gather(ins, 'trader');
  assert.deepEqual([x.summary.forwardPe, x.summary.pe, x.summary.evToEbitda], [15, 16, 11], 'ratios from New York, not Yahoo\'s mixed-currency ones');
  assert.equal(x.summary.targetMean, 140, '$40 target at 3.5 shekels per dollar');
  assert.equal(x.summary.debt, 3.5e9, 'dollar debt in shekels');
  assert.equal(x.summary.targetsFrom, 'TEVA');
  assert.ok(!asked.some(s => /^XL/.test(s)), 'no US sector ETF for a Tel Aviv share');
  const lumi = await live.gather(await live.resolve('בנק לאומי'), 'trader');
  assert.equal(lumi.summary.forwardPe, (await base()).forwardPe ?? undefined, 'a shekel reporter keeps its own figures');
});
