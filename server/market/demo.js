// Demo market data provider: fictional companies, deterministic prices,
// today's movers and 56 daily candles per ticker.
// Replace with a real provider by implementing the same four functions.
import { hash, rng } from '../engine/random.js';

export const NAMES = {
  HLXN: 'Helixon Semiconductors', VRDA: 'Verida Health', ORBT: 'Orbit Freight', TRQS: 'Torquis Robotics',
  QNTA: 'Quintara Grid', ZENO: 'Zenova Biotech', KLMR: 'Kelmar Energy', AXEM: 'Axemont Materials',
  BRYL: 'Beryl Payments', DRVX: 'Drivex Mobility', SNVA: 'Sunvara Cloud', FYNX: 'Fynx Media',
  NOVT: 'Novata Pharma', MRCL: 'Marcel Foods', LUMO: 'Lumora Devices', PLDN: 'Peldon Defense'
};

const MOVES = [
  ['TRQS', 14.2], ['ORBT', 9.6], ['HLXN', 6.3], ['QNTA', 5.8], ['ZENO', 4.9], ['KLMR', 3.7], ['AXEM', 3.1], ['BRYL', 2.4],
  ['DRVX', -12.8], ['VRDA', -8.4], ['SNVA', -6.1], ['FYNX', -5.2], ['NOVT', -4.4], ['MRCL', -3.6], ['LUMO', -2.9], ['PLDN', -2.2]
];

export const name = 'demo';

/** Last price for a ticker. Unknown tickers still get a stable price. */
export const priceOf = k => +(22 + rng(hash('px' + k))() * 290).toFixed(2);

/** Company name, or '' when unknown. */
export const companyName = k => NAMES[k] || '';

/** Today's top gainers and losers. c = % change, vol = times normal volume, p = last price. */
export function movers() {
  return MOVES.map(([k, c]) => ({ k, c, vol: +(1.3 + rng(hash('mv' + k))() * 3.6).toFixed(1), p: priceOf(k), name: NAMES[k] }));
}

/** 56 daily candles ending at the last price, plus the session open used for % change. */
export function chart(k) {
  const p = priceOf(k), r = rng(hash('ch' + k)), cl = [1];
  for (let i = 1; i < 56; i++) cl.push(cl[i - 1] * (1 + (r() - 0.48) * 0.045));
  const f = p / cl[55];
  const candles = cl.map((c, i) => {
    const o = (i ? cl[i - 1] : c * 0.99) * f, cc = c * f;
    return { o, c: cc, h: Math.max(o, cc) * (1 + r() * 0.012), l: Math.min(o, cc) * (1 - r() * 0.012) };
  });
  const mv = MOVES.find(m => m[0] === k);
  const open = mv ? p / (1 + mv[1] / 100) : candles[40].c;
  return { ticker: k, name: NAMES[k] || '', price: p, open, candles };
}

/** A full round from the deterministic demo engine. */
export const round = async (brief, mode) => {
  const { makeCase } = await import('../engine/case.js');
  return { ...makeCase(brief, mode), assetClass: 'demo' };
};

/** Price used when a ticket is executed. */
export const quote = async k => priceOf(k);
