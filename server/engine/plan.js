// The trade plan: from the room's call to the numbers a person (or another agent, at the broker) needs to place and manage
// the trade by hand. Nothing is sent anywhere. Pure: built from the round and the rules backtested in manage.js.
//
// 1R is the distance from the entry to the stop loss. ATR is taken as R / 2 (the backtest's stop was 2 ATR).
// Two ways to run the same trade, both tested on 10 years of US stocks (earnings guard, at most 5 trades open):
//   managed   all in at the entry; stop to break-even after +1R; half off at +1.5R; trail the rest 2 ATR behind the best
//             close; time stop after 10 sessions under +0.5R; out after 30 sessions
//   scaleIn   half at the entry, the second half if the price moves 0.5R against us, same stop (the whole trade then risks
//             0.75R); everything off at the target; time stop after 10 sessions
import { RULES } from './manage.js';

export const TESTED = {
  managed: { trades: 458, winRate: 53, avgR: 0.13, totalR: 58.97, profitFactor: 1.33, maxDrawdownR: -11.78, worstR: -1.51 },
  scaleIn: { trades: 465, winRate: 57, avgR: 0.10, totalR: 45.36, profitFactor: 1.36, maxDrawdownR: -7.37, worstR: -1.26 }
};

const r4 = v => (v == null ? null : +(+v).toFixed(Math.abs(v) >= 1 ? 2 : 6));

/** The plan for a round: { side, entry, stop, R, levels..., managed: {...}, scaleIn: {...}, warnings } or { side: 'none', ... }. */
export function tradePlan(c) {
  const p = c?.p, call = c?.call;
  if (!(p > 0)) return null;
  const earn = (c.backdrop?.events || []).find(e => /^Earnings/.test(e));
  const days = earn ? +(earn.match(/in (\d+) days/)?.[1] ?? (/tomorrow/.test(earn) ? 1 : /today/.test(earn) ? 0 : NaN)) : NaN;
  if (call === 'Hold' || !c.ticket) {
    // no trade: where it would start to matter (the levels the desks found)
    const watch = Object.values(c.ANN || {}).filter(a => a && a.price > 0).map(a => ({ label: a.label, price: r4(a.price), above: a.price > p }))
      .sort((a, b) => Math.abs(a.price - p) - Math.abs(b.price - p)).slice(0, 3);
    return { side: 'none', price: r4(p), currency: c.currency || 'USD', mode: c.mode, watch, conviction: c.conv };
  }
  const d = call === 'Buy' ? 1 : -1, stop = c.stop, R = Math.abs(p - stop), at = k => r4(p + d * k * R);
  if (!(R > 0)) return null;
  const target = c.tgt != null ? r4(c.tgt) : at(RULES.target), rr = +(Math.abs((c.tgt ?? at(RULES.target)) - p) / R).toFixed(1);
  const warnings = [];
  if (Number.isFinite(days) && days <= RULES.earningsBlock) warnings.push({ id: 'earnings', days, text: `${earn}: the tested plan takes no new trade this close to a report. If you take it, close it the session before.` });
  if (c.assetClass === 'crypto') warnings.push({ id: 'crypto', text: 'Coins: the 10 year test found no edge for this plan in crypto. Size smaller, or treat it as a view, not a trade.' });
  if (c.mode === 'investor') warnings.push({ id: 'investor', text: 'Investor mode: the management rules were tested on the trader horizon. Use the stop and target, and look again every month instead of the 10 session time stop.' });
  if (rr < 1.5) warnings.push({ id: 'rr', text: `The target is only ${rr} times the risk.` });
  return {
    side: d > 0 ? 'buy' : 'sell', price: r4(p), currency: c.currency || 'USD', mode: c.mode, conviction: c.conv, assetClass: c.assetClass,
    entry: r4(p), entryZone: [r4(p - 0.25 * R), r4(p + 0.25 * R)].sort((a, b) => a - b),
    stop: r4(stop), R: r4(R), riskPct: +(R / p * 100).toFixed(2), target, rr, atr: r4(R / 2),
    managed: {
      breakEven: at(RULES.breakEvenAt), partial: at(RULES.partialAt), partialFrac: RULES.partialFrac,
      trailAtr: RULES.trailAtr, trailDistance: r4(RULES.trailAtr * R / 2), timeStop: RULES.timeStop, minProgress: at(RULES.minProgress), maxHold: RULES.maxHold,
      tested: TESTED.managed
    },
    scaleIn: { first: 0.5, add: at(-0.5), addFrac: 0.5, avgIfAdded: at(-0.25), riskIfAddedR: 0.75, target, timeStop: RULES.timeStop, tested: TESTED.scaleIn },
    sessionsHorizon: c.ticket?.Horizon || null,
    warnings
  };
}

/** Units for an account: risk riskPct of it on the full plan. step: smallest unit (1 share; coins to 6 decimals). */
export function sizeFor(plan, account, riskPct = 1, step = plan?.assetClass === 'crypto' ? 1e-6 : 1) {
  if (!plan || plan.side === 'none' || !(account > 0) || !(plan.R > 0)) return null;
  const risk = account * riskPct / 100, units = Math.floor(risk / plan.R / step) * step;
  return { risk: +risk.toFixed(2), units: +units.toFixed(6), value: +(units * plan.entry).toFixed(2) };
}
