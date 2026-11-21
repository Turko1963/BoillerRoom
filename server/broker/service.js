// The broker link: from an approved ticket to a managed position on the cTrader DEMO account.
//
//   preview(round)   checks every rule and sizes the trade (nothing is sent)
//   send(round, id)  places the market order with its stop at the broker (a person approves each one)
//   tick()           the position manager, every few minutes: protective moves are automatic
//                    (stop to break-even, take half, trailing stop, time stop, out before earnings)
//
// Rules (agreed with the owner, backtested in server/engine/manage.js):
//   risk 1% of the balance per trade, at most 5% open risk, at most 5 open trades, no new trades after -3% today or
//   -6% this week, no crypto (no edge found), no new trade within 5 sessions of earnings, trader mode only.
//   Method C (default): all in at the entry; break-even after +1R; half off at +1.5R; trail 2 ATR; time stop 10
//   sessions if under +0.5R; out after 30. Method B (safe): half at the entry, the other half only with your OK once +1R.
// 1R is the distance from the entry to the stop; ATR is taken as R / 2 (the backtest's stop was 2 ATR).
// Only demo accounts are used unless CTRADER_ENV=live (an owner decision, not a code change).
import { randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { RULES, stats } from '../engine/manage.js';
import { nyTime } from '../engine/volwatch.js';
import * as ctrader from './ctrader.js';

// what the backtest found for each method (stocks, 10 years, earnings guard and at most 5 open trades), to judge the demo against
export const BACKTEST = { C: { winRate: 53, avgR: 0.13, profitFactor: 1.33, maxDrawdownR: -11.78 }, B: { winRate: 50, avgR: 0.07, profitFactor: 1.33, maxDrawdownR: -6.7 } };
export const LIMITS = { risk: 0.01, maxOpenRisk: 0.05, maxOpen: 5, dailyStop: -0.03, weeklyStop: -0.06, maxNotional: 4, previewMs: 3 * 60e3 };
const DAY = 864e5;

/* ---------- time in New York ---------- */
const nyParts = t => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
  .formatToParts(new Date(t)).map(p => [p.type, p.value]));
export const nyDate = t => { const p = nyParts(t); return `${p.year}-${p.month}-${p.day}`; };
const nyWeekday = t => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(nyParts(t).weekday);
/** Is the US stock market in its regular session (weekdays 9:30 to 16:00 New York; holidays not known). */
export const marketOpen = t => { const d = nyDate(t), w = nyWeekday(t); return w >= 1 && w <= 5 && t >= nyTime(d, 9, 30) && t < nyTime(d, 16, 0); };
/** Weekday sessions from the entry day to today (the entry day is session 0). */
export function sessionsSince(from, to) {
  let n = 0, t = Date.parse(nyDate(from) + 'T12:00:00Z');
  const end = Date.parse(nyDate(to) + 'T12:00:00Z');
  while (t < end) { t += DAY; const w = new Date(t).getUTCDay(); if (w >= 1 && w <= 5) n++; }
  return n;
}
const weekStart = t => { const d = new Date(Date.parse(nyDate(t) + 'T12:00:00Z')); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

/* ---------- tokens at rest: AES-256-GCM, key from the app secret (a new secret means connecting again) ---------- */
const keyFor = () => createHash('sha256').update('bsc-broker:' + (process.env.CTRADER_CLIENT_SECRET || '')).digest();
const seal = obj => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', keyFor(), iv), d = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]); return [iv, c.getAuthTag(), d].map(b => b.toString('base64')).join('.'); };
const unseal = s => { try { const [iv, tag, d] = s.split('.').map(b => Buffer.from(b, 'base64')), c = createDecipheriv('aes-256-gcm', keyFor(), iv); c.setAuthTag(tag); return JSON.parse(Buffer.concat([c.update(d), c.final()]).toString()); } catch { return null; } };

/** Which broker symbol is this ticker: NVDA -> "NVDA", "NVDA.US", "NVDA.O"... or a description with "(NVDA)". */
export function pickSymbol(list, ticker) {
  const T = ticker.toUpperCase(), up = s => String(s || '').toUpperCase();
  const rank = s => { const n = up(s.name); if (n === T) return 1; if (n === T + '.US' || n === T + '.O' || n === T + '.N' || n === T + '_US') return 2; if (n.startsWith(T + '.')) return 3; if (new RegExp(`\\(${T}(\\.[A-Z]+)?\\)`).test(up(s.description))) return 4; return 0; };
  return list.map(s => ({ s, r: rank(s) })).filter(x => x.r).sort((a, b) => a.r - b.r)[0]?.s || null;
}

/**
 * Methods C and B on one live position. p: the plan, px: the price now (bid for a long, ask for a short),
 * daily: true at the end-of-day step (break-even, trailing, time stop and earnings use the close, as in the backtest).
 * -> a list of actions: {type: 'partial'|'stop'|'close'|'addReady', ...}. Pure, so it is tested without a broker.
 */
export function manageStep(p, px, { daily = false, sessions = 0, earningsNext = false, rules = RULES } = {}) {
  const d = p.side === 'sell' ? -1 : 1, R = p.R, gain = (px - p.E) * d / R, out = [];
  if (!(R > 0)) return out;
  // half off at +1.5R, during the day
  if (!p.partial && gain >= rules.partialAt) out.push({ type: 'partial', why: `+${rules.partialAt}R reached: take half` });
  if (!daily) return out;
  if (earningsNext) return [...out, { type: 'close', why: 'earnings next session: out before the report' }];
  const high = d > 0 ? Math.max(p.high ?? p.E, px) : Math.min(p.high ?? p.E, px);
  let stop = p.stop;
  const better = s => (d > 0 ? s > stop : s < stop);
  if (p.method === 'B' && !p.added && sessions > 0 && sessions <= rules.addWithin && gain >= rules.addAt) out.push({ type: 'addReady', why: `+${rules.addAt}R: the plan adds the second half (needs your OK)` });
  if (gain >= rules.breakEvenAt) { const be = d > 0 ? Math.min(p.E, px - 0.1 * R) : Math.max(p.E, px + 0.1 * R); if (better(be)) stop = be; }
  if (p.partial || out.some(a => a.type === 'partial')) { const tr = high - d * rules.trailAtr * (R / 2); if (better(tr)) stop = tr; }
  if (stop !== p.stop) out.push({ type: 'stop', stop: +stop.toFixed(4), why: gain >= rules.partialAt ? 'trailing stop' : 'stop to break-even' });
  if (sessions >= rules.maxHold) out.push({ type: 'close', why: `${rules.maxHold} sessions: maximum hold` });
  else if (sessions >= rules.timeStop && gain < rules.minProgress) out.push({ type: 'close', why: `${rules.timeStop} sessions and under +${rules.minProgress}R: time stop` });
  out.high = high;
  return out;
}
/** What the plan does next, in words, for the Positions tab. */
export function nextAction(p, px, sessions = 0, rules = RULES) {
  const d = p.side === 'sell' ? -1 : 1, at = r => +(p.E + d * r * p.R).toFixed(2);
  if (p.method === 'B' && !p.added && sessions <= rules.addWithin) return `Add the second half at ${at(rules.addAt)} (+${rules.addAt}R, needs your OK)`;
  if (p.stop * d < p.E * d) return `Stop to break-even at ${at(rules.breakEvenAt)} (+${rules.breakEvenAt}R)`;
  if (!p.partial) return `Take half at ${at(rules.partialAt)} (+${rules.partialAt}R)`;
  return `Trailing ${rules.trailAtr} ATR behind the best close; time stop after ${rules.maxHold} sessions`;
}

/**
 * store: server/store/db.js. client: server/broker/ctrader.js (tests pass a fake).
 * earningsFor(ticker) -> next earnings date in ms or null. now: the clock.
 */
export function createBroker({ store, client = ctrader, earningsFor = async () => null, benchHistory = async () => null, now = () => Date.now(), log = console.log, limits = LIMITS } = {}) {
  const states = new Map(), previews = new Map();
  const logEv = (orderId, kind, text) => { store.brokerLog(now(), orderId, kind, text); log(`[broker] ${kind}: ${text}`); };
  const live = () => !client.env && process.env.CTRADER_ENV === 'live', envName = () => client.env || (live() ? 'live' : 'demo');
  const method = () => (store.kvGet('method') === 'B' ? 'B' : 'C');
  const tokens = () => { const s = store.kvGet('tokens'); return s ? unseal(s) : null; };
  const accountId = () => +store.kvGet('accountId') || null;
  const linked = () => !!(tokens() && accountId());

  async function freshToken() {
    const t = tokens();
    if (!t) throw Object.assign(new Error('The broker is not connected'), { status: 409 });
    if (t.expiresAt - now() > 2 * DAY || !t.refresh) return t.access;
    const n = await client.refreshToken(t.refresh);
    store.kvSet('tokens', seal(n));
    return n.access;
  }
  async function withAccount(fn) {
    const a = await client.account({ accessToken: await freshToken(), accountId: accountId() });
    try { return await fn(a); } finally { a.close(); }
  }

  // the paper broker needs no sign-in: it is linked from the start
  if (client.autoLink && !linked()) { store.kvSet('tokens', seal({ access: 'paper', refresh: null, expiresAt: now() + 3650 * DAY })); store.kvSet('accountId', 1); store.kvSet('login', ''); }

  /* ---------- connecting (OAuth) ---------- */
  function startConnect(memberName) {
    if (!client.configured()) throw Object.assign(new Error('cTrader keys are not set on the server (.env)'), { status: 503 });
    const state = randomBytes(18).toString('base64url');
    for (const [k, v] of states) if (now() - v.t > 10 * 60e3) states.delete(k);
    states.set(state, { t: now(), member: memberName });
    return client.authUrl(state);
  }
  async function finishConnect(code, state) {
    const s = states.get(state);
    states.delete(state);
    if (!s || now() - s.t > 10 * 60e3) throw Object.assign(new Error('This sign-in link expired. Start again from the room'), { status: 400 });
    const t = await client.exchangeCode(code);
    const list = (await client.accounts(t.access)).filter(a => live() ? a.live : !a.live);
    if (!list.length) throw Object.assign(new Error(live() ? 'No live account behind this sign-in' : 'No demo account behind this sign-in (only demo accounts are used)'), { status: 409 });
    const want = +process.env.CTRADER_LOGIN || null, pick = list.find(a => a.login === want) || list[0];
    store.kvSet('tokens', seal(t));
    store.kvSet('accountId', pick.accountId);
    store.kvSet('login', pick.login ?? '');
    logEv(null, 'connect', `connected ${live() ? 'LIVE' : 'demo'} account ${pick.login} by ${s.member || 'admin'}`);
    return { login: pick.login, accounts: list.map(a => a.login) };
  }
  function disconnect(who) { ['tokens', 'accountId', 'login'].forEach(store.kvDel); logEv(null, 'connect', `disconnected by ${who || 'admin'}`); }

  /* ---------- account numbers and limits ---------- */
  // balance at the start of the day and the week (the first time we see each), for the daily and weekly stops
  function marks(balance) {
    const d = 'day:' + nyDate(now()), w = 'week:' + weekStart(now());
    if (store.kvGet(d) == null) store.kvSet(d, balance);
    if (store.kvGet(w) == null) store.kvSet(w, balance);
    if (store.kvGet('start') == null) store.kvSet('start', JSON.stringify({ t: now(), balance })); // the demo starts here
    return { day: +store.kvGet(d), week: +store.kvGet(w) };
  }
  async function snapshot(a) {
    const info = await a.info(), pos = await a.positions(), open = store.listBrokerOrders('open');
    const rows = [];
    for (const o of open) {
      const p = pos.find(x => x.positionId === o.positionId);
      let px = null;
      if (p) px = await a.quote(o.symbolId).then(q => (o.side === 'sell' ? q.ask : q.bid)).catch(() => null);
      rows.push({ o, p, px });
    }
    const upnl = rows.reduce((s, r) => s + (r.p && r.px != null ? (r.px - r.p.price) * (r.o.side === 'sell' ? -1 : 1) * r.p.units : 0), 0);
    const equity = info.balance + upnl, m = marks(info.balance);
    const openRisk = rows.reduce((s, r) => s + (r.p ? Math.max(0, (r.p.price - (r.o.stop ?? r.p.stop)) * (r.o.side === 'sell' ? -1 : 1)) * r.p.units : 0), 0);
    return { info, rows, equity, upnl, today: equity - m.day, week: equity - m.week, openRisk };
  }
  let cache = null;
  async function status() {
    const base = { configured: client.configured(), env: envName(), linked: linked(), login: +store.kvGet('login') || null, method: method(), limits };
    if (!base.linked) return base;
    if (cache && now() - cache.t < 20e3) return { ...base, ...cache.v };
    try {
      const s = await withAccount(snapshot), b = s.info.balance;
      const v = { balance: b, equity: +s.equity.toFixed(2), today: +s.today.toFixed(2), week: +s.week.toFixed(2), openRisk: +s.openRisk.toFixed(2), riskUsed: b ? +(s.openRisk / b * 100).toFixed(1) : 0, open: s.rows.length, connected: true };
      cache = { t: now(), v };
      return { ...base, ...v };
    } catch (e) { return { ...base, connected: false, error: e.message }; }
  }

  /* ---------- the preview: every rule, and the size ---------- */
  async function preview(round) {
    const t = round.ticket, blocked = [], tk = round.tk;
    if (!t || round.call === 'Hold') throw Object.assign(new Error('The room decided to hold: nothing to send'), { status: 409 });
    if (round.assetClass === 'crypto') blocked.push('No crypto at the broker: the backtest found no edge in coins');
    if (round.mode !== 'trader') blocked.push('Broker trades follow the tested trader plan; investor tickets stay paper');
    if (!linked()) throw Object.assign(new Error('The broker is not connected'), { status: 409 });
    if (store.brokerOrderByRound(round.id)) throw Object.assign(new Error('This ticket was already sent to the broker'), { status: 409 });
    const side = round.call === 'Buy' ? 'buy' : 'sell', d = side === 'buy' ? 1 : -1;
    const earn = await earningsFor(tk).catch(() => null);
    if (earn && earn > now() - DAY && sessionsSince(now(), earn) <= RULES.earningsBlock) blocked.push(`Earnings ${new Date(earn).toISOString().slice(0, 10)}: no new trade within ${RULES.earningsBlock} sessions of the report`);
    return withAccount(async a => {
      const s = await snapshot(a), bal = s.info.balance;
      if (s.rows.length >= limits.maxOpen) blocked.push(`Already ${s.rows.length} open trades (the most is ${limits.maxOpen})`);
      if (s.today <= limits.dailyStop * marks(bal).day) blocked.push(`Daily stop: ${s.today.toFixed(2)} today (limit ${(limits.dailyStop * 100).toFixed(0)}%)`);
      if (s.week <= limits.weeklyStop * marks(bal).week) blocked.push(`Weekly stop: ${s.week.toFixed(2)} this week (limit ${(limits.weeklyStop * 100).toFixed(0)}%)`);
      if (!marketOpen(now())) blocked.push('The US market is closed: orders go in from 9:30 to 16:00 New York time');
      let symbols = null;
      const cached = store.kvGet('symbols:' + accountId());
      if (cached) { const c = JSON.parse(cached); if (now() - c.t < DAY) symbols = c.list; }
      if (!symbols && a.symbolFor) symbols = [await a.symbolFor(tk)]; // the paper broker trades any ticker
      if (!symbols) { symbols = await a.findSymbols(''); store.kvSet('symbols:' + accountId(), JSON.stringify({ t: now(), list: symbols })); }
      const sym = pickSymbol(symbols, tk);
      if (!sym) { blocked.push(`${tk} is not tradable on this account`); return { ok: false, blocked, ticker: tk, side }; }
      const info = await a.symbol(sym.symbolId), q = await a.quote(sym.symbolId), px = side === 'buy' ? q.ask : q.bid;
      const stop = round.stop, target = round.tgt, dist = (px - stop) * d;
      if (!(dist > 0)) blocked.push(`The price (${px.toFixed(2)}) is already past the stop (${stop.toFixed(2)})`);
      else if (target && (target - px) * d <= dist) blocked.push(`The price (${px.toFixed(2)}) ran too close to the target: less than 1 to 1 left`);
      const riskBudget = bal * limits.risk, room = Math.max(0, bal * limits.maxOpenRisk - s.openRisk), risk$ = Math.min(riskBudget, room);
      if (room < riskBudget * 0.5) blocked.push(`Open risk is ${s.openRisk.toFixed(2)} of ${(bal * limits.maxOpenRisk).toFixed(2)} allowed`);
      // volume in hundredths of a unit, rounded down to the broker's step; also capped by position value
      const step = info.stepVolume || 100, maxUnits = Math.min(dist > 0 ? risk$ / dist : 0, bal * limits.maxNotional / px);
      let volume = Math.floor(maxUnits * 100 / step) * step;
      if (info.maxVolume && volume > info.maxVolume) volume = info.maxVolume;
      if (volume < (info.minVolume || step)) { const minRisk = (info.minVolume || step) / 100 * Math.max(dist, 0); blocked.push(`The smallest size the broker allows risks ${minRisk.toFixed(2)}, more than the ${risk$.toFixed(2)} limit`); volume = 0; }
      const units = volume / 100, riskUsd = +(units * Math.max(dist, 0)).toFixed(2), m = method();
      const sendUnits = m === 'B' ? Math.floor(volume / 2 / step) * step / 100 : units;
      if (m === 'B' && volume && sendUnits * 100 < (info.minVolume || step)) blocked.push('Too small to split in halves (safe mode): use method C or a bigger account');
      const id = randomUUID(), at = n => +(px + d * n * Math.max(dist, 0)).toFixed(2);
      const v = { ok: !blocked.length, blocked, id, ticker: tk, symbol: sym.name, symbolId: sym.symbolId, side, price: px, stop: +stop.toFixed(2), target: target ? +target.toFixed(2) : null,
        units, sendUnits, volume, riskUsd, riskPct: bal ? +(riskUsd / bal * 100).toFixed(2) : 0, balance: bal, notional: +(units * px).toFixed(2), method: m,
        openRisk: +s.openRisk.toFixed(2), openTrades: s.rows.length, swapLong: info.swapLong, swapShort: info.swapShort, env: envName(),
        plan: m === 'C' ? [`All in: ${units} at about ${px.toFixed(2)}`, `Stop ${stop.toFixed(2)} at the broker (risk ${riskUsd.toFixed(2)})`, `Break-even after ${at(1)} (+1R)`, `Half off at ${at(1.5)} (+1.5R), then trail 2 ATR`, `Time stop: 10 sessions under +0.5R, out after 30`, 'Out the session before earnings']
          : [`Half now: ${sendUnits} at about ${px.toFixed(2)}`, `Stop ${stop.toFixed(2)} at the broker`, `Second half at ${at(1)} (+1R) with your OK, stop to break-even`, `Half off at ${at(1.5)}, then trail 2 ATR`, 'Time stop 10 sessions, out after 30, out before earnings'] };
      previews.set(id, { t: now(), roundId: round.id, v });
      return v;
    });
  }

  /* ---------- send: the person's approval of one preview ---------- */
  async function send(round, previewId, who) {
    const pv = previews.get(previewId);
    if (!pv || pv.roundId !== round.id || now() - pv.t > limits.previewMs) throw Object.assign(new Error('This preview expired. Check the order again'), { status: 409 });
    previews.delete(previewId);
    const fresh = await preview(round); // every rule again, at today's price
    if (!fresh.ok) throw Object.assign(new Error(fresh.blocked[0] || 'Blocked'), { status: 409, blocked: fresh.blocked });
    if (Math.abs(fresh.volume - pv.v.volume) > pv.v.volume * 0.25 || fresh.symbolId !== pv.v.symbolId) throw Object.assign(new Error('The price moved and the size changed. Check the order again'), { status: 409 });
    previews.delete(fresh.id);
    const vol = Math.round(fresh.sendUnits * 100), dist = Math.abs(fresh.price - fresh.stop), m = fresh.method;
    const id = randomUUID();
    const ex = await withAccount(a => a.marketOrder({ symbolId: fresh.symbolId, side: fresh.side, volume: vol, stopDistance: dist, targetDistance: null, label: 'BoilerRoom', comment: `round ${round.id.slice(0, 8)}` }));
    const E = ex.price || fresh.price; // no take-profit at the broker: the plan takes half at +1.5R and trails the rest
    const plan = { method: m, side: fresh.side, E, R: dist, stop: fresh.stop, high: E, partial: false, added: m === 'C', fullVolume: fresh.volume, openedAt: now(), lastDaily: null };
    store.addBrokerOrder({ id, roundId: round.id, createdAt: now(), member: who, ticker: fresh.ticker, symbolId: fresh.symbolId, symbolName: fresh.symbol, side: fresh.side, volume: vol, entry: E, stop: fresh.stop, target: fresh.target, risk: +(vol / 100 * dist).toFixed(2), positionId: ex.positionId, status: 'open', plan });
    cache = null;
    logEv(id, 'fill', `${fresh.side === 'buy' ? 'Bought' : 'Sold'} ${vol / 100} ${fresh.symbol} at ${E} (stop ${fresh.stop}) for ${who || 'member'}`);
    return { id, positionId: ex.positionId, price: E, units: vol / 100, stop: fresh.stop, symbol: fresh.symbol, side: fresh.side };
  }

  /* ---------- positions and closing ---------- */
  async function positions() {
    if (!linked()) return { linked: false, positions: [] };
    return withAccount(async a => {
      const s = await snapshot(a);
      const list = s.rows.map(({ o, p, px }) => {
        const d = o.side === 'sell' ? -1 : 1, pl = o.plan, sessions = sessionsSince(pl.openedAt, now()), cur = px ?? null;
        const r = cur != null ? +(((cur - pl.E) * d) / pl.R).toFixed(2) : null;
        return { id: o.id, ticker: o.ticker, symbol: o.symbolName, side: o.side, units: p ? p.units : o.volume / 100, entry: pl.E, stop: pl.stop, target: o.target, price: cur, r,
          pnl: p && cur != null ? +((cur - p.price) * d * p.units).toFixed(2) : null, sessions, method: pl.method, partial: pl.partial, addReady: !!pl.addReady,
          progress: cur != null ? Math.max(0, Math.min(1, ((cur - pl.stop) * d) / (Math.abs(pl.E + d * 1.5 * pl.R - pl.stop) || 1))) : null,
          next: nextAction(pl, cur ?? pl.E, sessions), atBroker: !!p };
      });
      return { linked: true, positions: list, closed: store.listBrokerOrders('closed', 20).map(o => ({ id: o.id, ticker: o.ticker, side: o.side, entry: o.entry, closedAt: o.closedAt, pnl: o.pnl, why: o.plan.exitWhy || null })) };
    });
  }
  const find = id => store.listBrokerOrders('open').find(o => o.id === id);
  async function closePart(a, o, frac, why) {
    const pos = (await a.positions()).find(x => x.positionId === o.positionId);
    if (!pos) return markClosed(a, o, 'closed at the broker');
    const info = await a.symbol(o.symbolId), step = info.stepVolume || 100;
    let vol = frac >= 1 ? pos.volume : Math.floor(pos.volume * frac / step) * step;
    if (vol < (info.minVolume || step) || pos.volume - vol < (info.minVolume || step)) vol = frac >= 1 ? pos.volume : 0;
    if (!vol) return { ex: null, plan: { ...o.plan, partial: true } }; // too small to split: keep it whole, trail it
    const ex = await a.closePosition(o.positionId, vol);
    const px = ex.price || null, d = o.side === 'sell' ? -1 : 1, pnl = px != null ? (px - o.plan.E) * d * vol / 100 : null;
    const plan = { ...o.plan, realized: +((o.plan.realized || 0) + (pnl || 0)).toFixed(2) };
    if (vol >= pos.volume) {
      const exact = await a.positionPnl?.(o.positionId, o.createdAt, now()).catch(() => null); // with swap and commission when the broker has it
      if (exact != null) plan.realized = exact;
      store.updateBrokerOrder(o.id, { status: 'closed', closedAt: now(), pnl: plan.realized, plan: { ...plan, exitWhy: why }, volume: 0 });
      logEv(o.id, 'close', `Closed ${o.symbolName}${px != null ? ' at ' + px : ''}: ${why}${pnl != null ? ` (${plan.realized >= 0 ? '+' : ''}${plan.realized})` : ''}`);
    } else {
      store.updateBrokerOrder(o.id, { volume: pos.volume - vol, plan: { ...plan, partial: true } });
      logEv(o.id, 'partial', `Took ${vol / 100} of ${o.symbolName} off${px != null ? ' at ' + px : ''}: ${why}`);
    }
    cache = null;
    return { ex, plan: { ...plan, partial: vol < pos.volume || plan.partial } };
  }
  async function markClosed(a, o, why) {
    // the broker closed it (stop hit): the money comes from its deals, with what we already took off
    const pnl = await a.positionPnl?.(o.positionId, o.createdAt, now()).catch(() => null);
    store.updateBrokerOrder(o.id, { status: 'closed', closedAt: now(), pnl: pnl ?? null, plan: { ...o.plan, exitWhy: why } });
    logEv(o.id, 'close', `${o.symbolName} is no longer open: ${why}${pnl != null ? ` (${pnl >= 0 ? '+' : ''}${pnl})` : ''}`);
    cache = null;
    return null;
  }
  async function close(id, part, who) {
    const o = find(id);
    if (!o) throw Object.assign(new Error('No open position with this id'), { status: 404 });
    return withAccount(a => closePart(a, o, part === 'half' ? 0.5 : 1, `closed by ${who || 'member'}${part === 'half' ? ' (half)' : ''}`));
  }
  async function closeAll(who) {
    const open = store.listBrokerOrders('open');
    await withAccount(async a => { for (const o of open) await closePart(a, o, 1, `close all by ${who || 'member'}`).catch(e => logEv(o.id, 'error', e.message)); });
    return { closed: open.length };
  }
  /** Method B: the second half, once the plan says it is ready, with a person's OK (it adds risk). */
  async function addHalf(id, who) {
    const o = find(id);
    if (!o || !o.plan.addReady || o.plan.added) throw Object.assign(new Error('Nothing to add on this position'), { status: 409 });
    return withAccount(async a => {
      const add = o.plan.fullVolume - o.volume;
      const q = await a.quote(o.symbolId), px = o.side === 'sell' ? q.bid : q.ask, newStop = o.plan.E;
      if ((px - newStop) * (o.side === 'sell' ? -1 : 1) <= 0) throw Object.assign(new Error('The price fell back: no add'), { status: 409 });
      const ex = await a.marketOrder({ symbolId: o.symbolId, side: o.side, volume: add, stopDistance: Math.abs(px - newStop), label: 'BoilerRoom', comment: 'add' });
      if (ex.positionId && ex.positionId !== o.positionId) logEv(o.id, 'note', 'the add opened a separate position at the broker');
      await a.amend(o.positionId, { stop: newStop });
      store.updateBrokerOrder(o.id, { volume: o.volume + add, stop: newStop, plan: { ...o.plan, added: true, addReady: false, stop: newStop } });
      logEv(o.id, 'fill', `Added ${add / 100} ${o.symbolName} at ${px} for ${who || 'member'}; stop to break-even ${newStop}`);
      cache = null;
      return { ok: true };
    });
  }

  /* ---------- the position manager ---------- */
  let busy = false;
  async function tick() {
    const open = store.listBrokerOrders('open');
    if (busy || !open.length || !linked()) return { checked: 0 };
    const t = now(), mo = marketOpen(t);
    if (!mo) return { checked: 0, closedMarket: true };
    // the end-of-day step runs in the last minutes of the session, so closes still fill today
    const daily = t >= nyTime(nyDate(t), 15, 45), today = nyDate(t);
    busy = true;
    try {
      return await withAccount(async a => {
        const pos = await a.positions();
        for (const o of open) {
          try {
            const p = pos.find(x => x.positionId === o.positionId);
            if (!p) { await markClosed(a, o, 'stopped or closed at the broker'); continue; }
            const q = await a.quote(o.symbolId), px = o.side === 'sell' ? q.ask : q.bid;
            const runDaily = daily && o.plan.lastDaily !== today, sessions = sessionsSince(o.plan.openedAt, t);
            let earningsNext = false;
            if (runDaily) { const e = await earningsFor(o.ticker).catch(() => null); earningsNext = !!e && e > t && sessionsSince(t, e) <= 1; }
            const acts = manageStep(o.plan, px, { daily: runDaily, sessions, earningsNext });
            let plan = { ...o.plan };
            if (runDaily) plan = { ...plan, lastDaily: today, high: acts.high ?? plan.high };
            for (const act of acts) {
              if (act.type === 'close') { await closePart(a, { ...o, plan }, 1, act.why); plan = null; break; }
              if (act.type === 'partial') { const r = await closePart(a, { ...o, plan }, RULES.partialFrac, act.why); plan = { ...plan, ...(r?.plan || {}), partial: true }; }
              if (act.type === 'stop') { await a.amend(o.positionId, { stop: act.stop }); plan.stop = act.stop; logEv(o.id, 'stop', `${o.symbolName}: stop moved to ${act.stop} (${act.why})`); }
              if (act.type === 'addReady' && !plan.addReady) { plan.addReady = true; logEv(o.id, 'add', `${o.symbolName}: ${act.why}`); }
            }
            if (plan) store.updateBrokerOrder(o.id, { plan, stop: plan.stop });
          } catch (e) { logEv(o.id, 'error', `${o.symbolName}: ${e.message}`); }
        }
        cache = null;
        return { checked: open.length };
      });
    } finally { busy = false; }
  }

  /* ---------- the demo against the benchmark: the account since the start, the S&P 500 over the same days, trades in R ---------- */
  async function benchmark() {
    const st = await status(), start = JSON.parse(store.kvGet('start') || 'null');
    if (!st.linked || !start) return { linked: st.linked, started: false };
    const days = Math.max(0, Math.floor((now() - start.t) / DAY)), eq = st.equity ?? st.balance;
    const room = eq != null && start.balance ? +((eq / start.balance - 1) * 100).toFixed(2) : null;
    let bench = null, curve = [];
    const c = await benchHistory().catch(() => null);
    if (c?.length) {
      const startDay = Date.parse(nyDate(start.t) + 'T00:00:00Z'), i0 = c.findLastIndex(k => k.t < startDay);
      const base = c[Math.max(0, i0)], last = c.at(-1);
      if (base && last && last.t >= base.t) bench = { name: 'S&P 500', pct: +((last.c / base.c - 1) * 100).toFixed(2) };
      // day by day: the balance at the start of each day against the S&P 500 close the day before
      const dayMarks = store.kvPrefix('day:').map(r => ({ d: r.key.slice(4), v: +r.value })).sort((x, y) => x.d.localeCompare(y.d));
      if (base) curve = dayMarks.map(m => { const t = Date.parse(m.d + 'T00:00:00Z'), k = c.findLast(x => x.t < t) || base; return { d: m.d, room: +((m.v / start.balance - 1) * 100).toFixed(2), bench: +((k.c / base.c - 1) * 100).toFixed(2) }; });
      if (curve.length && room != null) curve.push({ d: nyDate(now()), room, bench: bench?.pct ?? 0, now: true });
    }
    const closed = store.listBrokerOrders('closed', 500).filter(o => o.pnl != null && o.risk > 0);
    const trades = stats(closed.map(o => ({ r: o.pnl / o.risk, t: o.createdAt, hold: sessionsSince(o.createdAt, o.closedAt || now()) })));
    const m = method(), ref = BACKTEST[m], enough = trades.trades >= 20 && days >= 28;
    let verdict;
    if (!trades.trades) verdict = 'No closed trades yet. The comparison starts with the first one.';
    else if (!enough) verdict = `Too early to judge: ${trades.trades} closed trade${trades.trades === 1 ? '' : 's'} in ${days} day${days === 1 ? '' : 's'}. The plan is 4 to 6 weeks and at least 20 trades.`;
    else {
      const beat = room != null && bench && room > bench.pct, onPlan = trades.avgR >= ref.avgR * 0.5 && (trades.profitFactor ?? 0) >= 1.1;
      verdict = onPlan && beat ? 'On plan and ahead of the S&P 500: the numbers support a small live start (0.5% risk), if you decide so.'
        : onPlan ? 'The trades behave like the backtest, but the account is behind the S&P 500 so far. Keep going on demo.'
        : 'The trades are weaker than the backtest. Stay on demo and look at what is different before any live money.';
    }
    return { linked: true, started: true, since: start.t, days, startBalance: start.balance, equity: eq, room, bench, curve: curve.slice(-90), trades, method: m, backtest: ref, enough, verdict };
  }

  return { benchmark, status, startConnect, finishConnect, disconnect, preview, send, positions, close, closeAll, addHalf, tick,
    setMethod: m => { store.kvSet('method', m === 'B' ? 'B' : 'C'); return method(); },
    log: since => store.listBrokerLog(since), linked };
}
