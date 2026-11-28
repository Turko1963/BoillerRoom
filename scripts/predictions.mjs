// The prediction log, from the server's terminal (run in the app folder):
//   npm run predictions -- list [n]                                  the latest n decisions (default 50), read only
//   npm run predictions -- exclude <roundId> "<reason>" "<evidence>" take a decision out of the edge figures and the weight
//                                                                    training (an acceptance check, not a real decision)
//   npm run predictions -- annotations                               every annotation, read only
// The log itself is never changed: an exclusion is a separate, append-only annotation (table prediction_annotations).
import { openStore } from '../server/store/db.js';

const store = openStore(process.env.DB_PATH || 'data/boilerroom.db');
const [cmd, a, b, c] = process.argv.slice(2);
try {
  if (cmd === 'list') {
    const ex = store.excludedIds(), rows = store.listPredictions(Math.min(500, +a || 50));
    for (const p of rows) {
      const full = store.predictionFor(p.round_id), r = store.getRound(p.round_id);
      console.log([p.id, p.round_id, p.created_at, r?.tk || full?.input?.ticker || '', `"${(r?.brief || full?.input?.brief || '').trim()}"`, full?.input?.brain || '', full?.input?.member || '-', full?.output?.direction || '', ex.has(p.round_id) ? 'EXCLUDED' : ''].join(' | '));
    }
    // rounds saved before the prediction log existed: listed too (they can be graded)
    const logged = new Set(store.predictionRows().map(p => p.round_id)), older = store.listRounds(Math.min(500, +a || 50)).filter(r => !logged.has(r.id));
    for (const s of older) { const r = store.getRound(s.id); console.log(['-', r.id, r.createdAt, r.tk || '', `"${(r.brief || '').trim()}"`, r.brain?.id || 'rules', '(not in the log)', r.direction || r.call || '', ex.has(r.id) ? 'EXCLUDED' : ''].join(' | ')); }
    console.log(`${rows.length} shown. Chain: ${JSON.stringify((await import('../server/engine/predictions.js')).verifyChain(store.predictionRows()))}`);
  } else if (cmd === 'exclude') {
    if (!a || !b) throw new Error('usage: exclude <roundId> "<reason>" "<evidence>"');
    if (!store.getRound(a)) throw new Error(`No round ${a}`); // a round from before the log existed can be graded too
    if (store.excludedIds().has(a)) throw new Error(`Round ${a} is already excluded`);
    const id = store.annotate(a, 'exclude', b, c || null, 'admin (terminal)');
    console.log(`Annotation ${id}: round ${a} excluded from the edge figures and the weight training. The prediction is unchanged.`);
  } else if (cmd === 'annotations') {
    for (const x of store.annotations()) console.log([x.id, x.roundId, x.kind, x.createdAt, x.reason, x.evidence || ''].join(' | '));
  } else {
    console.log('usage: list [n] | exclude <roundId> "<reason>" "<evidence>" | annotations');
  }
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { store.close(); }
