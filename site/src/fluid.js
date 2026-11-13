// The water of the lake as the pointer stirs it: worked out as a fluid moves, not drawn.
//
// The pointer does not bend the picture. Where its line of sight meets the water (or, later, the wafer), it drags the
// water along the way it goes, harder the faster: an easy move draws a gentle wake, and a fast one, a flick or a fast
// drag, takes hold of more of the water, over a wider path, toward a higher speed, so that it throws the water up into
// a bow and a broad wake (FAST); a press pushes the water out from under it. The rest is the fluid's
// own doing, on a grid over the same ground as the waves (water.js): what has been set moving carries itself along and
// slows (TAU); a stroke rolls up at its sides into eddies that drift and turn (kept from smearing out, CONF); and the
// water never piles up or runs thin anywhere, because each step the push it would take to keep it even is worked out
// (ITER rounds) and the flow gives way to it. That push is what the surface feels: the water stands up where a stroke
// runs into still water, and sinks behind it and in the hearts of the eddies (water.js lets it settle there and sends
// out the waves that makes); and the embers and sparks seen over the water are carried along by it (carry).
//
// A step takes the flow (its x and z speed in units a second, and the push) from one picture into the next, in four
// passes: move what is there along itself and add the strokes and the eddies' turning; measure how much each cell would
// fill or empty, and how fast it turns; find the push, round after round; and give way to it. When nothing has stirred
// the water for a while it is left still, and nothing is worked out.
import * as THREE from '../vendor/three.js';
import { SIDE, X0, Z0 } from './water.js';

const { Fn, Loop, float, vec2, vec3, vec4, uniform, uniformArray, texture, uv, smoothstep, exp, min, max, abs, length, dot, select } = THREE.TSL;

const STEP = 1 / 60;          // the time of a step
const TAU = 1.6;              // how long what has been set moving keeps going (down to a third)
const CONF = 0.08;            // how hard an eddy is kept turning
const GRIP = 0.55;            // how much of the way to a stroke's own speed the water under it is dragged in a step
const PACE = 0.55, VCAP = 520;          // the speed a stroke drags the water toward: this much of its own, and at most this (units a second)
// A fast stroke: from an easy move (FAST[0] screens a second on the page) to a flick (FAST[1]), the speed it drags the water
// toward may be up to 1 + REACH times as high, its path 1 + WIDEN times as wide, and its hold on the water 1 + GRAB times as
// hard. (Without it a fast stroke, as fast as it could only drag the water to VCAP, did less than a slower one: it was over
// sooner.)
const FAST = [1, 6], REACH = 2.5, WIDEN = 0.6, GRAB = 0.45;
const ETA = 1 / 18700, ELIM = 14;          // how high the surface stands for a push, and (softly) at most how high or low
const NS = 12, QMAX = 48;     // strokes taken in a step; strokes waiting at most
const REST = 6;               // seconds without a stroke after which the water is left still
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

export function createFluid({ renderer, U, small }) {
  const N = small ? 128 : 256, T = 1 / N, CELL = SIDE / N, ITER = small ? 12 : 18, KQ = ETA * CELL / STEP;
  const opt = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
  const rt = () => new THREE.RenderTarget(N, N, opt);
  const flowRT = rt(), movedRT = rt(), cellRT = rt(), pushRT = [rt(), rt()];          // the flow (x, z, push); the flow moved on; (fill, turn); the push, in two that take turns
  const pass = node => { const m = new THREE.NodeMaterial(); m.depthTest = m.depthWrite = false; m.toneMapped = false; m.fragmentNode = node; return new THREE.QuadMesh(m); };
  const at = q => q.sub(vec2(X0, Z0)).div(SIDE), place = st => st.mul(SIDE).add(vec2(X0, Z0));
  const rim = st => smoothstep(0.0, 0.03, min(min(st.x, st.y), min(st.x.oneMinus(), st.y.oneMinus())));          // the edges of the grid hold still

  // ───────── 1. move what is there along itself (what is here now was a step ago a little way back up the flow), let it
  // slow, keep the eddies turning (a push across the slope of how fast the water turns, toward the faster turning), and
  // add the strokes: the water under each is dragged toward its speed, or (a press) pushed out from under it
  const flowIn = texture(flowRT.texture), turnIn = texture(cellRT.texture);
  const sA = uniformArray([...Array(NS)].map(() => new THREE.Vector4(0, 0, 1, 0)), 'vec4'), sB = uniformArray([...Array(NS)].map(() => new THREE.Vector4()), 'vec4'), nS = uniform(0, 'int');          // (x, z, how wide, a press), (the speed to drag toward x z, how hard a press pushes, how much of the way there it drags the water in a step)
  const move = pass(Fn(() => {
    const st = uv(), v = flowIn.sample(st.sub(flowIn.sample(st).xy.mul(STEP / SIDE))).xy.mul(Math.exp(-STEP / TAU)).toVar();
    const w = turnIn.sample(st).y, sp = o => abs(turnIn.sample(st.add(o)).y);
    const g = vec2(sp(vec2(T, 0)).sub(sp(vec2(-T, 0))), sp(vec2(0, T)).sub(sp(vec2(0, -T)))), gn = g.div(length(g).add(1e-5));
    v.addAssign(vec2(gn.y, gn.x.negate()).mul(w).mul(CONF * CELL));
    const p = place(st);
    Loop({ start: 0, end: nS, type: 'int', condition: '<' }, ({ i }) => { const a = sA.element(i), b = sB.element(i), d = p.sub(a.xy), f = exp(dot(d, d).div(a.z.mul(a.z)).negate());
      v.addAssign(b.xy.sub(v).mul(f.mul(b.w)).mul(a.w.oneMinus()).add(d.div(a.z).mul(f).mul(b.z).mul(a.w))); });
    return vec4(v.mul(rim(st)), 0, 1);
  })());
  // ───────── 2. how much each cell would fill or empty (as a speed), and how fast it turns (a second)
  const movedIn = texture(movedRT.texture);
  const measure = pass(Fn(() => {
    const st = uv(), L = movedIn.sample(st.sub(vec2(T, 0))).xy, R = movedIn.sample(st.add(vec2(T, 0))).xy, B = movedIn.sample(st.sub(vec2(0, T))).xy, F = movedIn.sample(st.add(vec2(0, T))).xy;
    return vec4(R.x.sub(L.x).add(F.y.sub(B.y)).mul(0.5), R.y.sub(L.y).sub(F.x.sub(B.x)).div(2 * CELL), 0, 1);
  })());
  // ───────── 3. the push that would keep it even, a round at a time (each round starts from the last; the first from the
  // push of the step before, let go a little)
  const pushIn = texture(pushRT[0].texture), fillIn = texture(cellRT.texture), carryOn = uniform(1);
  const settle = pass(Fn(() => {
    const st = uv(), s = pushIn.sample(st.sub(vec2(T, 0))).x.add(pushIn.sample(st.add(vec2(T, 0))).x).add(pushIn.sample(st.sub(vec2(0, T))).x).add(pushIn.sample(st.add(vec2(0, T))).x);
    return vec4(s.mul(carryOn).sub(fillIn.sample(st).x).mul(0.25), 0, 0, 1);
  })());
  // ───────── 4. give way to it; keep the push alongside, for the surface
  const pushOut = texture(pushRT[0].texture), movedOut = texture(movedRT.texture);
  const even = pass(Fn(() => {
    const st = uv(), q = o => pushOut.sample(st.add(o)).x;
    const v = movedOut.sample(st).xy.sub(vec2(q(vec2(T, 0)).sub(q(vec2(-T, 0))), q(vec2(0, T)).sub(q(vec2(0, -T)))).mul(0.5));
    return vec4(v.mul(rim(st)), q(vec2(0)), 1);
  })());

  // ───────── what the rest reads
  const view = texture(flowRT.texture), live = uniform(0);
  const inside = rim;
  // how high the stirred water would stand at a place of the lake (x, z)
  const levelAt = q => { const st = at(q), k = view.sample(st).level(0).z.mul(KQ).mul(inside(st)).mul(live); return k.div(abs(k).div(ELIM).add(1.0)); };
  // how a point in the air is carried: by the flow of the water seen behind it (where the line from the eye through it
  // meets the water), slowed to its own distance, so that it moves on the page as the water behind it does; a point the
  // line does not take down to the water within the grid is carried by the water under it, less the higher it is
  const carry = Fn(([p]) => {
    const e = U.camPos, yW = U.lift.negate(), dy = p.y.sub(e.y), t = yW.sub(e.y).div(min(dy, float(-0.001)));
    const sR = at(e.xz.add(p.xz.sub(e.xz).mul(t))), sC = at(p.xz);
    const ok = dy.lessThan(-0.5).and(t.greaterThan(1.0)).and(inside(sR).greaterThan(0.001));
    const fR = view.sample(sR).level(0).xy.mul(inside(sR)).div(max(t, 1.0));
    const fC = view.sample(sC).level(0).xy.mul(inside(sC)).mul(smoothstep(900.0, 250.0, p.y.sub(yW)));
    const f = select(ok, fR, fC).mul(live);
    return vec3(f.x, 0.0, f.y);
  });

  // ───────── from the page
  const queue = [];
  let acc = 0, clock = 0, lastStir = -1e9, still = true, made = 0;
  const clear = () => { const prev = renderer.getRenderTarget(), cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha(); renderer.setClearColor(0x000000, 0);
    for (const r of [flowRT, movedRT, cellRT, ...pushRT]) { renderer.setRenderTarget(r); renderer.clear(true, false, false); }
    renderer.setClearColor(cc, ca); renderer.setRenderTarget(prev); };
  return {
    levelAt, carry,
    stirred: () => (clock - lastStir < 1 ? made : 0),
    // (tests) the flow as it stands: x and z speed and the push of every cell, read back from the GPU, and the grid's size
    peek: async () => ({ n: N, cell: CELL, data: await renderer.readRenderTargetPixelsAsync(flowRT, 0, 0, N, N) }),
    // before the first picture: each pass drawn once, so that the first stroke does not wait for them to be compiled
    warm() { const prev = renderer.getRenderTarget(); nS.value = 0;
      renderer.setRenderTarget(movedRT); move.render(renderer); renderer.setRenderTarget(cellRT); measure.render(renderer);
      pushIn.value = pushRT[0].texture; carryOn.value = 1; renderer.setRenderTarget(pushRT[1]); settle.render(renderer);
      pushOut.value = pushRT[1].texture; renderer.setRenderTarget(flowRT); even.render(renderer); renderer.setRenderTarget(prev); clear(); },
    // each frame: the strokes of the page since the last frame, each [x0, z0, x1, z1, how wide, over what time, a press,
    // how fast the pointer went on the page (screens a second)], then as many steps as the time asks for (two at most)
    flow(dt, strokes = []) {
      clock += dt;
      for (const [x0, z0, x1, z1, r0, t, press, pace = 0] of strokes) {
        if (press) { queue.push([x1, z1, r0, 1, 0, 0, 260, 0]); continue; }
        const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz); if (len < 0.5) continue;
        const f = smooth(FAST[0], FAST[1], pace), r = r0 * (1 + WIDEN * f), grip = GRIP * (1 + GRAB * f);
        const sp = len / Math.max(t, 1e-3) * PACE, k = Math.min(1, VCAP * (1 + REACH * f) / sp) * PACE / Math.max(t, 1e-3), m = Math.max(1, Math.min(6, Math.ceil(len / (r * 0.5))));
        for (let j = 1; j <= m; j++) queue.push([x0 + dx * j / m, z0 + dz * j / m, r, 0, dx * k, dz * k, 0, grip]);
      }
      if (queue.length > QMAX) queue.splice(0, queue.length - QMAX);
      if (queue.length) { lastStir = clock; made = queue.length; }
      if (clock - lastStir > REST) { if (!still) { clear(); still = true; live.value = 0; } return; }
      if (still) { clear(); still = false; acc = 0; }
      live.value = 1;
      acc = Math.min(acc + dt, STEP * 2); const n = Math.floor(acc / STEP); acc -= n * STEP;
      if (!n) return;
      const prev = renderer.getRenderTarget();
      for (let k = 0; k < n; k++) {
        const take = queue.splice(0, NS); take.forEach((s, i) => { sA.array[i].set(s[0], s[1], s[2], s[3]); sB.array[i].set(s[4], s[5], s[6], s[7]); }); nS.value = take.length;
        renderer.setRenderTarget(movedRT); move.render(renderer);
        renderer.setRenderTarget(cellRT); measure.render(renderer);
        let c = 0;
        for (let i = 0; i < ITER; i++) { pushIn.value = pushRT[c].texture; carryOn.value = i === 0 ? 0.9 : 1; renderer.setRenderTarget(pushRT[1 - c]); settle.render(renderer); c = 1 - c; }
        pushOut.value = pushRT[c].texture; renderer.setRenderTarget(flowRT); even.render(renderer);
        if (c !== 0) { const t = pushRT[0]; pushRT[0] = pushRT[1]; pushRT[1] = t; }          // (the newest push first, for the next step's first round)
      }
      renderer.setRenderTarget(prev);
    },
  };
}
