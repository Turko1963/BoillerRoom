// SEC EDGAR (free, no key): official US company filings.
// SEC asks every client to declare who it is in the User-Agent, with a contact
// email. Set SEC_USER_AGENT, for example "BoilerRoom you@yourdomain.com".
import { getJSON, memo, SourceError } from './http.js';

const ua = () => process.env.SEC_USER_AGENT || 'BoilerRoom research app admin@boilerroom.local';
const sget = (url, ttl) => getJSON(url, { source: 'SEC EDGAR', ttl, headers: { 'User-Agent': ua(), Accept: 'application/json' }, timeout: 20000 });

/** ticker -> { cik, name } for every SEC filer. Cached for a day. */
const tickerMap = memo(async () => {
  const j = await sget('https://www.sec.gov/files/company_tickers.json', 0);
  const m = new Map();
  for (const v of Object.values(j)) m.set(v.ticker.toUpperCase(), { cik: String(v.cik_str).padStart(10, '0'), name: v.title });
  return m;
}, 24 * 3600e3);

export async function lookup(ticker) {
  return (await tickerMap()).get(ticker.toUpperCase().replace('.', '-')) || null;
}

/** Recent filings: [{ form, date, description, items (8-K item codes), accession, doc }] newest first. */
export async function filings(cik) {
  const j = await sget(`https://data.sec.gov/submissions/CIK${cik}.json`, 6 * 3600e3);
  const r = j.filings?.recent;
  if (!r) return [];
  return r.form.map((form, i) => ({ form, date: r.filingDate[i], description: r.primaryDocDescription?.[i] || '', items: r.items?.[i] || '', accession: r.accessionNumber?.[i] || '', doc: r.primaryDocument?.[i] || '' }));
}

// 8-K items that matter to an investor (the SEC's item numbers)
export const ITEMS_8K = {
  '1.01': 'material agreement', '1.02': 'agreement ended', '1.03': 'bankruptcy', '2.01': 'acquisition or sale completed', '2.05': 'restructuring costs',
  '2.06': 'impairment', '3.01': 'delisting notice', '4.01': 'auditor change', '4.02': 'past results no longer reliable', '5.01': 'change of control',
  '5.02': 'executive or director change', '7.01': 'Regulation FD disclosure', '8.01': 'other event', '2.02': 'results'
};
const RED = new Set(['1.03', '3.01', '4.01', '4.02', '2.06']);

/** 8-K item counts over 90 days: { count, items: {code: n}, red: [{code, label, date}] } from the filing list. */
export function eightK(list, days = 90) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10), items = {}, red = [];
  const recent = (list || []).filter(f => /^8-K/.test(f.form) && f.date >= since);
  for (const f of recent) for (const code of String(f.items || '').split(',').map(s => s.trim()).filter(Boolean)) {
    items[code] = (items[code] || 0) + 1;
    if (RED.has(code)) red.push({ code, label: ITEMS_8K[code], date: f.date });
  }
  return { count: recent.length, items, red };
}

/**
 * Insider trades from the latest Form 4 filings (read from the XML itself): open-market buys (code P)
 * and sales (code S) in the last 90 days. { filings, buys, sells, buyValue, sellValue, buyers: [names] }
 */
export async function insiderTrades(cik, list, max = 10) {
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const f4 = (list || []).filter(f => f.form === '4' && f.date >= since && f.accession && f.doc).slice(0, max);
  const out = { filings: f4.length, buys: 0, sells: 0, buyValue: 0, sellValue: 0, buyers: [] };
  const docs = await Promise.all(f4.map(f => {
    const url = `https://www.sec.gov/Archives/edgar/data/${+cik}/${f.accession.replace(/-/g, '')}/${f.doc.split('/').pop()}`;
    return fetch(url, { headers: { 'User-Agent': ua() }, signal: AbortSignal.timeout(15000) }).then(r => (r.ok ? r.text() : ''), () => '');
  }));
  for (const xml of docs) {
    const t = parseForm4(xml);
    out.buys += t.buys; out.sells += t.sells; out.buyValue += t.buyValue; out.sellValue += t.sellValue;
    if (t.buys && t.owner && !out.buyers.includes(t.owner)) out.buyers.push(t.owner);
  }
  return out;
}

/** Open-market buys and sales in one Form 4 XML. Exported for tests. */
export function parseForm4(xml) {
  const v = (s, t) => s.match(new RegExp(`<${t}>\\s*(?:<value>)?\\s*([^<]*)`, 'i'))?.[1]?.trim() || '';
  const r = { owner: v(xml, 'rptOwnerName'), buys: 0, sells: 0, buyValue: 0, sellValue: 0 };
  for (const [tx] of xml.matchAll(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/gi)) {
    const code = v(tx, 'transactionCode'), sh = +v(tx, 'transactionShares') || 0, px = +v(tx, 'transactionPricePerShare') || 0;
    if (code === 'P') { r.buys++; r.buyValue += sh * px; } else if (code === 'S') { r.sells++; r.sellValue += sh * px; }
  }
  return r;
}

/**
 * SEC full-text search: deal filings in the last 90 days that name the company next to "merger agreement" AND list
 * it as a party (filer or subject company). Other companies' deals that merely mention it (a SPAC naming Nvidia as
 * a partner) are counted apart as `mentions`. { total, filers: [names], forms: {form: n}, mentions } or null.
 */
export async function dealMentions(name, cik) {
  const clean = String(name || '').replace(/,?\s+(inc|corp|corporation|ltd|plc|co|company|holdings|group)\.?$/i, '').replace(/"/g, '').trim();
  if (clean.length < 3) return null;
  const end = new Date(), start = new Date(Date.now() - 90 * 864e5), d = x => x.toISOString().slice(0, 10);
  // EDGAR full-text search has no OR or brackets: two quoted phrases mean both must appear
  const q = `"${clean}" "merger agreement"`;
  const formList = encodeURIComponent('8-K,SC 13D,SC TO-T,SC 14D9,DEFM14A,PREM14A,DEFA14A,S-4,425');
  const j = await sget(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&dateRange=custom&startdt=${d(start)}&enddt=${d(end)}&forms=${formList}`, 6 * 3600e3);
  const all = j?.hits?.hits || [], forms = {}, filers = [], id = cik ? String(cik).padStart(10, '0') : null;
  // without a CIK we cannot tell a party from a bystander, so count nothing
  const hits = id ? all.filter(h => (h._source?.ciks || []).includes(id)) : [];
  for (const h of hits) {
    const s = h._source || {};
    forms[s.form || s.root_form || '?'] = (forms[s.form || s.root_form || '?'] || 0) + 1;
    const who = (s.display_names || [])[0]?.replace(/\s*\(CIK.*$/, '');
    if (who && !filers.includes(who)) filers.push(who);
  }
  return { total: hits.length, filers: filers.slice(0, 5), forms, mentions: all.length - hits.length };
}

// XBRL concepts, first one that exists wins (companies use different tags).
const TAGS = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  receivables: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent']
};

/**
 * Last two fiscal years of the figures the Filings desk needs, from 10-K data.
 * Returns { fy, revenue:[prev,last], netIncome:[...], ocf, capex, receivables } (values may be null).
 */
export async function annualFacts(cik) {
  let j;
  try { j = await sget(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, 12 * 3600e3); } catch (e) {
    if (e.status === 404) return null; // filer without XBRL facts
    throw e;
  }
  const g = j.facts?.['us-gaap'] || {};
  // end date -> full-year value from annual reports, merged across all tags for a concept
  // (companies switch tags over the years, so the latest year may sit under a different tag)
  const series = concept => {
    const byEnd = new Map();
    for (const t of TAGS[concept]) {
      for (const x of g[t]?.units?.USD || []) {
        if (!/^10-K/.test(x.form)) continue;
        if (x.start && (new Date(x.end) - new Date(x.start)) / 864e5 < 330) continue; // skip quarters
        if (!byEnd.has(x.end)) byEnd.set(x.end, x.val);
      }
    }
    return byEnd;
  };
  const S = Object.fromEntries(Object.keys(TAGS).map(k => [k, series(k)]));
  // fiscal years = year ends where both revenue and net income are reported
  const years = [...S.netIncome.keys()].filter(e => S.revenue.has(e)).sort();
  if (!years.length) return null;
  const [prev, last] = [years.at(-2) ?? null, years.at(-1)];
  const out = { fy: last };
  for (const k of Object.keys(TAGS)) out[k] = [prev ? S[k].get(prev) ?? null : null, S[k].get(last) ?? null];
  return out;
}

export { SourceError };

/* ---------- the words, not just the numbers: for the AI brains ---------- */
const getText = memo(async url => {
  const r = await fetch(url, { headers: { 'User-Agent': ua() }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new SourceError('SEC EDGAR', `HTTP ${r.status}`, r.status);
  return htmlText(await r.text());
}, 24 * 3600e3);
const docUrl = (cik, f, name = f.doc) => `https://www.sec.gov/Archives/edgar/data/${+cik}/${f.accession.replace(/-/g, '')}/${String(name).split('/').pop()}`;

/** Plain text from a filing's HTML. Exported for tests. */
export function htmlText(html) {
  return String(html).replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&#8212;|&mdash;/g, '—').replace(/&#\d+;/g, ' ').replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}
/** The "Item 1A. Risk Factors" section of a 10-K: the longest stretch between the heading and Item 1B / Item 2. */
export function riskSection(text) {
  let best = '';
  // headings sit at the start of a line; "see Item 1A. Risk Factors" inside the Business section must not count
  for (const m of text.matchAll(/(?:^|\n)\s*item\s*1a\.?\s*[—:-]?\s*risk\s+factors\s*(?=\n)/gi)) {
    const rest = text.slice(m.index + m[0].length), end = rest.search(/\n\s*item\s*1b\.?\s*[—:-]?\s*unresolved|\n\s*item\s*1c\.?\s*[—:-]?\s*cybersecurity|\n\s*item\s*2\.?\s*[—:-]?\s*properties/i);
    const sec = end > 0 ? rest.slice(0, end) : '';
    if (sec.length > best.length) best = sec;
  }
  return best;
}
const sentences = t => t.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(s => s.length >= 60 && s.length <= 600);
const key = s => s.toLowerCase().replace(/[^a-z ]+/g, '').replace(/\s+/g, ' ').trim();
const words = s => new Set(key(s).split(' ').filter(w => w.length > 3));
const like = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.max(1, Math.min(a.size, b.size)); };
/**
 * Sentences in this year's risk factors that were not there last year, and how many were dropped. A sentence counts as
 * new only when no sentence of last year shares 70% of its words, so rewording is not a change. Exported for tests.
 */
export function riskDiff(now, before) {
  const was = sentences(before).map(words), is = sentences(now), isW = is.map(words);
  const fresh = (w, pool) => !pool.some(p => like(w, p) >= 0.7);
  const added = is.filter((s, i) => fresh(isW[i], was));
  return { added: added.slice(0, 12), addedCount: added.length, removedCount: was.filter(w => fresh(w, isW)).length, sentences: is.length };
}

/** What is new in the risk factors of the latest 10-K against the one before. null when there are not two 10-Ks. */
export async function riskChanges(cik, list) {
  const ks = (list || []).filter(f => f.form === '10-K' && f.accession && f.doc).slice(0, 2);
  if (ks.length < 2) return null;
  const [a, b] = await Promise.all(ks.map(f => getText(docUrl(cik, f))));
  const now = riskSection(a), before = riskSection(b);
  if (now.length < 2000 || before.length < 2000) return null;
  return { latest: ks[0].date, previous: ks[1].date, ...riskDiff(now, before) };
}

/** The latest earnings press release (8-K item 2.02, exhibit 99.1), as text: { date, text } or null. */
export async function earningsRelease(cik, list) {
  const f = (list || []).find(x => /^8-K/.test(x.form) && /2\.02/.test(x.items || '') && x.accession);
  if (!f) return null;
  const idx = await sget(`https://www.sec.gov/Archives/edgar/data/${+cik}/${f.accession.replace(/-/g, '')}/index.json`, 24 * 3600e3);
  const docs = (idx?.directory?.item || []).filter(i => /\.html?$/i.test(i.name) && !/index/i.test(i.name) && i.name !== String(f.doc).split('/').pop());
  // companies name it ex99-1.htm, ex991.htm... or after the quarter (NVIDIA: q3fy27pr.htm): fall back to the largest one
  const ex = docs.find(i => /ex-?99(\.|_|-)?0?1|ex99|exhibit99|pr\.htm/i.test(i.name))?.name || docs.sort((a, b) => (+b.size || 0) - (+a.size || 0))[0]?.name;
  if (!ex) return null;
  const text = await getText(docUrl(cik, f, ex));
  return { date: f.date, text: text.slice(0, 7000) };
}
