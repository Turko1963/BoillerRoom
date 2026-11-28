// The broker-neutral execution layer: canonical instrument, profiles in configuration, cost fields with provenance,
// an evaluation that never changes the decision or its prediction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../server/execution/instrument.js';
import { field, weakest } from '../server/execution/fields.js';
import { PROFILES, listProfiles, NO_BROKER, COLMEX_IL_CFD } from '../server/execution/profiles.js';
import { evaluate } from '../server/execution/evaluate.js';
import { RESEARCH } from '../server/execution/assumptions.js';
import { COSTS } from '../server/engine/scoreboard.js';
import { openStore } from '../server/store/db.js';
import { createApp } from '../server/app.js';
import * as demo from '../server/market/demo.js';

test('one canonical instrument, apart from any broker symbol: exchange, currency, price unit', () => {
  assert.deepEqual(canonical({ tk: 'NVDA', assetClass: 'stock', currency: 'USD', instrument: { exchange: 'NasdaqGS', type: 'EQUITY' } }),
    { id: 'XNAS:NVDA', symbol: 'NVDA', exchange: 'XNAS', currency: 'USD', priceUnit: 'USD', sourceUnit: 'USD', kind: 'equity', underlying: null });
  const lumi = canonical({ tk: 'LUMI.TA', assetClass: 'stock', currency: 'ILS', instrument: { exchange: 'Tel Aviv', type: 'EQUITY' } });
  assert.deepEqual([lumi.id, lumi.priceUnit, lumi.sourceUnit], ['XTAE:LUMI', 'ILS', 'ILA'], 'shown in shekels, sent in agorot');
  assert.equal(canonical({ tk: 'BTC', assetClass: 'crypto' }).id, 'CRYPTO:BTC');
});

test('a field has a value only with its evidence; unknown has none; the weakest status wins', () => {
  assert.throws(() => field(0.05, '%', 'configured'), /provenance/);
  assert.deepEqual(field(1, '%', 'unknown', 'x', '2026-01-01'), { value: null, unit: '%', status: 'unknown', provenance: null, asOf: null, note: null });
  assert.equal(weakest([field(1, '%', 'configured', 'site', '2026-11-01'), field(2, '%', 'assumed')]), 'assumed');
  assert.equal(weakest([field(1, '%', 'observed', 'fill', '2026-11-01'), field(null, '%', 'unknown')]), 'unknown');
  assert.ok(Object.values(RESEARCH).every(f => f.status === 'assumed' && f.note), 'our assumptions say so, with a reason');
  assert.equal(COSTS.status, 'assumed');
  assert.equal(COSTS.stock, RESEARCH.roundTripStock.value, 'the grading takes its costs from the configuration');
});

test('profiles: No broker by default, Colmex only by hand, nothing connected, no Colmex term invented', () => {
  assert.equal(NO_BROKER.selectable, 'default');
  assert.equal(COLMEX_IL_CFD.selectable, 'manual');
  assert.ok(listProfiles().every(p => p.connected === false));
  assert.ok(Object.values(COLMEX_IL_CFD.fields).every(f => f.status === 'unknown' && f.value === null));
  for (const p of Object.values(PROFILES)) for (const k of ['commission', 'spread', 'financingLong', 'financingShort', 'fxConversion', 'contractMultiplier', 'lotSize', 'minNotional', 'margin', 'schedule', 'availability', 'shortable']) assert.ok(p.fields[k], `${p.id} ${k}`);
});

test('evaluation: No broker is research only and hypothetical; Colmex with unknown terms is unknown, needs a quote, claims nothing', async () => {
  const r = await demo.round('Should we buy HLXN?', 'trader');
  const plan = (await import('../server/engine/plan.js')).tradePlan(r), round = { ...r, tradePlan: plan };
  const nb = evaluate(round, { profileId: 'nobroker' });
  assert.deepEqual([nb.planStatus, nb.net.status, nb.admissible.status], ['research only', 'hypothetical', 'n/a']);
  assert.match(nb.net.text, /not a net result/);
  const cx = evaluate(round, { profileId: 'colmex-il-cfd' });
  assert.equal(cx.instrument.kind, 'cfd');
  assert.equal(cx.instrument.underlying, canonical(round).id, 'a CFD tracks the share');
  assert.equal(cx.admissible.status, 'unknown');
  assert.match(cx.admissible.reasons.join(' '), /shortable/, 'a short needs the shortable term');
  assert.equal(cx.net.status, 'unknown');
  assert.match(cx.net.text, /no claim of an edge/);
  assert.equal(cx.quote.status, 'none');
  assert.equal(cx.planStatus, 'needs a fresh broker quote');
  assert.equal(cx.brokerSymbol.status, 'unknown');
  const stale = evaluate(round, { profileId: 'colmex-il-cfd', quote: { bid: 1, ask: 2, asOf: Date.now() - 10 * 60e3 } });
  assert.equal(stale.quote.status, 'stale');
  assert.throws(() => evaluate(round, { profileId: 'acme' }), /Unknown execution profile/);
});

test('API: profiles listed; an evaluation never changes the saved prediction', async () => {
  const store = openStore(':memory:'), app = createApp({ store, market: demo, openRoom: true, translator: null });
  const srv = await new Promise(res => { const s = app.listen(0, () => res(s)); });
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  try {
    const r = await (await fetch(base + '/rounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: 'Should we buy HLXN?' }) })).json();
    assert.deepEqual((await (await fetch(base + '/execution/profiles')).json()).profiles.map(p => p.id), ['nobroker', 'colmex-il-cfd']);
    const before = store.predictionRows();
    const ev = await (await fetch(`${base}/rounds/${r.id}/execution?profile=colmex-il-cfd`)).json();
    assert.equal(ev.profile.id, 'colmex-il-cfd');
    assert.equal(ev.analysis.predictionHash, before[0].hash);
    assert.equal((await fetch(`${base}/rounds/${r.id}/execution?profile=acme`)).status, 400);
    assert.deepEqual(store.predictionRows(), before, 'the prediction log is untouched');
    assert.equal(store.getRound(r.id).execution, undefined, 'nothing written into the round');
  } finally { srv.close(); }
});
