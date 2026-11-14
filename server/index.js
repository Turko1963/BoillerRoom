// Entry point: reads config from the environment and starts the server.
import { createApp } from './app.js';
import { openStore } from './store/db.js';
import * as demoMarket from './market/demo.js';
import { existsSync } from 'node:fs';

// Optional .env file (see .env.example). Real environment variables win.
if (existsSync('.env')) process.loadEnvFile('.env');

const MARKETS = { demo: demoMarket };

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || 'data/boilerroom.db';
const MARKET = process.env.MARKET_PROVIDER || 'demo';

const market = MARKETS[MARKET];
if (!market) {
  console.error(`Unknown MARKET_PROVIDER "${MARKET}". Available: ${Object.keys(MARKETS).join(', ')}`);
  process.exit(1);
}

const store = openStore(DB_PATH);
const server = createApp({ store, market }).listen(PORT, HOST, () => {
  console.log(`Boiler Room listening on http://${HOST}:${PORT} (market: ${market.name}, db: ${DB_PATH})`);
});

const shutdown = () => server.close(() => { store.close(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
