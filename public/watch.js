/* BackStage Capital volatility watch: runs on the room and on the code screen.
   The browser keeps a watch key (localStorage), asks the server every 2 minutes, and when 3 or more of the
   5 checks are met it rings like a phone, shows a system notification and fires a 'brwatch' event.
   Browsers only allow sound after a click on the page; the system notification works without one. */
(function(){
  const KEY='bsc_watch',EVERY=120e3,REPEAT=6*3600e3;
  const ls={get:k=>{try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}},set:(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
  let st=ls.get(KEY),status=null,timer=0,ac=null,ringing=null,pending=0;const subs=new Set();
  const emit=()=>{subs.forEach(f=>{try{f(status,st)}catch(e){}});window.dispatchEvent(new CustomEvent('brwatch',{detail:{status,watch:st}}))};
  /* the ring: two tones (440 + 480 Hz), 2 s on, 1 s off, like a phone; three rings */
  function unlock(){try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();if(ac.state==='suspended')ac.resume().then(()=>{if(pending&&Date.now()-pending<15*60e3){pending=0;ring()}})}catch(e){}}
  ['pointerdown','keydown','touchstart'].forEach(ev=>addEventListener(ev,unlock,{passive:true}));
  function ring(times=3){
    stopRing();unlock();if(!ac||ac.state!=='running')return false;
    const g=ac.createGain();g.gain.value=0;g.connect(ac.destination);
    const o1=ac.createOscillator(),o2=ac.createOscillator(),lfo=ac.createOscillator(),lg=ac.createGain();
    o1.frequency.value=440;o2.frequency.value=480;lfo.frequency.value=20;lg.gain.value=.35;lfo.connect(lg);lg.connect(g.gain);
    o1.connect(g);o2.connect(g);const t=ac.currentTime;
    for(let i=0;i<times;i++){const a=t+i*3;g.gain.setValueAtTime(.0001,a);g.gain.linearRampToValueAtTime(.32,a+.03);g.gain.setValueAtTime(.32,a+1.97);g.gain.linearRampToValueAtTime(.0001,a+2)}
    [o1,o2,lfo].forEach(o=>{o.start(t);o.stop(t+times*3)});ringing={g,os:[o1,o2,lfo]};setTimeout(()=>{ringing=null},times*3000);return true}
  function stopRing(){if(!ringing)return;try{ringing.os.forEach(o=>o.stop());ringing.g.disconnect()}catch(e){}ringing=null}
  function notify(s){
    if(!('Notification' in window)||Notification.permission!=='granted')return;
    try{const n=new Notification(`Volatility expected: ${s.name}`,{body:`${s.met} of ${s.of} warning signs: `+s.checks.filter(c=>c.met).map(c=>c.label).join(', '),tag:'bsc-watch-'+s.symbol,requireInteraction:true,silent:false});n.onclick=()=>{focus();n.close()}}catch(e){}}
  async function poll(){
    clearTimeout(timer);if(!st)return;
    try{
      const r=await fetch('/api/watch/'+encodeURIComponent(st.token),{credentials:'same-origin',cache:'no-store'});
      if(r.status===404){st=null;ls.set(KEY,null);status=null;emit();return}
      if(r.ok){status=await r.json();
        const last=ls.get(KEY+'_last')||{};
        // ring once when it turns to alert, and again every 6 hours while it stays there
        if(status.level==='alert'&&(last.level!=='alert'||Date.now()-(last.at||0)>REPEAT||last.symbol!==status.symbol)){if(!ring())pending=Date.now();notify(status);ls.set(KEY+'_last',{level:'alert',at:Date.now(),symbol:status.symbol})}
        else if(status.level!=='alert'&&last.level==='alert')ls.set(KEY+'_last',{level:status.level,at:Date.now(),symbol:status.symbol});
        emit()}
    }catch(e){}
    timer=setTimeout(poll,EVERY);
  }
  window.BRWatch={
    get watch(){return st},get status(){return status},
    on(f){subs.add(f);f(status,st);return()=>subs.delete(f)},
    /* start (or switch) a watch from the room: needs a member session */
    async start(symbol){
      if('Notification' in window&&Notification.permission==='default')try{await Notification.requestPermission()}catch(e){}
      unlock();
      const r=await fetch('/api/watch',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol})});
      const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Could not start the watch');
      if(st&&st.token!==j.token)fetch('/api/watch/'+encodeURIComponent(st.token),{method:'DELETE'}).catch(()=>{});
      st={token:j.token,symbol:j.symbol};ls.set(KEY,st);ls.set(KEY+'_last',null);status=j.status;emit();
      if(status.level==='alert'){ring();notify(status);ls.set(KEY+'_last',{level:'alert',at:Date.now(),symbol:status.symbol})}
      timer=setTimeout(poll,EVERY);return status},
    async stop(){if(st)await fetch('/api/watch/'+encodeURIComponent(st.token),{method:'DELETE'}).catch(()=>{});st=null;status=null;ls.set(KEY,null);ls.set(KEY+'_last',null);stopRing();clearTimeout(timer);emit()},
    test(){return ring(1)},silence:stopRing,refresh:poll
  };
  // another tab changed the watch: follow it
  addEventListener('storage',e=>{if(e.key===KEY){st=ls.get(KEY);poll();emit()}});
  if(st)poll();
})();
