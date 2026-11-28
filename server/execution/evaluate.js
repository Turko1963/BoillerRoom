// Applying an execution profile to a decision. The decision (and its prediction log entry) is never changed: this returns a
// new, separate evaluation, tagged with the profile and its version. Switching broker gives a new evaluation; the saved
// prediction, the history and any real account stay as they are.
//
// The reference price is the price the analysis used (its source and time). A quote is a broker's live bid/ask for the
// instrument; nothing here is connected, so there is never a fresh quote, and a plan that needs one says so (that blocks this
// plan only, not the app).
import { canonical } from './instrument.js';
import { profileFor } from './profiles.js';
import { weakest } from './fields.js';
import { horizonSessions } from '../engine/predictions.js';

const QUOTE_MAX_AGE_MIN = 2; // a broker quote older than this is stale for placing an order

/**
 * The cost of the plan under a profile, in % of the position value: commission both ways, the spread, overnight financing
 * over the horizon (calendar days from trading sessions), and currency conversion both ways when the profile names an
 * account currency other than the instrument's. Any field it needs that is unknown makes the whole cost unknown.
 */
export function planCost(profile, plan, round) {
  const F = profile.fields, side = plan?.side, need = ['commission', 'spread', side === 'sell' ? 'financingShort' : 'financingLong'];
  const fx = profile.accountCurrency && round.currency && profile.accountCurrency !== round.currency;
  if (fx) need.push('fxConversion');
  const used = need.map(k => F[k]), missing = need.filter(k => F[k]?.status === 'unknown');
  const days = Math.round(horizonSessions(round) * 365 / 252);
  if (missing.length) return { status: 'unknown', missing, days };
  const pct = 2 * F.commission.value + F.spread.value + F[need[2]].value * days / 365 + (fx ? 2 * F.fxConversion.value : 0);
  return { status: weakest(used), pct: +pct.toFixed(3), days, parts: Object.fromEntries(need.map(k => [k, F[k].value])) };
}

export function evaluate(round, { profileId = 'nobroker', profile: given = null, quote = null, now = Date.now(), predictionHash = null } = {}) {
  const profile = given || profileFor(profileId);
  if (!profile) throw Object.assign(new Error('Unknown execution profile'), { status: 400 });
  const inst = canonical(round), plan = round.tradePlan || null;
  const instrument = profile.instrumentKind === 'cfd' ? { ...inst, kind: 'cfd', underlying: inst.id } : inst;
  const refAt = round.instrument?.asOf ?? null;
  const reference = { price: round.p, unit: inst.priceUnit, asOf: refAt ? new Date(refAt).toISOString() : null, source: round.sources?.[0]?.name || null, note: 'the price the analysis used, not a quote' };
  const age = quote?.asOf ? (now - quote.asOf) / 60e3 : null;
  const q = !quote ? { status: 'none', note: profile.connected ? 'no quote received' : 'not connected: no broker quote' }
    : { status: age != null && age <= QUOTE_MAX_AGE_MIN ? 'fresh' : 'stale', bid: quote.bid ?? null, ask: quote.ask ?? null, asOf: quote.asOf ? new Date(quote.asOf).toISOString() : null, ageMinutes: age != null ? +age.toFixed(1) : null };
  const side = plan?.side, trade = side === 'buy' || side === 'sell';
  const reasons = [];
  let admissible = 'yes';
  if (!trade) { admissible = 'n/a'; reasons.push(side === 'exit' ? 'A sale of a holding: nothing new to place.' : 'No position in this plan.'); }
  else if (profile.id === 'nobroker') { admissible = 'n/a'; reasons.push('No broker: research only.'); }
  else {
    const need = ['availability', 'commission', 'spread', 'margin', 'schedule', ...(side === 'sell' ? ['shortable', 'financingShort'] : ['financingLong'])];
    const missing = need.filter(k => profile.fields[k]?.status === 'unknown');
    if (missing.length) { admissible = 'unknown'; reasons.push(`Not verified for this profile: ${missing.join(', ')}.`); }
    if (profile.fields.availability?.value === false) { admissible = 'no'; reasons.push('The broker does not offer this instrument.'); }
    if (side === 'sell' && profile.fields.shortable?.value === false) { admissible = 'no'; reasons.push('The broker does not allow a short on it.'); }
    if (q.status !== 'fresh') reasons.push('No fresh broker quote: this plan cannot be placed as it is (the analysis stands).');
  }
  // the plan's own scenarios, before and after this profile's costs (only when every cost it needs is known)
  const cost = trade ? planCost(profile, plan, round) : null, gross = trade ? { targetPct: +(Math.abs(plan.target / plan.entry - 1) * 100).toFixed(2), stopPct: plan.riskPct } : null;
  const net = profile.id === 'nobroker' ? { status: 'hypothetical', text: 'Before costs: hypothetical, not a net result.', gross }
    : !trade ? { status: 'n/a', text: 'No position: no cost.' }
    : cost.status === 'unknown' ? { status: 'unknown', text: 'Costs not verified: no net figure, and no claim of an edge, gross or net.', missing: cost.missing }
    : { status: cost.status, text: cost.status === 'assumed' ? 'After assumed costs: a hypothesis, not verified.' : `After ${profile.name}'s costs (${cost.status}).`, costPct: cost.pct, days: cost.days,
      gross, targetPct: +(gross.targetPct - cost.pct).toFixed(2), stopPct: +(gross.stopPct + cost.pct).toFixed(2), rewardToRisk: +((gross.targetPct - cost.pct) / (gross.stopPct + cost.pct)).toFixed(2) };
  const planStatus = !trade ? 'nothing to place' : profile.id === 'nobroker' ? 'research only' : admissible === 'no' ? 'not admissible' : q.status !== 'fresh' ? 'needs a fresh broker quote' : admissible === 'unknown' ? 'terms not verified' : 'ready to place by hand';
  const costs = Object.entries(profile.fields).map(([name, f]) => ({ name, ...f }));
  return {
    profile: { id: profile.id, name: profile.name, version: profile.version, connected: profile.connected, label: profile.label },
    analysis: { roundId: round.id || null, predictionHash, call: round.call, direction: round.direction || null, note: 'The analysis and its prediction are unchanged by the profile.' },
    instrument, brokerSymbol: profile.symbolFor(instrument), reference, quote: q, costs, net, admissible: { status: admissible, reasons }, planStatus, evaluatedAt: new Date(now).toISOString()
  };
}
