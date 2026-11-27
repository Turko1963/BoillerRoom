// The currency symbol for prices written into a round ("$" by default, "₪" for Tel Aviv stocks).
// The desks and decide() are synchronous, so the round sets the symbol around those calls with withCurrency():
// nothing else can run in between. Everything else keeps "$".
let SYM = '$';
export const cur = () => SYM;
/** Run fn (synchronous) with prices written in `sym`. */
export function withCurrency(sym, fn) {
  const prev = SYM;
  SYM = sym || '$';
  try { return fn(); } finally { SYM = prev; }
}
