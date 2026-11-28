// The prediction log: every decision, written once and never edited. Each entry holds the time, the system version, the
// full input (brief, mode, brain, what every desk reported before the debate, the data sources and their freshness) and
// the full output (the vote, the call, the direction, the ticket, the plan), plus the horizon and the benchmark it will be
// graded against, fixed at decision time. Entries are chained: each one stores the hash of the one before, so any change
// to an old entry breaks the chain, and the database itself refuses UPDATE and DELETE on the table (server/store/db.js).
import { createHash } from 'node:crypto';

/** Sessions to the decision's own horizon: "4 days to 2 weeks" -> 10, "1 to 3 years" -> 252. Mode defaults otherwise. */
export function horizonSessions(round) {
  const h = round?.ticket?.Horizon || '', unit = { day: 1, days: 1, week: 5, weeks: 5, month: 21, months: 21, year: 252, years: 252 };
  const m = h.match(/(\d+)\s*(days?|weeks?|months?|years?)?\s*to\s*(\d+)\s*(days?|weeks?|months?|years?)/i);
  if (m) {
    const lo = +m[1] * unit[(m[2] || m[4]).toLowerCase()], hi = +m[3] * unit[m[4].toLowerCase()];
    // a trade is judged at the far end of its window; an investment at the near end (a year is already a long wait)
    return round.mode === 'investor' ? lo : hi;
  }
  return round?.mode === 'investor' ? 60 : 10; // no ticket (Watch, No action): judged over the mode's usual horizon
}
/** The benchmark a decision is measured against: [Yahoo or Binance symbol, its name, its asset class]. */
export function benchmarkOf(round) {
  if (round?.assetClass === 'crypto') return round.tk === 'BTC' ? ['ETH', 'Ethereum', 'crypto'] : ['BTC', 'Bitcoin', 'crypto'];
  if (round?.exchange === 'TASE' || /\.TA$/.test(round?.tk || '')) return ['TA35.TA', 'TA-35', 'stock'];
  return ['^GSPC', 'S&P 500', 'stock'];
}

export const hashOf = (prev, row) => createHash('sha256').update(prev + '|' + JSON.stringify(row)).digest('hex');

/** The entry for one decision (pure): { input, output, horizon, benchmark }. */
export function entryFor(round, { brain, lang, version, member = null } = {}) {
  const [bench, benchName] = benchmarkOf(round);
  return {
    input: { brief: round.brief, mode: round.mode, brain: brain || round.brain?.id || 'rules', lang: lang || 'en', member, ticker: round.tk, assetClass: round.assetClass,
      price: round.p, asOf: round.asOf || null, instrument: round.instrument || null, sources: round.sources || null, weights: round.weights || null,
      desks: Object.fromEntries(Object.entries(round.R || {}).map(([id, r]) => [id, { stance: r.stance, conf: r.conf, headline: r.headline, findings: r.findings }])),
      backdrop: round.backdrop || null, baseRate: round.baseRate || null, alerts: round.alerts || [] },
    output: { call: round.call, direction: round.direction || null, conviction: round.conv, vote: round.vote || null, ticket: round.ticket || null,
      stop: round.stop ?? null, target: round.tgt ?? null, tradePlan: round.tradePlan || null, why: round.why },
    horizon: horizonSessions(round), benchmark: bench, benchmarkName: benchName, version: version || null
  };
}

/** Recompute the chain over every entry: { ok, n, brokenAt } (brokenAt: the first id whose hash does not match). */
export function verifyChain(rows) {
  let prev = 'genesis';
  for (const r of rows) {
    const h = hashOf(prev, { roundId: r.round_id, createdAt: r.created_at, version: r.version, input: r.input, output: r.output, horizon: r.horizon, benchmark: r.benchmark });
    if (r.prev_hash !== prev || r.hash !== h) return { ok: false, n: rows.length, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true, n: rows.length, brokenAt: null };
}
