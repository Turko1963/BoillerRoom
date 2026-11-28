// A cost or condition field: a value only with where it came from.
//   status      observed (seen on a real fill or statement) | configured (published terms, or terms the owner gave, with a
//               source) | assumed (our research assumption, not anyone's terms) | unknown (no evidence: no value)
//   provenance  where the value comes from (a URL, a document, "owner, by message on 2026-11-28"...); null when unknown
//   asOf        when the value was read or given (YYYY-MM-DD); null when unknown
// There are no universal defaults: a field without evidence stays unknown, and anything computed from it is unknown too.

export const STATUSES = ['observed', 'configured', 'assumed', 'unknown'];

export function field(value, unit, status, provenance = null, asOf = null, note = null) {
  if (!STATUSES.includes(status)) throw new Error(`field status must be one of ${STATUSES.join(', ')}`);
  if (status === 'unknown') return { value: null, unit, status, provenance: null, asOf: null, note };
  if (status !== 'assumed' && !provenance) throw new Error(`a ${status} field needs its provenance`);
  return { value, unit, status, provenance, asOf, note };
}
export const unknown = (unit, note = null) => field(null, unit, 'unknown', null, null, note);
/** Worst status of a set: one unknown makes the result unknown; else assumed beats configured beats observed. */
export function weakest(fields) {
  const order = ['unknown', 'assumed', 'configured', 'observed'];
  return order.find(s => fields.some(f => f?.status === s)) || 'unknown';
}
