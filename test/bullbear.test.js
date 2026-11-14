// Bull vs Bear add-on: the feature flag, the page injection, and the adapter's mapping.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createApp } from '../server/app.js';
import { openStore } from '../server/store/db.js';
import * as market from '../server/market/demo.js';

const GATE = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const ROOM = readFileSync(new URL('../server/views/room.html', import.meta.url), 'utf8');
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

async function serve() {
  const store = openStore(':memory:'), server = createApp({ store, market, openRoom: true }).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = p => fetch(base + p).then(r => r.text());
  return { page, close: () => { server.close(); store.close(); } };
}

test('flag off: both pages are exactly as before', async () => {
  process.env.BULLBEAR = 'off';
  const s = await serve();
  try {
    assert.equal(await s.page('/'), GATE);
    assert.equal(await s.page('/room'), ROOM);
  } finally { s.close(); }
});

test('flag on: the component and adapters are added, nothing else changes', async () => {
  process.env.BULLBEAR = 'on';
  const s = await serve();
  try {
    const gate = await s.page('/'), room = await s.page('/room');
    assert.match(gate, /\/bullbear\/bullbear\.js/);
    assert.match(gate, /\/bullbear\/bullbear-intro\.js/);
    assert.doesNotMatch(gate, /bullbear-adapter/);
    assert.match(room, /<div id="bb-dock"/);
    assert.match(room, /\/bullbear\/bullbear-adapter\.js/);
    // removing the added lines gives back the original pages
    const strip = h => h.replace(/<link rel="stylesheet" href="\/bullbear[^>]*>|<script src="\/bullbear[^>]*><\/script>|<div id="bb-dock"[^>]*><\/div>|<script>addEventListener\('load'[^<]*<\/script>/g, '');
    assert.equal(strip(gate).replace(/\n+/g, '\n'), GATE.replace(/\n+/g, '\n'));
    assert.equal(strip(room).replace(/\n+/g, '\n'), ROOM.replace(/\n+/g, '\n'));
  } finally { s.close(); }
});

test('the features file turns it off without a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-'));
  process.env.FEATURES_DIR = dir; process.env.BULLBEAR = 'on';
  const { feature } = await import('../server/features.js?' + Date.now());
  try {
    assert.equal(feature('bullbear'), true);
    writeFileSync(join(dir, 'features.json'), JSON.stringify({ bullbear: false }));
    await new Promise(r => setTimeout(r, 3100)); // the file is re-read every 3 seconds
    assert.equal(feature('bullbear'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- the adapter, run against a recording fake of the component ---------- */
function runAdapter({ broken = false } = {}) {
  const calls = [], target = new EventTarget(), dock = { id: 'bb-dock', parentNode: { removeChild: () => { calls.push(['removed']); } } };
  const fake = {
    createArena: () => {
      if (broken) throw new Error('boom');
      return new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
    }
  };
  const win = {
    BullBear: fake, console: { warn: () => {} },
    addEventListener: (n, f) => target.addEventListener(n, f)
  };
  const ctx = vm.createContext({ window: win, BullBear: fake, document: { getElementById: () => dock, documentElement: { dataset: { theme: 'dark' } } },
    addEventListener: win.addEventListener, console: win.console });
  vm.runInContext(readFileSync(new URL('../public/bullbear/bullbear-adapter.js', import.meta.url), 'utf8'), ctx);
  const fire = (name, detail) => target.dispatchEvent(new CustomEvent('boilerroom:' + name, { detail }));
  return { calls, fire, ok: win.BB_ADAPTER_OK };
}

test('adapter: the score is confidence x vote weight, and the right animal is knocked out', () => {
  const a = runAdapter();
  assert.equal(a.ok, true);
  a.fire('brief', { brief: 'x', mode: 'trader' });
  assert.deepEqual(a.calls.at(-1), ['reset', 'The bell rings']);
  a.fire('report', { id: 'technical', name: 'Technical Analyst', stance: 'bull', conf: 80, weight: 1.6 });
  a.fire('report', { id: 'filings', name: 'Filings Specialist', stance: 'bear', conf: 70, weight: 0.7 });
  a.fire('report', { id: 'dealer', name: 'Dealer', stance: 'neutral', conf: 60, weight: 1.3 });
  const votes = a.calls.filter(c => c[0] === 'setVotes').at(-1)[1];
  assert.deepEqual({ ...votes }, { bull: 80 * 1.6, bear: 70 * 0.7, neutral: 60 * 1.3 });
  assert.deepEqual(a.calls.filter(c => c[0] === 'hit').map(c => c[1]), ['bull', 'bear', 'neutral']);
  // the filings desk changes its mind to neutral: the bulls gain
  a.fire('change', { id: 'filings', name: 'Filings Specialist', from: 'bear', oldConf: 70, stance: 'neutral', conf: 60, weight: 0.7 });
  assert.equal(a.calls.at(-1)[1], 'bull');
  assert.match(a.calls.at(-1)[2], /changes sides\. The bulls gain ground/);
  a.fire('speak', { id: 'technical', name: 'Technical Analyst', stance: 'bull', text: 'hi' });
  assert.equal(a.calls.at(-1)[1], 'bull');
  a.fire('vote', { id: 'filings', name: 'Filings Specialist', stance: 'neutral' });
  assert.match(a.calls.at(-1)[2], /Final round\. Filings Specialist stays neutral/);
  for (const [call, result] of [['Buy', 'bull'], ['Short', 'bear'], ['Sell', 'bear'], ['Hold', 'draw']]) {
    a.fire('decision', { call });
    assert.deepEqual(a.calls.at(-1), ['end', result], call);
  }
  a.fire('scout', {});
  assert.deepEqual(a.calls.at(-1), ['reset', 'The bell rings']);
});

test('adapter: if the component throws, the strip is removed and the room carries on', () => {
  const a = runAdapter({ broken: true });
  assert.notEqual(a.ok, true);
  assert.deepEqual(a.calls, [['removed']]);
  assert.doesNotThrow(() => a.fire('brief', {}));
});
