// Entry point: reads config from the environment and starts the server.
import { createApp } from './app.js';
import { openStore } from './store/db.js';
import * as demoMarket from './market/demo.js';
import * as liveMarket from './market/live.js';
import { evaluate } from './engine/scoreboard.js';
import { existsSync } from 'node:fs';

// Optional .env file (see .env.example). Real environment variables win.
if (existsSync('.env')) process.loadEnvFile('.env');

const MARKETS = { live: liveMarket, demo: demoMarket };

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || 'data/boilerroom.db';
const MARKET = process.env.MARKET_PROVIDER || 'live';

const market = MARKETS[MARKET];
if (!market) {
  console.error(`Unknown MARKET_PROVIDER "${MARKET}". Available: ${Object.keys(MARKETS).join(', ')}`);
  process.exit(1);
}

const store = openStore(DB_PATH);
// the broker link (cTrader demo) when its keys are in .env; the position manager checks open trades every 5 minutes
// BROKER=paper (the default): the same rules filled on real prices, in its own database (data/paper.db), so the demo weeks
// can start before cTrader approves the app. BROKER=ctrader: the cTrader account (needs the CTRADER_* keys).
let broker = null;
const BROKER = process.env.BROKER || 'paper';
if (MARKET === 'live' && (BROKER === 'paper' || (BROKER === 'ctrader' && process.env.CTRADER_CLIENT_ID))) {
  const [{ createBroker, marketOpen }, yahoo] = await Promise.all([import('./broker/service.js'), import('./data/yahoo.js')]);
  const opts = { earningsFor: async t => (await yahoo.summary(t))?.earningsDate ?? null, benchHistory: () => market.history('^GSPC', 'stock') };
  if (BROKER === 'paper') {
    const { createPaperClient } = await import('./broker/paper.js');
    const paperStore = openStore(process.env.PAPER_DB_PATH || DB_PATH.replace(/[^/]+$/, 'paper.db'));
    broker = createBroker({ store: paperStore, client: createPaperClient({ store: paperStore, quote: k => market.quote(k, 'stock'), isOpen: marketOpen }), ...opts });
  } else broker = createBroker({ store, ...opts });
  console.log(`[broker] ${BROKER === 'paper' ? 'paper broker (real prices, no orders leave the server)' : 'cTrader ' + (process.env.CTRADER_ENV || 'demo')}`);
  setInterval(() => broker.tick().catch(e => console.warn('[broker]', e.message)), 5 * 60e3).unref();
}
const server = createApp({ store, market, broker }).listen(PORT, HOST, () => {
  console.log(`Boiler Room listening on http://${HOST}:${PORT} (market: ${market.name}, db: ${DB_PATH})`);
});

// grade calls whose holding period has passed: a minute after start, then every 30 minutes
const grade = () => evaluate({ store, market }).then(r => r.graded && console.log(`[scoreboard] graded ${r.graded} call(s)`)).catch(e => console.warn('[scoreboard]', e.message));
setTimeout(grade, 60e3).unref();
setInterval(grade, 30 * 60e3).unref();

const shutdown = () => server.close(() => { store.close(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
