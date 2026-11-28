// AI brain tests with a fake model (no network, no API cost).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, brains } from '../server/engine/ai.js';
import { createLive } from '../server/market/live.js';
import { createApp } from '../server/app.js';
import { openStore } from '../server/store/db.js';
import * as demo from '../server/market/demo.js';

const candles = (start, drift, n = 300) => {
  const out = []; let c = start;
  for (let i = 0; i < n; i++) { const o = c; c = c * (1 + drift + (i % 2 ? 0.006 : -0.004)); out.push({ o, h: Math.max(o, c) * 1.005, l: Math.min(o, c) * 0.995, c, v: 2e6, qv: c * 2e6, takerBuyQv: c * 1e6 }); }
  return out;
};
const sources = {
  yahoo: {
    chart: async s => { const k = candles(s === '^GSPC' ? 5000 : 100, 0.001); return { symbol: s, name: 'Up Corp', price: k.at(-1).c, prevClose: k.at(-2).c, candles: k }; },
    summary: async () => ({ targetMean: 150, analysts: 10, trend: { strongBuy: 3, buy: 3, hold: 3, sell: 1, strongSell: 0 }, operatingMargin: 0.2 }),
    news: async () => [{ title: 'Up Corp wins a big contract' }], search: async () => [], screener: async () => []
  },
  binance: { tickers: async () => [], liquidBases: async () => new Set(), chart: async () => { throw new Error('none'); } },
  sec: { lookup: async t => (t === 'UP' ? { cik: '1', name: 'UP' } : null), annualFacts: async () => null, filings: async () => [] }
};

// A fake model: answers by schema. failDesk makes one desk's call throw.
const fake = (opts = {}) => ({
  id: 'claude', label: 'Claude', ready: () => true, model: () => 'fake-model', describe: e => 'Claude: ' + e.message,
  calls: [],
  async ask({ system, schema, prompt }) {
    this.calls.push({ system, prompt });
    const p = schema.properties;
    if (p.stance) {
      if (opts.failDesk && system.includes(opts.failDesk)) throw new Error('boom');
      return { data: { stance: system.includes('Risk') ? 'bear' : 'bull', confidence: 80, headline: 'AI view.', findings: ['one 1', 'two 2', 'three 3'] }, usage: { input: 100, output: 20 } };
    }
    if (p.exchanges) {
      if (opts.failDebate) throw new Error('debate down');
      return { data: { exchanges: [
        { from: 'technical', to: 'risk', lines: [{ speaker: 'technical', text: 'Risk, the trend is up.' }, { speaker: 'risk', text: 'Fair. I move to neutral.' }], change: { desk: 'risk', stance: 'neutral', confidence: 60 } },
        { from: 'dealer', to: 'ma', lines: [{ speaker: 'dealer', text: 'M&A, any bid?' }, { speaker: 'nobody', text: 'bad line' }], change: { desk: 'none', stance: 'bull', confidence: 50 } },
        { from: 'analyst', to: 'filings', lines: [{ speaker: 'analyst', text: 'Filings, clean?' }, { speaker: 'filings', text: 'Clean.' }], change: { desk: 'none', stance: 'bull', confidence: 50 } }
      ] }, usage: { input: 500, output: 200 } };
    }
    if (p.why) return { data: { why: 'We buy because the desks agree.' }, usage: { input: 300, output: 40 } };
    if (p.checks) return { data: { checks: opts.factFix === false ? [] : [{ desk: 'analyst', index: 0, problem: 'wrong number', correction: 'One corrected 1' }, { desk: 'ma', index: 2, problem: 'not in the data', correction: '' }] }, usage: { input: 50, output: 10 } };
    throw new Error('unknown schema');
  }
});

let saved;
beforeEach(() => { saved = PROVIDERS.claude; });
afterEach(() => { PROVIDERS.claude = saved; });

test('Claude brain writes every desk, the debate and the memo; the vote still runs in code', async () => {
  const f = fake(); PROVIDERS.claude = f;
  const c = await createLive(sources).round('Should we buy UP?', 'trader', { brain: 'claude' });
  assert.equal(c.brain.id, 'claude');
  assert.equal(c.brain.model, 'fake-model');
  assert.deepEqual(c.brain.fallbacks, []);
  assert.equal(f.calls.length, 10); // 7 desks + fact-check + debate + memo
  for (const id of ['analyst', 'filings', 'fundamental', 'technical', 'ma', 'risk', 'dealer']) {
    assert.equal(c.R[id].ai, true);
    assert.equal(c.R[id].headline, 'AI view');
  }
  // the invalid exchange (a speaker who is not in it) is dropped
  assert.equal(c.debate.length, 2);
  assert.match(c.changes.join(' '), /Risk and Leverage moved from bearish to neutral/);
  assert.ok(c.why.startsWith('We buy because the desks agree.'), 'the memo is written by the model');
  assert.match(c.why, /the score is \+/, 'and the weighted score stays in it');
  assert.ok(c.ticket, 'six bulls and a neutral risk desk should produce a ticket');
  assert.equal(c.call, 'Buy');
  // the desks were given real data, not just the question
  assert.match(f.calls[0].prompt, /Your data/);
  assert.equal(c.brain.usage.input, 7 * 100 + 50 + 500 + 300);
  // the fact-checker corrected one finding and sent one back to the rules finding
  assert.equal(c.R.analyst.findings[0], 'One corrected 1');
  assert.notEqual(c.R.ma.findings[2], 'three 3', 'an unsupported finding without a correction falls back to the rules finding');
  assert.deepEqual(c.brain.factCheck, { checked: 21, fixed: 1, replaced: 1 });
  assert.ok(c.brain.steps.some(s => /fact-check .*1 corrected, 1 replaced/.test(s)));
  // the debate is asked for a devil's advocate
  assert.ok(f.calls.some(x => /devil's advocate/.test(x.system)));
});

test('a desk or the debate that fails falls back to rules without breaking the round', async () => {
  PROVIDERS.claude = fake({ failDesk: 'Dealer', failDebate: true });
  const c = await createLive(sources).round('Should we buy UP?', 'trader', { brain: 'claude' });
  assert.equal(c.R.dealer.ai, false);
  assert.equal(c.R.analyst.ai, true);
  assert.ok(c.brain.fallbacks.some(x => /Dealer/.test(x)));
  assert.ok(c.brain.fallbacks.some(x => /Debate/.test(x)));
  assert.ok(c.debate.length >= 4, 'scripted debate used');
});

test('rules brain makes no model calls', async () => {
  const f = fake(); PROVIDERS.claude = f;
  const c = await createLive(sources).round('Should we buy UP?', 'trader');
  assert.equal(c.brain.id, 'rules');
  assert.equal(f.calls.length, 0);
});

test('API validates the brain and health lists them', async () => {
  PROVIDERS.claude = { ...fake(), ready: () => false };
  const run = async (market, body) => {
    const store = openStore(':memory:'), server = createApp({ store, market, openRoom: true }).listen(0);
    await new Promise(r => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const h = await fetch(base + '/api/health').then(r => r.json());
      const r = await fetch(base + '/api/rounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { h, status: r.status, body: await r.json() };
    } finally { server.close(); store.close(); }
  };
  const a = await run(createLive(sources), { brief: 'Buy UP?', brain: 'claude' });
  assert.equal(a.status, 400);
  assert.match(a.body.error, /not set up/);
  assert.deepEqual(a.h.brains.map(b => b.id), ['rules', 'claude', 'gemini', 'both']);
  assert.equal((await run(createLive(sources), { brief: 'Buy UP?', brain: 'gpt' })).status, 400);
  PROVIDERS.claude = fake();
  const d = await run(demo, { brief: 'Buy HLXN?', brain: 'claude' });
  assert.equal(d.status, 400);
  assert.deepEqual(d.h.brains.map(b => b.id), ['rules']);
  assert.ok(brains().find(b => b.id === 'claude').ready);
});

test('memory: each AI desk is shown its own graded record', async () => {
  const f = fake({ factFix: false }); PROVIDERS.claude = f;
  const memory = () => ({ technical: { graded: 4, right: 1, hitRate: 25, onThisTicker: [], recentMistakes: [{ ticker: 'UP', yourStance: 'bull', priceMovePct: -6, right: false }] } });
  await createLive(sources).round('Should we buy UP?', 'trader', { brain: 'claude', memory });
  const tech = f.calls.find(c => /Technical Analyst/.test(c.system) && /Your data/.test(c.prompt));
  assert.match(tech.prompt, /"yourTrackRecord":\{"graded":4,"right":1,"hitRate":25/);
  assert.ok(!f.calls.find(c => /Market Analyst on Boiler Room/.test(c.system)).prompt.includes('yourTrackRecord'), 'only the desk with a record gets one');
});
