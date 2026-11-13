// The film. For a scroll position g (in screens): where the camera is and what state the scene is in.
// The stage draws that state live; the page uses the same numbers to place what it draws over it.
// The place: a forge on the shore of a lake. The lake is where the design is made, hovering over the water, and the lake
// itself becomes the wafer the design is laid on.
// It opens on the chip, heated on an anvil that stands in the lake: the point of the inverted pyramid over the lake comes over
// it and strikes it with one fall of molten metal, which drives its layers home; it is quenched in the lake, and out of that
// water the wordmark comes up, the order is typed, and the first cell is drawn.
export const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mixv = (a, b, t) => Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], t)) : lerp(a, b, t);
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const HOVER = 46;                                   // how far above the water the design is made
// The hall the lake lies in (world.js). top: the height of its roof and of its walls; hang: where the pyramids hang from it;
// x0, x1: its walls at their tops; near, far: its ends; centre: the middle of its width. Every pyramid is `layers.K` layers,
// each a slope SL high (at `slope` degrees from the level) and then a flat, GAP apart, and a head MOUTH high under the last;
// half: half its width. main: the first pyramid, over the lake (the z of its middle, half its depth); row: the far ones, down
// the hall. rest: where the first one's point rests, over the far side of the lake, pouring a thin line into it. bridge: the
// height of the bridge's deck, just under the point.
export const HALL = { top: 3000, hang: 2950, x0: -6000, x1: 5640, near: 3200, far: -39500, centre: -180, half: 5500,
  layers: { K: 8, SL: 200, GAP: 35, MOUTH: 70 }, slope: 36, main: [-1000, 4000],
  row: [[-8600, 3300], [-15400, 3300], [-22200, 3300], [-29000, 3300], [-35800, 3300]], rest: [800, -2000], bridge: 900 };
export const TIP_Y = HALL.hang - (HALL.layers.K - 1) * (HALL.layers.SL + HALL.layers.GAP) - HALL.layers.SL - HALL.layers.MOUTH;          // the height of the first pyramid's mouth
export const ANVIL_Y = 26;                                 // how far the top of the anvil stands out of the water
export const BODY = 68;                                    // the height of the chip's clear body (memory.js, DIE.glass)
export const LOOSE = 22;                                   // how far the top layer stands above its place before the strike has driven it home

// ───────── cameras: [side°, height°, distance, target x y z, field of view°, roll°]. Side 0 is the front, negative is from the left.
// While the page loads, the drawing and the first picture of the scene are seen from straight above the chip, far off through
// a long lens, the chip's edges along the page's: the plan of what is to come. Once the scene is in, the camera turns down
// from there into the first camera of the film (main.js).
export const TOP = [0, 89, 1500, 0, 60, 0, 24, 0];
// These are the places the camera passes through. Between them it does not stop and start: all of them are strung on one
// track (camAt, below) that it rides without a break, slower through the holds and faster through the moves.
const CAM = {
  anvil:  [9, 14, 450, -62, 84, 0, 46, 0],   // the chip on its anvil in the lake, close and through a wide lens; behind it, across the water, the heart of the forge
  lake:   [-21, -1.9, 1500, 0, 150, 0, 26, 0], // low over the lake, looking a little up: the forge to one side, open sky to the other. The wordmark comes up here
  sky:    [0, 60, 150, 15, 0, -7, 24, 0],      // over the place where the first cell will be drawn
  schem:  [0, 58, 640, 0, 0, 0, 24, 0],        // the whole schematic
  cands:  [0, 52, 1500, 0, 0, 20, 24, 0],      // far enough to see the neighbours
  m25:    [8, 52, 620, 0, 4, 0, 24, 0],
  m50:    [14, 44, 600, 0, 8, 0, 24, 0],       // the layout lying flat
  gds:    [24, 24, 560, 0, 20, 0, 24, 0],      // the layout standing
  lcands: [24, 34, 1500, 0, 0, 20, 24, 0],
  land:   [-10, 20, 520, 0, 20, 0, 24, 0],     // down on the wafer
  chip:   [30, 20, 430, 0, 22, 10, 24, 0],
  end:    [30, 36, 3000, 0, 0, -200, 24, 0],
  about:  [-4, -14, 3600, 300, 1100, -2200, 54, 0], // last: low over the water and looking up the hall: the first pyramid and its line, the far ones going on down the middle
};
// while it holds, the camera still drifts a little: half the drift before the middle of the hold, half after
const drift = (c, d, az = 1.6, r = 0.03) => [c[0] + d * az, c[1], c[2] * (1 - d * r), c[3], c[4], c[5], c[6], c[7] || 0];

// ───────── the air and the light of each place.
// furn: the fire of the forge. hl: how much of its light falls across the lake from behind (strong at the anvil, all but
// off where the camera looks down on the design: a mirror would turn it into one blinding point).
// dof: how much what is nearer or further than the thing looked at goes out of focus.
// cold: how far the embers have cooled into points of cold light. emb: how many of them.
const ANVIL  = { waferHeat: 0, fogD: 0.00007, shaft: 0.4, own: 0,    keyI: 5.5, back: [0.05, 0.08, 0.16],  stars: 2.0, aper: 0, beamI: 1.5, beamR: 230, exp: 1.12, bloom: 0.34, furn: 0.95, glare: 1, hl: 1, dof: 1, aur: 0,  cold: 0,   emb: 0.45 };
const LAKE   = { waferHeat: 0, fogD: 0.00005, shaft: 0.4, own: 0.2,  keyI: 5,   back: [0.045, 0.075, 0.15], stars: 2.2, aper: 0, beamI: 0,   beamR: 240, exp: 1.15, bloom: 0.30, furn: 0.9,  glare: 1, hl: 1, dof: 0.3, aur: 0,  cold: 0.2, emb: 0.18 };
const DESIGN = { waferHeat: 0, fogD: 0.00012, shaft: 0.5, own: 0.25, keyI: 8,   back: [0.12, 0.20, 0.40],  stars: 1.6, aper: 3, beamI: 0,   beamR: 240, exp: 1.15, bloom: 0.26, furn: 0.6,  glare: 1, hl: 0, dof: 0, aur: 0,  cold: 1,   emb: 1 };
const FLOOR  = { waferHeat: 0.07, fogD: 0.00005, shaft: 1.0, own: 0.12, keyI: 7, back: [0.10, 0.16, 0.32], stars: 1.0, aper: 0, beamI: 1.2, beamR: 240, exp: 1.0,  bloom: 0.26, furn: 0.8,  glare: 1, hl: 0, dof: 0.7, aur: 0, cold: 0,   emb: 0.55 };
const CHIP   = { ...FLOOR, waferHeat: 0.09, beamI: 1.6, exp: 1.15, bloom: 0.34, emb: 1 };
const END    = { ...CHIP, own: 0.4, beamI: 0.6, aur: 0, emb: 0.5, dof: 0.25 };
// ───────── how each place is seen through the lens (stage.js, the last pass); a move between two places carries the one into
// the other. The colour says where in the making we are, as the colours of the concept do: warm where it is being made (the
// forge, the wafer), cold where it is worked out and checked (the design space). warm: the colour's temperature (−1 cold ..
// 1 warm); sat: how full the colour is; crush: how deep the blacks go. The lens: halo, the red bleed round what is very bright;
// streak, the brightest light drawn out sideways; dirt, the marks on the front glass that strong light shows; vig, how much the
// corners darken; shutter, how much a moving camera smears the picture.
Object.assign(ANVIL,  { warm: 0.30,  sat: 1.06, crush: 0.8,  halo: 1.0,  streak: 0.8,  dirt: 0.7,  vig: 1.0,  shutter: 0.8 });
Object.assign(LAKE,   { warm: 0.12,  sat: 1.0,  crush: 0.6,  halo: 0.7,  streak: 0.7,  dirt: 0.5,  vig: 0.95, shutter: 0.8 });
Object.assign(DESIGN, { warm: -0.30, sat: 0.92, crush: 0.25, halo: 0.25, streak: 0.35, dirt: 0.25, vig: 0.75, shutter: 0.6 });
Object.assign(FLOOR,  { warm: 0.10,  sat: 1.0,  crush: 0.6,  halo: 0.85, streak: 0.75, dirt: 0.5,  vig: 0.9,  shutter: 0.7 });
Object.assign(CHIP,   { warm: 0.0,   sat: 1.02, crush: 0.55, halo: 0.6,  streak: 0.6,  dirt: 0.6,  vig: 0.9,  shutter: 0.6 });
Object.assign(END,    { warm: -0.05, sat: 0.95, crush: 0.5,  halo: 0.5,  streak: 0.5,  dirt: 0.4,  vig: 1.0,  shutter: 0.8 });
// the last place: the forge across the water at night, as at the start, seen whole
const ABOUT  = { ...LAKE, own: 0.2, emb: 0.3, dof: 0.15, stars: 2.2, warm: 0.14, crush: 0.65, halo: 0.75 };
// what the scene is doing. Knobs k2..: 2 schematic line, 4 the light that writes, 5 metal just poured, 6 cooling, 14 the sheet.
// water: the floor is a lake (1) or a wafer (0). grid: the dies showing through the water. ripple: how restless the water is.
// heat, flash: the chip itself glowing, and the white of the strike. loose: how far its layers still stand apart (1) before the
// strike has driven them home (0). plinth: the anvil it stands on. The first pyramid: mFrom, mTo, mU: where its point is
// going from and to, and how far it has got (its layers move one after another, world.js); mFlow: its thin line into the
// lake; mBurst, mHead, mTail: the one heavy fall of the strike, and where the front and the end of it are.
// steam: off the water as the chip is quenched. What passes close before the lens: veilS, that steam, as the camera goes down
// with the chip to the water; veilE, embers, as the camera rises through them after the letters are cast.
const CHIPPED = { lift: 0, objPos: [0, 0, 0], obj: 1, buildY: 1000, morph: 1, tileUp: 1.1, peri: 1, sim: 0, simT: 0, power: 1, write: 5.4, cand: 0, pick: 0, vari: 0, ghost: 0,
  carveX: 1e4, carveT: 0, k2: 0.8, k4: 1.2, k5: 0.62, k6: 0.34, k14: 0.6, water: 0, grid: 1, ripple: 0, heat: 0, flash: 0, loose: 0, plinth: 0, steam: 0,
  mFrom: HALL.rest, mTo: HALL.rest, mU: 1, mFlow: 1, mBurst: 0, mHead: 0, mTail: 0,
  veilS: 0, veilE: 0 };
const DRAWN = { ...CHIPPED, lift: HOVER, buildY: -5, morph: 0, power: 0, write: 0, water: 1, grid: 0.3, ripple: 0.12 };       // design: made of light, over the lake
const st = (cam, air, base, o = {}) => ({ c: cam, ...air, ...base, ...o });
const AFTER = { ...CHIPPED, write: 9.2, ghost: 1, water: 1, grid: 1, ripple: 0.1 };          // the last place: the chip made, the water back over the wafer, its dies showing through

// ───────── the build: in two pours, slowly. Each is poured (a sheet of metal), then carved across, then left to cool: the
// first up to the second metal (the devices, metal 1, metal 2), the second up to the top (metal 3, the capacitor, the top metal).
export const LEVELS = [26.5, 60.5];
const LLEN = [1.66, 1.66];
const BCAM = [[-25, 21, 455, 0, 18, 0, 24, 0], [10, 20, 430, 0, 26, 4, 24, 0]];
export const POUR = 0.28, CARVED = 0.86;         // within a layer: poured by 0.28, carved across by 0.86
const BUILD_LEN = LLEN.reduce((a, b) => a + b, 0);
const BUILT = { ...CHIPPED, power: 0, write: 0, k4: 0.35, k5: 0.42, k6: 0.26, k14: 0.5 };
function build(k, s) {
  let u = k * BUILD_LEN, j = 0; while (j < LLEN.length - 1 && u >= LLEN[j]) { u -= LLEN[j]; j++; } u = clamp(u / LLEN[j], 0, 1);
  const prevY = j === 0 ? -5 : LEVELS[j - 1];
  Object.assign(s, FLOOR, BUILT); s.objPos = [0, 0, 0]; s.layer = j; s.u = u;
  if (u < POUR) { const e = ease(u / POUR); s.buildY = lerp(prevY, LEVELS[j], e); s.carveX = -170; s.carveT = lerp(0.3, 3, e); s.k4 = lerp(0.35, 0.5, e); s.pour = e; }
  else { s.buildY = LEVELS[j]; s.pour = 1; const w = clamp((u - POUR) / (CARVED - POUR), 0, 1);
    if (w < 1) { s.carveX = -170; s.carveT = 3; s.k4 = 0.5; s.wipe = { x: lerp(-166, 166, w), y: LEVELS[j], w }; } else { s.carveX = 1e4; s.carveT = 0; } }
}

// ───────── the order: the wordmark, the line the visitor types, and the line turning into the first cell.
// ORDER is within the beat "lake", CAST within the beat "cast".
export const ORDER = { logo: [0.04, 0.24], dock: [0.40, 0.58], type: [0.60, 0.97] };
export const CAST = { fly: [0.05, 0.74], cell: [0.36, 0.92], leave: 0.5, dur: 0.5 };      // of the flight: the last letter leaves at `leave`, each is on its way for `dur`
export function order(s) {
  const o = { logo: 0, dock: 0, box: 0, typed: 0, fly: 0 }, k = s.k;
  if (s.id === 'lake') { o.logo = smooth(ORDER.logo[0], ORDER.logo[1], k); o.dock = smooth(ORDER.dock[0], ORDER.dock[1], k); o.box = smooth(ORDER.dock[0] + 0.03, ORDER.dock[1], k);
    o.typed = clamp((k - ORDER.type[0]) / (ORDER.type[1] - ORDER.type[0]), 0, 1); }
  else if (s.id === 'cast') { o.logo = 1 - smooth(0.02, 0.22, k); o.dock = 1; o.box = 1 - smooth(0.34, 0.5, k); o.typed = 1; o.fly = clamp((k - CAST.fly[0]) / (CAST.fly[1] - CAST.fly[0]), 0, 1); }
  return o;
}
// ───────── the strike. The point of the first pyramid leaves where it rests and comes over the chip, its layers sliding one
// after another, its line stopping as it goes. Over the chip its mouth opens: the metal falls, faster and faster, and strikes
// the chip once, which drives its layers home; it pours a moment, stops, and the last of it falls.
export const HIT = 0.66;          // where in the beat the metal lands on the chip
const CHIP_TOP = ANVIL_Y + BODY + LOOSE;
function strike(k, s) {
  // the camera draws back and looks up first, then holds while the layers go across one after another, the upper first and the
  // point last; the point waits a moment over the chip, glowing; then the mouth opens
  s.mFrom = HALL.rest; s.mTo = [0, 0]; s.mU = clamp((k - 0.16) / 0.36, 0, 1); s.mFlow = 1 - smooth(0.0, 0.08, k);
  const f = clamp((k - 0.58) / (HIT - 0.58), 0, 1), t = clamp((k - 0.76) / 0.08, 0, 1);
  s.mBurst = k > 0.58 && k < 0.85 ? 1 - smooth(0.8, 0.85, k) * 0.3 : 0; s.mHead = TIP_Y - (TIP_Y - CHIP_TOP) * f * f; s.mTail = TIP_Y - (TIP_Y - CHIP_TOP) * t * t;
  s.flash = k < HIT ? 0 : Math.exp(-(k - HIT) / 0.03);
  s.loose = 1 - smooth(HIT - 0.004, HIT + 0.012, k);          // the fall drives the layers home as it lands
  s.heat = lerp(0.56, 0.7, smooth(HIT, HIT + 0.05, k)); s.ripple = 0.35 + 0.5 * s.flash;
  s.dof = lerp(0.3, 1, smooth(0.5, 0.64, k));          // (the wide looks up at the pyramid are sharp all through)
}

// ───────── the beats, in order. hold: the camera rests (and words are read). a → b are the states at its two ends; fn refines
// them along the way. keys: places the camera passes through inside a move, as [where in the beat, camera].
const lakeS = { ...DRAWN, obj: 0, tileUp: 0, peri: 0, k2: 1.6, grid: 0, ripple: 0.5 };
const castB = st(drift(CAM.sky, 0, 0, 0.04), DESIGN, { ...DRAWN, tileUp: 0.178, peri: 0, k2: 1.6, grid: 0, ripple: 0.3 });
const castFn = (k, s) => { const t = smooth(CAST.cell[0], CAST.cell[1], k); s.tileUp = t * 0.178; s.obj = t > 0 ? 1 : 0;
  s.veilE = smooth(0.03, 0.16, k) * (1 - smooth(0.3, 0.5, k)); };          // the camera rises off the water through the embers
const hot = { ...CHIPPED, objPos: [0, ANVIL_Y, 0], plinth: 1, power: 0, write: 0, water: 1, grid: 0, ripple: 0.35, loose: 1 };
const OPENING = [
  // it is heated: the camera comes slowly nearer
  { id: 'open',   len: 0.9, hold: 1, a: st(drift(CAM.anvil, -0.5, 4, 0.06), ANVIL, { ...hot, heat: 0.16 }), b: st(drift(CAM.anvil, 0.5, 4, 0.06), ANVIL, { ...hot, heat: 0.56 }) },
  // the strike. The camera draws back and down, low over the water, and looks up: the pyramid over the lake, its point coming
  // across toward the chip; it comes in close under it as the mouth opens, level with the chip as the metal lands, and
  // cranes up over it as the last of it falls
  { id: 'strike', len: 1.8, b: st([8, 31, 640, 0, 54, 0, 30, 0], ANVIL, { ...hot, heat: 0.64, loose: 0 }), fn: strike,
    keys: [[0.16, [-25.2, -10.3, 1910, 100, 500, -300, 56, -1.2]], [0.5, [-23.5, -11.5, 1780, 80, 520, -260, 56, -0.6]], [0.6, [-30.6, -24.0, 1100, 0, 520, -60, 62, 0.6]],
      [0.66, [-30.7, -19.3, 790, 0, 330, 0, 54, -1.5]], [0.86, [23.2, 27.7, 860, 0, 120, 0, 36, 1.0]]] },
  // quenched: the camera goes down with it to the water, then draws back across the lake
  { id: 'quench', len: 1.3, b: st(drift(CAM.lake, -0.5, 1, 0.02), LAKE, { ...hot, heat: 0, lift: HOVER, ripple: 0.5, loose: 0 }),
    keys: [[0.22, [3, 13, 590, 0, 22, 0, 30, -1.2]], [0.5, [-8, 3.5, 800, 0, 46, 0, 28, -1.8]]],
    fn: (k, s) => { const sink = smooth(0.03, 0.46, k); s.objPos = [0, lerp(ANVIL_Y, -190, sink), 0]; s.heat = 0.64 * (1 - smooth(0.1, 0.56, k)); s.steam = smooth(0.05, 0.2, k) * (1 - smooth(0.55, 0.98, k));
      s.lift = HOVER * smooth(0.5, 1, k); s.ripple = Math.max(s.ripple, s.steam * 0.6); s.obj = s.plinth = k < 0.66 ? 1 : 0; s.quench = sink;
      s.mFrom = [0, 0]; s.mTo = HALL.rest; s.mU = smooth(0.2, 0.85, k); s.mFlow = smooth(0.8, 1.0, k); s.mBurst = 0;          // the point goes back to where it rests, and its line comes on again
      s.veilS = smooth(0.14, 0.3, k) * (1 - smooth(0.42, 0.64, k)); } },          // down by the water the steam drifts across the lens
  { id: 'lake',   len: 1.0, hold: 1, a: st(drift(CAM.lake, -0.5, 1, 0.02), LAKE, lakeS), b: st(drift(CAM.lake, 0.5, 1, 0.02), LAKE, lakeS) },
  // the letters are struck into sparks; the camera rises off the water, banks, and dives to where they land
  { id: 'cast',   len: 1.2, b: castB, fn: castFn, keys: [[0.34, [-13, 17, 940, 6, 66, -3, 30, -3.5]], [0.68, [-3, 47, 340, 13, 7, -7, 27, -1.2]]] },
];
const dz = { grid: 1, ripple: 0.06 };          // from the candidates on, the water is a mirror and the dies show through it
const REST = [
  { id: 'cell',   len: 0.5, hold: 1, a: castB, b: st(drift(CAM.sky, 0.5, 0, 0.04), DESIGN, { ...DRAWN, tileUp: 0.178, peri: 0, k2: 1.6, grid: 0, ripple: 0.3 }) },
  { id: 'stamp',  len: 1.2, b: st(drift(CAM.schem, -0.5), DESIGN, DRAWN), keys: [[0.5, [-5, 60.5, 400, 6, 0, -3, 25, 1.0]]],
    fn: (k, s, e) => { s.tileUp = lerp(0.178, 1.1, smooth(0.08, 0.74, e)); s.peri = smooth(0.66, 1, e); s.k2 = lerp(1.6, 0.8, smooth(0, 0.7, e)); } },      // the cells are stamped out only as fast as the camera makes room for them
  { id: 'schem',  len: 1.1, hold: 1, n: 22, a: st(drift(CAM.schem, -0.5), DESIGN, DRAWN), b: st(drift(CAM.schem, 0.5), DESIGN, { ...DRAWN, sim: 1, simT: 9, k2: 0.55 }),
    fn: (k, s) => { s.sim = smooth(0.02, 0.14, k); s.simT = clamp((k - 0.08) / 0.9, 0, 1) * 9; s.k2 = lerp(0.8, 0.55, s.sim); } },          // the rest dims a little so that the row being read stands out
  { id: 'fan',    len: 0.8, b: st(drift(CAM.cands, -0.5, 1, 0.02), DESIGN, { ...DRAWN, ...dz, sim: 1, simT: 15, cand: 1, k2: 0.45 }), keys: [[0.5, [4, 55, 1060, 0, 0, 10, 26, -1.2]]] },
  { id: 'cands',  len: 1.0, hold: 1, n: 18, a: st(drift(CAM.cands, -0.5, 1, 0.02), DESIGN, { ...DRAWN, ...dz, sim: 1, simT: 15, cand: 1, k2: 0.45 }), b: st(drift(CAM.cands, 0.5, 1, 0.02), DESIGN, { ...DRAWN, ...dz, sim: 1, simT: 24, cand: 1, pick: 1, k2: 0.45 }),
    fn: (k, s) => { s.pick = smooth(0.48, 1, k); } },
  { id: 'back',   len: 0.7, b: st(CAM.m25, DESIGN, { ...DRAWN, ...dz, morph: 0.25 }),
    fn: (k, s) => { s.cand = 1; s.pick = 1; s.sim = 1 - smooth(0, 0.4, k); s.simT = 24 + 3 * k; s.morph = 0.25 * smooth(0.35, 1, k); } },    // the others are already out: only ours is left to come back to
  { id: 'swell',  len: 0.7, b: st(drift(CAM.m50, -0.5, 1, 0.01), DESIGN, { ...DRAWN, ...dz, morph: 0.5 }) },
  { id: 'flat',   len: 0.3, hold: 1, a: st(drift(CAM.m50, -0.5, 1, 0.01), DESIGN, { ...DRAWN, ...dz, morph: 0.5 }), b: st(drift(CAM.m50, 0.5, 1, 0.01), DESIGN, { ...DRAWN, ...dz, morph: 0.5 }) },
  { id: 'stand',  len: 1.0, b: st(drift(CAM.gds, -0.5), DESIGN, { ...DRAWN, ...dz, morph: 1 }) },
  { id: 'gds',    len: 1.0, hold: 1, a: st(drift(CAM.gds, -0.5), DESIGN, { ...DRAWN, ...dz, morph: 1 }), b: st(drift(CAM.gds, 0.5), DESIGN, { ...DRAWN, ...dz, morph: 1 }) },
  { id: 'fan2',   len: 0.7, b: st(drift(CAM.lcands, -0.5, 1, 0.02), DESIGN, { ...DRAWN, ...dz, morph: 1, cand: 1, vari: 1 }), fn: (k, s) => { s.vari = 1; } },
  { id: 'lcands', len: 0.9, hold: 1, n: 16, a: st(drift(CAM.lcands, -0.5, 1, 0.02), DESIGN, { ...DRAWN, ...dz, morph: 1, cand: 1, vari: 1 }), b: st(drift(CAM.lcands, 0.5, 1, 0.02), DESIGN, { ...DRAWN, ...dz, morph: 1, cand: 1, vari: 1, pick: 1 }),
    fn: (k, s) => { s.pick = smooth(0.42, 1, k); } },
  // the design comes down to the water, and the water sets: from the shore inward the lake becomes the wafer
  { id: 'down',   len: 1.3, b: st(drift(CAM.land, -0.5), FLOOR, { ...DRAWN, morph: 1, lift: 0, k4: 0.35, water: 0, grid: 1, ripple: 0 }), keys: [[0.45, [9, 29, 1040, 0, 14, 10, 26, 2.2]]],
    fn: (k, s) => { s.cand = 1; s.pick = 1; s.vari = 1; s.water = 1 - smooth(0.08, 0.86, k); } },
  { id: 'land',   len: 0.4, hold: 1, a: st(drift(CAM.land, -0.5), FLOOR, { ...DRAWN, morph: 1, lift: 0, k4: 0.35, water: 0, grid: 1, ripple: 0 }), b: st(drift(CAM.land, 0.5), FLOOR, { ...DRAWN, morph: 1, lift: 0, k4: 0.35, water: 0, grid: 1, ripple: 0 }) },
  { id: 'build',  len: BUILD_LEN, custom: build },
  { id: 'cool',   len: 0.5, a: st(drift(BCAM[BCAM.length - 1], 0.5, 1.4, 0.012), FLOOR, { ...BUILT, buildY: 60.5, carveX: 1e4, carveT: 0 }), b: st(drift(CAM.chip, -0.5), CHIP, { ...BUILT, buildY: 74, carveX: 1e4, carveT: 0, k5: 0.3, k6: 0.2 }),
    fn: (k, s) => { if (k > 0.86) s.buildY = 1000; } },                                              // the glass closes over the top; from here it is a chip
  { id: 'chip',   len: 1.1, hold: 1, n: 24, a: st(drift(CAM.chip, -0.5), CHIP, { ...CHIPPED, power: 0, write: 0 }), b: st(drift(CAM.chip, 0.5), CHIP, { ...CHIPPED, write: 9.2 }),
    fn: (k, s) => { s.power = smooth(0, 0.14, k); s.write = clamp((k - 0.1) / 0.85, 0, 1) * 9.2; } },
  { id: 'out',    len: 1.1, b: st(drift(CAM.end, -0.5, 1.2, 0.02), END, { ...CHIPPED, write: 9.2, ghost: 1 }), keys: [[0.5, [37, 29, 1480, 0, 10, -80, 27, -1.6]]] },
  { id: 'end',    len: 1.0, hold: 1, a: st(drift(CAM.end, -0.5, 1.2, 0.02), END, { ...CHIPPED, write: 9.2, ghost: 1 }), b: st(drift(CAM.end, 0.5, 1.2, 0.02), END, { ...CHIPPED, write: 9.2, ghost: 1 }) },
  // and last, the place it was all made in: the camera comes down off the wafer to the water, which comes back over it (the
  // dies show through it, as in the design), and turns to the forge across it, where the company is introduced
  { id: 'away',   len: 1.2, b: st(drift(CAM.about, -0.5, 1, 0.01), ABOUT, AFTER), keys: [[0.5, [14, 14, 3400, 0, 260, -1300, 32, 0]]] },
  { id: 'about',  len: 1.0, hold: 1, a: st(drift(CAM.about, -0.5, 1, 0.01), ABOUT, AFTER), b: st(drift(CAM.about, 0.5, 1, 0.01), ABOUT, AFTER) },
];
const B = [...OPENING, ...REST];
// a move starts where the beat before it ended; a beat that follows a custom one starts where that one ends
let acc = 0; B.forEach((b, i) => { b.i = i; b.t0 = acc; acc += b.len; b.t1 = acc; });
export const TOTAL = acc;
const endOf = b => { if (b.custom) { const s = {}; b.custom(1, s); return s; } return b.b; };
B.forEach((b, i) => { if (!b.a && !b.custom) b.a = endOf(B[i - 1]); });
export const BEATS = B;
export const beat = id => B.find(b => b.id === id);
// where in the film the metal lands on the chip, for what is set off at that moment: the filings, the jolt of the camera, rings on the water
export const BLOWS_G = [beat('strike').t0 + beat('strike').len * HIT];

// ───────── the camera's track. Every place it passes through, in order along the film: the two ends of each hold, the end
// of each move and the places named inside it, the layers of the build. Each of its eight numbers runs through those places
// on a curve that never overshoots them (a monotone cubic), so a move grows out of the drift of the hold before it and
// settles into the drift of the next, and the camera is never standing still and never jerks.
const TRACK = (() => {
  const K = [], add = (g, c) => { const q = c.length < 8 ? [...c, 0] : c; if (K.length && g - K[K.length - 1].g < 1e-6) K[K.length - 1].c = q; else K.push({ g, c: q }); };
  for (const b of B) {
    if (b.custom) { let t = b.t0; LLEN.forEach((len, j) => { add(t + len * POUR, BCAM[j]); add(t + len, drift(BCAM[j], 0.5, 1.4, 0.012)); t += len; }); continue; }
    if (b.hold) add(b.t0, b.a.c);
    for (const [k, c] of b.keys || []) add(b.t0 + b.len * k, c);
    add(b.t1, b.b.c);
  }
  const n = K.length, x = K.map(q => q.g), M8 = [];
  for (let d = 0; d < 8; d++) { const y = K.map(q => q.c[d]), h = [], dl = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) { h[i] = x[i + 1] - x[i]; dl[i] = (y[i + 1] - y[i]) / h[i]; }
    for (let i = 1; i < n - 1; i++) if (dl[i - 1] * dl[i] > 0) { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]); }
    m[0] = dl[0]; m[n - 1] = dl[n - 2]; M8.push({ y, m }); }
  return { x, M8, n };
})();
export function camAt(g) {
  const { x, M8, n } = TRACK; g = clamp(g, x[0], x[n - 1]);
  let i = 0, j = n - 1; while (j - i > 1) { const m = (i + j) >> 1; if (x[m] <= g) i = m; else j = m; }
  const h = x[i + 1] - x[i], t = (g - x[i]) / h, t2 = t * t, t3 = t2 * t;
  return M8.map(({ y, m }) => (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1]);
}
const LEAD = 0.07;          // the camera looks a little ahead of where it is: at where its target will be this much further on

// where the camera is and what it looks at, from its eight numbers (look: a point to look at other than the one it turns about)
export function place(c, look) { const az = c[0] * Math.PI / 180, el = c[1] * Math.PI / 180;
  return { tgt: look || [c[3], c[4], c[5]], cam: [c[3] + Math.sin(az) * Math.cos(el) * c[2], c[4] + Math.sin(el) * c[2], c[5] + Math.cos(az) * Math.cos(el) * c[2]], fov: c[6], roll: c[7] || 0, dist: c[2] }; }

// The state of everything at g. (The camera comes from its track; the rest from the beat g falls in.)
export function state(g) {
  g = clamp(g, 0, TOTAL - 1e-6);
  const b = B.find(x => g < x.t1), k = (g - b.t0) / b.len, e = b.hold ? k : ease(k), s = {};
  if (b.custom) b.custom(k, s);
  else { for (const key in b.a) s[key] = mixv(b.a[key], b.b[key], e); if (b.fn) b.fn(k, s, e); }
  s.c = camAt(g); s.look = camAt(g + LEAD).slice(3, 6);
  Object.assign(s, place(s.c, s.look));
  s.objY = s.objPos[1]; s.g = g; s.i = b.i; s.id = b.id; s.k = k; s.hold = !!b.hold;
  return s;
}

// ───────── frames, for the path tracer (renderer/web), which still bakes stills from this timeline. It knows the memory and
// the old hall, not the lake or the forge: its pictures of the opening are of the chip alone.
const PER_HOLD = 7, PER_MOVE = 25;
export function frames() {
  const out = [];
  for (const b of B) {
    if (b.custom) { let t = b.t0; LLEN.forEach((len, j) => { for (const u of [POUR * 0.25, POUR * 0.5, POUR * 0.75]) out.push({ g: t + len * u }); out.push({ g: t + len * POUR, wipe: true }); out.push({ g: t + len * CARVED }); t += len; }); continue; }
    const n = b.n || Math.max(2, Math.round(b.len * (b.hold ? PER_HOLD : PER_MOVE)));
    for (let j = 0; j < n; j++) out.push({ g: b.t0 + b.len * j / n });
  }
  out.push({ g: TOTAL - 1e-4 }); return out;
}
const KNOBS = [0.76, 1.5, 3.0, 0.02, 1.2, 0.62, 0.34, 60, 0.03, 0.4, 0.8, 0.10, 0.6, 0, 0.6, 0];
export const shot = (g, o = {}) => shotOf(state(g), o);
export function shotOf(s, o = {}) {
  const k = KNOBS.slice(); k[2] = s.k2; k[4] = s.k4; k[5] = s.k5; k[6] = s.k6; k[14] = s.k14;
  return { cam: s.cam, tgt: s.tgt, fov: s.fov, focus: s.dist, aper: s.aper, maxEv: 64, wires: 0, sparks: 0, hp: 6000, hj: 600, col: [0.5, 4.0],
    lift: s.lift, objY: s.objY, obj: s.obj, buildY: s.buildY, morph: s.morph, tileUp: s.tileUp, peri: s.peri, sim: s.sim, simT: s.simT, power: s.power, write: s.write,
    cand: s.cand, pick: s.pick, vari: s.vari > 0.5 ? 1 : 0, ghost: s.ghost, carve: [s.carveX, s.carveT],
    waferHeat: s.waferHeat, fogD: s.fogD, shaft: s.shaft, own: s.own, keyI: s.keyI, back: s.back, stars: s.stars, beam: [s.beamI, s.beamR], k,
    post: { exp: s.exp, bloom: s.bloom, den: 1 }, ...o };
}
export const ORBIT = { beats: ['open', 'gds'], az: [-3.2, -1.6, 0, 1.6, 3.2] };
export function orbit(id, j) { const b = beat(id), s = state(b.t0 + b.len * 0.5); s.c = s.c.slice(); s.c[0] += ORBIT.az[j]; return Object.assign(s, place(s.c)); }

// ───────── where the words are on screen: each station from a point in one beat to a point in another
const WORDS = [['open', 0, 'strike', 0.1], ['lake', 0.06, 'cast', 0.42], ['stamp', 0.8, 'schem', 0.95], ['fan', 0.6, 'cands', 0.95], ['swell', 0.3, 'gds', 0.9],
  ['fan2', 0.6, 'lcands', 0.95], ['land', 0, 'build', 0.42], ['cool', 0.6, 'chip', 0.95], ['out', 0.72, 'end', 1], ['away', 0.7, 'about', 1]];
export const STATIONS = WORDS.map(([a, ka, b, kb]) => { const A = beat(a), Bb = beat(b); return { g0: A.t0 + A.len * ka, g1: Bb.t0 + Bb.len * kb, at: Bb.t0 + Bb.len * 0.3 }; });
