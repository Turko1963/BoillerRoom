// Research assumptions: the numbers we use when no broker's terms are known. They are ours, not anyone's terms, so every
// one is status 'assumed' with its reason, and anything computed from them is a hypothesis, not a net result.
import { field } from './fields.js';

const ON = '2026-11-28';
export const RESEARCH = {
  roundTripStock: field(0.1, '% of value', 'assumed', null, ON, 'A cautious guess for commission plus spread on a liquid share, in and out. Real costs vary by broker and size.'),
  roundTripCrypto: field(0.2, '% of value', 'assumed', null, ON, 'A cautious guess for exchange fees plus spread on a liquid coin, in and out.'),
  borrowPerYear: field(3, '% a year', 'assumed', null, ON, 'A guess for the cost of borrowing a share to short it; hard-to-borrow shares can cost far more.')
};

// thresholds that are not costs, each with its reason (no universal constant: change them here, with a reason)
export const THRESHOLDS = {
  calibrationMinPerBand: { value: 10, why: 'Under about 10 trades a hit rate swings by 10 points or more on a single trade, too wide to read.' },
  riskPerTradePct: { value: 1, why: 'The default risk to the stop for sizing in the Trade plan; the person can change it there.' }
};
