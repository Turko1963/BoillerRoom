// HTTP layer: serves the frontend from public/ and the JSON API under /api.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { simulateFills } from './engine/execute.js';
import { MODES } from './engine/team.js';
import { brains } from './engine/ai.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TICKER = /^[A-Z0-9^][A-Z0-9.\-]{0,9}$/;

// async route handler: errors from data sources become JSON responses
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_BRIEF = 300;

/**
 * Password protection for the whole site (page and API) when ACCESS_PASSWORD is set.
 * The browser shows its own login box; any user name works, the password must match.
 */
function passwordGate(password) {
  const expected = Buffer.from(password);
  return (req, res, next) => {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    const given = scheme === 'Basic' && token ? Buffer.from(Buffer.from(token, 'base64').toString().split(':').slice(1).join(':')) : Buffer.alloc(0);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Boiler Room", charset="UTF-8"').status(401).json({ error: 'Password required' });
  };
}

export function createApp({ store, market, password = process.env.ACCESS_PASSWORD }) {
  const app = express();
  app.disable('x-powered-by');
  if (password) app.use(passwordGate(password));
  app.use(express.json({ limit: '16kb' }));

  const api = express.Router();

  api.get('/health', (req, res) => res.json({ ok: true, market: market.name, brains: market.name === 'demo' ? brains().slice(0, 1) : brains() }));

  /* ---------- market data ---------- */
  api.get('/market/movers', wrap(async (req, res) => res.json({ movers: await market.movers() })));

  api.get('/market/chart/:ticker', wrap(async (req, res) => {
    const k = req.params.ticker.toUpperCase();
    if (!TICKER.test(k)) return res.status(400).json({ error: 'Ticker must be 1 to 10 letters or digits' });
    res.json(await market.chart(k));
  }));

  /* ---------- rounds: brief the room, get the full decision ---------- */
  api.post('/rounds', wrap(async (req, res) => {
    const { brief, mode = 'trader', brain = 'rules' } = req.body || {};
    if (typeof brief !== 'string' || !brief.trim()) return res.status(400).json({ error: 'brief is required' });
    if (brief.length > MAX_BRIEF) return res.status(400).json({ error: `brief must be at most ${MAX_BRIEF} characters` });
    if (!MODES[mode]) return res.status(400).json({ error: 'mode must be trader or investor' });
    const b = brains().find(x => x.id === brain);
    if (!b) return res.status(400).json({ error: 'brain must be rules, claude or gemini' });
    if (!b.ready) return res.status(400).json({ error: `${b.label} is not set up: add its API key to .env` });
    if (brain !== 'rules' && market.name === 'demo') return res.status(400).json({ error: 'AI brains need live market data (MARKET_PROVIDER=live)' });
    // The brief is used as given (not trimmed): the frontend's "Run again"
    // appends a space to get a fresh, but still reproducible, round.
    const c = await market.round(brief, mode, { brain });
    const { id, createdAt } = store.saveRound(c);
    res.status(201).json({ id, createdAt, ...c });
  }));

  api.get('/rounds', (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    res.json({ rounds: store.listRounds(limit) });
  });

  api.get('/rounds/:id', (req, res) => {
    const r = store.getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    res.json({ ...r, order: store.orderForRound(r.id) || null });
  });

  /* ---------- approve the ticket: paper fill in slices ---------- */
  api.post('/rounds/:id/execute', wrap(async (req, res) => {
    const r = store.getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    if (!r.ticket) return res.status(409).json({ error: 'The room decided to hold. There is no ticket to execute' });
    const existing = store.orderForRound(r.id);
    if (existing) return res.status(409).json({ error: 'This ticket was already executed', order: existing });
    // fill around the current price, not the price when the room decided
    const price = await market.quote(r.tk || 'TGT', r.assetClass).catch(() => r.p);
    const { fills, avgPrice } = simulateFills({ ...r, p: price });
    const order = store.saveOrder({
      roundId: r.id, ticker: r.tk || 'TGT', side: r.call === 'Buy' ? 'buy' : r.callLabel.toLowerCase(),
      sizePct: r.size, leverage: r.lev, entry: r.p, stop: r.stop, target: r.tgt, avgPrice, fills
    });
    res.status(201).json(order);
  }));

  api.get('/orders', (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    res.json({ orders: store.listOrders(limit) });
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  app.use(express.static(PUBLIC, { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body must be valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Body too large' });
    // data source errors (Yahoo, Binance, SEC) and "no ticker found"
    if (err.source) {
      const status = err.status === 404 || err.status === 422 ? err.status : 502;
      return res.status(status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}
