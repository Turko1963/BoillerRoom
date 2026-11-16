// Persistence: every round the room runs, and every ticket you approve
// (paper trading only, nothing is sent to a broker).
// Uses node:sqlite, built into Node 22.13+, so there is nothing to install.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS rounds (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      brief       TEXT NOT NULL,
      mode        TEXT NOT NULL,
      ticker      TEXT NOT NULL,
      call        TEXT NOT NULL,
      conviction  INTEGER NOT NULL,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rounds_created ON rounds(created_at DESC);
    CREATE TABLE IF NOT EXISTS orders (
      id          TEXT PRIMARY KEY,
      round_id    TEXT NOT NULL UNIQUE REFERENCES rounds(id),
      created_at  TEXT NOT NULL,
      ticker      TEXT NOT NULL,
      side        TEXT NOT NULL,
      size_pct    REAL NOT NULL,
      leverage    REAL NOT NULL,
      entry       REAL NOT NULL,
      stop        REAL NOT NULL,
      target      REAL NOT NULL,
      avg_price   REAL NOT NULL,
      fills       TEXT NOT NULL,
      status      TEXT NOT NULL
    );
    -- members' sessions (only a hash of the token is stored)
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  TEXT PRIMARY KEY,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      ip          TEXT
    );
    -- graded calls: how each round turned out once its holding period passed
    CREATE TABLE IF NOT EXISTS outcomes (
      round_id     TEXT PRIMARY KEY REFERENCES rounds(id),
      evaluated_at TEXT NOT NULL,
      mode         TEXT NOT NULL,
      ret          REAL NOT NULL,
      call         TEXT NOT NULL,
      call_right   INTEGER NOT NULL,
      desks        TEXT NOT NULL
    );
    -- volatility watches: a browser holds the key, only its hash is stored; it keeps working after logout
    CREATE TABLE IF NOT EXISTS watches (
      token_hash  TEXT PRIMARY KEY,
      symbol      TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    -- every attempt at the members' code
    CREATE TABLE IF NOT EXISTS auth_attempts (
      ts          INTEGER NOT NULL,
      ip          TEXT,
      result      TEXT NOT NULL
    );
  `);

  // older databases: add the column that records whether the room page was already opened
  try { db.exec('ALTER TABLE sessions ADD COLUMN room_opened INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }

  const q = {
    insRound: db.prepare('INSERT INTO rounds (id, created_at, brief, mode, ticker, call, conviction, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    getRound: db.prepare('SELECT * FROM rounds WHERE id = ?'),
    listRounds: db.prepare('SELECT id, created_at, brief, mode, ticker, call, conviction FROM rounds ORDER BY created_at DESC LIMIT ?'),
    insOrder: db.prepare(`INSERT INTO orders (id, round_id, created_at, ticker, side, size_pct, leverage, entry, stop, target, avg_price, fills, status)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    orderByRound: db.prepare('SELECT * FROM orders WHERE round_id = ?'),
    listOrders: db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?')
  };

  const orderRow = o => o && ({
    id: o.id, roundId: o.round_id, createdAt: o.created_at, ticker: o.ticker, side: o.side,
    sizePct: o.size_pct, leverage: o.leverage, entry: o.entry, stop: o.stop, target: o.target,
    avgPrice: o.avg_price, fills: JSON.parse(o.fills), status: o.status
  });

  return {
    saveRound(c) {
      const id = randomUUID(), createdAt = new Date().toISOString();
      q.insRound.run(id, createdAt, c.brief, c.mode, c.tk || '', c.call, c.conv, JSON.stringify(c));
      return { id, createdAt };
    },
    getRound(id) {
      const r = q.getRound.get(id);
      return r && { id: r.id, createdAt: r.created_at, ...JSON.parse(r.data) };
    },
    listRounds(limit = 20) {
      return q.listRounds.all(limit).map(r => ({
        id: r.id, createdAt: r.created_at, brief: r.brief, mode: r.mode, ticker: r.ticker, call: r.call, conviction: r.conviction
      }));
    },
    saveOrder(o) {
      const id = randomUUID(), createdAt = new Date().toISOString();
      q.insOrder.run(id, o.roundId, createdAt, o.ticker, o.side, o.sizePct, o.leverage, o.entry, o.stop, o.target,
        o.avgPrice, JSON.stringify(o.fills), 'filled');
      return orderRow(q.orderByRound.get(o.roundId));
    },
    orderForRound: id => orderRow(q.orderByRound.get(id)),
    // sessions and code attempts (see server/auth.js)
    // one page load per code: the first /room load marks the session, a reload ends it
    markRoomOpened: hash => db.prepare('UPDATE sessions SET room_opened = 1 WHERE token_hash = ? AND room_opened = 0').run(hash).changes === 1,
    addSession: (hash, created, expires, ip) => db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at, ip) VALUES (?, ?, ?, ?)').run(hash, created, expires, ip),
    getSession: (hash, now) => db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(hash, now),
    dropSession: hash => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash),
    pruneSessions: now => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now),
    // graded calls (see server/engine/scoreboard.js)
    roundsWithoutOutcome: () => db.prepare(`SELECT r.id, r.created_at, r.data FROM rounds r LEFT JOIN outcomes o ON o.round_id = r.id
      WHERE o.round_id IS NULL ORDER BY r.created_at LIMIT 2000`).all().map(r => ({ id: r.id, createdAt: r.created_at, ...JSON.parse(r.data) })),
    saveOutcome: o => db.prepare('INSERT OR REPLACE INTO outcomes (round_id, evaluated_at, mode, ret, call, call_right, desks) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(o.roundId, o.evaluatedAt, o.mode, o.ret, o.call, o.callRight ? 1 : 0, JSON.stringify(o.desks)),
    listOutcomes: mode => db.prepare(`SELECT o.*, r.ticker FROM outcomes o JOIN rounds r ON r.id = o.round_id ${mode ? 'WHERE o.mode = ?' : ''} ORDER BY o.evaluated_at DESC`)
      .all(...(mode ? [mode] : [])).map(o => ({ roundId: o.round_id, evaluatedAt: o.evaluated_at, mode: o.mode, ret: o.ret, call: o.call, callRight: !!o.call_right, desks: JSON.parse(o.desks), ticker: o.ticker })),
    logAttempt: (ts, ip, result) => db.prepare('INSERT INTO auth_attempts (ts, ip, result) VALUES (?, ?, ?)').run(ts, ip, result),
    listOrders: (limit = 50) => q.listOrders.all(limit).map(orderRow),
    addWatch: (hash, symbol, now) => db.prepare('INSERT INTO watches (token_hash, symbol, created_at) VALUES (?, ?, ?)').run(hash, symbol, now),
    getWatch: hash => db.prepare('SELECT symbol, created_at FROM watches WHERE token_hash = ?').get(hash) || null,
    dropWatch: hash => db.prepare('DELETE FROM watches WHERE token_hash = ?').run(hash).changes > 0,
    close: () => db.close()
  };
}
