// HTTP layer: serves the frontend from public/ and the JSON API under /api.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { simulateFills } from './engine/execute.js';
import { MODES } from './engine/team.js';
import { brains } from './engine/ai.js';
import { createAuth } from './auth.js';
import { withFeatures } from './features.js';
import { readFileSync } from 'node:fs';
import { evaluate, weightsFor, scoreboard, portfolio, history, deskMemory } from './engine/scoreboard.js';
import { performance } from './engine/performance.js';
import { crowdFor } from './engine/crowdview.js';
import { translateRound } from './engine/translate.js';
import * as claudeAi from './ai/claude.js';
import * as geminiAi from './ai/gemini.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
// The room is served only behind a session, so it lives outside public/.
const ROOM = join(dirname(fileURLToPath(import.meta.url)), 'views', 'room.html');
const TICKER = /^[A-Z0-9^][A-Z0-9.\-]{0,9}$/;

// async route handler: errors from data sources become JSON responses
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_BRIEF = 300;

// The running version: git commit and its date, shown in the page header.
const VERSION = (() => {
  try { const [h, d] = execSync('git log -1 --format=%h%n%cs', { cwd: join(PUBLIC, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n'); return { commit: h, date: d }; }
  catch { return { commit: 'unknown', date: null }; }
})();

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

/**
 * code: the members' six digit code (ACCESS_CODE). openRoom: tests only, skips the session check.
 * password: optional HTTP Basic Auth in front of everything (ACCESS_PASSWORD), the older lock.
 */
export function createApp({ store, market, password = process.env.ACCESS_PASSWORD, code, openRoom = false, watch = null, crowdSources = null, broker = null, translator = undefined }) {
  // Hebrew: the model that translates a round's text (Claude, else Gemini); tests pass a fake, null means none
  const tr = translator !== undefined ? translator : claudeAi.ready() ? claudeAi.ask : geminiAi.ready() ? geminiAi.ask : null;
  const toLang = (obj, lang) => (lang === 'he' ? translateRound(obj, { lang, ask: tr, cache: store.translations, log: m => console.warn(m) }) : obj);
  // the crowd panel's sources (real ones loaded on first use; tests pass fakes)
  let crowdP = crowdSources ? Promise.resolve(crowdSources) : null;
  const getCrowd = () => (crowdP ??= Promise.all(['./data/crowd.js', './data/yahoo.js', './data/news.js', './data/coingecko.js', './data/derivs.js'].map(f => import(f)))
    .then(([crowd, yahoo, news, coingecko, derivs]) => ({ crowd, yahoo, news, coingecko, derivs })));
  // the volatility watch on real sources, loaded on first use (tests pass a fake)
  let watchP = watch ? Promise.resolve(watch) : null;
  const getWatch = () => (watchP ??= Promise.all([import('./engine/volwatch.js'), import('./data/yahoo.js'), import('./data/derivs.js'), import('./data/cftc.js'), import('./data/news.js')])
    .then(([w, yahoo, derivs, cftc, news]) => w.createWatch({ yahoo, derivs, cftc, news })));
  const app = express();
  app.disable('x-powered-by');
  // Caddy runs on the same machine: trust its X-Forwarded-* headers so req.ip and req.secure are right
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => { if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000'); next(); });
  if (password) app.use(passwordGate(password));
  app.use(express.json({ limit: '16kb' }));

  const auth = createAuth({ store, ...(code !== undefined ? { code } : {}) });
  const api = express.Router();

  /* ---------- the members' gate: open to everyone ---------- */
  api.post('/unlock', auth.unlock);
  api.get('/session', (req, res) => { const s = auth.session(req); s ? res.json({ ok: true, member: s.member ? { name: s.member.name, role: s.member.role } : null, role: s.role }) : res.status(401).json({ error: 'No session' }); });
  api.post('/logout', auth.logout);
  /* ---------- everything below needs a session ---------- */
  /* ---------- volatility watch: the browser keeps a watch key, so alerts keep coming after logout ---------- */
  // the key only answers "is volatility expected for this symbol": no rounds, no portfolio, nothing else
  const watchHash = t => createHash('sha256').update(String(t)).digest('hex');
  const WATCH_KEY = /^[A-Za-z0-9_-]{32,64}$/;
  api.get('/watch/:token', wrap(async (req, res) => {
    if (!WATCH_KEY.test(req.params.token)) return res.status(400).json({ error: 'Bad watch key' });
    const w = store.getWatch(watchHash(req.params.token));
    if (!w) return res.status(404).json({ error: 'This watch was stopped' });
    res.set('Cache-Control', 'no-store').json(await (await getWatch()).check(w.symbol));
  }));
  api.delete('/watch/:token', (req, res) => {
    if (!WATCH_KEY.test(req.params.token)) return res.status(400).json({ error: 'Bad watch key' });
    res.json({ ok: store.dropWatch(watchHash(req.params.token)) });
  });

  if (!openRoom) api.use(auth.apiGuard);

  // members start a watch from the room: returns the key the browser keeps, and the first reading
  api.post('/watch', wrap(async (req, res) => {
    const symbol = String(req.body?.symbol ?? 'OIL').trim().toUpperCase() || 'OIL';
    if (!/^[A-Z0-9^=.-]{1,12}$/.test(symbol)) return res.status(400).json({ error: 'Symbol must be 1 to 12 letters, digits or ^=.-' });
    const token = randomBytes(24).toString('base64url');
    store.addWatch(watchHash(token), symbol, Date.now());
    res.status(201).json({ token, symbol, status: await (await getWatch()).check(symbol) });
  }));

  api.get('/health', (req, res) => res.json({ ok: true, version: VERSION, market: market.name, brains: market.name === 'demo' ? brains().slice(0, 1) : brains() }));

  /* ---------- market data ---------- */
  api.get('/market/movers', wrap(async (req, res) => res.json({ movers: await market.movers() })));

  api.get('/market/chart/:ticker', wrap(async (req, res) => {
    const k = req.params.ticker.toUpperCase();
    if (!TICKER.test(k)) return res.status(400).json({ error: 'Ticker must be 1 to 10 letters or digits' });
    res.json(await market.chart(k));
  }));

  // performance of one asset (today, week, month to date, year to date...) next to its benchmark
  api.get('/market/performance/:ticker', wrap(async (req, res) => {
    const k = req.params.ticker.toUpperCase(), cls = req.query.assetClass || 'stock';
    if (!TICKER.test(k)) return res.status(400).json({ error: 'Ticker must be 1 to 10 letters or digits' });
    if (!['stock', 'crypto'].includes(cls)) return res.status(400).json({ error: 'assetClass must be stock or crypto' });
    // Tel Aviv shares against the TA-35, US shares against the S&P 500, coins against Bitcoin
    const ta = /\.TA$/.test(k);
    let k1, bench = null, benchName = cls === 'crypto' ? 'Bitcoin' : ta ? 'TA-35' : 'S&P 500';
    if (market.history) {
      const bk = cls === 'crypto' ? (k === 'BTC' ? 'ETH' : 'BTC') : ta ? 'TA35.TA' : '^GSPC';
      if (k === 'BTC' && cls === 'crypto') benchName = 'Ethereum';
      const H = market.fullHistory || market.history; // all of it, for the 2, 3, 5 year and since-IPO rows
      [k1, bench] = await Promise.all([H(k, cls), H(bk, cls).catch(() => null)]);
    } else {
      // demo: the chart's daily candles, dated back from today
      const c = await market.chart(k), n = c.candles.length, now = Date.now();
      k1 = c.candles.map((x, i) => ({ ...x, t: now - (n - 1 - i) * 864e5 }));
    }
    const p = performance(k1, bench, Date.now(), { firstLabel: cls === 'crypto' ? 'Since its first day on Binance' : 'Since IPO' });
    if (!p) return res.status(404).json({ error: `No price history for ${k}` });
    // coins trade around the clock: the first row is the rolling 24 hours, not "since midnight UTC"
    if (cls === 'crypto' && market.change24h) {
      const [c, cb] = await Promise.all([market.change24h(k), market.change24h(k === 'BTC' ? 'ETH' : 'BTC')]);
      if (c != null) Object.assign(p.periods[0], { label: '24 hours', pct: c, bench: cb });
    }
    res.json({ ticker: k, assetClass: cls, currency: ta ? 'ILS' : 'USD', benchName: bench ? benchName : null, ...p });
  }));

  // what the crowd (Reddit buzz, options traders, coin voters, futures traders, news) thinks, next to the room's call
  api.get('/crowd/:ticker', wrap(async (req, res) => {
    const k = req.params.ticker.toUpperCase(), cls = req.query.assetClass || 'stock', call = req.query.call || null;
    if (!TICKER.test(k)) return res.status(400).json({ error: 'Ticker must be 1 to 10 letters or digits' });
    if (!['stock', 'crypto'].includes(cls)) return res.status(400).json({ error: 'assetClass must be stock or crypto' });
    if (call && !['Buy', 'Hold', 'Short', 'Sell'].includes(call)) return res.status(400).json({ error: 'call must be Buy, Hold, Short or Sell' });
    if (market.name === 'demo' && !crowdSources) return res.status(400).json({ error: 'The crowd needs live market data: demo companies are fictional' });
    const name = String(req.query.name || '').slice(0, 80);
    res.json(await crowdFor({ symbol: k, kind: cls, name, call: call === 'Sell' ? 'Short' : call }, await getCrowd()));
  }));

  /* ---------- rounds: brief the room, get the full decision ---------- */
  api.post('/rounds', wrap(async (req, res) => {
    const { brief, mode = 'trader', brain = 'rules', lang = 'en' } = req.body || {};
    if (typeof brief !== 'string' || !brief.trim()) return res.status(400).json({ error: 'brief is required' });
    if (!['en', 'he'].includes(lang)) return res.status(400).json({ error: 'lang must be en or he' });
    if (brief.length > MAX_BRIEF) return res.status(400).json({ error: `brief must be at most ${MAX_BRIEF} characters` });
    if (!MODES[mode]) return res.status(400).json({ error: 'mode must be trader or investor' });
    const b = brains().find(x => x.id === brain);
    if (!b) return res.status(400).json({ error: 'brain must be rules, claude, gemini or both' });
    if (!b.ready) return res.status(400).json({ error: `${b.label} is not set up: add its API key to .env` });
    if (brain !== 'rules' && market.name === 'demo') return res.status(400).json({ error: 'AI brains need live market data (MARKET_PROVIDER=live)' });
    // The brief is used as given (not trimmed): the frontend's "Run again"
    // appends a space to get a fresh, but still reproducible, round.
    // desks with a good track record get a bigger vote (null until enough calls are graded)
    // tickets approved in the last 90 days, so the Risk desk can see what the book already holds
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const book = market.name === 'demo' ? [] : store.listOrders(30).filter(o => o.createdAt >= since).map(o => ({ ticker: o.ticker, side: o.side, assetClass: store.getRound(o.roundId)?.assetClass }));
    // memory: each desk's graded record, given to the AI desks before they speak
    const memory = brain !== 'rules' && market.name !== 'demo' ? ticker => deskMemory(store, mode, ticker) : null;
    const c = await market.round(brief, mode, { brain, weights: market.name === 'demo' ? null : weightsFor(store, mode), book, memory });
    // saved in English (the scoreboard and the desks' memory read it); the room gets it in the language asked for
    const { id, createdAt } = store.saveRound(c);
    res.status(201).json({ id, createdAt, ...(await toLang(c, lang)) });
  }));

  api.get('/rounds', (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    res.json({ rounds: store.listRounds(limit) });
  });

  // ?lang=he: the saved (English) round with its text in Hebrew, for the room when the language is switched
  api.get('/rounds/:id', wrap(async (req, res) => {
    const r = store.getRound(req.params.id), lang = req.query.lang || 'en';
    if (!r) return res.status(404).json({ error: 'Round not found' });
    if (!['en', 'he'].includes(lang)) return res.status(400).json({ error: 'lang must be en or he' });
    res.json({ ...(await toLang(r, lang)), order: store.orderForRound(r.id) || null });
  }));

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

  /* ---------- the scoreboard: graded calls, desk track records, paper portfolio ---------- */
  let lastEval = 0;
  const freshen = async () => { if (Date.now() - lastEval > 10 * 60e3) { lastEval = Date.now(); await evaluate({ store, market }).catch(e => console.warn('[scoreboard]', e.message)); } };
  api.get('/scoreboard', wrap(async (req, res) => { await freshen(); res.json(scoreboard(store)); }));
  api.get('/portfolio', wrap(async (req, res) => res.json(await portfolio({ store, market }))));
  // the History teacher: every brief, and what would have happened if we had followed each ticket
  api.get('/history', wrap(async (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    res.json(await history({ store, market, limit }));
  }));

  api.get('/orders', (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    res.json({ orders: store.listOrders(limit) });
  });

  /* ---------- the broker (cTrader, demo): viewers see it, traders and admins send, admins connect ---------- */
  // tests pass a broker built on a fake client; without one the routes answer that the broker is not set up
  const trade = openRoom ? (req, res, next) => { req.who ??= { role: 'admin', member: { name: 'test' } }; next(); } : auth.requireRole('trader', 'admin');
  const admin = openRoom ? trade : auth.requireRole('admin');
  const brk = (req, res, next) => (broker ? next() : res.status(503).json({ error: 'The broker link is not set up on this server' }));
  const who = req => req.who?.member?.name || req.who?.role || 'member';
  const fail = (res, e) => (e.status ? res.status(e.status).json({ error: e.message, ...(e.blocked ? { blocked: e.blocked } : {}) }) : Promise.reject(e));
  const ROUND_ID = /^[0-9a-f-]{36}$/;
  api.get('/broker/status', brk, wrap(async (req, res) => res.set('Cache-Control', 'no-store').json({ ...(await broker.status()), canTrade: ['trader', 'admin'].includes(req.who?.role ?? (openRoom ? 'admin' : 'viewer')), role: req.who?.role ?? (openRoom ? 'admin' : 'viewer') })));
  // opened in a new tab: cTrader asks the account owner, then comes back to /api/broker/callback
  api.get('/broker/connect', brk, admin, (req, res) => { try { res.redirect(302, broker.startConnect(who(req))); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
  api.get('/broker/callback', brk, admin, wrap(async (req, res) => {
    const code = String(req.query.code || ''), state = String(req.query.state || '');
    const page = (title, text) => res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px system-ui;background:#0b0f14;color:#e6edf3;display:grid;place-items:center;min-height:90vh;text-align:center"><div><h2>${title}</h2><p>${text}</p><p style="opacity:.6">You can close this tab and go back to the room.</p></div>`);
    if (req.query.error) return page('Not connected', 'cTrader did not give access.');
    if (!code || code.length > 2000 || !/^[\w-]{8,100}$/.test(state)) return res.status(400).json({ error: 'Missing code or state' });
    try { const r = await broker.finishConnect(code, state); page('Connected', `Demo account ${Number(r.login) || ''} is linked to the room.`); }
    catch (e) { if (!e.status) console.warn('[broker] connect failed:', e.message); page('Not connected', String(e.message).replace(/[<>&]/g, '')); }
  }));
  api.post('/broker/disconnect', brk, admin, (req, res) => { broker.disconnect(who(req)); res.json({ ok: true }); });
  api.post('/broker/method', brk, admin, (req, res) => {
    if (!['B', 'C'].includes(req.body?.method)) return res.status(400).json({ error: 'method must be B or C' });
    res.json({ method: broker.setMethod(req.body.method) });
  });
  const roundFor = (req, res) => {
    const id = String(req.body?.roundId || '');
    if (!ROUND_ID.test(id)) { res.status(400).json({ error: 'roundId is required' }); return null; }
    const r = store.getRound(id);
    if (!r) { res.status(404).json({ error: 'Round not found' }); return null; }
    return r;
  };
  api.post('/broker/preview', brk, wrap(async (req, res) => { const r = roundFor(req, res); if (r) await broker.preview(r).then(v => res.json(v), e => fail(res, e)); }));
  api.post('/broker/orders', brk, trade, wrap(async (req, res) => {
    const r = roundFor(req, res); if (!r) return;
    if (typeof req.body?.previewId !== 'string' || !ROUND_ID.test(req.body.previewId)) return res.status(400).json({ error: 'previewId is required' });
    await broker.send(r, req.body.previewId, who(req)).then(v => res.status(201).json(v), e => fail(res, e));
  }));
  api.get('/broker/positions', brk, wrap(async (req, res) => res.set('Cache-Control', 'no-store').json(await broker.positions())));
  api.post('/broker/positions/:id/close', brk, trade, wrap(async (req, res) => {
    if (!ROUND_ID.test(req.params.id)) return res.status(400).json({ error: 'Bad position id' });
    if (!['half', 'all'].includes(req.body?.part ?? 'all')) return res.status(400).json({ error: 'part must be half or all' });
    await broker.close(req.params.id, req.body?.part ?? 'all', who(req)).then(() => res.json({ ok: true }), e => fail(res, e));
  }));
  api.post('/broker/positions/:id/add', brk, trade, wrap(async (req, res) => {
    if (!ROUND_ID.test(req.params.id)) return res.status(400).json({ error: 'Bad position id' });
    await broker.addHalf(req.params.id, who(req)).then(v => res.json(v), e => fail(res, e));
  }));
  api.post('/broker/close-all', brk, trade, wrap(async (req, res) => res.json(await broker.closeAll(who(req)))));
  // the demo against the benchmark, for the Scoreboard
  api.get('/broker/benchmark', brk, wrap(async (req, res) => res.set('Cache-Control', 'no-store').json(await broker.benchmark())));
  api.get('/broker/log', brk, (req, res) => res.set('Cache-Control', 'no-store').json({ log: broker.log(Math.max(0, +req.query.since || 0)) }));

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // the room itself, only with a session; never cached by the browser or a proxy
  app.get(['/room', '/room/'], openRoom ? (req, res, next) => next() : auth.pageGuard, (req, res) => {
    res.set('Cache-Control', 'private, no-store').type('html').send(withFeatures(readFileSync(ROOM, 'utf8'), 'room'));
  });

  // public: the BackStage Capital intro and the code screen (with the optional Bull vs Bear intro fight)
  app.get(['/', '/index.html'], (req, res) => {
    res.set('Cache-Control', 'no-cache').type('html').send(withFeatures(readFileSync(join(PUBLIC, 'index.html'), 'utf8'), 'gate'));
  });
  app.use(express.static(PUBLIC, { index: 'index.html', setHeaders: res => res.set('Cache-Control', 'no-cache') }));

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
