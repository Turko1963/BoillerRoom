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
 * SEC full-text search: filings in the last 90 days, by anyone, whose text names the company next to deal
 * language. { total, filers: [names], forms: {form: n} } or null.
 */
export async function dealMentions(name) {
  const clean = String(name || '').replace(/,?\s+(inc|corp|corporation|ltd|plc|co|company|holdings|group)\.?$/i, '').replace(/"/g, '').trim();
  if (clean.length < 3) return null;
  const end = new Date(), start = new Date(Date.now() - 90 * 864e5), d = x => x.toISOString().slice(0, 10);
  // EDGAR full-text search has no OR or brackets: two quoted phrases mean both must appear
  const q = `"${clean}" "merger agreement"`;
  const formList = encodeURIComponent('8-K,SC 13D,SC TO-T,SC 14D9,DEFM14A,PREM14A,DEFA14A,S-4,425');
  const j = await sget(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&dateRange=custom&startdt=${d(start)}&enddt=${d(end)}&forms=${formList}`, 6 * 3600e3);
  const hits = j?.hits?.hits || [], forms = {}, filers = [];
  for (const h of hits) {
    const s = h._source || {};
    forms[s.form || s.root_form || '?'] = (forms[s.form || s.root_form || '?'] || 0) + 1;
    const who = (s.display_names || [])[0]?.replace(/\s*\(CIK.*$/, '');
    if (who && !filers.includes(who)) filers.push(who);
  }
  return { total: j?.hits?.total?.value ?? hits.length, filers: filers.slice(0, 5), forms };
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
