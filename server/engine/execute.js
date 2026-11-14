// Paper execution: simulates the Dealer working an approved ticket in slices.
// Each slice fills near the entry price with a little drift and the expected
// slippage, always against us (buys fill slightly higher, sells slightly lower).
// Nothing is sent to a broker.

export function simulateFills(round, random = Math.random) {
  const { p, slices, dir } = round;
  const bps = round.M?.dealer?.v ?? 10;
  const fills = [];
  let px = p;
  for (let i = 1; i <= slices; i++) {
    px *= 1 + (random() - 0.5) * 0.005;                 // market drift between slices
    const price = +(px * (1 + dir * bps / 10000)).toFixed(2); // slippage against us
    fills.push({ slice: i, price });
  }
  const avgPrice = +(fills.reduce((t, f) => t + f.price, 0) / fills.length).toFixed(2);
  return { fills, avgPrice };
}
