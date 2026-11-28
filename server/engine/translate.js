// Hebrew rounds: the round is built in English (rules, data and AI desks alike), then its text is translated in one pass.
// Every sentence is cached by its hash, so the fixed phrases of the rules desks are translated once and reused.
// Only text changes: numbers, calls, stances, tickers and the shape of the round stay as they are, so the room animates a
// Hebrew round exactly like an English one. If no AI model is set up, or the call fails, the round stays in English and
// says why in `round.lang` / `round.langNote`.
import { createHash } from 'node:crypto';

// fields that are data, not words a person reads (or that the room translates itself)
const SKIP = new Set(['brief', 'tk', 'T', 'id', 'createdAt', 'asOf', 'mode', 'call', 'callLabel', 'stance', 'fmt', 'assetClass', 'currency', 'exchange',
  'symbol', 'sources', 'weights', 'learned', 'live', 'sell', 'name', 'brain', 'counterpart', 'benchName', 'tally', 'net', 'dir', 'lang', 'langNote', 'from', 'to', 'who', 'agent', 'a', 'b', 'modeName', 'side', 'id', 'assetClass']);
// desk ids sit next to the sentences in the debate ([id, text]): never translate them
const IDS = new Set(['analyst', 'filings', 'fundamental', 'technical', 'ma', 'risk', 'dealer', 'manager', 'bull', 'bear', 'neutral']);
const prose = s => typeof s === 'string' && !IDS.has(s) && /[A-Za-z]{2,}/.test(s) && s.length > 2 && !/^[A-Z0-9.^=-]{1,10}$/.test(s) && !/^https?:/.test(s);

/** Every string in the round a person reads: [{ get, set }] by path. */
export function textsOf(round) {
  const out = [];
  const walk = (o, key) => {
    if (Array.isArray(o)) { o.forEach((v, i) => (typeof v === 'string' ? prose(v) && out.push({ o, k: i, s: v }) : walk(v, key))); return; }
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (SKIP.has(k)) continue;
      if (typeof v === 'string') { if (prose(v)) out.push({ o, k, s: v }); } else walk(v, k);
    }
  };
  walk(round, null);
  return out;
}

export const GLOSSARY = `Desk names: Market Analyst = אנליסט שוק, Filings Specialist = מומחה דוחות, Fundamental Analyst = אנליסט פונדמנטלי, Technical Analyst = אנליסט טכני, M&A Specialist = מומחה מיזוגים ורכישות, Risk and Leverage = סיכון ומינוף, Dealer = דילר, Floor Manager = מנהל הרצפה; short forms Technical = הטכני, Fundamental = הפונדמנטלי, Analyst = האנליסט, Filings = הדוחות, Risk = הסיכון.
Terms: bullish = שורי, bearish = דובי, neutral = ניטרלי, buy = קנייה, short = שורט, sell = מכירה, hold = המתנה, stop = סטופ, target = יעד, entry = כניסה, position = פוזיציה, book = התיק, leverage = מינוף, slices = מנות, volatility = תנודתיות, moving average = ממוצע נע, 200 day average = ממוצע 200 יום, RSI = RSI, earnings = דוחות רבעוניים, guidance = תחזית, free cash flow = תזרים מזומנים חופשי, basis points = נקודות בסיס, market cap = שווי שוק, fair value = שווי הוגן, reward to risk = סיכוי לסיכון, conviction = ביטחון, sessions = ימי מסחר, base rate = שיעור בסיס, receivables = יתרת לקוחות, payables = יתרת ספקים, risk-off = מצב סיכון (risk-off), risk-on = תיאבון לסיכון (risk-on).`;

const SYSTEM = `You translate the text of a trading-room app from English into natural, fluent Israeli Hebrew, the way an Israeli market professional writes: short, clear and direct. Not word for word.
Keep exactly as written: every number, percentage, price and currency sign ($, ₪), tickers (NVDA, LUMI.TA), company and product names, and abbreviations such as RSI, ATR, EBITDA, SEC, ETF, VIX.
Keep the meaning, the tone and the length. A short label stays a short label. Do not add or drop information.
${GLOSSARY}
Return the translations in the same order as the input, one per item.`;

const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 32);

/**
 * Translate a round in place-safe way (returns a new object). ask: a provider's ask() (server/ai/*.js).
 * cache: { get(lang, hashes) -> Map(hash -> text), put(lang, [[hash, text]]) } (the store), or null.
 */
// chunks of 20 sentences run in parallel: a whole round in a few seconds instead of one long call
export async function translateRound(round, { lang = 'he', ask, cache = null, chunk = 20, log = () => {} } = {}) {
  if (lang === 'en') return round;
  const copy = structuredClone(round), items = textsOf(copy);
  const uniq = [...new Set(items.map(x => x.s))], hashes = uniq.map(sha);
  const known = cache ? cache.get(lang, hashes) : new Map();
  const todo = uniq.filter((s, i) => !known.has(hashes[i]));
  if (todo.length) {
    if (!ask) return { ...round, lang: 'en', langNote: 'Hebrew needs an AI model on the server (ANTHROPIC_API_KEY or GEMINI_API_KEY)' };
    const schema = { type: 'object', properties: { t: { type: 'array', items: { type: 'string' } } }, required: ['t'], additionalProperties: false };
    const parts = [];
    for (let i = 0; i < todo.length; i += chunk) parts.push(todo.slice(i, i + chunk));
    try {
      const done = await Promise.all(parts.map(async p => {
        const res = await ask({ system: SYSTEM, effort: 'low', schema, prompt: `Translate these ${p.length} items into Hebrew. Return {"t": [...]} with exactly ${p.length} strings.\n${JSON.stringify(p)}` });
        const t = res?.data?.t;
        if (!Array.isArray(t) || t.length !== p.length) throw new Error(`the translation came back with ${t?.length ?? 0} of ${p.length} items`);
        return p.map((s, i) => [s, String(t[i])]);
      }));
      const fresh = done.flat();
      for (const [s, t] of fresh) known.set(sha(s), t);
      cache?.put(lang, fresh.map(([s, t]) => [sha(s), t]));
    } catch (e) {
      log(`[translate] ${e.message}`);
      return { ...round, lang: 'en', langNote: `The Hebrew translation failed this time (${e.message}); the round is in English` };
    }
  }
  for (const x of items) { const t = known.get(sha(x.s)); if (t) x.o[x.k] = t; }
  return { ...copy, lang };
}
