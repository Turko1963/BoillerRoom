// The Hebrew layer shared by both pages (public/i18n.js), loaded in a small fake page: phrases, templates, numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load(lang = 'he') {
  const store = { bsc_lang: lang }, el = () => ({ setAttribute() {}, appendChild() {} });
  const ctx = {
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    document: { documentElement: {}, querySelectorAll: () => [], body: null, addEventListener() {}, title: 'Boiler Room | BackStage Capital', getElementById: () => null, createElement: el, head: { appendChild() {} } },
    MutationObserver: class { observe() {} }, CustomEvent: class {}, NodeFilter: {}, Map
  };
  ctx.window = ctx;
  vm.runInNewContext(readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8'), ctx);
  return ctx.window.I18N;
}
const plain = s => s.replace(/[⁦⁩]/g, '');

test('phrases and sentence templates, with the parts translated too', () => {
  const { t } = load();
  assert.equal(t('Decision memo'), 'מזכר החלטה');
  assert.equal(t('Market Analyst swings for the bears'), 'אנליסט שוק מכה לטובת הדובים');
  assert.equal(t('Technical Analyst digs in. The bears gain ground'), 'אנליסט טכני מתבצר. הדובים מתקדמים');
  assert.equal(plain(t('Call: Short HLXN at 76% conviction. Memo is ready.')), 'החלטה: שורט HLXN בביטחון 76%. המזכר מוכן.');
  assert.equal(t('Market Analyst: Bearish'), 'אנליסט שוק: דובי');
  assert.equal(t('  Standing by  '), '  בהמתנה  ', 'spaces around are kept');
});

test('generic shapes never leave half-translated English; unknown text is left alone', () => {
  const { t } = load();
  assert.equal(t('out of 100'), 'out of 100');
  assert.equal(t('3 of 5'), '3 מתוך 5');
  assert.equal(t('Something we never wrote'), 'Something we never wrote');
});

test('numbers with a sign, % or currency are isolated left to right; a Hebrew prefix hyphen is not a minus', () => {
  const { t } = load();
  assert.equal(t('-1.24%'), '⁦-1.24%⁩');
  assert.equal(t('Slice 2 of 5 at $171.20'), 'מנה 2 מתוך 5 ב-⁦$171.20⁩');
  assert.equal(t('NVDA'), 'NVDA', 'tickers stay as they are');
});

test('in English nothing changes', () => {
  const { t, lang } = load('en');
  assert.equal(lang, 'en');
  assert.equal(t('Decision memo'), 'Decision memo');
});

test('both pages load the layer and offer the switch; the code screen still holds nothing from the room', () => {
  const gate = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const room = readFileSync(new URL('../server/views/room.html', import.meta.url), 'utf8');
  for (const page of [gate, room]) { assert.match(page, /<script src="\/i18n.js"><\/script>/); assert.match(page, /data-lang-toggle/); }
  assert.doesNotMatch(readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8'), /ACCESS_CODE|CTRADER|ANTHROPIC_API_KEY=/);
});
