// Feature flags that can be switched without a deploy.
//
// Default comes from the environment (BULLBEAR=on|off, default on). An optional file
// data/features.json, for example {"bullbear": false}, overrides it and is re-read every
// few seconds, so a flag can be turned off by editing that file: no deploy, no restart.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FILE = () => join(process.env.FEATURES_DIR || 'data', 'features.json');
const onOff = v => (v == null ? null : !/^(0|off|false|no)$/i.test(String(v).trim()));
let cache = { at: 0, mtime: 0, data: {} };

function fileFlags() {
  if (Date.now() - cache.at < 3000) return cache.data;
  cache.at = Date.now();
  try {
    const m = statSync(FILE()).mtimeMs;
    if (m !== cache.mtime) cache = { at: cache.at, mtime: m, data: JSON.parse(readFileSync(FILE(), 'utf8')) || {} };
  } catch { cache = { at: cache.at, mtime: 0, data: {} }; }
  return cache.data;
}

/** Is a feature on? File first, then environment, then the default. */
export function feature(name, def = true) {
  const f = fileFlags()[name];
  if (typeof f === 'boolean') return f;
  return onOff(process.env[name.toUpperCase()]) ?? def;
}

/* ---------- Bull vs Bear: what gets added to each page when the flag is on ---------- */
const V = '1'; // bump to bust browser caches when the component files change
const BB_HEAD_ROOM = `<link rel="stylesheet" href="/bullbear/bullbear.css?v=${V}"><link rel="stylesheet" href="/bullbear/bullbear-boilerroom.css?v=${V}">`;
const BB_BODY_ROOM = `<div id="bb-dock" class="bb-dock" aria-label="Bull vs Bear"></div>
<script src="/bullbear/bullbear.js?v=${V}"></script><script src="/bullbear/bullbear-adapter.js?v=${V}"></script>
<script>addEventListener('load',function(){if(!window.BB_ADAPTER_OK){var d=document.getElementById('bb-dock');if(d)d.remove()}})</script>`;
const BB_HEAD_GATE = `<link rel="stylesheet" href="/bullbear/bullbear.css?v=${V}"><script src="/bullbear/bullbear.js?v=${V}"></script><script src="/bullbear/bullbear-intro.js?v=${V}"></script>`;

/** The page as served: unchanged with the flag off, the Bull vs Bear files added with it on. */
export function withFeatures(html, page) {
  if (!feature('bullbear')) return html;
  if (page === 'room') return html.replace('</head>', BB_HEAD_ROOM + '\n</head>').replace(/<\/body>(?![\s\S]*<\/body>)/, BB_BODY_ROOM + '\n</body>');
  if (page === 'gate') return html.replace('</head>', BB_HEAD_GATE + '\n</head>');
  return html;
}
