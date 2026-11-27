// Deterministic helpers shared by the demo market and the demo analysis engine.
// The same input string always produces the same sequence, so a brief always
// produces the same case (matching the original in-browser behaviour).

import { cur } from './currency.js';

// FNV-1a 32-bit hash.
export const hash = s => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h;
};

// mulberry32-style PRNG returning floats in [0, 1).
export const rng = h => () => {
  h |= 0; h = h + 0x6D2B79F5 | 0;
  let t = Math.imul(h ^ h >>> 15, 1 | h);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// 2 decimals for normal prices, more for sub-dollar tokens.
export const usd = v => cur() + (Math.abs(v) >= 1 ? v.toFixed(2) : Math.abs(v) >= 0.01 ? v.toFixed(4) : v.toPrecision(3));
export const low = t => t[0].toLowerCase() + t.slice(1);
