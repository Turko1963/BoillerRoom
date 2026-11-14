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
  const hist = new Map();
  let graded = 0;
  for (const r of todo) {
    const key = r.assetClass + ':' + r.tk;
    if (!hist.has(key)) hist.set(key, await market.history(r.tk, r.assetClass).catch(() => null));
    const c = hist.get(key);
    if (!c?.length) continue;
    const i = entryIndex(c, Date.parse(r.createdAt)), j = i + EVAL_SESSIONS[r.mode];
    if (i < 0 || j >= c.length) continue; // not enough sessions yet
    const ret = (c[j].c / r.p - 1) * 100, flat = FLAT[r.mode];
    const call = r.call === 'Buy' ? ret > 0 : r.call === 'Short' ? ret < 0 : Math.abs(ret) < flat;
    const st = finalStances(r), desks = Object.fromEntries(RING.map(id => [id, { stance: st[id], right: right(st[id], ret, flat) }]));
    store.saveOutcome({ roundId: r.id, evaluatedAt: new Date(now).toISOString(), mode: r.mode, ret: r2(ret), call: r.call, callRight: call, desks });
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
    calls: {
      graded: outs.length, right: outs.filter(o => o.callRight).length,
      hitRate: outs.length ? Math.round(outs.filter(o => o.callRight).length / outs.length * 100) : null,
      // average move in the direction of the call (a short that fell 3% counts as +3)
      avgEdge: trades.length ? r2(trades.reduce((t, o) => t + (o.call === 'Short' ? -o.ret : o.ret), 0) / trades.length) : null
    },
    pending: store.roundsWithoutOutcome().filter(r => r.live).length,
    recent: outs.slice(0, 12).map(o => ({ roundId: o.roundId, ticker: o.ticker, mode: o.mode, call: o.call, ret: o.ret, right: o.callRight, evaluatedAt: o.evaluatedAt }))
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
      const c = hist.get(key) || [], i = entryIndex(c, Date.parse(o.createdAt));
      for (let k = i + 1; k < c.length && i >= 0; k++) {
        const hitStop = dir > 0 ? c[k].l <= o.stop : c[k].h >= o.stop, hitTgt = dir > 0 ? c[k].h >= o.target : c[k].l <= o.target;
        // on a candle that touches both, assume the stop came first (the cautious reading)
        if (hitStop) { status = 'stopped'; exit = o.stop; exitAt = c[k].t; break; }
        if (hitTgt) { status = 'target'; exit = o.target; exitAt = c[k].t; break; }
        if (k - i >= HOLD_SESSIONS[mode]) { status = 'expired'; exit = c[k].c; exitAt = c[k].t; break; }
      }
      last = c.at(-1)?.c ?? null;
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
