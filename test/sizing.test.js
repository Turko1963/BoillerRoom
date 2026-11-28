// The position size: one calculation, currencies converted with a dated rate, never assumed. Every rate below is SYNTHETIC
// (1 USD = 4 ILS, chosen for round numbers): it is not a market rate and nothing here reads one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { positionSize, normalizeQuote, fxFor, FX_MAX_AGE_H } from '../server/execution/sizing.js';
import { COLMEX_IL_CFD, NO_BROKER } from '../server/execution/profiles.js';
import { field } from '../server/execution/fields.js';
import { createApp } from '../server/app.js';
import { openStore } from '../server/store/db.js';
import * as demo from '../server/market/demo.js';
import { makeCase } from '../server/engine/case.js';

const NOW = Date.parse('2026-11-30T12:00:00Z'), ON = '2026-11-30';
// the reported case: Bank Leumi, entry 72.77 ILS, stop 68.71 ILS (4.06 ILS a share), quoted by the source in agorot
const LUMI = { side: 'buy', assetClass: 'stock', currency: 'ILS', sourceUnit: 'ILA', entry: 72.77, stop: 68.71, R: 4.06, scaleIn: { first: 0.5, riskIfAddedR: 0.75 } };
const AAPL = { side: 'buy', assetClass: 'stock', currency: 'USD', sourceUnit: 'USD', entry: 200, stop: 190, R: 10, scaleIn: { first: 0.5, riskIfAddedR: 0.75 } };
const ILS_USD = { rate: 0.25, inverse: 4, asOf: NOW - 36e5, source: 'synthetic test rate' };   // USD per 1 ILS
const USD_ILS = { rate: 4, inverse: 0.25, asOf: NOW - 36e5, source: 'synthetic test rate' };   // ILS per 1 USD
const USD1000 = { equity: 1000, currency: 'USD' };
const terms = fields => ({ ...COLMEX_IL_CFD, id: 'test', name: 'Test broker', fields: { ...COLMEX_IL_CFD.fields, ...fields } });

test('the reported bug: 2 Leumi shares are 145.54 ILS = 36.385 USD, and 8.12 ILS = 2.03 USD at the stop', () => {
  const s = positionSize({ plan: LUMI, account: USD1000, units: 2, fx: ILS_USD, now: NOW });
  assert.equal(s.status, 'ok');
  assert.deepEqual([s.nativeCurrency, s.accountCurrency], ['ILS', 'USD']);
  assert.deepEqual([s.notional.native, s.notional.account], [145.54, 36.385]);
  assert.deepEqual([s.risk.native, s.risk.account], [8.12, 2.03]);
  assert.equal(s.notional.pctOfEquity, 3.6, 'not 15%');
  assert.equal(s.risk.pctOfEquity, 0.2, 'not 1%');
  assert.deepEqual([s.fx.status, s.fx.direction, s.fx.inverseChecked], ['ok', 'USD per 1 ILS', true]);
  assert.match(s.stopNote, /not a cap/);
});

test('the full size by a 1% risk budget, not forced to 2 shares; the risk taken is what rounding leaves', () => {
  const s = positionSize({ plan: LUMI, account: USD1000, riskPct: 1, fx: ILS_USD, now: NOW });
  // 10 USD budget / (4.06 ILS = 1.015 USD a share) = 9.85 -> 9 shares
  assert.equal(s.units, 9);
  assert.equal(s.basis, 'risk budget');
  assert.equal(s.perUnit.stopDistance.account, 1.015);
  assert.equal(s.risk.account, 9.135);
  assert.equal(s.risk.pctOfEquity, 0.91, 'rounded down: under the 1% budget, and said so');
  assert.equal(s.notional.account, 163.7325);
  assert.deepEqual([s.scaleIn.first, s.scaleIn.add], [4, 4]);
});

test('lot and caps round down: the memo ceiling, no leverage without a known margin, a lot size, a broker minimum', () => {
  const capped = positionSize({ plan: LUMI, account: USD1000, fx: ILS_USD, ceilingPct: 5.8, now: NOW });
  // 5.8% of 1000 USD = 58 USD of notional / 18.1925 USD a share = 3.19 -> 3
  assert.deepEqual([capped.units, capped.basis], [3, 'memo ceiling']);
  const small = positionSize({ plan: LUMI, account: { equity: 100, currency: 'USD' }, riskPct: 10, fx: ILS_USD, now: NOW });
  assert.deepEqual([small.units, small.basis], [5, 'no leverage'], '100 USD buys 5 shares at 18.19 USD');
  assert.ok(small.notional.account <= 100);
  const lot = positionSize({ plan: LUMI, account: USD1000, fx: ILS_USD, profile: terms({ lotSize: field(5, 'units', 'configured', 'test terms', ON) }), now: NOW });
  assert.deepEqual([lot.units, lot.lot], [5, 5], '9 rounded down to a lot of 5');
  const min = positionSize({ plan: LUMI, account: USD1000, fx: ILS_USD, profile: terms({ minNotional: field(1000, 'USD', 'configured', 'test terms', ON) }), now: NOW });
  assert.deepEqual([min.units, min.status, min.basis], [0, 'too small', 'broker minimum']);
  const tiny = positionSize({ plan: LUMI, account: { equity: 50, currency: 'USD' }, riskPct: 1, fx: ILS_USD, now: NOW });
  assert.equal(tiny.status, 'too small');
  assert.match(tiny.why, /more than the 0.5 USD budget/);
});

test('notional, margin and risk are three numbers; margin is unknown unless the broker\'s is verified', () => {
  const s = positionSize({ plan: LUMI, account: USD1000, fx: ILS_USD, profile: COLMEX_IL_CFD, now: NOW });
  assert.equal(s.margin.status, 'unknown');
  assert.equal(s.margin.account, null);
  const m = positionSize({ plan: LUMI, account: USD1000, fx: ILS_USD, profile: terms({ margin: field(20, '% of value', 'configured', 'test terms', ON) }), units: 2, now: NOW });
  assert.deepEqual([m.notional.account, m.margin.account, m.risk.account], [36.385, 7.277, 2.03]);
});

test('an ILS account on a US share: the rate the other way', () => {
  const s = positionSize({ plan: AAPL, account: { equity: 10000, currency: 'ILS' }, riskPct: 1, fx: USD_ILS, now: NOW });
  // 100 ILS budget / (10 USD = 40 ILS a share) = 2.5 -> 2
  assert.deepEqual([s.units, s.perUnit.stopDistance.account, s.risk.account, s.notional.account], [2, 40, 80, 1600]);
  assert.equal(s.fx.direction, 'ILS per 1 USD');
});

test('a quote in agorot is a hundredth of a shekel, with its provenance', () => {
  assert.deepEqual(normalizeQuote(7277, 'ILA'), { value: 72.77, unit: 'ILS', sourceUnit: 'ILA', factor: 0.01, provenance: 'ILA is a hundredth of ILS: divided by 100' });
  assert.equal(normalizeQuote(72.77, 'ILS').factor, 1);
  const s = positionSize({ plan: LUMI, account: USD1000, fx: ILS_USD, now: NOW });
  assert.match(s.quote.normalized, /ILA to ILS/);
});

test('a missing, stale or inconsistent rate blocks the size only; the same currency needs no rate', () => {
  const missing = positionSize({ plan: LUMI, account: USD1000, fx: null, now: NOW });
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.units, undefined, 'no size at all, not a guessed one');
  assert.match(missing.blockedBy.join(' '), /No ILSUSD rate.*analysis stands/);
  const stale = positionSize({ plan: LUMI, account: USD1000, fx: { ...ILS_USD, asOf: NOW - (FX_MAX_AGE_H.value + 1) * 36e5 }, now: NOW });
  assert.equal(stale.fx.status, 'stale');
  assert.equal(stale.status, 'blocked');
  const flipped = positionSize({ plan: LUMI, account: USD1000, fx: { ...ILS_USD, rate: 4 }, now: NOW }); // the direction reversed
  assert.equal(flipped.fx.status, 'inconsistent');
  assert.equal(flipped.status, 'blocked');
  const same = positionSize({ plan: LUMI, account: { equity: 4000, currency: 'ILS' }, fx: null, now: NOW });
  assert.deepEqual([same.status, same.fx.status, same.units], ['ok', 'not needed', 9], '40 ILS / 4.06 = 9.85 -> 9');
  assert.equal(fxFor('USD', 'USD', null).rate, 1);
});

test('no currency is assumed: an account without one, or a plan without one, has no size', () => {
  assert.match(positionSize({ plan: LUMI, account: { equity: 1000 }, fx: ILS_USD, now: NOW }).blockedBy.join(' '), /never assumed/);
  assert.equal(positionSize({ plan: { ...LUMI, currency: null }, account: USD1000, fx: ILS_USD, now: NOW }).status, 'blocked');
  // no exchange rate written in the sizing code, and no dollar sign in it
  const src = readFileSync(new URL('../server/execution/sizing.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\$\d|USD'\s*[,)]/);
});

test('without a broker: the same size; verified costs shrink it; unverified ones are never counted as known', () => {
  const none = positionSize({ plan: LUMI, account: USD1000, fx: ILS_USD, now: NOW }), nb = positionSize({ plan: LUMI, account: USD1000, fx: ILS_USD, profile: NO_BROKER, now: NOW });
  assert.equal(none.units, nb.units);
  assert.equal(nb.costs.status, 'n/a');
  const guess = positionSize({ plan: LUMI, account: USD1000, fx: ILS_USD, profile: terms({ commission: field(0.5, '%', 'assumed'), spread: field(0.5, '%', 'assumed') }), now: NOW });
  assert.equal(guess.costs.status, 'not verified');
  assert.equal(guess.perUnit.cost.account, 0);
  const known = positionSize({ plan: LUMI, account: USD1000, fx: ILS_USD, profile: terms({ commission: field(2, '%', 'configured', 'test terms', ON), spread: field(1, '%', 'configured', 'test terms', ON) }), now: NOW });
  // 5% of 18.1925 USD = 0.9096 USD a share on top of the 1.015 to the stop: 10 / 1.9246 = 5.2 -> 5
  assert.equal(known.costs.status, 'verified');
  assert.equal(known.units, 5);
});

test('API: the size for an account is computed on demand and never written into the round or the log', async () => {
  const store = openStore(':memory:'), srv = createApp({ store, market: demo, openRoom: true, translator: null }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}/api`, get = p => fetch(base + p).then(async r => ({ status: r.status, body: await r.json() }));
  try {
    let brief; for (let i = 0; i < 300 && !brief; i++) if (makeCase(`Size ${i} on HLXN?`, 'trader').ticket) brief = `Size ${i} on HLXN?`;
    const r = await (await fetch(base + '/rounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief }) })).json();
    const rows = store.predictionRows(), saved = JSON.stringify(store.getRound(r.id));
    const usd = await get(`/rounds/${r.id}/size?equity=100000&currency=USD&risk=1`);
    assert.equal(usd.status, 200);
    assert.equal(usd.body.status, 'ok');
    assert.equal(usd.body.fx.status, 'not needed');
    assert.equal(usd.body.caps.find(c => c.name === 'memo ceiling').units >= usd.body.units, true, 'within the memo\'s size');
    const ils = await get(`/rounds/${r.id}/size?equity=4000&currency=ILS`);
    assert.equal(ils.body.status, 'blocked', 'the demo has no exchange rate: no size in shekels');
    const none = await get(`/rounds/${r.id}/size?equity=1000`);
    assert.equal(none.body.status, 'blocked');
    for (const q of ['equity=0', 'equity=1000&risk=20', 'equity=1000&currency=dollars', 'equity=1000&units=-1', 'equity=1000&profile=acme']) assert.equal((await get(`/rounds/${r.id}/size?${q}`)).status, 400, q);
    assert.equal((await get('/rounds/missing/size?equity=1000')).status, 404);
    assert.deepEqual(store.predictionRows(), rows);
    assert.equal(JSON.stringify(store.getRound(r.id)), saved);
  } finally { srv.close(); store.close(); }
});
