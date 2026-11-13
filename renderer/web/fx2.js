// What the real-time layer of the site will do on top of the baked frames, drawn here on stills for the storyboard:
// the logo and the line the visitor types, and the letters of that line turning to embers that draw the first bit cell.
// Loaded in v2.html:   const FX = await import('/fx2.js?' + Date.now());   await FX.order({ base: 'renders/k_sky.jpg', s: 0.3, out: 'k_order2', cam: {...} })
import * as M from '/site/src/memory.js';
import { rnd } from '/site/src/hash.js';
const W = 1280, H = 720;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
// the same camera as the path tracer: a point of the scene → a pixel of the picture
export function projector(cam, tgt, fov) {
  const fw = nrm(sub(tgt, cam)), rt = nrm(cross(fw, [0, 1, 0])), up = cross(rt, fw), f = 1 / Math.tan(fov * Math.PI / 360);
  return p => { const v = sub(p, cam), z = dot(v, fw); return [W / 2 + f * dot(v, rt) / z * H / 2, H / 2 - f * dot(v, up) / z * H / 2]; };
}
let fontsReady = null;
export function fonts() {
  if (!fontsReady) fontsReady = (async () => {
    const l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Inter:ital,wght@1,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+KR:wght@400;500&display=swap';
    document.head.appendChild(l); await new Promise(r => { l.onload = r; l.onerror = r; setTimeout(r, 6000); });
    await Promise.all(['italic 700 64px Inter', '500 30px "IBM Plex Mono"', '400 14px "IBM Plex Mono"'].map(f => document.fonts.load(f).catch(() => 0)));
    return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.style + ' ' + f.weight);
  })();
  return fontsReady;
}
const mix = (a, b, t) => a + (b - a) * t, clamp = (x, a, b) => Math.min(b, Math.max(a, x)), smooth = t => t * t * (3 - 2 * t);
const HOT = [255, 176, 46], WHITE = [255, 243, 220], ORANGE = [232, 89, 12], COLD = [157, 196, 255];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// The first cell's schematic as one long pen stroke in pixels: [[x, y], ...] with breaks between segments.
function cellStroke(P, cx, cz) {
  const segs = M.PARTS.find(p => p.id === 'cell').segs.map(s => [P([s.a[0] + cx, M.LINE_Y, s.a[1] + cz]), P([s.b[0] + cx, M.LINE_Y, s.b[1] + cz])]);
  let total = 0; const out = segs.map(([a, b]) => { const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const o = { a, b, len, at: total }; total += len; return o; });
  return { segs: out, total };
}
const along = (st, d) => { for (const s of st.segs) if (d <= s.at + s.len) { const t = clamp((d - s.at) / (s.len || 1), 0, 1); return [mix(s.a[0], s.b[0], t), mix(s.a[1], s.b[1], t)]; } const l = st.segs[st.segs.length - 1]; return l.b; };

// o: base (path of the still under it), out (name to save as), s (0 = the line has just been typed, 1 = the cell is drawn),
//    cam { cam, tgt, fov } of the picture of the cell that follows, text, logo (0..1), box (0..1)
export async function order(o) {
  await fonts();
  const cv = new OffscreenCanvas(W, H), c = cv.getContext('2d');
  const img = await fetch('/' + o.base + '?' + Date.now()).then(r => r.blob()).then(b => createImageBitmap(b));
  c.drawImage(img, 0, 0, W, H);
  const s = o.s ?? 0, text = o.text ?? 'make 64-bit memory!', logo = o.logo ?? 1, boxA = o.box ?? 1;
  const cx0 = W / 2, ly = o.logoY ?? 118, lsz = o.logoSize ?? 54, by = o.boxY ?? 592, bw = 640, bh = 68, fs = 30;
  // the logo: the wordmark of the product, as it is in the app
  if (logo > 0) { c.save(); c.globalAlpha = logo; c.font = 'italic 700 ' + lsz + 'px Inter, "Segoe UI", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const tw = c.measureText('Melange').width, g = c.createLinearGradient(cx0 - tw / 2, 0, cx0 + tw / 2, 0); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#ddcbff'); g.addColorStop(1, '#a97cff');
    c.shadowColor = 'rgba(169,124,255,0.55)'; c.shadowBlur = lsz * 0.45; c.fillStyle = g; c.fillText('Melange', cx0, ly); c.restore(); }
  // the line the visitor types
  const tx = cx0 - bw / 2 + 62, ty = by;
  if (boxA > 0) { c.save(); c.globalAlpha = boxA; c.fillStyle = 'rgba(7,10,17,0.62)'; c.strokeStyle = 'rgba(157,184,210,0.5)'; c.lineWidth = 1;
    c.beginPath(); c.roundRect(cx0 - bw / 2, by - bh / 2, bw, bh, 8); c.fill(); c.stroke();
    c.font = `500 ${fs}px "IBM Plex Mono", Consolas, monospace`; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = '#FFB02E'; c.fillText('>', cx0 - bw / 2 + 24, ty + 1); c.restore(); }
  if (!text) { const blob0 = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.93 }); return (await fetch('/save/' + o.out + '.jpg', { method: 'POST', body: blob0 })).text(); }
  // the letters as points
  const off = new OffscreenCanvas(W, H), oc = off.getContext('2d'); oc.font = `500 ${fs}px "IBM Plex Mono", Consolas, monospace`; oc.textBaseline = 'middle'; oc.fillStyle = '#fff'; oc.fillText(text, tx, ty + 1);
  const tw = oc.measureText(text).width, data = oc.getImageData(0, 0, W, H).data, pts = [];
  for (let y = by - bh / 2; y < by + bh / 2; y++) for (let x = Math.floor(tx) - 2; x < tx + tw + 4; x++) if (data[(y * W + x) * 4 + 3] > 110) pts.push([x + 0.5, y + 0.5]);
  pts.sort((a, b) => a[0] - b[0] + (rnd(a[0] * 7 + a[1], 1) - 0.5) * 26);
  const n = pts.length;
  // where they go: the lines of the cell, in the order a pen would draw them
  const P = projector(o.cam.cam, o.cam.tgt, o.cam.fov), st = cellStroke(P, M.colX(3), M.rowZ(4));
  const LEAVE = 0.52, FLY = 0.44;               // the last letter leaves at 0.52; each flies for 0.44
  const startOf = i => LEAVE * i / n, uOf = i => clamp((s - startOf(i)) / FLY, 0, 1);
  // the text that has not left yet
  const cut = s <= 0 ? -1 : s / LEAVE;         // fraction of the points (left to right) that have left
  if (cut < 1) { const xc = cut < 0 ? tx - 20 : pts[Math.min(n - 1, Math.floor(cut * n))][0];
    const g = oc.createLinearGradient(xc - 10, 0, xc + 10, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    oc.globalCompositeOperation = 'destination-in'; oc.fillStyle = g; oc.fillRect(0, 0, W, H);
    c.save(); c.globalAlpha = 1; c.shadowColor = 'rgba(157,196,255,0.5)'; c.shadowBlur = 10; c.drawImage(off, 0, 0); c.restore();
    // the caret, and the letter about to go already glowing
    if (cut < 0) { c.fillStyle = 'rgba(233,240,248,0.9)'; c.fillRect(tx + tw + 6, ty - fs * 0.55, 3, fs * 1.1); }
    else { const g2 = c.createRadialGradient(xc, ty, 0, xc, ty, 46); g2.addColorStop(0, 'rgba(255,176,46,0.55)'); g2.addColorStop(1, 'rgba(255,176,46,0)');
      c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = g2; c.fillRect(xc - 50, ty - 50, 100, 100); c.restore(); } }
  if (s > 0) {
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    // what has been drawn: the first to leave draw the first strokes. A stroke is hot where the pen is and cold behind it.
    const drawn = clamp((s - FLY) / LEAVE, 0, 1) * st.total, HEAD = st.total * 0.16;
    if (drawn > 0) for (const g of st.segs) { if (g.at >= drawn) break; const e = Math.min(g.at + g.len, drawn), steps = Math.max(1, Math.ceil((e - g.at) / 5));
      for (let k = 0; k < steps; k++) { const d1 = g.at + (e - g.at) * (k + 1) / steps, t0 = (e - g.at) * k / steps / (g.len || 1), t1 = (d1 - g.at) / (g.len || 1), a = [mix(g.a[0], g.b[0], t0), mix(g.a[1], g.b[1], t0)], b = [mix(g.a[0], g.b[0], t1), mix(g.a[1], g.b[1], t1)];
        const heat = clamp(1 - (drawn - d1) / HEAD, 0, 1), col = mixc(HOT, WHITE, smooth(heat));
        c.strokeStyle = rgba(col, 0.20); c.lineWidth = 7 + 5 * heat; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
        c.strokeStyle = rgba(col, 0.95); c.lineWidth = 1.7; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); } }
    // the embers on their way
    for (let i = 0; i < n; i += 3) { const u = uOf(i); if (u <= 0 || u >= 1) continue;
      const S = pts[i], T = along(st, st.total * i / n), dx = T[0] - S[0], dy = T[1] - S[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      const bend = (rnd(i, 2) - 0.5) * 1.5 * L, lift = 30 - 60 * rnd(i, 3), C = [(S[0] + T[0]) / 2 + nx * bend, (S[1] + T[1]) / 2 + ny * bend + lift];
      const at = v => { const e = smooth(clamp(v, 0, 1)), w = Math.sin(v * 9 + rnd(i, 4) * 6.28) * 7 * (1 - v) * v * 4;
        return [(1 - e) * (1 - e) * S[0] + 2 * e * (1 - e) * C[0] + e * e * T[0] + nx * w, (1 - e) * (1 - e) * S[1] + 2 * e * (1 - e) * C[1] + e * e * T[1] + ny * w]; };
      const big = rnd(i, 5) > 0.86 ? 1.7 : 1, head = at(u);
      for (let j = 7; j >= 1; j--) { const p0 = at(u - j * 0.012), p1 = at(u - (j - 1) * 0.012);
        c.strokeStyle = rgba(mixc(ORANGE, HOT, 1 - j / 7), 0.34 * (1 - j / 8)); c.lineWidth = 1.5 * big; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); }
      c.fillStyle = rgba(HOT, 0.16); c.beginPath(); c.arc(head[0], head[1], 4.2 * big, 0, 6.3); c.fill();
      c.fillStyle = rgba(WHITE, 0.95); c.beginPath(); c.arc(head[0], head[1], 0.95 * big, 0, 6.3); c.fill(); }
    c.restore();
  }
  const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.93 });
  return (await (await fetch('/save/' + o.out + '.jpg', { method: 'POST', body: blob })).text()) + ' pts ' + n + ' stroke ' + Math.round(st.total);
}

// A small bar under each candidate: how well it did. No numbers — the longest bar is the one that stays.
// o: base, out, cam { cam, tgt, fov }, pick (0 = all still running, 1 = chosen), label (what the bar measures)
export async function bars(o) {
  await fonts();
  const cv = new OffscreenCanvas(W, H), c = cv.getContext('2d');
  const img = await fetch('/' + o.base + '?' + Date.now()).then(r => r.blob()).then(b => createImageBitmap(b));
  c.drawImage(img, 0, 0, W, H);
  const P = projector(o.cam.cam, o.cam.tgt, o.cam.fov), pick = o.pick ?? 0, DX = M.DIE.cellW, DZ = M.DIE.cellD;
  const seg = (x0, y0, x1, y1) => { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };
  c.lineCap = 'butt'; c.textBaseline = 'middle'; c.font = '500 13px "IBM Plex Mono", Consolas, monospace';
  for (let j = -1; j <= 1; j++) for (let i = -2; i <= 2; i++) {
    const best = i === 0 && j === 0, sc = best ? 1 : 0.3 + 0.52 * rnd(i * 7 + j * 13, 9);
    const a = P([i * DX - 128, 0, j * DZ + 142]), b = P([i * DX + 128, 0, j * DZ + 142]);
    if (b[0] < 20 || a[0] > W - 20 || a[1] > H - 14 || a[1] < 20) continue;
    const oy = 12, lost = pick > 0 && !best, ex = a[0] + (b[0] - a[0]) * sc, ey = a[1] + (b[1] - a[1]) * sc, y = b[1] + oy;
    c.strokeStyle = 'rgba(157,184,210,0.22)'; c.lineWidth = 2; seg(a[0], a[1] + oy, b[0], b[1] + oy);
    c.strokeStyle = best ? 'rgba(233,242,255,0.98)' : lost ? 'rgba(170,58,22,0.55)' : 'rgba(157,196,255,0.85)'; c.lineWidth = 4; seg(a[0], a[1] + oy, ex, ey + oy);
    if (best && pick > 0) {        // the one that stays: ticks at its corners, and its name
      const q = [P([-150, 0, -124]), P([150, 0, -124]), P([150, 0, 124]), P([-150, 0, 124])]; c.strokeStyle = 'rgba(233,242,255,0.9)'; c.lineWidth = 1.5;
      q.forEach((p, k) => { const n1 = q[(k + 1) % 4], n0 = q[(k + 3) % 4]; for (const t of [n1, n0]) { const l = Math.hypot(t[0] - p[0], t[1] - p[1]); seg(p[0], p[1], p[0] + (t[0] - p[0]) / l * 16, p[1] + (t[1] - p[1]) / l * 16); } });
      c.fillStyle = 'rgba(233,242,255,0.95)'; c.fillText(o.label || 'best', b[0] + 10, y);
    }
  }
  const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.93 });
  return (await fetch('/save/' + o.out + '.jpg', { method: 'POST', body: blob })).text();
}
