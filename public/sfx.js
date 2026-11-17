/* BackStage Capital sounds: one small Web Audio synth shared by the room and the code screen.
   Everything is generated here (no audio files, nothing copied): a marimba for the alert ringtone, soft key ticks,
   robot chirps per desk, vote blips, a decision chord, and the Bull vs Bear fight (whoosh, hits, snort, growl, win).
   Browsers only allow sound after a click or a key on the page: the audio starts then. Sounds on/off is remembered in
   localStorage ('bsc_sound'); off silences everything except the volatility alert ringtone. If audio fails, every
   call is a quiet no-op and the page works as before. */
(function(){
  'use strict';
  const KEY='bsc_sound';
  let ac=null,master=null,fx=null,on=true,lastTick=0;const waiters=[];
  try{on=localStorage.getItem(KEY)!=='off'}catch(e){}
  const now=()=>ac?ac.currentTime:0;
  function init(){
    if(ac)return ac;
    try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;ac=new AC();
      master=ac.createGain();master.gain.value=.55;
      const comp=ac.createDynamicsCompressor();comp.threshold.value=-18;comp.ratio.value=4;master.connect(comp);comp.connect(ac.destination);
      fx=ac.createGain();fx.gain.value=on?1:0;fx.connect(master)}catch(e){ac=null}
    return ac;
  }
  function unlock(){if(!init())return;if(ac.state==='suspended')ac.resume().then(flush,()=>{});else flush()}
  function flush(){while(waiters.length&&ac&&ac.state==='running'){try{waiters.shift()()}catch(e){}}}
  ['pointerdown','keydown','touchstart'].forEach(ev=>addEventListener(ev,unlock,{passive:true,capture:true}));
  const ready=()=>!!ac&&ac.state==='running';
  // a voice: bus = fx (obeys the sound switch) or master (the alert ringtone)
  const out=bus=>(bus==='alert'?master:fx);
  function env(g,t,a,peak,d){g.gain.cancelScheduledValues(t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(.0001,t+a+d)}
  function tone(f,t,{type='sine',a=.005,d=.2,v=.2,bus,glide=null,detune=0}={}){
    const o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(detune)o.detune.value=detune;
    if(glide)o.frequency.exponentialRampToValueAtTime(glide,t+a+d);env(g,t,a,v,d);o.connect(g);g.connect(out(bus));o.start(t);o.stop(t+a+d+.05);return o}
  let noiseBuf=null;
  function noise(t,{d=.1,v=.15,f=1200,q=.8,type='bandpass',bus,sweep=null}={}){
    if(!noiseBuf){noiseBuf=ac.createBuffer(1,ac.sampleRate*1.5,ac.sampleRate);const c=noiseBuf.getChannelData(0);for(let i=0;i<c.length;i++)c[i]=Math.random()*2-1}
    const s=ac.createBufferSource(),fl=ac.createBiquadFilter(),g=ac.createGain();s.buffer=noiseBuf;fl.type=type;fl.frequency.setValueAtTime(f,t);fl.Q.value=q;
    if(sweep)fl.frequency.exponentialRampToValueAtTime(sweep,t+d);env(g,t,.004,v,d);s.connect(fl);fl.connect(g);g.connect(out(bus));s.start(t);s.stop(t+d+.05)}
  const midi=n=>440*Math.pow(2,(n-69)/12);
  // marimba: a bar has a strong fundamental and a quickly dying partial near 4x, plus a soft mallet click
  function marimba(n,t,v=.22,bus){const f=midi(n);tone(f,t,{a:.003,d:.55,v,bus});tone(f*3.93,t,{a:.002,d:.09,v:v*.35,bus});tone(f*9.2,t,{a:.001,d:.025,v:v*.12,bus})}
  const play=fn=>{if(!on||!ready())return false;try{fn(now()+.01)}catch(e){}return true};

  /* ---------- the alert ringtone: an original marimba phrase in E major, repeating like an incoming call ---------- */
  // eighth notes at 150 bpm (0.2 s); 0 = rest. Two short call-and-answer bars, then a breath.
  const PHRASE=[[76,.2],[83,.2],[80,.2],[83,.2],[88,.4],[0,.2],[85,.2],[83,.2],[80,.2],[85,.2],[83,.6],[0,.6]];
  const LOOP=PHRASE.reduce((s,x)=>s+x[1],0);
  let ringT=0,ringEnd=0,ringStop=null;
  function ringLoop(){
    if(!ac||Date.now()>ringEnd){stopRing();return}
    let t=now()+.03;
    PHRASE.forEach(([n,d],i)=>{if(n){marimba(n,t,.26,'alert');if(i===0||i===6)marimba(n-24,t,.16,'alert')}t+=d});
    ringT=setTimeout(ringLoop,LOOP*1000);
  }
  function ring(seconds=30){
    stopRing();if(!ready())return false;ringEnd=Date.now()+seconds*1000;ringLoop();
    try{navigator.vibrate&&navigator.vibrate([500,250,500,250,500,1200,500,250,500])}catch(e){}
    if(ringStop)clearTimeout(ringStop);ringStop=setTimeout(stopRing,seconds*1000+50);return true}
  function stopRing(){clearTimeout(ringT);clearTimeout(ringStop);ringT=ringStop=0;ringEnd=0;try{navigator.vibrate&&navigator.vibrate(0)}catch(e){}}

  /* ---------- clicks and typing: a soft key tick ---------- */
  function tick(kind){const t0=performance.now();if(t0-lastTick<28)return;lastTick=t0;
    play(t=>{noise(t,{d:.018,v:kind==='key'?.05:.07,f:kind==='key'?3800:2600,q:1.4});tone(kind==='key'?1900:1400,t,{type:'triangle',a:.001,d:.025,v:.025})})}

  /* ---------- the robots: R2-style chirps, a voice per desk ---------- */
  const VOICE={analyst:[1300,'sine'],filings:[900,'triangle'],fundamental:[1100,'sine'],technical:[1600,'square'],ma:[1450,'triangle'],risk:[750,'sawtooth'],dealer:[1000,'square'],manager:[820,'sine']};
  function chirp(id,n){const [b,type]=VOICE[id]||[1100,'sine'],k=n||2+Math.floor(Math.random()*3);
    play(t=>{for(let i=0;i<k;i++){const f=b*(.75+Math.random()*.7),f2=f*(Math.random()<.5?1.6:.62),s=t+i*(.055+Math.random()*.04);
      tone(f,s,{type,a:.004,d:.05+Math.random()*.05,v:type==='sine'?.05:.022,glide:f2})}})}
  function done(id){const [b,type]=VOICE[id]||[1100,'sine'];play(t=>{tone(b*.8,t,{type,a:.004,d:.07,v:type==='sine'?.05:.022,glide:b*1.5});tone(b*1.5,t+.08,{type,a:.003,d:.09,v:type==='sine'?.045:.02})})}
  function blip(stance){const f=stance==='bull'?1046:stance==='bear'?523:784;play(t=>{tone(f,t,{type:'sine',a:.003,d:.12,v:.07});tone(f*2,t,{type:'sine',a:.002,d:.05,v:.02})})}
  function chord(call){const C=call==='Buy'?[60,64,67,72]:call==='Hold'?[60,65,67,72]:[57,60,64,69];
    play(t=>C.forEach((n,i)=>{marimba(n,t+i*.06,.12);tone(midi(n),t+i*.06,{type:'triangle',a:.02,d:1.4,v:.03})}))}

  /* ---------- Bull vs Bear ---------- */
  function whoosh(){play(t=>noise(t,{d:.32,v:.12,f:300,q:.7,sweep:2400}))}
  function hit(power=1){const p=Math.max(.3,Math.min(1.6,+power||1));play(t=>{tone(110,t,{a:.002,d:.18,v:.22*p,glide:45});noise(t,{d:.09,v:.18*p,f:900,q:.6,type:'lowpass'});noise(t+.005,{d:.04,v:.08*p,f:3200,q:1})})}
  function snort(){play(t=>{noise(t,{d:.13,v:.12,f:700,q:2,sweep:380});noise(t+.17,{d:.22,v:.1,f:600,q:2,sweep:260})})}
  function growl(){play(t=>{const o=ac.createOscillator(),lfo=ac.createOscillator(),lg=ac.createGain(),fl=ac.createBiquadFilter(),g=ac.createGain();
    o.type='sawtooth';o.frequency.setValueAtTime(95,t);o.frequency.linearRampToValueAtTime(72,t+.5);lfo.frequency.value=28;lg.gain.value=22;lfo.connect(lg);lg.connect(o.frequency);
    fl.type='lowpass';fl.frequency.value=520;env(g,t,.04,.09,.5);o.connect(fl);fl.connect(g);g.connect(fx);[o,lfo].forEach(x=>{x.start(t);x.stop(t+.6)});noise(t,{d:.45,v:.04,f:400,q:1})})}
  function win(side){const S=side==='bear'?[69,67,64,69]:[72,76,79,84];play(t=>S.forEach((n,i)=>marimba(n,t+i*.11,i===3?.2:.15)))}

  window.SFX={
    get on(){return on},
    set(v){on=!!v;try{localStorage.setItem(KEY,on?'on':'off')}catch(e){}if(fx&&ac)fx.gain.setTargetAtTime(on?1:0,ac.currentTime,.02);dispatchEvent(new CustomEvent('sfx:toggle',{detail:on}));if(on)tick()},
    toggle(){this.set(!on);return on},
    ready,unlock,whenReady(f){if(ready())f();else waiters.push(f)},
    tick,chirp,done,blip,chord,whoosh,hit,snort,growl,win,ring,stopRing,get ringing(){return !!ringEnd}
  };

  /* ticks on buttons, chips, tabs and typing (anything with data-nosfx is skipped) */
  addEventListener('pointerdown',e=>{const b=e.target.closest&&e.target.closest('button,[role="tab"],a,.chip,summary');if(b&&!b.closest('[data-nosfx]'))tick()},{passive:true});
  addEventListener('keydown',e=>{const el=e.target;if(e.repeat||!el||!/^(INPUT|TEXTAREA)$/.test(el.tagName))return;if(e.key.length===1||e.key==='Backspace')tick('key')},{passive:true});
})();
