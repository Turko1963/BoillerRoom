/*! BullBear component - BackStage Capital.
 *  A bull against bear fight strip for the Boiler Room, plus the big fight for the intro film.
 *  No dependencies. Load bullbear.css and this file, then use window.BullBear.
 *
 *  BullBear.createArena(container, options)      -> { hit, setVotes, setBalance, end, reset, say, destroy, el }
 *  BullBear.createIntroFight(container, options) -> { start, skip, destroy, centers }
 */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), rnd = Math.random, DEG = Math.PI / 180;
  const ease = k => k * k * (3 - 2 * k);
  const atk = (k, a1, a2) => k < .3 ? a1 * ease(k / .3) : k < .6 ? a1 + (a2 - a1) * ease((k - .3) / .3) : a2 * (1 - ease((k - .6) / .4));
  const rec = (k, a) => k < .15 ? a * ease(k / .15) : a * (1 - ease((k - .15) / .85));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion:reduce)').matches;
  const DEFAULT_ASSETS = { bull: 'assets/bull.webp', bear: 'assets/bear.webp' };
  /* width / height of the two pictures. Keep these if you swap in the licensed files of the same artwork. */
  const SIZE = { bull: [778, 760], bear: [695, 760] };

  /* ------------------------------------------------------------------------------------------------
   * Joint maps. Each bone is an ellipse of influence (c = centre, r = radii), a pivot p and an inner
   * radius i (fully attached inside it, fading out to the edge). Coordinates are pixels in the picture.
   * pose() returns one value per bone: an angle in radians, or a scale for bones marked sc.
   * ---------------------------------------------------------------------------------------------- */
  const SPEC = {
    bull: { w: 778, h: 760,
      bones: [{ c: [630, 150], r: [230, 235], p: [500, 255], i: .7 },   // head and horns
              { c: [105, 220], r: [160, 170], p: [152, 366], i: .78 },  // tail
              { c: [600, 565], r: [105, 110], p: [632, 478], i: .7 },   // raised front leg
              { c: [380, 380], r: [340, 310], p: [380, 600], sc: 1 }],  // chest (breathing)
      pose(t, s) {
        const br = s.hurt ? 2.3 : 1;
        let head = 3.5 * Math.sin(t * 1.3) + (s.hurt ? 6 : 0), tail = 8 * Math.sin(t * 2.1) + 3 * Math.sin(t * 5.3),
            leg = -10 * Math.pow(Math.max(0, Math.sin(t * 1.7)), 2), ch = 1 + .013 * br * Math.sin(t * 2.6 * br);
        if (s.walk) { leg += 14 * Math.sin(t * 15) * s.walk; head += 2.5 * Math.sin(t * 15); }
        if (s.act === 'lunge') { head += atk(s.k, 15, -24); leg += atk(s.k, 8, -30); tail += atk(s.k, 8, -16); }
        if (s.act === 'recoil') { head += rec(s.k, -20); tail += rec(s.k, 18); leg += rec(s.k, 12); }
        if (s.ko) { head = 14; tail = 18; leg = 10; ch = 1; }
        return [head * DEG, tail * DEG, leg * DEG, ch];
      } },
    bear: { w: 695, h: 760,
      bones: [{ c: [120, 112], r: [158, 130], p: [232, 172] },           // head
              { c: [78, 172], r: [62, 40], p: [128, 150] },              // jaw
              { c: [150, 350], r: [180, 150], p: [282, 300], i: .62 },   // front arm and fist
              { c: [610, 400], r: [95, 160], p: [572, 250], i: .65 },    // back arm
              { c: [390, 330], r: [310, 310], p: [390, 600], sc: 1 }],   // chest (breathing)
      pose(t, s) {
        const br = s.hurt ? 2.3 : 1;
        let head = 2.5 * Math.sin(t * 1.1) - (s.hurt ? 6 : 0), jaw = -4 - 4 * Math.sin(t * 1.6), aF = 4 * Math.sin(t * 2),
            aB = 3 * Math.sin(t * 2 + 1), ch = 1 + .013 * br * Math.sin(t * 2.4 * br);
        if (s.walk) { aF += 9 * Math.sin(t * 11) * s.walk; aB -= 9 * Math.sin(t * 11) * s.walk; head += 2 * Math.sin(t * 11); }
        if (s.act === 'lunge') { aF += atk(s.k, 22, -28); head += atk(s.k, 6, -12); jaw += atk(s.k, -4, -12); aB += atk(s.k, -6, 10); }
        if (s.act === 'recoil') { head += rec(s.k, 16); aF += rec(s.k, 12); aB += rec(s.k, -10); }
        if (s.ko) { head = 8; jaw = -12; aF = -22; aB = 12; ch = 1; }
        return [head * DEG, jaw * DEG, aF * DEG, aB * DEG, ch];
      } }
  };

  /* ------------------------------------------------------------------------------------------------
   * Puppet rig: draws a flat picture through a WebGL grid and bends the grid around the joints,
   * so the head, limbs and tail move without cutting the picture. Falls back to the plain <img>.
   * ---------------------------------------------------------------------------------------------- */
  const RIGS = new Set(); let rigRaf = 0;
  function rigLoop(now) {
    rigRaf = RIGS.size ? requestAnimationFrame(rigLoop) : 0;
    RIGS.forEach(r => { if (r.host.isConnected && r.visible()) r.draw(now / 1000); });
  }
  function makeRig(host, spec, visible) {
    const fi = host.querySelector('.bb-fi'), img = fi && fi.querySelector('img');
    if (!img || reducedMotion()) return null;
    const cv = document.createElement('canvas'); cv.className = 'bb-rig';
    const gl = cv.getContext('webgl', { premultipliedAlpha: true, antialias: true }); if (!gl) return null;
    const N = 26, PAD = .24, IW = spec.w, IH = spec.h, nv = (N + 1) * (N + 1);
    const rest = new Float32Array(nv * 2), pos = new Float32Array(nv * 2), uv = new Float32Array(nv * 2), idx = [];
    for (let j = 0, k = 0; j <= N; j++) for (let i = 0; i <= N; i++, k++) { rest[k * 2] = i / N * IW; rest[k * 2 + 1] = j / N * IH; uv[k * 2] = i / N; uv[k * 2 + 1] = j / N; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    const weights = spec.bones.map(b => { const w = new Float32Array(nv), inn = b.sc ? .15 : (b.i || .6);
      for (let k = 0; k < nv; k++) { const d = Math.hypot((rest[k * 2] - b.c[0]) / b.r[0], (rest[k * 2 + 1] - b.c[1]) / b.r[1]); w[k] = d < inn ? 1 : d > 1 ? 0 : 1 - ease((d - inn) / (1 - inn)); }
      return w; });
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; }, pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p,t;varying vec2 v;void main(){v=t;gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D s;varying vec2 v;void main(){gl_FragColor=texture2D(s,v);}'));
    gl.linkProgram(pr); gl.useProgram(pr);
    const pb = gl.createBuffer(), tb = gl.createBuffer(), ib = gl.createBuffer(), lp = gl.getAttribLocation(pr, 'p'), lt = gl.getAttribLocation(pr, 't');
    gl.bindBuffer(gl.ARRAY_BUFFER, tb); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW); gl.enableVertexAttribArray(lt); gl.vertexAttribPointer(lt, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const r = { host, visible: visible || (() => true), ready: false, walk: 0, act: null, t0: 0,
      fire(a) { r.act = a; r.t0 = performance.now() / 1000; },
      draw(t) {
        if (!r.ready) return;
        const d = Math.min(2, root.devicePixelRatio || 1), cw = Math.max(2, Math.round(fi.offsetWidth * (1 + 2 * PAD) * d)), ch = Math.max(2, Math.round(fi.offsetHeight * (1 + 2 * PAD) * d));
        if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; gl.viewport(0, 0, cw, ch); }
        let k = 0; if (r.act) { k = (t - r.t0) / .52; if (k >= 1) { r.act = null; k = 0; } }
        const P = spec.pose(t, { ko: host.classList.contains('bb-ko'), hurt: host.classList.contains('bb-hurt'), walk: r.walk, act: r.act, k });
        const B = spec.bones, nb = B.length, cs = P.map(Math.cos), sn = P.map(Math.sin), S = 1 / (1 + 2 * PAD);
        for (let v = 0; v < nv; v++) { const x = rest[v * 2], y = rest[v * 2 + 1]; let ox = 0, oy = 0;
          for (let b = 0; b < nb; b++) { const w = weights[b][v]; if (!w) continue; const bn = B[b], dx = x - bn.p[0], dy = y - bn.p[1];
            if (bn.sc) { ox += w * dx * (P[b] - 1); oy += w * dy * (P[b] - 1); }
            else { ox += w * (dx * cs[b] - dy * sn[b] - dx); oy += w * (dx * sn[b] + dy * cs[b] - dy); } }
          pos[v * 2] = ((x + ox) / IW + PAD) * S * 2 - 1; pos[v * 2 + 1] = 1 - ((y + oy) / IH + PAD) * S * 2; }
        gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      },
      destroy() { RIGS.delete(r); cv.remove(); img.style.visibility = ''; const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } };
    const init = () => { try {
      const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      fi.appendChild(cv); img.style.visibility = 'hidden'; r.ready = true;
    } catch (e) { /* keep the plain picture */ } };
    if (img.complete && img.naturalWidth) init(); else img.addEventListener('load', init, { once: true });
    RIGS.add(r); if (!rigRaf) rigRaf = requestAnimationFrame(rigLoop);
    return r;
  }
  const bodyAnim = (f, cls) => { if (f.rig) f.rig.fire(cls); const e = f.el.querySelector('.bb-fi');
    e.classList.remove('bb-lunge', 'bb-recoil'); void e.offsetWidth; e.classList.add('bb-' + cls); setTimeout(() => e.classList.remove('bb-' + cls), 520); };
  function typeText(el, text, speed) { el._bb = (el._bb || 0) + 1; const my = el._bb;
    if (reducedMotion() || !speed) { el.textContent = text; return; } el.textContent = ''; let i = 0;
    (function f() { if (el._bb !== my) return; i += 2; el.textContent = text.slice(0, i); if (i < text.length) setTimeout(f, speed); })(); }
  const imgTag = (src, co) => `<img alt="" draggable="false"${co ? ` crossorigin="${co}"` : ''} src="${src}">`;

  /* ================================================================================================
   * ARENA: the fight strip
   * ============================================================================================== */
  function createArena(container, options) {
    const o = Object.assign({ isDark: null, typeSpeed: 10 }, options || {});
    const assets = Object.assign({}, DEFAULT_ASSETS, api.inlineAssets, o.assets), reduce = reducedMotion();
    const L = Object.assign({ bulls: 'Bulls', bears: 'Bears', idle: 'Waiting for the bell', footer: 'Wall Street floor',
      windBull: 'The bull lines up the last charge', windBear: 'The bear lines up the last blow',
      koBull: 'Knockout. The bulls take it', koBear: 'Knockout. The bears take it', draw: 'Draw. Nobody wins this round' }, o.labels);
    const dark = () => o.isDark ? !!o.isDark() : matchMedia('(prefers-color-scheme:dark)').matches;
    const el = document.createElement('div'); el.className = 'bb-arena'; el.dataset.state = 'idle'; el.setAttribute('aria-label', `${L.bulls} against ${L.bears}`);
    el.innerHTML = `<div class="bb-side bb-l"><div><b>${L.bulls}</b><span class="bb-pb">50%</span></div><p class="bb-say" aria-live="polite">${L.idle}</p></div>
      <div class="bb-side bb-r"><div><span class="bb-pr">50%</span><b>${L.bears}</b></div><p>${L.footer}</p></div>
      <div class="bb-fighter bb-bull"><div class="bb-fi">${imgTag(assets.bull, o.crossOrigin)}</div></div>
      <div class="bb-fighter bb-bear"><div class="bb-fi">${imgTag(assets.bear, o.crossOrigin)}</div></div>
      <div class="bb-pow"><svg viewBox="0 0 44 44"><path d="M22 3v9M22 32v9M3 22h9M32 22h9M8.5 8.5 15 15M29 29l6.5 6.5M8.5 35.5 15 29M29 15l6.5-6.5"/></svg></div>
      <canvas class="bb-fx" aria-hidden="true"></canvas><div class="bb-bar"><i></i><u></u></div>`;
    container.appendChild(el);
    const q = s => el.querySelector(s), mkF = (sel, d) => ({ el: q(sel), d, x: 0, ox: 0, oy: 0, vx: 0, vy: 0, rot: 0, rotT: 0, free: false, fl: 0, rig: null });
    const A = { bal: 0, balS: 0, eng: false, engK: 0, over: false, gap: 0, gapT: 0, gapV: 900, shake: 0, flash: 0, idle: 0, paw: 0, steam: 0, gen: 0, onHit: null,
      w: 0, h: 0, bw: 108, ew: 101, bh: 106, eh: 110, c: 0, P: [], pow: q('.bb-pow'), cv: q('.bb-fx'), bull: mkF('.bb-bull', 1), bear: mkF('.bb-bear', -1) };
    const ax = A.cv.getContext('2d'), sayEl = q('.bb-say'); let alive = true, last = 0;
    A.bull.rig = makeRig(A.bull.el, SPEC.bull); A.bear.rig = makeRig(A.bear.el, SPEC.bear);

    function layout() { const d = Math.min(2, root.devicePixelRatio || 1); A.w = el.clientWidth; A.h = el.clientHeight;
      A.bw = A.bull.el.offsetWidth || 108; A.ew = A.bear.el.offsetWidth || 101; A.bh = A.bull.el.offsetHeight || 106; A.eh = A.bear.el.offsetHeight || 110;
      A.cv.width = Math.round(A.w * d); A.cv.height = Math.round(A.h * d); ax.setTransform(d, 0, 0, d, 0, 0); }
    const dust = (x, y, n, pw = 1) => { if (reduce) return; for (let i = 0; i < n; i++) A.P.push({ k: 0, x: x + (rnd() - .5) * 18, y: y - rnd() * 5, vx: (rnd() - .5) * 150 * pw, vy: -15 - rnd() * 80 * pw, l: 1, f: .8 + rnd() * .7, s: (4 + rnd() * 8) * pw }); };
    const spark = (x, y, n, rgb) => { if (reduce) return; for (let i = 0; i < n; i++) A.P.push({ k: 1, x, y: y + (rnd() - .5) * 16, vx: (rnd() - .5) * 620, vy: -rnd() * 420, l: 1, f: 1.7 + rnd(), c: rnd() < .4 ? [255, 226, 160] : rgb }); };
    const steam = (x, y, d) => { if (reduce) return; for (let i = 0; i < 3; i++) A.P.push({ k: 2, x, y, vx: d * (50 + rnd() * 60), vy: -8 - rnd() * 18, l: 1, f: 1.3 + rnd() * .6, s: 3 + rnd() * 4 }); };
    const nose = () => [A.bull.x + A.bw * .9, A.h - 6 - A.bh * .66], mouth = () => [A.bear.x + A.ew * .1, A.h - 6 - A.eh * .75];
    const say = t => typeText(sayEl, t, o.typeSpeed);
    const powFlash = isBull => { A.pow.style.color = isBull ? 'var(--bb-up,#3DD9A4)' : 'var(--bb-down,#FF6177)'; A.pow.classList.remove('bb-on'); void A.pow.offsetWidth; A.pow.classList.add('bb-on'); };

    function impact(att, pow) {
      const def = att === A.bull ? A.bear : A.bull, fl = A.h - 6, hy = fl - A.bh * .55;
      def.vx += -def.d * pow * 330; if (pow > .5) def.vy = -pow * 200; att.vx += att.d * pow * 90; bodyAnim(att, 'lunge'); bodyAnim(def, 'recoil');
      if (reduce) return;
      dust(A.c, fl, 6 + pow * 10, .8 + pow * .5); spark(A.c, hy, 5 + pow * 9, att === A.bull ? [120, 255, 200] : [255, 120, 140]); A.shake = Math.max(A.shake, 3 + pow * 6);
      if (pow > .6) powFlash(att === A.bull);
      const p = att === A.bear ? mouth() : nose(); steam(p[0], p[1], att.d);
    }
    /** bal: -1 (bears winning) .. 1 (bulls winning). bullPct optional, 0..100, for the labels and the bar. */
    function setBalance(bal, bullPct) {
      A.bal = clamp(bal, -.85, .85); const pc = Math.round(bullPct == null ? 50 + bal * 50 : bullPct);
      q('.bb-pb').textContent = pc + '%'; q('.bb-pr').textContent = (100 - pc) + '%'; q('.bb-bar i').style.width = pc + '%'; q('.bb-bar u').style.width = (100 - pc) + '%';
      A.bear.el.classList.toggle('bb-hurt', A.bal > .3); A.bull.el.classList.toggle('bb-hurt', A.bal < -.3);
    }
    /** Convenience: pass the summed vote weight of each side (for example confidence x desk weight). */
    function setVotes(v) { const b = v.bull || 0, r = v.bear || 0, n = v.neutral || 0, tot = b + r + n * .6; setBalance(tot ? (b - r) / tot : 0, b + r ? b / (b + r) * 100 : 50); }
    /** side: 'bull' | 'bear' | 'neutral'. message is optional commentary. */
    function hit(side, message) {
      if (A.over) return; if (!A.eng) { A.eng = true; el.dataset.state = 'fight'; } if (message) say(message); A.idle = 0; const g = A.gen;
      if (side === 'neutral') { A.gapT = 90; A.gapV = 420; setTimeout(() => { if (g === A.gen && !A.over && !A.onHit) { A.gapT = 0; A.gapV = 700; } }, 650); return; }
      const att = side === 'bull' ? A.bull : A.bear;
      if (A.engK < .9) { A.gapT = 0; A.gapV = 1500; A.onHit = () => impact(att, 1); return; }
      if (A.onHit) { impact(att, .7); return; }
      if (rnd() < .55) { A.gapT = 110 + rnd() * 70; A.gapV = 560; dust(att.x + (att === A.bull ? A.bw : A.ew) * .5, A.h - 6, 4, .6);
        setTimeout(() => { if (g !== A.gen || A.over) return; A.gapT = 0; A.gapV = 1800; A.onHit = () => impact(att, 1.15); }, 380); }
      else impact(att, .78);
    }
    /** result: 'bull' | 'bear' | 'draw'. Plays the finishing move and the knockout. */
    function end(result) {
      A.over = true; A.onHit = null; el.dataset.state = 'over'; const g = ++A.gen;
      if (result === 'draw') { A.eng = false; A.gapT = 0; [A.bull, A.bear].forEach(f => f.el.classList.add('bb-hurt')); say(L.draw); return; }
      const bullWins = result === 'bull', win = bullWins ? A.bull : A.bear, lose = bullWins ? A.bear : A.bull; A.eng = true; A.bal = bullWins ? .3 : -.3;
      say(bullWins ? L.windBull : L.windBear); A.gapT = Math.min(280, A.w * .22); A.gapV = 620;
      setTimeout(() => { if (g !== A.gen) return; A.gapT = 0; A.gapV = 2600; A.onHit = () => {
        impact(win, 2.4); A.flash = .6; A.P.push({ k: 3, x: A.c, y: A.h - 6 - A.bh * .5, s: 10, l: 1, f: 1.6 }); dust(A.c, A.h - 6, 26, 1.8);
        lose.free = true; lose.vx = -lose.d * 500; lose.vy = -430; lose.rotT = lose === A.bull ? -180 : 90; lose.fl = lose === A.bull ? -2 : -A.eh * .11;
        lose.el.classList.add('bb-ko'); lose.el.classList.remove('bb-hurt'); win.el.classList.add('bb-win'); win.el.classList.remove('bb-hurt'); say(bullWins ? L.koBull : L.koBear);
        [520, 980, 1440].forEach(t => setTimeout(() => { if (g === A.gen) { win.vy = -350; const p = win === A.bull ? nose() : mouth(); steam(p[0], p[1], win.d); } }, t));
        if (o.onKnockout) o.onKnockout(result);
      }; }, reduce ? 0 : 780);
    }
    function reset(message) {
      A.gen++; A.eng = false; A.over = false; A.bal = 0; A.gap = A.gapT = 0; A.onHit = null; A.idle = 0; el.dataset.state = 'idle';
      [A.bull, A.bear].forEach(f => { f.el.classList.remove('bb-ko', 'bb-win', 'bb-hurt'); f.ox = f.oy = f.vx = f.vy = f.rot = f.rotT = f.fl = 0; f.free = false; });
      setBalance(0, 50); say(message || L.idle);
    }
    function frame(dt) {
      const w = A.w, h = A.h; if (!w) return; const fl = h - 6;
      A.engK += ((A.eng ? 1 : 0) - A.engK) * Math.min(1, dt * 3); A.balS += (A.bal - A.balS) * Math.min(1, dt * 2.4);
      const dg = A.gapT - A.gap; A.gap += Math.sign(dg) * Math.min(Math.abs(dg), A.gapV * dt);
      if (A.onHit && A.engK > .93 && A.gapT === 0 && A.gap < 1) { const f = A.onHit; A.onHit = null; f(); }
      const home = w < 700 ? 70 : 300, span = Math.max(0, w / 2 - home - A.bw - 20); A.c = w / 2 + A.balS * span;
      A.shake *= Math.pow(.003, dt); const sx = (rnd() - .5) * A.shake, sy = (rnd() - .5) * A.shake * .6;
      [A.bull, A.bear].forEach(f => { const B = f === A.bull, fw = B ? A.bw : A.ew;
        if (f.free) { f.vy += 1500 * dt; f.ox += f.vx * dt; f.oy += f.vy * dt; f.rot += (f.rotT - f.rot) * Math.min(1, dt * 5);
          if (f.oy >= f.fl) { f.oy = f.fl; if (f.vy > 150) { dust(f.x + fw / 2, fl, 14, 1.4); A.shake = Math.max(A.shake, 6); f.vy *= -.3; f.vx *= .55; } else { f.vy = 0; f.vx *= Math.pow(.01, dt); } } }
        else { f.vx += (-f.ox * 70 - f.vx * 10) * dt; f.ox += f.vx * dt; f.vy += 1700 * dt; f.oy += f.vy * dt; if (f.oy > 0) { if (f.vy > 300) dust(f.x + fw / 2, fl, 5, .7); f.oy = 0; f.vy = 0; } }
        const hx = B ? home : w - home - fw, px = B ? A.c - A.gap / 2 - fw + 8 : A.c + A.gap / 2 - 8, nx = clamp(hx + (px - hx) * A.engK + f.ox, 6, w - fw - 6);
        const moving = Math.abs(nx - f.x) > 70 * dt && f.oy === 0 && !f.free;
        if (moving && rnd() < .55) dust(nx + fw * (B ? .3 : .65), fl, 1, .55);
        if (f.rig) f.rig.walk = moving ? 1 : 0;
        f.x = nx; f.el.style.transform = `translate(${nx + sx}px,${f.oy + sy}px) rotate(${f.rot}deg)`; });
      A.pow.style.left = A.c + 'px';
      if (!reduce && !A.over) {
        A.steam += dt; if (A.steam > 1.6) { A.steam = rnd() * .6; const p = nose(); steam(p[0], p[1], 1); }
        if (!A.eng) { A.paw += dt; if (A.paw > 2.4) { A.paw = 0; dust(A.bull.x + A.bw * .58, fl, 4, .6); } }
        else { A.idle += dt; if (A.idle > 1.5 && !A.onHit && A.engK > .95) { A.idle = rnd() * .7; const lead = rnd() < .5 + A.bal * .45 ? A.bull : A.bear, g = A.gen;
          if (rnd() < .4) { A.gapT = 50 + rnd() * 70; A.gapV = 380; setTimeout(() => { if (g === A.gen && !A.over && !A.onHit) { A.gapT = 0; A.gapV = 950; A.onHit = () => impact(lead, .55); } }, 430); }
          else impact(lead, .38); } }
      }
      ax.clearRect(0, 0, w, h); const dk = dark(), dc = dk ? [214, 204, 186] : [122, 110, 94];
      for (let i = A.P.length - 1; i >= 0; i--) { const p = A.P[i]; p.l -= dt * p.f; if (p.l <= 0) { A.P.splice(i, 1); continue; }
        if (p.k === 3) { p.s += dt * 560; ax.strokeStyle = rgba(dk ? [255, 255, 255] : [90, 100, 130], p.l * .7); ax.lineWidth = 3 * p.l + .5; ax.beginPath(); ax.arc(p.x, p.y, p.s, 0, 7); ax.stroke(); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.k === 0) { p.vx *= Math.pow(.2, dt); p.vy *= Math.pow(.3, dt); const r = p.s * (2.6 - p.l * 1.2), gr = ax.createRadialGradient(p.x + sx, p.y, 0, p.x + sx, p.y, r);
          gr.addColorStop(0, rgba(dc, p.l * .42)); gr.addColorStop(1, rgba(dc, 0)); ax.fillStyle = gr; ax.beginPath(); ax.arc(p.x + sx, p.y, r, 0, 7); ax.fill(); }
        else if (p.k === 1) { p.vy += 950 * dt; ax.strokeStyle = rgba(p.c, p.l); ax.lineWidth = 2; ax.lineCap = 'round'; ax.beginPath(); ax.moveTo(p.x, p.y); ax.lineTo(p.x - p.vx * .035, p.y - p.vy * .035); ax.stroke(); }
        else { p.vx *= Math.pow(.25, dt); const r = p.s * (2.6 - p.l), sc = dk ? [255, 255, 255] : [100, 110, 135], gr = ax.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          gr.addColorStop(0, rgba(sc, p.l * .34)); gr.addColorStop(1, rgba(sc, 0)); ax.fillStyle = gr; ax.beginPath(); ax.arc(p.x, p.y, r, 0, 7); ax.fill(); } }
      if (A.flash > .01) { ax.fillStyle = `rgba(255,244,225,${A.flash})`; ax.fillRect(0, 0, w, h); A.flash *= Math.pow(.002, dt); }
    }
    function tick(now) { if (!alive) return; const dt = Math.min(.05, (now - last) / 1000 || 0); last = now; frame(dt); requestAnimationFrame(tick); }
    const ro = new ResizeObserver(layout); ro.observe(el); layout(); requestAnimationFrame(tick);
    function destroy() { alive = false; A.gen++; ro.disconnect(); [A.bull, A.bear].forEach(f => f.rig && f.rig.destroy()); el.remove(); }
    return { el, hit, setVotes, setBalance, end, reset, say, destroy };
  }

  /* ================================================================================================
   * INTRO FIGHT: the two animals walk in, fight, and the bull knocks the bear out. About 11.5 seconds.
   * The host intro keeps its own captions, spotlights and logo and hooks into the callbacks.
   * ============================================================================================== */
  function createIntroFight(container, options) {
    const o = Object.assign({ floor: .72, autoStart: true }, options || {});
    const assets = Object.assign({}, DEFAULT_ASSETS, api.inlineAssets, o.assets), reduce = reducedMotion();
    const wrap = document.createElement('div'); wrap.className = 'bb-intro';
    wrap.innerHTML = `<canvas aria-hidden="true"></canvas><div class="bb-beast bb-bull"><div class="bb-fi">${imgTag(assets.bull, o.crossOrigin)}</div></div><div class="bb-beast bb-bear"><div class="bb-fi">${imgTag(assets.bear, o.crossOrigin)}</div></div>`;
    container.appendChild(wrap);
    const cv = wrap.querySelector('canvas'), g = cv.getContext('2d'), gbu = wrap.querySelector('.bb-bull'), gbe = wrap.querySelector('.bb-bear');
    const mkB = (el, d) => ({ el, d, x: 0, hx: 0, sp: 0, ox: 0, oy: 0, vx: 0, vy: 0, rot: 0, rotT: 0, free: false, fl: 0, c: [0, 0], rig: null }), BB = mkB(gbu, 1), EE = mkB(gbe, -1);
    BB.rig = makeRig(gbu, SPEC.bull, () => gbu.classList.contains('bb-on') && !gbu.classList.contains('bb-gone'));
    EE.rig = makeRig(gbe, SPEC.bear, () => gbe.classList.contains('bb-on') && !gbe.classList.contains('bb-gone'));
    const RB = SIZE.bull[1] / SIZE.bull[0], RE = SIZE.bear[1] / SIZE.bear[0];
    let W = 0, H = 0, bw = 300, ew = 276, t0 = 0, last = 0, T = 0, alive = true, started = false, fin = false, ei = 0, onMeet = null, shake = 0, flash = 0;
    const dustP = [], sparks = [], rings = [];
    const FY = () => H * o.floor, K = () => bw / 300, mB = () => W / 2 - bw * .93, mE = () => W / 2 - ew * .07;
    function size() { const d = Math.min(2, root.devicePixelRatio || 1); W = wrap.clientWidth; H = wrap.clientHeight; cv.width = Math.round(W * d); cv.height = Math.round(H * d); g.setTransform(d, 0, 0, d, 0, 0);
      bw = Math.round(o.size || Math.min(W * .27, H * .45, 410)); ew = Math.round(bw * .92);
      gbu.style.width = bw + 'px'; gbu.style.height = bw * RB + 'px'; gbe.style.width = ew + 'px'; gbe.style.height = ew * RE + 'px';
      if (!started) { BB.x = BB.hx = -bw * 1.1; EE.x = EE.hx = W + ew * .1; } }
    const puff = (x, n, pw) => { for (let i = 0; i < n; i++) dustP.push({ x: x + (rnd() - .5) * bw * .2, y: FY() - rnd() * 8, vx: (rnd() - .5) * 160 * pw, vy: -20 - rnd() * 90 * pw, l: 1, s: (8 + rnd() * 16) * pw }); };
    const sparkle = (x, y, n) => { for (let i = 0; i < n; i++) sparks.push({ x, y, vx: (rnd() - .5) * 1500, vy: -rnd() * 950 + 130, l: 1, s: 2 + rnd() * 3 }); };
    const go = (f, x, sp) => { f.hx = x; f.sp = sp * K(); };
    function hit(att, pow) {
      const def = att === BB ? EE : BB, k = K(), hx = (BB.x + BB.ox + bw * .95 + EE.x + EE.ox + ew * .05) / 2, hy = FY() - bw * .3;
      def.vx += -def.d * pow * 520 * k; def.vy = -pow * 330 * k; att.vx += att.d * pow * 120 * k; bodyAnim(att, 'lunge'); bodyAnim(def, 'recoil');
      puff(hx, Math.round(10 + pow * 14), 1.2 + pow * .6); sparkle(hx, hy, Math.round(20 + pow * 30)); shake = Math.max(shake, 6 + pow * 8); flash = Math.max(flash, .06 + pow * .09);
      if (o.onImpact) o.onImpact(pow, hx, hy);
    }
    function knockout() { const k = K(); hit(BB, 2.4); flash = .8; shake = 26; rings.push({ r: 30, a: 1 }, { r: 100, a: .85 });
      EE.free = true; EE.vx = 300 * k; EE.vy = -1150 * k; EE.rotT = 96; EE.fl = -ew * .13; gbe.classList.add('bb-ko'); gbe.classList.remove('bb-hurt'); if (o.onKnockout) o.onKnockout(); }
    function finish() { if (fin) return; fin = true; flash = .85; shake = 22; rings.push({ r: 30, a: 1 }, { r: 90, a: .9 }, { r: 170, a: .7 }); gbu.classList.add('bb-gone'); gbe.classList.add('bb-gone');
      sparkle(BB.c[0], BB.c[1], 110); puff(BB.c[0], 26, 3); if (o.onFinish) o.onFinish(BB.c[0], BB.c[1]); setTimeout(destroy, 2500); }
    /* the film, in seconds from start() */
    const EV = [
      [0, () => { gbu.classList.add('bb-on'); gbe.classList.add('bb-on'); go(BB, W * .08, 400); go(EE, W * .92 - ew, 400); }],
      [1.45, () => bodyAnim(EE, 'lunge')], [1.75, () => bodyAnim(BB, 'lunge')],
      [2.05, () => { go(BB, mB(), 1500); go(EE, mE(), 1300); onMeet = { f: () => { hit(BB, 1.5); BB.vx -= 420 * K(); BB.vy = -220 * K(); flash = .45; rings.push({ r: 30, a: .9 }); if (o.onClash) o.onClash(); } }; }],
      [3.7, () => hit(EE, .9)], [4.4, () => hit(BB, 1.1)],
      [5, () => { go(BB, mB() - 170 * K(), 520); go(EE, mE() + 170 * K(), 520); }],
      [5.8, () => { go(BB, mB(), 1500); go(EE, mE(), 1300); onMeet = { f: () => { hit(BB, 1.5); gbe.classList.add('bb-hurt'); } }; }],
      [6.6, () => { hit(BB, 1.1); go(BB, mB() + 80 * K(), 320); go(EE, mE() + 80 * K(), 320); }],
      [7.2, () => { go(BB, mB() - 330 * K(), 560); bodyAnim(EE, 'lunge'); }],
      [8, () => { go(BB, mB() + 80 * K(), 2400); onMeet = { solo: true, f: knockout }; }],
      [8.9, () => { BB.vy = -420 * K(); bodyAnim(BB, 'lunge'); if (o.onVictory) o.onVictory(); }], [9.4, () => { BB.vy = -420 * K(); }], [9.9, () => { BB.vy = -420 * K(); bodyAnim(BB, 'lunge'); }],
      [10.5, () => go(BB, W / 2 - bw / 2, 700)], [11.4, finish]];
    function frame(now) {
      if (!alive) return; if (!t0) { t0 = now; last = now; } const dt = Math.min(.05, (now - last) / 1000); last = now; T = (now - t0) / 1000;
      while (!fin && ei < EV.length && T >= EV[ei][0]) EV[ei++][1]();
      const fy = FY(), k = K();
      if (!fin) { [BB, EE].forEach(f => { const B = f === BB, fw = B ? bw : ew, fh = B ? bw * RB : ew * RE, dx = f.hx - f.x, stp = Math.sign(dx) * Math.min(Math.abs(dx), f.sp * dt), fast = f.sp > 900 * k; f.x += stp;
          if (f.free) { f.vy += 2600 * k * dt; f.ox = Math.min(f.ox + f.vx * dt, W - fw * 1.05 - f.x); f.oy += f.vy * dt; f.rot += (f.rotT - f.rot) * Math.min(1, dt * 4);
            if (f.oy >= f.fl) { f.oy = f.fl; if (f.vy > 200 * k) { puff(f.x + f.ox + fw / 2, 16, 2.2); shake = Math.max(shake, 12); f.vy *= -.3; f.vx *= .5; } else { f.vy = 0; f.vx *= Math.pow(.01, dt); } } }
          else { f.vx += (-f.ox * 40 - f.vx * 8) * dt; f.ox += f.vx * dt; f.vy += 2600 * k * dt; f.oy += f.vy * dt; if (f.oy > 0) { if (f.vy > 420 * k) puff(f.x + f.ox + fw / 2, 6, 1); f.oy = 0; f.vy = 0; } }
          const moving = Math.abs(stp) > .4, grounded = f.oy === 0 && !f.free; if (f.rig) f.rig.walk = moving && grounded ? (fast ? 1.5 : 1) : 0;
          const bob = moving && grounded ? Math.sin(T * (fast ? 24 : 11)) * bw * .012 : 0;
          if (moving && grounded && rnd() < (fast ? .9 : .35)) puff(f.x + fw * (B ? .3 : .6), fast ? 2 : 1, fast ? 1.5 : .8);
          f.el.style.transform = `translate(${f.x + f.ox}px,${fy - fh + f.oy + bob}px) rotate(${f.rot}deg)`; f.c = [f.x + f.ox + fw * (B ? .55 : .45), fy - fh * .5 + f.oy]; });
        if (onMeet && Math.abs(BB.hx - BB.x) < 3 && (onMeet.solo || Math.abs(EE.hx - EE.x) < 3)) { const f = onMeet.f; onMeet = null; f(); }
        if (o.onFrame) o.onFrame({ bull: BB.c, bear: EE.c, t: T }); }
      /* dust, sparks, rings, flash */
      wrap.style.transform = shake > .4 ? `translate(${(rnd() - .5) * shake}px,${(rnd() - .5) * shake}px)` : ''; shake *= Math.pow(.004, dt);
      g.clearRect(0, 0, W, H);
      for (let i = dustP.length - 1; i >= 0; i--) { const d = dustP[i]; d.l -= dt * .75; if (d.l <= 0) { dustP.splice(i, 1); continue; } d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= Math.pow(.25, dt); d.vy *= Math.pow(.35, dt);
        const r = d.s * (2.8 - d.l * 1.2), gr = g.createRadialGradient(d.x, d.y, 0, d.x, d.y, r); gr.addColorStop(0, `rgba(196,184,166,${d.l * .17})`); gr.addColorStop(1, 'rgba(196,184,166,0)'); g.fillStyle = gr; g.beginPath(); g.arc(d.x, d.y, r, 0, 7); g.fill(); }
      g.globalCompositeOperation = 'lighter';
      for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.l -= dt * 1.8; if (s.l <= 0) { sparks.splice(i, 1); continue; } s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 180 * dt; g.fillStyle = `rgba(255,200,130,${s.l})`; g.fillRect(s.x, s.y, s.s, s.s); }
      for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.r += dt * 900; r.a -= dt * .9; if (r.a <= 0) { rings.splice(i, 1); continue; } g.strokeStyle = `rgba(255,190,130,${r.a * .7})`; g.lineWidth = 3 * r.a + .5; g.beginPath(); g.arc(W / 2, fy - bw * .3, r.r, 0, 7); g.stroke(); }
      if (flash > .01) { g.fillStyle = `rgba(255,235,215,${flash})`; g.fillRect(0, 0, W, H); flash *= Math.pow(.004, dt); }
      g.globalCompositeOperation = 'source-over';
      requestAnimationFrame(frame);
    }
    function start() { if (started) return; size(); started = true; if (reduce) { finish(); return; } requestAnimationFrame(frame); }
    function skip() { if (!started) started = true; finish(); }
    function destroy() { if (!alive) return; alive = false; ro.disconnect(); [BB, EE].forEach(f => f.rig && f.rig.destroy()); wrap.remove(); }
    const ro = new ResizeObserver(size); ro.observe(wrap); size();
    if (o.autoStart) start();
    return { el: wrap, start, skip, destroy, get centers() { return { bull: BB.c, bear: EE.c }; }, duration: 11.4 };
  }

  const api = { createArena, createIntroFight, version: '1.0.0' };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BullBear = api;
})(typeof window !== 'undefined' ? window : this);
