// Shading functions shared by the live scene (stage.js), written in TSL so that they compile to WGSL for WebGPU
// and to GLSL for WebGL 2. They are the same functions as the path tracer's (renderer/web/pt2.js), so the colours of
// heat, the noise of the wafer and the sky match the baked concept frames.
import * as THREE from '../vendor/three.js';
import { HK, hash2 } from './hash.js';

const { Fn, float, int, uint, vec2, vec3, vec4, mix, smoothstep, clamp, max, min, abs, exp, pow, fract, floor, length, dot, normalize, sqrt, sin, cos, atan, mx_noise_vec3 } = THREE.TSL;

// The palette of the hall, by role: a warm one, of sand and earth, the air a dust lit by the fire. Each colour is put as a
// tint on the colours the scene was tuned in, so that how bright things are stays as it was and only their colour moves.
//   iron   the dark metal of walls, pyramids, tanks and floor (ironK: how much lighter)     air  the haze and the fog (airK)
//   edge   the thin lines of light: where a slope turns flat, the lips of the steps          lamp the lamps that people work by
//   door   the light inside the doors                 shadow, high  the colour of the darks and of the lights in the grade
//   hemi   what the hall's air gives from above       fireK, fireSat  how much the fire of the pours colours the surfaces, and
//   how fully      sat  the colour of the whole picture      haze  how thick the far air is
export const PAL = { iron: [1.52, 0.95, 0.40], ironK: 1.5, air: [1.78, 0.96, 0.29], airK: 1.6, edge: [0.79, 0.69, 0.60], lamp: [0.96, 0.79, 0.53], door: [1.0, 0.84, 0.6],
  shadow: [1.16, 0.98, 0.77], high: [1.15, 0.98, 0.77], hemi: [0.10, 0.07, 0.04], fireK: 1.0, fireSat: 0.72, sat: 0.9, haze: 1.4 };

export const C = {
  COLD: [0.34, 0.60, 1.0],             // the colour of voltage and of the light that writes
  WC: [0, -300], WR: 2100,              // the lake, which is the wafer: centre (x, z) and radius
  KEYDIR: [-0.30, 0.90, 0.32], KEYCOL: [0.5, 0.7, 1.0], BOX: [0.16, 0.25, 0.45], BOXDIR: [0.2, 0.75, 0.6], BACKDIR: [0.1, -1],
  FOGH: 60, FOGCOL: [0.012, 0.022, 0.045], SKY: [0.004, 0.007, 0.014], POOL: 2600,
};

// hashes (the same arithmetic as hash.js, which runs on the CPU) and value noise
const mix32 = Fn(([x0]) => {
  const x = x0.toVar();
  x.assign(x.bitXor(x.shiftRight(uint(16)))); x.assign(x.mul(uint(HK.m1)));
  x.assign(x.bitXor(x.shiftRight(uint(15)))); x.assign(x.mul(uint(HK.m2)));
  return x.bitXor(x.shiftRight(uint(16)));
}).setLayout({ name: 'mix32', type: 'uint', inputs: [{ name: 'x', type: 'uint' }] });
const q8 = v => uint(int(floor(v.mul(256.0).add(0.5))));
const unit = h => float(h.shiftRight(uint(8))).mul(1.0 / 16777216.0);
export const h21 = Fn(([p]) => unit(mix32(q8(p.x).mul(uint(HK.a)).bitXor(q8(p.y).mul(uint(HK.b))))))
  .setLayout({ name: 'h21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
export const h31 = Fn(([p]) => unit(mix32(q8(p.x).mul(uint(HK.a)).bitXor(q8(p.y).mul(uint(HK.b))).bitXor(q8(p.z).mul(uint(HK.c))))))
  .setLayout({ name: 'h31', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });
export const vn = Fn(([p]) => {
  const i = floor(p).toVar(), f0 = fract(p), f = f0.mul(f0).mul(f0.mul(-2.0).add(3.0)).toVar();
  const a = mix(mix(h31(i), h31(i.add(vec3(1, 0, 0))), f.x), mix(h31(i.add(vec3(0, 1, 0))), h31(i.add(vec3(1, 1, 0))), f.x), f.y);
  const b = mix(mix(h31(i.add(vec3(0, 0, 1))), h31(i.add(vec3(1, 0, 1))), f.x), mix(h31(i.add(vec3(0, 1, 1))), h31(i.add(vec3(1, 1, 1))), f.x), f.y);
  return mix(a, b, f.z);
}).setLayout({ name: 'vn', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });
export const fbm = Fn(([p0]) => {
  const p = vec3(p0).toVar(), s = float(0).toVar();
  let a = 0.5;
  for (let i = 0; i < 4; i++) { s.addAssign(vn(p).mul(a)); p.assign(p.mul(2.03).add(vec3(7.1, 3.3, 5.7))); a *= 0.5; }
  return s;
}).setLayout({ name: 'fbm', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

// the colour of hot metal, 0 cold .. 1 white; bright enough above 0.7 to bloom
export const heatColor = Fn(([t0]) => {
  const t = clamp(t0, 0.0, 1.0).toVar();
  const c = mix(vec3(0.0), vec3(0.20, 0.008, 0.003), smoothstep(0.02, 0.25, t)).toVar();
  c.assign(mix(c, vec3(0.80, 0.10, 0.006), smoothstep(0.20, 0.50, t)));
  c.assign(mix(c, vec3(1.0, 0.43, 0.03), smoothstep(0.45, 0.75, t)));
  c.assign(mix(c, vec3(1.0, 0.90, 0.72), smoothstep(0.70, 1.0, t)));
  return c.mul(t.mul(0.25).add(pow(t, 2.2).mul(2.6)).add(pow(t, 6.0).mul(18.0)));
}).setLayout({ name: 'heatColor', type: 'vec3', inputs: [{ name: 't', type: 'float' }] });

// how hot a wafer is at a point: it cools from the rim inward, and unevenly
export const waferT = Fn(([pxz, c, heat]) => {
  const r = length(pxz.sub(c)).div(C.WR), n = fbm(vec3(pxz.mul(0.0016), 1.0));
  return clamp(heat.mul(1.3).sub(r.mul(0.62)).sub(n.mul(0.36)).add(0.12), 0.0, 1.0);
}).setLayout({ name: 'waferT', type: 'float', inputs: [{ name: 'pxz', type: 'vec2' }, { name: 'c', type: 'vec2' }, { name: 'heat', type: 'float' }] });

// the sky: a faint gradient, a soft box of light high up, a cold glow near the horizon on the far side, stars, and low over
// the far shore, away from the forge, curtains of light that drift (aur). fw: how much of the star lattice one pixel covers,
// so that a star is never smaller than a pixel
export const sky = Fn(([rd, back, stars, fw, aur, time]) => {
  const c = vec3(...C.SKY).mul(pow(max(rd.y, 0.0).oneMinus(), 3.0).mul(0.7).add(0.3)).toVar();
  c.addAssign(vec3(...C.BOX).mul(smoothstep(0.78, 0.96, dot(rd, normalize(vec3(...C.BOXDIR))))));
  const bd = normalize(vec2(...C.BACKDIR));
  c.addAssign(back.mul(smoothstep(0.015, 0.09, rd.y)).mul(exp(rd.y.mul(-5.5))).mul(smoothstep(-0.3, 0.75, dot(normalize(rd.xz.add(1e-5)), bd))));
  const d = rd.mul(190.0), cc = floor(d), hh = h31(cc);
  const f = d.sub(cc).sub(0.5).sub(vec3(h31(cc.add(1.7)), h31(cc.add(5.1)), h31(cc.add(9.3))).sub(0.5).mul(0.5));
  const r = max(0.30, fw.mul(1.4));
  const s = smoothstep(r, 0.0, length(f)).mul(pow(float(0.30).div(r), 2.0));
  const on = smoothstep(0.972, 0.973, hh).mul(smoothstep(-0.02, 0.0, rd.y));
  c.addAssign(vec3(0.72, 0.84, 1.0).mul(s.mul(s)).mul(pow(fract(hh.mul(91.7)), 3.0).mul(5.0).add(0.3)).mul(stars).mul(on));
  // the curtains: bands that follow a wavering line over the horizon, drawn out upward into rays; green low, violet high
  const az = atan(rd.x, rd.z.negate()), h = rd.y;
  const wav = vn(vec3(az.mul(1.7), time.mul(0.02), 3.0)).sub(0.5), e0 = wav.mul(0.16).add(0.15);
  const rays = pow(vn(vec3(az.mul(26.0).add(wav.mul(9.0)), time.mul(0.07), 9.0)), 2.0).mul(0.8).add(0.2);
  const band = exp(pow(max(h.sub(e0), 0.0).div(0.16), 1.3).negate()).mul(smoothstep(e0.sub(0.035), e0, h));
  const where = smoothstep(0.02, 0.4, az).mul(smoothstep(1.5, 0.8, az)).add(smoothstep(-0.5, -1.0, az).mul(smoothstep(-2.4, -1.6, az)).mul(0.6));          // to the right of the forge, and fainter far to its left
  const hue2 = mix(vec3(0.08, 0.95, 0.50), vec3(0.50, 0.22, 1.0), smoothstep(0.0, 0.2, h.sub(e0)));
  c.addAssign(hue2.mul(band).mul(rays).mul(where).mul(aur).mul(0.09));
  return c;
}).setLayout({ name: 'sky', type: 'vec3', inputs: [{ name: 'rd', type: 'vec3' }, { name: 'back', type: 'vec3' }, { name: 'stars', type: 'float' }, { name: 'fw', type: 'float' }, { name: 'aur', type: 'float' }, { name: 'time', type: 'float' }] });

// The forge's smoke, lying in two layers high over the lake: lit from below by its fire, most where it hangs over the forge
// (toward -z) and where it is thin, dark and cold where it is thick, with the sky and its stars between. It drifts slowly. A
// layer is where the line of sight meets a level plane, so its pattern grows small toward the horizon, as it would, and fades
// out just above it. Returns the colour and how much of the sky it covers. (furn: the fire of the forge; back: the sky's glow.)
export const smokeSky = Fn(([rd, time, furn, back]) => {
  const up = max(rd.y, 0.0), fade = smoothstep(0.02, 0.10, up), toward = smoothstep(-0.4, 1.0, dot(normalize(rd.xz.add(vec2(1e-5, 0.0))), vec2(0.0, -1.0)));
  const fire = heatColor(float(0.40)).mul(furn).mul(0.03), p1 = rd.xz.div(up.max(0.02)), p2 = p1.mul(1.7);
  const n1 = fbm(vec3(p1.mul(0.36).add(vec2(time.mul(0.010), time.mul(0.004))), 3.0)), n2 = fbm(vec3(p2.mul(0.22).add(vec2(time.mul(0.006), time.mul(-0.003))), 5.1));
  const d1 = smoothstep(0.47, 0.80, n1).mul(0.55).mul(fade).mul(toward.mul(0.5).add(0.5)), d2 = smoothstep(0.50, 0.84, n2).mul(0.45).mul(fade).mul(toward.mul(0.6).add(0.4));
  const dark = vec3(0.006, 0.007, 0.010).add(back.mul(0.04));
  const c1 = dark.add(fire.mul(toward.mul(0.85).add(0.15)).mul(smoothstep(0.85, 0.5, n1).add(0.25))), c2 = dark.mul(0.8).add(fire.mul(toward.mul(0.6).add(0.1)).mul(0.6));
  const cov = d1.add(d2.mul(d1.oneMinus()));
  return vec4(c1.mul(d1).add(c2.mul(d2).mul(d1.oneMinus())).div(cov.max(1e-4)), cov);
}).setLayout({ name: 'smokeSky', type: 'vec4', inputs: [{ name: 'rd', type: 'vec3' }, { name: 'time', type: 'float' }, { name: 'furn', type: 'float' }, { name: 'back', type: 'vec3' }] });

// a pure colour of the spectrum: t 0 red, through yellow, green, blue to violet at 0.8 (and round to red again at 1)
export const hue = Fn(([t]) => clamp(abs(fract(t.add(vec3(0.0, 2.0 / 3.0, 1.0 / 3.0))).mul(6.0).sub(3.0)).sub(1.0), 0.0, 1.0))
  .setLayout({ name: 'hue', type: 'vec3', inputs: [{ name: 't', type: 'float' }] });

// A field that swirls: the curl of a smooth vector field (three's gradient noise, one noise for each component), taken by
// differences over a short step. Such a field has no sources and no sinks, so what it carries turns and eddies but never
// bunches up or thins out. Of unit length, except where it is all but still.
export const curlNoise = Fn(([p]) => {
  const e = 0.08, a0 = mx_noise_vec3(p).toVar();
  const ax = mx_noise_vec3(p.add(vec3(e, 0, 0))).sub(a0), ay = mx_noise_vec3(p.add(vec3(0, e, 0))).sub(a0), az = mx_noise_vec3(p.add(vec3(0, 0, e))).sub(a0);
  const c = vec3(ay.z.sub(az.y), az.x.sub(ax.z), ax.y.sub(ay.x));
  return c.div(length(c).max(0.004));
}).setLayout({ name: 'curlNoise', type: 'vec3', inputs: [{ name: 'p', type: 'vec3' }] });

// the slope of the lake at a point: a few trains of low waves that never quite repeat (amp: how restless the water is).
// fw: how much of the lake one pixel covers there; a train shorter than a few pixels is left out, or it would only glitter
export const waves = Fn(([p, time, amp, fw]) => {
  const ph = fbm(vec3(p.mul(0.006), time.mul(0.05))).mul(5.0), s = vec2(0).toVar();
  for (const [dx, dz, len, sp, a] of [[0.8, 0.6, 96, 0.9, 1.0], [-0.5, 0.86, 51, 1.3, 0.8], [0.95, -0.3, 24, 1.9, 0.55], [-0.2, -0.98, 11, 2.8, 0.35]]) {
    const k = 6.2832 / len; s.addAssign(vec2(dx, dz).mul(cos(dot(p, vec2(dx, dz)).mul(k).add(time.mul(sp)).add(ph)).mul(a * 0.05)).mul(smoothstep(len * 0.45, len * 0.15, fw))); }
  return s.mul(amp);
}).setLayout({ name: 'waves', type: 'vec2', inputs: [{ name: 'p', type: 'vec2' }, { name: 'time', type: 'float' }, { name: 'amp', type: 'float' }, { name: 'fw', type: 'float' }] });

// the tone curve of the path tracer's last pass
export const aces = Fn(([x]) => clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0))
  .setLayout({ name: 'aces', type: 'vec3', inputs: [{ name: 'x', type: 'vec3' }] });

export { sin, cos, sqrt, abs, min, vec4 };
export const js = {
  fract: x => x - Math.floor(x),
  h21: hash2,
  smooth: (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); },
  heat(t) {
    t = Math.min(1, Math.max(0, t)); const s = js.smooth, mixv = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
    let c = mixv([0, 0, 0], [0.20, 0.008, 0.003], s(0.02, 0.25, t)); c = mixv(c, [0.80, 0.10, 0.006], s(0.20, 0.50, t));
    c = mixv(c, [1.0, 0.43, 0.03], s(0.45, 0.75, t)); c = mixv(c, [1.0, 0.90, 0.72], s(0.70, 1.0, t));
    const k = 0.25 * t + 2.6 * Math.pow(t, 2.2) + 18 * Math.pow(t, 6); return c.map(v => v * k);
  },
};
