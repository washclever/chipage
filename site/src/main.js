// The page: scroll drives one number g (in screens). g gives the state of the film (film.js), and the stage (stage.js) draws
// that state live on the GPU, through a camera the pointer can turn a little. What is drawn over it in 2D (fx.js) and the
// words placed on the scene use the same camera. g also decides which words are on screen.
import * as F from './film.js';
import * as M from './memory.js';
import { createFx } from './fx.js';
import { COPY } from './copy.js';
import { createDrawing } from './sketch.js';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t, smooth = F.smooth;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const cv = $('#stage');
const ST = F.STATIONS, TOTAL = F.TOTAL, Q = new URLSearchParams(location.search);

// ───────── words
const stEls = $$('#copy .st'), rail = $('#rail'), legend = $('#legend ol'), labelsBox = $('#labels'), logo = $('#logo'), prompt = $('#prompt'), tip = $('#tip');
const railBtns = ST.map((b, i) => { const bt = el('button'); bt.type = 'button'; bt.append(el('span'), el('i')); rail.append(bt);
  bt.addEventListener('click', () => window.scrollTo({ top: (i === 0 ? 0 : b.at) * innerHeight, behavior: 'smooth' })); return bt; });
// the layers of the legend: colour (as the flat layout is drawn), the order they rise in, the height at which each is complete
const LEG = [['#1a33f2', 0.05, 1.4], ['#ff4210', 0.15, 5], ['#ff9e1f', 0.28, 12], ['#298cff', 0.4, 15.2], ['#a8d6ff', 0.62, 25.4], ['#d1ebff', 0.76, 31], ['#80b3ff', 0.84, 39], ['#ffe0a8', 1, 59]];
const legEls = LEG.map(([c]) => { const li = el('li'); li.style.setProperty('--c', c); li.append(el('i'), el('span')); legend.append(li); return li; });
// names on the whole schematic, and on the one cell it starts from
const CX0 = M.colX(3), CZ0 = M.rowZ(4);
const NAMES = [...M.LABELS.map(l => ({ t: l[0], p: [l[1], 0.6, l[2]], on: 'schem' })),
  ...[['WL', -12, -8], ['BL', -11, 9.6], ['BLB', 11, 9.6], ['Q', -4.4, -1.6], ['QB', 4.6, 0.9], ['1 bit', -3.4, -11]].map(l => ({ t: l[0], p: [CX0 + l[1], 0.6, CZ0 + l[2]], on: 'cell' }))];
const nameEls = NAMES.map(n => { const s = el('span', null, n.t); labelsBox.append(s); return s; });
let lang = Q.get('lang') === 'en' ? 'en' : 'ko', T = COPY[lang];
function setLang(l) {
  lang = l; T = COPY[l]; document.documentElement.lang = l;
  $$('[data-t]').forEach(e => { const v = e.dataset.t.split('.').reduce((o, k) => o && o[k], T); if (v != null) e.textContent = v; });
  stEls.forEach((s, i) => { const d = T.s[i]; $('.k', s).textContent = d.k; $('.h', s).textContent = d.h; $('.p', s).textContent = d.p || '';
    const n = $('.n', s); if (n) n.textContent = d.n || '';
    const ul = $('.list', s); if (ul) ul.replaceChildren(...(d.list || []).map(r => { const li = el('li'); li.append(el('b', null, r[0]), el('span', null, r[1])); return li; })); });
  railBtns.forEach((b, i) => { b.firstChild.textContent = T.nav[i]; });
  legEls.forEach((li, i) => { li.lastChild.textContent = T.layerNames[i]; });
  $('#notice .other').textContent = COPY[l === 'ko' ? 'en' : 'ko'].warn;          // the warning in the other language too: there is no switching while it loads
}
$('.lang').addEventListener('click', () => setLang(lang === 'ko' ? 'en' : 'ko'));
$$('a[href="#deck"], .brand').forEach(a => a.addEventListener('click', e => { e.preventDefault();
  window.scrollTo({ top: a.classList.contains('brand') ? 0 : TOTAL * innerHeight, behavior: 'smooth' }); }));
setLang(lang);
$('#track').style.height = `calc(${(TOTAL + 1).toFixed(3)} * 100vh)`;

// the ring that trails the pointer
(() => { const c = $('#cur'); let x = 0, y = 0, tx = 0, ty = 0, seen = false;
  addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; tx = e.clientX; ty = e.clientY; if (!seen) { seen = true; x = tx; y = ty; c.classList.add('on'); }
    c.classList.toggle('hot', e.target instanceof Element && !!e.target.closest('a, button')); }, { passive: true });
  document.addEventListener('pointerleave', () => { seen = false; c.classList.remove('on'); });
  const step = () => { x += (tx - x) * 0.18; y += (ty - y) * 0.18; c.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`; requestAnimationFrame(step); }; requestAnimationFrame(step); })();

// ───────── the stage. three.js and the shaders load after the words are on screen; where neither WebGPU nor WebGL 2 is there,
// the words stay on their own (style.css, .nogl). ?webgl forces the WebGL 2 path, ?msaa=0 turns multisampling off.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ───────── the loading: while the scene loads, the page shows the construction drawing of what it is about to show
// (sketch.js). Where the browser allows it, the drawing runs on a thread of its own (sketch.worker.js), so that building the
// scene and compiling its shaders, which keep this thread busy for seconds, cannot hold it back; elsewhere it runs here.
// The drawing is the plan, seen from straight above (film.js, TOP). Once it is finished and the stage is ready, the stage
// takes the drawing over as a picture and turns it into the scene cell by cell on the plan's grid, outward from the chip
// (stage.js, the last pass; REVEAL seconds); then, from SWING_AT on and as the last cells open, the camera turns down from
// above into the first camera of the film (SWING seconds), while the far side of the lake comes in and the forge catches
// fire. A visitor who scrolls, presses or types meanwhile is not kept waiting: the rest of it runs RUSH times as fast.
const useLoader = !still && (!Q.has('probe') || Q.has('loader'));
const REVEAL = 1.6, SWING_AT = 1.25, SWING = 1.9, RUSH = 3.5;
const sketch = (() => {
  let c = $('#sketch'), at = [0.5, 0.5], live = true, hurried = false, finished = null, worker = null, here = null, open = null;
  const opened = new Promise(r => { open = r; setTimeout(r, 1200); });          // the drawing's first lines are down (or it has been long enough)
  if (!useLoader) { open(); c.remove(); document.documentElement.classList.add('notice'); setTimeout(() => document.documentElement.classList.remove('notice'), 7000);          // (the warning, for a while, even without the loading)
    return { done: () => true, canvas: null, at, opened, stop() {}, hurry() {} }; }
  document.documentElement.classList.add('loading');
  // the drawing is of the first picture: the film starts at its beginning, and stays there until the scene is in
  try { history.scrollRestoration = 'manual'; } catch (e) { /* not allowed here: nothing lost */ } scrollTo(0, 0);
  const size = () => ({ w: c.clientWidth, h: c.clientHeight, dpr: Math.min(devicePixelRatio || 1, 2) });
  // drawn here, on this thread: its own loop, which ends with the drawing; the canvas itself is then the finished picture
  function onPage() {
    const d = createDrawing(c, (w, h) => { const k = document.createElement('canvas'); k.width = w; k.height = h; return k; });
    const z = size(); d.build(z.w, z.h, z.dpr); at = d.at; if (hurried) d.hurry();
    here = { d, running: false, run() { if (this.running) return; this.running = true;
      const step = now => { if (!live) return; if (d.clock >= 0.8) open(); if (d.draw(now)) requestAnimationFrame(step); else { open(); this.running = false; finished = c; } }; requestAnimationFrame(step); } };
    here.run();
  }
  // the worker could not draw (it did not start, or the canvas has no 2D context there): a fresh canvas in place of the one
  // it was handed, drawn here
  function fallback(why) {
    if (!live || here) return;
    console.warn('loading drawing on the page:', why);
    worker?.terminate(); worker = null;
    const n = document.createElement('canvas'); n.id = 'sketch'; n.setAttribute('aria-hidden', 'true'); c.replaceWith(n); c = n;
    finished = null; onPage();
  }
  // a worker can draw where the canvas can be handed over and module workers run (the getter is read only by browsers that
  // know the option; the bad address then stops the test before any worker starts)
  const canHand = (() => { if (typeof OffscreenCanvas === 'undefined' || !('transferControlToOffscreen' in HTMLCanvasElement.prototype)) return false;
    let mod = false; try { new Worker('blob://', { get type() { mod = true; return 'module'; } }).terminate(); } catch (e) { /* expected */ } return mod; })();
  if (canHand) {
    try {
      const off = c.transferControlToOffscreen();
      worker = new Worker(new URL('./sketch.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => { const m = e.data; if (!live) return;
        if (m.at) at = m.at;
        if (m.opened) open();
        if (m.failed) { open(); fallback(m.failed); }
        else if (m.done) { if (m.log) window.__sketchLog = m.log; const k = document.createElement('canvas'); k.width = m.bmp.width; k.height = m.bmp.height; k.getContext('2d').drawImage(m.bmp, 0, 0); m.bmp.close(); finished = k; } };
      worker.onerror = e => { e.preventDefault(); fallback(e.message || 'the worker failed'); };
      worker.postMessage({ canvas: off, ...size(), log: Q.has('sketchlog') }, [off]);
      if (hurried) worker.postMessage({ hurry: true });
    } catch (e) { fallback(e); }
  } else onPage();
  addEventListener('resize', () => { if (!live) return; const z = size();
    if (worker) { finished = null; worker.postMessage({ size: true, ...z }); }
    else if (here) { finished = null; here.d.resize(z.w, z.h, z.dpr); at = here.d.at; here.run(); } });
  return {
    get canvas() { return finished; }, get at() { return at; }, opened,
    done: () => !!finished,
    hurry() { hurried = true; if (worker) worker.postMessage({ hurry: true }); else here?.d.hurry(); },
    stop() { if (!live) return; live = false; if (worker) { worker.postMessage({ stop: true }); worker = null; } c.remove(); } };
})();

const T0 = performance.now(), mark = k => { if (Q.has('sketchlog')) (window.__loadTimes ||= {})[k] = Math.round(performance.now() - T0); };          // (tests: when each step of the loading ended)
import('./stage.js').then(S => (mark('imported'), S.createStage(cv, { webgl: Q.has('webgl'), samples: Q.has('msaa') ? +Q.get('msaa') : undefined, embers: Q.has('embers') ? +Q.get('embers') : undefined,
  probe: Q.has('probe'), hide: (Q.get('hide') || '').split(',').filter(Boolean), debug: Q.has('debug'), full: Q.has('full') })))
  .then(stage => (mark('created'), (Q.has('nodelay') ? Promise.resolve() : sketch.opened).then(() => stage.prepare()).then(() => (mark('compiled'), stage))))          // (the compiling holds the graphics card: it waits until the drawing's first lines are down)          // every shader compiled before the first picture, while the drawing is on
  .then(start, e => { console.warn('no live stage:', e); sketch.stop(); document.documentElement.classList.remove('loading'); document.documentElement.classList.add('nogl'); });

function start(stage) {
  sketch.hurry();          // the scene is ready: the drawing finishes now, quickly
  const fx = createFx($('#fx'), { prompt, tip });
  // the loading: -1 while the drawing is still the page's own; then the time the stage took it over. u: how far the plan has
  // turned into the scene; k: how far the camera has turned down from above; v: the two together, 1 once all is in
  const loader = { on: useLoader, t: -1, el: 0, rush: false, u: useLoader ? 0 : 1, k: useLoader ? 0 : 1, v: useLoader ? 0 : 1, drop: 0, fix: null };          // el: how far the intro has run; fix: (tests) held at so many seconds
  for (const ev of ['wheel', 'keydown', 'pointerdown', 'touchstart']) addEventListener(ev, () => { if (loader.on && loader.t >= 0) loader.rush = true; }, { passive: true });

  // ───────── state
  const dprMax = Q.has('dpr') ? +Q.get('dpr') : Math.min(window.devicePixelRatio || 1, 1.5), fixed = Q.has('dpr');
  let W = 1, H = 1, dpr = dprMax, rect = [0, 0, 1, 1], portrait = false;
  function resize() { const cw = cv.clientWidth, ch = cv.clientHeight; W = Math.round(cw * dpr); H = Math.round(ch * dpr); portrait = W / H < 0.9; stage.resize(cw, ch, dpr); fx.resize(); }
  addEventListener('resize', resize); resize();
  // the frame rate decides the resolution: fewer pixels while it is slow, more again once it has been fast for a while
  let ft = 16, slow = 0, fast = 0;
  function adapt(ms) { ft += (Math.min(ms, 200) - ft) * 0.05;
    if (ft > 26 && dpr > 0.6) { if (++slow > 45) { dpr = Math.max(0.6, +(dpr - 0.15).toFixed(2)); slow = 0; ft = 20; resize(); } } else slow = 0;
    if (ft < 12.5 && dpr < dprMax) { if (++fast > 150) { dpr = Math.min(dprMax, +(dpr + 0.1).toFixed(2)); fast = 0; resize(); } } else fast = 0; }

  // ───────── the pointer. It turns the scene about its upright axis, two ways at once:
  //   spin   a drag takes hold of the scene and turns it, as far as the hand goes: all the way round and on. Let go and
  //          it comes back to the angle the scene is made to be seen from (the nearest whole turn, so that it never winds
  //          back round): a spring (HOME, its strength and its damping) that a throw first carries on with the speed it had,
  //          and that brings it home with a little swing past and a settle; press again and it stops in the hand. With the
  //          mouse any drag turns it; with a finger only a sideways stroke does, so that an upward or downward one still
  //          scrolls the page (style.css).
  //   look   where the mouse rests, the scene turns a little toward it (YAW degrees at the edge of the page), late and with
  //          a weight of its own: a spring that swings past and settles.
  // The camera banks into the turn, the more the faster the scene turns (BANK degrees for each degree a second, BANK_MAX at
  // most). Where the visitor asks for less motion, a drag still turns it, but it comes back without a throw or a swing, and
  // it does not bank.
  const ptr = { x: innerWidth * 0.6, y: innerHeight * 0.5, sx: 0, sy: 0, last: -1e9, inside: false, touch: false, down: false, finger: false };
  const rot = { spin: 0, vs: 0, to: 0, look: 0, vl: 0, aim: 0, pitch: 0, vp: 0, roll: 0 };
  const YAW = 9, PITCH = 2.2, K = 20, DAMP = 3.8, SPIN = 300, FLING = 720, BANK = 0.03, BANK_MAX = 5;          // SPIN: degrees for a drag across the whole page; FLING: the fastest a throw turns it (degrees a second)
  const HOME = [22, 7];          // the spring back to the scene's own angle: about 1.3 s to come home, a little swing past (a damping of three quarters)
  const drag = { id: -1, x0: 0, y0: 0, lx: 0, on: false, v: 0 };          // the pointer that may hold the scene; on: it holds it
  const ui = e => e.target instanceof Element && !!e.target.closest('a, button, .top, #rail');
  const hold = x => { drag.on = true; drag.lx = x; drag.v = 0; ptr.down = true; rot.to = rot.spin; rot.vs = 0; document.documentElement.classList.add('grab'); };
  const release = e => { if (e && e.pointerId != null && e.pointerId !== drag.id) return;
    if (drag.on) { rot.vs = still ? 0 : clamp(drag.v, -FLING, FLING); document.documentElement.classList.remove('grab'); }
    drag.id = -1; drag.on = false; ptr.down = false; };
  addEventListener('pointermove', e => { ptr.touch = e.pointerType === 'touch'; ptr.x = e.clientX; ptr.y = e.clientY; ptr.last = performance.now(); ptr.inside = true;
    if (e.pointerId !== drag.id) return;
    if (!drag.on) { const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;          // a finger: not yet a turn
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { drag.id = -1; return; }          // up or down: the page scrolls
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      hold(drag.x0); }
    rot.to -= (e.clientX - drag.lx) * SPIN / Math.max(innerWidth, 320); drag.lx = e.clientX; }, { passive: true });
  addEventListener('pointerdown', e => { if (ui(e) || loader.on || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.id = e.pointerId; drag.x0 = e.clientX; drag.y0 = e.clientY; drag.on = false;
    if (e.pointerType !== 'touch') { ptr.press = true; hold(e.clientX); } });
  addEventListener('pointerup', release); addEventListener('pointercancel', release); addEventListener('blur', () => release());
  document.addEventListener('pointerleave', () => { ptr.inside = false; release(); });
  // A finger on a phone or a tablet stirs the water where it goes, as the mouse does (below), and a finger set down pushes
  // the water out from under it at once. On the chip it is the place it presses that comes apart (the mouse opens the chip
  // where it rests): the parts there lift at once and settle as soon as it lets go. It does not turn the scene toward it.
  // Touch events, because once a finger starts scrolling the page the browser stops sending pointer events for it, and goes
  // on sending touch events.
  const finger = e => { const t = e.touches[0]; if (!t) return false; ptr.touch = true; ptr.x = t.clientX; ptr.y = t.clientY; ptr.last = performance.now(); ptr.inside = true; return true; };
  addEventListener('touchstart', e => { if (ui(e) || loader.on || !finger(e)) return;
    ptr.finger = true; ptr.press = true; }, { passive: true });
  addEventListener('touchmove', e => { if (ptr.finger) finger(e); }, { passive: true });
  const lift = e => { if (!e.touches.length) { ptr.finger = false; ptr.inside = false; } };
  addEventListener('touchend', lift, { passive: true }); addEventListener('touchcancel', lift, { passive: true });
  // where the pointer rests on the chip, the layers part (stage.js): the place follows the pointer late, the parting springs open
  const hov = { x: 0, z: 0, a: 0, a1: 0, rest: 0 }, stir = { on: false, x: 0, y: 0, pace: 0 };          // stir: where the pointer was on the page a frame ago, if it was stirring the water, and how fast it has been going
  // The strike of the metal on the chip. It is set off when the scroll passes the place in the film where the metal lands
  // (either way), and from then on it runs in its own time: the filings fly, the picture is knocked aside and rolls, the lens punches in, a ring
  // runs out over the lake and another after it. kick is what is left of it, 1 at the blow.
  const jolt = { x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, f: 0, vf: 0 }, later = [];
  let kick = 0, speed = 0, blows = 0;
  function strike(power = 1) {
    const s = F.state(g), side = blows++ % 2 ? -1 : 1;
    stage.blow(0, F.BODY + F.LOOSE * s.loose, 0, power); stage.ring(0, 0, 2.2 * power); later.push([0.13, () => stage.ring(0, 0, 1.1 * power)]);
    kick = Math.max(kick, power); jolt.vy += 640 * power; jolt.vx += side * (200 + 160 * Math.random()) * power; jolt.vr += side * 34 * power; jolt.vf -= 44 * power;
  }
  // a spring toward a value, stepped finely enough to stay a spring however slow the frames are
  const spring = (o, x, v, to, k, c, dt) => { const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n; for (let i = 0; i < n; i++) { o[v] += (-k * (o[x] - to) - c * o[v]) * h; o[x] += o[v] * h; } };

  let g = clamp(scrollY / innerHeight, 0, TOTAL - 1e-3), gPrev = g, last = performance.now(), time = 0, fade = Q.has('probe') && !useLoader ? 1 : 0, orb = 0, jump = null, frames = 0, castKey = '', flyPrev = 0;
  const FA = 16 / 9, lens = { f: -1, b: 0 };          // lens: the distance it is focused at, and how much it breathes
  const BRUSH = 36;          // how wide the pointer stirs the water: this many pixels of the page, wherever on the water it is

  function show(e, v, shift = 14) { const on = v > 0.004; if (e._on !== on) { e._on = on; e.style.visibility = on ? 'visible' : 'hidden'; }
    if (on) { e.style.opacity = v.toFixed(3); e.style.transform = `translate3d(0,${((1 - v) * shift).toFixed(1)}px,0)`; } }

  let fails = 0, dead = false;
  function tick(now) {
    requestAnimationFrame(tick);          // first, so that the words keep following the scroll whatever happens below
    const ms = now - last, dt = Math.min(0.05, ms / 1000); last = now; time += dt; if (frames++ > 10 && !fixed) adapt(ms);
    const gT = clamp(scrollY / innerHeight, 0, TOTAL - 1e-3); gPrev = g; g += (gT - g) * (1 - Math.exp(-dt / 0.14)); if (Math.abs(gT - g) < 2e-4) g = gT;
    let cut = false; if (jump != null) { g = gPrev = jump; jump = null; cut = true; lens.f = -1; }
    const s = F.state(g), ord = F.order(s);
    // the loading: once the drawing is finished and the stage has drawn a few frames under it, the stage takes the drawing over
    // (and the page's own copy of it goes, two frames later); then the plan turns into the scene, and the camera turns down
    if (loader.on) {
      if (loader.t < 0) { if (sketch.done() && frames > 4) { stage.sketch(sketch.canvas, sketch.at); loader.t = time; loader.drop = frames + 2; } }
      else { loader.el += dt * (loader.rush ? RUSH : 1); const t = loader.fix ?? loader.el, u = clamp(t / REVEAL, 0, 1); loader.u = u * u * (3 - 2 * u); loader.k = clamp((t - SWING_AT) / SWING, 0, 1); loader.v = (loader.u + loader.k) / 2;
        if (frames === loader.drop) sketch.stop();
        if (t > 0.8) document.documentElement.classList.remove('loading');
        // as the cells open under the line of the company, its letters catch a little of the glow
        stEls[0].style.setProperty('--heat', (smooth(0.42, 0.6, loader.u) * (1 - smooth(0.7, 0.98, loader.u))).toFixed(3));
        if (loader.k >= 1) { loader.on = false; loader.v = 1; sketch.stop(); stEls[0].style.removeProperty('--heat'); } }
    }
    const calm = loader.on ? 0 : 1;          // until the scene is in, the pointer does not move it
    // where the picture sits: the film is 16:9 and covers a wide screen; on a tall one it is a band near the top
    // (between the two, a screen less wide than the film crops its sides only so far, then lets it fall short above and below).
    // The canvas shows that part of the film's frame; the camera's view is offset to match (stage.js).
    let rw; if (portrait) rw = W * 1.7; else rw = Math.max(W, Math.min(H * FA, W * 1.22));
    rw *= 1.03; const rh = rw / FA;
    const nx = (ptr.x / innerWidth * 2 - 1) * calm, ny = (ptr.y / innerHeight * 2 - 1) * calm; ptr.sx += (nx - ptr.sx) * 0.035; ptr.sy += (ny - ptr.sy) * 0.035;      // the picture leans a little toward the pointer
    // the strike of the metal
    for (const gb of F.BLOWS_G) if ((gPrev < gb && g >= gb) || (gPrev > gb && g <= gb)) strike();
    for (let i = later.length - 1; i >= 0; i--) { later[i][0] -= dt; if (later[i][0] <= 0) { const fn = later[i][1]; later.splice(i, 1); fn(); } }
    kick *= Math.exp(-dt / 0.2);
    spring(jolt, 'x', 'vx', 0, 1400, 26, dt); spring(jolt, 'y', 'vy', 0, 1400, 26, dt); spring(jolt, 'r', 'vr', 0, 520, 15, dt); spring(jolt, 'f', 'vf', 0, 300, 22, dt);
    // how fast the film is being scrolled (screens a second): the lens narrows a little with it, the picture banks, colours part at its edges
    const vg = (g - gPrev) / Math.max(dt, 1e-3); speed += (Math.min(Math.abs(vg), 3) - speed) * (1 - Math.exp(-dt / 0.2));
    rect = [(W - rw) / 2 - ptr.sx * 7 * dpr - (portrait ? rw * 0.05 : 0) + jolt.x * dpr, (portrait ? H - rh - H * 0.06 : (H - rh) / 2) + ptr.sy * 5 * dpr + jolt.y * dpr, rw, rh];

    // the turn of the scene: in the hand while it is held (following it closely); once it is let go, carried on by the
    // throw and pulled back to the nearest whole turn; and over it the look toward where the mouse rests (held still while
    // the scene is held)
    if (ptr.down) { const s0 = rot.spin; rot.spin += (rot.to - rot.spin) * (1 - Math.exp(-dt / 0.04)); rot.vs = (rot.spin - s0) / Math.max(dt, 1e-3);
      drag.v += (rot.vs - drag.v) * (1 - Math.exp(-dt / 0.06)); }          // the speed of the hand, for the throw when it lets go
    else { const home = Math.round(rot.spin / 360) * 360;
      spring(rot, 'spin', 'vs', home, HOME[0], still ? 2 * Math.sqrt(HOME[0]) : HOME[1], dt);
      if (Math.abs(rot.spin - home) < 0.02 && Math.abs(rot.vs) < 0.2) { rot.spin = home; rot.vs = 0; } }
    orb += ((ptr.inside && !ptr.touch && !still ? calm : 0) - orb) * (1 - Math.exp(-dt / 0.6));
    if (!ptr.down) rot.aim = clamp(nx, -1, 1) * YAW * orb;
    rot.vl += (-K * (rot.look - rot.aim) - DAMP * rot.vl) * dt; rot.look += rot.vl * dt;
    rot.vp += (-K * (rot.pitch + clamp(ny, -1, 1) * PITCH * orb) - DAMP * rot.vp) * dt; rot.pitch += rot.vp * dt;
    rot.roll += ((still ? 0 : clamp(-(rot.vs + rot.vl) * BANK, -BANK_MAX, BANK_MAX)) - rot.roll) * (1 - Math.exp(-dt / 0.25));          // it banks into the turn
    // the camera of the film, and over it: the turn the pointer gives it, the slow sway of a camera held in the hand (more
    // while the metal falls), and what the blow and the scroll do to it
    const CAMQ = Q.get('cam');          // (tests: ?cam= eight numbers, the film's camera replaced by one held still, looking where its numbers say)
    const cam = CAMQ ? CAMQ.split(',').map(Number) : s.c.slice(), hh = (still ? 0 : s.id === 'strike' ? 1.7 : s.hold ? 1 : 0.7) * loader.v * loader.v, sp = Math.min(speed, 1.3);
    cam[0] += rot.spin + rot.look + (Math.sin(time * 0.37 + 1.3) + 0.6 * Math.sin(time * 0.83 + 4.1)) * 0.17 * hh;
    cam[1] = clamp(cam[1] + rot.pitch + (Math.sin(time * 0.29 + 2.7) + 0.6 * Math.sin(time * 0.71 + 0.4)) * 0.10 * hh, Math.min(-4, s.c[1] - 3), 86);          // (no lower than the film itself goes: it looks up from low over the water)
    cam[6] += jolt.f - sp * 1.7 + lens.b;
    cam[7] += rot.roll + jolt.r + Math.sin(time * 0.23 + 5.0) * 0.13 * hh + clamp(vg, -2, 2) * 0.45;
    // while loading, the camera is the plan's, straight above (film.js, TOP); then it turns down from there into the camera
    // of the film: how high it looks from first, then how far off it is and where it looks, and last how wide it sees
    const view = loader.k < 1 ? (() => { const T = F.TOP, k = loader.k, e = (a, b) => F.ease(clamp((k - a) / (b - a), 0, 1)), kh = e(0, 0.85), kd = e(0.08, 1), kf = e(0.2, 1);
      const c = T.map((v, i) => lerp(v, cam[i], i === 1 ? kh : i === 6 ? kf : kd));
      return F.place(c, T.slice(3, 6).map((v, i) => lerp(v, s.look[i], kd))); })() : F.place(cam, CAMQ ? null : s.look);
    // The lens's focus follows the distance of what is looked at, late, so that after a move the new subject comes into focus a
    // moment after the camera has come to it; while the focus travels, the picture breathes a little (a lens's angle of view
    // changes as it focuses: the fov above, from the frame before).
    { const fd = Math.hypot(view.tgt[0] - view.cam[0], view.tgt[1] - view.cam[1], view.tgt[2] - view.cam[2]), f0 = lens.f < 0 ? fd : lens.f;
      lens.f = f0 + (fd - f0) * (1 - Math.exp(-dt / 0.45));
      lens.b += ((still ? 0 : clamp((lens.f - f0) / Math.max(dt, 1e-3) / Math.max(fd, 1) * 0.8, -0.5, 0.5)) - lens.b) * (1 - Math.exp(-dt / 0.15)); }
    // the camera of this moment: a point of the scene → where it is in the film's frame (0..1, y up) and how far away
    const fw = (() => { const d = [view.tgt[0] - view.cam[0], view.tgt[1] - view.cam[1], view.tgt[2] - view.cam[2]], l = Math.hypot(...d); return d.map(v => v / l); })();
    const rt0 = (() => { const d = [-fw[2], 0, fw[0]], l = Math.hypot(...d); return d.map(v => v / l); })();           // forward × up
    const up0 = [rt0[1] * fw[2] - rt0[2] * fw[1], rt0[2] * fw[0] - rt0[0] * fw[2], rt0[0] * fw[1] - rt0[1] * fw[0]];
    const cr = Math.cos(view.roll * Math.PI / 180), sr = Math.sin(view.roll * Math.PI / 180), rt = rt0.map((v, i) => v * cr + up0[i] * sr), up = up0.map((v, i) => v * cr - rt0[i] * sr);      // … rolled about the line of sight
    const fl = 1 / Math.tan(view.fov * Math.PI / 360);
    const uvOf = p => { const v = [p[0] - view.cam[0], p[1] - view.cam[1], p[2] - view.cam[2]], z = v[0] * fw[0] + v[1] * fw[1] + v[2] * fw[2]; if (z < 1) return null;
      return [0.5 + 0.5 * fl * (v[0] * rt[0] + v[1] * rt[1] + v[2] * rt[2]) / z / FA, 0.5 + 0.5 * fl * (v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / z, z]; };
    const P = p => { const q = uvOf(p); return q && [(rect[0] + q[0] * rect[2]) / dpr, (H - (rect[1] + q[1] * rect[3])) / dpr, q[2]]; };
    // … and back: the line of sight through a place on the page; the point of a level plane (height y) that lies under it;
    // the first point of an upright block (centre c, half sizes hw and hd, from height y0 to y1) that it meets
    const ray = (px, py) => { const u = (px * dpr - rect[0]) / rect[2] * 2 - 1, v = ((H - py * dpr) - rect[1]) / rect[3] * 2 - 1;
      return [fw[0] * fl + rt[0] * u * FA + up[0] * v, fw[1] * fl + rt[1] * u * FA + up[1] * v, fw[2] * fl + rt[2] * u * FA + up[2] * v]; };
    const under = (px, py, y) => { const d = ray(px, py), t = (y - view.cam[1]) / d[1];
      return t > 0 ? [view.cam[0] + d[0] * t, view.cam[2] + d[2] * t] : null; };
    const onBlock = (px, py, c, hw, hd, y0, y1) => { const d = ray(px, py), o = view.cam; let t0 = 0, t1 = Infinity;
      for (const [i, lo, hi] of [[0, c[0] - hw, c[0] + hw], [1, y0, y1], [2, c[2] - hd, c[2] + hd]]) {
        if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo || o[i] > hi) return null; continue; }
        const a = (lo - o[i]) / d[i], b = (hi - o[i]) / d[i]; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); if (t0 > t1) return null; }
      return [o[0] + d[0] * t0, o[2] + d[2] * t0]; };

    // The pointer stirs the water (fluid.js) rather than bending the picture: where its line of sight meets the water (or,
    // later, the wafer), the way it has gone there since the last frame, both places found with the camera of now (so that
    // the camera's own moving stirs nothing), as wide as BRUSH pixels of the page are there; and a press. A jump (the
    // pointer coming in, a finger set down somewhere else) only sets where it is. Until the scene is in, it stirs nothing.
    // With each stroke goes how fast the pointer has been going on the page, in screens a second (of the window's shorter
    // side, so that a flick across a phone counts as much as one across a desktop), a little smoothed: the water answers
    // an easy move gently and a fast one, a flick or a fast drag, much harder (fluid.js).
    const strokes = [];
    { const on = calm && ptr.inside && (!ptr.touch || ptr.finger), y = -s.lift;
      const q = on ? under(ptr.x, ptr.y, y) : null, q0 = q && stir.on ? under(stir.x, stir.y, y) : null;
      const moved = Math.hypot(ptr.x - stir.x, ptr.y - stir.y), went = q0 && moved < innerHeight * 0.6;
      stir.pace = went ? stir.pace + (moved / Math.max(ms / 1000, 1e-3) / Math.min(innerWidth, innerHeight) - stir.pace) * (1 - Math.exp(-dt / 0.04)) : 0;          // (over the time that really passed: a slow frame is not a fast stroke)
      if (q) { const z = (q[0] - view.cam[0]) * fw[0] + (y - view.cam[1]) * fw[1] + (q[1] - view.cam[2]) * fw[2], r = clamp(BRUSH * z * 2 / (fl * rect[3] / dpr), 18, 160);
        if (went) strokes.push([q0[0], q0[1], q[0], q[1], r, dt, 0, stir.pace]);
        if (ptr.press) strokes.push([q[0], q[1], q[0], q[1], r * 1.4, dt, 1, 0]); }
      stir.on = !!q; stir.x = ptr.x; stir.y = ptr.y; ptr.press = false; }
    // The chip answers the pointer only where it stands whole and alone: on its anvil at the start, glowing, before the hammer
    // (once the scene is in), the chip, the layout of light. With the mouse, where it rests: the place follows the pointer
    // late, and how far the parts have come loose follows its target through two lags in a row, so that they start slowly,
    // travel, and settle without a jerk. With a finger, where it presses and for as long as it stays down (not while it
    // turns the scene): the parts there come apart at once, and close as soon as it lifts.
    { const whole = s.obj > 0.5 && s.morph > 0.999 && s.cand < 0.01 && s.ghost < 0.01 && !s.wipe && (s.buildY > 900 || s.buildY < 0) && (s.heat < 0.01 || s.id === 'open') && s.id !== 'down';
      // (the place is where the line of sight first meets the chip's own block: from the low camera of the opening a level
      // plane through the chip lies far behind the face the pointer is on)
      const press = ptr.touch && ptr.finger, aim = !ptr.down && (ptr.touch ? press : ptr.inside);
      const q = whole && calm && aim ? onBlock(ptr.x, ptr.y, s.objPos, M.DIE.hw, M.DIE.hd, s.objPos[1], s.objPos[1] + F.BODY + s.loose * F.LOOSE) : null;
      const lx = q ? q[0] - s.objPos[0] : 0, lz = q ? q[1] - s.objPos[2] : 0, onChip = !!q && Math.abs(lx) < 172 && Math.abs(lz) < 142;
      if (onChip) { const k = hov.a < 0.02 ? 1 : 1 - Math.exp(-dt / (ptr.touch ? 0.04 : 0.16)); hov.x += (lx - hov.x) * k; hov.z += (lz - hov.z) * k; }
      const k2 = 1 - Math.exp(-dt / (ptr.touch ? 0.07 : 0.22)); hov.a1 += ((onChip ? 1 : 0) - hov.a1) * k2; hov.a += (hov.a1 - hov.a) * k2;
      hov.rest += ((whole && !still ? 1 : 0) - hov.rest) * (1 - Math.exp(-dt / 0.8)); }

    // the typed line, for the embers it turns into: where its lit pixels are on the page (sent again only when the line changes)
    let cast = null;
    if (ord.box > 0 || ord.fly > 0) { const c = fx.cast(T); if (c) { cast = { x0: c.x0, yc: c.yc, fly: ord.fly, vw: innerWidth, vh: innerHeight }; if (c.key !== castKey) { castKey = c.key; cast.pts = c.pts; } } }

    // where the cast meets the water: rings run out from the cell
    if (cast) for (const f of [0.36, 0.6, 0.84]) if ((flyPrev < f && ord.fly >= f) || (flyPrev > f && ord.fly <= f)) stage.ring(stage.pour[0], stage.pour[1], 0.7);
    flyPrev = ord.fly;

    fade += ((!useLoader || (loader.t >= 0 && time - loader.t > 0.8) ? 1 : 0) - fade) * (1 - Math.exp(-dt / 0.5));          // the words come in once the scene is mostly in
    // if the GPU keeps failing, the page becomes the plain one: the words one after another, no scene
    if (!dead) try { stage.frame({ s, view, rect, W, H, dpr, time, dt, focus: lens.f, cut, stir: strokes, fade: useLoader ? 1 : fade, loaded: loader.v, reveal: loader.u, swing: loader.k, hover: [hov.x, hov.z, Math.max(hov.a, 0)], idle: hov.rest * (s.id === 'chip' || s.id === 'gds' || s.id === 'open' ? 1 : 0), cast, kick, speed: sp }); fails = 0; }
    catch (e) { console.warn('stage:', e); if (++fails > 3) { dead = true; loader.on = false; sketch.stop(); document.documentElement.classList.remove('loading'); document.documentElement.classList.add('nogl'); stEls.forEach(x => { x.style.opacity = x.style.visibility = x.style.transform = ''; }); } }
    if (dead) return;

    // what is drawn live in 2D, through the same camera
    fx.draw({ s, ord, P, focal: fl * rect[3] / dpr / 2, time, dt, vw: innerWidth, vh: innerHeight, ptr: { x: ptr.x, y: ptr.y, on: ptr.inside && !ptr.touch ? 1 : 0 }, T, shown: fade });

    // words: each station has its stretch of the film
    let cur = -1;
    ST.forEach((b, i) => { const first = i === 0, lastS = i === ST.length - 1;
      const v = (first ? 1 : smooth(b.g0, b.g0 + 0.22, g)) * (lastS ? 1 : 1 - smooth(b.g1 - 0.2, b.g1, g)); show(stEls[i], (g < b.g0 && !first ? 0 : v) * (useLoader && !first ? fade : 1)); if (g >= b.g0) cur = i; });          // (the first is on the page from the start, over the drawing: style.css)
    railBtns.forEach((bt, i) => bt.classList.toggle('on', i === cur));
    $('#hint').style.opacity = g < 0.25 ? '1' : '0';
    // the wordmark, and the box of the line the visitor types (its letters are drawn by fx)
    const lo = ord.logo, dock = ord.dock, po = ord.box;
    if (logo._on !== (lo > 0.004)) { logo._on = lo > 0.004; logo.style.visibility = logo._on ? 'visible' : 'hidden'; }
    if (logo._on) { logo.style.opacity = (lo * lerp(1, 0.62, dock)).toFixed(3); logo.style.transform = `translate(-50%,-50%) translate3d(0,${(-dock * innerHeight * (portrait ? 0.3 : 0.34)).toFixed(1)}px,0) scale(${lerp(1, 0.46, dock).toFixed(3)})`; }
    if (prompt._on !== (po > 0.004)) { prompt._on = po > 0.004; prompt.style.visibility = prompt._on ? 'visible' : 'hidden'; }
    if (prompt._on) prompt.style.opacity = po.toFixed(3);
    // names: on the one cell, then on the whole schematic
    const vCell = s.id === 'cell' ? smooth(0.05, 0.35, s.k) : (s.id === 'stamp' ? 1 - smooth(0, 0.16, s.k) : 0);
    const vSch = (s.id === 'schem' ? smooth(0.02, 0.2, s.k) * (1 - smooth(0.86, 1, s.k)) : 0) * (portrait ? 0 : 1);
    NAMES.forEach((n, i) => { const o = n.on === 'cell' ? vCell : vSch, e = nameEls[i]; if (o > 0.004) { const q = P(n.p); if (q) { e.style.opacity = o.toFixed(3); e.style.transform = `translate3d(${(q[0] + 6).toFixed(1)}px,${(q[1] - 16).toFixed(1)}px,0)`; return; } } if (e.style.opacity !== '0') e.style.opacity = '0'; });
    // the layers: lit as they rise out of the schematic, filled as they are laid
    const gv = s.id === 'flat' || s.id === 'stand' ? 1 : s.id === 'swell' ? smooth(0.5, 0.9, s.k) : s.id === 'gds' ? 1 - smooth(0.85, 1, s.k) : s.id === 'build' ? smooth(0.02, 0.08, s.k) : s.id === 'cool' ? 1 - smooth(0.3, 0.7, s.k) : 0;
    show($('#legend'), gv * (portrait ? 0 : 1), 10);
    if (gv > 0) LEG.forEach(([, rank, top], i) => { const up = s.morph >= 1 ? 1 : clamp((s.morph - 0.4) / 0.6 * 1.5 - rank * 0.5, 0, 1); legEls[i].classList.toggle('up', up > 0.5); legEls[i].classList.toggle('laid', s.id === 'build' || s.id === 'cool' ? s.buildY > top : false); });
  }
  requestAnimationFrame(tick);
  // for looking at the page from outside: where it is, how it is drawn, and jumping straight to a place in the film
  window.__site = { get g() { return g; }, state: () => F.state(g), beats: F.BEATS.map(b => [b.id, +b.t0.toFixed(2)]), jump: v => { jump = clamp(v, 0, TOTAL - 1e-3); }, blow: strike,
    intro: t => { loader.fix = t; }, get introAt() { return loader.t < 0 ? -1 : loader.fix ?? loader.el; },          // (the intro held at t seconds after the scene took the drawing over; null lets it run)
    stats: () => ({ time: +time.toFixed(3), loaded: +loader.v.toFixed(3), blows, kick: +kick.toFixed(3), rings: stage.rings(), stir: stage.stirred(), pace: +stir.pace.toFixed(2), backend: stage.backend, samples: stage.samples, embers: stage.embers, dpr, frameMs: +ft.toFixed(1), probed: stage.probed(), yaw: +(rot.spin + rot.look).toFixed(2), spin: +rot.spin.toFixed(2), turning: +rot.vs.toFixed(1), roll: +rot.roll.toFixed(2), hover: +hov.a.toFixed(2), ...stage.counts }) };
}
