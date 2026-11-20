// The crowd panel: what traders and social media think, next to the room's decision.
// Free sources only, each labelled. The ones we cannot read are listed as unavailable, never guessed:
//   X / Twitter has no free API; Reddit, StockTwits and Bluesky block server traffic.
// Stocks: Reddit buzz (ApeWisdom), the options crowd (put/call), news tone, StockTwits when it answers.
// Coins: Reddit buzz, CoinGecko voters, Binance futures accounts long vs short, Fear & Greed, news tone.
import { newsTone } from './desks.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lean = s => (s > 0.15 ? 'bull' : s < -0.15 ? 'bear' : 'neutral');
const LEAN = { bull: 'bullish', bear: 'bearish', neutral: 'mixed' };

/** Turn the readings into sources [{name, lean, score, weight, text}] and an overall lean. Pure, for tests. */
export function crowdRead({ kind, buzz, options, tone, twits, cg, perp, fg }) {
  const S = [];
  const add = (name, score, weight, text) => S.push({ name, score: score == null ? null : +clamp(score, -1, 1).toFixed(2), lean: score == null ? null : lean(score), weight, text, available: score != null || weight === 0 });
  // Reddit buzz is attention, not direction: it counts for "heat", not for the lean
  let heat = null;
  if (buzz?.rank) {
    const up = buzz.mentionsAgo ? buzz.mentions / buzz.mentionsAgo - 1 : null;
    heat = clamp((buzz.rank <= 10 ? .6 : buzz.rank <= 50 ? .4 : buzz.rank <= 200 ? .2 : .1) + (up != null ? clamp(up, -.5, 1) * .4 : 0), 0, 1);
    S.push({ name: 'Reddit (via ApeWisdom)', score: null, lean: null, weight: 0, available: true,
      text: `#${buzz.rank} most talked about on Reddit: ${buzz.mentions} mentions in 24 h${up != null ? ` (${up >= 0 ? '+' : ''}${Math.round(up * 100)}% on the day before)` : ''}, ${buzz.upvotes} upvotes` });
  } else S.push({ name: 'Reddit (via ApeWisdom)', score: null, lean: null, weight: 0, available: !!buzz, text: buzz ? 'Not among the tickers Reddit is talking about today' : 'Not available right now' });
  if (twits?.bullPct != null && twits.bull + twits.bear >= 5) add('StockTwits', (twits.bullPct - 55) / 30, 1, `${twits.bullPct}% of tagged posts bullish (${twits.bull} bull, ${twits.bear} bear)`);
  else S.push({ name: 'StockTwits', score: null, lean: null, weight: 0, available: false, text: 'Blocked from our server (Cloudflare)' });
  if (kind === 'crypto') {
    if (cg?.sentimentUp != null) add('CoinGecko voters', (cg.sentimentUp - 50) / 25, 1, `${Math.round(cg.sentimentUp)}% of CoinGecko voters say it goes up today`);
    if (perp?.longPct != null) add('Binance futures traders', (perp.longPct - 50) / 20, 1.2, `${perp.longPct}% of Binance futures accounts are long`);
    if (fg) add('Crypto Fear & Greed', (fg.value - 50) / 35, .8, `${fg.value}/100, ${fg.label}`);
  } else if (options?.putCallOI != null) {
    add('Options traders', clamp((0.9 - options.putCallOI) / 0.5, -1, 1), 1.2, `Put/call ${options.putCallOI} on open interest${options.putCallVolume != null ? `, ${options.putCallVolume} on today's volume` : ''}: ${options.putCallOI < .7 ? 'calls dominate' : options.putCallOI > 1.1 ? 'puts dominate' : 'balanced'}`);
  }
  if (tone?.n) add('News headlines', tone.s, .8, `${tone.n} recent headlines, tone ${tone.s > .15 ? 'positive' : tone.s < -.15 ? 'negative' : 'mixed'}`);
  S.push({ name: 'X / Twitter', score: null, lean: null, weight: 0, available: false, text: 'No free access: X charges for its API' });
  const voting = S.filter(s => s.score != null && s.weight > 0), w = voting.reduce((t, s) => t + s.weight, 0);
  const score = w ? voting.reduce((t, s) => t + s.score * s.weight, 0) / w : null;
  const agree = voting.length ? voting.filter(s => s.lean === lean(score)).length : 0;
  return { score: score == null ? null : +score.toFixed(2), lean: score == null ? null : lean(score), leanLabel: score == null ? 'no read' : LEAN[lean(score)],
    heat: heat == null ? null : +heat.toFixed(2), sources: S, voting: voting.length, agree, extreme: score != null && Math.abs(score) >= .6 };
}

/** The crowd against the room's call: { verdict: 'agree'|'disagree'|'split', text } */
export function versus(call, read) {
  if (!read || read.lean == null) return { verdict: 'unknown', text: 'Not enough crowd data to compare with the room' };
  const room = call === 'Buy' ? 'bull' : call === 'Hold' ? 'neutral' : 'bear', c = read.lean;
  const verdict = room === c ? 'agree' : room === 'neutral' || c === 'neutral' ? 'split' : 'disagree';
  const roomSays = call === 'Buy' ? 'buy' : call === 'Hold' ? 'stay flat' : 'go short';
  let text = verdict === 'agree' ? `The crowd agrees with the room: ${read.leanLabel}, and the room says ${roomSays}`
    : verdict === 'disagree' ? `The crowd disagrees: it is ${read.leanLabel} while the room says ${roomSays}`
    : `Half agree: the crowd is ${read.leanLabel} and the room says ${roomSays}`;
  if (read.extreme) text += '. The crowd is one-sided, which often means the trade is crowded';
  return { verdict, text };
}

/** Gather from the (injected) sources. */
export async function crowdFor({ symbol, kind, name, call }, { crowd, yahoo, news, coingecko, derivs }) {
  const soft = p => Promise.resolve(p).catch(() => null);
  const isCoin = kind === 'crypto';
  const [buzz, options, heads, twits, cg, perp, fg] = await Promise.all([
    soft(crowd.redditBuzz?.(symbol, kind)), isCoin ? null : soft(yahoo.options?.(symbol.replace('.', '-'))),
    soft(news.headlines?.({ kind, symbol, name: name || symbol })), soft(crowd.stocktwits?.(symbol, kind)),
    isCoin ? soft(coingecko.coin?.(symbol)) : null, isCoin ? soft(derivs.perp?.(symbol)) : null, isCoin ? soft(crowd.fearGreed?.()) : null
  ]);
  const read = crowdRead({ kind, buzz, options, tone: heads?.items ? newsTone(heads.items) : null, twits, cg, perp, fg });
  return { symbol, kind, name: name || symbol, call: call || null, ...read, vs: call ? versus(call, read) : null, checkedAt: new Date().toISOString() };
}
