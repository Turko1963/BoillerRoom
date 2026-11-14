// HTTP layer: serves the frontend from public/ and the JSON API under /api.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { makeCase } from './engine/case.js';
import { simulateFills } from './engine/execute.js';
import { MODES } from './engine/team.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TICKER = /^[A-Z]{2,5}$/;
const MAX_BRIEF = 300;

export function createApp({ store, market }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  const api = express.Router();

  api.get('/health', (req, res) => res.json({ ok: true, market: market.name, engine: 'demo' }));

  /* ---------- market data ---------- */
  api.get('/market/movers', (req, res) => res.json({ movers: market.movers() }));

  api.get('/market/chart/:ticker', (req, res) => {
    const k = req.params.ticker.toUpperCase();
    if (!TICKER.test(k)) return res.status(400).json({ error: 'Ticker must be 2 to 5 letters' });
    res.json(market.chart(k));
  });

  /* ---------- rounds: brief the room, get the full decision ---------- */
  api.post('/rounds', (req, res) => {
    const { brief, mode = 'trader' } = req.body || {};
    if (typeof brief !== 'string' || !brief.trim()) return res.status(400).json({ error: 'brief is required' });
    if (brief.length > MAX_BRIEF) return res.status(400).json({ error: `brief must be at most ${MAX_BRIEF} characters` });
    if (!MODES[mode]) return res.status(400).json({ error: 'mode must be trader or investor' });
    // The brief is used as given (not trimmed): the frontend's "Run again"
    // appends a space to get a fresh, but still reproducible, round.
    const c = makeCase(brief, mode, market);
    const { id, createdAt } = store.saveRound(c);
    res.status(201).json({ id, createdAt, ...c });
  });

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
  api.post('/rounds/:id/execute', (req, res) => {
    const r = store.getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    if (!r.ticket) return res.status(409).json({ error: 'The room decided to hold. There is no ticket to execute' });
    const existing = store.orderForRound(r.id);
    if (existing) return res.status(409).json({ error: 'This ticket was already executed', order: existing });
    const { fills, avgPrice } = simulateFills(r);
    const order = store.saveOrder({
      roundId: r.id, ticker: r.tk || 'TGT', side: r.call === 'Buy' ? 'buy' : r.callLabel.toLowerCase(),
      sizePct: r.size, leverage: r.lev, entry: r.p, stop: r.stop, target: r.tgt, avgPrice, fills
    });
    res.status(201).json(order);
  });

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
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}
