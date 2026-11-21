// The paper broker: the same interface as server/broker/ctrader.js, filled on real prices, with no broker behind it.
// It lets the demo weeks start before cTrader approves the app: the service (rules, sizing, position manager, Scoreboard)
// runs unchanged on top of it. Switch to cTrader with BROKER=ctrader in .env.
//
// How it fills, kept on the cautious side:
//   market orders at the current price plus half a spread (buyers pay the ask, sellers get the bid)
//   the stop is checked every time positions are read (the manager reads them every 5 minutes in market hours):
//   a price at or past the stop closes the position at that price, not at the stop (a gap is not forgiven)
//   orders only while the US market is open (9:30 to 16:00 New York, weekdays), as stock CFDs at a broker
//   commission $0.02 a share each way (about what a broker charges for US share CFDs), no overnight swap
// State lives in the broker_kv table of the store it is given (its own database file, see server/index.js).

const SPREAD = 0.0004, COMMISSION = 0.02;

/**
 * quote(ticker) -> last price (the market provider's). isOpen(t) -> market open. now: the clock.
 * balance: the starting balance (PAPER_BALANCE, 1000 by default, like the cTrader demo account).
 */
export function createPaperClient({ store, quote, isOpen, now = () => Date.now(), balance = +process.env.PAPER_BALANCE || 1000 }) {
  const load = () => JSON.parse(store.kvGet('paper:state') || 'null') || { balance, positions: [], deals: [], next: 1, symbols: {} };
  const save = s => store.kvSet('paper:state', JSON.stringify(s));
  const price = async id => { const s = load(), tk = s.symbols[id]; if (!tk) throw new Error('paper: unknown symbol'); const p = await quote(tk); if (!(p > 0)) throw new Error(`paper: no price for ${tk}`); return p; };
  const book = (s, p, units, px, why) => {
    const d = p.side === 'sell' ? -1 : 1, gross = (px - p.price) * d * units, fee = COMMISSION * units;
    s.balance = +(s.balance + gross - fee).toFixed(2);
    s.deals.push({ positionId: p.positionId, t: now(), units, price: px, gross: +gross.toFixed(2), fee: +fee.toFixed(2), why });
    p.volume -= Math.round(units * 100);
    if (p.volume <= 0) s.positions = s.positions.filter(x => x !== p);
  };
  // stops: a price at or past the stop closes the position at that price
  async function checkStops(s) {
    for (const p of [...s.positions]) {
      if (p.stop == null) continue;
      const px = await price(p.symbolId).catch(() => null);
      if (px == null) continue;
      const exit = p.side === 'sell' ? px * (1 + SPREAD / 2) : px * (1 - SPREAD / 2);
      if (p.side === 'sell' ? exit >= p.stop : exit <= p.stop) book(s, p, p.volume / 100, +exit.toFixed(4), 'stop');
    }
  }
  const session = {
    close() {}, on() { return () => {}; },
    info: async () => ({ login: null, balance: load().balance, leverage: null }),
    async positions() {
      const s = load();
      if (isOpen(now())) { await checkStops(s); save(s); }
      return s.positions.map(p => ({ ...p, units: p.volume / 100 }));
    },
    // any US stock: the symbol is the ticker itself
    async findSymbols() { return []; },
    async symbolFor(ticker) {
      const s = load(), id = Object.entries(s.symbols).find(([, t]) => t === ticker)?.[0] || String(Object.keys(s.symbols).length + 1);
      s.symbols[id] = ticker; save(s);
      return { symbolId: +id, name: ticker };
    },
    symbol: async id => ({ symbolId: +id, minVolume: 100, stepVolume: 100, maxVolume: 1e8, swapLong: 0, swapShort: 0 }),
    async quote(id) { const p = await price(id); return { bid: +(p * (1 - SPREAD / 2)).toFixed(4), ask: +(p * (1 + SPREAD / 2)).toFixed(4) }; },
    async marketOrder({ symbolId, side, volume, stopDistance }) {
      if (!isOpen(now())) throw Object.assign(new Error('The US market is closed: paper orders fill only from 9:30 to 16:00 New York time'), { status: 409 });
      const s = load(), q = await session.quote(symbolId), px = side === 'sell' ? q.bid : q.ask, units = volume / 100;
      const p = { positionId: s.next++, symbolId: +symbolId, side, volume, price: px, stop: +(px - (side === 'sell' ? -1 : 1) * stopDistance).toFixed(4), openedAt: now() };
      s.positions.push(p);
      s.balance = +(s.balance - COMMISSION * units).toFixed(2);
      s.deals.push({ positionId: p.positionId, t: now(), units, price: px, gross: 0, fee: +(COMMISSION * units).toFixed(2), why: 'open' });
      save(s);
      return { positionId: p.positionId, price: px, volume };
    },
    async amend(positionId, { stop }) { const s = load(), p = s.positions.find(x => x.positionId === +positionId); if (!p) throw new Error('paper: no such position'); if (stop != null) p.stop = stop; save(s); return { positionId: p.positionId, stop: p.stop }; },
    async closePosition(positionId, volume) {
      if (!isOpen(now())) throw Object.assign(new Error('The US market is closed: paper positions close from 9:30 to 16:00 New York time'), { status: 409 });
      const s = load(), p = s.positions.find(x => x.positionId === +positionId);
      if (!p) throw new Error('paper: no such position');
      const q = await session.quote(p.symbolId), px = p.side === 'sell' ? q.ask : q.bid;
      book(s, p, Math.min(volume, p.volume) / 100, px, 'close'); save(s);
      return { positionId: p.positionId, price: px, volume };
    },
    // the money a position made: every deal's gross minus commissions, once it is fully closed
    async positionPnl(positionId) {
      const s = load();
      if (s.positions.some(p => p.positionId === +positionId)) return null;
      const d = s.deals.filter(x => x.positionId === +positionId);
      return d.length ? +d.reduce((t, x) => t + x.gross - x.fee, 0).toFixed(2) : null;
    }
  };
  return {
    env: 'paper', autoLink: true,
    configured: () => true,
    authUrl: () => { throw Object.assign(new Error('The paper broker needs no sign-in'), { status: 409 }); },
    exchangeCode: async () => { throw new Error('The paper broker needs no sign-in'); },
    refreshToken: async () => ({ access: 'paper', refresh: null, expiresAt: now() + 3650 * 864e5 }),
    accounts: async () => [{ accountId: 1, login: null, live: false }],
    account: async () => session
  };
}
