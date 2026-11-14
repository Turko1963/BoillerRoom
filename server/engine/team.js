// The seven desks, the two modes and the labels the engine writes into reports.
// Visual details (colours, icons, bot faces) stay in public/index.html; the
// server only needs names, ordering and vote weights.

export const AG = {
  manager: { name: 'Floor Manager' },
  analyst: { name: 'Market Analyst' },
  filings: { name: 'Filings Specialist' },
  fundamental: { name: 'Fundamental Analyst' },
  risk: { name: 'Risk and Leverage' },
  dealer: { name: 'Dealer' },
  ma: { name: 'M&A Specialist' },
  technical: { name: 'Technical Analyst' }
};

// Seating order around the floor. Also the order desks vote in.
export const RING = ['analyst', 'filings', 'fundamental', 'risk', 'dealer', 'ma', 'technical'];
// Desks that research in parallel before Risk and Dealer are asked.
export const RESEARCH = ['analyst', 'filings', 'fundamental', 'technical', 'ma'];

export const LAB = { bull: 'Bullish', bear: 'Bearish', neutral: 'Neutral' };

// Vote weights per mode. A desk with weight >= 1.3 is shown as a "Lead" desk.
export const MODES = {
  trader: {
    name: 'Trader', hz: 'days to a few weeks', sell: 'Short',
    w: { technical: 1.6, dealer: 1.3, analyst: 1.3, risk: 1.2, ma: 0.8, fundamental: 0.7, filings: 0.7 }
  },
  investor: {
    name: 'Investor', hz: 'months to years', sell: 'Sell',
    w: { fundamental: 1.6, filings: 1.4, ma: 1.2, risk: 1.1, analyst: 0.9, technical: 0.6, dealer: 0.6 }
  }
};
