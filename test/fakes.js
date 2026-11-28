// Fake data sources for the live engine (no network), shared by the live and acceptance tests.
// 300 daily candles trending at `drift` per day.
export const candles = (start, drift, n = 300) => {
  const out = []; let c = start;
  for (let i = 0; i < n; i++) {
    const o = c; c = c * (1 + drift + (i % 2 ? 0.006 : -0.004));
    out.push({ t: Date.now() - (n - 1 - i) * 864e5, o, h: Math.max(o, c) * 1.005, l: Math.min(o, c) * 0.995, c, v: 2e6 + (i % 5) * 1e5, qv: c * 2e6, takerBuyQv: c * 1.1e6 });
  }
  return out;
};

export const fakes = () => {
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
