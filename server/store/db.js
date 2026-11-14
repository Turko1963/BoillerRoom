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
  `);

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
    listOrders: (limit = 50) => q.listOrders.all(limit).map(orderRow),
    close: () => db.close()
  };
}
