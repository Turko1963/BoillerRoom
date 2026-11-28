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

const QUOTE_MAX_AGE_MIN = 2; // a broker quote older than this is stale for placing an order

export function evaluate(round, { profileId = 'nobroker', quote = null, now = Date.now(), predictionHash = null } = {}) {
  const profile = profileFor(profileId);
  if (!profile) throw Object.assign(new Error('Unknown execution profile'), { status: 400 });
  const inst = canonical(round), plan = round.tradePlan || null;
  const instrument = profile.instrumentKind === 'cfd' ? { ...inst, kind: 'cfd', underlying: inst.id } : inst;
  const refAt = round.instrument?.asOf ?? null;
  const reference = { price: round.p, unit: inst.priceUnit, asOf: refAt ? new Date(refAt).toISOString() : null, source: round.sources?.[0]?.name || null, note: 'the price the analysis used, not a quote' };
  const age = quote?.asOf ? (now - quote.asOf) / 60e3 : null;
  const q = !quote ? { status: 'none', note: profile.connected ? 'no quote received' : 'not connected: no broker quote' }
    : { status: age != null && age <= QUOTE_MAX_AGE_MIN ? 'fresh' : 'stale', bid: quote.bid ?? null, ask: quote.ask ?? null, asOf: quote.asOf ? new Date(quote.asOf).toISOString() : null, ageMinutes: age != null ? +age.toFixed(1) : null };
  const costs = Object.entries(profile.fields).map(([name, f]) => ({ name, ...f }));
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
  const costStatus = weakest(costs);
  const net = profile.id === 'nobroker' ? { status: 'hypothetical', text: 'Before costs: hypothetical, not a net result.' }
    : costStatus === 'unknown' ? { status: 'unknown', text: 'Costs not verified: no net figure, and no claim of an edge, gross or net.' }
    : { status: costStatus, text: costStatus === 'assumed' ? 'After assumed costs: a hypothesis.' : 'After the configured costs.' };
  const planStatus = !trade ? 'nothing to place' : profile.id === 'nobroker' ? 'research only' : admissible === 'no' ? 'not admissible' : q.status !== 'fresh' ? 'needs a fresh broker quote' : admissible === 'unknown' ? 'terms not verified' : 'ready to place by hand';
  return {
    profile: { id: profile.id, name: profile.name, version: profile.version, connected: profile.connected, label: profile.label },
    analysis: { roundId: round.id || null, predictionHash, call: round.call, direction: round.direction || null, note: 'The analysis and its prediction are unchanged by the profile.' },
    instrument, brokerSymbol: profile.symbolFor(instrument), reference, quote: q, costs, net, admissible: { status: admissible, reasons }, planStatus, evaluatedAt: new Date(now).toISOString()
  };
}
