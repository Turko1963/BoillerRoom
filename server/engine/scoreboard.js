// The scoreboard: was the room right, which desks are worth listening to, and how the
// paper portfolio is doing.
//
// evaluate(): grades every live call once its holding period has passed (10 sessions in
//   Trader mode, 60 in Investor) against the real close, and grades each desk's final stance.
// weightsFor(): turns each desk's record into its vote weight. A desk that is right more often
//   gets a bigger vote, a desk that is wrong more often a smaller one. A prior of 5 right out of
//   10 keeps a handful of results from swinging the room; nothing changes before 5 graded calls.
// portfolio(): replays every approved ticket over the real candles since it was filled:
//   stopped out, target hit, closed at the end of the horizon, or still open (marked to market).
import { RING, MODES, AG } from './team.js';
import { clamp } from './random.js';
import { horizonSessions, benchmarkOf } from './predictions.js';

// costs taken off every graded trade (a round trip), and the yearly cost of borrowing shares for a short
export const COSTS = { stock: 0.1, crypto: 0.2, borrowPerYear: 3 };
/** What a call earned against simply holding its benchmark, net of costs, in %. dir: +1 Buy, -1 Short, 0 Hold. */
export function excessOf({ dir, ret, benchRet, horizon, assetClass }) {
  if (benchRet == null) return null;
  const cost = dir === 0 ? 0 : (COSTS[assetClass === 'crypto' ? 'crypto' : 'stock'] + (dir < 0 ? COSTS.borrowPerYear * horizon / 252 : 0));
  return r2(dir * ret - cost - benchRet);
}

export const EVAL_SESSIONS = { trader: 10, investor: 60 };
const HOLD_SESSIONS = { trader: 20, investor: 250 };
const FLAT = { trader: 2, investor: 5 }; // % move that still counts as "flat" for neutral and hold
const MIN_GRADED = 5;
const r2 = v => Math.round(v * 100) / 100;

/** Each desk's stance after the debate (the debate can change minds). */
export function finalStances(round) {
  const st = {};
  for (const id of RING) st[id] = round.R[id].stance;
  for (const x of round.debate || []) if (x.e) st[x.e.id] = x.e.stance;
  return st;
}

const right = (stance, ret, flat) => (stance === 'bull' ? ret > 0 : stance === 'bear' ? ret < 0 : Math.abs(ret) < flat);
const dayOf = t => Math.floor(t / 864e5);

/** Index of the candle the round was decided on (the last one on or before that day). */
function entryIndex(candles, createdMs) {
  let i = -1;
  for (let k = 0; k < candles.length; k++) if (dayOf(candles[k].t) <= dayOf(createdMs)) i = k;
  return i;
}

export async function evaluate({ store, market, now = Date.now() }) {
  if (!market.history) return { graded: 0 };
  const todo = store.roundsWithoutOutcome().filter(r => r.live && (r.assetClass === 'stock' || r.assetClass === 'crypto'));
  const hist = new Map(), load = async (k, cls) => { const key = cls + ':' + k; if (!hist.has(key)) hist.set(key, await market.history(k, cls).catch(() => null)); return hist.get(key); };
  let graded = 0;
  for (const r of todo) {
    const c = await load(r.tk, r.assetClass);
    if (!c?.length) continue;
    // the horizon and benchmark fixed when the decision was made (the prediction log), else from the saved ticket
    const pred = store.predictionFor?.(r.id), horizon = pred?.horizon ?? horizonSessions(r), [bk, , bcls] = pred?.benchmark ? [pred.benchmark, null, r.assetClass === 'crypto' ? 'crypto' : 'stock'] : benchmarkOf(r);
    const i = entryIndex(c, Date.parse(r.createdAt)), j = i + horizon;
    if (i < 0 || j >= c.length) continue; // not enough sessions yet
    const ret = (c[j].c / r.p - 1) * 100, flat = FLAT[r.mode];
    const call = r.call === 'Buy' ? ret > 0 : r.call === 'Short' ? ret < 0 : Math.abs(ret) < flat;
    // the benchmark over the same days: its close on the entry day and on the exit day
    const b = await load(bk, bcls), bi = b ? entryIndex(b, Date.parse(r.createdAt)) : -1, bj = b ? entryIndex(b, c[j].t) : -1;
    const benchRet = bi >= 0 && bj > bi ? r2((b[bj].c / b[bi].c - 1) * 100) : null;
    const dir = r.call === 'Buy' ? 1 : r.call === 'Short' ? -1 : 0, excess = excessOf({ dir, ret, benchRet, horizon, assetClass: r.assetClass });
    const st = finalStances(r), desks = Object.fromEntries(RING.map(id => [id, { stance: st[id], right: right(st[id], ret, flat) }]));
    store.saveOutcome({ roundId: r.id, evaluatedAt: new Date(now).toISOString(), mode: r.mode, ret: r2(ret), call: r.call, callRight: call, desks, horizon, benchRet, excess, conviction: r.conv ?? null });
    graded++;
  }
  return { graded, pending: todo.length - graded };
}

/** Per desk record for a mode. */
function records(store, mode) {
  const rec = Object.fromEntries(RING.map(id => [id, { n: 0, right: 0 }]));
  const outs = store.listOutcomes(mode);
  for (const o of outs) for (const id of RING) if (o.desks[id]) { rec[id].n++; if (o.desks[id].right) rec[id].right++; }
  return { rec, n: outs.length };
}

/** Learned vote weights for decide(), or null while there are too few graded calls. */
export function weightsFor(store, mode) {
  const { rec, n } = records(store, mode);
  if (n < MIN_GRADED) return null;
  const base = MODES[mode].w, w = {};
  for (const id of RING) w[id] = r2(base[id] * clamp(2 * (rec[id].right + 5) / (rec[id].n + 10), 0.6, 1.5));
  return w;
}

/**
 * What each desk should remember before it speaks: its graded record in this mode, its past calls on this ticker,
 * and its latest mistakes. { [desk]: { graded, right, hitRate, onThisTicker: [...], recentMistakes: [...] } } or null.
 */
export function deskMemory(store, mode, ticker) {
  const outs = store.listOutcomes(mode);
  if (!outs.length) return null;
  const say = (o, d) => ({ ticker: o.ticker, date: String(o.evaluatedAt).slice(0, 10), yourStance: d.stance, priceMovePct: o.ret, right: d.right });
  return Object.fromEntries(RING.map(id => {
    const mine = outs.filter(o => o.desks?.[id]), right = mine.filter(o => o.desks[id].right).length;
    return [id, { graded: mine.length, right, hitRate: mine.length ? Math.round(right / mine.length * 100) : null,
      onThisTicker: mine.filter(o => o.ticker === ticker).slice(0, 5).map(o => say(o, o.desks[id])),
      recentMistakes: mine.filter(o => !o.desks[id].right).slice(0, 3).map(o => say(o, o.desks[id])) }];
  }));
}

const BRAIN_LABEL = { rules: 'Rules', claude: 'Claude', gemini: 'Gemini', both: 'Both' };
/** Hit rate and average edge per brain, from graded calls. Exported for tests. */
export function brainRecords(outs) {
  return Object.keys(BRAIN_LABEL).map(id => {
    const o = outs.filter(x => (x.brain || 'rules') === id), t = o.filter(x => x.call !== 'Hold');
    return { id, label: BRAIN_LABEL[id], graded: o.length, right: o.filter(x => x.callRight).length,
      hitRate: o.length ? Math.round(o.filter(x => x.callRight).length / o.length * 100) : null,
      avgEdge: t.length ? r2(t.reduce((s, x) => s + (x.call === 'Short' ? -x.ret : x.ret), 0) / t.length) : null };
  });
}

/**
 * Is the conviction worth anything? Trades by conviction band, split in time: the earlier half calibrates (what the hit
 * rate was in each band), the later half, never used to set anything, tests it. Below 10 trades in a band the answer is
 * "unknown". interval: a 95% Wilson interval on the test hit rate.
 */
export function calibration(outs) {
  const t = outs.filter(o => o.call !== 'Hold' && o.conviction != null).sort((a, b) => String(a.evaluatedAt).localeCompare(String(b.evaluatedAt)));
  const half = Math.floor(t.length / 2), cal = t.slice(0, half), test = t.slice(half);
  const BANDS = [[50, 59], [60, 69], [70, 79], [80, 100]];
  const rate = a => (a.length ? Math.round(a.filter(o => o.callRight).length / a.length * 100) : null);
  const wilson = a => { const n = a.length; if (n < 10) return null; const p = a.filter(o => o.callRight).length / n, z = 1.96, d = 1 + z * z / n, m = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.round((m - h) * 100), Math.round((m + h) * 100)]; };
  return { trades: t.length, calibrationSet: cal.length, testSet: test.length,
    bands: BANDS.map(([lo, hi]) => { const inb = o => o.conviction >= lo && o.conviction <= hi, c = cal.filter(inb), s = test.filter(inb);
      return { band: `${lo}-${hi}%`, calibration: { n: c.length, hitRate: c.length >= 10 ? rate(c) : null }, test: { n: s.length, hitRate: s.length >= 10 ? rate(s) : null, interval: wilson(s) } }; }) };
}

export function scoreboard(store) {
  const modes = {};
  for (const mode of Object.keys(MODES)) {
    const { rec, n } = records(store, mode), learned = weightsFor(store, mode);
    modes[mode] = {
      graded: n, learning: !!learned, minGraded: MIN_GRADED,
      desks: RING.map(id => ({ id, name: AG[id].name, n: rec[id].n, right: rec[id].right,
        hitRate: rec[id].n ? Math.round(rec[id].right / rec[id].n * 100) : null, baseWeight: MODES[mode].w[id], weight: learned ? learned[id] : MODES[mode].w[id] }))
    };
  }
  const outs = store.listOutcomes(), trades = outs.filter(o => o.call !== 'Hold');
  return {
    modes,
    // each brain on its own: is the AI actually right more often than the rules?
    brains: brainRecords(outs),
    calls: {
      graded: outs.length, right: outs.filter(o => o.callRight).length,
      hitRate: outs.length ? Math.round(outs.filter(o => o.callRight).length / outs.length * 100) : null,
      // average move in the direction of the call (a short that fell 3% counts as +3)
      avgEdge: trades.length ? r2(trades.reduce((t, o) => t + (o.call === 'Short' ? -o.ret : o.ret), 0) / trades.length) : null,
      // against simply holding the benchmark over the same days, net of costs (only calls graded with a benchmark)
      ...(() => { const ex = trades.filter(o => o.excess != null); return { excessN: ex.length, avgExcess: ex.length ? r2(ex.reduce((t, o) => t + o.excess, 0) / ex.length) : null }; })(),
      costs: COSTS
    },
    calibration: calibration(outs),
    pending: store.roundsWithoutOutcome().filter(r => r.live).length,
    recent: outs.slice(0, 12).map(o => ({ roundId: o.roundId, ticker: o.ticker, mode: o.mode, call: o.call, ret: o.ret, right: o.callRight, evaluatedAt: o.evaluatedAt, brain: o.brain }))
  };
}

/**
 * Walk a ticket forward over the daily candles after the day it was opened: the first candle that touches the
 * stop or the target closes it (on a candle that touches both, the stop is assumed first, the cautious reading);
 * after the holding period it closes at that day's close; otherwise it is still open.
 */
export function replay(c, openedMs, { dir, stop, target, mode }) {
  let status = 'open', exit = null, exitAt = null;
  const i = entryIndex(c, openedMs);
  for (let k = i + 1; k < c.length && i >= 0; k++) {
    const hitStop = dir > 0 ? c[k].l <= stop : c[k].h >= stop, hitTgt = dir > 0 ? c[k].h >= target : c[k].l <= target;
    if (hitStop) { status = 'stopped'; exit = stop; exitAt = c[k].t; break; }
    if (hitTgt) { status = 'target'; exit = target; exitAt = c[k].t; break; }
    if (k - i >= HOLD_SESSIONS[mode]) { status = 'expired'; exit = c[k].c; exitAt = c[k].t; break; }
  }
  return { status, exit, exitAt, last: c.at(-1)?.c ?? null, sessions: i >= 0 ? c.length - 1 - i : 0 };
}

/**
 * History: every brief the room was given, and what would have happened if we had opened each position the room
 * offered (approved or not), replayed over the real prices since. Hold calls show what the price did while we
 * stayed flat. Demo rounds are listed without outcomes (their prices are fictional).
 */
export async function history({ store, market, limit = 100 }) {
  const hist = new Map(), items = [];
  const candles = async (tk, cls) => {
    const key = cls + ':' + tk;
    if (!hist.has(key)) hist.set(key, market.history ? await market.history(tk, cls).catch(() => null) : null);
    return hist.get(key);
  };
  for (const s of store.listRounds(limit)) {
    const r = store.getRound(s.id);
    if (!r) continue;
    const it = {
      id: r.id, createdAt: r.createdAt, brief: r.brief.trim(), ticker: r.tk || '', name: r.name || '', mode: r.mode,
      brain: r.brain?.label || 'Rules', call: r.call, callLabel: r.callLabel, conv: r.conv, price: r.p,
      approved: !!store.orderForRound(r.id), live: !!r.live, whatIf: null, since: null
    };
    const c = r.live && (r.assetClass === 'stock' || r.assetClass === 'crypto') && r.tk ? await candles(r.tk, r.assetClass) : null;
    if (c?.length) {
      const last = c.at(-1).c;
      it.since = { last, movePct: r2((last / r.p - 1) * 100) };
      if (r.ticket) {
        const dir = r.call === 'Buy' ? 1 : -1, rp = replay(c, Date.parse(r.createdAt), { dir, stop: r.stop, target: r.tgt, mode: r.mode });
        const mark = rp.exit ?? rp.last ?? r.p, pnlPct = r2(dir * (mark / r.p - 1) * 100 * (r.lev || 1));
        it.whatIf = { side: dir > 0 ? 'long' : 'short', entry: r.p, stop: r.stop, target: r.tgt, sizePct: r.size, leverage: r.lev,
          status: rp.status, exit: rp.exit, exitAt: rp.exitAt && new Date(rp.exitAt).toISOString(), mark, pnlPct,
          bookPnlPct: r2(pnlPct * r.size / 100), sessions: rp.sessions };
      }
    }
    items.push(it);
  }
  const trades = items.filter(i => i.whatIf), closed = trades.filter(i => i.whatIf.status !== 'open');
  const holds = items.filter(i => i.call === 'Hold' && i.since);
  const pick = f => trades.length ? trades.reduce((a, b) => (f(b.whatIf.pnlPct, a.whatIf.pnlPct) ? b : a)) : null;
  const best = pick((x, y) => x > y), worst = pick((x, y) => x < y);
  return {
    items,
    summary: {
      briefs: items.length, trades: trades.length, open: trades.length - closed.length, closed: closed.length,
      won: trades.filter(i => i.whatIf.pnlPct > 0).length, lost: trades.filter(i => i.whatIf.pnlPct < 0).length,
      bookPnlPct: r2(trades.reduce((t, i) => t + i.whatIf.bookPnlPct, 0)),
      avgTradePct: trades.length ? r2(trades.reduce((t, i) => t + i.whatIf.pnlPct, 0) / trades.length) : null,
      best: best && { ticker: best.ticker, pnlPct: best.whatIf.pnlPct }, worst: worst && { ticker: worst.ticker, pnlPct: worst.whatIf.pnlPct },
      holds: holds.length, holdsAvgMovePct: holds.length ? r2(holds.reduce((t, i) => t + Math.abs(i.since.movePct), 0) / holds.length) : null,
      demo: items.filter(i => !i.live).length
    }
  };
}

/** Replay every approved ticket over the candles since its fill. */
export async function portfolio({ store, market }) {
  const orders = store.listOrders(500), hist = new Map(), positions = [];
  for (const o of orders) {
    const r = store.getRound(o.roundId);
    const assetClass = r?.assetClass, mode = r?.mode || 'trader';
    const dir = o.side === 'buy' ? 1 : -1, entry = o.avgPrice;
    let status = 'open', exit = null, exitAt = null, last = null;
    if (market.history && (assetClass === 'stock' || assetClass === 'crypto')) {
      const key = assetClass + ':' + o.ticker;
      if (!hist.has(key)) hist.set(key, await market.history(o.ticker, assetClass).catch(() => null));
      ({ status, exit, exitAt, last } = replay(hist.get(key) || [], Date.parse(o.createdAt), { dir, stop: o.stop, target: o.target, mode }));
    }
    const mark = exit ?? last ?? entry, pnlPct = r2(dir * (mark / entry - 1) * 100 * o.leverage);
    positions.push({
      id: o.id, roundId: o.roundId, ticker: o.ticker, side: o.side, mode, sizePct: o.sizePct, leverage: o.leverage,
      entry, stop: o.stop, target: o.target, openedAt: o.createdAt, status, exit, exitAt: exitAt && new Date(exitAt).toISOString(),
      mark, pnlPct, bookPnlPct: r2(pnlPct * o.sizePct / 100)
    });
  }
  const closed = positions.filter(p => p.status !== 'open'), open = positions.filter(p => p.status === 'open');
  return {
    positions,
    totals: {
      open: open.length, closed: closed.length,
      winRate: closed.length ? Math.round(closed.filter(p => p.pnlPct > 0).length / closed.length * 100) : null,
      realizedBookPct: r2(closed.reduce((t, p) => t + p.bookPnlPct, 0)), openBookPct: r2(open.reduce((t, p) => t + p.bookPnlPct, 0)),
      exposurePct: r2(open.reduce((t, p) => t + p.sizePct * p.leverage, 0))
    }
  };
}
