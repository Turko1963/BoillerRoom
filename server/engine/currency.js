// The currency symbol for prices written into a round ("$" by default, "₪" for Tel Aviv stocks).
// The desks and decide() are synchronous, so the round sets the symbol around those calls with withCurrency():
// nothing else can run in between. Everything else keeps "$".
let SYM = '$';
export const cur = () => SYM;
/** The symbol for a currency code (the code itself when we have no symbol for it). */
export const symbolFor = code => ({ USD: '$', ILS: '₪', EUR: '€', GBP: '£', JPY: '¥', CAD: 'C$', AUD: 'A$', HKD: 'HK$', CHF: 'CHF ', INR: '₹', ZAR: 'R ', CNY: '¥' }[code] ?? (code ? code + ' ' : '$'));
/** Run fn (synchronous) with prices written in `sym`. */
export function withCurrency(sym, fn) {
  const prev = SYM;
  SYM = sym || '$';
  try { return fn(); } finally { SYM = prev; }
}
