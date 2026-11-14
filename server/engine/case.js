// Demo analysis engine: turns a brief into a full round (desk reports, debate,
// vote, decision and trade ticket). Ported unchanged from the original
// in-browser makeCase(); the only differences are that mode and the market
// provider are passed in, and tile formats are names instead of functions
// (int | pct | pct1 | usd | bps) so the result can be sent as JSON.
//
// It is deterministic: the same brief and mode always give the same round.
import { hash, rng, clamp, usd, low } from './random.js';
import { AG, RING, RESEARCH, LAB, MODES } from './team.js';
import * as demo from '../market/demo.js';

export function makeCase(brief, mode = 'trader', market = demo) {
  if (!MODES[mode]) mode = 'trader';
  const priceOf = market.priceOf;
  const MD=MODES[mode],inv=mode==='investor',r=rng(hash(brief+(inv?'|inv':''))),n=(a,b,d=1)=>(a+r()*(b-a)).toFixed(d),int=(a,b)=>Math.round(a+r()*(b-a));
  const tk=(brief.match(/\b[A-Z]{2,5}\b/)||[''])[0],T=tk||'the target',p=priceOf(tk||'TGT'),bias=(r()*2-1)*.7;
  const stance=s=>s>.2?'bull':s<-.2?'bear':'neutral';
  const by=(st,B,N,X)=>{const q=st==='bull'?B:st==='neutral'?N:X;return int(q[0],q[1])};
  const R={},M={},ANN={};
  const mk=(id,build)=>{const s=clamp(bias+(r()-.5)*1.3,-1,1),st=stance(s),o=build(st);R[id]={score:s,stance:st,conf:int(58,93),headline:o.h,findings:o.f};M[id]=o.m};
  mk('analyst',st=>{const S=by(st,[62,84],[46,58],[24,42]);return{m:{v:S,fmt:'int',sub:'out of 100'},
    h:{bull:'Tailwinds across the sector, sentiment improving',neutral:'Mixed read, no clear narrative yet',bear:'The sector is losing sponsorship'}[st],
    f:{bull:[`News sentiment at ${S} out of 100 and rising`,`Sector inflows of $${n(1.2,4.8)}bn over four weeks`,'Three of the five closest competitors raised guidance'],
       neutral:[`News sentiment flat at ${S} out of 100`,'Sector flows are close to zero this month','Competitor guidance is split'],
       bear:[`News sentiment slid to ${S} out of 100`,`Sector outflows of $${n(1.1,3.9)}bn over four weeks`,'Two key customers flagged budget cuts for next year']}[st]}});
  mk('filings',st=>{const C=by(st,[94,114],[80,92],[52,76]);return{m:{v:C,fmt:'pct',sub:'of profit is cash'},
    h:{bull:'Clean filings, cash backs the earnings',neutral:'Nothing alarming, a few footnotes to watch',bear:'Earnings quality is slipping in the footnotes'}[st],
    f:{bull:[`Free cash flow is ${C}% of net income`,'Revenue recognition unchanged, no new critical audit matters','Management tone on the last call beat the prior four'],
       neutral:[`Free cash flow is ${C}% of net income`,'One change in segment reporting, explained in the notes','Inventory days crept up for two quarters'],
       bear:[`Only ${C}% of net income converts to cash`,`Receivables grew ${int(18,34)}% against ${int(6,12)}% revenue growth`,`Footnote 14 keeps $${int(120,480)}m of leases out of headline debt`]}[st]}});
  mk('fundamental',st=>{const g=by(st,[12,30],[-5,6],[-28,-10]),fv=p*(1+g/100);ANN.fundamental={price:fv,label:'Fair value'};return{m:{v:fv,fmt:'usd',sub:`${g>0?'+':''}${g}% vs last price`},
    h:{bull:'Worth more than the tape says',neutral:'Roughly fairly valued',bear:'Priced for growth it is not delivering'}[st],
    f:{bull:[`Fair value ${usd(fv)} against ${usd(p)} last`,`Return on invested capital ${int(18,31)}%, well above cost of capital`,`Net debt ${n(.4,1.6)}x EBITDA`],
       neutral:[`Fair value ${usd(fv)}, within a few percent of last`,`Return on invested capital ${int(9,13)}%, about its cost of capital`,`Net debt ${n(1.8,2.6)}x EBITDA`],
       bear:[`Fair value ${usd(fv)}, well below ${usd(p)} last`,`Margins compressed ${int(120,380)} basis points in two years`,`Net debt ${n(3.2,4.9)}x EBITDA`]}[st]}});
  mk('technical',st=>{const rsi=by(st,[54,66],[45,53],[27,41]),lv=p*{bull:.91,neutral:.95,bear:1.07}[st];
    ANN.technical={price:lv,label:{bull:'200 day average',neutral:'Range floor',bear:'200 day average'}[st]};return{m:{v:rsi,fmt:'int',sub:{bull:'Uptrend',neutral:'Range bound',bear:'Downtrend'}[st]},
    h:{bull:'Uptrend intact, buyers defend the dips',neutral:'Range bound, wait for a break',bear:'Trend is broken until it reclaims the average'}[st],
    f:{bull:[`Holding above the 200 day average at ${usd(lv)}`,`RSI ${rsi}, room before overbought`,'Volume rises on up days'],
       neutral:[`Range floor at ${usd(lv)} has held three times`,`RSI ${rsi}, no momentum either way`,'Volume is drying up'],
       bear:[`Lost the 200 day average at ${usd(lv)}`,`RSI ${rsi} with lower highs for six weeks`,'Volume rises on down days']}[st]}});
  mk('ma',st=>{const o=by(st,[34,58],[14,28],[3,11]);return{m:{v:o,fmt:'pct',sub:'bid within a year'},
    h:{bull:'Credible takeout angle below deal multiples',neutral:'Optionality exists, not a thesis on its own',bear:'No deal premium to lean on'}[st],
    f:{bull:[`Trades at ${n(8,11)}x EBITDA against ${n(12,15)}x in recent sector deals`,'Two strategic buyers have the balance sheet to bid',`An activist disclosed a ${n(4,7)}% stake last quarter`],
       neutral:['Trades in line with recent sector deals','One plausible buyer, busy integrating another deal','No unusual moves in ownership filings'],
       bear:['Poison pill and staggered board make a bid unlikely',`Its last acquisition at ${n(16,21)}x EBITDA is still dilutive`,'A regulatory review would run 12 to 18 months']}[st]}});
  const vol=int(22,66),stopPct=Math.round(vol/6*(inv?2.4:1)),size=+(Math.max(1,9-vol/9)*(inv?1.5:1)).toFixed(1),lev=inv?1:vol<35?2:vol<50?1.5:1,rs=(44-vol)/28,unit=inv?'weeks':'sessions';
  R.risk={score:rs,stance:stance(rs),conf:int(74,95),headline:size>=5?`Size it at ${size}% of the book with a hard stop`:`Risk budget only allows a ${size}% starter position`,
    findings:[`30 day volatility ${vol}%, leverage capped at ${lev}x`,`Hard stop ${stopPct}% from entry`,`Worst case loss ${(size*lev*stopPct/100).toFixed(2)}% of the book`]};
  M.risk={v:size,fmt:'pct1',sub:`${lev}x leverage, ${stopPct}% stop`};
  const adv=+n(1.2,14),slices=int(4,7),days=int(2,5),bps=int(4,26),ds=adv>5?.5:adv>2.5?0:-.5;
  R.dealer={score:ds,stance:stance(ds),conf:int(70,94),headline:ds>0?'Liquid enough, I can work it quietly':ds<0?'Thin book, we will move the price':'Workable with patience',
    findings:[`Average daily volume ${adv}m shares`,`Work it in ${slices} slices over ${days} ${unit}`,`Expected slippage ${bps} basis points`]};
  M.dealer={v:bps,fmt:'bps',sub:`${slices} slices over ${days} ${unit}`};
  return decide({ brief, mode, tk, T, name: market.companyName(tk) || (tk ? '' : 'Unnamed target'), p, R, M, ANN, vol, size, lev, stopPct, slices, days, unit, r });
}

/**
 * The debate, the vote and the decision. Shared by the demo engine and the live
 * engine: give it seven desk reports (R), their tiles (M), chart lines (ANN),
 * the risk and execution numbers and a seeded random source r.
 * plan: optional AI-written debate [{a, b, lines:[[who,text]], effect:{desk,stance,conf}|null}];
 * without it the debate is the scripted one.
 * weights: vote weight per desk (default: the mode's). adjust: { sizeMult, buyAt, shortAt, convPenalty, notes[],
 *   levels: { long: {stop, target}, short: {stop, target} }, minRR } from the regime, events and chart levels.
 */
export function decide({ brief, mode, tk, T, name, p, R, M, ANN, vol, size, lev, stopPct, slices, days, unit, r, extra = {}, plan = null, weights = null, adjust = null }) {
  const MD=MODES[mode],inv=mode==='investor',int=(a,b)=>Math.round(a+r()*(b-a));
  /* the debate: desks question and challenge each other, and some change their minds */
  const SH={analyst:'Analyst',filings:'Filings',fundamental:'Fundamental',risk:'Risk',dealer:'Dealer',ma:'M&A',technical:'Technical'};
  const debate=[],changes=[],F={};RING.forEach(i=>F[i]={stance:R[i].stance,conf:R[i].conf});
  const eff=(id,st,dc)=>{const o=F[id];F[id]={stance:st||o.stance,conf:clamp(o.conf+dc,35,97)};
    changes.push(st&&st!==o.stance?`${AG[id].name} moved from ${LAB[o.stance].toLowerCase()} to ${LAB[st].toLowerCase()}`:`${AG[id].name} ${dc<0?'trimmed':'raised'} confidence to ${F[id].conf}%`);return{id,...F[id]}};
  const ex=(a,b,l1,l2,e,l3)=>debate.push({a,b,e,lines:[[a,l1],[b,l2]].concat(l3?[[a,l3]]:[])});
  const rank=(st,pool)=>pool.filter(i=>F[i].stance===st).sort((a,b)=>F[b].conf-F[a].conf);
  if(plan){
    /* an AI-written debate: apply each exchange's change of mind the same way */
    for(const x of plan){let e=null;const fx=x.effect;
      if(fx&&F[fx.desk]){const o=F[fx.desk],st=fx.stance&&fx.stance!==o.stance?fx.stance:null,dc=Math.round(fx.conf-o.conf);if(st||dc)e=eff(fx.desk,st,dc)}
      debate.push({a:x.a,b:x.b,e,lines:x.lines})}
  }else{
  let bulls=rank('bull',RESEARCH),bears=rank('bear',RESEARCH),used=[];
  if(bulls.length&&bears.length){
    let X=bulls[0],Y=bears[0];if(F[Y].conf>F[X].conf)[X,Y]=[Y,X];used=[X,Y];const k=r();
    const q=`${SH[Y]}, you are ${LAB[F[Y].stance].toLowerCase()}. How do you square that with this: ${low(R[X].findings[0])}?`;
    if(k<.4)ex(X,Y,q,'I cannot. That outweighs what I found. I am moving to neutral.',eff(Y,'neutral',-int(8,14)));
    else if(k<.75)ex(X,Y,q,'It dents my case but does not break it. I am trimming my confidence.',eff(Y,null,-int(8,16)));
    else ex(X,Y,q,`It is already in my numbers. ${R[Y].findings[1]}. I am holding my view.`,null,'Then we disagree. Let the vote settle it.');
  }else{const t=[...RESEARCH].sort((a,b)=>F[b].conf-F[a].conf),X=t[0],Y=t[1];used=[X,Y];
    ex(X,Y,`${SH[Y]}, does your work back mine? ${R[X].findings[0]}.`,`It does. ${R[Y].findings[0]}.`,eff(Y,null,int(3,6)))}
  {const fs=F.filings.stance,f0=R.filings.findings[0],q='Filings, can I trust the earnings I am discounting?';
   if(fs==='bull')ex('fundamental','filings',q,`Yes. ${f0}.`,eff('fundamental',null,int(3,6)));
   else if(fs==='bear')ex('fundamental','filings',q,`Not fully. ${f0}.`,eff('fundamental',F.fundamental.stance==='bull'&&r()<.5?'neutral':null,-int(8,13)),'Then I am cutting my fair value.');
   else ex('fundamental','filings',q,`Mostly. ${R.filings.findings[2]}, so keep a margin of safety.`,null)}
  bulls=rank('bull',RING).filter(i=>!used.includes(i));bears=rank('bear',RING).filter(i=>!used.includes(i));
  if(bulls.length&&bears.length)ex(bears[0],bulls[0],`${SH[bulls[0]]}, I still disagree with you. ${R[bears[0]].findings[1]}.`,'Noted. Put it in the memo as the dissent. My vote stands.',null);
  else{const as=F.analyst.stance;ex('ma','analyst','Analyst, are buyers circling this sector at all?',
    as==='bull'?'Yes. Money is flowing into the peers and guidance is going up.':as==='bear'?'No. Money is leaving the sector and nobody is shopping.':'A little. Nothing I would call a wave.',
    as==='bull'?eff('ma',null,int(3,6)):as==='bear'?eff('ma',F.ma.stance==='bull'&&r()<.5?'neutral':null,-int(6,11)):null)}
  ex('risk','technical','Technical, where is the level that proves us wrong?',`${usd(ANN.technical.price)}, the ${low(ANN.technical.label)}. Past that I have no case.`,eff('risk',null,int(2,4)),'Good. The stop goes just beyond it.');
  ex('dealer','risk',`Risk, can I put on the full ${size}% on day one?`,vol>45?'No. Start with a third and add only if it holds.':'Yes. It is small enough to carry from the first print.',null);
  }
  /* the vote: one vote per desk, weighted by its confidence after the debate, and by the desk's track record when known */
  const WT=weights||MD.w,A=adjust||{},notes=[...(A.notes||[])];
  const votes={bull:rank('bull',RING),bear:rank('bear',RING),neutral:rank('neutral',RING)},sumc=a=>a.reduce((t,i)=>t+F[i].conf*WT[i],0),sell=MD.sell.toLowerCase();
  const net=(sumc(votes.bull)-sumc(votes.bear))/sumc(RING);let call=net>(A.buyAt??.12)?'Buy':net<(A.shortAt??-.12)?'Short':'Hold';
  let conv=Math.round(50+Math.min(1,Math.abs(net)/.65)*45);if(A.convPenalty)conv=Math.max(50,conv-A.convPenalty);
  /* stop and target: at real chart levels when the desks found them, else the volatility rule */
  let dir=call==='Short'?-1:1,rr=inv?3:2.2,stop=p*(1-dir*stopPct/100),tgt=p*(1+dir*stopPct*rr/100);
  const lv=call!=='Hold'&&A.levels&&A.levels[call==='Buy'?'long':'short'];
  if(lv){stop=lv.stop;tgt=lv.target;rr=+(Math.abs(tgt-p)/Math.abs(p-stop)).toFixed(1);stopPct=+(Math.abs(p-stop)/p*100).toFixed(1);
    if(rr<(A.minRR??1.5)){const mr=A.minRR??1.5;conv=clamp(Math.round(55+(mr-rr)/mr*30),55,85);/* conviction now means how sure we are about passing, not the buy case the chart overruled */notes.push(`The ${call==='Buy'?'buy':MD.sell.toLowerCase()} case won the vote, but at real chart levels the reward is only ${rr} times the risk (stop ${usd(stop)}, target ${usd(tgt)}), so we pass.`);call='Hold';dir=1}}
  if(A.sizeMult!=null&&A.sizeMult!==1)size=Math.max(.5,+(size*A.sizeMult).toFixed(1));
  const W=['No','One','Two','Three','Four','Five','Six','Seven'],tally={bull:votes.bull.length,neutral:votes.neutral.length,bear:votes.bear.length};
  const side=call==='Buy'?'bull':call==='Short'?'bear':null,lead=a=>[...a].sort((x,y)=>F[y].conf*WT[y]-F[x].conf*WT[x])[0],best=side&&lead(votes[side]),opp=side&&lead(votes[side==='bull'?'bear':'bull']);
  let why=`${W[tally.bull]} ${tally.bull===1?'desk':'desks'} voted buy, ${W[tally.bear].toLowerCase()} ${sell} and ${W[tally.neutral].toLowerCase()} hold. `;
  if(call==='Hold')why+=notes.length&&lv?'':'After the debate the room is still split and nobody has an edge worth paying for. We stay flat and look again when something changes.';
  else{why+=`The strongest case comes from ${AG[best].name}: ${low(R[best].headline)}. `;
    why+=opp?`${AG[opp].name} dissents (${low(R[opp].headline)}), so we size inside the risk limit and respect the stop.`:'No desk voted against, so we take the full size risk allows.'}
  if(notes.length)why=(why+' '+notes.map(n=>typeof n==='string'?n:call==='Hold'?n.hold:n.trade).join(' ')).trim();
  const hzn=inv?`${int(1,2)} to ${int(3,5)} years`:`${int(2,5)} days to ${int(2,4)} weeks`;
  return{...extra,net:+net.toFixed(3),tk,T,name,mode,brief,size,lev,stopPct,dir,p,R,M,ANN,call,callLabel:call==='Short'?MD.sell:call,sell,modeName:MD.name,hz:MD.hz,conv,why,slices,stop,tgt,debate,changes,tally,
    ticket:call==='Hold'?null:{Entry:usd(p),Stop:usd(stop),Target:usd(tgt),Size:size+'% of book',Leverage:lev+'x',Horizon:hzn,'Reward to risk':rr+' to 1',Execution:`${slices} slices, ${days} ${unit}`}};
}

