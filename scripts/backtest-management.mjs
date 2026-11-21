// Backtest of the money and position management rules on real daily prices (network; run on the server):
//   npm run backtest:management
// The same entries (a pullback in an uptrend) are managed four ways; results are in R (1R = the planned risk).
import * as yahoo from '../server/data/yahoo.js';
import * as binance from '../server/data/binance.js';
import { backtest } from '../server/engine/manage.js';

const STOCKS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'V', 'MA', 'UNH', 'XOM', 'JNJ', 'PG', 'HD', 'COST', 'NFLX', 'AMD', 'CRM', 'SPY', 'QQQ'];
const COINS = ['BTC', 'ETH', 'SOL'];
const YEARS = 10, since = Date.now() - YEARS * 365.25 * 864e5;
const series = [];
for (const s of STOCKS) {
  try { const c = (await yahoo.chart(s, '10y')).candles.filter(k => k.t >= since); /* 'max' would send quarterly candles */ series.push({ symbol: s, kind: 'stock', candles: c }); } catch (e) { console.log('skip', s, e.message); }
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
const all = backtest(series), st = backtest(series.filter(s => s.kind === 'stock')), cr = backtest(series.filter(s => s.kind === 'crypto'));
show('ALL ASSETS, 10 years', all.methods);
show('STOCKS', st.methods);
show('CRYPTO', cr.methods);
show('ALL, before 2021', Object.fromEntries(Object.entries(all.byPeriod).map(([k, v]) => [k, v.before])));
show('ALL, 2021 and after', Object.fromEntries(Object.entries(all.byPeriod).map(([k, v]) => [k, v.after])));
process.exit(0);
