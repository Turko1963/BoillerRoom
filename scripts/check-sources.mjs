// Live check of every data source and a few full rounds (real network). Run on the server: npm run check:sources
// Prints one SRC line per source (time and the start of what it returned) and each desk's findings and sources.
const y = await import('../server/data/yahoo.js'), sec = await import('../server/data/sec.js'), cr = await import('../server/data/crowd.js'), dl = await import('../server/data/defillama.js'), dv = await import('../server/data/derivs.js'), fi = await import('../server/data/finra.js'), ftc = await import('../server/data/ftc.js'), cg = await import('../server/data/coingecko.js'), nw = await import('../server/data/news.js');
const run = async (l, f) => { const s = Date.now(); try { const v = await f(); console.log('SRC', l, (Date.now() - s) + 'ms', (JSON.stringify(v) ?? 'undefined').slice(0, 260)); } catch (e) { console.log('SRC', l, 'ERROR', e.message); } };
await run('fearGreed', () => cr.fearGreed());
await run('stocktwits', () => cr.stocktwits('NVDA'));
await run('gdelt', () => cr.newsTone('Nvidia'));
await run('insights', () => y.insights('NVDA'));
await run('options', () => y.options('NVDA'));
await run('peers', () => y.peers('NVDA'));
await run('weekly', async () => (await y.candles('NVDA', '5y', '1wk')).length);
await run('hourly', async () => (await y.candles('NVDA', '1mo', '60m')).length);
const ref = await sec.lookup('NVDA'), list = await sec.filings(ref.cik);
await run('8k', () => sec.eightK(list));
await run('form4', () => sec.insiderTrades(ref.cik, list));
await run('dealMentions', () => sec.dealMentions('NVIDIA Corporation'));
await run('dealNews', () => nw.dealNews('NVDA', 'NVIDIA Corporation'));
await run('finra', () => fi.shortVolume('NVDA'));
await run('ftc', () => ftc.mergerNotices('NVIDIA Corporation'));
for (const id of ['solana', 'uniswap', 'aave', 'bitcoin']) await run('defi ' + id, () => dl.forCoin(id));
await run('perp BTC', () => dv.perp('BTC'));
await run('dvol BTC', () => dv.dvol('BTC'));
await run('depth SOL', () => dv.depth('SOL'));
await run('cg markets SOL', () => cg.markets('SOL'));
const live = await import('../server/market/live.js');
for (const [b, m] of [['should we buy nvda?', 'trader'], ['is sol a buy?', 'investor'], ['is UNI a buy?', 'trader'], ['should we buy nvda?', 'investor']]) {
  const s = Date.now();
  try {
    const c = await live.round(b, m);
    console.log('ROUND', JSON.stringify(b), m, c.tk, c.call, c.conv, (Date.now() - s) + 'ms');
    for (const id of Object.keys(c.R)) console.log('  ' + id, '|', c.R[id].findings.join(' | '), '|| sources:', c.R[id].sources.join(', '));
  } catch (e) { console.log('ROUND', b, 'ERROR', e.stack); }
}
process.exit(0);
