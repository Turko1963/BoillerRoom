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

/** Recent filings: [{ form, date, description }] newest first. */
export async function filings(cik) {
  const j = await sget(`https://data.sec.gov/submissions/CIK${cik}.json`, 6 * 3600e3);
  const r = j.filings?.recent;
  if (!r) return [];
  return r.form.map((form, i) => ({ form, date: r.filingDate[i], description: r.primaryDocDescription?.[i] || '' }));
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
