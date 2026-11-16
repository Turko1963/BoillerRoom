// CFTC Commitments of Traders (free, no key; publicreporting.cftc.gov Socrata API): every Friday the CFTC publishes
// what large traders held on Tuesday. The disaggregated futures report splits out "managed money" (hedge funds).
// Contract codes: 067651 WTI crude (NYMEX), 088691 gold (COMEX), 023651 natural gas (NYMEX).
import { getJSON, memo } from './http.js';

/** Managed-money positions, newest first, about 3 years: [{date, long, short}] */
export const positions = memo(async code => {
  const url = `https://publicreporting.cftc.gov/resource/72hh-3qpy.json?$where=${encodeURIComponent(`cftc_contract_market_code='${code}'`)}&$order=${encodeURIComponent('report_date_as_yyyy_mm_dd DESC')}&$limit=160`;
  const rows = await getJSON(url, { source: 'CFTC', timeout: 15000 });
  return (rows || []).map(r => ({ date: String(r.report_date_as_yyyy_mm_dd || '').slice(0, 10), long: +r.m_money_positions_long_all, short: +r.m_money_positions_short_all }))
    .filter(r => r.date && isFinite(r.long) && isFinite(r.short));
}, 6 * 3600e3);
