// FTC early termination notices (free; api.ftc.gov with the public DEMO_KEY, or FTC_API_KEY for higher limits).
// When two companies file a merger under the Hart-Scott-Rodino Act, the FTC can end the waiting period early and
// publishes a notice naming the acquiring and acquired parties. A recent notice naming a company means a deal is
// already in motion. The list is shared by every brief and fetched at most every 6 hours (DEMO_KEY allows few calls).
import { getJSON, memo, breaker } from './http.js';

const key = () => process.env.FTC_API_KEY || 'DEMO_KEY';

const notices = memo(breaker('FTC', async () => {
  const j = await getJSON(`https://api.ftc.gov/v0/hsr-early-termination-notices?api_key=${key()}`, { source: 'FTC', timeout: 15000 });
  return (j?.data || []).map(d => {
    const a = d.attributes || {};
    return { title: a.title || '', date: (a.date || a.created || a['early-termination-date'] || '').slice(0, 10), text: JSON.stringify(a).toLowerCase() };
  });
}), 6 * 3600e3);

/** Notices that name the company: { matches: [{title, date}], scanned } or null when the FTC list is unavailable. */
export async function mergerNotices(name) {
  const list = await notices();
  if (!list) return null;
  return { matches: matchNotices(list, name), scanned: list.length };
}

/** Notices whose text names the company (the first word of its name, at least 4 letters). Exported for tests. */
export function matchNotices(list, name) {
  const w = String(name || '').replace(/,?\s+(inc|corp|corporation|ltd|plc|co|company|holdings|group)\.?$/i, '').trim().toLowerCase();
  if (w.length < 4) return [];
  const re = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
  return list.filter(n => re.test(n.text)).map(({ title, date }) => ({ title, date })).slice(0, 5);
}
