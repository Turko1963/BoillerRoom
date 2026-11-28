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
/**
 * The analysis every plan carries, whatever the direction: horizon and benchmark set in advance, the trigger, what would
 * prove it wrong, the bullish and bearish scenarios, and the expected excess return when it can be measured (until enough
 * calls at this horizon are graded it cannot, and the plan says so instead of guessing).
 */
function outlook(c, extra) {
  const crypto = c.assetClass === 'crypto';
  return {
    direction: c.direction || (c.call === 'Hold' ? 'No action' : c.call), horizon: c.ticket?.Horizon || c.hz || null,
    benchmark: c.benchName || (crypto ? 'Bitcoin' : c.exchange === 'TASE' ? 'TA-35' : 'S&P 500'),
    freshness: (c.sources || []).map(s => ({ name: s.name, what: s.what, asOf: s.asOf, freshness: s.freshness })),
    expectedExcess: null, expectedExcessNote: 'Not measurable yet: it needs graded calls at this horizon (see the Scoreboard calibration).',
    disclaimer: 'An analysis document, not a recommendation. Asking the room is not permission to trade.', ...extra
  };
}

// the currency of the plan's prices: the round's own (never assumed). The demo's fictional companies are priced in dollars.
const curOf = c => c.currency || (c.assetClass === 'demo' || c.assetClass == null ? 'USD' : null);

export function tradePlan(c) {
  const p = c?.p, call = c?.call;
  if (!(p > 0)) return null;
  const earn = (c.backdrop?.events || []).find(e => /^Earnings/.test(e));
  const days = earn ? +(earn.match(/in (\d+) days/)?.[1] ?? (/tomorrow/.test(earn) ? 1 : /today/.test(earn) ? 0 : NaN)) : NaN;
  const money = v => `${c.currency === 'ILS' ? '₪' : '$'}${r4(v)}`;
  if (call === 'Hold' || !c.ticket) {
    // no trade: where it would start to matter (the levels the desks found); no entry or target without data behind it
    const watch = Object.values(c.ANN || {}).filter(a => a && a.price > 0).map(a => ({ label: a.label, price: r4(a.price), above: a.price > p }))
      .sort((a, b) => Math.abs(a.price - p) - Math.abs(b.price - p)).slice(0, 3);
    const ov = c.vote?.overrides || [], rrVeto = ov.find(o => o.rule === 'reward-to-risk'), dataVeto = ov.find(o => o.rule === 'data' || o.rule === 'liquidity');
    const up = watch.find(w => w.above), down = watch.find(w => !w.above), mr = 1.5; // the minimum reward to risk in decide()
    // a trade the chart vetoed: the price at which the same stop and target would pay 1.5 times the risk
    const better = rrVeto && c.stop > 0 && c.tgt > 0 ? r4((c.tgt + mr * c.stop) / (1 + mr)) : null;
    const trigger = dataVeto ? `Fresh, complete data: ${dataVeto.why}` : better ? `A better entry: around ${money(better)} the same stop (${money(c.stop)}) and target (${money(c.tgt)}) pay 1.5 times the risk.`
      : up || down ? `A move past ${[up && `${up.label} ${money(up.price)} (above)`, down && `${down.label} ${money(down.price)} (below)`].filter(Boolean).join(' or ')}, then a new round.` : 'Something new in the data; a new round.';
    return { side: 'none', price: r4(p), currency: curOf(c), mode: c.mode, watch, conviction: c.conv, better,
      ...outlook(c, { trigger, invalidation: 'Not a position: nothing to invalidate.',
        scenarios: { bull: up ? `Breaks above ${up.label} at ${money(up.price)}.` : 'No level above to watch.', bear: down ? `Falls below ${down.label} at ${money(down.price)}.` : 'No level below to watch.' } }) };
  }
  if (c.direction === 'Sell') {
    // Investor mode, bearish: sell or avoid a holding. Not a short position, so no entry, stop or target for one.
    return { side: 'exit', price: r4(p), currency: curOf(c), mode: c.mode, conviction: c.conv, assetClass: c.assetClass, warnings: [],
      ...outlook(c, { trigger: 'If you hold it: sell or reduce now. If you do not: do not buy it.', invalidation: `A new round whose score is back above the sell line (${c.vote ? c.vote.shortAt.toFixed(2) : '-0.12'}).`,
        scenarios: { bull: `The bearish case is wrong if it holds above ${money(c.stop)}.`, bear: `The desks see room down to about ${money(c.tgt)} over ${c.ticket?.Horizon || 'the horizon'}.` } }) };
  }
  const d = call === 'Buy' ? 1 : -1, stop = c.stop, R = Math.abs(p - stop), at = k => r4(p + d * k * R);
  if (!(R > 0)) return null;
  const target = c.tgt != null ? r4(c.tgt) : at(RULES.target), rr = +(Math.abs((c.tgt ?? at(RULES.target)) - p) / R).toFixed(1);
  const warnings = [];
  if (Number.isFinite(days) && days <= RULES.earningsBlock) warnings.push({ id: 'earnings', days, text: `${earn}: the tested plan takes no new trade this close to a report. If you take it, close it the session before.` });
  if (c.assetClass === 'crypto') warnings.push({ id: 'crypto', text: 'Coins: the 10 year test found no edge for this plan in crypto. Size smaller, or treat it as a view, not a trade.' });
  if (c.mode === 'investor') warnings.push({ id: 'investor', text: 'Investor mode: the management rules were tested on the trader horizon. Use the stop and target, and look again every month instead of the 10 session time stop.' });
  if (rr < 1.5) warnings.push({ id: 'rr', text: `The target is only ${rr} times the risk.` });
  // where the stop and target come from: chart levels the desks found, or only the volatility rule (then say so)
  const basis = c.levelsUsed ? 'chart levels the desks found' : 'the volatility rule (no chart level found)';
  return {
    ...outlook(c, { trigger: `The weighted score crossed the ${d > 0 ? 'buy' : 'short'} line; entry now or inside the zone.`, invalidation: `A daily close beyond the stop at ${money(stop)}.`,
      // bullish and bearish mean the price going up or down; for a short, the bullish scenario is the one that hurts
      scenarios: d > 0 ? { bull: `The price reaches the target ${money(target)}: +${rr}R.`, bear: `The price falls to the stop ${money(stop)}: -1R, more on a gap.` }
        : { bull: `The price rises to the stop ${money(stop)}: -1R, more on a gap.`, bear: `The price falls to the target ${money(target)}: +${rr}R.` }, levelsBasis: basis }),
    side: d > 0 ? 'buy' : 'sell', price: r4(p), currency: curOf(c), mode: c.mode, conviction: c.conv, assetClass: c.assetClass,
    entry: r4(p), entryZone: [r4(p - 0.25 * R), r4(p + 0.25 * R)].sort((a, b) => a - b),
    stop: r4(stop), R: r4(R), riskPct: +(R / p * 100).toFixed(2), target, rr, atr: r4(R / 2),
    // the unit the source quoted in (agorot for Tel Aviv: already divided to shekels), and the memo's ceiling on notional
    sourceUnit: c.instrument?.sourceUnit || null, ceilingPct: c.size > 0 ? +(c.size * (c.lev || 1)).toFixed(1) : null,
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

