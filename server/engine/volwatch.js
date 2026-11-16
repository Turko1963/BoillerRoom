// Volatility watch: is a big move expected in this asset soon? Oil (WTI) is the default.
// Five checks, each met or not, from free sources:
//   1. fear      the asset's volatility index (OVX for oil, GVZ for gold, VIX for stocks, Deribit DVOL for BTC/ETH):
//                high, or jumping fast
//   2. curve     the futures curve (front month against the next): the spread moved sharply or flipped.
//                Assets without a futures curve use a price breakout instead (5 day swings far above the 60 day norm)
//   3. events    a market-moving event in the next hours: EIA / API inventories and the rig count (oil), Fed
//                decisions, OPEC+ meetings in the news, earnings (stocks)
//   4. crowding  speculators' positioning at an extreme: CFTC managed-money net position in its top or bottom 10%
//                of 3 years (oil, gold), or very lopsided Binance futures accounts (coins)
//   5. news      escalation headlines in the last two days (Hormuz, Iran, sanctions, attacks, OPEC cuts...)
// 3 or more met = "alert" (volatility expected), 2 = "watch", otherwise "calm". Checks that have no data count as not met.

const DAY = 864e5;

/* ---------- which instrument, which sources ---------- */
const PRESETS = {
  OIL: { y: 'CL=F', name: 'WTI crude oil', fear: '^OVX', fearName: 'OVX', curve: 'CL', ex: 'NYM', cot: '067651', news: 'oil', kind: 'oil' },
  BRENT: { y: 'BZ=F', name: 'Brent crude oil', fear: '^OVX', fearName: 'OVX', curve: 'BZ', ex: 'NYM', cot: '067651', news: 'Brent oil', kind: 'oil' },
  GOLD: { y: 'GC=F', name: 'Gold', fear: '^GVZ', fearName: 'GVZ', cot: '088691', news: 'gold price', kind: 'metal' },
  NATGAS: { y: 'NG=F', name: 'Natural gas', fear: null, curve: 'NG', ex: 'NYM', cot: '023651', news: 'natural gas', kind: 'gas' }
};
const ALIAS = { WTI: 'OIL', CL: 'OIL', 'CL=F': 'OIL', CRUDE: 'OIL', USOIL: 'OIL', BZ: 'BRENT', 'BZ=F': 'BRENT', UKOIL: 'BRENT', XAU: 'GOLD', 'GC=F': 'GOLD', GC: 'GOLD', NG: 'NATGAS', 'NG=F': 'NATGAS', GAS: 'NATGAS' };
const COINS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC', 'SUI', 'TON']);

/** What to watch for a symbol the user typed. */
export function instrument(sym) {
  const k = String(sym || 'OIL').trim().toUpperCase();
  const p = PRESETS[ALIAS[k] || k];
  if (p) return { id: ALIAS[k] || k, ...p };
  if (COINS.has(k) || /-USD$/.test(k)) { const b = k.replace(/-USD$/, ''); return { id: b, y: b, name: b, kind: 'crypto', fear: 'DVOL', fearName: 'Deribit DVOL', news: b === 'BTC' ? 'bitcoin' : b === 'ETH' ? 'ethereum' : b }; }
  return { id: k, y: k, name: k, kind: 'stock', fear: '^VIX', fearName: 'VIX', news: k };
}

/* ---------- 1. fear index ---------- */
const FEAR_HIGH = { '^OVX': 45, '^GVZ': 25, '^VIX': 25, DVOL: 70 };
export function fearCheck(closes, ticker, label) {
  if (!closes || closes.length < 6) return { met: false, available: false, text: `${label || 'Volatility index'}: no data` };
  const last = closes.at(-1), ago = closes.at(-6), ch = (last / ago - 1) * 100, hi = FEAR_HIGH[ticker] ?? 30;
  const met = last >= hi || ch >= 20;
  return { met, available: true, value: +last.toFixed(1), change5d: +ch.toFixed(1),
    text: `${label} ${last.toFixed(1)} (${ch >= 0 ? '+' : ''}${ch.toFixed(0)}% in 5 days)${met ? (last >= hi ? `: above ${hi}, fear is high` : ': jumping fast') : `: below ${hi} and steady`}` };
}

/* ---------- 2. futures curve (or price breakout) ---------- */
const MCODE = 'FGHJKMNQUVXZ';
/** Yahoo symbols of the next listed monthly contracts, e.g. CLF27.NYM, CLG27.NYM... */
export function contracts(root, ex, now = Date.now(), n = 4) {
  const d = new Date(now), out = [];
  for (let i = 1; i <= n; i++) { const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1)); out.push(`${root}${MCODE[m.getUTCMonth()]}${String(m.getUTCFullYear()).slice(2)}.${ex}`); }
  return out;
}
/** front and next: [{t,c}] daily closes of the two nearest contracts. Spread = front minus next, in % of the front. */
export function curveCheck(front, next) {
  if (!front?.length || !next?.length) return null;
  const nx = new Map(next.map(k => [new Date(k.t).toISOString().slice(0, 10), k.c]));
  const sp = front.map(k => { const b = nx.get(new Date(k.t).toISOString().slice(0, 10)); return b ? (k.c - b) / k.c * 100 : null; }).filter(v => v != null);
  if (sp.length < 6) return null;
  const now = sp.at(-1), ago = sp.at(-6), move = now - ago, flip = Math.sign(now) !== Math.sign(ago) && Math.abs(now - ago) > 0.3;
  const met = Math.abs(move) >= 1 || flip, shape = now >= 0 ? 'backwardation (tight supply)' : 'contango (loose supply)';
  return { met, available: true, value: +now.toFixed(2), change5d: +move.toFixed(2),
    text: `Front month ${now >= 0 ? '+' : ''}${now.toFixed(2)}% over the next, ${shape}; ${move >= 0 ? '+' : ''}${move.toFixed(2)} points in 5 days${flip ? ': the curve flipped' : met ? ': moving sharply' : ''}` };
}
/** No futures curve: are daily swings breaking out? 5 day realized volatility against 60 day. */
export function breakoutCheck(closes) {
  if (!closes || closes.length < 62) return { met: false, available: false, text: 'Not enough price history' };
  const r = closes.slice(1).map((c, i) => Math.log(c / closes[i])), sd = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
  const v5 = sd(r.slice(-5)), v60 = sd(r.slice(-60)), x = v60 ? v5 / v60 : 1, met = x >= 1.8;
  return { met, available: true, value: +x.toFixed(2), text: `Daily swings this week are ${x.toFixed(1)}x the 60 day norm${met ? ': breaking out' : ''}` };
}

/* ---------- 3. events ---------- */
// Fed decision days in 2026 and 2027 (the second day of each FOMC meeting, 2pm New York)
const FOMC = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-22', '2027-11-03', '2027-12-15'];
/** UTC ms for a New York wall-clock time (handles daylight saving). */
export function nyTime(dateStr, hh, mm) {
  const guess = Date.parse(`${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const asNy = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  return guess + (guess - asNy);
}
/** Scheduled events in the next `hours`: [{name, at, major}] */
export function upcomingEvents(kind, now = Date.now(), { hours = 36, earnings = null, opecNews = null } = {}) {
  const out = [], end = now + hours * 3600e3;
  for (let i = 0; i <= Math.ceil(hours / 24) + 1; i++) {
    const day = new Date(now + i * DAY), ds = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(day), wd = new Date(ds + 'T12:00:00Z').getUTCDay();
    if (kind === 'oil' || kind === 'gas') {
      if (wd === 2) out.push({ name: 'API inventory report', at: nyTime(ds, 16, 30), major: false });
      if (wd === 3 && kind === 'oil') out.push({ name: 'EIA weekly oil inventories', at: nyTime(ds, 10, 30), major: true });
      if (wd === 4 && kind === 'gas') out.push({ name: 'EIA natural gas storage', at: nyTime(ds, 10, 30), major: true });
      if (wd === 5) out.push({ name: 'Baker Hughes rig count', at: nyTime(ds, 13, 0), major: false });
    }
    if (FOMC.includes(ds)) out.push({ name: 'Fed rate decision', at: nyTime(ds, 14, 0), major: true });
  }
  if (earnings && earnings > now && earnings < end + 2 * DAY) out.push({ name: 'Earnings report', at: earnings, major: true });
  if (opecNews) out.push({ name: `OPEC+ in the news: “${opecNews.slice(0, 70)}”`, at: null, major: true });
  return out.filter(e => e.at == null || (e.at > now - 3600e3 && e.at <= end)).sort((a, b) => (a.at ?? now) - (b.at ?? now));
}
export function eventsCheck(events, now = Date.now()) {
  const soon = events.filter(e => e.major || (e.at && e.at - now < 24 * 3600e3));
  const fmt = e => e.at ? `${e.name} ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(e.at)} NY` : e.name;
  return { met: soon.some(e => e.major), available: true, events: events.map(e => ({ name: e.name, at: e.at })),
    text: events.length ? events.slice(0, 3).map(fmt).join('; ') : 'No market-moving events in the next 36 hours' };
}

/* ---------- 4. crowding ---------- */
/** CFTC rows [{date, long, short}] newest first: managed-money net position against its 3 year range. */
export function cotCheck(rows) {
  if (!rows || rows.length < 20) return { met: false, available: false, text: 'CFTC positioning not available' };
  const nets = rows.map(r => r.long - r.short), now = nets[0], below = nets.filter(v => v < now).length, pct = Math.round(below / (nets.length - 1 || 1) * 100);
  const met = pct >= 90 || pct <= 10;
  return { met, available: true, value: pct, date: rows[0].date,
    text: `Hedge funds net ${now >= 0 ? 'long' : 'short'} ${Math.abs(now).toLocaleString('en-US')} contracts, ${pct}th percentile of 3 years${met ? (pct >= 90 ? ': crowded long' : ': crowded short') : ''} (CFTC, ${rows[0].date})` };
}
export function crowdCheck(longPct) {
  if (longPct == null) return { met: false, available: false, text: 'Futures positioning not available' };
  const met = longPct >= 72 || longPct <= 35;
  return { met, available: true, value: longPct, text: `${longPct}% of Binance futures accounts are long${met ? ': crowded' : ''}` };
}

/* ---------- 5. news ---------- */
const ESCALATE = /\b(attack|attacks|attacked|strike|strikes|missile|drone|blockade|closure|close the strait|seize[ds]?|seizure|explosion|sanction|sanctions|embargo|war|escalat\w*|tanker|houthi|hormuz|outage|shut[s]? down|halt\w*|output cut|cuts output|supply cut|disruption|force majeure)\b/i;
export function newsCheck(items) {
  if (!items) return { met: false, available: false, text: 'News not available' };
  const hot = items.filter(h => ESCALATE.test(h.title));
  const met = hot.length >= 3;
  return { met, available: true, value: hot.length, headlines: hot.slice(0, 4).map(h => h.title),
    text: hot.length ? `${hot.length} escalation headline${hot.length === 1 ? '' : 's'} in 2 days${hot[0] ? `, e.g. “${hot[0].title.slice(0, 80)}”` : ''}` : 'No escalation headlines in 2 days' };
}

/** Put the five checks together. */
export function verdict(checks) {
  const met = checks.filter(c => c.met).length;
  return { met, of: checks.length, level: met >= 3 ? 'alert' : met === 2 ? 'watch' : 'calm' };
}

/* ---------- gathering (sources injected, so tests use fakes) ---------- */
export function createWatch({ yahoo, derivs, cftc, news, now = () => Date.now() }) {
  const cache = new Map();
  const soft = p => Promise.resolve(p).catch(() => null);
  async function check(sym) {
    const ins = instrument(sym), hit = cache.get(ins.id);
    if (hit && hit.exp > now()) return hit.val;
    const t = now(), closes = k => k?.candles?.map(x => x.c) || null;
    const [px, fear, futs, cot, headlines, opec, summary, perp] = await Promise.all([
      ins.kind === 'crypto' ? null : soft(yahoo.chart(ins.y, '6mo')),
      ins.fear === 'DVOL' ? soft(derivs.dvolSeries?.(ins.id)) : ins.fear ? soft(yahoo.chart(ins.fear, '1mo')) : null,
      ins.curve ? soft(Promise.all(contracts(ins.curve, ins.ex, t).map(s => yahoo.chart(s, '1mo').catch(() => null)))) : null,
      ins.cot ? soft(cftc.positions(ins.cot)) : null,
      soft(news.search(`${ins.news} (Hormuz OR Iran OR sanctions OR OPEC OR pipeline OR attack OR outage OR war) when:2d`)),
      ins.kind === 'oil' ? soft(news.search('OPEC+ meeting when:5d')) : null,
      ins.kind === 'stock' ? soft(yahoo.summary(ins.y)) : null,
      ins.kind === 'crypto' ? soft(derivs.perp(ins.id)) : null
    ]);
    const c1 = ins.fear === 'DVOL' ? fearCheck(fear, 'DVOL', ins.fearName) : fearCheck(closes(fear), ins.fear, ins.fearName);
    const live = (futs || []).filter(k => k?.candles?.length && t - k.candles.at(-1).t < 7 * DAY);
    const curve = live.length >= 2 ? curveCheck(live[0].candles, live[1].candles) : null, c2 = curve || breakoutCheck(closes(px));
    const opecHit = (opec || []).find(h => /opec/i.test(h.title) && /meet|meeting|talks|decid|output/i.test(h.title));
    const c3 = eventsCheck(upcomingEvents(ins.kind === 'crypto' || ins.kind === 'stock' || ins.kind === 'metal' ? 'macro' : ins.kind, t, { earnings: summary?.earningsDate, opecNews: opecHit?.title }), t);
    const c4 = ins.kind === 'crypto' ? crowdCheck(perp?.longPct ?? null) : cotCheck(cot);
    const c5 = newsCheck(headlines);
    const checks = [{ id: 'fear', label: 'Fear index', ...c1 }, { id: 'curve', label: curve ? 'Futures curve' : 'Price breakout', ...c2 },
      { id: 'events', label: 'Event calendar', ...c3 }, { id: 'crowding', label: 'Crowded positioning', ...c4 }, { id: 'news', label: 'Geopolitics and news', ...c5 }];
    const val = { symbol: ins.id, name: ins.name, price: px?.price ?? null, ...verdict(checks), checks, checkedAt: new Date(t).toISOString() };
    cache.set(ins.id, { val, exp: t + 5 * 60e3 });
    return val;
  }
  return { check, instrument };
}
