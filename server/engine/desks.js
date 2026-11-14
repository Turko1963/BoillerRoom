// The seven desks, each doing its own job on real data.
//
// Every desk gets a context `x` with what has already been fetched:
//   x.kind      'stock' | 'crypto'
//   x.symbol    display ticker (NVDA, BTC)
//   x.p         last price
//   x.candles   ~1 year of daily candles [{t,o,h,l,c,v}]
//   x.closes    their closes
//   x.summary   Yahoo company figures (stocks, may be null)
//   x.sec       { cik, facts, filings } from SEC EDGAR (US stocks, may be null)
//   x.news      latest headlines (may be [])
//   x.bench     benchmark closes (S&P 500 for stocks, Bitcoin for crypto)
//   x.cryptoRank, x.quoteVolume24h (crypto)
//   x.mode      'trader' | 'investor'
//
// and returns a report:
//   { score (-1..1), conf (35..95), headline, findings[3], metric {v, fmt, sub},
//     work[4] (what the desk is doing, shown while it works), sources[], ann? {price,label} }
// Risk and Dealer also return numbers the ticket needs.
import { clamp, usd } from './random.js';
import { sma, rsi, realizedVol, change, upDownVolume, money, count, mean } from './indicators.js';
import { regimeLine, eventLine, labelFor } from './regime.js';

const pct = (v, d = 0) => { const t = (+v.toFixed(d) || 0).toFixed(d); return (+t > 0 ? '+' : '') + t + '%'; };
const abs = (v, d = 1) => Math.abs(v).toFixed(d);
const confOf = (score, quality = 1) => Math.round(clamp(52 + Math.abs(score) * 40, 40, 93) * quality + 40 * (1 - quality));
const pick = (s, bull, neutral, bear) => (s > 0.2 ? bull : s < -0.2 ? bear : neutral);
const cut = (t, n = 86) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

/* ---------- news tone: a small finance word list, enough to read the mood ---------- */
const POS = /\b(beat|beats|surge|surges|soar|soars|rally|rallies|upgrade|upgraded|record|growth|gain|gains|jump|jumps|rise|rises|rising|strong|raise|raises|raised|outperform|bullish|wins|win|approval|approved|boost|boosts|top|tops|higher|buy|breakout|partnership|expands)\b/i;
const NEG = /\b(miss|misses|plunge|plunges|fall|falls|drop|drops|downgrade|downgraded|cut|cuts|lawsuit|probe|weak|slump|slumps|sell|selloff|loss|losses|bearish|warn|warns|warning|recall|decline|declines|tumble|tumbles|crash|fraud|lower|halt|delay|delays|layoffs|investigation|hack|exploit|ban)\b/i;
export function newsTone(news) {
  if (!news.length) return { s: 0, n: 0 };
  let t = 0;
  for (const h of news) t += (POS.test(h.title) ? 1 : 0) - (NEG.test(h.title) ? 1 : 0);
  return { s: clamp(t / Math.max(3, news.length * 0.6), -1, 1), n: news.length };
}

/* ================= Market Analyst: what the market thinks ================= */
export function analyst(x) {
  const tone = newsTone(x.news), r1m = change(x.closes, x.kind === 'crypto' ? 30 : 21);
  const b1m = x.bench?.length ? change(x.bench, x.kind === 'crypto' ? 30 : 21) : 0;
  const benchName = x.kind === 'crypto' ? 'Bitcoin' : 'the S&P 500';
  const rel = x.symbol === 'BTC' ? r1m : r1m - b1m;
  const parts = [[clamp(rel / 12, -1, 1), 0.35], [tone.s, 0.2]];
  const f = [];
  if (x.kind === 'stock') {
    const t = x.summary?.trend, tot = t ? t.strongBuy + t.buy + t.hold + t.sell + t.strongSell : 0;
    if (tot) {
      parts.push([(2 * t.strongBuy + t.buy - t.sell - 2 * t.strongSell) / (2 * tot), 0.45]);
      f.push(`${t.strongBuy + t.buy} of ${tot} analysts rate it a buy, ${t.sell + t.strongSell} a sell`);
    } else f.push('No analyst ratings available');
  } else {
    const last7 = x.candles.slice(-7), qv = last7.reduce((a, k) => a + (k.qv || 0), 0), buy = last7.reduce((a, k) => a + (k.takerBuyQv || 0), 0);
    const share = qv ? buy / qv : 0.5;
    parts.push([clamp((share - 0.5) * 12, -1, 1), 0.45]);
    const up = x.coingecko?.sentimentUp;
    if (up != null) parts.push([clamp((up - 50) / 25, -1, 1), 0.15]);
    f.push(`Buyers took ${(share * 100).toFixed(1)}% of Binance volume this week${up != null ? `; ${Math.round(up)}% of CoinGecko voters are bullish` : ''}`);
  }
  const w = parts.reduce((a, p) => a + p[1], 0), s = clamp(parts.reduce((a, p) => a + p[0] * p[1], 0) / w, -1, 1);
  f.push(x.symbol === 'BTC' ? `${r1m >= 0 ? 'Up' : 'Down'} ${abs(r1m)}% over the last month`
    : `${r1m >= 0 ? 'Up' : 'Down'} ${abs(r1m)}% over a month against ${pct(b1m, 1)} for ${benchName}`);
  const sf = x.summary?.shortFloat;
  if (sf != null && sf >= 0.1) f.push(`Short interest ${(sf * 100).toFixed(0)}% of the float: crowded bets against it can squeeze`);
  else f.push(x.news[0] ? `${x.news[0].publisher || 'Latest'}: “${cut(x.news[0].title, 76)}”` : 'No fresh headlines');
  const S = Math.round(50 + 50 * s);
  return {
    score: s, conf: confOf(s, x.news.length ? 1 : 0.8),
    headline: pick(s, 'Analysts and the tape both lean positive', 'Mixed read, no clear narrative yet', 'Sentiment is turning against it'),
    findings: f, metric: { v: S, fmt: 'int', sub: 'out of 100' },
    work: [x.kind === 'stock' ? 'Pulling analyst ratings' : 'Reading taker buy and sell flow', `Reading ${tone.n} headlines from ${Object.keys(x.newsSources || {}).length || 1} sources`, `Comparing with ${benchName}`, 'Scoring sentiment'],
    sources: [...(x.kind === 'stock' ? ['Yahoo Finance ratings'] : ['Binance volume', ...(x.coingecko ? ['CoinGecko community votes'] : [])]), ...Object.keys(x.newsSources || {}).length ? Object.keys(x.newsSources) : ['Yahoo Finance news'], 'Price history']
  };
}

/* ================= Filings Specialist: can we trust the numbers ================= */
export function filings(x) {
  const cg = x.coingecko;
  if (x.kind === 'crypto' && cg && cg.circulating && (cg.max || cg.total)) {
    // a token has no accounts, but its supply schedule is the closest thing: how much is still to come?
    const cap = cg.max || cg.total, float = Math.min(1, cg.circulating / cap), dil = cg.fdv && cg.marketCap ? cg.fdv / cg.marketCap - 1 : null;
    let sc = float >= 0.9 ? 0.4 : float >= 0.7 ? 0.1 : float >= 0.5 ? -0.2 : -0.55;
    if (!cg.max) sc -= 0.15;
    if (dil != null && dil > 0.3) sc -= 0.15;
    sc = clamp(sc, -1, 1);
    return {
      score: sc, conf: confOf(sc, 0.85),
      headline: pick(sc, 'Most of the supply is already out', 'Some dilution still to come', 'A lot of supply is still to be released'),
      findings: [
        `${Math.round(float * 100)}% of supply is circulating (${count(cg.circulating)} of ${count(cap)})`,
        cg.max ? `Hard cap of ${count(cg.max)} coins` : 'No maximum supply: new coins can keep being issued',
        dil != null ? `Fully diluted value ${money(cg.fdv)}, ${Math.round(dil * 100)}% above today's ${money(cg.marketCap)} market cap` : `Market cap ${money(cg.marketCap || 0)}`
      ],
      metric: { v: float * 100, fmt: 'pct', sub: 'of supply circulating' },
      work: ['Reading the token supply', 'Checking the hard cap', 'Measuring dilution still to come', 'Noting what is unaudited'], sources: ['CoinGecko supply data']
    };
  }
  if (x.kind === 'crypto') return {
    score: 0, conf: 40, headline: 'No audited accounts to read for a token',
    findings: ['Tokens do not file annual or quarterly reports', `Only exchange data: ${money(x.quoteVolume24h || 0)} traded on Binance in 24 hours`, 'Treat every number as unaudited'],
    metric: { v: 'n/a', fmt: 'text', sub: 'no filings for tokens' },
    work: ['Searching for audited reports', 'Checking exchange disclosures', 'Reading token documentation', 'Noting what is missing'], sources: ['Binance']
  };
  const F = x.sec?.facts, sm = x.summary || {};
  const ni = F?.netIncome?.[1] ?? sm.netIncome, ocf = F?.ocf?.[1] ?? sm.ocf, capex = F?.capex?.[1] ?? 0;
  const fcf = F ? (ocf ?? 0) - (capex ?? 0) : sm.fcf;
  const lastReport = x.sec?.filings?.find(f => /^10-[KQ]$/.test(f.form) || /^20-F|^40-F/.test(f.form));
  const f = [];
  let s = 0, metric;
  if (ni == null || fcf == null) {
    return {
      score: 0, conf: 38, headline: 'Not enough reported figures to judge earnings quality',
      findings: ['No annual cash flow figures found', lastReport ? `Latest report: ${lastReport.form} filed ${lastReport.date}` : 'No recent reports on SEC EDGAR', 'Foreign filers report outside these feeds'],
      metric: { v: 'n/a', fmt: 'text', sub: 'figures not found' },
      work: ['Looking the company up on SEC EDGAR', 'Opening the annual report figures', 'Looking for cash flow data', 'Noting what is missing'], sources: ['SEC EDGAR', 'Yahoo Finance']
    };
  }
  if (ni <= 0) {
    s = fcf > 0 ? -0.1 : -0.55;
    f.push(`Net ${money(ni)} loss last year, free cash flow ${money(fcf)}`);
    metric = { v: 'Loss', fmt: 'text', sub: fcf > 0 ? 'but cash positive' : 'and burning cash' };
  } else {
    const cc = fcf / ni * 100;
    s = cc >= 95 ? 0.6 : cc >= 80 ? 0.15 : cc >= 60 ? -0.25 : -0.6;
    f.push(cc >= 80 ? `Free cash flow is ${cc.toFixed(0)}% of net income` : `Only ${cc.toFixed(0)}% of net income converts to free cash`);
    metric = { v: cc, fmt: 'pct', sub: 'of profit is cash' };
  }
  const [r0, r1] = F?.revenue || [], [a0, a1] = F?.receivables || [];
  if (r0 && r1 && a0 && a1) {
    const rg = (r1 / r0 - 1) * 100, ag = (a1 / a0 - 1) * 100, gap = ag - rg;
    if (gap > 10) s -= 0.35; else if (gap < 0) s += 0.15;
    f.push(gap > 10 ? `Receivables grew ${Math.round(ag) || 0}% against ${Math.round(rg) || 0}% revenue growth`
      : `Receivables ${pct(ag)} against revenue ${pct(rg)}: in step`);
  } else f.push('Receivables trend not available');
  f.push(lastReport ? `Latest report: ${lastReport.form} filed ${lastReport.date}` : 'Figures from Yahoo Finance; no SEC filings found');
  s = clamp(s, -1, 1);
  return {
    score: s, conf: confOf(s, F ? 1 : 0.75),
    headline: pick(s, 'Clean numbers, cash backs the earnings', 'Nothing alarming, a few lines to watch', 'Earnings quality is slipping'),
    findings: f, metric,
    work: ['Looking the company up on SEC EDGAR', `Reading the ${F?.fy ? F.fy.slice(0, 4) + ' ' : ''}annual report figures`, 'Comparing receivables with revenue', 'Checking the latest filings'],
    sources: F ? ['SEC EDGAR (10-K figures)', 'SEC EDGAR (filing list)'] : ['Yahoo Finance figures']
  };
}

/* ================= Fundamental Analyst: what is it worth ================= */
export function fundamental(x) {
  const p = x.p, f = [];
  if (x.kind === 'crypto') {
    const yr = x.closes.slice(-365), avg = mean(yr), hi = Math.max(...yr), lo = Math.min(...yr), d = p / avg - 1;
    const cg = x.coingecko, ath = cg?.athChangePct;
    // cheap or dear against its own year, nudged by how far it sits from its all-time high and how big it is
    const s = clamp(clamp(-d / 0.45, -1, 1) * (cg ? 0.55 : 0.75) + (ath == null ? 0 : ath < -60 ? 0.2 : ath > -15 ? -0.2 : 0) + (cg?.rank ? (cg.rank <= 20 ? 0.05 : cg.rank > 200 ? -0.1 : 0) : 0), -1, 1);
    return {
      score: s, conf: confOf(s, cg ? 0.85 : 0.75), ann: { price: avg, label: '1 year average' },
      headline: pick(s, 'Cheap against its own history', 'Near its 1 year average', 'Expensive against its own history'),
      findings: cg && cg.ath ? [`Market cap ${money(cg.marketCap || 0)}, rank #${cg.rank || '?'} on CoinGecko`, `${abs(ath, 0)}% below its all-time high of ${usd(cg.ath)}${cg.athDate ? ` (${cg.athDate.slice(0, 7)})` : ''}`, `1 year average ${usd(avg)} against ${usd(p)} now`]
        : [`1 year average ${usd(avg)} against ${usd(p)} now`, `${abs((1 - p / hi) * 100, 0)}% below its 1 year high of ${usd(hi)}`, `${abs((p / lo - 1) * 100, 0)}% above its 1 year low of ${usd(lo)}`],
      metric: { v: avg, fmt: 'usd', sub: `${pct(-d * 100)} to its 1y average` },
      work: ['Loading a year of prices', 'Reading market cap and rank', 'Measuring the distance from the all-time high', 'Setting a reference value'], sources: cg ? ['CoinGecko market data', 'Binance price history'] : ['Binance price history']
    };
  }
  const sm = x.summary || {};
  let fv = sm.targetMean, s = 0;
  if (fv) {
    const up = fv / p - 1;
    s = clamp(up / 0.25, -1, 1) * 0.6;
    f.push(`Analyst target ${usd(fv)} against ${usd(p)} last${sm.analysts ? ` (${sm.analysts} analysts)` : ''}`);
  } else { fv = p; f.push('No analyst price target, valued at the last price'); }
  if (sm.operatingMargin != null) {
    s += sm.operatingMargin > 0.2 ? 0.2 : sm.operatingMargin < 0.05 ? -0.2 : 0;
    f.push(`Operating margin ${(sm.operatingMargin * 100).toFixed(0)}%${sm.roe != null ? `, return on equity ${(sm.roe * 100).toFixed(0)}%` : ''}`);
  } else f.push(sm.forwardPe ? `Forward P/E ${sm.forwardPe.toFixed(1)}` : 'Margin data not available');
  if (sm.ebitda > 0 && sm.debt != null && sm.cash != null) {
    const nd = (sm.debt - sm.cash) / sm.ebitda;
    s += nd > 3 ? -0.25 : nd < 1 ? 0.1 : 0;
    f.push(nd <= 0 ? `Net cash of ${money(sm.cash - sm.debt)}` : `Net debt ${nd.toFixed(1)}x EBITDA`);
  } else f.push(sm.debt != null ? `Total debt ${money(sm.debt)}` : 'Debt data not available');
  s = clamp(s, -1, 1);
  const g = Math.round((fv / p - 1) * 100);
  return {
    score: s, conf: confOf(s, sm.targetMean ? 1 : 0.6), ann: { price: fv, label: 'Fair value' },
    headline: pick(s, 'Worth more than the tape says', 'Roughly fairly valued', 'Priced for more than it is delivering'),
    findings: f, metric: { v: fv, fmt: 'usd', sub: `${g > 0 ? '+' : ''}${g}% vs last price` },
    work: ['Pulling analyst price targets', 'Checking margins and returns', 'Reading the balance sheet', 'Setting fair value'], sources: ['Yahoo Finance figures']
  };
}

/* ================= Technical Analyst: what the chart says ================= */
export function technical(x) {
  const c = x.closes, p = x.p, n200 = Math.min(200, c.length), a200 = sma(c, n200), a50 = sma(c, 50), r = rsi(c), udv = upDownVolume(x.candles);
  let s = (p > a200 ? 0.4 : -0.4) + (a50 > a200 ? 0.25 : -0.25);
  s += r > 75 ? -0.2 : r >= 52 ? 0.15 : r < 30 ? 0.1 : r < 45 ? -0.15 : 0;
  s += udv > 1.2 ? 0.15 : udv < 0.8 ? -0.15 : 0;
  s = clamp(s, -1, 1);
  const st = s > 0.2 ? 'bull' : s < -0.2 ? 'bear' : 'neutral';
  const floor = Math.min(...x.candles.slice(-20).map(k => k.l));
  const lv = st === 'neutral' ? floor : a200, lab = st === 'neutral' ? 'Range floor' : `${n200} day average`;
  return {
    score: s, conf: confOf(s), ann: { price: lv, label: lab },
    headline: { bull: 'Uptrend intact, buyers defend the dips', neutral: 'Range bound, wait for a break', bear: 'Trend is broken until it reclaims the average' }[st],
    findings: [
      st === 'neutral' ? `20 day range floor at ${usd(floor)}` : `${p > a200 ? 'Holding above' : 'Below'} the ${n200} day average at ${usd(a200)}`,
      `RSI ${r.toFixed(0)}${r > 70 ? ', overbought' : r < 30 ? ', oversold' : ''}; 50 day average ${a50 > a200 ? 'above' : 'below'} the ${n200} day`,
      udv > 1.1 ? `Volume ${udv.toFixed(1)}x heavier on up days` : udv < 0.9 ? `Volume ${(1 / udv).toFixed(1)}x heavier on down days` : 'Volume even on up and down days'
    ],
    metric: { v: r, fmt: 'int', sub: { bull: 'Uptrend', neutral: 'Range bound', bear: 'Downtrend' }[st] },
    work: [`Loading ${c.length} days of prices`, 'Marking support and resistance', 'Reading momentum', 'Checking volume on the move'],
    sources: [x.kind === 'crypto' ? 'Binance candles' : 'Yahoo Finance candles']
  };
}

/* ================= M&A Specialist: is there a deal in it ================= */
const DEAL_FORMS = /^(S-4|DEFM14A|PREM14A|SC TO-T|SC 14D9|425|SC TO-I|DEFM14C|SCHEDULE TO)/;
export function ma(x) {
  if (x.kind === 'crypto') return {
    score: 0, conf: 40, headline: 'No takeover angle for a token',
    findings: ['Tokens cannot be bought out', x.coingecko?.categories?.length ? `Sector: ${x.coingecko.categories.slice(0, 3).join(', ')}` : `Ranked #${x.cryptoRank || '?'} by Binance volume`, x.coingecko?.rank ? `Market cap rank #${x.coingecko.rank} on CoinGecko` : 'No deal premium to lean on'],
    metric: { v: 'n/a', fmt: 'text', sub: 'no deals for tokens' },
    work: ['Checking for exchange listings', 'Mapping its sector', 'Reading governance news', 'Noting what is missing'], sources: x.coingecko ? ['CoinGecko categories', 'Binance'] : ['Binance']
  };
  const sm = x.summary || {}, yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const recent = (x.sec?.filings || []).filter(f => f.date >= yearAgo);
  const activist = recent.find(f => /13D/.test(f.form)), deal = recent.find(f => DEAL_FORMS.test(f.form));
  const ev = sm.evToEbitda, mc = sm.marketCap;
  let odds = 6 + (activist ? 14 : 0) + (deal ? 40 : 0);
  odds += ev ? (ev < 10 ? 8 : ev > 25 ? -3 : 0) : 0;
  odds += mc ? (mc < 10e9 ? 8 : mc > 300e9 ? -5 : 0) : 0;
  odds = clamp(odds, 2, 85);
  const s = clamp((odds - 15) / 25, -1, 1);
  const f = [
    ev ? `Trades at ${ev.toFixed(1)}x EBITDA` : sm.forwardPe ? `Forward P/E ${sm.forwardPe.toFixed(1)}` : 'Valuation multiples not available',
    activist ? `Activist-style ${activist.form} filed on ${activist.date}` : x.sec ? 'No 13D activist filings in the last year' : 'No SEC ownership filings to check',
    deal ? `Merger filing ${deal.form} on ${deal.date}` : mc ? (mc > 300e9 ? `At ${money(mc)}, very few buyers could afford it` : `Market value ${money(mc)}${sm.institutions != null ? `, institutions own ${(sm.institutions * 100).toFixed(0)}%` : ''}`) : 'Size not available'
  ];
  return {
    score: s, conf: Math.round(clamp(48 + Math.abs(s) * 25 + (deal ? 15 : 0), 40, 85)),
    headline: deal ? 'A deal is already on file' : pick(s, 'Credible takeout angle', 'Optionality exists, not a thesis on its own', 'No deal premium to lean on'),
    findings: f, metric: { v: odds, fmt: 'pct', sub: 'bid within a year, estimate' },
    work: ['Pulling valuation multiples', 'Mapping the company size', 'Reading ownership filings', 'Checking for merger filings'],
    sources: x.sec ? ['SEC EDGAR (filing list)', 'Yahoo Finance figures'] : ['Yahoo Finance figures']
  };
}

/* ================= Risk and Leverage: how big, how much leverage, where is the stop ================= */
export function risk(x) {
  const inv = x.mode === 'investor', vol = Math.round(realizedVol(x.closes, 30, x.kind === 'crypto' ? 365 : 252));
  // stop scales with volatility, capped so the reward-to-risk target stays a real price
  const stopPct = clamp(Math.round(vol / 6 * (inv ? 2.4 : 1)), 1, inv ? 25 : 15);
  const size = +(Math.max(1, 9 - vol / 9) * (inv ? 1.5 : 1)).toFixed(1);
  const lev = inv || x.kind === 'crypto' ? 1 : vol < 35 ? 2 : vol < 50 ? 1.5 : 1;
  const g = x.regime, ev = x.events || [], earn = ev.find(e => e.type === 'earnings');
  const s = clamp((44 - vol) / 28 - (labelFor(g, x.kind) === 'risk-off' ? 0.3 : 0) - (earn ? 0.2 : 0), -1, 1);
  const atrTxt = x.levels ? `, ATR ${usd(x.levels.atr)}` : '';
  return {
    score: s, conf: Math.round(clamp(78 + Math.abs(s) * 15, 70, 95)),
    headline: size >= 5 ? `Size it at ${size}% of the book with a hard stop` : `Risk budget only allows a ${size}% starter position`,
    findings: g || x.events ? [`30 day volatility ${vol}%${atrTxt}, leverage capped at ${lev}x`, regimeLine(g, x.kind),
      earn ? eventLine(earn) : ev[0] ? eventLine(ev[0]) : x.kind === 'crypto' ? 'No scheduled events for a token' : 'No earnings report before the horizon']
      : [`30 day volatility ${vol}%, leverage capped at ${lev}x`, `Hard stop ${stopPct}% from entry`, `Worst case loss ${(size * lev * stopPct / 100).toFixed(2)}% of the book`],
    metric: { v: size, fmt: 'pct1', sub: `${lev}x leverage, ${stopPct}% stop` },
    work: ['Measuring 30 day volatility', 'Reading the market backdrop', 'Checking the event calendar', 'Setting size and stop'],
    sources: g ? ['Price history', 'VIX, S&P 500, yields and dollar (Yahoo Finance)', ...(x.kind === 'stock' ? ['Earnings calendar (Yahoo Finance)'] : [])] : ['Price history'], vol, stopPct, size, lev
  };
}

/* ================= Dealer: how do we get filled ================= */
export function dealer(x, rk) {
  const inv = x.mode === 'investor', last = x.candles.slice(-20);
  const adv = mean(last.map(k => k.v || 0)), dv = mean(last.map(k => k.qv || (k.v || 0) * k.c));
  const book = +process.env.BOOK_SIZE || 10e6, notional = book * rk.size / 100 * rk.lev, part = dv ? notional / dv : 1;
  const bps = Math.round(clamp(2 + 300 * Math.sqrt(part), 2, 80));
  const slices = clamp(Math.ceil(part * 2000) + 3, 4, 7), days = clamp(Math.ceil(part / 0.02), 1, 5);
  const unit = inv ? (days === 1 ? 'week' : 'weeks') : (days === 1 ? 'session' : 'sessions');
  const s = dv > 500e6 ? 0.5 : dv > 50e6 ? 0 : -0.5;
  return {
    score: s, conf: Math.round(clamp(70 + Math.abs(s) * 40, 60, 94)),
    headline: s > 0 ? 'Liquid enough, I can work it quietly' : s < 0 ? 'Thin book, we will move the price' : 'Workable with patience',
    findings: [x.kind === 'crypto' && x.coingecko?.volume24h ? `${money(dv)} a day on Binance, ${money(x.coingecko.volume24h)} across all exchanges` : `Average daily volume ${count(adv)} ${x.kind === 'crypto' ? 'coins' : 'shares'} (${money(dv)} a day)`, `Work it in ${slices} slices over ${days} ${unit}`, `Expected slippage ${bps} basis points`],
    metric: { v: bps, fmt: 'bps', sub: `${slices} slices over ${days} ${unit}` },
    work: ['Reading the daily volume', 'Profiling liquidity', 'Planning the slices', 'Drafting the ticket'],
    sources: x.kind === 'crypto' ? ['Binance volume', ...(x.coingecko ? ['CoinGecko exchange volume'] : [])] : ['Yahoo Finance volume'], slices, days, unit
  };
}
