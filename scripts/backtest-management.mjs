// Backtest of the money and position management rules on real daily prices (network; run on the server):
//   npm run backtest:management
// The same entries (a pullback in an uptrend) are managed four ways; results are in R (1R = the planned risk).
import * as yahoo from '../server/data/yahoo.js';
import * as binance from '../server/data/binance.js';
import * as sec from '../server/data/sec.js';
import { backtest } from '../server/engine/manage.js';

const STOCKS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'V', 'MA', 'UNH', 'XOM', 'JNJ', 'PG', 'HD', 'COST', 'NFLX', 'AMD', 'CRM', 'SPY', 'QQQ'];
const COINS = ['BTC', 'ETH', 'SOL'];
const YEARS = 10, since = Date.now() - YEARS * 365.25 * 864e5;
const series = [];
for (const s of STOCKS) {
  try {
    const c = (await yahoo.chart(s, '10y')).candles.filter(k => k.t >= since); /* 'max' would send quarterly candles */
    // past earnings dates from the SEC (8-K item 2.02); ETFs have none
    const ref = await sec.lookup(s).catch(() => null), earnings = ref ? await sec.earningsDates(ref.cik).catch(() => []) : [];
    series.push({ symbol: s, kind: 'stock', candles: c, earnings });
  } catch (e) { console.log('skip', s, e.message); }
}
for (const s of COINS) {
  try { const c = (await binance.fullChart(s)).filter(k => k.t >= since); series.push({ symbol: s, kind: 'crypto', candles: c }); } catch (e) { console.log('skip', s, e.message); }
}
console.log(`${series.length} assets, ${series.reduce((t, s) => t + s.candles.length, 0)} daily candles, from ${new Date(Math.min(...series.map(s => s.candles[0]?.t || Infinity))).toISOString().slice(0, 10)}`);
const NAMES = { plain: 'A plain (all in, fixed stop/target)', managed: 'B our plan (half, add if proven, protect, trail)', noScale: 'C our plan without adding', avgDown: 'D averaging down' };
const show = (title, m) => {
  console.log(`\n${title}`);
  console.log('method'.padEnd(50), 'trades', 'win%', ' avgR', 'totalR', '  PF', 'maxDD R', 'worst', 'hold');
  for (const [k, s] of Object.entries(m)) console.log(NAMES[k].padEnd(50), String(s.trades).padStart(6), String(s.winRate).padStart(4), String(s.avgR).padStart(5), String(s.totalR).padStart(6), String(s.profitFactor).padStart(5), String(s.maxDrawdownR).padStart(7), String(s.worstR).padStart(5), String(s.avgHold).padStart(4));
};
const stocks = series.filter(s => s.kind === 'stock'), cr = backtest(series.filter(s => s.kind === 'crypto'));
console.log('earnings dates found:', stocks.map(s => `${s.symbol} ${s.earnings.length}`).join(', '));
const base = backtest(stocks), guard = backtest(stocks, { guard: true }), both = backtest(stocks, { guard: true, cap: 5 });
show('STOCKS, as before (no guard, no cap)', base.methods);
show('STOCKS, earnings guard (no trade within 5 sessions of earnings, out the session before)', guard.methods);
show('STOCKS, earnings guard + at most 5 trades open at once', both.methods);
show('STOCKS, guard + cap, before 2021', Object.fromEntries(Object.entries(both.byPeriod).map(([k, v]) => [k, v.before])));
show('STOCKS, guard + cap, 2021 and after', Object.fromEntries(Object.entries(both.byPeriod).map(([k, v]) => [k, v.after])));
show('CRYPTO (for reference)', cr.methods);
process.exit(0);
