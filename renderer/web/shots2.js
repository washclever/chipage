// Shots of the second film ("위는 설계, 아래는 대장간"): the stills the storyboard is made of.
// Loaded in the page of the second renderer (v2.html):   const X = await import('/shots2.js?' + Date.now()); X.install();
// then   KV.queue(X.list('k', X.TEST))   for quick looks, or   KV.queue(X.list('k'))   for the real ones.
const KV = () => window.KV;
// the knobs of pt2.js (uK), with some of them changed
export const K = o => { const k = [0.76, 1.5, 3.0, 0.02, 1.2, 0.62, 0.34, 60, 0.03, 0.4, 0.8, 0.10, 0.6, 0, 0.6, 0]; for (const i in (o || {})) k[i] = o[i]; return k; };
export const TEST = { w: 640, h: 360, spp: 16 };
export const FULL = { w: 1280, h: 720, spp: 44, post: { den: 1 } };
// The hall: wafers closer together than the renderer's default, a narrow column of cold light over each.
const HALL = { hp: 6000, hj: 600, col: [0.5, 4.0] };
// The two places. F: the floor of the forge — dark air, hot metal, one shaft of cold light on our die.
//                 D: the design space far above it — cold and clear, in focus; the forge is a blurred glow far below.
export const F = { ...HALL, waferHeat: 0.3, lift: 0, fogD: 0.00005, shaft: 1.0, own: 0.12, keyI: 7, back: [0.10, 0.16, 0.32], wires: 0 };
export const D = { ...HALL, waferHeat: 0.56, lift: 4000, power: 0, wires: 0, buildY: -5, tileUp: 1.1, shaft: 0.5, own: 0.25, fogD: 0.00012, stars: 1.6, maxEv: 64, back: [0.12, 0.2, 0.4], aper: 3, post: { bloom: 0.26 } };
export const B = { ...F, waferHeat: 0.24, power: 0, maxEv: 40, beam: [1.2, 240] };
// a shot: the view, then what differs. Focus is on what the camera looks at unless a shot says otherwise.
export const S = (name, v, ...o) => { const post = Object.assign({}, ...o.map(x => x.post || {})), focus = Math.hypot(v.cam[0] - v.tgt[0], v.cam[1] - v.tgt[1], v.cam[2] - v.tgt[2]);
  return Object.assign({ focus }, v, ...o, { name, post }); };
const view = (...a) => KV().view(...a);
// the opening: the hall is dark; what shows is the line of fire at the horizon, the columns of light, the shaft on our chip
const NIGHT = { back: [0.025, 0.04, 0.08], shaft: 0.35, own: 0, waferHeat: 0.27, keyI: 6, stars: 2.2 };
const C0 = [15, 0, -7];                                    // the first cell to be drawn: column 3, row 4
// embers: a few, large enough to blur into discs out of focus
const embers = (o = {}) => ({ sparks: 0.006, sparkY: 0, sparkH: 220, sparkR: 420, sparkS: 12, sparkL: 0.6, ...o });
// the points of cold light that hang in the design space: what the embers became
const points = (o = {}) => ({ sparks: 0.03, sparkY: -200, sparkH: 400, sparkR: 700, sparkS: 16, sparkL: 0.45, sparkA: 0.12, ...o });
const farPoints = { sparkS: 40, sparkR: 2200, sparkH: 700, sparkY: -350, sparkL: 0.5 };
const PK = { 12: 1.2, 13: 2 };                             // the points are cold whatever their height
// one layer being laid: the sheet poured at height by, carved as far as x, sparks along the line of carving
const carve = (by, x) => ({ buildY: by, carve: [x, 3], sparks: 0.4, sparkX: [x, 10], sparkY: by, sparkH: 36, sparkR: 170, sparkS: 4, sparkL: 1 });
const BK = o => ({ k: K({ 4: 0.35, 5: 0.42, 6: 0.26, 12: 0.8, 14: 0.5, ...o }), post: { exp: 0.95, bloom: 0.26 } });

// name → [view, ...what differs from the defaults]. In the order of the film.
export const shots = () => ({
  // ── the floor of the forge
  k01_open:   [view(-10, 6, 660, [0, 60, 0], 28), F, NIGHT, embers({ sparks: 0.005 }), { write: 5.4, beam: [2.2, 220], k: K({ 12: 0.6 }) }],
  k01_close:  [view(-8, 14, 520, [0, 30, 0], 24), F, embers(), { write: 5.4, beam: [2.0, 220], aper: 3, k: K({ 12: 0.6 }) }],
  k02_rise:   [view(-16, 38, 860, [0, 60, 0], 26), F, embers({ sparks: 0.02, sparkH: 520, sparkR: 560, sparkS: 24, sparkL: 0.35 }), { write: 6.3, beam: [2.0, 240], k: K({ 12: 0.8, 13: 1 }) }],
  k03_up:     [view(-16, 52, 700, [0, 0, 0], 26), D, points({ sparkS: 24, sparkR: 900, sparkH: 700, sparkY: -350 }), { lift: 1700, obj: 0, aper: 0, k: K(PK) }],
  // ── the design space
  k04_sky:    [view(0, 60, 150, C0, 24), D, points(), { obj: 0, k: K(PK) }],
  k05_cell:   [view(0, 60, 150, C0, 24), D, points(), { morph: 0, tileUp: 0.178, peri: 0, k: K({ 2: 1.6, ...PK }) }],
  k06_stamp:  [view(0, 60, 380, [15, 0, -10], 24), D, points(), { morph: 0, tileUp: 0.55, peri: 0, k: K({ 2: 1.0, ...PK }) }],
  k06_peri:   [view(0, 59, 560, [0, 0, -4], 24), D, points(farPoints), { morph: 0, tileUp: 1, peri: 0.5, k: K({ 2: 0.9, ...PK }) }],
  k07_schem:  [view(0, 58, 640, [0, 0, 0], 24), D, points(farPoints), { morph: 0, k: K({ 2: 0.8, ...PK }) }],
  k08_sim:    [view(0, 58, 640, [0, 0, 0], 24), D, points(farPoints), { morph: 0, sim: 1, simT: 2.0, k: K({ 2: 0.8, ...PK }) }],
  k09_cands0: [view(0, 52, 1500, [0, 0, 20], 24), D, points(farPoints), { morph: 0, cand: 0.42, k: K({ 2: 0.45, ...PK }) }],
  k09_cands:  [view(0, 52, 1500, [0, 0, 20], 24), D, points(farPoints), { morph: 0, cand: 0.8, sim: 1, simT: 2.0, k: K({ 2: 0.45, ...PK }) }],
  k10_pick:   [view(0, 52, 1500, [0, 0, 20], 24), D, points(farPoints), { morph: 0, cand: 1, pick: 0.62, sim: 1, simT: 3.1, k: K({ 2: 0.45, ...PK }) }],
  k11_m25:    [view(8, 52, 620, [0, 4, 0], 24), D, points(farPoints), { morph: 0.25, k: K({ 2: 0.8, ...PK }) }],
  k12_m50:    [view(14, 44, 600, [0, 8, 0], 24), D, points(farPoints), { morph: 0.5, k: K(PK) }],
  k13_m75:    [view(20, 32, 580, [0, 14, 0], 24), D, points(farPoints), { morph: 0.75, k: K(PK) }],
  k14_m100:   [view(24, 24, 560, [0, 20, 0], 24), D, points(farPoints), { morph: 1, k: K(PK) }],
  k15_lcands: [view(24, 34, 1500, [0, 0, 20], 24), D, points(farPoints), { morph: 1, cand: 1, vari: 1, k: K(PK) }],
  k16_lpick:  [view(24, 34, 1500, [0, 0, 20], 24), D, points(farPoints), { morph: 1, cand: 1, vari: 1, pick: 0.86, k: K(PK) }],
  // ── down to the wafer
  k17_desc:   [view(20, 24, 600, [0, 20, 0], 24), D, { morph: 1, lift: 900, own: 0.5, aper: 0 }],
  k18_land:   [view(-10, 20, 520, [0, 20, 0], 24), B, { buildY: -5 }],
  k19_b1:     [view(-22, 20, 470, [0, 14, 0], 24), B, carve(6.5, -40), BK()],
  k20_pour:   [view(-30, 22, 440, [0, 20, 0], 24), B, carve(16, -159), { sparks: 0 }, BK({ 4: 0.5 })],
  k20_carve:  [view(-30, 22, 440, [0, 20, 0], 24), B, carve(16, 0), BK()],
  k20_cool:   [view(-30, 22, 440, [0, 20, 0], 24), B, carve(16, 162), { sparks: 0 }, BK({ 7: 90 })],
  k21_b3:     [view(-12, 21, 430, [0, 24, 0], 24), B, carve(29, 30), BK()],
  k22_b4:     [view(10, 20, 430, [0, 26, 4], 24), B, { buildY: 60.5 }, BK({ 5: 0.5, 6: 0.3 })],
  // ── the chip
  k23_chip:   [view(30, 20, 430, [0, 22, 10], 24), F, { write: 5.4, beam: [1.6, 240] }],
  k24_end1:   [view(30, 30, 1500, [0, 0, 0], 24), F, { write: 9, ghost: 0.5, own: 0.3 }],
  k25_end2:   [view(30, 36, 3000, [0, 0, -200], 24), F, { write: 9, ghost: 1, own: 0.4 }],
});

export function list(prefix = '', q = FULL) { const all = shots(); return Object.keys(all).filter(n => n.startsWith(prefix)).map(n => S(n, ...all[n], q)); }
export const cam = name => { const s = shots()[name][0]; return { cam: s.cam, tgt: s.tgt, fov: s.fov }; };
export function install() {
  Object.assign(window, { K, D, F, B, S, TEST, FULL, T: TEST });
  window.waitQ = async (ms = 42000) => { const t0 = performance.now();
    await new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => { if ((window.__q && window.__q.all) || performance.now() - t0 > ms) r(); else c.port2.postMessage(0); }; c.port2.postMessage(0); });
    return { all: window.__q && window.__q.all, done: window.__q && window.__q.done.map(d => d.join(' ')).join(' | '), cur: window.__q && window.__q.cur, frame: KV().status.frame, spp: KV().status.spp }; };
  window.sheetOf = (names, cols, out, cw = 640) => KV().sheet(names.map(n => 'renders/' + n + '.jpg'), cols, out, cw);
  return 'installed';
}
