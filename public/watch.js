/* BackStage Capital volatility watch: runs on the room and on the code screen.
   The browser keeps a watch key (localStorage) and asks the server every 2 minutes. Turning a watch on is silent:
   it only rings when a NEW alert arrives (calm or watch -> alert). Then it plays the marimba ringtone from sfx.js
   (until Silence is tapped, or about 30 s), shows an incoming-call screen, vibrates on phones, shows a system
   notification and fires a 'brwatch' event. Sound only plays while a page of the site is open; browsers allow it
   after a click on the page, so a ring that arrives before any click plays at the first click or key. */
(function(){
  const KEY='bsc_watch',LAST=KEY+'_last',EVERY=120e3,RING_S=30;
  const ls={get:k=>{try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}},set:(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
  let st=ls.get(KEY),status=null,timer=0,pending=0;const subs=new Set();
  const S=()=>window.SFX||null;
  const emit=()=>{subs.forEach(f=>{try{f(status,st)}catch(e){}});window.dispatchEvent(new CustomEvent('brwatch',{detail:{status,watch:st}}))};
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  /* ---------- the incoming-call screen ---------- */
  let call=null;
  function css(){if(document.getElementById('bw-css'))return;const s=document.createElement('style');s.id='bw-css';s.textContent=`
.bw-call{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(3,5,12,.62);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);font-family:inherit;animation:bwin .35s ease-out}
.bw-card{width:min(360px,calc(100vw - 32px));padding:28px 24px 22px;border-radius:30px;text-align:center;color:#F2F5FC;background:linear-gradient(180deg,rgba(40,14,24,.96),rgba(14,18,34,.97));border:1px solid rgba(255,77,94,.55);box-shadow:0 30px 90px -20px #000,0 0 60px -10px rgba(255,77,94,.55)}
.bw-ico{width:86px;height:86px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle,#FF6B78,#C42A3C);box-shadow:0 0 0 0 rgba(255,77,94,.6);animation:bwpulse 1.4s ease-out infinite}
.bw-ico svg{width:46px;height:46px;transform-origin:50% 12%;animation:bwring .9s ease-in-out infinite}
.bw-k{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#FF9AA4}.bw-t{font-size:26px;font-weight:800;letter-spacing:-.02em;margin:4px 0 2px}
.bw-s{font-size:14px;color:#C9D2E6;margin-bottom:12px}.bw-l{list-style:none;margin:0 0 18px;padding:0;text-align:left;font-size:13.5px;color:#DDE3F0}
.bw-l li{padding:7px 0;border-top:1px solid rgba(255,255,255,.08)}.bw-l li::before{content:"●";color:#FF4D5E;margin-right:8px}
.bw-b{width:100%;height:56px;border-radius:28px;border:0;font-size:18px;font-weight:800;color:#fff;background:linear-gradient(90deg,#FF4D5E,#FF7A4D);cursor:pointer;box-shadow:0 12px 30px -10px rgba(255,77,94,.8)}
.bw-n{margin-top:10px;font-size:12px;color:#8E99B3}
@keyframes bwin{from{opacity:0;transform:scale(.97)}}@keyframes bwpulse{0%{box-shadow:0 0 0 0 rgba(255,77,94,.55)}100%{box-shadow:0 0 0 26px rgba(255,77,94,0)}}
@keyframes bwring{0%,100%{rotate:0deg}10%{rotate:18deg}20%{rotate:-16deg}30%{rotate:14deg}40%{rotate:-12deg}50%{rotate:8deg}60%{rotate:-6deg}70%{rotate:0deg}}
@media (prefers-reduced-motion:reduce){.bw-call,.bw-ico,.bw-ico svg{animation:none}}`;document.head.appendChild(s)}
  function showCall(s,sound){
    try{css();hideCall(true);const d=document.createElement('div');d.className='bw-call';d.setAttribute('role','alertdialog');d.setAttribute('aria-label','Volatility alert');d.dataset.nosfx='';
      d.innerHTML=`<div class="bw-card"><div class="bw-ico"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5a3 3 0 0 1 3 3v1.3c6.4 1.4 10.5 6.9 10.5 13.6v7.4l3.2 4.6c.7 1 0 2.4-1.2 2.4H8.5c-1.2 0-1.9-1.4-1.2-2.4l3.2-4.6v-7.4c0-6.7 4.1-12.2 10.5-13.6V8a3 3 0 0 1 3-3z" fill="#fff"/><path d="M18.5 40.5a5.5 5.5 0 0 0 11 0z" fill="#FFD3D8"/></svg></div>
        <div class="bw-k">Incoming alert</div><div class="bw-t">Volatility alert: ${esc(s.name)}</div><div class="bw-s">${s.met} of ${s.of} warning signs line up</div>
        <ul class="bw-l">${s.checks.filter(c=>c.met).map(c=>`<li><b>${esc(c.label)}</b></li>`).join('')}</ul>
        <button class="bw-b" type="button">Silence</button><div class="bw-n">${sound?'':'Tap anywhere to hear the ring. '}Checked ${new Date(s.checkedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div></div>`;
      d.querySelector('.bw-b').onclick=e=>{e.stopPropagation();hideCall()};document.body.appendChild(d);call=d}catch(e){}
  }
  function hideCall(quiet){pending=0;if(!quiet)try{S()&&S().stopRing()}catch(e){}if(call){call.remove();call=null}}
  function ring(){const sf=S();let ok=false;try{ok=!!(sf&&sf.ring(RING_S))}catch(e){}
    if(!ok){pending=Date.now();try{sf&&sf.whenReady(()=>{if(pending&&Date.now()-pending<15*60e3&&call){pending=0;sf.ring(RING_S);const n=call.querySelector('.bw-n');if(n)n.textContent='Ringing'}})}catch(e){}}
    return ok}
  function notify(s){
    if(!('Notification' in window)||Notification.permission!=='granted')return;
    try{const n=new Notification(`Volatility alert: ${s.name}`,{body:`${s.met} of ${s.of} warning signs: `+s.checks.filter(c=>c.met).map(c=>c.label).join(', '),tag:'bsc-watch-'+s.symbol,requireInteraction:true,silent:false});n.onclick=()=>{focus();n.close()}}catch(e){}}
  // ring only on a NEW alert: calm or watch -> alert. The first reading after a watch starts only sets the baseline.
  function alertIfNew(s){
    const last=ls.get(LAST);ls.set(LAST,{level:s.level,symbol:s.symbol,at:Date.now()});
    if(s.level!=='alert'||!last||last.symbol!==s.symbol||last.level==='alert')return false;
    showCall(s,ring());notify(s);return true}
  async function poll(){
    clearTimeout(timer);if(!st)return;
    try{
      const r=await fetch('/api/watch/'+encodeURIComponent(st.token),{credentials:'same-origin',cache:'no-store'});
      if(r.status===404){st=null;ls.set(KEY,null);ls.set(LAST,null);status=null;emit();return}
      if(r.ok){status=await r.json();alertIfNew(status);emit()}
    }catch(e){}
    timer=setTimeout(poll,EVERY);
  }
  window.BRWatch={
    get watch(){return st},get status(){return status},
    on(f){subs.add(f);f(status,st);return()=>subs.delete(f)},
    /* start (or switch) a watch from the room: needs a member session. Silent: sets the baseline, rings later */
    async start(symbol){
      if('Notification' in window&&Notification.permission==='default')try{await Notification.requestPermission()}catch(e){}
      const r=await fetch('/api/watch',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol})});
      const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Could not start the watch');
      if(st&&st.token!==j.token)fetch('/api/watch/'+encodeURIComponent(st.token),{method:'DELETE'}).catch(()=>{});
      st={token:j.token,symbol:j.symbol};ls.set(KEY,st);status=j.status;ls.set(LAST,{level:status.level,symbol:status.symbol,at:Date.now()});emit();
      clearTimeout(timer);timer=setTimeout(poll,EVERY);return status},
    async stop(){if(st)await fetch('/api/watch/'+encodeURIComponent(st.token),{method:'DELETE'}).catch(()=>{});st=null;status=null;ls.set(KEY,null);ls.set(LAST,null);hideCall();clearTimeout(timer);emit()},
    /* the preview: the incoming-call screen and the ringtone, with whatever the last reading was */
    test(){const s=status&&status.checks?status:{name:'Oil',symbol:'OIL',met:3,of:5,checks:[{label:'Fear index',met:true},{label:'Event calendar',met:true},{label:'Geopolitics and news',met:true}],checkedAt:new Date().toISOString()};
      const ok=ring();showCall(s,ok);return ok},
    silence:()=>hideCall(),refresh:poll,_alertIfNew:alertIfNew
  };
  // another tab changed the watch: follow it
  addEventListener('storage',e=>{if(e.key===KEY){st=ls.get(KEY);poll();emit()}});
  if(st)poll();
})();
