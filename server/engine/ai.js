// AI brains for the room: each desk becomes a model call that reads its own
// real data and gives its view, then one call writes the debate and one writes
// the Floor Manager's memo. The vote, the position size, the stop and the
// ticket stay in code (decide()), so the money maths never depends on a model.
//
// Any step that fails falls back to the rules version of that step, and the
// round records what happened in round.brain.
import * as claude from '../ai/claude.js';
import * as gemini from '../ai/gemini.js';
import { AG, RING, MODES, LAB } from './team.js';
import { clamp } from './random.js';
import { change } from './indicators.js';
import { eightK } from '../data/sec.js';

export const PROVIDERS = { claude, gemini };

/** For /api/health and the brain switch on the page. */
export function brains() {
  return [{ id: 'rules', label: 'Rules', ready: true, model: null },
    ...Object.values(PROVIDERS).map(p => ({ id: p.id, label: p.label, ready: p.ready(), model: p.ready() ? p.model() : null })),
    { id: 'both', label: 'Both', ready: PROVIDERS.claude.ready() && PROVIDERS.gemini.ready(), model: PROVIDERS.claude.ready() && PROVIDERS.gemini.ready() ? `${PROVIDERS.claude.model()} + ${PROVIDERS.gemini.model()}` : null }];
}

/** For the "Both" brain: debate and memo go to Claude, and to Gemini if Claude fails. */
function firstOf(ps) {
  return {
    id: 'both', label: ps.map(p => p.label).join(' + '), model: () => ps.map(p => p.model()).join(' + '),
    async ask(args) { let err; for (const p of ps) { try { return await p.ask(args); } catch (e) { err = Object.assign(e, { by: p }); } } throw err; },
    describe: e => (e.by || ps[0]).describe(e)
  };
}

/**
 * Two models' views of one desk: when they agree the room is more sure; when they disagree it
 * keeps the more confident view, lowers the confidence and records the dissent.
 */
function mergeViews(views, fallback) {
  if (views.length === 1) return { ...views[0].v, agree: null };
  const [a, b] = views, hi = a.v.conf >= b.v.conf ? a : b, lo = hi === a ? b : a, avg = (a.v.conf + b.v.conf) / 2;
  if (a.v.stance === b.v.stance) return { ...hi.v, conf: Math.min(95, Math.round(avg) + 5), agree: true };
  return { ...hi.v, conf: Math.max(35, Math.round(avg) - 10), findings: [hi.v.findings[0], hi.v.findings[1], `${lo.p.label} sees it ${LAB[lo.v.stance].toLowerCase()}: ${lo.v.headline}`], agree: false };
}

const JOBS = {
  analyst: 'You read the market around the asset: analyst ratings, news flow and sentiment, and how it trades against its benchmark.',
  filings: 'You read the official filings: whether reported profit is backed by cash, whether receivables or other balance sheet lines are drifting, and how recent the reports are.',
  fundamental: 'You work out what the asset is worth against its price: valuation, margins, returns on capital and debt.',
  technical: 'You read the chart: trend, moving averages, momentum (RSI), support and resistance, and volume on the moves.',
  ma: 'You look at the asset as a deal: takeover odds, activist stakes, merger filings, valuation against deal multiples and who could afford it.',
  risk: 'You own risk: volatility, how big the position can be, how much leverage it can carry and where the stop goes. Size, leverage and stop are already set by the risk model; judge whether the risk is acceptable.',
  dealer: 'You own execution: liquidity, how to slice the order and how much it will cost to get filled. The slice plan is already computed; judge whether execution is a problem.'
};

const DESK_SCHEMA = {
  type: 'object',
  properties: {
    stance: { type: 'string', enum: ['bull', 'neutral', 'bear'], description: 'bull = supports buying, bear = supports selling or shorting' },
    confidence: { type: 'integer', description: 'How sure you are, 35 to 95' },
    headline: { type: 'string', description: 'Your view in at most 12 words, no trailing period' },
    findings: { type: 'array', items: { type: 'string' }, description: 'Exactly 3 findings, each at most 20 words, each citing a number from the data' }
  },
  required: ['stance', 'confidence', 'headline', 'findings'],
  additionalProperties: false
};

const IDS = [...RING];
const DEBATE_SCHEMA = {
  type: 'object',
  properties: {
    exchanges: {
      type: 'array',
      description: '4 or 5 exchanges',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string', enum: IDS, description: 'desk asking' },
          to: { type: 'string', enum: IDS, description: 'desk answering' },
          lines: {
            type: 'array', description: '2 or 3 lines, starting with from, alternating',
            items: { type: 'object', properties: { speaker: { type: 'string', enum: IDS }, text: { type: 'string' } }, required: ['speaker', 'text'], additionalProperties: false }
          },
          change: {
            type: 'object', description: 'Who changed their mind because of this exchange; desk "none" if nobody did',
            properties: { desk: { type: 'string', enum: ['none', ...IDS] }, stance: { type: 'string', enum: ['bull', 'neutral', 'bear'] }, confidence: { type: 'integer' } },
            required: ['desk', 'stance', 'confidence'], additionalProperties: false
          }
        },
        required: ['from', 'to', 'lines', 'change'], additionalProperties: false
      }
    }
  },
  required: ['exchanges'],
  additionalProperties: false
};

const MEMO_SCHEMA = {
  type: 'object',
  properties: { why: { type: 'string', description: '2 to 4 plain sentences' } },
  required: ['why'], additionalProperties: false
};

const r1 = v => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const ctxLine = (x, mode) => `${x.kind === 'crypto' ? 'Coin' : 'Stock'}: ${x.symbol} (${x.name}), last price ${x.p}. Mode: ${MODES[mode].name}, holding period ${MODES[mode].hz}.`;

/** The data each desk is shown: what the rules desk measured, plus the raw inputs for its job. */
function deskData(id, x, rep) {
  const sm = x.summary || {}, d = { measured: rep.findings, tile: rep.metric };
  if (id === 'analyst') Object.assign(d, {
    analystRatings: sm.trend || null, recommendation: sm.recommendation || null,
    change1mPct: r1(change(x.closes, x.kind === 'crypto' ? 30 : 21)), benchmarkChange1mPct: x.bench?.length ? r1(change(x.bench, x.kind === 'crypto' ? 30 : 21)) : null,
    headlines: x.news.slice(0, 12).map(n => `${n.title} (${n.publisher || 'news'})`), newsSources: x.newsSources || null,
    coingeckoCommunityBullishPct: x.coingecko?.sentimentUp ?? null
  });
  if (id === 'filings') {
    // Official SEC annual figures first, with free cash flow worked out as operating cash flow minus capital spending.
    // Yahoo's free cash flow is a narrower "levered" estimate (Microsoft: $3bn against about $67bn), so it is only
    // used, and labelled as such, when a company has no SEC figures.
    const F = x.sec?.facts, ocf = F?.ocf?.[1], capex = F?.capex?.[1];
    Object.assign(d, {
      annualFigures: F || null,
      freeCashFlowLastYear: F && ocf != null ? { value: ocf - (capex ?? 0), source: 'SEC 10-K: operating cash flow minus capital spending', fiscalYearEnd: F.fy } : null,
      recentFilings: (x.sec?.filings || []).slice(0, 12).map(f => `${f.form} ${f.date}`),
      ...(F || x.kind !== 'stock' ? {} : { yahooEstimates: { leveredFreeCashFlowEstimate: sm.fcf, operatingCashFlow: sm.ocf, netIncome: sm.netIncome, note: 'Yahoo trailing estimates, not audited' } })
    });
  }
  if (id === 'fundamental') Object.assign(d, x.kind === 'stock'
    ? { sector: sm.sector, industry: sm.industry, marketCap: sm.marketCap, targetMean: sm.targetMean, targetLow: sm.targetLow, targetHigh: sm.targetHigh, analysts: sm.analysts, revenueGrowth: sm.revenueGrowth, operatingMargin: sm.operatingMargin, grossMargin: sm.grossMargin, returnOnEquity: sm.roe, debt: sm.debt, cash: sm.cash, ebitda: sm.ebitda, trailingPE: sm.pe, forwardPE: sm.forwardPe }
    : { oneYearHigh: Math.max(...x.closes.slice(-365)), oneYearLow: Math.min(...x.closes.slice(-365)) });
  if (x.coingecko && ['fundamental', 'filings', 'ma', 'dealer'].includes(id)) d.coingecko = x.coingecko;
  if (id === 'technical') d.last30Closes = x.closes.slice(-30).map(v => +v.toPrecision(6));
  if (id === 'ma') Object.assign(d, x.kind === 'stock' ? { evToEbitda: sm.evToEbitda, marketCap: sm.marketCap, institutionsPct: sm.institutions, insidersPct: sm.insiders, filingsLastYear: (x.sec?.filings || []).filter(f => f.date >= new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)).map(f => f.form).filter(f => !/^(4|4\/A|3|144|S-8|SC 13G.*|SCHEDULE 13G.*)$/.test(f)).slice(0, 25) } : {});
  // the second layer of sources, per desk (each may be null)
  const e = x.ext || {};
  const add = o => { for (const [k, v] of Object.entries(o)) if (v != null && !(Array.isArray(v) && !v.length)) d[k] = v; };
  if (id === 'analyst') add({ stocktwits: e.stocktwits, gdeltNewsTone7d: e.gdelt, cryptoFearGreed: e.fearGreed });
  if (id === 'filings') add({ insiderTradesForm4_90d: e.insider, yahooInsiderSummary6m: e.insights?.insider, institutions: e.insights && { pctHeld: e.insights.institutionsPct, count: e.insights.institutionCount, top: e.insights.holders }, eightKItems90d: x.sec?.filings ? eightK(x.sec.filings) : null });
  if (id === 'fundamental') add({ earningsLast4Quarters: e.insights?.earnings, estimateRevisionsThisYear: e.insights?.revisions, peers: e.peers, defiLlama: e.defi });
  if (id === 'technical') add({ weeklyLast20Closes: e.weekly?.slice(-20).map(k => +k.c.toPrecision(6)), sectorEtf: e.sector?.closes ? { etf: e.sector.etf, change3mPct: r1(change(e.sector.closes, 63)), stockChange3mPct: r1(change(x.closes, 63)) } : null, options: e.options, perpetualFutures: e.perp });
  if (id === 'ma') add({ secFullTextDealMentions90d: e.deals, dealHeadlines30d: e.dealNews?.map(h => `${h.title} (${h.publisher || 'news'})`), ftcEarlyTerminationNotices: e.ftc });
  if (id === 'risk') add({ vixCurve: e.vix, optionsImpliedVolPct: e.options?.atmIvPct, deribitDvol: e.dvol, binanceLongShare: e.perp?.longPct, correlationWithOurTickets: e.correlation });
  if (id === 'dealer') add({ binanceOrderBook: e.depth, marketsAcrossExchanges: e.markets, quote: e.insights?.quote, finraShortVolume: e.shortVol });
  return d;
}

const deskSystem = id => `You are the ${AG[id].name} on Boiler Room, a trading floor where seven analyst desks each study one side of a trade, debate, and vote.
${JOBS[id]}
Work only from the data you are given. Every finding must cite a number or fact from that data; never invent figures. If the data cannot support a view, say so and stay neutral with low confidence.
Write plainly, like a desk analyst talking to a portfolio manager. No financial advice disclaimers.`;

function cleanDesk(o, fallback) {
  const f = (Array.isArray(o.findings) ? o.findings : []).map(s => String(s).trim()).filter(Boolean).slice(0, 3);
  while (f.length < 3) f.push(fallback.findings[f.length]);
  return {
    stance: ['bull', 'neutral', 'bear'].includes(o.stance) ? o.stance : fallback.stance,
    conf: clamp(Math.round(+o.confidence || fallback.conf), 35, 95),
    headline: String(o.headline || fallback.headline).trim().replace(/\.$/, ''),
    findings: f
  };
}

function cleanPlan(o) {
  const out = [];
  for (const x of o.exchanges || []) {
    if (!IDS.includes(x.from) || !IDS.includes(x.to) || x.from === x.to) continue;
    const lines = (x.lines || []).filter(l => (l.speaker === x.from || l.speaker === x.to) && l.text?.trim()).slice(0, 3).map(l => [l.speaker, l.text.trim()]);
    if (lines.length < 2) continue;
    const c = x.change, effect = c && IDS.includes(c.desk) ? { desk: c.desk, stance: c.stance, conf: clamp(+c.confidence || 50, 35, 95) } : null;
    out.push({ a: x.from, b: x.to, lines, effect });
  }
  return out.slice(0, 5);
}

/**
 * Run the AI brain over the rules reports R (mutated in place with the AI views).
 * Returns { plan, finish(round) } — call finish() on the round from decide() to add the memo.
 */
export async function think({ brain, x, R, mode, brief }) {
  const PS = brain === 'both' ? [PROVIDERS.claude, PROVIDERS.gemini] : [PROVIDERS[brain]];
  const P = PS.length > 1 ? firstOf(PS) : PS[0];
  const meta = { id: brain, label: P.label, model: P.model(), steps: [], fallbacks: [], usage: { input: 0, output: 0 } };
  const add = u => { meta.usage.input += u?.input || 0; meta.usage.output += u?.output || 0; };
  const t0 = Date.now();

  // 1. seven desks in parallel
  const models = {};
  await Promise.all(RING.map(async id => {
    const rep = R[id], prompt = `${ctxLine(x, mode)}\nThe brief from the portfolio manager: "${brief.trim()}"\n\nYour data:\n${JSON.stringify(deskData(id, x, rep))}\n\nGive your view as JSON.`;
    const views = [];
    await Promise.all(PS.map(async p => {
      try {
        const res = await p.ask({ system: deskSystem(id), effort: 'low', schema: DESK_SCHEMA, prompt });
        add(res.usage); models[p.id] = res.model || p.model();
        views.push({ p, v: cleanDesk(res.data, rep) });
      } catch (e) { meta.lastError = p.describe(e); meta.fallbacks.push(`${AG[id].name}: ${meta.lastError}`); }
    }));
    if (!views.length) { rep.ai = false; return; }
    views.sort((a, b) => PS.indexOf(a.p) - PS.indexOf(b.p));
    const m = mergeViews(views, rep);
    Object.assign(rep, { stance: m.stance, conf: m.conf, headline: m.headline, findings: m.findings, ai: true, agree: m.agree });
    rep.work = [`Reading the data with ${views.map(v => v.p.label).join(' and ')}`, ...rep.work.slice(1, 3), 'Writing the view'];
  }));
  meta.model = PS.map(p => models[p.id] || p.model()).join(' + ');
  if (PS.length > 1) {
    const both = RING.filter(id => R[id].agree != null);
    meta.agreement = { both: both.length, agree: both.filter(id => R[id].agree).length };
  }
  if (RING.every(id => !R[id].ai)) throw Object.assign(new Error(meta.lastError || `${P.label} did not answer`), { source: 'ai', status: 502 });
  meta.steps.push(`7 desks in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 2. the debate
  let plan = null;
  const t1 = Date.now();
  try {
    const reports = RING.map(id => ({ desk: id, name: AG[id].name, voteWeight: MODES[mode].w[id], stance: R[id].stance, confidence: R[id].conf, headline: R[id].headline, findings: R[id].findings }));
    const res = await P.ask({
      effort: 'medium', schema: DEBATE_SCHEMA,
      system: `You script the debate on Boiler Room, a trading floor of seven analyst desks, before they vote. Desks challenge each other with the evidence in their reports.
Rules: 4 or 5 exchanges. Each exchange is 2 or 3 lines between two desks, starting with the asking desk and alternating. Each line is at most 30 words, spoken by the desk, addressing the other desk by short name (Analyst, Filings, Fundamental, Technical, M&A, Risk, Dealer).
Make the strongest bull and the strongest bear confront each other. Include Risk asking Technical where the trade is proven wrong. A desk changes its mind only if the other side's evidence really outweighs its own; record that in "change" with its new stance and confidence, otherwise desk "none".
Use only facts that appear in the reports.`,
      prompt: `${ctxLine(x, mode)}\nThe brief: "${brief.trim()}"\n\nThe seven reports:\n${JSON.stringify(reports)}\n\nWrite the debate as JSON.`
    });
    add(res.usage);
    plan = cleanPlan(res.data);
    if (!plan.length) { plan = null; meta.fallbacks.push('Debate: no usable exchanges, used the scripted debate'); }
  } catch (e) { meta.fallbacks.push(`Debate: ${P.describe(e)}, used the scripted debate`); }
  meta.steps.push(`debate in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  // 3. the Floor Manager's memo, once decide() has counted the votes
  const finish = async c => {
    const t2 = Date.now();
    try {
      const res = await P.ask({
        effort: 'medium', schema: MEMO_SCHEMA,
        system: `You are the Floor Manager on Boiler Room. The desks have reported, debated and voted, and the call is already made by the weighted vote. Explain the decision to the portfolio manager in 2 to 4 plain sentences: the call, the strongest argument for it, the main dissent or risk, and what would change your mind. Do not change the call or invent numbers.`,
        prompt: `${ctxLine(x, mode)}\nThe brief: "${brief.trim()}"\nCall: ${c.callLabel} at ${c.conv}% conviction. Votes: ${c.tally.bull} buy, ${c.tally.neutral} hold, ${c.tally.bear} ${c.sell}.\nTicket: ${JSON.stringify(c.ticket)}\nMarket backdrop and events (already reflected in size and thresholds): ${JSON.stringify(c.backdrop || null)}${meta.agreement ? `\nClaude and Gemini agreed on ${meta.agreement.agree} of the ${meta.agreement.both} desks they both read; say so in one short clause.` : ''}\nWhat the debate changed: ${JSON.stringify(c.changes)}\nFinal reports:\n${JSON.stringify(RING.map(id => ({ desk: AG[id].name, stance: LAB[c.R[id].stance], confidence: c.R[id].conf, headline: c.R[id].headline, findings: c.R[id].findings })))}\n\nWrite the memo as JSON.`
      });
      add(res.usage);
      if (res.data.why?.trim()) c.why = res.data.why.trim();
    } catch (e) { meta.fallbacks.push(`Memo: ${P.describe(e)}, used the standard memo`); }
    meta.steps.push(`memo in ${((Date.now() - t2) / 1000).toFixed(1)}s`);
    meta.seconds = +((Date.now() - t0) / 1000).toFixed(1);
    delete meta.lastError;
    c.brain = meta;
    return c;
  };
  return { plan, finish };
}
