// What is drawn in 2D over the live scene (stage.js), through the same camera:
//   the line the visitor types (its letters are taken away as they turn to embers; the embers are in the scene),
//   a bar under each candidate, the line of carving, the outline of the block under the pointer.
// (Embers, sparks and filings are in the scene itself: stage.js.)
// It is a 2D canvas laid over the scene with "screen" blending: everything here is light added to the picture.
import * as M from './memory.js';
import * as F from './film.js';
import { rnd } from './hash.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t, smooth = F.smooth;
const COLD = [157, 196, 255], DEAD = [170, 58, 22];
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;

// the blocks of the layout a pointer can rest on: key into the copy, then x0 z0 x1 z1
const { XA, ZA, XB, ZB } = M;
export const BLOCKS = [['pads', -156, -94, -136, 94], ['pads', 136, -94, 156, 94], ['ctl', XA - 48, ZB + 6, XA - 14, ZB + 44], ['io', XA, ZB + 4, XB, ZB + 40],
  ['pre', XA, ZA - 27, XB, ZA - 5], ['dec', XA - 58, ZA, XA - 9, ZB], ['cells', XA, ZA, XB, ZB]];

export function createFx(canvas, dom) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  const resize = () => { dpr = Math.min(window.devicePixelRatio || 1, 1.5); canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr); };

  // ───────── the order: letters → embers → the strokes of the first cell
  let glyph = null;
  function glyphs(text, fs) {
    if (glyph && glyph.text === text && glyph.fs === fs && glyph.ok) return glyph;
    const font = `500 ${fs}px "IBM Plex Mono", Consolas, monospace`, c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
    g.font = font; const w = Math.ceil(g.measureText(text).width) + 8, h = Math.ceil(fs * 1.8); c.width = w; c.height = h;
    g.font = font; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(text, 2, h / 2);
    const d = g.getImageData(0, 0, w, h).data, pts = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 110) pts.push([x - 2 + 0.5, y - h / 2 + 0.5]);
    pts.sort((a, b) => a[0] - b[0] + (rnd(a[0] * 7 + a[1], 1) - 0.5) * 26);
    glyph = { text, fs, font, pts, w: w - 8, ok: document.fonts ? document.fonts.check(font) : true }; return glyph;
  }
  // The line the visitor types. Its letters are drawn here so that they can be taken away one by one, from the left, as each
  // turns to embers (the embers themselves are in the scene: stage.js, cast). o.ord: film.js, order().
  function order(o) {
    const O = o.ord, time = o.time; if (O.box <= 0.004) return;
    const box = dom.prompt.getBoundingClientRect(); if (box.width < 4) return;
    const fs = clamp(box.height * 0.44, 15, 30), text = o.T.order, G = glyphs(text, fs), n = G.pts.length, x0 = box.left + box.height * 0.92, yc = box.top + box.height / 2 + 1;
    const nch = Math.round(O.typed * text.length), cut = O.fly <= 0 ? -1 : O.fly / F.CAST.leave;
    ctx.save(); ctx.globalAlpha = o.shown * O.box; ctx.globalCompositeOperation = 'source-over'; ctx.font = G.font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    if (cut < 1 && nch > 0) { ctx.fillStyle = 'rgba(233,240,248,0.96)'; ctx.shadowColor = 'rgba(157,196,255,0.5)'; ctx.shadowBlur = 10; ctx.fillText(text.slice(0, nch), x0, yc); ctx.shadowBlur = 0;
      if (cut >= 0) { const xc = x0 + G.pts[Math.min(n - 1, Math.floor(cut * n))][0]; ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000'; ctx.fillRect(x0 - 8, yc - fs, xc - 10 - x0 + 8, fs * 2);
        const g = ctx.createLinearGradient(xc - 10, 0, xc + 10, 0); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(xc - 10, yc - fs, 20, fs * 2);
        ctx.globalCompositeOperation = 'lighter'; const g2 = ctx.createRadialGradient(xc, yc, 0, xc, yc, 46); g2.addColorStop(0, 'rgba(255,176,46,0.5)'); g2.addColorStop(1, 'rgba(255,176,46,0)'); ctx.fillStyle = g2; ctx.fillRect(xc - 50, yc - 50, 100, 100); } }
    if (O.fly <= 0 && O.typed > 0 && Math.sin(time * 5.5) > -0.2) { const w = ctx.measureText(text.slice(0, nch)).width; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(233,240,248,0.9)'; ctx.fillRect(x0 + w + 5, yc - fs * 0.55, Math.max(2, fs * 0.09), fs * 1.1); }
    ctx.restore();
  }
  // where each lit pixel of the typed line is on the page, for the stage to start an ember from: { key, pts: [x, y, …] from (x0, yc), x0, yc }
  function cast(T) {
    const box = dom.prompt.getBoundingClientRect(); if (box.width < 4) return null;
    const fs = clamp(box.height * 0.44, 15, 30), G = glyphs(T.order, fs);
    return { key: T.order + '|' + fs + '|' + G.ok, pts: G.pts, x0: box.left + box.height * 0.92, yc: box.top + box.height / 2 + 1 };
  }

  // ───────── a bar under each candidate: how well it did. The longest is the one that stays.
  const seg = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  function bars(o) {
    const { s, P } = o; if (!(s.cand > 0.05) || !['fan', 'cands', 'back', 'fan2', 'lcands', 'down'].includes(s.id)) return;
    let a = smooth(0.7, 1, s.cand), grow = 1, pick = s.pick;
    if (s.id === 'fan' || s.id === 'fan2') { grow = 0; a *= smooth(0.6, 1, s.k); pick = 0; } else if (s.id === 'cands' || s.id === 'lcands') grow = smooth(0.04, 0.46, s.k); else a *= 1 - smooth(0, 0.3, s.k);
    if (a <= 0.01) return; const DX = M.DIE.cellW, DZ = M.DIE.cellD, oy = 12; ctx.lineCap = 'butt';
    for (let j = -1; j <= 1; j++) for (let i = -2; i <= 2; i++) {
      const best = i === 0 && j === 0, sc = (best ? 1 : 0.3 + 0.52 * rnd(i * 7 + j * 13, 9)) * smooth(0, 1, clamp(grow * 1.4 - 0.4 * rnd(i + 3, j + 5), 0, 1));
      const p = P([i * DX - 128, 0, j * DZ + 142]), q = P([i * DX + 128, 0, j * DZ + 142]); if (!p || !q) continue;
      const al = a * (best ? 1 : 1 - 0.75 * pick);
      ctx.strokeStyle = rgba(COLD, 0.22 * al); ctx.lineWidth = 2; seg([p[0], p[1] + oy], [q[0], q[1] + oy]);
      ctx.strokeStyle = rgba(best ? [233, 242, 255] : mixc(COLD, DEAD, pick), (best ? 0.98 : 0.85) * al); ctx.lineWidth = 4; seg([p[0], p[1] + oy], [p[0] + (q[0] - p[0]) * sc, p[1] + (q[1] - p[1]) * sc + oy]);
      if (best && pick > 0.55) { const t = smooth(0.55, 0.9, pick) * a, c4 = [P([-150, 0, -124]), P([150, 0, -124]), P([150, 0, 124]), P([-150, 0, 124])];
        if (c4.every(Boolean)) { ctx.strokeStyle = rgba([233, 242, 255], 0.9 * t); ctx.lineWidth = 1.5;
          c4.forEach((c, m) => { for (const d of [c4[(m + 1) % 4], c4[(m + 3) % 4]]) { const l = Math.hypot(d[0] - c[0], d[1] - c[1]) || 1; seg(c, [c[0] + (d[0] - c[0]) / l * 16, c[1] + (d[1] - c[1]) / l * 16]); } }); }
        ctx.font = '500 12px "IBM Plex Mono", Consolas, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = rgba([233, 242, 255], 0.95 * t); ctx.fillText(o.T.best, q[0] + 10, q[1] + oy); } }
  }

  // ───────── the line of carving: the cold light that writes, drawn across the sheet. White where it cuts, its own blue round that
  function carve(o) {
    const { s, P } = o, w = s.wipe; if (!w) return;
    const a = P([w.x, w.y, -131]), b = P([w.x, w.y, 131]); if (!a || !b) return;
    const fade = smooth(0, 0.04, w.w) * (1 - smooth(0.96, 1, w.w)); ctx.lineCap = 'round';
    for (const [lw, col, al] of [[30, [120, 110, 255], 0.10], [14, COLD, 0.34], [5, [225, 238, 255], 0.75], [2, [255, 255, 255], 1]]) { ctx.strokeStyle = rgba(col, al * fade); ctx.lineWidth = lw; seg(a, b); }
  }

  // ───────── the block of the layout under the pointer
  let tipOn = null;
  function blocks(o) {
    const { s, P, ptr } = o; let hit = null;
    const on = s.id === 'gds' ? smooth(0.04, 0.2, s.k) * (1 - smooth(0.86, 1, s.k)) : 0;
    if (on > 0.3 && ptr.on > 0.5) for (const b of BLOCKS) { const q = [P([b[1], 22, b[2]]), P([b[3], 22, b[2]]), P([b[3], 22, b[4]]), P([b[1], 22, b[4]])]; if (!q.every(Boolean)) continue;
      let inside = true, sign = 0; for (let m = 0; m < 4; m++) { const a = q[m], c = q[(m + 1) % 4], cr = (c[0] - a[0]) * (ptr.y - a[1]) - (c[1] - a[1]) * (ptr.x - a[0]); if (cr !== 0) { if (sign === 0) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) { inside = false; break; } } }
      if (inside) { hit = { b, q }; break; } }
    if (hit) { const { q } = hit; ctx.fillStyle = rgba(COLD, 0.07 * on); ctx.beginPath(); q.forEach((p, m) => m ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba([210, 228, 255], 0.9 * on); ctx.lineWidth = 1.3; ctx.stroke(); }
    const name = hit ? o.T.blocks[hit.b[0]] : null;
    if (name !== tipOn) { tipOn = name; if (name) dom.tip.textContent = name; dom.tip.style.opacity = name ? '1' : '0'; }
    if (name) dom.tip.style.transform = `translate3d(${(ptr.x + 16).toFixed(1)}px,${(ptr.y + 18).toFixed(1)}px,0)`;
  }

  // o: { s: the state of the film, P: point of the scene → [x, y, depth] in CSS pixels (or null), focal: pixels per unit at depth 1,
  //      time, dt, vw, vh, ptr: { x, y, on }, T: the copy, shown: 0..1 while the scene fades in }
  function draw(o) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); if (o.shown < 0.02) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = o.shown;
    ctx.globalCompositeOperation = 'source-over'; order(o);
    ctx.globalCompositeOperation = 'lighter'; bars(o); carve(o); blocks(o);
    ctx.globalAlpha = 1;
  }
  resize();
  return { resize, draw, cast };
}
