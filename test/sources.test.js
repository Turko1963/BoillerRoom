// News feeds (FT, Investing.com, Google News, Crypto Jungle) and CoinGecko skills, with no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseRss, matchWords, headlines } from '../server/data/news.js';
import * as desks from '../server/engine/desks.js';

const rss = items => `<?xml version="1.0"?><rss><channel><title>Feed</title>${items.map(i => `<item><title>${i.t}</title><link>https://x/${encodeURIComponent(i.t)}</link><pubDate>${new Date(i.d || Date.now()).toUTCString()}</pubDate>${i.s ? `<source url="https://s">${i.s}</source>` : ''}</item>`).join('')}</channel></rss>`;

test('RSS: titles, CDATA, entities and the Google News source suffix', () => {
  const items = parseRss(rss([{ t: '<![CDATA[Nvidia &amp; AMD rally]]>' }, { t: 'Fed holds rates &#8211; markets calm - Reuters', s: 'Reuters' }]), 'Google News');
  assert.equal(items[0].title, 'Nvidia & AMD rally');
  assert.equal(items[1].title, 'Fed holds rates – markets calm');
  assert.equal(items[1].publisher, 'Reuters');
  assert.ok(items[0].time > 0);
  assert.deepEqual(matchWords('NVDA', 'NVIDIA Corporation'), ['NVDA', 'NVIDIA']);
  assert.deepEqual(matchWords('BTC', 'Bitcoin'), ['BTC', 'Bitcoin']);
});

let realFetch;
before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    url = String(url);
    const body =
      url.includes('news.google.com') ? rss([{ t: 'Nvidia beats estimates - CNBC', s: 'CNBC', d: Date.now() - 1e5 }, { t: 'Same story twice - CNBC', s: 'CNBC' }]) :
      url.includes('ft.com/markets') ? rss([{ t: 'Nvidia shares slide as chip demand cools', d: Date.now() - 5e4 }, { t: 'Oil prices rise' }]) :
      url.includes('ft.com/companies') ? rss([{ t: 'Same story twice' }]) :
      url.includes('news_25') ? rss([{ t: 'NVDA options activity jumps' }, { t: 'Gold steady' }]) :
      url.includes('cryptojungle') ? '<html>Attention Required! | Cloudflare</html>' : rss([]);
    return new Response(body, { status: url.includes('cryptojungle') ? 403 : 200 });
  };
});
after(() => { globalThis.fetch = realFetch; });

test('headlines: every publisher, only about this stock, no duplicates, newest first', async () => {
  const h = await headlines({ kind: 'stock', symbol: 'NVDA', name: 'NVIDIA Corporation', extra: [{ title: 'Nvidia at an all-time high', time: Date.now(), publisher: 'Yahoo Finance' }] });
  const titles = h.items.map(i => i.title);
  assert.ok(titles.includes('Nvidia shares slide as chip demand cools'), 'FT headline that names the company');
  assert.ok(titles.includes('NVDA options activity jumps'), 'Investing.com headline that names the ticker');
  assert.ok(!titles.includes('Oil prices rise') && !titles.includes('Gold steady'), 'section headlines about other things are dropped');
  assert.equal(titles.filter(t => t === 'Same story twice').length, 1, 'no duplicates');
  assert.equal(titles[0], 'Nvidia at an all-time high', 'newest first');
  assert.deepEqual(Object.keys(h.sources).sort(), ['CNBC', 'Financial Times', 'Investing.com', 'Yahoo Finance']);
});

test('headlines: a blocked feed (Crypto Jungle behind Cloudflare) is skipped, not fatal', async () => {
  const h = await headlines({ kind: 'crypto', symbol: 'SOL', name: 'Solana' });
  assert.ok(Array.isArray(h.items));
  assert.equal(h.sources['Crypto Jungle'], undefined);
});

/* ---------- crypto desks with CoinGecko ---------- */
const candles = (n = 365) => Array.from({ length: n }, (_, i) => { const c = 100 + Math.sin(i / 20) * 10; return { o: c, h: c * 1.01, l: c * 0.99, c, v: 1e6, qv: c * 1e6, takerBuyQv: c * 6e5 }; });
const base = cg => { const k = candles(); return { kind: 'crypto', symbol: 'SOL', name: 'Solana', mode: 'trader', p: k.at(-1).c, candles: k, closes: k.map(x => x.c), news: [], newsSources: {}, bench: [], coingecko: cg, quoteVolume24h: 4e9 }; };
const SOL = { rank: 7, marketCap: 41.3e9, fdv: 44.5e9, volume24h: 4.18e9, circulating: 591.6e6, total: 637.6e6, max: null, ath: 293.31, athChangePct: -76.2, athDate: '2025-01-19T00:00:00Z', sentimentUp: 60.6, categories: ['Smart Contract Platform', 'Layer 1 (L1)'] };

test('Filings reads the token supply instead of saying n/a', () => {
  const r = desks.filings(base(SOL));
  assert.equal(r.metric.fmt, 'pct');
  assert.equal(Math.round(r.metric.v), 93);
  assert.match(r.findings[0], /93% of supply is circulating/);
  assert.match(r.findings[1], /No maximum supply/);
  assert.match(r.findings[2], /Fully diluted value \$44\.5bn, 8% above/);
  assert.deepEqual(r.sources, ['CoinGecko supply data']);
  // a low float with a hard cap: lots still to come
  const thin = desks.filings(base({ ...SOL, circulating: 2e8, max: 1e9, total: 1e9, fdv: 2e11, marketCap: 4e10 }));
  assert.equal(thin.stance ?? (thin.score < -0.2 ? 'bear' : 'x'), 'bear');
  // without CoinGecko: the old honest n/a
  assert.equal(desks.filings(base(null)).metric.v, 'n/a');
});

test('Fundamental, Analyst, M&A and Dealer use CoinGecko when it is there', () => {
  const x = base(SOL);
  const fu = desks.fundamental(x);
  assert.match(fu.findings[0], /rank #7 on CoinGecko/);
  assert.match(fu.findings[1], /76% below its all-time high of \$293\.31 \(2025-01\)/);
  const an = desks.analyst(x);
  assert.match(an.findings[0], /61% of CoinGecko voters are bullish/);
  assert.ok(an.sources.includes('CoinGecko community votes'));
  assert.match(desks.ma(x).findings[1], /Sector: Smart Contract Platform, Layer 1/);
  const dl = desks.dealer(x, { size: 2, lev: 1 });
  assert.match(dl.findings[0], /across all exchanges/);
});
