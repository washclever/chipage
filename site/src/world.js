// The place. A hall, and in it a lake that becomes the wafer. Its sides are walls of dark iron that climb away from the water in
// steps, heavy and few on the left, many and fine on the right; its ceiling is a row of inverted pyramids that runs on down
// the hall as far as can be seen. Each pyramid is made of layers, each a slope and then a flat, and each layer slides under
// the one above it, so that its point goes where it is sent, as a printing head does; from the point the molten metal falls.
// The first hangs over the lake: its point rests off to the right and pours a thin line into the lake, and once, at the
// start, comes over the chip and strikes it with one fall of metal. The far ones, in a line down the middle of the hall,
// move and pour by themselves, slowly, each in its own time. A bridge runs out from the right wall toward the first pour and
// stays where it is. Its mood: a size that dwarfs what stands in it, heat in a cold dark, the stillness of a temple.
// Also here: the anvil that stands in the lake, the steam of the quench.
// Everything hangs from `floorG`, which the stage moves down by the film's `lift`; the anvil hangs from `mem`, with the chip.
import * as THREE from '../vendor/three.js';
import * as M from './memory.js';
import { HALL } from './film.js';
import { C, h21, vn, fbm, heatColor, waferT, waves, js, PAL } from './shade.js';
import { rnd } from './hash.js';
import { createWater } from './water.js';

const { Fn, If, Loop, Discard, float, vec2, vec3, vec4, uniform, uniformArray, attribute, positionWorld, positionLocal, normalLocal, normalWorld, cameraPosition, mix, smoothstep, clamp, step, select,
  min, max, abs, exp, pow, sin, cos, fract, floor, length, dot, normalize, fwidth, varying, uv, transformNormalToView, instancedBufferAttribute, positionGeometry, normalGeometry } = THREE.TSL;
const D = M.DIE, DC = [D.cellW, D.cellD], PI = Math.PI, H = HALL;
const COLD = vec3(...C.COLD), IRON = vec3(...PAL.iron).mul(PAL.ironK), EDGE = vec3(...PAL.edge), LAMP = vec3(...PAL.lamp);
const FIRE = c => mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, PAL.fireSat).mul(PAL.fireK);          // (the fire's light on a surface, as the palette has it)

// boxes as one mesh: [x0, x1, y0, y1, z0, z1, glow]. glow marks what is lit from inside (seams, runnels of metal)
function boxGeo(list) {
  const base = new THREE.BoxGeometry(1, 1, 1), bp = base.getAttribute('position'), bu = base.getAttribute('uv'), bi = base.index, n = list.length;
  const pos = new Float32Array(n * bp.count * 3), glow = new Float32Array(n * bp.count), kind = new Float32Array(n * bp.count), uvs = new Float32Array(n * bp.count * 2), idx = new Uint32Array(n * bi.count);
  list.forEach((b, j) => { const [x0, x1, y0, y1, z0, z1, g = 0, kd = 0] = b;
    for (let v = 0; v < bp.count; v++) { const o = (j * bp.count + v) * 3, w = j * bp.count + v;
      pos[o] = (x0 + x1) / 2 + bp.getX(v) * (x1 - x0); pos[o + 1] = (y0 + y1) / 2 + bp.getY(v) * (y1 - y0); pos[o + 2] = (z0 + z1) / 2 + bp.getZ(v) * (z1 - z0); glow[w] = g; kind[w] = kd; uvs[w * 2] = bu.getX(v); uvs[w * 2 + 1] = bu.getY(v); }
    for (let k = 0; k < bi.count; k++) idx[j * bi.count + k] = bi.getX(k) + j * bp.count; });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1)); g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1)); g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
const both = b => [b, [-b[1], -b[0], b[2], b[3], b[4], b[5], b[6]]];          // a box and its mirror image across the slot
// a box rounded at its edges and corners (its surface drawn in toward a smaller box inside it), standing on y = 0
export function roundedBox(w, h, d, r, seg = 4) {
  const n = 2 * seg + 1, g = new THREE.BoxGeometry(1, 1, 1, n, n, n), P = g.getAttribute('position'), Nn = g.getAttribute('normal'), half = [w / 2, h / 2, d / 2];
  const at = (u, hf) => { const i = Math.round((u + 0.5) * n); return i <= seg ? -hf + r * i / seg : hf - r + r * (i - seg - 1) / seg; };
  for (let v = 0; v < P.count; v++) { const p = [at(P.getX(v), half[0]), at(P.getY(v), half[1]), at(P.getZ(v), half[2])], q = p.map((c, k) => Math.min(half[k] - r, Math.max(-half[k] + r, c)));
    const dv = p.map((c, k) => c - q[k]), l = Math.hypot(...dv) || 1; P.setXYZ(v, q[0] + dv[0] / l * r, q[1] + dv[1] / l * r, q[2] + dv[2] / l * r); Nn.setXYZ(v, dv[0] / l, dv[1] / l, dv[2] / l); }
  g.translate(0, h / 2, 0); g.computeBoundingSphere(); return g;
}
// a level disc of radius R, finer toward its middle (where the camera is): nr rings of na vertices
function discGeo(R, nr, na) {
  const pos = [0, 0, 0], idx = [];
  for (let i = 1; i <= nr; i++) { const r = R * Math.pow(i / nr, 1.6); for (let j = 0; j < na; j++) { const a = j / na * 2 * PI; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); } }
  for (let j = 0; j < na; j++) idx.push(0, 1 + (j + 1) % na, 1 + j);
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < na; j++) { const a = 1 + i * na + j, b = 1 + i * na + (j + 1) % na, c = a + na, d = b + na; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(), nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  const tex = new Float32Array(pos.length / 3 * 2); for (let i = 0; i < tex.length / 2; i++) { tex[i * 2] = pos[i * 3] / R * 0.5 + 0.5; tex[i * 2 + 1] = pos[i * 3 + 2] / R * 0.5 + 0.5; }          // (the material's lighting asks for coordinates on the surface, though it reads none)
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(tex, 2));
  g.setIndex(idx); g.computeBoundingSphere(); return g;
}

export function createWorld({ scene, floorG, mem, U, mirror, small, renderer, fluid }) {
  // The pours, as every surface near one reads them, to take its light: each (x, z, the height of the point, how strongly it
  // pours), the first the one over the lake. (Worked out in the world, so the floor's lift is in them: update, below.)
  const NP = 1 + H.row.length, POURS = uniformArray([...Array(NP)].map(() => new THREE.Vector4()), 'vec4');
  // how much light the pours throw on a point of a surface: from the nearest point of each falling line, falling off with
  // distance, more where the surface faces it
  const pourLight = (P, N, reach = 900.0) => { let g = float(0);
    for (let i = 0; i < NP; i++) { const p = POURS.element(i), cy = clamp(P.y, 0.0, p.z), d = vec3(P.x.sub(p.x), P.y.sub(cy), P.z.sub(p.y)), l = length(d).max(1.0);
      g = g.add(p.w.mul(exp(l.div(-reach))).mul(dot(N, d.div(l).negate()).max(0.0).mul(0.75).add(0.25))); }
    return g; };
  // and the mouths themselves, hot even when they do not pour: a soft light round each, by which its layers are seen
  const MOUTHS = uniformArray([...Array(NP)].map(() => new THREE.Vector4()), 'vec4');
  const mouthLight = (P, N, reach = 3000.0) => { let g = float(0);
    for (let i = 0; i < NP; i++) { const p = MOUTHS.element(i), d = vec3(P.x.sub(p.x), P.y.sub(p.z), P.z.sub(p.y)), l = length(d).max(1.0);
      g = g.add(p.w.mul(exp(l.div(-reach))).mul(dot(N, d.div(l).negate()).max(0.0).mul(0.6).add(0.4))); }
    return g; };
  const refl = mirror ? mirror() : null;          // the lake mirrors the scene
  // ───────── the lake that becomes the wafer. It is water: it has a swell that lifts and lowers its surface (the mesh
  // itself moves), small waves riding on the swell, and the waves that whatever touches it sets running: the anvil and
  // the chip going down into it, the strike of the metal, the pointer as it crosses, the sparks of the order as they land.
  // Those are not drawn but worked out as water moves (water.js); the lake takes its height and its slope from there.
  const SW = 4.0;          // the height of the swell at ripple 1
  const water = createWater({ renderer, U, small, fluid });
  const c = vec2(...C.WC), DCv = vec2(...DC);
  const SWELL = [[0.8, 0.6, 430, 0.52, 1.0], [-0.5, 0.86, 255, 0.74, 0.62], [0.95, -0.31, 140, 1.02, 0.3]];          // direction, length, pace, height of each train
  // at a point of the lake: how high the swell stands (in units of its height) and which way it slopes
  const swell = q => { let h = float(0), g = vec2(0);
    for (const [dx, dz, len, sp, a] of SWELL) { const k = 6.2832 / len, ph = dot(q, vec2(dx, dz)).mul(k).sub(U.time.mul(sp)); h = h.add(sin(ph).mul(a)); g = g.add(vec2(dx, dz).mul(cos(ph).mul(a * k))); }
    return [h, g]; };
  // how far the water has set at a point: in patches, from the shore inward
  const setAt = (q, rm) => smoothstep(0.0, 0.35, U.water.oneMinus().mul(1.5).sub(fbm(vec3(q.mul(0.004), 2.0)).mul(0.5)).sub(rm.oneMinus().mul(0.35)));
  const p = positionWorld.xz, rim = length(p.sub(c)).div(C.WR);
  const pfw = max(fwidth(p.x), fwidth(p.y)).max(1e-3);          // how much of the lake a pixel covers here
  const wl = setAt(p, rim).toVar('setW'), still = wl.oneMinus().mul(smoothstep(1.0, 0.93, rim));          // (water moves; what has set, and the water at the very shore, does not)
  const [, sg] = swell(p);
  const slope = sg.mul(U.ripple.mul(SW)).add(water.slopeAt(p, pfw)).add(waves(p, U.time, U.ripple.mul(0.5).add(0.08), pfw)).mul(still).toVar('slope');
  if (refl) refl.uvNode = refl.uvNode.add(slope.mul(vec2(0.3, 0.8)));          // the mirror is broken by the waves
  {
    const fw = fwidth(p.x).max(1e-3), det = smoothstep(4.0, 1.2, fw);          // fine detail goes where a pixel would hold several lines of it
    const ci = floor(p.div(DCv).add(0.5)), q = p.sub(ci.mul(DCv)), dm = DCv.mul(0.5).sub(abs(q));
    const line0 = smoothstep(3.0, 1.6, min(dm.x, dm.y)), line = line0.mul(det), tone = h21(ci.add(17.0));
    const mk = abs(abs(q).sub(DCv.mul(0.5).sub(14.0))), mark = step(max(mk.x, mk.y), 5.0).mul(step(min(mk.x, mk.y), 0.9)).mul(line.oneMinus()).mul(det);
    const T = waferT(p, c, U.waferHeat).mul(line.mul(-0.28).add(1)).mul(tone.mul(0.28).add(0.86)).mul(fbm(vec3(p.mul(0.02), 3.0)).mul(0.36).add(0.82)).mul(wl).toVar();
    const fr = smoothstep(0.55, 0.75, fbm(vec3(p.mul(0.006), 7.0))).mul(smoothstep(0.72, 0.98, rim)).mul(smoothstep(0.2, 0.02, T)).mul(wl);
    const alb = mix(mix(vec3(0.19, 0.205, 0.24).mul(tone.mul(0.44).add(0.78)), vec3(0.06, 0.07, 0.09), line), vec3(0.46, 0.48, 0.53), mark);
    const poolW = smoothstep(650.0, 2600.0, length(p)).mul(-0.88).add(1.0);          // frost is lit by the key light, which falls off away from the middle
    const rough = mix(mix(tone.mul(0.10).add(0.05), 0.4, max(line, mark)).add(vn(positionWorld.mul(0.7)).mul(0.06).mul(det)), 0.6, smoothstep(0.1, 0.5, T)).max(fr.mul(0.9));
    const top = new THREE.MeshPhysicalNodeMaterial(), side = new THREE.MeshStandardNodeMaterial({ color: 0x0b0d12, roughness: 0.35, metalness: 1 });
    // the surface itself rises and falls with the swell and the waves (worked out where the vertex is in the world, as
    // the shading is, so that the water stands where it is lit)
    const pv = positionLocal.xz.add(c), rimV = length(pv.sub(c)).div(C.WR), stillV = setAt(pv, rimV).oneMinus().mul(smoothstep(1.0, 0.93, rimV));
    top.positionNode = positionLocal.add(vec3(0, swell(pv)[0].mul(U.ripple.mul(SW)).add(water.heightAt(pv)).mul(stillV), 0));
    top.colorNode = mix(vec3(0.004, 0.008, 0.013), mix(alb.mul(T.mul(-0.5).add(1)), vec3(0.62, 0.70, 0.80).mul(poolW), fr), wl);
    top.roughnessNode = mix(smoothstep(2.0, 30.0, pfw).mul(0.16).add(0.05), rough, wl); top.metalnessNode = fr.oneMinus().mul(wl);          // far water is given a broader gleam: a sharp one would only sparkle
    top.normalNode = transformNormalToView(normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())));
    top.envMapIntensity = refl ? 0.12 : 1;
    // (no glint of a lamp on the water: so close to the lens, the pour's light and the chip's made a hard spot at the foot of
    // the picture, which the lens drew out sideways into a row of spots; what the water mirrors of the hall stays, through its
    // own reflection below, and the set wafer keeps its gleam)
    top.specularIntensityNode = wl;
    const v = normalize(cameraPosition.sub(positionWorld)), gr = pow(v.y.clamp(0.0, 1.0).oneMinus(), 5.0), Fr = mix(gr.mul(0.98).add(0.02), gr.mul(0.67).add(0.33), wl);
    let e = heatColor(T).add(COLD.mul(line0).mul(smoothstep(5.0, 1.5, fw)).mul(U.grid).mul(wl.oneMinus()).mul(step(rim, 0.985)).mul(0.07));          // the dies show through the water as a lattice of faint light
    e = e.add(heatColor(U.subGlow.mul(exp(dot(p, p).div(-170.0 * 170.0))).mul(vn(vec3(p.mul(0.04), U.time.mul(0.7))).mul(0.4).add(0.8))).mul(wl.oneMinus()));          // what was quenched still glows under the water
    e = e.add(vec3(0.60, 0.80, 1.0).mul(wl.mul(wl.oneMinus()).mul(4.0)).mul(fbm(vec3(p.mul(0.05), 4.0)).mul(0.8).add(0.3)).mul(0.22));          // the line along which the water is setting: a pale edge, like ice forming
    e = e.add(vec3(0.010, 0.030, 0.052).mul(length(slope).mul(2.2).clamp(0.0, 1.0)).mul(still));          // the faces of the waves that tilt toward the eye show a little of the depth under them
    { const p0 = POURS.element(0), dd = p.sub(vec2(p0.x, p0.y)), r2 = dot(dd, dd);          // where the line falls into the lake: a pool of its light, and round it a glow
      e = e.add(heatColor(exp(r2.div(-50.0 * 50.0)).mul(0.42).add(exp(r2.div(-380.0 * 380.0)).mul(0.1))).mul(p0.w.min(1.0)).mul(wl.oneMinus())); }
    if (refl) e = e.add(min(refl.rgb, vec3(mix(float(0.15), float(0.8), wl))).mul(Fr).mul(line.mul(wl).mul(-0.85).add(1)).mul(fr.oneMinus()).mul(smoothstep(0.6, 0.15, top.roughnessNode)).mul(mix(float(0.6), float(0.7), wl)));          // (the water gives back what is bright above it only so far: the hot chip, the pour and the lamps of the pyramids no longer flare in it)
    top.emissiveNode = e;
    const lake = new THREE.Mesh(discGeo(C.WR, small ? 56 : 110, small ? 128 : 224), top); lake.position.set(C.WC[0], 0, C.WC[1]); lake.frustumCulled = false; floorG.add(lake);
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(C.WR, C.WR, 12, 200, 1, true), side); edge.position.set(C.WC[0], -6, C.WC[1]); floorG.add(edge);
    // the shore: dark ground a hand above the water, wet near it; when the lake has set, the wafer lies flush in it
    const gm = new THREE.MeshStandardNodeMaterial();
    const r0 = length(positionWorld.xz.sub(c)), gn = fbm(vec3(positionWorld.xz.mul(0.012), 5.0));
    const wet = max(smoothstep(C.WR + 260, C.WR + 10, r0), smoothstep(2700.0, 2200.0, abs(positionWorld.x.add(180.0))).mul(step(positionWorld.z, -2000.0)).mul(0.85));          // and wet down the middle of the hall, where the far pours land
    gm.colorNode = vec3(0.020, 0.022, 0.028).mul(IRON).mul(gn.mul(0.9).add(0.55)); gm.roughnessNode = mix(float(0.9), float(0.22), wet.mul(gn.mul(0.6).add(0.4))); gm.metalnessNode = float(0.25);
    gm.emissiveNode = Fn(() => { let e = float(0);
      for (let i = 1; i < NP; i++) { const p = POURS.element(i), dd = positionWorld.xz.sub(vec2(p.x, p.y)), r2 = dot(dd, dd);
        e = e.add(exp(r2.div(-70.0 * 70.0)).mul(0.6).add(exp(r2.div(-520.0 * 520.0)).mul(0.25)).mul(p.w)); }
      return heatColor(e.min(1.0)); })();
    const ground = new THREE.Mesh(new THREE.RingGeometry(C.WR - 1, 60000, 160, 1), gm); ground.rotation.x = -PI / 2; ground.position.set(C.WC[0], 2.5, C.WC[1]); floorG.add(ground);
  }

  // ───────── the walls. Dark iron, laid in courses, climbing away from the water in steps on either side of the hall, up to
  // where the pyramids hang. What shows that they are vast is small: the lights in them. Rows of narrow openings run along each
  // step, a few lit, each no taller than the anvil; finer windows between; the lip of each course catches a little light; and
  // near a pour the iron takes its fire.
  const wallMat = new THREE.MeshStandardNodeMaterial({ flatShading: true });
  {
    const vg = varying(attribute('aGlow', 'float')), q = positionLocal, n = abs(normalLocal), flick = vn(vec3(q.xy.mul(0.013), U.time.mul(0.9))).mul(0.3).add(0.78);
    const course = vn(vec3(q.x.mul(0.004), q.y.mul(0.05), q.z.mul(0.004))).mul(0.5).add(0.6);
    const along = select(n.x.greaterThan(0.5), q.z, q.x), up = step(0.5, n.y), face = up.oneMinus();
    // the iron at three sizes: ribs stand out every 260 along it, plates between ribs and courses each a shade of its own (a
    // quarter rusted warm, a quarter sooted dark), a lip at the top of each course; what faces up is grimed, darker and rougher
    const ru = fract(along.div(260.0)), rib = smoothstep(0.0, 0.015, ru).mul(smoothstep(0.15, 0.13, ru)), ribSh = smoothstep(0.15, 0.17, ru).mul(smoothstep(0.32, 0.18, ru));
    const cv = fract(q.y.div(118.0)), lip = smoothstep(0.955, 0.975, cv).mul(smoothstep(1.0, 0.985, cv)).mul(face);
    const pl = vec2(floor(along.div(130.0)), floor(q.y.div(118.0))), ph = h21(pl.add(31.0)), ph2 = h21(pl.add(57.0));
    const tint = mix(vec3(1.0), mix(vec3(1.5, 1.08, 0.78), vec3(0.55), step(0.5, ph2)), step(0.5, ph));
    // and the ends of things, which face along the hall, are sooted and matte: as metal they would mirror an open sky the
    // closed hall does not have, and stand out pale
    const zf = step(0.5, n.z);
    wallMat.colorNode = vec3(0.013, 0.015, 0.020).mul(IRON).mul(course).mul(tint).mul(rib.mul(0.7).sub(ribSh.mul(0.5)).add(1.0)).mul(mix(float(1.0), float(0.5), up)).mul(mix(float(1.0), float(0.6), zf));
    wallMat.roughnessNode = mix(mix(course.mul(0.2).add(0.5), float(0.92), up), float(0.85), zf); wallMat.metalnessNode = mix(mix(float(0.75), float(0.5), up), float(0.0), zf);
    // the openings: on the upright faces, in bands, each cell a narrow slit; one in seven is lit, and breathes; a few are the cold
    // white of a work lamp, now and then one flares (someone welding); between the bands a finer row of small windows, dim
    const cell = vec2(floor(along.div(52.0)), floor(q.y.div(88.0))), f = vec2(fract(along.div(52.0)), fract(q.y.div(88.0)));
    const band = step(fract(q.y.div(590.0).add(0.13)), 0.32).mul(step(110.0, q.y)).mul(face), hs = h21(cell.add(7.0)), lit = step(0.86, hs).mul(band);
    // (each opening a size of its own, narrow or wide, short or tall, and a little of its light on the iron round it)
    const hw = mix(float(0.05), float(0.15), h21(cell.add(3.0))), hh2 = mix(float(0.16), float(0.38), h21(cell.add(5.0))), ax = abs(f.x.sub(0.5)), ay = abs(f.y.sub(0.5));
    const slit = smoothstep(hw.add(0.04), hw, ax).mul(smoothstep(hh2.add(0.04), hh2, ay)), halo = exp(ax.div(hw.mul(3.2)).pow(2.0).add(ay.div(hh2.mul(1.6)).pow(2.0)).negate()).mul(0.2);
    const near = smoothstep(0.5, 0.12, fwidth(along.div(52.0)));
    const breathe = sin(U.time.mul(hs.mul(0.9).add(0.25)).add(hs.mul(60.0))).mul(0.3).add(0.7);
    const weld = step(0.994, hs).mul(step(0.62, vn(vec3(hs.mul(40.0), U.time.mul(7.0), 1.0))));
    const lamp = step(0.79, hs).mul(step(hs, 0.81)).mul(band);
    const look = mix(float(0.03), slit.add(halo), near);
    const winK = float(0.3);          // (the openings in the iron are few: the terraces' own lamps and doors say how big it is)
    const wins = heatColor(hs.mul(0.2).add(0.52)).mul(lit.mul(breathe).mul(weld.oneMinus())).mul(1.5).add(EDGE.mul(1.25).mul(lamp.mul(0.9).add(weld.mul(lit).mul(4.0)))).mul(look);
    const fcell = vec2(floor(along.div(26.0)), floor(q.y.div(40.0))), ff = vec2(fract(along.div(26.0)), fract(q.y.div(40.0)));
    const fh = h21(fcell.add(3.0)), fine = step(fract(q.y.div(590.0).add(0.56)), 0.14).mul(step(110.0, q.y)).mul(face).mul(step(0.7, fh)).mul(fh.sub(0.7).mul(2.5).add(0.25));
    const fineLook = mix(float(0.05), smoothstep(0.2, 0.12, abs(ff.x.sub(0.5))).mul(smoothstep(0.26, 0.18, abs(ff.y.sub(0.5)))), smoothstep(0.5, 0.12, fwidth(along.div(26.0))));
    const finer = heatColor(float(0.5)).mul(fine.mul(fineLook)).mul(0.35);
    const fire = pourLight(positionWorld, normalWorld, 1100.0);
    // What is lit on the terraces (aKind; uv, where on its face): 1 a door, the light inside it strongest low and in the middle,
    // falling off toward its jambs and its head; 2 a shutter, open at its foot (glow: how far), its slats shut above; 3 the lens
    // of a lamp, white at its heart; 4 the pool of a lamp's light on the floor; 5 the wash of a lamp on the wall round it; 6, 7
    // the light of a door thrown on the floor before it (the door at one end or the other). Each a little warmer or cooler than
    // the next.
    const kd = varying(attribute('aKind', 'float')), st = uv(), K = k => step(abs(kd.sub(k)), 0.4), lv = max(vg, 0.0);
    const vh = h21(floor(positionWorld.xz.div(61.0)).add(29.0)), tone = mix(vec3(1.0), vec3(1.08, 0.96, 0.84), vh);
    const doorC = vec3(...PAL.door).mul(tone), lampC = LAMP.mul(tone);
    const jamb = smoothstep(0.0, 0.16, st.x).mul(smoothstep(1.0, 0.84, st.x)).mul(0.7).add(0.3);
    const doorL = doorC.mul(jamb).mul(mix(float(1.0), float(0.42), st.y)).mul(lv).mul(K(1));
    const opn = smoothstep(lv.add(0.015), lv.sub(0.015), st.y), slat = smoothstep(0.82, 1.0, fract(st.y.mul(16.0))).mul(0.07);
    const shutL = doorC.mul(opn.mul(jamb).mul(mix(float(1.1), float(0.55), st.y.div(lv.max(0.05)))).add(slat.mul(opn.oneMinus()))).mul(K(2));
    const r0 = length(st.sub(0.5)).mul(2.0), lens = lampC.mul(smoothstep(1.0, 0.0, r0).mul(1.6).add(0.4)).mul(lv).mul(K(3));
    const pool = lampC.mul(exp(r0.mul(r0).mul(-6.5))).mul(lv).mul(0.36).mul(K(4));          // (gone to nothing well before its edges, so that it has none)
    const rw = length(st.sub(vec2(0.5, 0.42)).mul(vec2(4.0, 3.6))), wash = lampC.mul(exp(rw.mul(rw).mul(-1.5))).mul(lv).mul(0.24).mul(K(5));
    const dd = select(kd.greaterThan(6.5), st.x, st.x.oneMinus()), acr = abs(st.y.sub(0.5)).mul(2.0);
    const spill = doorC.mul(exp(dd.mul(-5.5))).mul(smoothstep(1.0, 0.25, acr)).mul(lv).mul(0.45).mul(K(6).add(K(7)));
    const lights = doorL.add(shutL).add(lens).add(pool).add(wash).add(spill).mul(U.furn.mul(0.6).add(0.4));
    wallMat.emissiveNode = heatColor(lv.mul(U.furn).mul(flick)).mul(K(0)).add(wins.add(finer).mul(U.furn).mul(winK)).add(FIRE(heatColor(fire.mul(0.5).min(0.62)).mul(fire.min(1.0)).mul(U.furn).mul(0.35)))
      .add(EDGE.mul(max(vg.negate(), 0.0).add(lip.mul(0.35))).mul(0.03)).add(lights);
  }
  // (glow > 0: lit by the fire from inside; glow < 0: an edge that catches a cold light)
  const wb = [], X0 = H.x0, X1 = H.x1, TOPY = H.top, NEAR = H.near, FAR = H.far;
  const LEFT = { x: -2500, n: 5, d: (-2500 - X0) / 5, rise: 0.9 }, RIGHT = { x: 2600, n: 8, d: (X1 - 2600) / 8, rise: 1 };
  const stepTop = (w, k) => TOPY * Math.pow((k + 1) / w.n, w.rise);
  for (let k = 0; k < LEFT.n; k++) { const xf = LEFT.x - LEFT.d * k; wb.push([xf - LEFT.d, xf, 0, stepTop(LEFT, k), FAR, NEAR], [xf - LEFT.d, xf + 3, stepTop(LEFT, k) - 8, stepTop(LEFT, k), FAR, NEAR, -1]); }
  for (let k = 0; k < RIGHT.n; k++) { const xf = RIGHT.x + RIGHT.d * k; wb.push([xf, xf + RIGHT.d, 0, stepTop(RIGHT, k), FAR, NEAR], [xf - 3, xf + RIGHT.d, stepTop(RIGHT, k) - 8, stepTop(RIGHT, k), FAR, NEAR, -1]); }
  // The steps are working terraces: a rail along the edge of every tread at a person's height, tanks and plant set back on it,
  // pipes high along the riser, doors at its foot, now and then a flight of stairs from one tread up to the next. Near the lake
  // only: further off the air hides it, and the steps go on plain. What is lit on them is of several kinds, and lights what is
  // round it (aKind, in the wall material): doors of four sorts, each throwing its light on the floor before it; lamps on
  // poles, each with its pool of light on the tread; lamps on the risers, each with its wash on the wall.
  const ZD = -16000, tanks = [];
  let sd = 4711; const rr = () => (sd = (Math.imul(sd, 1103515245) + 12345) >>> 0) / 4294967296;
  const on = (side, x0, x1) => side > 0 ? [x0, x1] : [-x1, -x0];          // (a span measured out from the face, either side)
  for (const [w, side] of [[LEFT, -1], [RIGHT, 1]]) for (let k = 0; k < w.n; k++) {
    const xf = w.x + side * w.d * k, y0 = k ? stepTop(w, k - 1) : 0, y = stepTop(w, k), rise = y - y0, tread = w.d;
    const span = (a, b) => { const [p, q] = on(side, -b, -a); return [xf + p, xf + q]; };          // a..b in front of the riser (on the tread below)
    const back = (a, b) => { const [p, q] = on(side, a, b); return [xf + p, xf + q]; };            // a..b back from the riser's edge, on this tread
    const yy = y0 + Math.max(rise * 0.72, Math.min(rise - 70, 330));          // (the pipes, above the doors)
    // the rail
    { const [r0, r1] = back(8, 14); wb.push([r0, r1, y + 100, y + 106, ZD, NEAR], [r0, r1, y + 50, y + 54, ZD, NEAR]); for (let z = NEAR; z > ZD; z -= 150) wb.push([r0, r1, y, y + 104, z - 6, z]); }
    // tanks (drawn all at once, below) and plant
    for (let z = NEAR - rr() * 900; z > ZD; z -= 600 + rr() * 900) {
      if (rr() < 0.55) { const r = 60 + rr() * Math.min(130, tread * 0.2), h = 260 + rr() * 480, x = xf + side * (70 + r + rr() * Math.max(0, tread * 0.55 - 2 * r - 70));
        tanks.push([x, y, z - r, r, h]); if (rr() < 0.5) tanks.push([x, y, z - 3.3 * r, r * 0.85, h * (0.6 + rr() * 0.5)]); z -= 3.4 * r; }
      else { const ln = 200 + rr() * 520, hh = 120 + rr() * 300, d0 = 60 + rr() * 50, d1 = Math.min(tread * 0.7, d0 + 60 + ln * 0.3), [a, b] = back(d0, d1);
        wb.push([a, b, y, y + hh, z - ln, z], [a, b, y + hh, y + hh + 12, z - ln + 20, z - 20]); z -= ln; }
    }
    // lamps on poles at the edge of the tread, their arms reaching back over it, of several heights; under each, its pool of light
    for (let z = NEAR - rr() * 600; z > ZD; z -= 1300 + rr() * 1100) {
      const ph = 300 + rr() * 180, reach = Math.min(tread * 0.45, 70 + rr() * 60), [a, b] = back(20, 28), [c, e] = back(20, 24 + reach), [f, g] = back(reach - 4, reach + 30);
      wb.push([a, b, y, y + ph, z - 8, z], [c, e, y + ph - 6, y + ph, z - 7, z - 1], [f, g, y + ph - 16, y + ph - 2, z - 20, z + 12], [f + 3, g - 3, y + ph - 17, y + ph - 16, z - 17, z + 9, 1.3, 3]);
      const pr = Math.min(170, tread * 0.5), [p, q] = back(Math.max(4, reach + 13 - pr), Math.min(tread - 4, reach + 13 + pr));
      wb.push([p, q, y, y + 1.5, z - 4 - pr, z - 4 + pr, 0.9, 4]);
    }
    // lamps on the risers, in cages, each with its wash of light on the wall round it
    for (let z = NEAR - rr() * 900; z > ZD; z -= 1600 + rr() * 1400) {
      const yl = y0 + Math.min(rise * (0.45 + rr() * 0.15), yy - y0 - 40), [a, b] = span(0, 16), [c, e] = span(0, 17), [f, g] = span(0, 1.5);
      wb.push([a, b, yl - 12, yl + 12, z - 10, z + 10], [c, e, yl - 7, yl + 7, z - 6, z + 6, 1.2, 3], [f, g, yl - 110, yl + 150, z - 140, z + 140, 0.8, 5]);
    }
    // pipes along the riser, high, on brackets
    { const [a, b] = span(0, 18); for (let i = 0; i < 2; i++) wb.push([a, b, yy + i * 26, yy + i * 26 + 16, FAR, NEAR]);
      for (let z = NEAR - 300; z > ZD; z -= 600) { const [c, e] = span(0, 24); wb.push([c, e, yy - 8, yy + 60, z - 10, z]); } }
    // doors at the foot of the riser, of four sorts (a single leaf with a lamp over it, a pair, a shutter part open, a deep
    // doorway with someone in it), each throwing its light on the floor before it
    const spill = (z0, z1, wdt, l) => { const [a, b] = span(0, 90 + wdt * 0.45); wb.push([a, b, y0, y0 + 1.5, z0, z1, l, side > 0 ? 6 : 7]); };
    const frame = (z0, z1, h, d = 9) => { const [c, e] = span(0, d); wb.push([c, e, y0, y0 + h + 14, z0 - 14, z0], [c, e, y0, y0 + h + 14, z1, z1 + 14], [c, e, y0 + h, y0 + h + 14, z0 - 14, z1 + 14]); };
    for (let z = NEAR - rr() * 1200; z > ZD; z -= 1300 + rr() * 1300) {
      const t = rr(), room = yy - y0 - 24, l = 0.65 + rr() * 0.45, [a, b] = span(0, 3);
      if (t < 0.4) { const h = Math.min(215, room); wb.push([a, b, y0, y0 + h, z - 100, z, l, 1]); frame(z - 100, z, h); spill(z - 130, z + 30, 100, l * 0.6);
        const [c, e] = span(0, 12), [f, g] = span(0, 13); wb.push([c, e, y0 + h + 30, y0 + h + 42, z - 62, z - 38], [f, g, y0 + h + 33, y0 + h + 39, z - 58, z - 42, 1.0, 3]); }
      else if (t < 0.65) { const h = Math.min(240, room); wb.push([a, b, y0, y0 + h, z - 190, z - 99, l, 1], [a, b, y0, y0 + h, z - 91, z, l * 0.9, 1]); const [c, e] = span(0, 6); wb.push([c, e, y0, y0 + h, z - 99, z - 91]); frame(z - 190, z, h); spill(z - 230, z + 40, 190, l * 0.6); }
      else if (t < 0.9) { const h = Math.min(300, room), wd = 300 + rr() * 80; wb.push([a, b, y0, y0 + h, z - wd, z, 0.15 + rr() * 0.35, 2]); frame(z - wd, z, h, 12); spill(z - wd - 40, z + 40, wd, 0.55); }
      else { const h = Math.min(250, room), [c, e] = span(0, 40); wb.push([a, b, y0, y0 + h, z - 120, z, l * 1.3, 1], [c, e, y0, y0 + h + 30, z - 145, z - 120], [c, e, y0, y0 + h + 30, z, z + 25], [c, e, y0 + h, y0 + h + 30, z - 145, z + 25]); spill(z - 160, z + 40, 120, l * 0.8);
        if (rr() < 0.7) { const [p, q] = span(10, 30), zc = z - 60 + (rr() - 0.5) * 40; wb.push([p, q, y0, y0 + 150, zc - 11, zc + 11], [p, q, y0 + 150, y0 + 172, zc - 8, zc + 8]); } }          // (someone standing in it, against the light)
    }
    // now and then a flight of stairs up the riser, a lamp at its head with its pool
    for (let z = NEAR - 1500 - rr() * 2000; z > ZD + 2500; z -= 4500 + rr() * 2500) {
      const n = Math.max(8, Math.round(rise / 22)), run = n * 26, [a, b] = span(0, 100);
      for (let i = 0; i < n; i++) wb.push([a, b, y0, y0 + rise * (i + 1) / n, z - run * (i + 1) / n, z - run * i / n]);
      const [c, e] = back(14, 20), [f, g] = back(8, 26), [p, q] = back(4, Math.min(tread - 4, 160));
      wb.push([c, e, y, y + 120, z - run - 26, z - run - 20], [f, g, y + 120, y + 128, z - run - 32, z - run - 14], [f + 2, g - 2, y + 119, y + 120, z - run - 30, z - run - 16, 1.1, 3], [p, q, y, y + 1.5, z - run - 120, z - run + 80, 0.7, 4]);
    }
  }
  wb.push([X0, X1, TOPY, TOPY + 120, FAR, NEAR], [X0, X1, 0, TOPY, NEAR, NEAR + 200], [X0, X1, 0, TOPY, FAR - 200, FAR]);          // the roof the pyramids hang from; the near end; the far end
  wb.push([H.centre - 150, H.centre + 150, 0, 1500, FAR + 1, FAR + 3, 0.9]);          // and in the far end, a door, its fire seen from all the way down the hall
  const walls = new THREE.Mesh(boxGeo(wb), wallMat); walls.frustumCulled = false; floorG.add(walls);
  // the tanks on the terraces: one cylinder drawn as many times as there are tanks. Their light is worked out here, not by the
  // lights of the room: dark steel in rings, a little warm from the floor below and cold from above, the fire of a pour on the
  // side that faces it, a cold line at the rim (in 3, the rim hot: they are crucibles)
  {
    const g = new THREE.CylinderGeometry(1, 1, 1, 20, 1, false); g.translate(0, 0.5, 0);
    const m = new THREE.MeshBasicNodeMaterial(), v = positionGeometry.y, up = normalWorld.y.mul(0.5).add(0.5);          // (the cylinder's own height, 0..1: positionLocal has the instance in it)
    const ring = step(0.93, fract(v.mul(4.0).add(0.04))), rim = step(0.975, v).mul(step(normalGeometry.y.abs(), 0.5)), fireT = pourLight(positionWorld, normalWorld, 1100.0);
    const lit = mix(vec3(0.016, 0.011, 0.008), vec3(0.009, 0.011, 0.016), up).mul(IRON).mul(ring.mul(0.7).add(1.0)).mul(h21(positionWorld.xz.div(400.0).floor()).mul(0.3).add(0.85));
    let e = lit.add(FIRE(heatColor(fireT.mul(0.5).min(0.6)).mul(fireT.min(1.0)).mul(U.furn).mul(0.35)));
    e = e.add(EDGE.mul(rim.add(ring.mul(0.25))).mul(0.035));
    m.colorNode = e;
    const im = new THREE.InstancedMesh(g, m, Math.max(tanks.length, 1)), M4 = new THREE.Matrix4(), Q0 = new THREE.Quaternion(), Q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -PI / 2);
    tanks.forEach(([x, y, z, r, h, lying], i) => im.setMatrixAt(i, lying ? M4.compose(new THREE.Vector3(x, y + r, z), Q1, new THREE.Vector3(r, h, r)) : M4.compose(new THREE.Vector3(x, y, z), Q0, new THREE.Vector3(r, h, r))));
    im.count = tanks.length; im.frustumCulled = false; floorG.add(im);
  }

  // ───────── the pyramids. Each is K layers. A layer is a slab whose sides slope inward as they go down (at H.slope from the
  // level, so that the slope is wider than it is high) and whose underside is flat; the next layer hangs under it on rails,
  // smaller than its underside, so that from below it is a slope, a flat, a slope, a flat, down to the point. Every layer
  // slides, the top one on rails under the roof and each other on the one above it: the point goes where the layers together
  // carry it, and when it moves they all move, one after another, the upper first. The point is a head with a mouth,
  // white-hot, from which the metal falls.
  const { K, SL, GAP, MOUTH } = H.layers, PITCH = SL + GAP, RUN = SL / Math.tan(H.slope * PI / 180), HANG = H.hang;
  const dims = (ax, az) => { const d = k0 => (k0 - 110 - RUN) / (K - 1), dx = d(ax), dz = d(az), fx = dx - RUN, fz = dz - RUN;
    return [...Array(K).keys()].map(k => { const tx = ax - k * dx, tz = az - k * dz; return { tx, tz, bx: tx - RUN, bz: tz - RUN, y: HANG - k * PITCH, fx, fz }; }); };
  // one layer as a mesh of its own: its slopes, its underside, small lamps along the edge of its underside (how big it is is
  // shown by them), the rails it carries under it for the next; the last one, the head and its mouth
  const layerGeo = (t, nx, k, seed, big = 1) => {
    const P = [], N = [], G = [], Pt = [];
    const quad = (a, b, c, d, n, g = 0, pt = 0) => { const cr = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0, v = flip ? [a, d, c, b] : [a, b, c, d];
      for (const i of [0, 1, 2, 0, 2, 3]) { P.push(...v[i]); N.push(...n); G.push(g); Pt.push(pt); } };
    const box = (x0, x1, y0, y1, z0, z1, g = 0) => { quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], g);
      quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], g); quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], g);
      quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], g); quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], g); };
    const { tx, tz, bx, bz, y } = t, yb = y - SL, nl = Math.hypot(SL, RUN), ns = SL / nl, nd = RUN / nl;
    const top = [[-tx, y, -tz], [tx, y, -tz], [tx, y, tz], [-tx, y, tz]], bot = [[-bx, yb, -bz], [bx, yb, -bz], [bx, yb, bz], [-bx, yb, bz]];
    const nrm = [[0, -nd, -ns], [ns, -nd, 0], [0, -nd, ns], [-ns, -nd, 0]];          // (each slope faces out and down)
    const near = big < 1.9;          // (the first pyramid and the next: further off, what stands on the slopes would be finer than a pixel)
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(top[i], top[j], bot[j], bot[i], nrm[i], 0, near ? 0 : -1); }
    quad(bot[0], bot[1], bot[2], bot[3], [0, -1, 0]);
    // What stands on the slopes. A slope is u along its edge from its middle, and v down it (0 at its top, 1 at its foot); things
    // stand out of it along its normal. Part codes for the material: 1 members, 2 pipes.
    if (near) {
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
      const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], unit = a => mul(a, 1 / Math.hypot(...a)), dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      // a block on the slope: its foot the points a, b, c, d (in order round it), each raised by its own height along n
      const block = (a, b, c, d, n, h, g = 0, pt = 1) => { const hs = Array.isArray(h) ? h : [h, h, h, h], F = [a, b, c, d], T2 = F.map((p, m) => add(p, mul(n, hs[m]))), mid = mul(F.reduce(add), 0.25);
        let on = unit(crs(sub(T2[1], T2[0]), sub(T2[3], T2[0]))); if (dt(on, n) < 0) on = mul(on, -1); quad(T2[0], T2[1], T2[2], T2[3], on, g, pt);
        for (let m = 0; m < 4; m++) { const p0 = F[m], p1 = F[(m + 1) % 4]; let sn = unit(crs(sub(p1, p0), n)); if (dt(sn, sub(mul(add(p0, p1), 0.5), mid)) < 0) sn = mul(sn, -1); quad(p0, p1, T2[(m + 1) % 4], T2[m], sn, g, pt); } };
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4, n = nrm[i], e = unit(sub(top[j], top[i])), mt = mul(add(top[i], top[j]), 0.5), mb = mul(add(bot[i], bot[j]), 0.5), h0 = Math.hypot(...sub(top[j], top[i])) / 2, h1 = Math.hypot(...sub(bot[j], bot[i])) / 2;
        const S = (u, v) => add(add(mt, mul(sub(mb, mt), v)), mul(e, u)), half = v => h0 + (h1 - h0) * v;
        const across = (v0, v1, h, g = 0, pt = 1, inset = 0) => block(S(-half(v0) + inset, v0), S(half(v0) - inset, v0), S(half(v1) - inset, v1), S(-half(v1) + inset, v1), n, h, g, pt);          // a strip across the slope, its ends on the hips
        const down = (u, w, v0, v1, h, g = 0, pt = 1) => { const au = Math.abs(u) + w / 2, ve = au > h1 ? Math.min(v1, (h0 - au) / (h0 - h1)) : v1; if (ve - v0 < 0.06) return;          // a member down the slope (cut where it meets the hip)
          block(S(u - w / 2, v0), S(u + w / 2, v0), S(u + w / 2, ve), S(u - w / 2, ve), n, h, g, pt); };
        const each = (sp, off, f) => { for (let u = -Math.floor(h0 / sp) * sp + off; u <= h0; u += sp) f(u, Math.round((u - off) / sp)); };
        // three pipes across the slope on brackets, a cable tray lower down with lamps under its edge, and now and then a pipe
        // coming down to them from the top
        for (const [v, w] of [[0.26, 0.045], [0.34, 0.045], [0.42, 0.06]]) across(v, v + w, 16, 0, 2, 30);
        each(420, 0, u => down(u, 10, 0.22, 0.5, 24)); across(0.66, 0.76, 9, 0, 1, 40);
        each(900, 450, u => { if (Math.abs(u) + 20 < half(0.78)) block(S(u - 14, 0.765), S(u + 14, 0.765), S(u + 14, 0.79), S(u - 14, 0.79), n, 5, 1.0, 0); });
        each(2000, 1000, u => down(u, 16, 0.0, 0.27, 16, 0, 2));
      }
    }
    let sd = seed; const rr = () => (sd = (Math.imul(sd, 1103515245) + 12345) >>> 0) / 4294967296;
    const lampRow = (ax, az, bx2, bz2) => { const L = Math.hypot(bx2 - ax, bz2 - az), n2 = Math.floor(L / 150);
      for (let i = 1; i < n2; i++) { if (rr() < 0.28) continue; const u = i / n2, x = ax + (bx2 - ax) * u, z = az + (bz2 - az) * u, w = 9 * big, d = 5 * big;
        quad([x - w, yb - 1.5, z - d], [x + w, yb - 1.5, z - d], [x + w, yb - 1.5, z + d], [x - w, yb - 1.5, z + d], [0, -1, 0], Math.min(1.45, (0.7 + 0.3 * rr()) * (0.6 + 0.4 * big))); } };
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4, a = bot[i], b = bot[j], ix = Math.sign(-a[0]) * 14, iz = Math.sign(-a[2]) * 14, jx = Math.sign(-b[0]) * 14, jz = Math.sign(-b[2]) * 14;          // the edge where the slope turns flat
      quad([a[0], yb - 1, a[2]], [b[0], yb - 1, b[2]], [b[0] + jx, yb - 1, b[2] + jz], [a[0] + ix, yb - 1, a[2] + iz], [0, -1, 0], -1); }
    if (k < K - 1) {
      const i0 = 46; lampRow(-bx + i0, -bz + i0, bx - i0, -bz + i0); lampRow(-bx + i0, bz - i0, bx - i0, bz - i0); lampRow(-bx + i0, -bz + i0, -bx + i0, bz - i0); lampRow(bx - i0, -bz + i0, bx - i0, bz - i0);
      if (nx) for (const sz of [-1, 1]) box(-bx + 30, bx - 30, yb - GAP, yb, sz * nx.tz * 0.55 - 18, sz * nx.tz * 0.55 + 18);          // the rails the next layer runs on
    } else {
      box(-55, 55, yb - MOUTH, yb, -55, 55);          // the head
      quad([-30, yb - MOUTH - 1, -30], [30, yb - MOUTH - 1, -30], [30, yb - MOUTH - 1, 30], [-30, yb - MOUTH - 1, 30], [0, -1, 0], 2);          // its mouth
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('aGlow', new THREE.Float32BufferAttribute(G, 1)); g.setAttribute('aPart', new THREE.Float32BufferAttribute(Pt, 1));
    g.computeBoundingSphere(); return g;
  };
  // Dark plated iron. The plates go with the layer (they are laid out where the layer is, not where it hangs); their joints are
  // dark lines; the lamps along the edges of the undersides are small and warm; the mouth of the head is white-hot while it
  // pours and dull red while it does not; and the fire of the pours lights the undersides from below.
  const layerMat = new THREE.MeshStandardNodeMaterial({ metalness: 0.7, roughness: 0.5 });
  const heatU = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object.userData.heat);          // (how hot the head's mouth is)
  {
    const vg = varying(attribute('aGlow', 'float')), q = positionLocal, pc = floor(q.xz.div(vec2(310.0, 230.0))), ph = h21(pc.add(11.0)), fq = fract(q.xz.div(vec2(310.0, 230.0)));
    const seam = max(smoothstep(0.03, 0.0, min(fq.x, fq.y)), smoothstep(0.97, 1.0, max(fq.x, fq.y))).mul(smoothstep(4.0, 1.0, fwidth(q.x)));
    const grain = fbm(vec3(q.xz.mul(0.006), 7.0));
    const fire = pourLight(positionWorld, normalWorld, 1700.0), lampOn = step(0.5, vg).mul(step(vg, 1.5)), mouth = step(1.5, vg);
    const near = mouthLight(positionWorld, normalWorld);
    // The slopes. Their own plates: in the shade of the flat above toward their top, and of the members where they stand on
    // them; in three courses, each bay a shade of its own. The members dark steel, the pipes a little brighter and smoother.
    // (On the far pyramids the slopes are bare: part -1, and no shade of members that are not there.)
    const part = varying(attribute('aPart', 'float')), det = step(-0.5, part);
    const ny = normalLocal.y.negate(), sl = smoothstep(0.97, 0.9, ny).mul(smoothstep(0.3, 0.5, ny)).mul(step(vg.abs(), 0.1));
    const plate = sl.mul(step(part, 0.5)), strc = step(0.5, part).mul(step(part, 1.5)), pipe = step(1.5, part);
    const runL = select(abs(normalLocal.x).greaterThan(0.3), q.z, q.x), lu = fract(float(HANG).sub(q.y).div(PITCH)).div(SL / PITCH).clamp(0.0, 1.0), kL = floor(float(HANG).sub(q.y).div(PITCH));
    const aa = v => smoothstep(0.35, 0.08, fwidth(v)), base = vec3(0.023, 0.024, 0.028).mul(grain.mul(0.4).add(0.8)), cold = EDGE.mul(0.019);
    const rp = runL.div(400.0), ao = smoothstep(0.0, 0.4, lu).mul(0.5).add(0.5).mul(mix(float(1.0), smoothstep(0.2, 0.26, lu).add(smoothstep(0.54, 0.48, lu)).min(1.0).mul(0.3).add(0.7), det));          // (and under the pipes)
    const tone = h21(vec2(floor(rp), floor(lu.mul(3.0)).add(kL.mul(7.0)))).mul(0.3).add(0.85);
    const cj = fract(lu.mul(3.0)), cjl = smoothstep(0.04, 0.0, min(cj, cj.oneMinus())).mul(aa(lu.mul(3.0)));
    const pT = ao.mul(tone).mul(cjl.mul(-0.35).add(1.0));
    const flatC = vec3(0.020, 0.021, 0.025).mul(ph.mul(0.5).add(0.75)).mul(grain.mul(0.4).add(0.8)).mul(seam.mul(-0.55).add(1.0));
    const strcC = vec3(0.017, 0.018, 0.021).mul(h21(vec2(floor(runL.div(97.0)), kL)).mul(0.25).add(0.88)), pipeC = vec3(0.03, 0.029, 0.028);
    layerMat.colorNode = mix(mix(mix(flatC, base.mul(pT), plate), strcC, strc), pipeC, pipe).mul(IRON);
    layerMat.roughnessNode = mix(mix(ph.mul(0.2).add(0.42), float(0.6), strc), float(0.45), pipe); layerMat.metalnessNode = mix(float(0.7), float(0.35), strc.add(pipe).min(1.0));          // (the members and pipes less like mirrors: as metal they gave back a sky the hall does not have)
    layerMat.emissiveNode = FIRE(heatColor(fire.mul(0.3).min(0.52)).mul(fire.min(1.4)).mul(0.4).mul(U.furn).add(vec3(1.0, 0.42, 0.13).mul(fire.mul(0.04).add(near.mul(0.15))).mul(U.furn)))
      .add(LAMP.mul(lampOn.mul(vg).mul(1.6)).mul(U.furn.mul(0.6).add(0.4)))
      .add(mix(EDGE.mul(0.82), heatColor(float(0.5)), fire.min(1.0)).mul(max(vg.negate(), 0.0)).mul(smoothstep(3000.0, 16000.0, length(cameraPosition.sub(positionWorld))).mul(0.3).add(0.09)))          // the edges where a slope turns flat: a thin line of light (brighter far off, so the far ones still read)
      .add(cold.mul(pT).mul(plate))          // the plates a shade lighter than the flats
      .add(cold.mul(0.55).mul(strc.add(pipe)))          // the members and pipes in the same cold light, a little less
      .add(heatColor(float(0.36)).mul(mouth).mul(0.5))
      .add(heatColor(heatU.x.mul(0.5).add(0.42)).mul(mouth).mul(heatU.x.mul(2.0).add(0.3)));
  }
  // a pyramid: its layers, where its base is centred, the sizes of its base
  const pyramid = (cx, cz, ax, az, seed) => {
    const dm = dims(ax, az), group = new THREE.Group(); group.position.set(cx, 0, cz); floorG.add(group);
    const layers = dm.map((t, k) => { const m = new THREE.Mesh(layerGeo(t, dm[k + 1], k, seed * 31 + k * 7, Math.min(2.2, 1 + Math.abs(cz - H.main[0]) / 9000)), layerMat); m.userData.heat = new THREE.Vector4(); m.frustumCulled = false; group.add(m); return m; });
    // how far each layer can slide, either way (its rails end there): the top one as far as the room round it under the roof
    // allows, each other one most of the width of the flat of the layer above
    const reach = dm.map((t, k) => k === 0 ? [Math.max((X1 - X0) / 2 - ax - 20, 0), 240] : [Math.max(dm[k - 1].fx - 50, 0), Math.max(dm[k - 1].fz - 50, 0)]);
    for (const sz of [-1, 1]) wb2.push([X0, X1, HANG, TOPY, cz + sz * az * 0.55 - 26, cz + sz * az * 0.55 + 26]);          // the rails under the roof the top layer runs on
    const lag = 0.16, span = 1 + lag * (K - 1);
    return { cx, cz, dm, layers, reach, at: [cx, cz], tipY: HANG - (K - 1) * PITCH - SL - MOUTH,
      // put the point at (x, z) in the world, the layers moving one after another, the top one first (u: how far through the move, 0..1)
      place(fx, fz, tx, tz, u) {
        let ox = 0, oz = 0;
        for (let k = 0; k < K; k++) { const e = u >= 1 ? 1 : (w => w * w * (3 - 2 * w))(Math.min(Math.max(u * span - k * lag, 0), 1));
          const sx = ((fx + (tx - fx) * e) - cx) / K, sz = ((fz + (tz - fz) * e) - cz) / K;          // each layer takes its share of the way
          ox += Math.max(-reach[k][0], Math.min(reach[k][0], sx)); oz += Math.max(-reach[k][1], Math.min(reach[k][1], sz)); layers[k].position.set(ox, 0, oz); }
        this.at = [cx + ox, cz + oz]; return this.at; } };
  };
  const wb2 = [];
  const MAINP = pyramid(H.centre, H.main[0], H.half, H.main[1], 3);
  const ROW = H.row.map(([z, az], i) => pyramid(H.centre, z, H.half, az, 11 + i));
  const TIPY = MAINP.tipY;
  { const rails = new THREE.Mesh(boxGeo(wb2), wallMat); rails.frustumCulled = false; floorG.add(rails); }

  // ───────── the falling metal: one line for each pyramid, from the mouth down to what it falls on. It is drawn only between
  // its head (the front of what falls, going down faster and faster) and its tail (where it is still coming from the mouth,
  // or the last of it falling after the mouth has shut); white in the middle, orange at its edges, running down.
  const fallU = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object.userData.fall);          // (head, tail, how strongly, its seed)
  const fallMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  fallMat.colorNode = Fn(() => {
    const y = positionWorld.y.add(U.lift);
    If(y.lessThan(fallU.x).or(y.greaterThan(fallU.y)), () => { Discard(); });
    const v = normalize(cameraPosition.sub(positionWorld)), core = pow(abs(dot(normalize(normalWorld), v)), 1.6);
    const flow = fbm(vec3(positionWorld.x.mul(0.06), y.mul(0.012).add(U.time.mul(2.6)).add(fallU.w), 3.0)), nearHead = smoothstep(0.0, 60.0, y.sub(fallU.x)).oneMinus();
    const T = core.mul(0.46).add(flow.mul(0.2)).add(0.32).add(nearHead.mul(0.12));
    return vec4(heatColor(T).mul(fallU.z).mul(core.mul(0.8).add(0.2)), 1.0); })();
  const fallGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 24, true); fallGeo.translate(0, -0.5, 0);
  const falls = [MAINP, ...ROW].map((p, i) => { const m = new THREE.Mesh(fallGeo, fallMat); m.userData.fall = new THREE.Vector4(0, 0, 0, i * 13.7); m.frustumCulled = false; m.renderOrder = 2; floorG.add(m); return m; });

  // ───────── the bridge: out from the right wall toward where the first pyramid pours, deep at its root and thinning toward its
  // end, strata along its side, a parapet, a lamp under its end. It does not move.
  {
    const R0 = [RIGHT.x + RIGHT.d * 2, -1500], R1 = [H.rest[0] + 240, H.rest[1] - 280], YD = H.bridge, DR = 380, DT = 80, HW = 70;
    const dx = R1[0] - R0[0], dz = R1[1] - R0[1], L = Math.hypot(dx, dz), ux = dz / L, uz = -dx / L;          // across it, toward the eye
    const P = [], N = [], G = [];
    const quad = (a, b, c, d, n, g = 0) => { for (const v of [a, b, c, a, c, d]) { P.push(...v); N.push(...n); G.push(g); } };
    const at = (t, side, y) => [R0[0] + dx * t + ux * HW * side, y, R0[1] + dz * t + uz * HW * side];
    const bot = t => YD - DR + (DR - DT) * t;          // its underside, rising toward its end
    const nS = [ux, 0, uz];
    quad(at(0, 1, YD), at(1, 1, YD), at(1, 1, bot(1)), at(0, 1, bot(0)), nS);                                     // its side toward us
    quad(at(0, -1, YD), at(0, -1, bot(0)), at(1, -1, bot(1)), at(1, -1, YD), [-ux, 0, -uz]);                     // the far side
    quad(at(0, 1, bot(0)), at(1, 1, bot(1)), at(1, -1, bot(1)), at(0, -1, bot(0)), [0, -1, 0]);                   // its underside
    quad(at(1, 1, YD), at(1, -1, YD), at(1, -1, bot(1)), at(1, 1, bot(1)), [dx / L, 0, dz / L]);                  // its end
    quad(at(0, 1, YD), at(0, -1, YD), at(1, -1, YD), at(1, 1, YD), [0, 1, 0]);                                     // its deck
    for (let y = YD - 24; y > YD - DR; y -= 24) { const tm = Math.min(1, (y - (YD - DR)) / (DR - DT));          // strata along its side, each ending where the underside meets it
      quad(at(0, 1.01, y), at(tm, 1.01, y), at(tm, 1.01, y + 2.2), at(0, 1.01, y + 2.2), nS, -0.6); }
    quad(at(0, 1.02, YD + 34), at(1, 1.02, YD + 34), at(1, 1.02, YD + 40), at(0, 1.02, YD + 40), nS, 0); quad(at(0, 1.02, YD), at(1, 1.02, YD), at(1, 1.02, YD + 6), at(0, 1.02, YD + 6), nS, 0);          // its parapet
    for (let t = 0.06; t < 1; t += 0.08) quad(at(t, 1.02, YD), at(t + 0.004, 1.02, YD), at(t + 0.004, 1.02, YD + 36), at(t, 1.02, YD + 36), nS, 0);
    { const c = at(0.97, 0, bot(0.97) - 2); quad([c[0] - 10, c[1], c[2] - 6], [c[0] + 10, c[1], c[2] - 6], [c[0] + 10, c[1], c[2] + 6], [c[0] - 10, c[1], c[2] + 6], [0, -1, 0], 0.9); }          // the lamp under its end
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('aGlow', new THREE.Float32BufferAttribute(G, 1)); g.computeBoundingSphere();
    const bm = new THREE.MeshStandardNodeMaterial({ metalness: 0.2, roughness: 0.8 });
    const vgB = varying(attribute('aGlow', 'float')), fireB = pourLight(positionWorld, normalWorld, 900.0);
    bm.colorNode = vec3(0.009, 0.009, 0.010).mul(IRON).mul(fbm(vec3(positionWorld.mul(0.01))).mul(0.5).add(0.75)).mul(step(-0.3, vgB).mul(0.6).add(0.4)); bm.roughnessNode = float(0.86);
    bm.emissiveNode = FIRE(heatColor(fireB.mul(0.4).min(0.58)).mul(fireB.min(1.0)).mul(0.5).mul(U.furn)).add(LAMP.mul(step(0.5, vgB)).mul(1.2));
    const bridge = new THREE.Mesh(g, bm); bridge.frustumCulled = false; floorG.add(bridge);
  }

  // the fire of the first pour lights the lake and whatever stands on it, from where it falls
  const pourL = new THREE.PointLight(0xffffff, 0, 1600, 2);          // (as light does, and no further than 1600: under the pour, and at the strike the chip; not the chip in the middle of the lake, nor the water before the lens, where it made a glare)
  { const c = [1.0, 0.52, 0.2], l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; pourL.color.setRGB(...c.map(v => (l + (v - l) * PAL.fireSat) * PAL.fireK)); } floorG.add(pourL);
  const under = new THREE.HemisphereLight(0x000000, 0x000000, 1); under.color.setRGB(...PAL.hemi); under.groundColor.setRGB(0.22, 0.11, 0.05); scene.add(under);
  const heartL = new THREE.DirectionalLight(0xffffff, 0); heartL.color.setRGB(1.0, 0.50, 0.18); scene.add(heartL, heartL.target);

  // ───────── the heat of the chip itself lights what is round it; the strike of the metal, for a moment, much more
  // (it falls off with distance, as light does: it lights the anvil as it did, but on the water further off, which mirrors it,
  // it no longer makes a glare)
  const glow = new THREE.PointLight(0xffffff, 0, 1500, 2); glow.color.setRGB(1.0, 0.45, 0.14); mem.add(glow); glow.position.set(0, 60, 0);

  // ───────── the anvil in the lake, the steam
  const plinth = new THREE.Mesh(boxGeo([[-215, 215, -260, -0.6, -176, 176], [-262, 262, -260, -26, -216, 216], [-205, 205, -0.6, 0.5, 150, 162, 0.5], [-205, 205, -0.6, 0.5, -162, -150, 0.5], ...both([-205, -193, -0.6, 0.5, -150, 150, 0.5])]), wallMat);
  mem.add(plinth);
  // steam: soft sprites that rise off the water, widen and thin out. Round the chip as it is quenched; and always, a little,
  // where the line of metal from the first pyramid meets the lake.
  const mist = (n, x, z, R, rise, size, amount, warm) => {
    const a = new Float32Array(n * 4); for (let i = 0; i < n; i++) a.set([rnd(i, 21 + x) * 6.283, Math.sqrt(rnd(i, 22 + x)) * R, rnd(i, 23 + x), 0.6 + 0.8 * rnd(i, 24 + x)], i * 4);
    const A = instancedBufferAttribute(new THREE.InstancedBufferAttribute(a, 4)), age = fract(U.time.mul(A.w.mul(0.16)).add(A.z));
    const sm = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const sway = vec2(sin(U.time.mul(0.3).add(A.z.mul(20.0))), cos(U.time.mul(0.23).add(A.z.mul(31.0)))).mul(age).mul(R * 0.3);
    sm.positionNode = vec3(cos(A.x).mul(A.y).mul(age.mul(0.5).add(1.0)).add(sway.x).add(x), U.lift.negate().add(age.mul(rise)).add(4.0), sin(A.x).mul(A.y).mul(age.mul(0.5).add(1.0)).add(sway.y).add(z));
    sm.scaleNode = age.mul(size).add(size / 6).mul(A.w);
    const va = varying(amount.mul(pow(age.oneMinus(), 1.4)).mul(smoothstep(0.0, 0.07, age)).mul(0.22)), vAge = varying(age);
    sm.colorNode = Fn(() => { const d = length(uv().sub(0.5)).mul(2.0), I = smoothstep(1.0, 0.0, d);
      return vec4(mix(heatColor(warm).mul(0.6).add(vec3(0.16, 0.10, 0.07)), vec3(0.20, 0.27, 0.38), smoothstep(0.0, 0.3, vAge)).mul(I.mul(I)), 1.0); })();
    sm.opacityNode = va;
    const sp = new THREE.Sprite(sm); sp.count = n; sp.frustumCulled = false; scene.add(sp); return sp;
  };
  const steam = mist(small ? 110 : 260, 0, 0, 210, 520, 300, U.steam, U.subGlow.mul(0.5).add(0.3));
  const lineFlow = uniform(0);
  const spill = mist(small ? 30 : 70, H.rest[0], H.rest[1], 150, 700, 520, U.furn.mul(0.8).mul(lineFlow), float(0.5));

  // ───────── the far pyramids at work, each in its own time, whether or not the page is being scrolled. The point moves on
  // every few seconds to somewhere new (the layers one after another), and every eight to twelve seconds, at the end of a move,
  // it stays and pours: a move or two, a pour, a move or two. Where it goes next is chosen afresh each time, round the middle
  // of the hall.
  const CYCLE = [8, 10.5, 9, 12, 11], MOVE = 2.8, POUR = [0.3, 1.0, 3.2, 4.0], PAUSE = 0.5;          // (s) each one's time from pour to pour; a move takes MOVE; after the last move of a cycle the head falls from POUR[0] to POUR[1], it pours till POUR[2], the tail falls by POUR[3], and it rests PAUSE
  const spot = (i, n) => [H.centre + (rnd(n + 50, 70 + i) - 0.5) * 1800, H.row[i][0] + (rnd(n + 50, 90 + i) - 0.5) * 1100];
  const fallOf = (p, u0, u1, u) => { const e = Math.min(Math.max((u - u0) / (u1 - u0), 0), 1); return p.tipY - (p.tipY + 30) * e * e; };          // faster and faster
  function work(p, i, time) {
    const C = CYCLE[i % CYCLE.length], E = C >= 10 ? 2 : 1, S = (C - POUR[3] - PAUSE) / E;          // (how many moves to a cycle, and how long each takes with the stillness after it)
    const t = time + i * 3.7 + 2, c = Math.floor(t / C), u = t - c * C, j = Math.min(Math.floor(u / S), E - 1), v = u - j * S, n = c * E + j, a = spot(i, n - 1), b = spot(i, n);
    const at = p.place(a[0], a[1], b[0], b[1], Math.min(v / MOVE, 1));
    const w = j === E - 1 ? v - MOVE : -1, on = w > POUR[0] && w < POUR[3];          // (the last move of each cycle is followed by the pour)
    return { at, head: on ? fallOf(p, POUR[0], POUR[1], w) : p.tipY, tail: w > POUR[2] ? fallOf(p, POUR[2], POUR[3], w) : p.tipY, I: on ? 1 : 0, hot: on ? 1 : w > POUR[3] ? Math.max(0, 1 - (w - POUR[3]) / 1.5) : 0 };
  }
  const setFall = (m, p, x, z, head, tail, I, w, lift) => { m.visible = I > 0.002; if (!m.visible) return;
    m.position.set(x, p.tipY, z); m.scale.set(w, p.tipY + 30, w); m.userData.fall.set(head, tail, I, m.userData.fall.w); };
  const last = { work: [] };

  return {
    // something touches the water at (x, z), as hard as amp: waves run out from there
    ring(x, z, amp) { water.poke(x, z, amp); },
    rings: () => water.recent(),
    // each frame, before the picture is drawn: the water moves on (dt: the time since the last frame)
    flow(dt, s) { water.flow(dt, s); },
    // kick: what is left, in real time, of the last blow (0..1); time: seconds since the page began
    update(s, kick = 0, time = 0) {
      // the first pyramid: its point where the film puts it; its line, thin and steady into the lake while the lake is water,
      // or the one heavy fall that strikes the chip
      const [mx, mz] = MAINP.place(s.mFrom[0], s.mFrom[1], s.mTo[0], s.mTo[1], s.mU), line = (s.mFlow ?? 1) * s.water * Math.min(s.furn / 0.8, 1), burst = s.mBurst || 0;
      lineFlow.value = line;
      if (burst > 0) setFall(falls[0], MAINP, mx, mz, s.mHead, s.mTail, 0.85 * burst, 14, s.lift);
      else setFall(falls[0], MAINP, mx, mz, -30, TIPY, 0.9 * line, 6.5, s.lift);
      const mainI = burst > 0 ? 2.4 * burst : 0.9 * line;
      POURS.array[0].set(mx, mz, TIPY - s.lift, mainI * (s.furn > 0.05 ? 1 : 0));
      MAINP.layers[K - 1].userData.heat.x = Math.max(line * 0.6, burst); MOUTHS.array[0].set(mx, mz, TIPY - s.lift, 0.55 + 0.8 * burst);
      pourL.position.set(mx, 420, mz); pourL.intensity = (850 * 420 * line + 1100 * 160 * burst) * s.furn; under.intensity = 0.55 * s.furn * (0.4 + 0.6 * s.hl + 0.3 * line);
      heartL.intensity = s.furn * 0.5 * s.hl; heartL.position.set(mx, 1400 - s.lift, mz - 600); heartL.target.position.set(0, -s.lift, 0); heartL.target.updateMatrixWorld();
      // the far ones, in their own time
      ROW.forEach((p, i) => { const w = work(p, i, time); last.work[i] = w;
        setFall(falls[i + 1], p, w.at[0], w.at[1], w.head, w.tail, 1.1 * w.I * s.furn, 10, s.lift);
        POURS.array[i + 1].set(w.at[0], w.at[1], p.tipY - s.lift, w.I * 1.6 * s.furn);
        p.layers[K - 1].userData.heat.x = Math.max(w.hot, 0.5); MOUTHS.array[i + 1].set(w.at[0], w.at[1], p.tipY - s.lift, 4.0 + 2.0 * w.hot); });
      glow.intensity = s.obj > 0.5 ? (s.heat * 4.5 + Math.max(s.flash, kick) * 6) * 4900 : 0;          // (as bright as it was 70 away, on the chip; much less on the anvil's faces and the water beyond, where it made a hard glint)
      plinth.visible = s.plinth > 0.5;
      steam.visible = s.steam > 0.01; spill.visible = line > 0.05;
    },
    // where the first pyramid's point is now, and the height of its mouth (for what is drawn round the strike)
    tip: () => [MAINP.at[0], TIPY, MAINP.at[1]],
    // the light that hangs in the air: columns of it, each (x, z, radius, sharpness, colour, the height it fades over)
    columns(add, s) {
      const kc = C.KEYCOL.map(v => v * s.keyI), warm = (t, k) => js.heat(t).map(v => v * k);
      add(C.WC[0], C.WC[1] + 500, C.WR * 0.8, 2.4, kc.map(v => v * 0.000011 * s.shaft * s.own), 5200);
      if (s.beamI > 0) add(0, 0, s.beamR, 3.0, kc.map(v => v * 0.00002 * s.beamI), 5200);
      if (s.waferHeat > 0) add(C.WC[0], C.WC[1], C.WR * 0.9, 2.4, warm(0.45 + 0.25 * s.waferHeat, 0.000022 * s.waferHeat), 520);
      const line = (s.mFlow ?? 1) * s.water * s.furn, burst = s.mBurst || 0;
      add(MAINP.at[0], MAINP.at[1], 300, 2.2, warm(0.6, 0.000007 * line + 0.00003 * burst), 1500);          // the air round the first line, lit by it
      ROW.forEach((p, i) => { const w = last.work[i]; if (!w) return; if (w.I > 0) add(w.at[0], w.at[1], 340, 2.2, warm(0.58, 0.000009 * s.furn), 1700);
        add(w.at[0], w.at[1], 1300, 1.6, warm(0.5, 0.0000075 * s.furn * (0.6 + 0.4 * w.hot)), 2600); });          // and under each far one the warm air of its work, against which it stands dark
      add(H.centre, FAR + 1400, 2600, 1.6, warm(0.55, 0.000022 * s.furn), 4200);          // the far door, breathing into the end of the hall
      if (s.steam > 0.01) add(0, 0, 240, 2.2, warm(0.45 + 0.3 * s.heat, 0.00005 * s.steam * (0.3 + s.heat)), 260);
    },
  };
}
