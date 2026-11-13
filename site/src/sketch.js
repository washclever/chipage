// The construction drawing shown while the scene loads (main.js): the plan of the chip on its anvil, seen from straight above
// as the scene's first picture is (film.js, TOP), so that when the scene comes it lies exactly on its own drawing. The grid
// of the plan is the grid the scene comes in by (stage.js, the last pass), its centre lines and the chip's edges run on
// across the page, and inside the chip's outline are the parts of every level, one over another, as a layout is drawn; the
// sizes of the chip are marked off along two sides. It draws on whatever canvas it is given: in a worker on an OffscreenCanvas, so that the page building the
// scene and compiling its shaders cannot hold it back (sketch.worker.js), or on the page itself where a worker cannot draw.
// The lines draw themselves on a clock of their own. While the scene is not ready the clock slows as the drawing nears its
// end, so that it is still drawing when the loading takes long, and never stops; once the scene is ready the clock runs fast,
// so the drawing is finished within half a second and never holds the scene back. A line that is finished is drawn once, onto
// a copy kept aside; each frame draws only the lines still growing.
import * as F from './film.js';
import * as M from './memory.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
const FA = 16 / 9, BG = '#070a11', GRID = 26;          // GRID: the cells of the plan's grid near the chip (stage.js, GRID0)
const STYLE = [['rgba(120,140,178,0.15)', 1], ['rgba(196,210,236,0.62)', 1.25], ['rgba(150,170,206,0.30)', 1], ['rgba(122,142,180,0.24)', 1], ['rgba(255,150,70,0.5)', 1.25],          // guide lines, the chip's own edges, what is inside it, what is far off, the fire
  ['rgba(176,196,230,0.36)', 0.8], ['rgba(140,160,198,0.22)', 0.65], ['rgba(255,176,110,0.15)', 0.55]];          // inside the body: tracks of metal, the devices, the posts between levels
// what is inside the body, for the drawing: the tracks of each level of metal, the long strips and gates of the devices at
// the bottom, the pads and the capacitor near the top, and the tall posts between levels
const INSIDE = (() => { const out = [];
  for (const b of M.expand().boxes) { const len = Math.max(b.hi[0] - b.lo[0], b.hi[2] - b.lo[2]), tall = b.hi[1] - b.lo[1];
    if (['m2', 'm3', 'top', 'capB', 'capT', 'well'].includes(b.layer) || (['act', 'poly', 'm1'].includes(b.layer) && len > 12)) out.push(b);
    else if ((b.layer === 'v1' || b.layer === 'v2') && tall > 8) out.push({ ...b, post: true }); }
  return out; })();
// while the scene is not ready: from this share of the drawing on, the clock slows toward its end, down to this rate at the least
const SLOW_FROM = 0.55, SLOW_MIN = 0.03;

// c: the canvas to draw on; blank(w, h): a canvas of that size for the lines already finished
export function createDrawing(c, blank) {
  const ctx = c.getContext('2d'), lines = [];
  let ts = 0, prev = -1, rate = 1, ready = false, last = 0, cw = 1, ch = 1, dp = 1, at = [0.5, 0.5], order = [], next = 0, growing = [], kept = null, kc = null, whole = true;
  // cssW, cssH: the size of the page; dpr: its pixels for each of those
  function build(cssW, cssH, dpr) {
    dp = dpr; cw = cssW; ch = cssH; c.width = Math.round(cw * dp); c.height = Math.round(ch * dp); lines.length = 0;
    // the camera of the plan, framed as the film is (as in the loop of main.js, with the pointer at rest)
    const s = F.state(0), view = F.place(F.TOP), portrait = cw / ch < 0.9, rw = (portrait ? cw * 1.7 : Math.max(cw, Math.min(ch * FA, cw * 1.22))) * 1.03, rh = rw / FA;
    const rx = (cw - rw) / 2 - (portrait ? rw * 0.05 : 0), ry = portrait ? ch - rh - ch * 0.06 : (ch - rh) / 2, fl = 1 / Math.tan(view.fov * Math.PI / 360);
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nrm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
    const fw = nrm(sub(view.tgt, view.cam)), rt = nrm([-fw[2], 0, fw[0]]), up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
    const eye = p => { const v = sub(p, view.cam); return [dot(v, rt), dot(v, up), dot(v, fw)]; };
    const scr = e => [rx + (0.5 + 0.5 * fl * e[0] / e[2] / FA) * rw, ch - (ry + (0.5 + 0.5 * fl * e[1] / e[2]) * rh)];
    // a line of the scene, cut where it passes behind the lens; kind: how it is drawn; at: when it starts; ext: how far it runs
    // on past its ends; dur: about how long it takes to draw
    const L = (a, b, kind, at, ext = 0, dur = 0.65) => { if (ext) { const d = sub(b, a); a = a.map((v, i) => v - d[i] * ext); b = b.map((v, i) => v + d[i] * ext); }
      let A = eye(a), B = eye(b); const N = 4; if (A[2] < N && B[2] < N) return;
      if (A[2] < N) A = A.map((v, i) => v + (B[i] - v) * (N - A[2]) / (B[2] - A[2])); else if (B[2] < N) B = B.map((v, i) => v + (A[i] - v) * (N - B[2]) / (A[2] - B[2]));
      lines.push({ a: scr(A), b: scr(B), k: kind, t: at, d: dur * (0.85 + 0.4 * Math.random()) }); };
    const rectY = (x0, x1, z0, z1, y, kind, at, ext = 0, dur) => { const q = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]]; q.forEach((p, i) => L(p, q[(i + 1) % 4], kind, at + i * 0.05, ext, dur)); };
    const O = s.objPos, top = O[1] + F.BODY + F.LOOSE * s.loose, hw = M.DIE.hw, hd = M.DIE.hd, lake = -s.lift;
    { const e = eye([O[0], top, O[2]]); if (e[2] > 1) { const p = scr(e); at = [p[0] / cw, p[1] / ch]; } }          // where the chip is on the page
    // how far the plan reaches on the water: as far as the page shows of it (and a cell more)
    const reachX = Math.ceil(Math.tan(view.fov * Math.PI / 360) * (view.dist + 60) * FA / GRID) * GRID + GRID, reachZ = Math.ceil(Math.tan(view.fov * Math.PI / 360) * (view.dist + 60) / GRID) * GRID + GRID;
    // the grid of the plan on the water, out from the chip (none over the anvil, which stands over it): the near lines first
    const AX = 262, AZ = 216;          // the anvil's broad foot (world.js)
    const gridX = (x, at) => { if (Math.abs(x) < AX) { L([x, lake, -reachZ], [x, lake, -AZ], 0, at); L([x, lake, AZ], [x, lake, reachZ], 0, at); } else L([x, lake, -reachZ], [x, lake, reachZ], 0, at); };
    const gridZ = (z, at) => { if (Math.abs(z) < AZ) { L([-reachX, lake, z], [-AX, lake, z], 0, at); L([AX, lake, z], [reachX, lake, z], 0, at); } else L([-reachX, lake, z], [reachX, lake, z], 0, at); };
    for (let x = GRID; x <= reachX; x += GRID) { const at = 0.15 + x / reachX * 0.9; gridX(O[0] + x, at); gridX(O[0] - x, at); }
    for (let z = GRID; z <= reachZ; z += GRID) { const at = 0.15 + z / reachX * 0.9; gridZ(O[2] + z, at); gridZ(O[2] - z, at); }
    // the centre lines, and the chip's edges run on across the page
    L([O[0], top, O[2] - reachZ], [O[0], top, O[2] + reachZ], 3, 0.0, 0, 0.9); L([O[0] - reachX, top, O[2]], [O[0] + reachX, top, O[2]], 3, 0.05, 0, 0.9);
    for (const x of [-hw, hw]) L([O[0] + x, top, O[2] - reachZ], [O[0] + x, top, O[2] + reachZ], 0, 0.3, 0, 0.8);
    for (const z of [-hd, hd]) L([O[0] - reachX, top, O[2] + z], [O[0] + reachX, top, O[2] + z], 0, 0.35, 0, 0.8);
    // the anvil: its top and its broad foot
    rectY(-215, 215, -176, 176, O[1], 2, 0.7); rectY(-AX, AX, -AZ, AZ, O[1] - 26, 2, 0.75);
    // the chip's outline, and the array of cells on its top
    rectY(-hw, hw, -hd, hd, top, 1, 0.9);
    for (let i = 0; i <= M.N; i++) { L([M.XA + i * M.CX, top, M.ZA], [M.XA + i * M.CX, top, M.ZB], 2, 1.5 + i * 0.03); L([M.XA, top, M.ZA + i * M.CZ], [M.XB, top, M.ZA + i * M.CZ], 2, 1.5 + i * 0.03); }
    // inside the outline, the parts of every level one over another, as a layout is drawn: the lowest levels first, each
    // drawn across from left to right; a thin part as the line down its middle; a post between levels as a small square
    const lvl = (layer, y) => O[1] + y + F.LOOSE * s.loose * (M.RANK[layer] ?? 0);
    for (const b of INSIDE) {
      const x0 = O[0] + b.lo[0], x1 = O[0] + b.hi[0], z0 = O[2] + b.lo[2], z1 = O[2] + b.hi[2], xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
      const when = 1.05 + (M.RANK[b.layer] ?? 0) * 0.6 + clamp((b.lo[0] + hw) / (2 * hw), 0, 1) * 0.3;
      if (b.post) { const y = lvl(b.layer, b.hi[1]); rectY(xm - 1.4, xm + 1.4, zm - 1.4, zm + 1.4, y, 7, when + 0.1, 0, 0.12); continue; }
      const y = lvl(b.layer, b.hi[1]), kind = b.layer === 'act' || b.layer === 'poly' || b.layer === 'well' ? 6 : 5;
      if (Math.min(x1 - x0, z1 - z0) < 4) { if (x1 - x0 > z1 - z0) L([x0, y, zm], [x1, y, zm], kind, when, 0, 0.4); else L([xm, y, z0], [xm, y, z1], kind, when, 0, 0.4); }
      else rectY(x0, x1, z0, z1, y, kind, when, 0, 0.35);
    }
    // the sizes of the chip marked off below it and to its right: a line between two ticks, and lines out to it from the corners
    { const zd = O[2] + AZ + 44, xd = O[0] + AX + 44, t = 7;
      L([O[0] - hw, top, zd], [O[0] + hw, top, zd], 3, 2.0, 0, 0.5); for (const x of [-hw, hw]) { L([O[0] + x, top, O[2] + hd + 8], [O[0] + x, top, zd + t * 1.6], 3, 1.95, 0, 0.3); L([O[0] + x - t, top, zd + t], [O[0] + x + t, top, zd - t], 1, 2.25, 0, 0.12); }
      L([xd, top, O[2] - hd], [xd, top, O[2] + hd], 3, 2.1, 0, 0.5); for (const z of [-hd, hd]) { L([O[0] + hw + 8, top, O[2] + z], [xd + t * 1.6, top, O[2] + z], 3, 2.05, 0, 0.3); L([xd - t, top, O[2] + z + t], [xd + t, top, O[2] + z - t], 1, 2.35, 0, 0.12); } }
    last = Math.max(...lines.map(l => l.t + l.d));
    // start again from nothing, at the time the drawing had reached
    order = lines.slice().sort((a, b) => a.t - b.t); next = 0; growing = [];
    if (!kept) { kept = blank(c.width, c.height); kc = kept.getContext('2d'); }
    kept.width = c.width; kept.height = c.height; kc.setTransform(1, 0, 0, 1, 0, 0); kc.fillStyle = BG; kc.fillRect(0, 0, kept.width, kept.height);
    kc.setTransform(dp, 0, 0, dp, 0, 0); kc.lineCap = 'round'; whole = true;
  }
  const stroke = (g, l, p) => { const st = STYLE[l.k]; g.strokeStyle = st[0]; g.lineWidth = st[1]; g.beginPath(); g.moveTo(l.a[0], l.a[1]); g.lineTo(lerp(l.a[0], l.b[0], p), lerp(l.a[1], l.b[1], p)); g.stroke(); };
  // one frame of the drawing; true while there is more of it to draw
  function draw(now) {
    if (prev < 0) prev = now;
    let r = rate;
    if (!ready && ts > last * SLOW_FROM) r = Math.max(SLOW_MIN, (last - ts) / (last * (1 - SLOW_FROM)));          // not ready yet: slower toward the end, but on
    ts += Math.min(now - prev, 34) / 1000 * r; prev = now;          // the drawing's clock: a frame that comes late moves it on no more than two frames would (a pause is a pause, never a jump)
    while (next < order.length && order[next].t <= ts) growing.push(order[next++]);
    // only where lines are growing or have just finished is the picture drawn again: the finished lines from the copy kept
    // aside, then the growing ones over them (late in the drawing that is the chip, not the whole page)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    growing = growing.filter(l => { x0 = Math.min(x0, l.a[0], l.b[0]); y0 = Math.min(y0, l.a[1], l.b[1]); x1 = Math.max(x1, l.a[0], l.b[0]); y1 = Math.max(y1, l.a[1], l.b[1]);
      if (ts - l.t < l.d) return true; stroke(kc, l, 1); return false; });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (whole) { ctx.drawImage(kept, 0, 0); whole = false; }
    else if (x0 <= x1) { const sx = clamp(Math.floor((x0 - 3) * dp), 0, c.width), sy = clamp(Math.floor((y0 - 3) * dp), 0, c.height);
      const ex = clamp(Math.ceil((x1 + 3) * dp), 0, c.width), ey = clamp(Math.ceil((y1 + 3) * dp), 0, c.height);
      if (ex > sx && ey > sy) ctx.drawImage(kept, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy); }
    ctx.setTransform(dp, 0, 0, dp, 0, 0); ctx.lineCap = 'round';
    for (const l of growing) stroke(ctx, l, F.ease(clamp((ts - l.t) / l.d, 0, 1)));
    return next < order.length || growing.length > 0;
  }
  return {
    build, draw,
    // the page changed size while drawing: draw it again at the new size, all of it that had been reached
    resize(cssW, cssH, dpr) { const was = ts; build(cssW, cssH, dpr); ts = Math.max(was, last + 1); prev = -1; },
    // the scene is ready: whatever is left of the drawing is drawn within about half a second
    hurry() { ready = true; const left = last - ts; if (left > 0) rate = Math.max(rate, left / 0.45); },
    done: () => next >= order.length && !growing.length,
    get clock() { return ts; },
    get at() { return at; },
    get kept() { return kept; },
  };
}
