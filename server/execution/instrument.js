// The canonical instrument: what is being analysed, independent of any broker's symbol for it.
//   id          "<exchange>:<symbol>", e.g. "XNAS:NVDA", "XTAE:LUMI", "CRYPTO:BTC"
//   exchange    the venue (an ISO 10383 MIC where we know it, else the name the data source gives)
//   currency    the currency prices are quoted in after conversion (USD, ILS, EUR...)
//   priceUnit   the unit of every price we store and show: the main currency unit (ILS, not agorot)
//   sourceUnit  the unit the data source sends (Yahoo sends Tel Aviv shares in agorot, "ILA"; London in pence, "GBp")
//   kind        equity | etf | crypto | index | other
//   underlying  for a CFD or other derivative a broker offers: the canonical id it tracks (set by an execution profile)

const MIC = {
  NasdaqGS: 'XNAS', NasdaqGM: 'XNAS', NasdaqCM: 'XNAS', Nasdaq: 'XNAS', NMS: 'XNAS', NYSE: 'XNYS', NYQ: 'XNYS', NYSEArca: 'ARCX', 'NYSE American': 'XASE', Cboe: 'BATS', BATS: 'BATS',
  'Tel Aviv': 'XTAE', TLV: 'XTAE', XETRA: 'XETR', LSE: 'XLON', London: 'XLON', Paris: 'XPAR', Amsterdam: 'XAMS', Toronto: 'XTSE', Tokyo: 'XTKS', 'Hong Kong': 'XHKG', NSE: 'XNSE', Binance: 'BINANCE'
};
// sub-units some sources quote in: divide by 100 to get the main unit
export const SUBUNITS = { ILA: 'ILS', GBp: 'GBP', GBX: 'GBP', ZAc: 'ZAR' };

const kindOf = t => ({ EQUITY: 'equity', ETF: 'etf', CRYPTO: 'crypto', CRYPTOCURRENCY: 'crypto', INDEX: 'index' }[t] || (t ? 'other' : null));

/** From a round (or the data behind it). */
export function canonical(r) {
  if (!r) return null;
  const crypto = r.assetClass === 'crypto' || r.kind === 'crypto', sym = String(r.tk || r.symbol || '').toUpperCase();
  const inst = r.instrument || {};
  const exchange = crypto ? 'CRYPTO' : MIC[inst.exchange] || (/\.TA$/.test(sym) ? 'XTAE' : inst.exchange || null);
  const base = crypto ? sym : sym.replace(/\.[A-Z]{1,3}$/, '');
  return {
    id: exchange ? `${exchange}:${base}` : base, symbol: sym, exchange, currency: r.currency || inst.currency || (crypto ? 'USD' : null),
    priceUnit: r.currency || inst.currency || null, sourceUnit: inst.sourceUnit || (/\.TA$/.test(sym) ? 'ILA' : r.currency || null),
    kind: crypto ? 'crypto' : kindOf(inst.type), underlying: null
  };
}
