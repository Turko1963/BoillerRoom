// The one position-size calculation. The memo, the Trade plan, the copied text and the image all read its result; nothing
// else sizes a position. Pure: the exchange rate comes in as data with its source and time (never a constant here).
//
// Units, in order:
//   1. the quote: a price the source sent in a sub-unit (agorot, pence, cents) is normalized to the main unit, with its
//      provenance (the plan's prices are already normalized in server/data/yahoo.js; normalizeQuote() is the same rule)
//   2. native currency (the instrument's) -> account currency, with the rate's direction, time, age and an inverse check;
//      when the two currencies are the same no rate is needed; when they differ and the rate is missing, stale or
//      inconsistent, the size is blocked (only the size: the analysis stands)
//   3. units = (risk budget in account currency) / (stop distance per unit in account currency, plus verified costs),
//      rounded DOWN to the lot, then capped; the risk actually taken is reported (not exactly the budget once rounded)
//   4. notional, margin and risk are three separate numbers; a stop does not cap the loss (gaps, slippage)
import { SUBUNITS } from './instrument.js';

export const FX_MAX_AGE_H = { value: 72, why: 'Currencies trade five days a week: a rate up to three days old covers a weekend; older is stale.' };
const INVERSE_TOLERANCE = 0.01; // a rate and the inverse pair's rate must agree to 1%
const r = (v, n = 2) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(n));

/** A price in the unit the source sent it, as a price in the main unit: { value, unit, sourceUnit, factor, provenance }. */
export function normalizeQuote(value, unit) {
  const main = SUBUNITS[unit];
  if (!main) return { value, unit, sourceUnit: unit, factor: 1, provenance: 'already in the main unit' };
  return { value: value / 100, unit: main, sourceUnit: unit, factor: 0.01, provenance: `${unit} is a hundredth of ${main}: divided by 100` };
}

/**
 * The exchange rate from the instrument's currency to the account's.
 * fx: { rate (account currency per 1 unit of native), asOf (ms), source, inverse?: rate of the opposite pair } or null.
 * Returns { status: 'not needed' | 'ok' | 'missing' | 'stale' | 'inconsistent', rate, pair, direction, asOf, ageHours, source, why }.
 */
export function fxFor(native, account, fx, now = Date.now()) {
  if (native === account) return { status: 'not needed', rate: 1, pair: null, direction: `${native} = ${account}`, why: 'Same currency: no rate needed.' };
  const pair = `${native}${account}`, direction = `${account} per 1 ${native}`;
  if (!fx || !(fx.rate > 0)) return { status: 'missing', rate: null, pair, direction, why: `No ${pair} rate: the size cannot be put in ${account}.` };
  const ageHours = fx.asOf ? (now - fx.asOf) / 36e5 : null, base = { rate: fx.rate, pair, direction, asOf: fx.asOf ? new Date(fx.asOf).toISOString() : null, ageHours: r(ageHours, 1), source: fx.source || null };
  if (ageHours == null || ageHours > FX_MAX_AGE_H.value) return { ...base, status: 'stale', why: `The ${pair} rate is ${ageHours == null ? 'of unknown time' : `${Math.round(ageHours)} hours old`}: older than ${FX_MAX_AGE_H.value} hours.` };
  if (fx.inverse > 0 && Math.abs(fx.rate * fx.inverse - 1) > INVERSE_TOLERANCE)
    return { ...base, status: 'inconsistent', inverse: fx.inverse, why: `${pair} ${fx.rate} and its inverse ${fx.inverse} do not agree (product ${r(fx.rate * fx.inverse, 4)}): the direction may be wrong.` };
  return { ...base, status: 'ok', inverse: fx.inverse ?? null, inverseChecked: fx.inverse > 0, why: fx.inverse > 0 ? 'Checked against the inverse pair.' : 'The inverse pair was not available to cross-check.' };
}

/** Round-trip costs per unit, in % of value, only when every cost is verified (configured or observed). */
function verifiedCosts(profile) {
  const F = profile?.fields;
  if (!profile || profile.id === 'nobroker' || !F) return { status: 'n/a', pct: 0, why: 'No broker: no costs applied; the real loss at the stop is higher by the costs.' };
  const need = ['commission', 'spread'], bad = need.filter(k => !['configured', 'observed'].includes(F[k]?.status));
  if (bad.length) return { status: 'not verified', pct: 0, missing: bad, why: `Costs not verified for ${profile.name} (${bad.join(', ')}): not counted, and the real loss at the stop is higher by them.` };
  return { status: 'verified', pct: 2 * F.commission.value + F.spread.value, why: `Commission both ways plus the spread under ${profile.name}, counted in the risk per unit.` };
}

/**
 * plan: the round's trade plan (prices in plan.currency, the main unit). account: { equity, currency }. riskPct: risk budget.
 * fx: as in fxFor. profile: an execution profile (lot size, minimum, margin, costs, when verified).
 * ceilingPct: the memo's position ceiling in % of the book (ticket size x leverage), a cap on notional; null for none.
 * units: evaluate this unit count instead of sizing (the same conversions and checks).
 */
export function positionSize({ plan, account, riskPct = 1, fx = null, profile = null, ceilingPct = null, units: given = null, now = Date.now() }) {
  const trade = plan && (plan.side === 'buy' || plan.side === 'sell') && plan.R > 0;
  if (!trade) return { status: 'n/a', why: 'No position in this plan.' };
  const native = plan.currency, acct = account?.currency, blocked = [];
  if (!native) blocked.push('The instrument\'s currency is unknown.');
  if (!acct) blocked.push('Choose the account\'s currency: it is never assumed.');
  if (!(account?.equity > 0)) blocked.push('Enter the account size.');
  if (!(riskPct > 0 && riskPct <= 10)) blocked.push('Risk per trade must be above 0% and at most 10%.');
  const X = native && acct ? fxFor(native, acct, fx, now) : null;
  if (X && !['ok', 'not needed'].includes(X.status)) blocked.push(X.why + ' Only the size is blocked: the analysis stands.');
  const quote = { unit: native || null, sourceUnit: plan.sourceUnit || native || null, normalized: plan.sourceUnit && SUBUNITS[plan.sourceUnit] ? `${plan.sourceUnit} to ${native} at the source (server/data/yahoo.js)` : 'already in the main unit' };
  const base = { quote, nativeCurrency: native || null, accountCurrency: acct || null, fx: X, stopNote: 'A stop is not a cap on the loss: a price can gap past it, and slippage adds to it.' };
  if (blocked.length) return { ...base, status: 'blocked', blockedBy: blocked };

  const rate = X.rate, F = profile?.fields || {}, cost = verifiedCosts(profile);
  const lotOk = ['configured', 'observed'].includes(F.lotSize?.status) && F.lotSize.value > 0;
  const lot = lotOk ? F.lotSize.value : plan.assetClass === 'crypto' ? 1e-6 : 1;
  const perUnit = { entry: { native: plan.entry, account: plan.entry * rate }, stopDistance: { native: plan.R, account: plan.R * rate } };
  perUnit.cost = { account: plan.entry * rate * cost.pct / 100, status: cost.status };
  perUnit.risk = { account: perUnit.stopDistance.account + perUnit.cost.account };
  const budget = account.equity * riskPct / 100, down = v => Math.floor(v / lot + 1e-9) * lot;
  const caps = [];
  let units = given != null ? given : down(budget / perUnit.risk.account), basis = given != null ? 'given' : 'risk budget';
  if (given == null) {
    // caps: no leverage unless the broker's margin is known; the memo's ceiling; the broker's minimum
    const marginKnown = ['configured', 'observed'].includes(F.margin?.status) && F.margin.value > 0;
    const noLev = down(account.equity / perUnit.entry.account);
    caps.push({ name: 'no leverage', units: noLev, why: marginKnown ? 'Notional up to the account; the broker\'s margin would allow more, not used here.' : 'Margin unknown: notional is kept within the account.' });
    if (ceilingPct > 0) caps.push({ name: 'memo ceiling', units: down(account.equity * ceilingPct / 100 / perUnit.entry.account), why: `The memo's size: ${ceilingPct}% of the book in notional.` });
    for (const c of caps) if (c.units < units) { units = c.units; basis = c.name; }
    const minOk = ['configured', 'observed'].includes(F.minNotional?.status) && F.minNotional.value > 0;
    if (minOk && units * perUnit.entry.account < F.minNotional.value) { caps.push({ name: 'broker minimum', units: 0, why: `Below the broker's minimum of ${F.minNotional.value} ${acct}.` }); units = 0; basis = 'broker minimum'; }
  }
  units = +units.toFixed(6);
  const notional = { native: units * plan.entry, account: units * perUnit.entry.account };
  const marginKnown = ['configured', 'observed'].includes(F.margin?.status) && F.margin.value > 0;
  const margin = marginKnown ? { status: F.margin.status, account: r(notional.account * F.margin.value / 100, 4), pct: F.margin.value } : { status: 'unknown', account: null, why: profile && profile.id !== 'nobroker' ? `${profile.name}'s margin is not verified.` : 'No broker: margin is what a broker holds, unknown here.' };
  const riskNative = units * plan.R, riskAcct = units * perUnit.risk.account;
  // the scale-in method: half now, half on the add (the average entry is then 0.25R worse: 0.75R of the full size at the stop)
  const half = +(Math.floor(units * (plan.scaleIn?.first ?? 0.5) / lot + 1e-9) * lot).toFixed(6);
  const scaleIn = { first: half, add: half, riskIfBoth: { account: r(half * 2 * perUnit.risk.account * (plan.scaleIn?.riskIfAddedR ?? 0.75), 4) } };
  return {
    ...base, status: units > 0 ? 'ok' : 'too small', basis, lot, lotSource: lotOk ? `${profile.name} (${F.lotSize.status})` : plan.assetClass === 'crypto' ? 'coins to 6 decimals' : 'one share',
    units, riskPct, budget: { account: r(budget) }, costs: cost, caps,
    perUnit: { entry: { native: r(perUnit.entry.native, 4), account: r(perUnit.entry.account, 4) }, stopDistance: { native: r(perUnit.stopDistance.native, 4), account: r(perUnit.stopDistance.account, 4) }, cost: { account: r(perUnit.cost.account, 4), status: cost.status } },
    notional: { native: r(notional.native, 4), account: r(notional.account, 4), pctOfEquity: r(notional.account / account.equity * 100, 1) },
    margin, scaleIn,
    risk: { native: r(riskNative, 4), account: r(riskAcct, 4), pctOfEquity: r(riskAcct / account.equity * 100, 2), atStopOnly: true },
    why: units > 0 ? (basis === 'risk budget' ? `Sized by the risk budget: ${riskPct}% of ${account.equity} ${acct}; rounded down to the lot, so the risk taken is ${r(riskAcct / account.equity * 100, 2)}%.` : basis === 'given' ? 'The unit count given, converted.' : `Capped by the ${basis}: ${caps.find(c => c.name === basis).why}`)
      : `One unit risks ${r(perUnit.risk.account)} ${acct} to the stop, more than the ${r(budget)} ${acct} budget${basis !== 'risk budget' ? ` or the ${basis}` : ''}: no size.`
  };
}
