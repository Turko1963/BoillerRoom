// The prediction log: every decision once, chained, never edited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store/db.js';
import { createApp } from '../server/app.js';
import { horizonSessions, benchmarkOf, verifyChain, entryFor } from '../server/engine/predictions.js';
import * as demo from '../server/market/demo.js';

test('horizon and benchmark are fixed at decision time', () => {
  assert.equal(horizonSessions({ mode: 'trader', ticket: { Horizon: '4 days to 2 weeks' } }), 10);
  assert.equal(horizonSessions({ mode: 'trader', ticket: { Horizon: '5 days to 3 weeks' } }), 15);
  assert.equal(horizonSessions({ mode: 'investor', ticket: { Horizon: '1 to 3 years' } }), 252);
  assert.equal(horizonSessions({ mode: 'trader', ticket: null }), 10);
  assert.deepEqual(benchmarkOf({ assetClass: 'stock', tk: 'NVDA' })[0], '^GSPC');
  assert.deepEqual(benchmarkOf({ assetClass: 'stock', tk: 'LUMI.TA', exchange: 'TASE' })[0], 'TA35.TA');
  assert.deepEqual(benchmarkOf({ assetClass: 'crypto', tk: 'BTC' })[0], 'ETH');
});

test('every round is logged once with its version, inputs and outputs; the log cannot be changed or deleted', async () => {
  const store = openStore(':memory:'), app = createApp({ store, market: demo, openRoom: true, translator: null });
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}/api`, post = b => fetch(base + '/rounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  try {
    const a = await post({ brief: 'Should we buy HLXN?' }), b = await post({ brief: 'Is VRDA a short into earnings?' });
    const list = (await (await fetch(base + '/predictions')).json()).predictions;
    assert.equal(list.length, 2);
    const p = await (await fetch(base + '/predictions/' + a.id)).json();
    assert.equal(p.input.brief, 'Should we buy HLXN?');
    assert.equal(p.output.call, a.call);
    assert.equal(p.output.vote.net, a.vote.net);
    assert.ok(p.version, 'the version that made it');
    assert.equal(p.benchmark, '^GSPC');
    assert.deepEqual((await (await fetch(base + '/predictions/verify')).json()), { ok: true, n: 2, brokenAt: null });
    assert.throws(() => store.tryRaw('UPDATE predictions SET output = 1'), /append-only/);
    assert.throws(() => store.tryRaw('DELETE FROM predictions'), /append-only/);
    // a tampered copy of the rows breaks the chain at the changed entry
    const rows = store.predictionRows(); rows[0] = { ...rows[0], output: rows[0].output.replace(a.call, 'Buy') === rows[0].output ? rows[0].output + ' ' : rows[0].output.replace(a.call, 'Buy') };
    assert.equal(verifyChain(rows).brokenAt, rows[0].id);
    assert.ok(b.id);
  } finally { srv.close(); }
});

test('the entry is built from the round alone', async () => {
  const c = await demo.round('Should we buy HLXN?', 'trader'), e = entryFor(c, { brain: 'rules', version: 'abc' });
  assert.equal(Object.keys(e.input.desks).length, 7);
  assert.equal(e.output.direction, c.direction);
  assert.equal(e.version, 'abc');
});
