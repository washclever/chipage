// The stage: the scene of the film drawn live, every frame, from the state of the film at the scroll position (film.js).
// three.js on WebGPU, falling back to WebGL 2 by itself; every shader is written in TSL, which compiles to WGSL on WebGPU
// and to GLSL on WebGL 2. Nothing is baked, so the camera can be anywhere between two frames and the pointer can turn it.
//   the place (world.js): a lake that becomes the wafer, its shore, the forge across it, the sky;
//   the memory (memory.js): every line of the schematic, and every box of the layout grown out of its own line.
//     Above the layer being laid a box is light (glass that glows at its rim), below it the box is metal.
//     Where the pointer rests on it, its layers part;
//   the block of glass that closes over what has been laid, and the sheet of metal poured for each layer;
//   the same memory on the neighbouring dies while candidates are tried (in less detail), and on every die of the wafer at the end;
//   embers, moved by a compute shader; and the embers the typed line turns into on its way to being the first cell;
//   after it, from the depth of the picture: the light in the air (columns, fog), then bloom and the path tracer's grade.
import * as THREE from '../vendor/three.js';
import * as M from './memory.js';
import { CAST, LOOSE, HALL, TIP_Y } from './film.js';
import { createWorld, roundedBox } from './world.js';
import { createFluid } from './fluid.js';
import { C, h21, vn, fbm, heatColor, sky, smokeSky, aces, hue, curlNoise, js, PAL } from './shade.js';
import { rnd } from './hash.js';

const { Fn, If, Loop, Discard, float, int, vec2, vec3, vec4, uniform, uniformArray, attribute, instancedArray, instanceIndex,
  positionLocal, positionWorld, normalLocal, normalWorld, cameraPosition, screenCoordinate, mix, smoothstep, clamp, step,
  min, max, abs, exp, exp2, log2, pow, sin, cos, atan, fract, floor, sqrt, length, dot, normalize, select, fwidth, pass, rtt, getViewPosition,
  varying, uv, positionWorldDirection, modelViewMatrix, mx_noise_vec3 } = THREE.TSL;

const { XA, ZA, XB, ZB, CX, CZ, N, LINE_Y } = M;
const D = M.DIE, DC = [D.cellW, D.cellD];
const PI = Math.PI;
const COLD = vec3(...C.COLD);
const SEAMS = [[6.5, 0.1], [16, 0.34], [26.5, 0.62], [32, 0.76], [40.5, 0.84], [60.5, 1.0]];          // where one layer of the chip ends and the next begins: the height, and how far up the stack that is
const smooth01 = t => t.mul(t).mul(t.mul(-2.0).add(3.0));
const fmod = (x, y) => x.sub(floor(x.div(y)).mul(y));
const lerp = (a, b, t) => a + (b - a) * t, clampJ = (v, a, b) => Math.min(b, Math.max(a, v));
const srgb = c => c.map(v => Math.pow(v / 255, 2.2));

// ───────── the memory as data for instancing
const REG = { cell: 0, rowDev: 1, rowTrk: 2, colTrk: 3, colPre: 4, colIO: 5, bus: 6, ctl: 7, top: 8 };
const LID = { well: 5, act: 40, poly: 41, con: 42, m1: 43, br: 44, v1: 45, m2: 46, v2: 47, m3: 48, capB: 10, capD: 12, capT: 11, top: 19 };
const TID = { 'm1:Q': 49, 'm1:QB': 50, 'br:QB': 50, 'm3:TWL': 51, 'm2:TBL': 52, 'm2:TBLB': 53, 'm2:ADDR': 54, 'poly:WL': 55, 'top:PAD': 20, 'm3:TGND': 56, 'm2:TVDD': 57 };
const gid = (layer, tag) => TID[layer + ':' + tag] ?? LID[layer];
// what each kind of box is made of (the path tracer's getMat): metal albedo, roughness, metalness, the tint of its glass, its colour lying flat
function look(id) {
  let alb = [0.42, 0.43, 0.46], rough = 0.42, metal = 1, tint = [0.70, 0.80, 1.0];
  // (the metals differ, as in a chip: dark silicon, reddish gate, golden plugs, copper below, pale aluminium above)
  if (id === 40) { alb = [0.13, 0.15, 0.24]; rough = 0.26; tint = [0.45, 0.55, 1.0]; }
  else if (id === 41 || id === 55) { alb = [0.38, 0.25, 0.22]; rough = 0.46; tint = [1.0, 0.55, 0.30]; }
  else if ([42, 45, 47].includes(id)) { alb = [0.66, 0.52, 0.30]; rough = 0.32; tint = [1.0, 0.78, 0.40]; }
  else if ([43, 44, 49, 50].includes(id)) { alb = [0.62, 0.43, 0.34]; rough = 0.34; tint = [0.55, 0.72, 1.0]; }
  else if ([46, 52, 53, 54, 57].includes(id)) { alb = [0.48, 0.51, 0.58]; rough = 0.31; tint = [0.66, 0.84, 1.0]; }
  else if ([48, 51, 56].includes(id)) { alb = [0.60, 0.62, 0.67]; rough = 0.29; tint = [0.82, 0.92, 1.0]; }
  else if (id === 19 || id === 20) { alb = [0.64, 0.65, 0.69]; rough = 0.42; tint = [1.0, 0.96, 0.88]; }
  else if (id === 10 || id === 11) { alb = [0.70, 0.72, 0.76]; rough = 0.11; tint = [0.5, 0.7, 1.0]; }
  else if (id === 12) { alb = [0.05, 0.05, 0.05]; rough = 0.4; metal = 0; tint = [0.3, 0.5, 1.0]; }
  else if (id === 5) { alb = [0.15, 0.17, 0.22]; rough = 0.22; tint = [0.4, 0.5, 0.9]; }
  const plot = id === 40 ? [0.10, 0.20, 0.95] : (id === 41 || id === 55) ? [1.0, 0.26, 0.06] : [42, 45, 47].includes(id) ? [1.0, 0.62, 0.12]
    : [43, 49, 50].includes(id) ? [0.16, 0.55, 1.0] : (id === 19 || id === 20) ? [1.0, 0.88, 0.66] : id === 5 ? [0.05, 0.08, 0.3] : tint;
  return { alb, rough, metal, tint, plot };
}
// every line of the schematic in place: a, b (x, z) and which part, column and row it belongs to
function lineData(lod = false) {
  const out = [];
  for (const p of M.PARTS) {
    const xs = p.fold.includes('x') ? [...Array(N).keys()] : [-1], zs = p.fold.includes('z') ? [...Array(N).keys()] : [-1];
    for (const r of zs) for (const c of xs) { const dx = c >= 0 ? M.colX(c) : 0, dz = r >= 0 ? M.rowZ(r) : 0;
      for (const s of p.segs) out.push([s.a[0] + dx, s.a[1] + dz, s.b[0] + dx, s.b[1] + dz, REG[p.id], Math.max(c, 0), Math.max(r, 0), 0]); }
  }
  for (let r = 0; r < N; r++) for (let k = 0; k < 3; k++) { const x = M.busX(k, (r >> k) & 1), z = M.rowZ(r) - 9.6 + k * 1.6; out.push([x, z, XA - 44, z, 1, 0, r, 0]); }
  // seen from far (the candidates on the dies around ours), the drawing of each transistor is below a pixel: keep the longer lines
  return lod ? out.filter(d => Math.hypot(d[2] - d[0], d[3] - d[1]) >= 2.0) : out;
}
// every box of the layout in place, with the line it grows out of (memory.js, pairs). Sorted from the bottom layer up,
// so that lying flat the higher layers are drawn over the lower ones.
function boxData(lod = false) {
  const out = [], rankOf = l => M.RANK[l], li = Object.fromEntries(Object.keys(M.RANK).map((l, i) => [l, i]));
  const push = (a, b, layer, tag, reg, c, r, flags, x0 = 0, z0 = 0) => {
    const id = gid(layer, tag), L = look(id), bit = reg === 0 ? M.bit(r, c) : 0;
    out.push({ l: [a.c[0] + x0, a.c[2] + z0, a.h[0], a.h[2]], bc: [b.c[0] + x0, b.c[1], b.c[2] + z0], bh: b.h, id, layer: li[layer], rank: rankOf(layer), reg, c, r,
      born: flags.born ? 1 : 0, extra: flags.extra ? 1 : 0, dup: flags.dup ? 1 : 0, bit, L });
  };
  for (const p of M.PARTS) {
    const prs = M.pairs(p, 0), seen = new Set(), dupOf = prs.map(q => { if (q.born || q.extra) return false; const d = seen.has(q.a); seen.add(q.a); return d; });
    const xs = p.fold.includes('x') ? [...Array(N).keys()] : [-1], zs = p.fold.includes('z') ? [...Array(N).keys()] : [-1];
    for (const r of zs) for (const c of xs) { const dx = c >= 0 ? M.colX(c) : 0, dz = r >= 0 ? M.rowZ(r) : 0;
      prs.forEach((q, i) => push(q.a, q.b, q.layer, q.tag, REG[p.id], Math.max(c, 0), Math.max(r, 0), { born: q.born, extra: q.extra, dup: dupOf[i] }, dx, dz)); }
  }
  for (let r = 0; r < N; r++) for (let k = 0; k < 3; k++) { const x = M.busX(k, (r >> k) & 1), z = M.rowZ(r) + M.tapZ(k), zl = M.rowZ(r) - 9.6 + k * 1.6;
    push({ c: [(x + XA - 44) / 2, LINE_Y, zl], h: [Math.abs(x - (XA - 44)) / 2, 0, 0] }, { c: [x, 18.6, z], h: [0.6, 3.4, 0.6] }, 'v1', 'TAP', 1, 0, r, {}); }
  out.sort((a, b) => a.rank - b.rank);
  // seen from far: the boxes longer than two or three units, once each
  return lod ? out.filter(b => Math.max(b.bh[0], b.bh[2]) >= 1.2 && !b.extra) : out;
}

export async function createStage(canvas, opt = {}) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', forceWebGL: !!opt.webgl });
  await renderer.init();
  const gpu = !!renderer.backend.isWebGPUBackend, small = !opt.full && (Math.max(innerWidth, innerHeight) < 900 || matchMedia('(pointer: coarse)').matches);      // a phone or a tablet
  renderer.setClearColor(0x070a11, 1);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(24, 16 / 9, 2, 90000);

  // ───────── what a state of the film sets
  const U = {
    lift: uniform(0), objPos: uniform(new THREE.Vector3()), buildY: uniform(1000), morph: uniform(1), sim: uniform(0), simT: uniform(0), power: uniform(1), write: uniform(5.4),
    carveX: uniform(1e4), carveT: uniform(0), k1: uniform(1.5), k2: uniform(0.8), k4: uniform(1.2), k5: uniform(0.62), k6: uniform(0.34), k14: uniform(0.6),
    waferHeat: uniform(0), ghost: uniform(0), line: uniform(0.3), dist: uniform(600), time: uniform(0), dt: uniform(0.016),
    back: uniform(new THREE.Vector3(0.025, 0.04, 0.08)), stars: uniform(2), fogD: uniform(0.00005), keyCol: uniform(new THREE.Vector3(3, 4.2, 6)),
    rise: uniform(15), cold: uniform(0), amount: uniform(1), focal: uniform(900), dpr: uniform(1), fade: uniform(0),
    exposure: uniform(1.15), bloom: uniform(0.3), camPos: uniform(new THREE.Vector3()), camWorld: uniform(new THREE.Matrix4()), projInv: uniform(new THREE.Matrix4()),
    aspect: uniform(1.78), glassS: uniform(1),
    // the place (world.js): the lake setting into a wafer, the fire of the forge, the lights in the sky
    water: uniform(1), grid: uniform(0), ripple: uniform(0.3), furn: uniform(1), glare: uniform(1), aur: uniform(0), subGlow: uniform(0), steam: uniform(0),
    heat: uniform(0), flash: uniform(0), pour: uniform(1), embC: uniform(new THREE.Vector2()),
    loose: uniform(0),                          // how far the layers of the chip still stand apart (before the hammer has driven them home)
    cut: uniform(new THREE.Vector4()), solid: uniform(new THREE.Vector3()),          // the line the cold light is cutting along (x, height, how many sparks a second, whether); what a spark can land on (the chip, the anvil, and how high the chip's top is)
    kick: uniform(0), blow: uniform(new THREE.Vector4(0, 0, -100, 0)), blowP: uniform(new THREE.Vector3()), speed: uniform(0),          // what is left of the last blow of the hammer; where and when it fell; how fast the film is being scrolled
    hov: uniform(new THREE.Vector3()),          // where the pointer rests on the chip (x, z in the chip's own frame) and how far its parts have come loose there
    viewProj: uniform(new THREE.Matrix4()),          // the camera as one matrix (for what is simulated outside a material)
    dofR: uniform(0),                           // the largest blur of what is out of focus, as a part of the picture's height
    loaded: uniform(1), revealAt: uniform(new THREE.Vector2(0.5, 0.5)),          // while the page loads: how far the drawing has been heated into the scene, and from where
    idle: uniform(0),        // whether the chip is at rest and whole: its parts float a little of themselves
    // the typed line cast into the first cell: how far, where its pixels are on the page, the camera's frame, how far off the letters hang
    castFly: uniform(0), castProg: uniform(1), castA: uniform(new THREE.Vector4()), castD: uniform(200),
    camRt: uniform(new THREE.Vector3(1, 0, 0)), camUp: uniform(new THREE.Vector3(0, 1, 0)), camFw: uniform(new THREE.Vector3(0, 0, -1)), fl: uniform(4.7),
    // while the page loads: how far the heat has spread from the chip (world units), and where it spreads from
    front: uniform(0), heatC: uniform(new THREE.Vector3()), res: uniform(new THREE.Vector2(1, 1)), airIn: uniform(1),
    // how the place is seen through the lens (film.js): the colour of the chapter, the lens's own marks, the smear of a moving
    // camera (with the camera of the frame before), the distance the lens is focused at (it follows what is looked at, late),
    // the punch of a moment, what passes before the lens, and the frame of the film grain (24 a second)
    warm: uniform(0), sat: uniform(1), crush: uniform(0.5), halo: uniform(0.5), streak: uniform(0.5), dirt: uniform(0.5), vig: uniform(1), shutter: uniform(0),
    prevVP: uniform(new THREE.Matrix4()), focusD: uniform(600), punch: uniform(0), veilS: uniform(0), veilE: uniform(0), grainT: uniform(0),
  };
  const BITS = uniformArray([...Array(64).keys()].map(i => M.bit(i >> 3, i & 7)), 'float');
  const bitAt = (r, c) => BITS.element(int(r).mul(8).add(int(c)));
  const floorG = new THREE.Group(), mem = new THREE.Group(); scene.add(floorG, mem);

  // ───────── the sky, what the metal reflects, the lights
  // (and over it the forge's smoke, lit from below by its fire: shade.js)
  scene.backgroundNode = Fn(() => { const rd = positionWorldDirection, sm = smokeSky(rd, U.time, U.furn, U.back);
    return mix(sky(rd, U.back, U.stars, fwidth(rd.x).mul(190.0), U.aur, U.time), sm.xyz, sm.w); })();
  scene.environment = envMap(); scene.environmentIntensity = 1;
  const key = new THREE.DirectionalLight(0xffffff, 1); key.position.set(...C.KEYDIR).multiplyScalar(1000); scene.add(key, key.target);
  // the shaft of cold light the chip stands under (film.js: beamI): it lights the chip and a pool round it
  const beam = new THREE.SpotLight(0xffffff, 0, 0, 0.42, 0.75, 0); beam.position.set(0, 1400, 0); beam.color.setRGB(...C.KEYCOL); scene.add(beam, beam.target);

  // The floor mirrors the scene itself (the forge, the lines, the embers), on WebGPU and WebGL 2 alike, wherever the screen is
  // large enough to pay for drawing the scene a second time: the lake that becomes the wafer, and the anvil inside the forge.
  // (While a mirror is drawn, three hides the one material that asked for it; a second material reading the same picture would
  // be reading what is being drawn. So each mirroring surface has a mirror of its own, and only what is in view draws its.)
  const mirror = !small && !opt.noReflect ? () => { const r = THREE.TSL.reflector({ resolutionScale: 0.5, bounces: false }); r.target.rotateX(-PI / 2); floorG.add(r.target); return r; } : null;
  const fluid = createFluid({ renderer, U, small });          // the water as the pointer stirs it: it moves the surface (water.js) and carries embers and sparks
  const world = createWorld({ scene, floorG, mem, U, mirror, small, renderer, fluid });

  // ───────── the memory. One copy per die that is drawing it: ours, and up to fourteen candidates around it.
  // Each copy is a mesh of its own over the same geometry, and says where it is and how far it has got through two uniforms
  // that are set for each object as it is drawn: (offset x, offset z, inst, sel) and (mirror x, mirror z, tile, peri),
  // and a third: (the height laid in metal, how much of it is there, 1 for ours, -).
  const copyU = k => uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object.userData[k]);
  const uCa = copyU('ca'), uCb = copyU('cb'), uCc = copyU('cc');
  const toWorld = l => vec3(l.x.mul(uCb.x).add(uCa.x), l.y, l.z.mul(uCb.y).add(uCa.y));
  const inst = uCa.z, sel = uCa.w;
  const pulseOf = (reg, row) => {        // the simulation reads the memory row after row
    const st = fmod(U.simT.add(inst.mul(23.0)), 9.0), dq = row.add(0.5).sub(st).div(0.6), colp = pow(abs(sin(st.mul(PI))), 3.0).mul(step(st, 8.2));
    return select(reg.lessThan(2.5), exp(dq.mul(dq).negate()), select(reg.lessThan(3.5), colp.mul(0.2).add(0.08), select(reg.lessThan(5.5), colp.mul(0.75).add(0.25), float(0.3))));
  };
  const instDim = select(inst.greaterThan(0), inst.mul(0.5).add(0.5), float(1));
  const w = smoothstep(0.0, 0.5, U.morph);

  // lines of the schematic: one flat quad over each, wide enough for its glow
  const LD = lineData(), nL = LD.length;
  const makeLineGeo = LD => { const base = new THREE.PlaneGeometry(1, 1); base.rotateX(-PI / 2); const g = new THREE.InstancedBufferGeometry(), n = LD.length;
    g.index = base.index; g.setAttribute('position', base.getAttribute('position'));
    const aS = new Float32Array(n * 4), aI = new Float32Array(n * 4); LD.forEach((d, i) => { aS.set(d.slice(0, 4), i * 4); aI.set(d.slice(4, 8), i * 4); });
    g.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 4)); g.setAttribute('aI', new THREE.InstancedBufferAttribute(aI, 4)); g.instanceCount = n; return g; };
  // ours is drawn in full; the copies around it (only ever seen from far) with the reduced set
  const lineGeo = makeLineGeo(LD), lineGeoFar = makeLineGeo(lineData(true));
  const lineMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  {
    const aS = attribute('aS', 'vec4'), aI = attribute('aI', 'vec4');
    const c = aS.xy.add(aS.zw).mul(0.5), hc = abs(aS.zw.sub(aS.xy)).mul(0.5), h = hc.add(U.line.mul(6.0));
    const loc = vec3(positionLocal.x.mul(h.x.mul(2)).add(c.x), LINE_Y, positionLocal.z.mul(h.y.mul(2)).add(c.y));
    lineMat.positionNode = toWorld(loc);
    const vq = varying(loc.xz), vc = varying(c), vh = varying(hc), vI = varying(aI);
    lineMat.fragmentNode = Fn(() => {
      const q = vq, d = length(max(abs(q.sub(vc)).sub(vh), 0.0));
      // how much has been drawn: the cells are stamped outward from the first one, the rest is drawn away from the array after them
      const a = q.sub(vec2(XA, ZA)), ci = clamp(floor(a.div(vec2(CX, CZ))), 0.0, N - 1), qc = a.sub(ci.add(0.5).mul(vec2(CX, CZ)));
      const inArr = a.x.greaterThan(-2).and(a.x.lessThan(N * CX + 2)).and(a.y.greaterThan(-2)).and(a.y.lessThan(N * CZ + 2));
      const dc = uCb.z.mul(5.6).sub(max(abs(ci.x.sub(3)), abs(ci.y.sub(4))));
      const rvP = length(max(vec2(max(q.x.negate().add(XA), q.x.sub(XB)), max(q.y.negate().add(ZA), q.y.sub(ZB))), 0.0)).add(2.0).sub(uCb.w.mul(134.0));
      const rvC = length(qc).sub(clamp(dc, 0.0, 1.0).mul(17.5)).toVar(), ageC = clamp(dc.sub(1), 0.0, 1.0).toVar();
      {          // our first cell appears line by line, each as the sparks meant for it land (castProg)
        const hsh = h21(vc.mul(7.3)).mul(0.9), mine = uCc.z.greaterThan(0.5).and(ci.x.equal(3)).and(ci.y.equal(4)).and(inArr);
        If(mine, () => { rvC.assign(mix(float(1.0), float(-6.0), smoothstep(hsh.sub(0.015), hsh.add(0.015), U.castProg))); });
      }
      const rv = select(inArr, rvC, rvP);
      const age0 = select(inArr, ageC, float(1)), age = select(rv.greaterThan(-4), min(age0, clamp(rv.negate().div(4), 0.0, 1.0)), age0);
      const shown = smoothstep(0.35, -0.35, rv);
      const aa = fwidth(d).max(1e-4), core = smoothstep(U.line.add(aa), U.line.sub(aa).max(0), d), glow = exp(d.negate().div(U.line.mul(1.7))).mul(0.22);
      const hot = mix(vec3(1.0, 0.50, 0.16).mul(1.5), COLD.mul(1.25).add(0.12), age);              // drawn hot, then it cools
      const col = mix(vec3(0.55, 0.07, 0.01), hot, smoothstep(0.25, 0.9, sel)).mul(pulseOf(vI.x, vI.z).mul(U.sim).mul(2.2).add(1)).mul(sel).mul(instDim);
      const fade = smoothstep(0.12, 0.03, w).mul(uCc.y);
      return vec4(col.mul(U.k2).mul(core.add(glow)).mul(shown).mul(fade), 1.0);
    })();
  }

  // boxes of the layout, each grown out of its line: line → lying flat on the plane of the schematic → standing at its height
  const BD = boxData(), nB = BD.length;
  const makeBoxGeo = BD => { const base = new THREE.BoxGeometry(1, 1, 1); const g = new THREE.InstancedBufferGeometry(), nB = BD.length;
    g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('normal', base.getAttribute('normal'));
    // all of a box in one interleaved buffer: WebGPU allows a pipeline only eight vertex buffers
    const A = [['aL', 4], ['aBC', 3], ['aBH', 3], ['aM', 4], ['aN', 4], ['aF', 4], ['aTint', 3], ['aPlot', 3], ['aAlb', 3]], stride = A.reduce((n, a) => n + a[1], 0);
    const data = new Float32Array(nB * stride);
    BD.forEach((b, i) => data.set([...b.l, ...b.bc, ...b.bh, b.id, b.L.metal, b.L.rough, b.layer, b.c, b.r, b.rank, b.reg, b.born, b.extra, b.dup, b.bit, ...b.L.tint, ...b.L.plot, ...b.L.alb], i * stride));
    const ib = new THREE.InstancedInterleavedBuffer(data, stride, 1); let off = 0;
    for (const [k, n] of A) { g.setAttribute(k, new THREE.InterleavedBufferAttribute(ib, n, off)); off += n; }
    g.instanceCount = nB; return g; };
  const boxGeo = makeBoxGeo(BD), boxGeoFar = makeBoxGeo(boxData(true));
  const aL = attribute('aL', 'vec4'), aBC = attribute('aBC', 'vec3'), aBH = attribute('aBH', 'vec3'), aM = attribute('aM', 'vec4'), aN = attribute('aN', 'vec4'), aF = attribute('aF', 'vec4');
  const rankRise = smooth01(clamp(U.morph.sub(0.4).div(0.6).mul(1.5).sub(aN.z.mul(0.5)), 0.0, 1.0));
  const lineHalf = select(aF.x.greaterThan(0.5), vec3(0), vec3(aL.z.add(U.line), U.line, aL.w.add(U.line)));
  const cW = mix(vec3(aL.x, LINE_Y, aL.y), vec3(aBC.x, aN.z.mul(0.8).add(LINE_Y), aBC.z), w), hW = mix(lineHalf, vec3(aBH.x, U.line.add(0.06), aBH.z), w);
  const boxC = vec3(cW.x, mix(cW.y, aBC.y, rankRise), cW.z), boxH = vec3(hW.x, mix(hW.y, aBH.y, rankRise), hW.z);
  // (before the hammer has driven them home, the layers of our chip stand a little apart: the higher the layer, the further)
  const boxLoc = positionLocal.mul(boxH.mul(2)).add(boxC).add(vec3(0, aN.z.mul(U.loose).mul(uCc.z).mul(LOOSE), 0));               // in the die, before the copy is moved or mirrored
  // Where the pointer rests on our chip (a finger: where it presses), the stack opens there: the parts within reach lift, the higher their layer
  // the higher, slide a little away from the place under the pointer, and tip up on the side away from it, like the leaves
  // of a book opened from one edge (a small part tips more, a long wire hardly at all). Left to itself, the chip is not
  // quite still: a slow swell runs across its upper layers. (It is not lit for coming apart: it comes apart, no more.)
  const seedP = vec3(h21(aBC.xz.mul(0.37).add(aN.z.mul(7.0))), h21(aBC.zx.mul(0.53).add(3.0)), h21(aBC.xz.mul(0.71).add(9.0)));          // three numbers of its own for each part
  const partNear = smoothstep(95.0, 18.0, length(max(abs(U.hov.xy.sub(boxC.xz)).sub(boxH.xz), 0.0))).mul(U.hov.z);          // (its reach is measured to its footprint: a part moves whole)
  const swell = sin(U.time.mul(0.9).sub(boxC.x.mul(0.011)).sub(boxC.z.mul(0.007)).add(seedP.z.mul(2.2))).mul(0.5).add(0.5);
  const partIdle = swell.mul(swell).mul(seedP.x.mul(0.6).add(0.4)).mul(0.1).mul(U.idle);
  const partLift = partNear.mul(seedP.y.mul(0.35).add(0.42).add(sin(U.time.mul(1.3).add(seedP.x.mul(6.2832))).mul(0.05)));
  const partD = max(partIdle, partLift).mul(smoothstep(0.2, 0.62, aN.z)).mul(uCc.z);
  const boxOut = Fn(() => {
    const d = partD.toVar(), away = boxC.xz.sub(U.hov.xy), al = length(away).max(1.0), dir = away.div(al), off0 = positionLocal.mul(boxH.mul(2)).toVar();
    const thin = clamp(float(14.0).div(max(boxH.x, boxH.z).max(1.0)), 0.05, 1.0);          // how readily it tips
    const tip = vec3(dir.y.negate(), 0.0, dir.x).mul(d.mul(0.42).mul(thin).mul(partNear)), twist = vec3(0.0, seedP.z.sub(0.5).mul(d).mul(0.6).mul(thin), 0.0);          // turns about a level axis across the way it slides, and about the upright
    const cen = boxC.add(vec3(0, aN.z.mul(U.loose).mul(uCc.z).mul(LOOSE), 0));
    const slide = dir.mul(min(al, 140.0).mul(0.35).mul(d).mul(partNear));
    return cen.add(vec3(slide.x, d.mul(boxC.y.add(40.0)), slide.y)).add(off0).add(THREE.TSL.cross(tip.add(twist), off0));
  })();
  const vLoc = varying(boxLoc), vUnit = varying(positionLocal), vHalf = varying(boxH), vM = varying(aM), vN = varying(aN), vF = varying(aF);
  const vTint = varying(attribute('aTint', 'vec3')), vPlot = varying(attribute('aPlot', 'vec3')), vAlb = varying(attribute('aAlb', 'vec3'));
  const isId = (...ids) => ids.map(i => vM.x.equal(i)).reduce((a, b) => a.or(b));
  const vNrm = varying(normalLocal);
  // how far a point of a face is from that face's edges
  const edgeDist = () => { const n = abs(vNrm), e = vHalf.mul(abs(vUnit).mul(-2).add(1)), big = float(1e4);
    return min(select(n.x.greaterThan(0.5), big, e.x), min(select(n.y.greaterThan(0.5), big, e.y), select(n.z.greaterThan(0.5), big, e.z))); };

  const lightMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
  lightMat.positionNode = toWorld(boxOut);
  lightMat.fragmentNode = Fn(() => {
    const by = uCc.x, k = by.sub(vLoc.y);
    If(k.greaterThanEqual(0), () => { Discard(); });           // laid already: that part is metal
    const g = smoothstep(0.10, 0.55, w), lying = smoothstep(0.78, 0.45, U.morph).mul(g);
    const glow = mix(vTint, vPlot, 0.75), write = smoothstep(-3.5, 0.0, k).mul(step(by, 900.0));
    const lineCol = COLD.mul(1.25).add(0.12).mul(pulseOf(vN.w, vN.y).mul(U.sim).mul(2.2).add(1));
    const emi = lineCol.mul(g.oneMinus()).mul(U.k2).add(glow.mul(g).mul(0.012)).add(vPlot.mul(lying).mul(0.8)).mul(sel).mul(instDim).add(COLD.mul(write).mul(U.k4)).toVar();
    // a box of light: its edges glow, its faces catch a little light at a grazing angle. A box only a few pixels across would be
    // all edge, so a small one keeps a faint fill instead
    const v = normalize(cameraPosition.sub(positionWorld)), rim = pow(abs(dot(normalWorld, v)).oneMinus(), 3.0);
    const ed = edgeDist(), fwd = fwidth(ed).max(1e-4), edge = smoothstep(fwd.mul(1.6), 0.0, ed);
    const n = abs(vNrm), big = float(1e4), faceMin = min(select(n.x.greaterThan(0.5), big, vHalf.x), min(select(n.y.greaterThan(0.5), big, vHalf.y), select(n.z.greaterThan(0.5), big, vHalf.z)));
    const sharp = smoothstep(1.5, 5.0, faceMin.div(fwd));
    emi.addAssign(vTint.mul(rim.mul(0.10).add(edge.mul(sharp).mul(0.30)).add(sharp.oneMinus().mul(0.025))).mul(g).mul(lying.oneMinus()).mul(sel).mul(instDim));
    const f = smoothstep(0.0, 0.06, w).mul(select(vF.y.greaterThan(0.5), smoothstep(0.6, 0.3, w), float(1))).mul(select(vF.z.greaterThan(0.5), smoothstep(0.0, 0.25, w), float(1))).mul(uCc.y);
    return vec4(emi.mul(f), lying.mul(0.85).mul(sel).mul(f));
  })();

  const metalMat = new THREE.MeshPhysicalNodeMaterial();
  metalMat.positionNode = toWorld(boxOut);
  {
    const k = uCc.x.sub(vLoc.y), p = vLoc, reg = vN.w, col = vN.x, row = vN.y;
    // The metal as it is in a chip: each level in its own colour (look), polished flat. A fine grain runs along each part's
    // length (the polish), seen only close enough to make out and never shimmering; each part is a shade of its own; and
    // its edges are a little smoother, so its outline catches what it reflects. No grain across it, and no coat of frost:
    // it reads as metal, not as sand or snow, and it does not whiten.
    const long = vHalf.x.greaterThan(vHalf.z), along = select(long, p.x, p.z), across = select(long, p.z, p.x);
    const near = clamp(float(170).div(U.dist), 0.0, 1.0).mul(smoothstep(0.6, 0.1, fwidth(across.mul(1.6))));
    const polish = vn(vec3(along.mul(0.035), across.mul(1.6), p.y.mul(0.4))).sub(0.5).mul(near);
    const ctr = vLoc.sub(vUnit.mul(vHalf.mul(2.0))), own = h21(floor(ctr.xz.mul(0.25)).add(floor(ctr.y)));
    const rimE = Fn(() => { const ed = edgeDist(); return smoothstep(fwidth(ed).mul(2.0).add(0.6), 0.0, ed); })();
    metalMat.colorNode = Fn(() => {
      If(k.lessThan(0), () => { Discard(); });                 // above the layer being laid: still light
      return vAlb.mul(own.sub(0.5).mul(0.10).add(1.0)).mul(polish.mul(0.08).add(1.0));
    })();
    metalMat.roughnessNode = clamp(vM.z.add(polish.mul(0.10)).add(own.sub(0.5).mul(0.06)).sub(rimE.mul(0.08)), 0.06, 1.0);
    metalMat.metalnessNode = vM.y;
    metalMat.emissiveNode = Fn(() => {
      const T = float(0).toVar(), emi = vec3(0).toVar();
      const pw = U.power.mul(step(900.0, uCc.x)).toVar();
      If(pw.greaterThan(0).and(inst.lessThanEqual(0)), () => {
        // what it is doing: rows are written one after another; a cell that holds a one stays warm
        const wr = U.write.sub(row).toVar(), now = step(0.0, wr).mul(step(wr, 1.0)).toVar(), done = step(1.0, wr).toVar(), act = now.mul(sin(clamp(wr, 0.0, 1.0).mul(PI))).toVar();
        const r8 = clamp(floor(U.write), 0.0, 7.0).toVar(), a2 = sin(fract(U.write).mul(PI)).mul(step(U.write, 7.999)).toVar();
        If(reg.lessThan(0.5), () => {
          const b = vF.w, hold = b.mul(done.mul(0.76).add(now.mul(mix(1.0, 0.76, smoothstep(0.3, 1.0, wr))))).toVar();
          If(isId(49), () => { T.assign(hold); })
            .ElseIf(isId(50, 42, 45), () => { T.assign(hold.mul(0.55)); })
            .ElseIf(isId(41), () => { T.assign(hold.mul(0.36)); })
            .ElseIf(isId(40), () => { const lz = p.z.sub(ZA).sub(row.add(0.5).mul(CZ)); T.assign(max(hold.mul(0.24), select(lz.lessThan(-3.0), act.mul(0.5), float(0)))); })
            .ElseIf(isId(55), () => { emi.addAssign(COLD.mul(act).mul(3.0)); });
          If(isId(50), () => { emi.addAssign(COLD.mul(b.oneMinus()).mul(done).mul(0.06)); });
        }).ElseIf(reg.lessThan(1.5), () => { T.assign(act.mul(select(isId(41), float(0.55), float(0.3)))); })
          .ElseIf(reg.lessThan(2.5).and(isId(51)), () => { emi.addAssign(COLD.mul(act.mul(4.0).add(0.03))); })
          .ElseIf(reg.lessThan(3.5).and(isId(52, 53)), () => { const b = bitAt(r8, col); emi.addAssign(COLD.mul(a2.mul(U.k1).mul(select(isId(52), b, b.oneMinus())).add(0.06))); })
          .ElseIf(reg.lessThan(5.5).and(reg.greaterThan(4.5)).and(p.z.lessThan(ZB + 14)), () => { T.assign(a2.mul(bitAt(r8, col)).mul(select(isId(41), float(0.5), float(0.25)))); });
        If(isId(54), () => { emi.addAssign(COLD.mul(0.25)); });
      });
      If(isId(12), () => { emi.assign(COLD.mul(U.power).mul(vn(vec3(p.x.mul(0.7), 1.0, p.z.mul(0.7))).mul(1.2).add(1.2)).add(vec3(0.010, 0.022, 0.05))); });
      // freshly laid metal: white at the surface where it has just been poured, glowing for a while below
      If(uCc.x.lessThan(900), () => {
        // (it cools unevenly: a dull skin creeps over it in patches, darker than the metal still bright between them)
        const cr = vn(p.mul(0.35).add(2.0)), near = select(U.carveT.greaterThan(0), exp(max(U.carveX.sub(p.x), 0.0).negate().div(60.0)), float(1));
        const sk = smoothstep(0.46, 0.62, fbm(vec3(p.x.mul(0.06), p.z.mul(0.06), U.time.mul(0.03).add(p.y.mul(0.02)))));
        T.assign(max(T, smoothstep(4.5, 0.0, k).mul(U.k5).mul(near).add(smoothstep(11.0, 2.0, k).mul(U.k6).mul(0.6).mul(near.mul(0.65).add(0.35))).mul(cr.mul(0.3).add(0.85)).mul(mix(float(1.0), float(0.55), sk))));
      });
      // heated through, and white where the hammer has just fallen: the blow runs out from where it fell
      const fl = max(U.flash, U.kick).toVar();
      If(U.heat.greaterThan(0.001).or(fl.greaterThan(0.001)), () => {
        const hn = vn(p.mul(0.045).add(vec3(0.0, U.time.mul(0.25), 0.0))).mul(0.45).add(0.62);          // (the heat is deepest inside: the top layer, open to the air, is the dullest)
        T.assign(max(T, min(U.heat.mul(hn).mul(0.8).mul(mix(float(1.0), float(0.5), vN.z)).add(fl.mul(smoothstep(30.0, 60.0, p.y)).mul(exp(length(p.xz).div(-105.0))).mul(0.42)), 0.8)));
      });
      // (a part that has come loose is not lit for it: the chip comes apart under the pointer, it does not light up)
      return emi.add(heatColor(T));
    })();
  }

  // ───────── the body of the chip: the clear glass its layers are laid in (what lies between the metal of a chip is glass).
  // It is not a film laid over the chip. It is a solid, and what is seen through it is bent: the picture drawn so far (the
  // layers inside it, the anvil or the wafer under it, the lake, the forge, the sparks) is read again through its surface,
  // each colour by its own bending, red least and violet most. So what is bright inside or behind it comes apart into its
  // colours where the surface turns (the rounded edges, the slow waves of cast glass, the ring a blow sends through it),
  // and stays clear where it is looked at squarely. Frost blurs it in patches; it mirrors the sky at a grazing angle.
  const back = THREE.TSL.viewportMipTexture();          // the picture so far, with its smaller copies for where the glass is frosted
  const glassMat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.04, metalness: 0, color: 0x000000, ior: 1.5, transparent: true, depthWrite: false });
  {
    const { refract, cameraViewMatrix, cameraProjectionMatrix, transformNormalToView } = THREE.TSL;
    const lp = positionWorld.sub(U.objPos), n0 = normalize(normalWorld).toVar(), V = normalize(cameraPosition.sub(positionWorld)).toVar();
    const flatN = max(abs(n0.x), max(abs(n0.y), abs(n0.z))), bev = smoothstep(0.0, 0.2, flatN.oneMinus()), side = abs(n0.y).oneMinus();        // bev: 0 on a face, 1 where the edge turns
    // its surface is not quite flat: the slow waves of cast glass; a shimmer while it is hot; on its sides the layers show
    // as faint seams; and for a moment after a blow, a ring runs out through it from where the hammer fell
    const ph = vn(lp.mul(0.011).add(4.0)).mul(6.0);
    let wob = vec3(sin(lp.x.mul(0.083).add(U.time.mul(2.3)).add(ph)), sin(lp.y.mul(0.11).sub(U.time.mul(3.1))), cos(lp.z.mul(0.071).sub(U.time.mul(1.9)).add(ph))).mul(U.heat.mul(0.04));
    for (const [dx, dy, dz, len, amp] of [[0.8, 0.1, 0.6, 61, 1.0], [-0.5, 0.2, 0.86, 37, 0.7], [0.3, 0.9, -0.3, 23, 0.45]])
      wob = wob.add(vec3(dx, dy, dz).mul(cos(dot(lp, vec3(dx, dy, dz)).mul(6.2832 / len).add(ph)).mul(amp * 0.017)));
    let seam = float(0);          // (the seams move apart with the layers)
    for (const L of SEAMS) { const q = lp.y.sub(U.loose.mul(LOOSE * L[1]).add(L[0])).div(0.8); seam = seam.add(q.mul(exp(q.mul(q).negate()))); }
    wob = wob.add(vec3(0, 1, 0).mul(seam).mul(side).mul(0.2));
    const bd = lp.xz.sub(U.blow.xy), bl = length(bd).max(1.0), age = U.time.sub(U.blow.z), ring = exp(pow(bl.sub(age.mul(640.0)).div(26.0), 2.0).negate()).mul(U.blow.w).mul(exp(age.mul(-4.2))).mul(step(0.0, age));
    wob = wob.add(vec3(bd.x, 0.0, bd.y).div(bl).mul(ring).mul(0.9)).toVar();
    const N = normalize(n0.add(wob.sub(n0.mul(dot(wob, n0))))).toVar();
    glassMat.normalNode = transformNormalToView(N);
    // (no frost on it: it stays clear, and does not whiten)
    const rough = bev.mul(0.05).add(0.03).toVar();
    glassMat.roughnessNode = rough;
    // how far through it a ray goes before it meets what is inside: a little on its faces, further in from its sides
    const th = mix(float(26), float(66), side).mul(U.loose.mul(0.3).add(1.0)), spread = mix(float(0.07), float(0.36), bev), lod = rough.mul(6.5);
    const S = small ? 4 : 7, jit = h21(screenCoordinate.xy.add(fract(U.time).mul(61.0)));
    glassMat.backdropNode = Fn(() => {
      const acc = vec3(0).toVar(), ws = vec3(0).toVar();
      for (let i = 0; i < S; i++) {
        const t = float(i).add(jit).div(S);          // where in the spectrum: 0 red .. 1 violet
        const R = refract(V.negate(), N, float(1.0).div(t.sub(0.5).mul(spread).add(1.5)));
        const cl = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(positionWorld.add(R.mul(th)), 1.0)));
        const st = clamp(cl.xy.div(cl.w).mul(vec2(0.5, -0.5)).add(0.5), 0.001, 0.999);
        const w = vec3(clamp(t.mul(-4.0).add(2.0), 0.0, 1.0), clamp(abs(t.mul(4.0).sub(2.0)).negate().add(2.0), 0.0, 1.0), clamp(t.mul(4.0).sub(2.0), 0.0, 1.0));
        acc.addAssign(back.sample(st).level(lod).rgb.mul(w)); ws.addAssign(w);
      }
      // what passes through takes a little of the colour of thick glass, and is less where the surface mirrors instead
      const F = pow(dot(N, V).clamp().oneMinus(), 5.0).mul(0.96).add(0.04);
      return acc.div(ws).mul(exp(vec3(-0.0030, -0.0011, -0.0004).mul(th).mul(2.0))).mul(F.oneMinus());
    })();
    // the glass itself holds a little light: of the heat inside it, of the blow, of the cold light it stands in
    glassMat.emissiveNode = heatColor(U.heat.mul(0.74).add(max(U.flash, U.kick).mul(0.12))).mul(th.mul(0.0011)).mul(side.mul(0.6).add(0.4))
      .add(COLD.mul(0.004));
  }
  const glass = new THREE.Mesh(roundedBox(D.hw * 2, D.glass, D.hd * 2, 7), glassMat); glass.renderOrder = 2;
  // The sheet: the metal poured for a layer, still liquid, as it is in the furnace. It shines by its own heat: orange where
  // the liquid lies open, deeper red where it has begun to cool. A dark skin forms on it as it cools, in plates that never
  // keep still: they ride the liquid as it runs, change shape as they go, crack apart and close up, and here and there one
  // breaks up and the liquid wells through; the liquid shows bright in the cracks and along the edges of the plates. Just
  // poured, it is mostly open liquid with wide bright cracks; by the time the cut has crossed it, the skin covers most of
  // it and the cracks have narrowed and dulled. The open liquid is smooth and mirrors what is round it; the skin is rough and
  // dull, and stands a little proud of the liquid. Along the line where it is being cut, it is white. (Wide areas stay below
  // the heat at which the glow floods the picture.)
  const plates = Fn(([x, t]) => {          // the nearest two of a scatter of points, one in each unit square, each wandering round a small loop of its own: their distances, and a number for the nearest
    const i = floor(x).toVar(), f = fract(x).toVar(), d1 = float(9).toVar(), d2 = float(9).toVar(), id = float(0).toVar();
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const o = vec2(a, b), c = i.add(o), h1 = h21(c), h2 = h21(c.add(vec2(37.0, 11.0)));
      const at = vec2(sin(t.mul(h1.mul(0.6).add(0.5)).add(h2.mul(6.2832))), cos(t.mul(h2.mul(0.6).add(0.5)).add(h1.mul(6.2832)))).mul(0.32).add(0.5);
      const d = length(o.add(at).sub(f));
      d2.assign(min(d2, max(d1, d))); id.assign(select(d.lessThan(d1), h21(c.add(vec2(5.0, 71.0))), id)); d1.assign(min(d1, d));
    }
    return vec3(d1, d2, id);
  }).setLayout({ name: 'plates', type: 'vec3', inputs: [{ name: 'x', type: 'vec2' }, { name: 't', type: 'float' }] });
  const sheetMat = new THREE.MeshPhysicalNodeMaterial();
  {
    const p = positionWorld.sub(U.objPos), top = step(0.5, normalWorld.y).toVar('sheetTop');
    // how far it has cooled: nothing as the pour begins, about half when it is poured, all of it once the cut has crossed it
    const cool = clamp(U.pour.mul(0.45).add(clamp(U.carveX.add(166.0).div(332.0), 0.0, 1.0).mul(0.55)), 0.0, 1.0).toVar('sheetCool');
    // the liquid runs across and turns over as it goes: the pattern rides a field of its own that keeps changing
    const q = vec3(p.x.mul(0.016).sub(U.time.mul(0.09)), p.z.mul(0.016).add(sin(U.time.mul(0.21)).mul(0.06)), U.time.mul(0.06));
    const qw = q.add(vec3(fbm(q.add(1.7)), fbm(q.add(vec3(5.2, 1.3, 2.8))), 0.0).sub(0.5).mul(1.1)).toVar('sheetQ');
    // the skin: plates, each a slab of its own, with bright cracks between them; where a plate has broken up the liquid lies
    // open, and those places wander; the hotter the metal, the more of it lies open and the wider the cracks
    const pl = plates(qw.xy.mul(2.4).add(vec2(fbm(qw.mul(4.0)), fbm(qw.mul(4.0).add(3.3))).mul(0.35)), U.time.mul(0.8)).toVar('sheetPl');
    const opening = mix(float(0.3), float(0.8), cool);
    const gap = pl.y.sub(pl.x), open = smoothstep(opening, opening.add(0.12), pl.z.add(fbm(qw.mul(0.9).add(vec3(6.0, 0.0, U.time.mul(0.12)))).mul(0.3))).toVar('sheetOpen');
    const skin = smoothstep(mix(float(0.03), float(0.012), cool), mix(float(0.12), float(0.07), cool), gap).mul(open.oneMinus()).toVar('sheetSkin');          // 0 in the cracks and where it lies open
    const inner = smoothstep(0.05, 0.4, pl.x.oneMinus().mul(gap)).toVar('sheetInner');          // toward the middle of a plate, away from its cracks
    // how hot: the liquid as hot as the pour, streaked where it runs, a little less as it cools; a plate dark at its middle
    // and dull red toward its edges, darker as it cools
    const Tl = clamp(U.k14.mul(1.1), 0.0, 0.6).mul(mix(float(1.04), float(0.9), cool)).mul(fbm(vec3(qw.x.mul(7.0), qw.y.mul(2.2), qw.z.mul(3.0))).sub(0.5).mul(0.22).add(1.0)).toVar('sheetTl');
    const edge = exp(max(p.x.sub(U.carveX), 0.0).negate().div(4.0));
    const T = mix(Tl, Tl.mul(mix(mix(float(0.7), float(0.55), cool), mix(float(0.32), float(0.18), cool), inner)), skin).add(edge.mul(0.3));
    // its relief, read off the change from pixel to pixel: the plates stand a little proud of the liquid, their cracks sunk in
    const hgt = skin.mul(0.7).add(inner.mul(0.25)).add(fbm(qw.mul(9.0)).mul(0.35).mul(skin)).add(fbm(qw.mul(1.6).add(3.0)).mul(0.5).mul(skin.oneMinus()));
    const dpx = THREE.TSL.dFdx(p), dpy = THREE.TSL.dFdy(p), dhx = THREE.TSL.dFdx(hgt), dhy = THREE.TSL.dFdy(hgt);
    const det = dpx.x.mul(dpy.z).sub(dpx.z.mul(dpy.x)), dt = det.add(select(det.greaterThanEqual(0.0), float(1e-6), float(-1e-6)));
    const g = vec2(dhx.mul(dpy.z).sub(dhy.mul(dpx.z)), dpx.x.mul(dhy).sub(dhx.mul(dpy.x))).div(dt).mul(1.4);
    sheetMat.normalNode = THREE.TSL.transformNormalToView(normalize(mix(normalWorld, vec3(g.x.negate(), 1.0, g.y.negate()), top)));
    // the liquid gives back a little warm light of what is round it; the skin is a dark, rough crust
    sheetMat.colorNode = mix(vec3(0.22, 0.14, 0.09), vec3(0.025, 0.02, 0.018), skin);
    sheetMat.metalnessNode = mix(float(0.35), float(0.0), skin);
    sheetMat.roughnessNode = mix(float(0.42), float(0.92), skin);
    sheetMat.emissiveNode = heatColor(mix(Tl.mul(1.04), T, top)).add(COLD.mul(edge).mul(0.4).mul(top));          // (on its sides it is all liquid)
  }
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sheetMat);
  mem.add(glass, sheet);

  const copies = [];
  const mkCopy = (ci, cj) => {
    const far = !!(ci || cj), o = { ci, cj, h: far ? js.h21(ci + 3.7, cj + 3.7) : 0, lines: new THREE.Mesh(far ? lineGeoFar : lineGeo, lineMat), light: new THREE.Mesh(far ? boxGeoFar : boxGeo, lightMat),
      u: { ca: new THREE.Vector4(ci * DC[0], cj * DC[1], 0, 1), cb: new THREE.Vector4(1, 1, 1, 1), cc: new THREE.Vector4(-5, 1, 0, 0) } };
    for (const m of [o.lines, o.light]) { m.frustumCulled = false; m.userData = o.u; mem.add(m); }      // the meshes of one copy share its numbers
    o.lines.renderOrder = 1; o.light.renderOrder = 3; copies.push(o); return o;
  };
  const ours = mkCopy(0, 0);
  ours.metal = new THREE.Mesh(boxGeo, metalMat); ours.metal.frustumCulled = false; ours.metal.userData = ours.u; mem.add(ours.metal);
  for (let j = -1; j <= 1; j++) for (let i = -2; i <= 2; i++) if (i || j) mkCopy(i, j);

  // ───────── every die of the wafer gets the chip at the end: the top layers of metal, a body under them, and glass
  const DIES = []; for (let j = -9; j <= 9; j++) for (let i = -7; i <= 7; i++) { if (!i && !j) continue; const x = i * DC[0], z = j * DC[1];
    if (Math.hypot(x - C.WC[0], z - C.WC[1]) < C.WR - 250) DIES.push([x, z, Math.hypot(x, z)]); }
  const ghost = (() => {
    const keep = BD.filter(b => ['top', 'm3', 'm2', 'v2', 'capB', 'capD', 'capT'].includes(Object.keys(M.RANK)[b.layer]) && !b.extra);
    const n = keep.length * DIES.length, base = new THREE.BoxGeometry(1, 1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('normal', base.getAttribute('normal'));
    const aBC = new Float32Array(n * 3), aBH = new Float32Array(n * 3), aAlb = new Float32Array(n * 4), aG = new Float32Array(n * 4); let i = 0;
    for (const d of DIES) for (const b of keep) { aBC.set([b.bc[0] + d[0], b.bc[1], b.bc[2] + d[1]], i * 3); aBH.set(b.bh, i * 3); aAlb.set([...b.L.alb, b.L.rough], i * 4); aG.set([d[2], b.id, 0, 0], i * 4); i++; }
    // the body: one slab per die standing for everything below metal 2
    const nb = DIES.length, bBC = new Float32Array(nb * 3), bBH = new Float32Array(nb * 3), bAlb = new Float32Array(nb * 4), bG = new Float32Array(nb * 4);
    DIES.forEach((d, j) => { bBC.set([d[0], 10.5, d[1]], j * 3); bBH.set([D.hw - 1, 10.5, D.hd - 1], j * 3); bAlb.set([0.20, 0.21, 0.24, 0.3], j * 4); bG.set([d[2], 1, 1, 0], j * 4); });
    const attr = (geo, k, a, s) => geo.setAttribute(k, new THREE.InstancedBufferAttribute(a, s));
    attr(g, 'aBC', aBC, 3); attr(g, 'aBH', aBH, 3); attr(g, 'aAlb', aAlb, 4); attr(g, 'aG', aG, 4); g.instanceCount = n;
    const gb = new THREE.InstancedBufferGeometry(); gb.index = base.index; gb.setAttribute('position', base.getAttribute('position')); gb.setAttribute('normal', base.getAttribute('normal'));
    attr(gb, 'aBC', bBC, 3); attr(gb, 'aBH', bBH, 3); attr(gb, 'aAlb', bAlb, 4); attr(gb, 'aG', bG, 4); gb.instanceCount = nb;
    // how far a die has got: the chip spreads from ours outward
    const G = attribute('aG', 'vec4'), pr = clamp(U.ghost.sub(G.x.div(2600.0).mul(0.55)).div(0.45), 0.0, 1.0);
    const by = select(pr.lessThanEqual(0), float(-5), select(pr.greaterThanEqual(1), float(1000), pr.mul(74.0).sub(2.0)));
    const BC = attribute('aBC', 'vec3'), BH = attribute('aBH', 'vec3'), A = attribute('aAlb', 'vec4');
    const mat = new THREE.MeshStandardNodeMaterial();
    const lp = positionLocal.mul(BH.mul(2)).add(BC), vy = varying(lp.y), vby = varying(by), vG = varying(G), vA = varying(A), vl = varying(lp);
    mat.positionNode = lp;
    mat.colorNode = Fn(() => { If(vy.greaterThan(vby), () => { Discard(); }); return vA.rgb; })();
    mat.roughnessNode = vA.w; mat.metalnessNode = select(vG.y.equal(12), float(0), float(1));
    // the body, seen from above: the cells holding a one stay warm, as in ours; the light that writes runs up the side while it is built
    mat.emissiveNode = Fn(() => {
      const e = COLD.mul(smoothstep(vby.sub(3.0), vby, vy)).mul(step(vby, 900.0)).mul(1.2).toVar();
      If(vG.z.greaterThan(0.5).and(vby.greaterThan(900)), () => {
        const q = vl.xz.sub(vec2(XA, ZA)), ci = floor(q.div(vec2(CX, CZ))), f = q.div(vec2(CX, CZ)).sub(ci), inA = step(0.0, ci.x).mul(step(ci.x, N - 1)).mul(step(0.0, ci.y)).mul(step(ci.y, N - 1));
        const dot2 = smoothstep(0.16, 0.06, length(f.sub(vec2(0.32, 0.38)).mul(vec2(1.0, 1.3))));
        e.addAssign(heatColor(float(0.5)).mul(dot2).mul(inA).mul(bitAt(clamp(ci.y, 0.0, 7.0), clamp(ci.x, 0.0, 7.0))).mul(1.4));
        const grid = smoothstep(0.06, 0.0, min(abs(f.x.sub(0.5)), abs(f.y.sub(0.5)))).mul(inA);
        e.addAssign(COLD.mul(grid).mul(0.05));
      });
      return e;
    })();
    const boxes = new THREE.Mesh(g, mat), body = new THREE.Mesh(gb, mat);
    // glass over each: plainer than ours (it is far away), a pane that reflects the hall and lets most of the chip through
    const gm = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.05, metalness: 0.0 });
    const gg = new THREE.InstancedBufferGeometry(); gg.index = base.index; gg.setAttribute('position', base.getAttribute('position')); gg.setAttribute('normal', base.getAttribute('normal'));
    const cBC = new Float32Array(nb * 3); DIES.forEach((d, j) => cBC.set([d[0], 0, d[1]], j * 3)); attr(gg, 'aBC', cBC, 3); attr(gg, 'aG', bG, 4); gg.instanceCount = nb;
    const gh = min(float(D.glass), by.sub(3.0)).max(0.0);
    gm.positionNode = positionLocal.add(vec3(0, 0.5, 0)).mul(vec3(D.hw * 2, gh, D.hd * 2)).add(BC);
    const vv = normalize(cameraPosition.sub(positionWorld)), fres = pow(abs(dot(normalWorld, vv)).oneMinus(), 4.0);
    gm.colorNode = vec3(0.02, 0.025, 0.03); gm.opacityNode = fres.mul(0.75).add(0.1).mul(step(1.0, varying(gh)));
    const glassG = new THREE.Mesh(gg, gm); glassG.renderOrder = 2;
    for (const m of [boxes, body, glassG]) { m.frustumCulled = false; m.visible = false; mem.add(m); }
    return { boxes, body, glass: glassG };
  })();

  // ───────── embers: they rise off the floor and cool into the still points of the design space. A compute shader moves them.
  const NE = opt.embers ?? (small ? 1400 : 2600), NN = Math.round(NE * 0.27);
  const embers = (() => {
    // Where each ember is, and how much of its life is left, are kept on the GPU; each frame a few rules move it, in turn:
    //   life      it burns down at a rate of its own, and is born again where it began;
    //   swirl     it is carried by a field that has no sources (shade.js, curlNoise), so embers eddy and never bunch up;
    //   heat      it rises;
    //   stir      where the pointer has stirred the water, it is carried by the flow of the water seen behind it (fluid.js);
    //   home      it is drawn back, weakly, toward the place it began.
    const seedA = new Float32Array(NE * 4), seedB = new Float32Array(NE * 4), pos0 = new Float32Array(NE * 4);
    for (let i = 0; i < NE; i++) { const near = i < NN, R = near ? 460 : 1500, H = near ? 300 : 700, y0 = near ? -10 : -180;
      const x = (rnd(i, 1) - 0.5) * 2 * R, z = (rnd(i, 3) - 0.5) * 2 * R, y = y0 + rnd(i, 2) * H * 0.6;
      seedA.set([x, z, rnd(i, 4), near ? 1 : 0], i * 4); seedB.set([rnd(i, 5) > 0.9 ? 1 : 0, rnd(i, 6), rnd(i, 7), 0], i * 4); pos0.set([x, y, z, rnd(i, 8)], i * 4); }
    const P = instancedArray(pos0, 'vec4'), SA = instancedArray(seedA, 'vec4'), SB = instancedArray(seedB, 'vec4');          // (where it is, how much of its life is left), (where it began x z, a seed, near or far), (large, two more seeds)
    const RRof = a => select(a.w.greaterThan(0.5), float(460), float(1500));
    const seen = (q, a) => { const RR = RRof(a), rel = q.xz.sub(U.embC).add(RR), wr = rel.sub(floor(rel.div(RR.mul(2.0))).mul(RR.mul(2.0))).sub(RR); return vec3(U.embC.x.add(wr.x), q.y, U.embC.y.add(wr.y)); };          // the field is endless: what is drawn of it is the part round the point the camera looks at
    const step1 = Fn(() => {
      const p = P.element(instanceIndex), a = SA.element(instanceIndex), b = SB.element(instanceIndex), HZ = U.dt.mul(60.0);
      const near = a.w.greaterThan(0.5), H = select(near, float(300), float(700)), y0 = select(near, float(-10), float(-180));
      const pos = p.xyz.toVar(), life = p.w.sub(U.dt.mul(b.z.mul(0.65).add(0.7)).mul(mix(float(0.11), float(0.035), U.cold))).toVar();
      If(life.lessThanEqual(0.0), () => { pos.assign(vec3(a.x, y0.add(b.y.mul(H).mul(0.4)), a.y)); life.assign(1.0); });
      pos.addAssign(curlNoise(pos.mul(0.0042).add(vec3(b.z.mul(0.7), U.time.mul(0.05), 0.0))).mul(mix(float(0.55), float(0.09), U.cold)).mul(HZ));
      pos.y.addAssign(U.rise.mul(U.dt).mul(a.z.add(0.35)));
      pos.addAssign(fluid.carry(seen(pos, a)).mul(U.dt));          // the stirred water carries it, as it would a speck on its surface
      pos.assign(vec3(mix(pos.x, a.x, HZ.mul(0.0012)), pos.y, mix(pos.z, a.y, HZ.mul(0.0012))));
      p.assign(vec4(pos, life));
    })().compute(NE);
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pA = P.toAttribute(), a = SA.toAttribute(), b = SB.toAttribute();
    const pE = seen(pA, a), mv = modelViewMatrix.mul(vec4(pE, 1.0)), z = mv.z.negate();
    const out = abs(z.sub(U.dist)).div(U.dist), blur = clamp(out.sub(0.3), 0.0, 2.5);                    // out of focus: larger and fainter
    // each a size of its own, one in thirty twice the size of the rest
    const big = select(b.z.greaterThan(0.967), float(2.1), float(1.0));
    const rpx = clamp(b.x.mul(0.55).add(0.3).mul(big).mul(blur.mul(1.6).add(1)).mul(U.focal).div(max(z, 1.0)), 0.5, 6.0).mul(U.dpr);
    const r = rpx.mul(z).div(U.focal.mul(U.dpr));
    const near = a.w.greaterThan(0.5), tw = sin(U.time.mul(a.z.mul(2.4).add(1.3)).add(a.z.mul(60.0))).mul(0.28).add(0.72), lifeA = smoothstep(0.0, 0.14, pA.w).mul(smoothstep(1.0, 0.9, pA.w));
    const vis = step(a.z, U.amount).mul(select(near.and(U.cold.greaterThan(0.6)), float(0), float(1))).mul(step(40.0, z)).mul(step(U.dist.mul(0.42), z)).mul(step(U.lift.negate().add(3.0), pA.y));
    const alpha = mix(float(0.9), float(0.5), U.cold).mul(tw).mul(lifeA).div(blur.mul(blur).mul(2.2).add(1)).mul(vis).mul(U.fade);
    mat.positionNode = pE;
    mat.scaleNode = vec2(r.mul(6.8), r.mul(6.8).mul(mix(float(1.9), float(1.0), U.cold)));
    // red and orange for the most part, a few yellow or white; each turned a little in hue, its own way and slowly; and one in
    // ten is a filing that has taken the colours of tempering, and shows every colour in turn as it drifts
    const HOT = vec3(...srgb([255, 170, 44])), WHITE = vec3(...srgb([255, 243, 220])), ORANGE = vec3(...srgb([255, 92, 16])), RED = vec3(...srgb([226, 52, 10])), CLD = vec3(...srgb([157, 196, 255]));
    const base = select(b.y.greaterThan(0.94), WHITE, select(b.y.greaterThan(0.72), HOT, select(b.y.greaterThan(0.3), ORANGE, RED)));
    const prism = step(0.90, b.z), turn = hue(fract(b.z.mul(7.0).add(U.time.mul(b.y.mul(0.05).add(0.03))).add(pA.y.mul(0.0016))));
    // a coal does not shine steadily: now and then one of them (one in thirty) catches and flares white for a moment
    const flare = smoothstep(0.80, 0.97, vn(vec3(b.y.mul(83.0), U.time.mul(0.7), 7.0))).mul(step(0.967, fract(a.z.mul(37.3))));
    const colr = varying(mix(mix(mix(base, turn.mul(dot(base, vec3(0.3, 0.6, 0.1))).mul(1.6), 0.16), CLD, U.cold), turn.mul(0.8), prism).add(WHITE.mul(flare).mul(1.3))), va = varying(alpha);
    mat.colorNode = Fn(() => { const d = length(uv().sub(0.5)).mul(2.0);
      // hottest at its heart: white there, its own colour further out, and deeper toward the rim
      const I = smoothstep(1.0, 0.7, d).mul(0.16).add(smoothstep(0.3, 0.2, d));
      return vec4(mix(colr.mul(0.7), mix(colr, WHITE, 0.5), smoothstep(0.34, 0.12, d)).mul(I).mul(3.2), 1.0); })();
    mat.opacityNode = va;
    const sprite = new THREE.Sprite(mat); sprite.count = NE; sprite.frustumCulled = false; scene.add(sprite);
    return { step: step1, sprite, P };          // (P: where each is, read back by tests)
  })();

  // ───────── the order cast into the first cell. Every lit pixel of the line the visitor typed is an ember: it starts exactly on
  // its pixel (hung in the air before the lens), and ends on a line of the first bit cell. Where it is in between depends only on
  // how far the film has got (castFly), so it runs backwards as well as forwards. The letters are struck into sparks that fly
  // up and out, and rain onto the cell, each line of it appearing as its sparks land.
  const cast = (() => {
    const NC = small ? 1500 : 3600, CXc = M.colX(3), CZc = M.rowZ(4);
    const segs = M.PARTS.find(p => p.id === 'cell').segs.map(g => ({ a: [g.a[0] + CXc, g.a[1] + CZc], b: [g.b[0] + CXc, g.b[1] + CZc] }));
    segs.forEach(g => { g.h = js.h21((g.a[0] + g.b[0]) / 2 * 7.3, (g.a[1] + g.b[1]) / 2 * 7.3) * 0.9; });
    const byHash = segs.slice().sort((p, q) => p.h - q.h);
    const gA = new THREE.InstancedBufferAttribute(new Float32Array(NC * 4), 4), tA = new THREE.InstancedBufferAttribute(new Float32Array(NC * 4), 4);
    gA.setUsage(THREE.DynamicDrawUsage); tA.setUsage(THREE.DynamicDrawUsage);
    const aG = THREE.TSL.instancedDynamicBufferAttribute(gA), aT = THREE.TSL.instancedDynamicBufferAttribute(tA);          // (pixel x, y, its place along the line 0..1, a seed), (target x, z, two more seeds)
    const u = clamp(U.castFly.sub(aG.z.mul(CAST.leave)).div(CAST.dur), 0.0, 1.0);
    const ndc = vec2(U.castA.x.add(U.castA.y.mul(aG.x)), U.castA.z.add(U.castA.w.mul(aG.y)));
    const S = U.camPos.add(U.camFw.mul(U.fl).add(U.camRt.mul(ndc.x.mul(16 / 9))).add(U.camUp.mul(ndc.y)).mul(U.castD.div(U.fl)));
    const T = vec3(aT.x, LINE_Y + 0.6, aT.y), sd = vec3(aG.w, aT.z, aT.w);
    const dir = normalize(vec3(sd.x.sub(0.5), sd.y.mul(0.9).add(0.2), sd.z.sub(0.5))), p1 = S.add(dir.mul(U.castD.mul(0.5)).mul(pow(u.oneMinus(), 3.0).oneMinus()));
    const down = T.add(vec3(0, 1, 0).mul(smoothstep(1.0, 0.5, u).mul(U.castD.mul(0.42))));
    const pos0 = mix(p1, down, smoothstep(0.24, 0.9, u)).add(curlNoise(p1.mul(0.01).add(sd.mul(4.0))).mul(U.castD.mul(0.035)).mul(sin(u.mul(PI))));          // on the way they are carried by the swirling air (no further at either end)
    // … and by the stirred water's flow, for as long as it lasts (where each is depends only on the film and the flow, so it still runs backwards)
    const pos = pos0.add(fluid.carry(pos0).mul(0.35).mul(sin(u.mul(PI))));
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mv = modelViewMatrix.mul(vec4(pos, 1.0)), z = mv.z.negate(), mid = sin(u.mul(PI));
    mat.positionNode = pos;
    mat.scaleNode = mix(float(1.5), float(4.2), mid).mul(sd.z.mul(0.6).add(0.7)).mul(z).div(U.focal).mul(2.0);
    // the white of the letter, then the white of the blow, then red and orange (a few amber); one in six goes through every colour on the way down
    const HOT = vec3(...srgb([255, 150, 36])), WHITE = vec3(...srgb([255, 243, 220])), LETTER = vec3(...srgb([233, 240, 248])), ORANGE = vec3(...srgb([255, 84, 14])), RED = vec3(...srgb([236, 54, 10]));
    const fire = mix(mix(RED, ORANGE, smoothstep(0.0, 0.55, sd.y)), HOT, smoothstep(0.8, 0.95, sd.y)), prism = step(0.835, sd.z).mul(smoothstep(0.12, 0.35, u)).mul(smoothstep(0.97, 0.8, u));
    const colr = varying(mix(mix(mix(LETTER, WHITE, smoothstep(0.0, 0.08, u)), fire, smoothstep(0.05, 0.4, u)), hue(fract(sd.x.add(u.mul(1.1)))).mul(0.95), prism).add(WHITE.mul(smoothstep(0.9, 1.0, u)).mul(0.6)));
    const va = varying(step(0.0005, u).mul(step(u, 0.9995)).mul(U.fade).mul(mid.mul(0.5).add(0.5)));
    mat.colorNode = Fn(() => { const d = length(uv().sub(0.5)).mul(2.0), I = smoothstep(1.0, 0.55, d).mul(0.22).add(smoothstep(0.42, 0.18, d));
      return vec4(colr.mul(I).mul(2.6), 1.0); })();
    mat.opacityNode = va;
    const sprite = new THREE.Sprite(mat); sprite.count = 0; sprite.frustumCulled = false; sprite.visible = false; scene.add(sprite);
    // the pixels of the line, as fx.js found them on the page: each gets a line of the cell to end on
    function set(pts) {
      const n = pts.length, m = Math.min(n, NC), g = gA.array, t = tA.array;
      for (let i = 0; i < m; i++) { const q = pts[Math.floor(i * n / m)], f = i / m, sg = byHash[Math.min(byHash.length - 1, Math.floor(f * byHash.length))], k = rnd(i, 31);          // in the order the lines appear in (castProg)
        g.set([q[0], q[1], f, rnd(i, 32)], i * 4); t.set([lerp(sg.a[0], sg.b[0], k), lerp(sg.a[1], sg.b[1], k), rnd(i, 33), rnd(i, 34)], i * 4); }
      gA.needsUpdate = tA.needsUpdate = true; sprite.count = m;
    }
    return { sprite, set, pour: [CXc, CZc] };
  })();

  // ───────── filings and sparks: what a blow of the hammer throws off the chip, and what the cold light strikes off the metal
  // it cuts. As with the embers, where each is and how fast it is going are kept on the GPU, and each frame a few rules move
  // them, in turn:
  //   thrown    a blow throws a third of them at once, from under the rim of the hammer's face (most of them low, some in
  //             jets; the filings higher and slower); the cut throws them a few at a time for as long as it runs;
  //   life      each burns down at a rate of its own;
  //   weight    it falls, and the air slows it;
  //   swirl     the swirling field of the embers turns it off its course, a filing more than a spark;
  //   wake      the pointer's wake carries it along;
  //   ground    on the chip, the anvil or the wafer it skips and lies; on water it goes out.
  // Each is drawn as the streak it leaves while the shutter is open, and as a soft disc where it passes close to the lens.
  // Their colour is that of hot iron: white as they leave, then orange, and red for most of their flight. And as a filing
  // cools, the colours steel takes in tempering pass over it (straw, purple, violet, blue), each filing at its own moment:
  // so among the red and orange there is, at any time, every colour.
  const sparks = (() => {
    const NG = 3, NB = (small ? 900 : 2800) * NG, NC = small ? 300 : 900, NP = NB + NC, GRAV = 560, DRAG = 1.15;          // three blows can be in the air at once; the rest is the cut's
    const P = instancedArray(NP, 'vec4'), V = instancedArray(NP, 'vec4');          // (where it is, how much of its life is left), (how fast it is going, its kind: 0 a spark, 1 a filing, 2 struck off by the cold light)
    const blowAt = uniformArray([...Array(NG)].map(() => new THREE.Vector4()), 'vec4'), blowIs = uniformArray([...Array(NG)].map(() => new THREE.Vector4()), 'vec4');          // (where, a number of its own), (how hard, 1 in the frame it falls)
    const rn = (fi, k) => h21(vec2(fi, k));
    const step1 = Fn(() => {
      const i = instanceIndex, fi = float(i), p = P.element(i), v = V.element(i), HZ = U.dt.mul(60.0);
      const pos = p.xyz.toVar(), life = p.w.toVar(), vel = v.xyz.toVar(), kind = v.w.toVar();
      const r1 = rn(fi, 1.7).toVar(), r2 = rn(fi, 9.2).toVar(), r3 = rn(fi, 23.1).toVar(), r4 = rn(fi, 41.9).toVar(), r5 = rn(fi, 57.3).toVar(), r6 = rn(fi, 71.9).toVar();
      const burst = fi.lessThan(NB), g = int(fi.sub(floor(fi.div(NG)).mul(NG))), B = blowAt.element(g), Bi = blowIs.element(g);
      If(burst.and(Bi.y.greaterThan(0.5)), () => {          // thrown by the blow that has just fallen
        const fil = step(0.63, r4), jet = floor(r5.mul(10.0)), inJet = step(r6, 0.62).mul(fil.oneMinus());
        const az = mix(r1.mul(6.2832), rn(jet, B.w).mul(6.2832).add(r2.add(r3).add(rn(fi, 77.7)).sub(1.5).mul(rn(jet, B.w.add(3.1)).mul(0.18).add(0.08))), inJet);
        const el = mix(pow(r2, 1.9).add(0.02), r2.mul(1.1).add(0.3), fil);
        const sp = mix(pow(r3, 2.1).mul(1000.0).add(260.0), pow(r3, 1.4).mul(340.0).add(80.0), fil).mul(mix(float(1.0), rn(jet, B.w.add(7.7)).mul(0.8).add(0.6), inJet)).mul(sqrt(Bi.x));
        const ca = cos(az), sa = sin(az), e = rn(fi, 88.1).mul(0.3).add(0.8).div(max(abs(ca).div(62.0), abs(sa).div(52.0)));
        pos.assign(B.xyz.add(vec3(ca.mul(e), 1.0, sa.mul(e)))); vel.assign(vec3(ca.mul(cos(el)), sin(el), sa.mul(cos(el))).mul(sp)); life.assign(1.0); kind.assign(fil);
      });
      const t1 = rn(fi.add(U.time.mul(13.7)), 3.3), t2 = rn(fi.add(U.time.mul(7.1)), 5.9), t3 = rn(fi.add(U.time.mul(3.3)), 8.4);
      If(burst.not().and(life.lessThanEqual(0.0)).and(U.cut.w.greaterThan(0.5)).and(rn(fi, U.time.mul(61.0).fract().mul(97.0)).lessThan(U.cut.z.mul(U.dt).div(NC))), () => {          // struck off the line the cold light is cutting along
        pos.assign(vec3(U.cut.x, U.cut.y.add(0.5), mix(float(-128.0), float(128.0), t1)).add(vec3(0, 0, U.objPos.z)));
        vel.assign(vec3(t2.mul(-110.0).sub(20.0), t3.mul(150.0).add(50.0), t1.sub(0.5).mul(80.0))); life.assign(1.0); kind.assign(2.0);
      });
      If(life.greaterThan(0.0), () => {
        const fil = step(0.5, kind).mul(step(kind, 1.5)), dur = mix(mix(r1.mul(0.7).add(0.28).mul(mix(float(1.0), float(1.9), step(r2, 0.08))), r1.mul(1.8).add(1.1), fil), r1.mul(0.7).add(0.35), step(1.5, kind));
        life.subAssign(U.dt.div(dur));
        const slow = exp(U.dt.mul(-DRAG)); vel.assign(vec3(vel.x.mul(slow), vel.y.sub(U.dt.mul(GRAV)), vel.z.mul(slow)));
        const moving = step(1.0, length(vel));
        pos.addAssign(curlNoise(pos.mul(0.006).add(vec3(r3.mul(3.0), U.time.mul(0.3), 0.0))).mul(vec3(1.0, 0.3, 1.0)).mul(mix(float(0.22), float(0.8), fil)).mul(HZ).mul(moving));
        // where the pointer has stirred the water, the air over it moves with it: a spark is turned along the flow (fluid.js)
        const air = fluid.carry(pos), grip = smoothstep(4.0, 60.0, length(air)).mul(exp(U.dt.mul(-3.5)).oneMinus());
        vel.assign(vec3(mix(vel.x, air.x, grip), vel.y, mix(vel.z, air.z, grip)));
        pos.addAssign(vel.mul(U.dt));
        // what is under it: the top of the chip, the anvil round it, or the lake (which is water, or by then a wafer)
        const rel = pos.sub(U.objPos), onChip = step(abs(rel.x), 156.0).mul(step(abs(rel.z), 128.0)).mul(U.solid.x), onAnvil = step(abs(rel.x), 213.0).mul(step(abs(rel.z), 174.0)).mul(U.solid.y);
        const lake = U.lift.negate(), ground = mix(mix(lake, U.objPos.y, onAnvil), U.objPos.y.add(U.solid.z), onChip).toVar(), wet = onChip.oneMinus().mul(onAnvil.oneMinus()).mul(step(0.5, U.water));
        If(pos.y.lessThan(ground).and(vel.y.lessThan(0.0)), () => {
          If(wet.greaterThan(0.5), () => { life.assign(0.0); })
            .Else(() => { pos.y.assign(ground); vel.assign(vec3(vel.x.mul(0.55), vel.y.mul(-0.3), vel.z.mul(0.55)));
              If(vel.y.lessThan(14.0), () => { vel.assign(vec3(0.0)); life.assign(min(life, 0.3)); }); });
        });
      });
      p.assign(vec4(pos, life)); v.assign(vec4(vel, kind));
    })().compute(NP);
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pA = P.toAttribute(), vA = V.toAttribute(), fi = float(instanceIndex), seed = rn(fi, 2.9), kind = vA.w, u = pA.w.oneMinus(), vel = vA.xyz;
    const mv = modelViewMatrix.mul(vec4(pA.xyz, 1.0)), z = mv.z.negate(), vv = modelViewMatrix.mul(vec4(vel, 0.0)).xy, px = z.div(U.focal);
    const fil = step(0.5, kind).mul(step(kind, 1.5)), size = mix(seed.mul(0.8).add(0.5), seed.mul(1.5).add(0.9), fil);
    const flare = step(0.965, seed.mul(13.7).fract()), shut = mix(float(0.05), float(0.02), fil);          // how long the shutter is open on it: a spark draws a long line, a filing a short one
    const blur = clamp(abs(z.sub(U.dist)).div(U.dist).sub(0.35), 0.0, 2.0), wid = max(size.mul(flare.mul(1.6).add(1.0)), px.mul(1.3)).mul(blur.mul(3.0).add(1.0));
    mat.positionNode = pA.xyz.sub(vel.mul(shut.mul(0.5))); mat.scaleNode = vec2(min(length(vv).mul(shut), 130.0).add(wid), wid); mat.rotationNode = atan(vv.y, vv.x.add(1e-5));          // the streak lies behind it: where it has just been
    // how hot: white for an instant, orange soon, and red-orange for the rest of the way
    const Tm = exp(u.mul(-5.0)).mul(0.55).add(0.43).sub(u.mul(0.05)), q = smoothstep(0.18, 0.9, u);
    const prism = step(seed.mul(7.31).fract(), mix(float(0.24), float(0.5), fil)).mul(q);          // half the filings, a quarter of the sparks
    const glint = pow(sin(U.time.mul(seed.mul(34.0).add(16.0)).add(seed.mul(90.0))).mul(0.5).add(0.5), 3.0);              // a filing turns as it flies, and catches the light
    const hotC = mix(heatColor(Tm).mul(1.5), vec3(0.75, 0.88, 1.0).mul(5.0), smoothstep(1.5, 2.5, kind).mul(smoothstep(0.3, 0.02, u)));          // (off the cold light: white-blue first)
    const live = step(0.001, pA.w).mul(smoothstep(0.0, 0.28, pA.w)).mul(step(40.0, z)).div(blur.mul(blur).mul(2.6).add(1.0)).mul(U.fade);
    const vHot = varying(hotC.mul(prism.mul(-0.6).add(1.0)).mul(flare.mul(1.8).add(1.0)).mul(live)), vPr = varying(prism.mul(glint.mul(1.8).add(0.45)).mul(live)), vH = varying(seed.mul(0.83).sub(q.mul(0.62)).add(0.12)), vB = varying(blur);
    mat.colorNode = Fn(() => { const st = uv(), across = st.y.sub(0.5).mul(2.0), d = length(st.sub(0.5)).mul(2.0);
      const streak = exp(across.mul(across).mul(-3.0)).mul(smoothstep(0.0, 0.25, st.x)).mul(smoothstep(1.0, 0.8, st.x)).mul(st.x.mul(0.65).add(0.35));          // brightest at its head
      const I = mix(streak, smoothstep(1.0, 0.75, d).mul(0.5), smoothstep(0.2, 0.9, vB));
      return vec4(vHot.add(hue(fract(vH.add(st.x.sub(0.5).mul(0.22)))).mul(vPr)).mul(I), 1.0); })();
    mat.opacityNode = float(1.0);
    const sprite = new THREE.Sprite(mat); sprite.count = NP; sprite.frustumCulled = false; scene.add(sprite);
    let at = 0;
    // a blow at a place in the world: the next third of them is thrown from there, in the next frame
    const throwAt = (x, y, z, power) => { blowAt.array[at].set(x, y, z, Math.random() * 100); blowIs.array[at].set(power, 1, 0, 0); at = (at + 1) % NG; };
    const thrown = () => { for (let k = 0; k < NG; k++) blowIs.array[k].y = 0; };          // (called once the frame that throws them has been computed)
    return { sprite, step: step1, throwAt, thrown, count: NP };
  })();
  // the ring a blow sends out through the air, level with the face of the chip
  const shock = (() => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    m.colorNode = Fn(() => { const r = length(uv().sub(0.5)).mul(2.0), age = U.time.sub(U.blow.z), R = age.mul(2.3), w = age.mul(0.10).add(0.012);
      const I = exp(pow(r.sub(R).div(w), 2.0).negate()).mul(exp(age.mul(-5.5))).mul(U.blow.w).mul(step(0.0, age)).mul(smoothstep(1.0, 0.85, r));
      return vec4(vec3(1.0, 0.62, 0.30).mul(I).mul(3.6).mul(U.fade), 1.0); })();
    const me = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), m); me.rotation.x = -PI / 2; me.frustumCulled = false; me.visible = false; mem.add(me);
    const fm = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    fm.positionNode = U.blowP; fm.scaleNode = float(1500.0);
    fm.colorNode = Fn(() => { const q = uv().sub(0.5).mul(2.0), age = U.time.sub(U.blow.z), d = length(q), k = exp(age.mul(-15.0)).mul(U.blow.w).mul(step(0.0, age));
      const core = exp(d.mul(d).mul(-90.0)).mul(3.0).add(exp(d.mul(d).mul(-9.0)).mul(0.22)), streak = exp(q.y.mul(q.y).mul(-5200.0)).mul(exp(abs(q.x).mul(-3.2))).mul(1.4);
      return vec4(mix(vec3(1.0, 0.55, 0.22), vec3(1.0, 0.93, 0.80), exp(d.mul(-9.0))).mul(core.add(streak)).mul(k).mul(U.fade), 1.0); })();
    const fs = new THREE.Sprite(fm); fs.frustumCulled = false; fs.visible = false; scene.add(fs);
    return { ring: me, flash: fs };
  })();
  // A blow of the hammer on the chip, at (x, y, z) in the chip's own frame: what it throws off (above), and the ring it
  // sends through the glass and the air, and the flash.
  const last = { lift: 0, objPos: [0, 0, 0] };
  function blow(x, y, z, power = 1) {
    const o = last.objPos;
    U.blow.value.set(x, z, U.time.value, power); shock.ring.position.set(x, y + 1.5, z); U.blowP.value.set(o[0] + x, o[1] + y + 4, o[2] + z);
    sparks.throwAt(o[0] + x, o[1] + y, o[2] + z, power);
  }

  // ───────── after the scene: the light in the air, from the depth of the picture
  const MAXC = 40, colA = uniformArray([...Array(MAXC)].map(() => new THREE.Vector4()), 'vec4'), colB = uniformArray([...Array(MAXC)].map(() => new THREE.Vector4()), 'vec4'), nCol = uniform(0, 'int');
  const samples = opt.samples ?? (small || !gpu ? 0 : 4);
  const scenePass = pass(scene, camera, { samples });
  const sceneTex = scenePass.getTextureNode('output'), depthTex = scenePass.getTextureNode('depth');
  const atmoNode = Fn(() => {
    const st = uv(), dep = depthTex.sample(st).x;
    const vp = getViewPosition(st, dep, U.projInv), wp = U.camWorld.mul(vec4(vp, 1.0)).xyz, ro = U.camPos;
    const dv = wp.sub(ro), tHit = length(dv).toVar(), rd = dv.div(tHit).toVar(), tmax = select(dep.greaterThanEqual(0.999999), float(30000), tHit).toVar();
    // how much one is looking toward the forge (at -z): the air that way carries the colour of its fire, the other way the cold of the night
    const toward = smoothstep(-0.3, 1.0, dot(normalize(rd.xz.add(vec2(1e-5, 0.0))), vec2(0.0, -1.0)));
    const L = vec3(0).toVar();
    // columns: of cold light over the wafers, and of warm haze over the hot ones
    Loop({ start: 0, end: nCol, type: 'int', condition: '<' }, ({ i }) => {
      const A = colA.element(i), B = colB.element(i), o = ro.xz.sub(A.xy), a = dot(rd.xz, rd.xz).max(1e-6), b = dot(o, rd.xz), c = dot(o, o).sub(A.z.mul(A.z));
      const disc = b.mul(b).sub(a.mul(c));
      If(disc.greaterThan(0), () => {
        const s = sqrt(disc), t0 = b.negate().sub(s).div(a).max(0.0), t1 = b.negate().add(s).div(a).min(tmax);
        If(t1.greaterThan(t0), () => {
          const acc = float(0).toVar();
          for (let k = 0; k < 4; k++) { const tt = mix(t0, t1, (k + 0.5) / 4), pm = ro.add(rd.mul(tt)), rr = length(pm.xz.sub(A.xy)).div(A.z);
            acc.addAssign(exp(rr.mul(rr).mul(A.w).negate()).mul(exp(max(pm.y.add(U.lift), 0.0).negate().div(B.w)))); }
          L.addAssign(B.xyz.mul(acc).mul(t1.sub(t0).mul(0.25)).mul(U.airIn));          // (airIn: none while the camera looks straight down on the plan, frame)
        });
      });
    });
    // fog lying on the floor, lit by the key light near the middle of the hall
    const tf = min(tmax, 2400.0), dens = float(0).toVar(), ins = float(0).toVar();
    for (let k = 0; k < 6; k++) { const pm = ro.add(rd.mul(tf.mul((k + 0.5) / 6))), dl = U.fogD.mul(exp(max(pm.y.add(U.lift), 0.0).negate().div(C.FOGH)));
      dens.addAssign(dl); ins.addAssign(dl.mul(length(pm.xz).div(C.POOL).mul(-0.88).add(1).max(0.12))); }
    const tau = dens.mul(tf).div(6).mul(U.airIn), Tr = exp(tau.negate());          // (none while the camera looks straight down on the plan)
    L.addAssign(vec3(...C.FOGCOL).mul(vec3(...PAL.air)).mul(mix(vec3(1.0), vec3(1.5, 1.05, 0.75), toward.mul(U.furn).mul(0.6))).mul(Tr.oneMinus()));
    L.addAssign(U.keyCol.mul(ins.mul(tf).div(6 * 4 * PI)).mul(Tr.add(1).mul(0.5)).mul(U.airIn));
    // far off, the air itself shows: a haze that lies low over the far shore and takes a little of the colour of the forge's fire.
    // It is what sets the forge back from the lake, tier behind tier.
    const tfar = tmax.min(14000.0), low = exp(max(ro.y.add(rd.y.mul(tfar)).add(U.lift), 0.0).negate().div(2600.0));
    const hz = exp(max(tfar.sub(1800.0), 0.0).mul(0.00012 * PAL.haze).mul(low.mul(0.8).add(0.2)).negate()).oneMinus();
    const AIR = vec3(...PAL.air).mul(PAL.airK);
    L.addAssign(mix(vec3(0.016, 0.022, 0.040).mul(AIR), vec3(0.026, 0.024, 0.030).mul(AIR).add(heatColor(float(0.42)).mul(U.furn).mul(low.mul(0.5).add(0.5)).mul(0.07)), toward).mul(hz));
    // Under the first pyramid hangs the smoke of its pour, so that the higher one looks the more of it is lost in a warm dark
    // haze, lit from below by the fire: a box round the pour, up to the pyramid; the line of sight's way through it, by the smoke
    // at its middle (thicker the higher, drifting, thinning out toward the box's sides so that it has no edge).
    const FG = HALL.rest[1] - 700.0, bmin = vec3(-3200.0, U.lift.negate().add(500.0), FG - 1800.0), bmax = vec3(3200.0, U.lift.negate().add(HALL.top), FG + 250.0 + 1500.0);
    const rdS = rd.add(vec3(1e-5)), ta = bmin.sub(ro).div(rdS), tb = bmax.sub(ro).div(rdS), tlo = min(ta, tb), thi = max(ta, tb);
    const s0 = max(max(tlo.x, tlo.y), max(tlo.z, 0.0)), s1 = min(min(thi.x, thi.y), min(thi.z, tmax)), mid = ro.add(rd.mul(s0.add(s1).mul(0.5))), hgt = mid.y.add(U.lift);
    const smk = smoothstep(350.0, 2000.0, hgt).mul(smoothstep(3200.0, 2000.0, abs(mid.x))).mul(smoothstep(FG + 250.0, FG - 150.0, mid.z))
      .mul(vn(vec3(mid.x.mul(0.0012), hgt.mul(0.0009).sub(U.time.mul(0.02)), mid.z.mul(0.0012))).mul(0.8).add(0.4));
    const TrS = exp(max(s1.sub(s0), 0.0).mul(smk).mul(0.0005).min(0.9).mul(U.airIn).negate());
    L.assign(L.mul(TrS).add(vec3(0.010, 0.010, 0.013).mul(AIR).add(heatColor(float(0.42)).mul(U.furn).mul(0.06).mul(smoothstep(4500.0, 800.0, hgt))).mul(TrS.oneMinus())));
    return vec4(L, Tr.mul(hz.mul(0.85).oneMinus()).mul(TrS));
  })();
  const atmo = rtt(atmoNode, null, null, { type: THREE.HalfFloatType, resolutionScale: 0.5 });
  const hdr = sceneTex.rgb.mul(atmo.a).add(atmo.rgb);
  const bloomPass = THREE.bloom(hdr, 0.62, 0.55, 0.62);
  // ───────── the lens. The brightest fire drawn out sideways, as a wide lens with oval glass draws a point of fire into a
  // line: a quarter-size picture of what blooms warm, smeared along the rows (near light weighs more than far). Cold light,
  // the light the design is made of, is left alone: it is what is looked at. And marks on the
  // front glass, made once (soft smudges, a few wiped streaks, a faint mottle), which show only where strong light falls.
  const bloomTex = bloomPass.getTextureNode();
  const streak = small ? null : rtt(Fn(() => {
    const st = uv(), acc = vec3(0).toVar(); let wsum = 0;
    const hot = c => max(c.sub(0.5), vec3(0.0)).mul(clamp(c.r.sub(c.b).div(c.r.add(0.05)), 0.0, 1.0));          // the very bright, and only what is warm: fire, molten metal, sparks
    for (let k = 1; k <= 12; k++) { const w = Math.exp(-k / 4.5), o = Math.pow(k, 1.6) * 0.0042; wsum += 2 * w;
      acc.addAssign(hot(bloomTex.sample(st.add(vec2(o, 0.0))).rgb).add(hot(bloomTex.sample(st.sub(vec2(o, 0.0))).rgb)).mul(w)); }
    return vec4(acc.div(wsum), 1.0);
  })(), null, null, { type: THREE.HalfFloatType, resolutionScale: 0.25 });
  const dirt = (() => { const w = 256, h = 144, a = new Float32Array(w * h);
    const blob = (cx, cy, r, s) => { const r2 = 2 * r * r, x0 = Math.max(0, Math.floor(cx - 3 * r)), x1 = Math.min(w, Math.ceil(cx + 3 * r)), y0 = Math.max(0, Math.floor(cy - 3 * r)), y1 = Math.min(h, Math.ceil(cy + 3 * r));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] += s * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / r2); };
    for (let i = 0; i < 46; i++) blob(rnd(i, 1) * w, rnd(i, 2) * h, 2 + 10 * rnd(i, 3) ** 2, 0.15 + 0.5 * rnd(i, 4));
    for (let i = 0; i < 7; i++) blob(rnd(i, 11) * w, rnd(i, 12) * h, 26 + 30 * rnd(i, 13), 0.1);
    for (let i = 0; i < 5; i++) { const x0 = rnd(i, 21) * w, y0 = rnd(i, 22) * h, an = rnd(i, 23) * PI, len = 30 + 70 * rnd(i, 24); for (let t = 0; t < len; t += 1.5) blob(x0 + Math.cos(an) * t, y0 + Math.sin(an) * t, 1.2, 0.05); }
    const px = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { const v = Math.round(255 * Math.min(1, a[i])); px[4 * i] = px[4 * i + 1] = px[4 * i + 2] = v; px[4 * i + 3] = 255; }
    const t = new THREE.DataTexture(px, w, h); t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
    return THREE.TSL.texture(t); })();
  // The last pass. While the page is loading it is also where the plan, drawn from straight above, turns into the scene, cell
  // by cell on the plan's grid, outward from the chip. Each pixel finds where it is in the scene (from the depth) and so which
  // cell of the grid on the ground it lies in: GRID0 units near the chip, twice as large at each doubling of the distance
  // past GRID_IN, so that near the chip the grid is fine and over the far lake it is coarse. A cell opens when the front has
  // come as far from the chip as it is (by the larger of the two distances along the plan's axes, so the front is a square
  // like the grid), a little early or late of its own: it opens as a square from its middle, white-hot at the edge while it
  // opens, and the scene in it glows and cools to its own colour. Ahead of the front the lines of the drawing in the cells
  // about to open warm, and so do the cells' own edges; the drawn lines lie on the edges of what they draw, so a heated
  // line becomes that edge, and cools there. The front first takes what is seen from above (R_TOP); as the camera then turns
  // down (main.js) it runs fast across the lake and up the forge, which catches fire, and the sky last, all at once.
  // (loaded: 0 the drawing, 1 the scene.)
  const REACH = 4800, R_TOP = 720, GRID0 = 26, GRID_IN = 320;          // REACH: further than this from the chip (the far mountains, the sky) is reached last, all at once
  // where the air over something hot shimmers, on the screen (frame): (x, y, radius, how hot), three of them at the most
  const hazeA = uniformArray([...Array(3)].map(() => new THREE.Vector4(0, 0, 0.01, 0)), 'vec4');
  // the spectrum, read five times across the edge of the lens (red bent least, violet most), and what the readings add up to
  const hueJ = t => [0, 2 / 3, 1 / 3].map(o => Math.min(1, Math.max(0, Math.abs(((t + o) % 1) * 6 - 3) - 1)));
  const SPEC = [0, 0.2, 0.4, 0.6, 0.8].map(t => hueJ(t * 0.8)), SPECW = [0, 1, 2].map(c => SPEC.reduce((a, w) => a + w[c], 0));
  const blank = new THREE.DataTexture(new Uint8Array([7, 10, 17, 255]), 1, 1); blank.needsUpdate = true;
  const sketchTex = THREE.TSL.texture(blank);
  const pipe = new THREE.RenderPipeline(renderer);
  pipe.outputColorTransform = false;
  pipe.outputNode = Fn(() => {
    const st0 = uv(), asp = U.aspect, Ld = U.loaded, loading = step(Ld, 0.999), px = vec2(1.0).div(U.res);
    const warp = vec2(0).toVar(), inside = float(1).toVar(), ahead = float(0).toVar(), fresh = float(0).toVar(), cooling = float(0).toVar(), sky0 = float(0).toVar();
    const rimHot = float(0).toVar(), cellEdge = float(0).toVar();
    If(loading.greaterThan(0.5), () => {
      const dep = depthTex.sample(st0).x, far = step(0.999999, dep), wp = U.camWorld.mul(vec4(getViewPosition(st0, dep, U.projInv), 1.0)).xyz;
      // the cell of the grid on the ground, and how far it is from the chip
      const rel = wp.xz.sub(U.heatC.xz), lv = floor(log2(max(max(abs(rel.x), abs(rel.y)).div(GRID_IN), 1.0))), s = exp2(lv).mul(GRID0);
      const ci = floor(rel.div(s)), loc = rel.sub(ci.add(0.5).mul(s)), cd = max(abs(ci.x.add(0.5)), abs(ci.y.add(0.5))).mul(s);
      // when the front reaches it (a little early or late of its own), and how far it has opened: age 0 as it starts, 1 open
      const reach = mix(cd.add(h21(ci.add(lv.mul(31.7))).mul(s).mul(1.6)), float(REACH), far);
      const age = U.front.sub(reach).div(mix(s.mul(2.2), float(REACH * 0.12), far)), open = clamp(age, 0.0, 1.0);
      // it opens as a square from its middle, the edge white-hot while it opens (the sky simply comes in)
      const sq = max(abs(loc.x), abs(loc.y)), aa = fwidth(sq).add(0.001), half = s.mul(0.5).add(aa.mul(2.0)).mul(open), begun = step(0.0001, open);          // (open, a little past its edge: no seam)
      inside.assign(mix(smoothstep(half.add(aa), half.sub(aa), sq).mul(begun), open, far)); sky0.assign(far);
      const rd = sq.sub(half).div(aa.mul(1.5).add(s.mul(0.035)));
      rimHot.assign(exp(rd.mul(rd).negate()).mul(begun).mul(open.oneMinus()).mul(far.oneMinus()));
      ahead.assign(smoothstep(s.mul(4.0), 0.0, reach.sub(U.front)).mul(step(age, 0.0)));          // the front coming: the lines in the cell, and its own edges, warm
      cellEdge.assign(smoothstep(s.mul(0.5).sub(aa.mul(2.0)), s.mul(0.5), sq).mul(far.oneMinus()));
      fresh.assign(smoothstep(0.0, 0.7, age).mul(exp(max(age.sub(0.7), 0.0).mul(-0.9))).mul(inside).mul(smoothstep(300.0, 1600.0, cd).mul(-0.75).add(1.0)));          // just opened: white, cooling (the metal near the chip most, the water and the far shore little)
      cooling.assign(clamp(age.sub(1.0).div(2.5).oneMinus(), 0.0, 1.0).mul(inside));          // the drawn lines stay a while as hot edges, cooling
      const q = st0.mul(vec2(asp, 1.0)), t = U.time.mul(1.4), band = open.mul(open.oneMinus()).mul(4.0);
      const n0 = vn(vec3(q.mul(22.0), t)), nx = vn(vec3(q.add(vec2(0.01, 0.0)).mul(22.0), t)), ny = vn(vec3(q.add(vec2(0.0, 0.01)).mul(22.0), t));
      warp.assign(vec2(nx.sub(n0), ny.sub(n0)).mul(band).mul(0.03));          // over a cell as it opens, the air shimmers
    });
    const st = st0.add(warp), d = st.sub(0.5);
    // the air over what is hot (the heart of the forge, the chip while it glows, metal just poured) shimmers: what is seen
    // through it wavers, the waver rising
    const hz = vec2(0).toVar();
    for (let i = 0; i < 3; i++) { const H = hazeA.element(i), dd = st.sub(H.xy).mul(vec2(asp, 1.0)).div(H.z), m = exp(dot(dd, dd).negate()).mul(H.w);
      If(m.greaterThan(0.01), () => { const nq = vec3(st.mul(vec2(asp, 1.0)).mul(34.0).add(vec2(0.0, U.time.mul(1.3))), U.time.mul(0.4));
        hz.addAssign(vec2(vn(nq).sub(0.5), vn(nq.add(vec3(17.0, 5.0, 3.0))).sub(0.5)).mul(m).mul(0.0045)); }); }
    const uv2 = st.add(hz);
    // the edges of the lens part the colours, more the faster the film is scrolled and at a blow: on a large screen the
    // spectrum in five readings, on a small one red, green and blue
    const ca = dot(d, d).mul(U.speed.mul(0.028).add(U.kick.mul(0.05)).add(0.010));
    const c0 = (small ? vec3(sceneTex.sample(uv2.add(d.mul(ca))).r, sceneTex.sample(uv2).g, sceneTex.sample(uv2.sub(d.mul(ca))).b)
      : SPEC.reduce((acc, w, i) => acc.add(sceneTex.sample(uv2.add(d.mul(ca.mul(1 - i / 2)))).rgb.mul(vec3(...w))), vec3(0)).div(vec3(...SPECW))).toVar();
    if (!small) {
      const dep = depthTex.sample(uv2).x, vp = getViewPosition(uv2, dep, U.projInv), zv = vp.z.negate();
      // The camera moving: where this point of the scene was on the screen a frame before, and the picture smeared along the
      // way it has come, as a film camera's shutter smears it (how much: film.js, worked out per second and not per frame;
      // none while the camera holds still, and never more than a few hundredths of the picture)
      const was = U.prevVP.mul(U.camWorld.mul(vec4(vp, 1.0))), prevSt = vec2(was.x.div(was.w).mul(0.5).add(0.5), was.y.div(was.w).mul(-0.5).add(0.5));
      const mv = uv2.sub(prevSt).mul(U.shutter).mul(step(0.5, was.w)).toVar(), ml = length(mv.mul(vec2(asp, 1.0))).toVar();
      mv.mulAssign(min(float(1.0), float(0.035).div(ml.max(1e-6)))); ml.assign(min(ml, 0.035));
      If(ml.greaterThan(px.y.mul(0.8)), () => { const acc = vec3(0).toVar();
        for (let i = 0; i < 8; i++) acc.addAssign(sceneTex.sample(uv2.add(mv.mul((i + 0.5) / 8 - 0.5))).rgb);
        c0.assign(mix(c0, acc.div(8.0), smoothstep(px.y.mul(0.8), px.y.mul(3.0), ml))); });
      // The lens is focused on the thing the camera looks at (as far off as it was a moment ago: focusD follows late); what is
      // nearer or further is drawn softer, the further off the more. Twelve samples on a disc whose size is the blur at that
      // depth. The sky is left alone. (The thing itself, a third nearer or further than its middle, stays sharp; the disc is
      // turned a different way at each pixel, so that a point of light does not come out as a ring of copies of itself.)
      const rad = clamp(abs(zv.sub(U.focusD)).div(zv.max(1.0)).sub(0.36).mul(2.2), 0.0, 1.0).mul(step(dep, 0.999999)).mul(U.dofR).toVar(), soft = vec3(0).toVar();
      const turn = h21(screenCoordinate.xy.add(fract(U.time).mul(37.0))).mul(6.2832), ct = cos(turn), sn = sin(turn);
      for (let i = 0; i < 12; i++) { const a = i * 2.39996, q = Math.sqrt((i + 0.5) / 12), ox = Math.cos(a) * q, oy = Math.sin(a) * q;
        soft.addAssign(sceneTex.sample(uv2.add(vec2(ct.mul(ox).sub(sn.mul(oy)).div(asp), sn.mul(ox).add(ct.mul(oy))).mul(rad))).rgb); }
      c0.assign(mix(c0, soft.div(12.0), smoothstep(0.0, 0.0010, rad)));
    }
    const A = atmo.sample(uv2), bl = bloomTex.sample(uv2).rgb;
    const col = c0.mul(A.a).add(A.rgb).add(bl.mul(U.bloom)).toVar();
    // the lens (film.js: halo, streak, dirt): a red bleed round fire, as on film; the brightest fire drawn out sideways; the
    // marks on the front glass where strong light falls
    // (only what spills past the bright thing onto what is darker round it, as the bleed on film does: a bright face is not
    // washed over, its edge is)
    col.addAssign(max(bl.sub(c0.mul(0.8)), vec3(0.0)).mul(vec3(1.0, 0.30, 0.09)).mul(U.halo.mul(0.5)).mul(clamp(bl.r.sub(bl.b).div(bl.r.add(0.05)), 0.0, 1.0)));
    if (!small) {
      col.addAssign(max(streak.sample(uv2).rgb.mul(U.streak.mul(1.1)).sub(c0.mul(0.5)), vec3(0.0)).mul(vec3(0.85, 0.92, 1.1)));
      col.addAssign(vec3(1.0, 0.82, 0.66).mul(dirt.sample(st0).r).mul(min(dot(bl, vec3(0.3, 0.6, 0.1)), 1.2).mul(0.3)).mul(U.dirt));
    }
    // what passes close before the lens, out of focus (film.js: veilS, veilE): steam off the quench, drifting low across the
    // picture and lit a little by the fire; embers the camera rises through, large soft discs, more of them toward the edges
    If(U.veilS.greaterThan(0.001), () => {
      const q = st0.mul(vec2(asp, 1.0)), t = U.time;
      const n = fbm(vec3(q.mul(1.7).add(vec2(t.mul(0.03), t.mul(-0.09))), t.mul(0.04))).add(vn(vec3(q.mul(4.3).add(vec2(0.0, t.mul(-0.21))), t.mul(0.1))).mul(0.18));
      const cover = smoothstep(0.42, 0.8, n).mul(st0.y.mul(0.7).add(0.3)).mul(U.veilS).mul(0.45);
      col.assign(mix(col, vec3(0.16, 0.15, 0.15).add(heatColor(float(0.42)).mul(U.furn).mul(0.05)), cover));
    });
    If(U.veilE.greaterThan(0.001), () => {
      const gq = st0.mul(vec2(asp.mul(3.2), 3.2)).sub(vec2(0.0, U.time.mul(0.55))), ci = floor(gq), fc = fract(gq), hs = h21(ci.add(vec2(13.0, 7.0)));
      const ctr = vec2(h21(ci.add(vec2(3.1, 9.7))), h21(ci.add(vec2(8.3, 1.9)))).mul(0.36).add(0.32), rr = h21(ci.add(vec2(5.5, 4.4))).mul(0.12).add(0.2), dd = length(fc.sub(ctr));
      const disc = smoothstep(rr, rr.mul(0.82), dd).mul(smoothstep(rr.mul(0.3), rr, dd).mul(0.35).add(0.65)).mul(step(0.6, hs));
      const edge = smoothstep(0.12, 0.55, length(d.mul(vec2(asp.div(1.78), 1.0))));
      col.addAssign(heatColor(hs.mul(0.2).add(0.5)).mul(disc).mul(edge.mul(0.7).add(0.3)).mul(fract(hs.mul(37.0)).mul(0.8).add(0.2)).mul(U.veilE).mul(0.16));
    });
    const vq = d.mul(vec2(asp.div(1.78), 1.0)); col.mulAssign(mix(1.0, mix(1.0, 0.45, smoothstep(0.30, 1.0, length(vq))), U.vig));
    col.assign(aces(col.mul(U.exposure.mul(U.punch.mul(0.35).add(1.0)))));
    const l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col.assign(mix(col, col.mul(vec3(...PAL.shadow)), l.oneMinus().mul(0.5))); col.assign(mix(col, col.mul(vec3(...PAL.high)), l.mul(0.5)));          // (the darks and the lights each a colour of the palette's)
    // the colour of the chapter (film.js: warm, sat): its temperature, at the same brightness, and how full the colour is
    const tw = col.mul(vec3(U.warm.mul(0.10).add(1.0), U.warm.mul(0.01).add(1.0), U.warm.mul(-0.12).add(1.0)));
    col.assign(tw.mul(dot(col, vec3(0.2126, 0.7152, 0.0722)).div(dot(tw, vec3(0.2126, 0.7152, 0.0722)).max(1e-5))));
    col.assign(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, U.sat.mul(PAL.sat)));
    col.assign(pow(col, vec3(1.0 / 2.2)));
    col.assign(max(col.sub(U.crush.mul(0.022)), 0.0).div(U.crush.mul(-0.022).add(1.0)));          // how deep the blacks go
    const lum = dot(col, vec3(0.3, 0.6, 0.1));
    // the grain of the film, changing 24 times a second, and under it an even dither that keeps the dark gradients of the sky
    // and the fog from breaking into bands
    const sc = screenCoordinate.xy.add(U.grainT.mul(5.588238));
    col.addAssign(fract(fract(dot(sc, vec2(0.06711056, 0.00583715))).mul(52.9829189)).sub(0.5).mul(1.6 / 255.0));
    col.addAssign(h21(screenCoordinate.xy.add(fract(U.grainT.mul(0.6180339)).mul(97.0))).sub(0.5).mul(0.024).mul(l.mul(-0.5).add(1)));
    // while loading: the drawing, heated as the front comes, and the scene where it has come, glowing just behind it
    const bgc = vec3(0.027, 0.039, 0.067), pic = vec3(0).toVar();
    If(loading.greaterThan(0.5), () => {
      const sUV = st0.add(warp.mul(0.5)), skAt = o => sketchTex.sample(vec2(sUV.x.add(o.x), sUV.y.add(o.y).oneMinus())).rgb;
      const drawn = skAt(vec2(0.0, 0.0)), round4 = skAt(vec2(px.x.mul(2.5), 0.0)).add(skAt(vec2(px.x.mul(-2.5), 0.0))).add(skAt(vec2(0.0, px.y.mul(2.5)))).add(skAt(vec2(0.0, px.y.mul(-2.5)))).mul(0.25);
      const line = clamp(dot(drawn.sub(bgc), vec3(0.4)).mul(2.6), 0.0, 1.0), near = clamp(dot(round4.sub(bgc), vec3(0.4)).mul(2.6), 0.0, 1.0);
      const hot = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.86, 0.62), smoothstep(0.55, 1.0, ahead));
      const heated = mix(drawn, bgc.add(hot.mul(line.mul(ahead.mul(0.9).add(0.35)))).add(hot.mul(near.mul(ahead).mul(0.35))), smoothstep(0.02, 0.4, ahead))
        .add(hot.mul(cellEdge.mul(ahead).mul(0.22)));          // (the grid of the plan lights ahead of the front, cell by cell)
      const edges = mix(vec3(1.0, 0.30, 0.05), vec3(1.0, 0.70, 0.40), cooling).mul(line.add(near.mul(0.4)).mul(cooling).mul(0.7));
      const glowF = mix(vec3(1.0, 0.38, 0.07), vec3(1.0, 0.86, 0.64), fresh.mul(fresh)).mul(fresh.mul(sky0.mul(-0.8).add(1.0)).mul(0.6));
      pic.assign(mix(heated, col.add(glowF).add(edges), inside).add(vec3(1.0, 0.80, 0.52).mul(rimHot).mul(1.3)));
    });
    return vec4(mix(mix(bgc, col, U.fade), pic, loading), 1.0);
  })();

  // For looking at it from outside (tests): ?hide=glass,embers,... leaves parts out; ?probe draws into a render target and copies
  // the picture to a 2D canvas, for browsers that can render with WebGPU but not show it (headless ones).
  const hide = new Set(opt.hide || []);
  const parts = { glass: [glass], sheet: [sheet], embers: [embers.sprite], cast: [cast.sprite], sparks: [sparks.sprite, shock.ring, shock.flash], floor: [floorG], metal: [ours.metal], light: copies.map(c => c.light), lines: copies.map(c => c.lines), ghost: [ghost.boxes, ghost.body, ghost.glass] };
  let probe = null;
  if (opt.probe) { const cv2 = document.createElement('canvas'); cv2.id = 'probe'; cv2.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:0;pointer-events:none';
    canvas.after(cv2); probe = { cv: cv2, ctx: cv2.getContext('2d'), rt: null, busy: false }; }

  // ───────── per frame
  function columns(s) {
    let n = 0; world.columns((x, z, R, sh, c, fall) => { if (n < MAXC) { colA.array[n].set(x, z, R, sh); colB.array[n].set(c[0], c[1], c[2], fall); n++; } }, s);
    nCol.value = n;
  }
  // what the lens keeps from frame to frame (frame): the camera before, the eye's adaptation, the punch, what crossed a moment
  const lens = { vp: new THREE.Matrix4(), w: 0, h: 0, has: false, adapt: 0, punch: 0, power: 0, pick: 0, seen: false };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(o) {
    const { s, view, rect, W, H, dpr, time, dt } = o;
    // the camera of this moment, framed as the film is: a 16:9 picture of which the canvas shows a part
    camera.position.set(...view.cam); camera.up.set(0, 1, 0); camera.lookAt(view.tgt[0], view.tgt[1], view.tgt[2]); camera.rotateZ((view.roll || 0) * PI / 180);
    const dist = Math.hypot(view.cam[0] - view.tgt[0], view.cam[1] - view.tgt[1], view.cam[2] - view.tgt[2]);
    camera.fov = view.fov; camera.aspect = 16 / 9; camera.near = clampJ(dist * 0.012, 1, 40); camera.far = 90000;
    camera.setViewOffset(rect[2], rect[3], -rect[0], rect[1] + rect[3] - H, W, H); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    U.camPos.value.copy(camera.position); U.camWorld.value.copy(camera.matrixWorld); U.projInv.value.copy(camera.projectionMatrixInverse);
    U.viewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // the camera of the frame before, for the smear of a moving camera (none across a change of size or a jump in the film)
    if (!lens.has || lens.w !== W || lens.h !== H || o.cut) U.prevVP.value.copy(U.viewProj.value); else U.prevVP.value.copy(lens.vp);
    lens.vp.copy(U.viewProj.value); lens.w = W; lens.h = H; lens.has = true;
    U.res.value.set(W, H); U.focusD.value = o.focus ?? dist;
    U.dist.value = dist; U.line.value = Math.max(0.05, 0.85 * dist * 2 * Math.tan(view.fov * PI / 360) / (rect[3] / dpr)) * 1.15; U.focal.value = rect[3] / 2 / Math.tan(view.fov * PI / 360) / dpr; U.dpr.value = dpr;
    U.time.value = time; U.dt.value = dt; U.aspect.value = W / H; U.fade.value = o.fade ?? 1;
    { const e = camera.matrixWorld.elements; U.camRt.value.set(e[0], e[1], e[2]); U.camUp.value.set(e[4], e[5], e[6]); U.camFw.value.set(-e[8], -e[9], -e[10]); U.fl.value = 1 / Math.tan(view.fov * PI / 360); }
    if (o.hover) U.hov.value.set(o.hover[0], o.hover[1], o.hover[2]);
    U.idle.value = o.idle || 0; U.loaded.value = o.loaded ?? 1; U.dofR.value = (s.dof || 0) * 3.4 * dpr / H;
    // the typed line turning into the first cell
    const c = o.cast; cast.sprite.visible = !!c && c.fly > 0 && c.fly < 1 && cast.sprite.count > 0;
    if (c) { if (c.pts) cast.set(c.pts);
      U.castFly.value = c.fly; U.castD.value = dist * 0.3;
      U.castA.value.set((c.x0 * dpr - rect[0]) / rect[2] * 2 - 1, dpr / rect[2] * 2, ((H - c.yc * dpr) - rect[1]) / rect[3] * 2 - 1, -dpr / rect[3] * 2); }
    U.castProg.value = s.id === 'cast' ? clampJ((o.cast ? o.cast.fly - CAST.dur : 0) / CAST.leave, 0, 1) : 1;
    // the state
    for (const k of ['lift', 'buildY', 'morph', 'sim', 'simT', 'power', 'write', 'ghost', 'k2', 'k4', 'k5', 'k6', 'k14', 'waferHeat', 'fogD', 'stars',
      'water', 'grid', 'ripple', 'furn', 'glare', 'aur', 'steam', 'heat', 'flash', 'loose']) U[k].value = s[k];
    U.kick.value = o.kick || 0; U.speed.value = o.speed || 0;
    U.pour.value = s.pour ?? 1; U.objPos.value.set(...s.objPos); U.subGlow.value = (s.quench || 0) * s.heat * 1.6;
    const carving = !!s.wipe; U.carveX.value = carving ? s.wipe.x : s.carveX; U.carveT.value = carving ? 3 : s.carveT;
    U.back.value.set(...s.back); U.keyCol.value.set(...C.KEYCOL.map(v => v * s.keyI)); key.intensity = s.keyI; key.color.setRGB(...C.KEYCOL);
    // While loading: how far the front has come from the chip: over what is seen from above while the camera is there
    // (reveal: the corners of that view lie about 600 from the chip), then, as it turns down (swing), fast across the lake
    // and up the forge, and the sky before it comes into the top of the picture (a little past half the turn); and the
    // forge, all but dark until it comes into sight and catching fire then. Its light, crossing the lake, then lights the
    // chip from behind.
    const Ld = o.loaded ?? 1, sg = o.swing ?? 1, R = R_TOP * (Math.pow(o.reveal ?? 1, 1.35) + Math.exp(3.4 * sg) - 1), ig = Ld < 1 ? 0.08 + 0.92 * js.smooth(0.45, 0.85, sg) : 1;          // (the two add up: the turn begins while the last cells open)
    U.front.value = R; U.heatC.value.set(s.objPos[0], s.objPos[1] + 40, s.objPos[2]);
    // the light hanging in the air comes in as the camera comes down: looking straight down, a column of it would be seen
    // along its whole height, and the fog over the floor at its brightest, round the chip, a veil over the plan, where
    // from the side they are shafts and a haze (and so does the lamp over the anvil, and its reflection, below)
    U.airIn.value = Ld < 1 ? js.smooth(0.15, 0.65, sg) : 1;
    const sw = ig < 1 ? { ...s, furn: s.furn * ig, hl: s.hl * ig, glare: s.glare * ig } : s;
    U.furn.value = sw.furn; U.glare.value = sw.glare;
    // How the place is seen through the lens (film.js). The exposure: after a blinding moment (a blow of the hammer, the steam
    // over the lens) the eye takes a while to see into the dark again. The punch: a moment that counts (the power coming on,
    // a choice made, a blow) jolts the exposure for an instant. The smear of a moving camera is the same in time whatever the
    // frame rate: half of what a frame at sixty a second would sweep, at the most.
    for (const k of ['warm', 'sat', 'crush', 'halo', 'streak', 'dirt', 'vig']) U[k].value = s[k];
    const glare = Math.max(o.kick || 0, s.veilS || 0);
    lens.adapt += (glare - lens.adapt) * (1 - Math.exp(-dt / (glare > lens.adapt ? 0.25 : 1.2)));
    if (!lens.seen) { lens.power = s.power; lens.pick = s.pick; lens.seen = true; }
    if (s.id === 'chip' && lens.power < 0.5 && s.power >= 0.5) lens.punch = 1;
    if (lens.pick < 0.5 && s.pick >= 0.5) lens.punch = Math.max(lens.punch, 0.7);
    lens.power = s.power; lens.pick = s.pick; lens.punch *= Math.exp(-dt / 0.14);
    U.exposure.value = s.exp * (1 - 0.26 * lens.adapt); U.bloom.value = s.bloom * 2.2;
    U.punch.value = still ? 0 : Math.max(lens.punch, (o.kick || 0) * 0.5);
    U.shutter.value = still ? 0 : (s.shutter ?? 0.6) * clampJ(1 / (120 * Math.max(dt, 1e-3)), 0.15, 1);
    U.veilS.value = (s.veilS || 0) * (still ? 0.5 : 1); U.veilE.value = still ? 0 : (s.veilE || 0);
    U.grainT.value = Math.floor(time * 24) % 4096;
    // where the air is hot, on the screen: the heart of the forge, the chip while it glows, the metal just poured
    { let n = 0; const H = hazeA.array, P = new THREE.Vector3(), Q = new THREE.Vector3();
      const add = (x, y, z, r, k) => { if (k < 0.02 || n >= 3) return; P.set(x, y, z).project(camera); if (P.z > 1 || Math.abs(P.x) > 1.6 || Math.abs(P.y) > 1.6) return;
        Q.set(x, y + r, z).project(camera); H[n++].set(P.x * 0.5 + 0.5, 0.5 - P.y * 0.5, Math.max(Math.abs(Q.y - P.y) * 0.5, 0.01), k); };
      { const tp = world.tip(); add(tp[0], tp[1] * 0.5 - s.lift, tp[2], 700, sw.furn * 0.7 * Math.max((s.mFlow ?? 1) * s.water, s.mBurst || 0)); }          // the air round the first pyramid's line
      add(s.objPos[0], s.objPos[1] + 60, s.objPos[2], 150, (s.heat || 0) * 1.4 + (o.kick || 0) * 0.8);
      if (s.buildY < 900 && (s.wipe || (s.pour ?? 1) < 1)) add(s.objPos[0], s.objPos[1] + s.buildY + 30, s.objPos[2], 200, 0.9);
      for (let i = n; i < 3; i++) H[i].set(0, 0, 0.01, 0); }
    scene.environmentIntensity = (0.4 + 0.6 * clampJ(s.back[2] / 0.32, 0, 1.5)) * (0.12 + 0.88 * U.airIn.value);        // what is reflected is as bright as the sky of the moment
    // (and while the camera looks straight down, the flat metal of the chip would mirror the shaft overhead, which is the
    // lamp over the anvil: it comes up with the lamp)
    floorG.position.y = -s.lift; mem.position.set(...s.objPos); last.lift = s.lift; last.objPos = s.objPos;
    { const w = s.wipe, cutting = w ? js.smooth(0, 0.04, w.w) * (1 - js.smooth(0.96, 1, w.w)) : 0;
      U.cut.value.set(s.objPos[0] + (w ? w.x : 0), s.objPos[1] + (w ? w.y : 0), 190 * cutting, cutting > 0.01 ? 1 : 0);
      U.solid.value.set(s.obj > 0.5 ? 1 : 0, s.plinth > 0.5 ? 1 : 0, s.buildY < 900 ? Math.max(s.buildY, 0) : D.glass + s.loose * LOOSE); }
    shock.ring.visible = time - U.blow.value.z < 0.9; shock.flash.visible = time - U.blow.value.z < 0.5;
    // the shaft of cold light over the place of the design
    beam.intensity = s.beamI * 2.4 * U.airIn.value; beam.position.set(0, 1400 - s.lift, 0);          // (from straight above, the chip's glass would mirror the lamp into the lens: it comes up as the camera comes down) beam.target.position.set(0, -s.lift, 0); beam.target.updateMatrixWorld();
    world.update(sw, o.kick || 0, time);
    fluid.flow(dt, o.stir);          // the pointer's strokes since the last frame; then the stirred water, and the waves, move on
    world.flow(dt, s);          // (both are worked out in pictures of their own, before the scene)
    // embers: a field that is always round what the camera looks at
    U.cold.value = s.cold; U.rise.value = lerp(15, 1.1, s.cold); U.amount.value = s.emb; U.embC.value.set(view.tgt[0], view.tgt[2]);
    // the copies of the memory: ours, and the candidates on the dies around it
    const on = s.obj > 0.5;
    for (const c of copies) {
      const isOurs = c === ours, h = c.h, instv = isOurs ? 0 : 0.15 + 0.85 * h;
      let ap = 1, tile = s.tileUp, peri = s.peri, selv = 1, mx = 1, mz = 1, vis = on;
      if (!isOurs) { ap = clampJ(s.cand * 1.7 - 0.7 * h, 0, 1); tile = Math.min(tile, ap); peri = Math.min(peri, ap * ap);
        selv = 1 - js.smooth(0, 1, clampJ(s.pick * 1.6 - 0.6 * h, 0, 1)); vis = on && s.cand > 0 && ap > 0 && selv > 0.02 && s.ghost <= 0;
        if (s.vari > 0.5) { if (h > 0.5) mx = -1; if (js.fract(h * 7.3) > 0.5) mz = -1; } }
      const u = c.u; u.ca.set(c.ci * DC[0], c.cj * DC[1], instv, selv); u.cb.set(mx, mz, tile, peri); u.cc.set(isOurs ? s.buildY : -5, isOurs ? 1 : ap, isOurs ? 1 : 0, 0);
      c.lines.visible = vis && s.morph < 0.3; c.light.visible = vis && s.morph > 0 && (isOurs ? s.buildY < 999 : true);
      if (isOurs) c.metal.visible = vis && s.buildY > -1;
    }
    // the clear body stands as high as what has been laid (and a little higher while the layers still stand apart)
    const gh = Math.min(D.glass, s.buildY - 3) + s.loose * LOOSE + (o.hover ? o.hover[2] * 44 : 0) + (o.idle || 0) * 9; glass.visible = on && gh > 1; if (glass.visible) { glass.scale.set(1, gh / D.glass, 1); U.glassS.value = gh / D.glass; }
    const sx0 = Math.max(U.carveX.value, -D.hw), shx = (D.hw - 1 - sx0) / 2, sth = U.carveT.value;
    sheet.visible = on && sth > 0 && shx > 0 && s.buildY < 900; if (sheet.visible) { sheet.scale.set(shx * 2, sth, (D.hd - 1) * 2); sheet.position.set(sx0 + shx, s.buildY - sth / 2, 0); }
    ghost.boxes.visible = ghost.body.visible = ghost.glass.visible = s.ghost > 0;
    columns(sw);
    for (const k of hide) for (const m of parts[k] || []) m.visible = false;
    renderer.compute(embers.step); renderer.compute(sparks.step); sparks.thrown();
    const pw = renderer.domElement.width, ph = renderer.domElement.height;
    if (probe && (!probe.rt || probe.rt.width !== pw || probe.rt.height !== ph)) { probe.rt?.dispose(); probe.rt = new THREE.RenderTarget(pw, ph, { type: THREE.UnsignedByteType }); }
    if (!probe) { pipe.render(); return; }
    if (probe.busy) return;             // one picture at a time: a slow GPU would otherwise queue frames faster than it reads them back
    renderer.setRenderTarget(probe.rt); pipe.render(); renderer.setRenderTarget(null);
    { probe.busy = true; renderer.readRenderTargetPixelsAsync(probe.rt, 0, 0, pw, ph).then(px => {
      const c = probe.cv; if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
      const im = probe.ctx.createImageData(pw, ph), row = gpu ? Math.ceil(pw * 4 / 256) * 256 : pw * 4;      // WebGPU pads each row to 256 bytes; WebGL's rows run bottom up
      for (let y = 0; y < ph; y++) { const sy = gpu ? y : ph - 1 - y; im.data.set(px.subarray(sy * row, sy * row + pw * 4), y * pw * 4); }
      probe.ctx.putImageData(im, 0, 0); probe.frames = (probe.frames || 0) + 1; }).finally(() => { probe.busy = false; }); }
  }
  // Before the first picture (main.js waits for it while the loading drawing is on): every material of the film compiled for
  // the target the scene is really drawn into, and the compute shaders, all asynchronously, so that the GPU compiles them
  // aside and nothing waits on a shader: not the page, not the drawing on the screen, not a later part of the film when it
  // is scrolled into. Everything is shown and nothing is culled while three gathers what to compile, which it does at once,
  // so it can all be put back straight away.
  async function prepare() {
    const kept = [];
    scene.traverse(o => { if (o.isMesh || o.isSprite || o.isLine || o.isPoints) { kept.push([o, o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; } });
    const prev = renderer.getRenderTarget(), jobs = [];
    try { renderer.setRenderTarget(scenePass.renderTarget); jobs.push(renderer.compileAsync(scene, camera)); }
    catch (e) { console.warn('warm-up:', e); }
    finally { renderer.setRenderTarget(prev); for (const [o, v, f] of kept) { o.visible = v; o.frustumCulled = f; } }
    try { jobs.push(renderer.compileComputeAsync([embers.step, sparks.step])); } catch (e) { console.warn('warm-up:', e); }
    try { fluid.warm(); } catch (e) { console.warn('warm-up:', e); }          // (the stirred water's own passes, drawn once)
    // (the passes after the scene compile with the first picture: by then the drawing is finished and still, so a pause there
    // is not seen.) Never more than eight seconds: past that the film starts and compiles the rest as it goes.
    await Promise.race([Promise.all(jobs.map(j => j.catch(e => console.warn('warm-up:', e)))), new Promise(r => setTimeout(r, 8000))]);
  }
  function resize(cssW, cssH, dpr) { renderer.setPixelRatio(dpr); renderer.setSize(cssW, cssH, false); }
  if (opt.debug) window.__stage = { renderer, scene, camera, ours, ghost, embers, glass, U, fluid };
  // the page's drawing of the first picture, taken over as a picture
  function sketch(cv, at) { if (at) U.revealAt.value.set(at[0], at[1]); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; sketchTex.value = t; }
  return { renderer, camera, frame, prepare, resize, blow, sketch, lake: [C.WC[0], C.WC[1], C.WR - 80], rings: world.rings, ring: (x, z, amp) => world.ring(x, z, amp, U.time.value), stirred: fluid.stirred, pour: cast.pour, backend: gpu ? 'webgpu' : 'webgl2', samples, embers: NE, sparks: sparks.count, counts: { lines: nL, boxes: nB, linesFar: lineGeoFar.instanceCount, boxesFar: boxGeoFar.instanceCount, dies: DIES.length }, probed: () => probe?.frames || 0 };
}

// What the metal reflects, as a small equirectangular picture (three.js prefilters it for each roughness): the sky over
// the lake with its cold glow at the horizon, the shaft of light overhead, the fire of the forge on the far shore (toward -z),
// and below, dark water.
function envMap() {
  const w = 256, h = 128, data = new Uint16Array(w * h * 4);          // (a larger one is not prefiltered right on WebGL 2)
  const back = [0.10, 0.16, 0.32], bd = [0.1 / Math.hypot(0.1, 1), -1 / Math.hypot(0.1, 1)], box = C.BOX, bxd = C.BOXDIR.map(v => v / Math.hypot(...C.BOXDIR));
  const warm = js.heat(0.66), cold = C.KEYCOL;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const phi = (i + 0.5) / w * 2 * Math.PI, th = (j + 0.5) / h * Math.PI, y = -Math.cos(th), r = Math.sin(th), x = -Math.cos(phi) * r, z = -Math.sin(phi) * r;      // three's layout, the first row at the bottom
    let c = C.SKY.map(v => v * (0.3 + 0.7 * Math.pow(1 - Math.max(y, 0), 3)));
    const bx = js.smooth(0.78, 0.96, x * bxd[0] + y * bxd[1] + z * bxd[2]); c = c.map((v, k) => v + box[k] * bx);
    const l = Math.hypot(x, z) + 1e-5, g = js.smooth(0.015, 0.09, y) * Math.exp(-5.5 * Math.max(y, 0)) * js.smooth(-0.3, 0.75, (x * bd[0] + z * bd[1]) / l);
    c = c.map((v, k) => v + back[k] * g);
    const top = Math.pow(Math.max(y, 0), 16); c = c.map((v, k) => v + cold[k] * 3.0 * top);                     // the shaft overhead
    const el = Math.atan2(y, l), az = Math.atan2(x, -z);                                                         // az 0: toward the forge
    const fire = Math.exp(-Math.pow(az / 0.22, 2)) * Math.exp(-Math.pow((el - 0.05) / 0.09, 2)); c = c.map((v, k) => v + warm[k] * 0.11 * fire);
    const hall = Math.exp(-Math.pow(az / 0.55, 2)) * js.smooth(-0.02, 0.02, el) * js.smooth(0.34, 0.1, el); c = c.map((v, k) => v * (1 - 0.8 * hall) + warm[k] * 0.004 * hall);      // its dark mass against the sky
    if (y < 0) { const under = Math.pow(-y, 2); c = c.map(v => v * (0.35 - 0.2 * under) + 0.0012); }
    for (let k = 0; k < 3; k++) data[(j * w + i) * 4 + k] = THREE.DataUtils.toHalfFloat(c[k]); data[(j * w + i) * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}
