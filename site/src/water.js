// The water of the lake, worked out as water moves, not drawn.
//
// The surface is a grid of heights over most of the lake (SIDE units square, N cells a side), kept on the GPU in two
// pictures that take turns: each step reads the heights now and a step ago from one and writes the next ones into the
// other. How a point moves depends on its neighbours out to P cells, weighted by a table worked out once (`table`): the
// sum, over waves of every length, of how a wave of that length pulls the surface, weighted by how fast water lets it
// run. So a bump does not spread as a single ring: waves of all lengths leave it at once, the long ones running ahead
// faster than the short ones, as on deep water, and the ring gains crests as it widens; rings pass through each other and
// turn back from what stands in the water. The table leaves out waves too short for the grid.
//
// What sets it moving: what stands in the water and goes down into it (the anvil, then the chip: no water inside its
// outline, and the water it pushes aside rises in a band just outside it, as much as it pushes aside), the water closing
// over its top when it is under, a blow on the anvil (the band again, once), small touches at points (the sparks of the
// order landing), and the pointer stirring it (fluid.js): where that water is pushed the surface stands up, where it is
// drawn away it sinks, and each step the waves are worked out from that level instead of from flat water, so the surface
// settles there and, as the level moves, follows it and sends out the waves that makes. The edges of the grid and the
// shore take waves in instead of sending them back.
// The heights are in scene units; the lake reads them for the height of its surface and for which way it slopes.
import * as THREE from '../vendor/three.js';
import { C } from './shade.js';
import { DIE } from './memory.js';

const { Fn, Loop, float, vec2, vec4, uniform, uniformArray, texture, uv, smoothstep, exp, min, max, abs, length, mix, dot } = THREE.TSL;

export const SIDE = 3200, X0 = -SIDE / 2, Z0 = -100 - SIDE / 2;          // the grid's extent (the stirred water of fluid.js lies on the same ground)
const P = 5, SIG = 0.35, STEP = 1 / 60;          // the table's reach, how short a wave it keeps, the time of a step
const GW = 150 * 150 * 2 * Math.PI / 62.5;          // how fast waves run: one of 62.5 units runs at 150 units a second
const DAMP = 0.8 * STEP;          // how fast waves die away on their own (two thirds of their height in a little over a second)
const QS = 0.09, NI = 8;          // how much of the water pushed aside goes into waves; touches taken in one step

// every cell (a, b) that holds the same weight as (i, j), by the symmetry of the table
const sym = (i, j) => { const s = new Set(); for (const [a, b] of [[i, j], [j, i]]) for (const sa of [1, -1]) for (const sb of [1, -1]) s.add(`${a * sa},${b * sb}`); return [...s].map(t => t.split(',').map(Number)); };
function table() {
  const M = 64, dk = 2 * Math.PI / M, out = [];
  for (let j = 0; j <= P; j++) for (let i = 0; i <= j; i++) { let s = 0;
    for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) { const kx = (a + 0.5) * dk - Math.PI, ky = (b + 0.5) * dk - Math.PI, k = Math.hypot(kx, ky); s += k * Math.exp(-SIG * k * k) * Math.cos(kx * i + ky * j); }
    out.push([i, j, s]); }
  return out.map(([i, j, s]) => [i, j, s / out[0][2]]);
}
// how the table answers a wave of wave number k (in radians a cell) running along a row
const answer = (K, k) => K.reduce((s, [i, j, w]) => s + sym(i, j).reduce((t, [a]) => t + w * Math.cos(k * a), 0), 0);

export function createWater({ renderer, U, small, fluid }) {
  const N = small ? 256 : 512, CELL = SIDE / N, WB = 3 * CELL, K = table();
  const kRef = 2 * Math.PI / 8, gdt2 = GW * kRef / CELL * STEP * STEP / answer(K, kRef);          // (so that a wave of eight cells runs as deep water would)
  const opt = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
  const rts = [new THREE.RenderTarget(N, N, opt), new THREE.RenderTarget(N, N, opt)];
  let cur = 0, acc = 0, fresh = true;

  // ───────── one step: the heights now (r) and a step ago (g), and the level the stirred water would stand at (b), in;
  // the next ones out
  const inTex = texture(rts[0].texture);
  const body = uniform(new THREE.Vector4(0, 0, 0, 0)), bodyOn = uniform(0), band = uniform(0);          // what stands in the water (centre x, z, half its width and depth); the water it raises outside it this step
  const touch = uniformArray([...Array(NI)].map(() => new THREE.Vector4(0, 0, 1, 0)), 'vec4'), nTouch = uniform(0, 'int');          // x, z, how wide, how high
  const sim = new THREE.NodeMaterial(); sim.depthTest = sim.depthWrite = false; sim.toneMapped = false;
  sim.fragmentNode = Fn(() => {
    const st = uv(), now = inTex.sample(st), h = now.x, hp = now.y, e = now.z, T = 1 / N;
    let pull = float(0);          // (of the heights above the level)
    for (const [i, j, w] of K) { let s = float(0); for (const [a, b] of sym(i, j)) { const q = inTex.sample(st.add(vec2(a * T, b * T))); s = s.add(q.x.sub(q.z)); } pull = pull.add(s.mul(w)); }
    const hn = h.sub(e).mul(2 - DAMP).sub(hp.sub(e)).sub(pull.mul(gdt2)).div(1 + DAMP).add(e).toVar();
    const p = st.mul(SIDE).add(vec2(X0, Z0));
    // what stands in the water: none of the surface inside its outline; outside it, a band where the water it pushes aside rises
    const q = abs(p.sub(body.xy)).sub(body.zw), sd = max(q.x, q.y);
    const open = mix(float(1), smoothstep(-CELL, CELL * 0.5, sd), bodyOn);
    hn.addAssign(smoothstep(0.0, WB * 0.5, sd).mul(smoothstep(WB * 2.0, WB, sd)).mul(band).mul(bodyOn));
    // touches
    Loop({ start: 0, end: nTouch, type: 'int', condition: '<' }, ({ i }) => { const t = touch.element(i), d = p.sub(t.xy);
      hn.addAssign(t.w.mul(exp(dot(d, d).div(t.z.mul(t.z)).negate()))); });
    // the edges of the grid and the shore take waves in; water that is setting into the wafer stills
    const edge = min(min(st.x, st.y), min(st.x.oneMinus(), st.y.oneMinus())), rim = length(p.sub(vec2(...C.WC))).div(C.WR);
    const keep = float(1).sub(smoothstep(0.035, 0.0, edge).mul(0.1)).sub(smoothstep(0.92, 1.0, rim).mul(0.1)).mul(mix(float(0.8), float(1), U.water)).mul(open);
    const level = fluid ? fluid.levelAt(p).mul(open).mul(U.water).mul(smoothstep(1.0, 0.9, rim)) : float(0);
    return vec4(hn.mul(keep), h.mul(keep), level, 1);
  })();
  const quad = new THREE.QuadMesh(sim);

  // ───────── what the lake reads: the newest heights
  const view = texture(rts[0].texture);
  const at = q => q.sub(vec2(X0, Z0)).div(SIDE);
  const inside = q => { const s = at(q); return smoothstep(0.0, 0.03, min(min(s.x, s.y), min(s.x.oneMinus(), s.y.oneMinus()))); };
  const heightAt = q => view.sample(at(q)).level(0).x.mul(inside(q));
  // which way it slopes (fw: the width of the lake a pixel covers; where a cell is smaller than a pixel or two, the waves
  // of the grid would only glitter, so they fade out there)
  const slopeAt = (q, fw) => { const e = CELL, H = o => view.sample(at(q.add(o))).level(0).x;
    return vec2(H(vec2(e, 0)).sub(H(vec2(-e, 0))), H(vec2(0, e)).sub(H(vec2(0, -e)))).div(2 * e).mul(inside(q)).mul(smoothstep(CELL * 3.0, CELL * 1.2, fw)); };

  // ───────── from the page
  const queue = [], recent = [];
  let knock = 0, last = null, clock = 0;
  return {
    heightAt, slopeAt,
    // a touch at (x, z), amp as hard as it was (a pointer about 0.3, a blow 2); wide: how wide, by default by how hard.
    // Where it falls on what stands in the water, the thing itself is struck, and the water round it answers.
    poke(x, z, amp, wide) {
      recent.push(clock);
      if (last && last.half && Math.abs(x - last.x) < last.half[0] + WB && Math.abs(z - last.z) < last.half[1] + WB) { knock += amp * 0.4; return; }
      queue.push([x, z, wide || 8 + 10 * Math.sqrt(amp), amp * 1.1]); if (queue.length > 48) queue.shift();
    },
    recent: () => { while (recent.length && clock - recent[0] > 5.5) recent.shift(); return recent.length; },
    // each frame: what stands in the water now (b: how far the bottom of the chip stands above the water; the chip's
    // outline and the anvil's, and whether they are there), then as many steps as the time asks for (two at most)
    flow(dt, s) {
      clock += dt;
      const b = s.objPos[1] + s.lift, x = s.objPos[0], z = s.objPos[2];
      // what crosses the water line: the chip's body; below it the top of the anvil; then the anvil's broad foot (world.js, plinth)
      const half = s.obj > 0.5 && b < 0 && b > -DIE.glass ? [DIE.hw, DIE.hd] : s.plinth > 0.5 && b >= 0 && b < 26 ? [215, 176] : s.plinth > 0.5 && b >= 26 && b < 260 ? [262, 216] : null;
      let push = 0;
      if (last && half && last.half && half[0] === last.half[0]) push = Math.max(-3, Math.min(3, last.b - b)) * 4 * half[0] * half[1];          // the water pushed aside since the last frame
      if (last && last.half && !half && last.b > b && last.half[0] === DIE.hw) queue.push([x, z, 95, Math.min(1.2, (last.b - b) * 0.3)]);          // its top has gone under: the water closes over it
      last = { b, x, z, half };
      acc = Math.min(acc + dt, STEP * 2); const n = Math.floor(acc / STEP); acc -= n * STEP;
      if (!n && !fresh) return;
      const prev = renderer.getRenderTarget();
      if (fresh) { const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha(); renderer.setClearColor(0x000000, 0);          // still water to begin with
        for (const rt of rts) { renderer.setRenderTarget(rt); renderer.clear(true, false, false); } renderer.setClearColor(cc, ca); fresh = false; }
      for (let k = 0; k < n; k++) {
        body.value.set(x, z, half ? half[0] : 0, half ? half[1] : 0); bodyOn.value = half ? 1 : 0;
        band.value = half ? QS * push / n / (4 * (half[0] + half[1]) * 1.25 * WB) + knock : 0; knock = 0;
        const take = queue.splice(0, NI); take.forEach((t, i) => touch.array[i].set(t[0], t[1], t[2], t[3])); nTouch.value = take.length;
        inTex.value = rts[cur].texture; renderer.setRenderTarget(rts[1 - cur]); quad.render(renderer); cur = 1 - cur;
      }
      view.value = rts[cur].texture;
      renderer.setRenderTarget(prev);
    },
  };
}
