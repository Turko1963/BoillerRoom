// The crowd panel: the crowd's lean from each source, the comparison with the room, and the route (fake sources).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crowdRead, versus, crowdFor } from '../server/engine/crowdview.js';
import { createApp } from '../server/app.js';
import { openStore } from '../server/store/db.js';
import * as market from '../server/market/demo.js';

test('crowdRead: stocks lean on options and news; Reddit buzz is heat, not direction; blocked sources are listed', () => {
  const r = crowdRead({ kind: 'stock', buzz: { rank: 3, mentions: 900, mentionsAgo: 600, upvotes: 4000 }, options: { putCallOI: 0.55, putCallVolume: 0.6 }, tone: { s: 0.4, n: 12 } });
  assert.equal(r.lean, 'bull');
  assert.ok(r.heat >= .6, 'top 10 and rising: hot');
  const names = r.sources.map(s => s.name);
  assert.deepEqual(names, ['Reddit (via ApeWisdom)', 'StockTwits', 'Options traders', 'News headlines', 'X / Twitter']);
  assert.equal(r.sources.find(s => s.name === 'X / Twitter').available, false);
  assert.match(r.sources.find(s => s.name === 'StockTwits').text, /Blocked/);
  assert.match(r.sources[0].text, /#3 most talked about on Reddit: 900 mentions in 24 h \(\+50%/);
  assert.equal(r.voting, 2);
  const bear = crowdRead({ kind: 'stock', options: { putCallOI: 1.5 }, tone: { s: -0.5, n: 8 } });
  assert.equal(bear.lean, 'bear');
  assert.equal(crowdRead({ kind: 'stock' }).lean, null, 'nothing to read: no lean, not a guess');
});

test('crowdRead: coins use CoinGecko voters, Binance long share and Fear & Greed', () => {
  const r = crowdRead({ kind: 'crypto', cg: { sentimentUp: 82 }, perp: { longPct: 76 }, fg: { value: 80, label: 'Extreme Greed' }, tone: { s: .2, n: 10 } });
  assert.equal(r.lean, 'bull');
  assert.equal(r.extreme, true);
  assert.ok(r.sources.some(s => s.name === 'Binance futures traders' && /76% of Binance futures accounts are long/.test(s.text)));
});

test('versus: agree, disagree, split, and a warning when the crowd is one-sided', () => {
  const bull = { lean: 'bull', leanLabel: 'bullish', extreme: false }, hot = { ...bull, extreme: true };
  assert.equal(versus('Buy', bull).verdict, 'agree');
  assert.equal(versus('Short', bull).verdict, 'disagree');
  assert.equal(versus('Hold', bull).verdict, 'split');
  assert.match(versus('Buy', hot).text, /one-sided/);
  assert.equal(versus('Buy', { lean: null }).verdict, 'unknown');
});

test('GET /api/crowd: members only, validated, and the crowd next to the call', async () => {
  const fakes = {
    crowd: { redditBuzz: async () => ({ rank: 12, mentions: 300, mentionsAgo: 250, upvotes: 900 }), stocktwits: async () => null, fearGreed: async () => null },
    yahoo: { options: async () => ({ putCallOI: 1.4 }) }, news: { headlines: async () => ({ items: [{ title: 'Tesla shares tumble on weak deliveries' }, { title: 'Analysts downgrade Tesla' }] }) },
    coingecko: {}, derivs: {}
  };
  const store = openStore(':memory:'), server = createApp({ store, market, code: '123456', crowdSources: fakes }).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/crowd/TSLA')).status, 401);
    const u = await fetch(base + '/api/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '123456' }) });
    const H = { Cookie: u.headers.get('set-cookie').split(';')[0] };
    assert.equal((await fetch(base + '/api/crowd/TSLA?assetClass=bond', { headers: H })).status, 400);
    assert.equal((await fetch(base + '/api/crowd/TSLA?call=Maybe', { headers: H })).status, 400);
    const r = await fetch(base + '/api/crowd/TSLA?assetClass=stock&call=Buy&name=Tesla', { headers: H });
    assert.equal(r.status, 200);
    const c = await r.json();
    assert.equal(c.lean, 'bear');
    assert.equal(c.vs.verdict, 'disagree');
    assert.match(c.vs.text, /The crowd disagrees: it is bearish while the room says buy/);
  } finally { server.close(); store.close(); }
});

test('crowdFor survives every source failing', async () => {
  const boom = async () => { throw new Error('down'); };
  const c = await crowdFor({ symbol: 'BTC', kind: 'crypto', call: 'Hold' }, { crowd: { redditBuzz: boom, stocktwits: boom, fearGreed: boom }, yahoo: {}, news: { headlines: boom }, coingecko: { coin: boom }, derivs: { perp: boom } });
  assert.equal(c.lean, null);
  assert.equal(c.vs.verdict, 'unknown');
});
