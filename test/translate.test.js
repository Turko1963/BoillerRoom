// Hebrew rounds: the round's text is translated by a model (a fake here), numbers and ids stay, sentences are cached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateRound, textsOf } from '../server/engine/translate.js';
import { openStore } from '../server/store/db.js';
import { createApp } from '../server/app.js';
import * as demo from '../server/market/demo.js';

const fakeAsk = calls => async ({ prompt, schema }) => {
  calls.push(prompt);
  assert.deepEqual(schema.required, ['t']);
  const items = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
  return { data: { t: items.map(s => 'עב ' + s) } };
};

test('the text of a round is translated; calls, stances, desk ids, numbers and tickers are not', async () => {
  const r = await demo.round('Should we buy HLXN?', 'trader'), calls = [];
  const texts = textsOf(r).map(x => x.s);
  assert.ok(texts.includes(r.why) && texts.includes(r.R.risk.headline) && texts.includes(r.debate[0].lines[0][1]));
  assert.ok(!texts.includes('risk') && !texts.includes(r.call) && !texts.includes(r.brief));
  const store = openStore(':memory:');
  const he = await translateRound(r, { ask: fakeAsk(calls), cache: store.translations });
  assert.equal(he.lang, 'he');
  assert.equal(he.why, 'עב ' + r.why);
  assert.equal(he.R.risk.headline, 'עב ' + r.R.risk.headline);
  assert.equal(he.debate[0].lines[0][0], r.debate[0].lines[0][0], 'the speaker id stays');
  assert.equal(he.debate[0].lines[0][1], 'עב ' + r.debate[0].lines[0][1]);
  assert.deepEqual([he.call, he.R.risk.stance, he.conv, he.tk, he.brief], [r.call, r.R.risk.stance, r.conv, r.tk, r.brief]);
  assert.equal(r.why.startsWith('עב'), false, 'the English round is untouched');
  const n = calls.length;
  assert.equal(n, Math.ceil(new Set(texts).size / 20), 'chunks of 20 sentences, in parallel');
  // the same round again: every sentence comes from the cache, no call
  await translateRound(r, { ask: fakeAsk(calls), cache: store.translations });
  assert.equal(calls.length, n);
});

test('without a model, or when the model answers badly, the round stays in English and says why', async () => {
  const r = await demo.round('Should we buy HLXN?', 'trader');
  const none = await translateRound(r, { ask: null });
  assert.deepEqual([none.lang, none.why], ['en', r.why]);
  assert.match(none.langNote, /AI model/);
  const bad = await translateRound(r, { ask: async () => ({ data: { t: [] } }) });
  assert.equal(bad.lang, 'en');
  assert.match(bad.langNote, /failed/);
});

test('API: POST /rounds with lang he returns Hebrew text and saves the English round', async () => {
  const store = openStore(':memory:'), calls = [];
  const app = createApp({ store, market: demo, openRoom: true, translator: fakeAsk(calls) });
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}/api`, post = b => fetch(base + '/rounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  try {
    assert.equal((await post({ brief: 'HLXN', lang: 'fr' })).status, 400);
    const he = await (await post({ brief: 'Should we buy HLXN?', lang: 'he' })).json();
    assert.equal(he.lang, 'he');
    assert.match(he.why, /^עב /);
    const saved = await (await fetch(`${base}/rounds/${he.id}`)).json();
    assert.doesNotMatch(saved.why, /^עב /, 'saved in English');
    const en = await (await post({ brief: 'Should we buy HLXN?' })).json();
    assert.equal(en.lang, 'en');
  } finally { srv.close(); }
});

test('a bad answer is retried, then split in halves; what translates is kept', async () => {
  const r = await demo.round('Should we buy HLXN?', 'trader');
  let n = 0;
  const flaky = async ({ prompt }) => { n++; const items = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)); return { data: { t: n === 1 ? items.slice(1) : items.map(s => 'עב ' + s) } }; };
  const he = await translateRound(r, { ask: flaky, chunk: 100 });
  assert.equal(he.lang, 'he', 'the retry fixed it');
  assert.match(he.why, /^עב /);
  // one sentence the model always drops: everything else is Hebrew, and the round says what is missing
  const target = r.why;
  const picky = async ({ prompt }) => { const items = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)); return { data: { t: items.includes(target) ? [] : items.map(s => 'עב ' + s) } }; };
  const part = await translateRound(r, { ask: picky, chunk: 100 });
  assert.equal(part.lang, 'he');
  assert.equal(part.why, target);
  assert.match(part.R.risk.headline, /^עב /);
  assert.match(part.langNote, /1 sentences/);
});
