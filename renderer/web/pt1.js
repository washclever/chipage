// Key-visual renderer: a progressive GPU path tracer over a signed-distance scene.
// The scene is the comparator from site/src/circuit.js, built the way a chip stacks it:
// silicon, transistor fingers, contacts, metal layers, capacitors, top-metal pads, bond wires, all inside glass.
import * as C from '/v1/src/circuit.js';
const canvas = document.getElementById('c'), logEl = document.getElementById('log');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
const okF = gl.getExtension('EXT_color_buffer_float'); gl.getExtension('OES_texture_float_linear');
const par = gl.getExtension('KHR_parallel_shader_compile');
window.__err = ''; window.__ready = false;
canvas.addEventListener('webglcontextlost', () => { window.__err += 'context lost\n'; });
const log = s => { logEl.textContent = s; };
// a timer that keeps running while the page is hidden
const ch = new MessageChannel(); let wake = null; ch.port1.onmessage = () => { const w = wake; wake = null; if (w) w(); };
const tick = () => new Promise(r => { wake = r; ch.port2.postMessage(0); });
const F = C.fmt, D = C.DIE;
const LIFT_H = C.LIFT_H, NW = C.PADS.length;
// The scene function is written out from the layout in circuit.js, so the baked chip and the wiring drawn on the site are the same boxes.
const GID = { outn: 60, outp: 61, node: 62, clk: 63, in: 64, x: 65, via: 22, pvia: 28, power: 19, pad: 20 };
const G = (() => {
  const dev = C.DEVICES.map(d => `    t = device(${d.mirror ? 'vec3(ax, p.y, p.z)' : 'p'}, ${F(d.x)}, ${F(d.z)}, ${F(d.n)}, ${F(d.hl)}, part, fi); if (t < d) { d = t; id = ${40 + 3 * d.kind} + part; gFi = fi + ${F(d.shift || 0)}; }`).join('\n');
  const band = { mid: {}, via: {}, top: {} };
  for (const b of C.BARS) {
    const c = [(b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, (b.z[0] + b.z[1]) / 2], h = [(b.x[1] - b.x[0]) / 2, (b.y[1] - b.y[0]) / 2, (b.z[1] - b.z[0]) / 2];
    const k = b.y[0] >= 46 ? 'top' : (b.y[0] >= 18 && b.y[1] <= 44 ? 'mid' : 'via');
    const P = b.mirror ? `vec3(ax - ${F(c[0])}, p.y - ${F(c[1])}, p.z - ${F(c[2])})` : `p - vec3(${F(c[0])}, ${F(c[1])}, ${F(c[2])})`;
    (band[k][b.g] = band[k][b.g] || []).push(k === 'top' ? `sdRBox(${P}, vec3(${F(h[0])}, ${F(h[1])}, ${F(h[2])}), 0.5)` : `sdBox(${P}, vec3(${F(h[0])}, ${F(h[1])}, ${F(h[2])}))`);
  }
  for (const s of C.SLANTS) { const y = C.LAYER[s.layer];
    (band.mid[s.g] = band.mid[s.g] || []).push(`max(seg2(p.xz, vec2(${F(s.a[0])}, ${F(s.a[1])}), vec2(${F(s.b[0])}, ${F(s.b[1])})) - ${F(s.w)}, abs(p.y - ${F((y[0] + y[1]) / 2)}) - ${F((y[1] - y[0]) / 2)})`); }
  const out = { dev };
  for (const k in band) out[k] = Object.entries(band[k]).map(([g, list]) => `    t = ${list[0]};\n` + list.slice(1).map(e => `    t = min(t, ${e});\n`).join('') + `    if (t < d) { d = t; id = ${GID[g]}; }`).join('\n');
  return out;
})();
const SF = { x0: -130, z0: -90, w: 260, h: 180, nx: 1040, nz: 720, far: 6 };      // the area of the die the schematic texture covers

const VS = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const PT = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uPrev; uniform vec2 uRes; uniform int uFrame;
uniform vec3 uCamPos, uCamTgt; uniform float uFov, uAper, uFocus;
uniform float uHeat, uPhase, uSparks, uFrost;
uniform vec3 uKeyDir, uKeyCol; uniform float uKeyCone;
uniform float uFogD, uFogH; uniform vec3 uFogCol; uniform vec3 uSky; uniform vec3 uBox, uBoxDir; uniform vec3 uBack; uniform vec2 uBackDir;
uniform vec3 uWire[${NW * 7}]; uniform vec4 uWireB[${NW}];
uniform float uBuildY, uSchem, uLift, uGhost, uGlow, uPool;
uniform sampler2D uSchemTex;
out vec4 fragColor;
#define PI 3.14159265359
// loops start from a value the compiler cannot know, so it keeps them as loops instead of copying the scene function into each pass
#define ZERO min(uFrame, 0)
const float PITCH = ${F(C.PITCH)};
const vec2 CELL = vec2(${F(D.cellW)}, ${F(D.cellD)});

uint rs;
uint mix32(uint x){ x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
float rnd(){ rs = mix32(rs + 0x9e3779b9u); return float(rs >> 8u)*(1.0/16777216.0); }
vec2 rnd2(){ float a = rnd(); float b = rnd(); return vec2(a, b); }
float h21(vec2 p){ ivec2 q = ivec2(floor(p*256.0 + 0.5)); return float(mix32(uint(q.x)*0xd453451bu ^ uint(q.y)*0x9cd6b38bu) >> 8u)*(1.0/16777216.0); }
float h31(vec3 p){ ivec3 q = ivec3(floor(p*256.0 + 0.5)); return float(mix32(uint(q.x)*0xd453451bu ^ uint(q.y)*0x9cd6b38bu ^ uint(q.z)*0x8e373f21u) >> 8u)*(1.0/16777216.0); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*vn(p); p = p*2.03 + vec3(7.1, 3.3, 5.7); a *= 0.5; } return s; }
vec3 heatColor(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(vec3(0.0), vec3(0.20, 0.008, 0.003), smoothstep(0.02, 0.25, t));
  c = mix(c, vec3(0.80, 0.10, 0.006), smoothstep(0.20, 0.50, t));
  c = mix(c, vec3(1.0, 0.43, 0.03), smoothstep(0.45, 0.75, t));
  c = mix(c, vec3(1.0, 0.90, 0.72), smoothstep(0.70, 1.0, t));
  return c*(0.25*t + 2.6*pow(t, 2.2) + 18.0*pow(t, 6.0));
}
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdRBox(vec3 p, vec3 b, float r){ return sdBox(p, b - r) - r; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h) - r; }
float ringXZ(vec3 p, vec2 c, vec2 ho, vec2 hi, float h){ vec2 a = abs(p.xz - c) - ho; vec2 b = abs(p.xz - c) - hi; return max(max(max(a.x, a.y), -max(b.x, b.y)), abs(p.y - h*0.5) - h*0.5); }
float seg2(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h); }
// distance on the die plane to the lines of the schematic, read from a texture made from circuit.js
float schem(vec2 p){ return textureLod(uSchemTex, (p - vec2(${F(SF.x0)}, ${F(SF.z0)}))/vec2(${F(SF.w)}, ${F(SF.h)}), 0.0).r; }
// ───────── transistors: n bars along z at PITCH, centred at cx
float bars(vec3 p, float cx, float cz, float n, vec3 hf, float yc, out float fi){
  fi = clamp(floor((p.x - cx)/PITCH + (n - 1.0)*0.5 + 0.5), 0.0, n - 1.0);
  return sdBox(vec3(p.x - cx - (fi - (n - 1.0)*0.5)*PITCH, p.y - yc, p.z - cz), hf);
}
// one multi-finger device: active plateau (0), poly fingers with their strap (1), metal-1 strips and contact studs (2)
float device(vec3 p, float cx, float cz, float n, float hl, out int part, out float fi){
  float bd = max(abs(p.x - cx) - (n*0.5 + 1.2)*PITCH, abs(p.z - cz) - (hl + 4.0));
  part = 0; fi = 0.0; if (bd > 2.0) return bd;
  float d = sdBox(p - vec3(cx, 0.7, cz), vec3((n*0.5 + 0.5)*PITCH, 0.7, hl - 1.0));
  float t = bars(p, cx, cz, n, vec3(0.85, 1.8, hl), 3.2, fi);
  t = min(t, sdBox(p - vec3(cx, 3.2, cz - hl - 1.6), vec3(n*0.5*PITCH, 1.8, 0.9)));
  if (t < d) { d = t; part = 1; }
  float sj; t = bars(p, cx, cz, n + 1.0, vec3(0.95, 1.6, hl - 0.8), 13.6, sj);
  float kz = floor((hl - 1.5)/4.0); float zi = clamp(floor((p.z - cz)/4.0 + 0.5), -kz, kz);
  t = min(t, sdBox(vec3(p.x - cx - (sj - n*0.5)*PITCH, p.y - 6.7, p.z - cz - zi*4.0), vec3(0.5, 5.3, 0.5)));
  if (t < d) { d = t; part = 2; fi = sj; }
  return d;
}
float gFi;          // finger index of the last device hit, for the material
float gBY;          // height up to which the die of the last point has been built, in world y
float gStep;        // the longest step a ray may take from the last point (it is a limit, not a surface)
const vec2 WAFER_C = vec2(0.0, -300.0); const float WAFER_R = 2100.0;
// Every die of the wafer can carry the same chip. The die at the origin is ours; the others are laid later, in a ring spreading outward.
bool cellOk(vec2 ci){ return length(ci*CELL - WAFER_C) < WAFER_R - 235.0; }
float cellBuild(vec2 ci){
  float pr = clamp((uGhost - 0.55*length(ci*CELL)/2600.0)/0.45, 0.0, 1.0);
  return pr <= 0.0 ? -5.0 : (pr >= 1.0 ? 1000.0 : -2.0 + pr*74.0);
}
float cellEdge(vec2 xz){ vec2 e = CELL*0.5 - abs(xz - floor(xz/CELL + 0.5)*CELL); return min(e.x, e.y); }
float mapS(vec3 pw, out int id){
  float d = 1e9; id = 0; float t; int part; float fi;
  vec3 p = pw; float bY = uBuildY; bool own = true, chip = true; gBY = uBuildY;
  if (uGhost > 0.0) {
    vec2 ci = floor(pw.xz/CELL + 0.5);
    if (ci != vec2(0.0)) { own = false; bY = cellOk(ci) ? cellBuild(ci) : -5.0; chip = bY > -4.0;
      p = vec3(pw.x - ci.x*CELL.x, pw.y + uLift, pw.z - ci.y*CELL.y); gBY = bY - uLift; }
  }
  float ax = abs(p.x);
  if (chip) {
  if (p.y < 18.0) {
    // transistors (written out from circuit.js)
${G.dev}
    // n-well, guard rings, dummy fill
    t = sdBox(p - vec3(${F(C.WELL.c[0])}, 0.3, ${F(C.WELL.c[1])}), vec3(${F(C.WELL.h[0])}, 0.3, ${F(C.WELL.h[1])})); if (t < d) { d = t; id = 5; }
    t = min(${C.RINGS.map(r => `ringXZ(p, vec2(${F(r.c[0])}, ${F(r.c[1])}), vec2(${F(r.ho[0])}, ${F(r.ho[1])}), vec2(${F(r.hi[0])}, ${F(r.hi[1])}), ${F(C.RING_H)})`).join(', ')});
    if (t < d) { d = t; id = 17; }
    { vec2 q = mod(p.xz + 4.5, 9.0) - 4.5; t = sdBox(vec3(q.x, p.y - 0.5, q.y), vec3(1.7, 0.5, 1.7));
      ${C.RINGS.map((r, i) => `vec2 k${i} = abs(p.xz - vec2(${F(r.c[0])}, ${F(r.c[1])})) - vec2(${F(r.ho[0] + 4)}, ${F(r.ho[1] + 4)});`).join(' ')} vec2 c = abs(p.xz) - vec2(${F(D.hw - 6)}, ${F(D.hd - 6)});
      t = max(t, max(max(-max(k0.x, k0.y), -max(k1.x, k1.y)), max(c.x, c.y))); if (t < d) { d = t; id = 18; } }
  } else d = min(d, p.y - 16.0);
  if (p.y > 18.0 && p.y < 44.0) {
    // metal 2 and 3: outputs, internal nodes, tail, inputs, clock
${G.mid}
    // decoupling capacitors, mirrored
    vec3 q = vec3(ax - ${F(C.DECAP.x)}, p.y, p.z - ${F(C.DECAP.z)});
    t = sdRBox(q - vec3(0.0, 33.25, 0.0), vec3(${F(C.DECAP.hb[0])}, 1.25, ${F(C.DECAP.hb[1])}), 0.2); if (t < d) { d = t; id = 10; }
    t = sdRBox(q - vec3(0.0, 37.75, 0.0), vec3(${F(C.DECAP.ht[0])}, 1.25, ${F(C.DECAP.ht[1])}), 0.2); if (t < d) { d = t; id = 11; }
    t = sdBox(q - vec3(0.0, 35.5, 0.0), vec3(${F(C.DECAP.hb[0] - 0.4)}, 1.0, ${F(C.DECAP.hb[1] - 0.4)})); if (t < d) { d = t; id = 12; }
  } else d = min(d, p.y <= 18.0 ? 22.0 - p.y : p.y - 39.0);
  // vias: signal stacks up to the pads and the cross straps, power drops down to the devices
${G.via}
  if (p.y > 46.0) {
    // top metal: power straps with their fingers, pads
${G.top}
  } else d = min(d, 48.0 - p.y);
  }
  // the stack exists only up to the height built so far
  d = max(d, p.y - bY);
  // bond wires (ours only)
  if (pw.y > 54.0) {
    for (int w = ZERO; w < ${NW}; w++) { vec4 b = uWireB[w]; if (b.w > 0.0 && length(pw - b.xyz) - b.w < d) {
      for (int j = ZERO; j < 6; j++) { t = sdCapsule(pw, uWire[w*7 + j], uWire[w*7 + j + 1], 2.0); if (t < d) { d = t; id = 21; } }
      vec3 a = uWire[w*7]; t = length((pw - a)*vec3(1.0, 1.7, 1.0)) - 6.0; if (t < d) { d = t; id = 21; } } }
  }
  float alive = uHeat*uPhase;
  if (alive > 0.02 && uSparks > 0.0) {
    // charge on the decoupling plates
    if (abs(p.y - 39.3) < 1.4 && abs(ax - ${F(C.DECAP.x)}) < ${F(C.DECAP.ht[0] - 1.5)} && abs(p.z - ${F(C.DECAP.z)}) < ${F(C.DECAP.ht[1] - 1.5)}) {
      vec2 c = floor(p.xz/1.8); vec2 f = p.xz - (c + 0.5)*1.8; float hh = h21(c);
      vec2 o = (vec2(h21(c + 7.3), h21(c + 3.1)) - 0.5)*0.8;
      float ds = hh > 0.3 ? length(vec3(f.x - o.x, p.y - 39.25, f.y - o.y)) - (0.15 + 0.12*hh) : 1e9;
      if (ds < d) { d = ds; id = 26; } d = min(d, 0.9 - max(abs(f.x), abs(f.y)) + 0.25);
    }
    // sparks off the devices that are conducting
    if (uSparks > 0.0 && ax < 50.0 && p.z > -28.0 && p.z < 70.0 && p.y > 17.0 && p.y < 49.0) {
      vec3 q = p - vec3(0.0, 17.0, 0.0); vec3 c = floor(q/8.0); vec3 f = q - (c + 0.5)*8.0; float hh = h31(c);
      vec3 o = (vec3(h31(c + 1.7), h31(c + 5.3), h31(c + 9.1)) - 0.5)*3.0;
      vec3 dir = normalize(vec3(h31(c + 2.2) - 0.5, 0.9, h31(c + 4.4) - 0.5)); float len = 0.4 + 1.5*h31(c + 6.6);
      float ds = hh > mix(1.0 - 0.4*uSparks*alive, 0.96, q.y/32.0) ? sdCapsule(f - o, -dir*len, dir*len, 0.075) : 1e9;
      if (ds < d) { d = ds; id = 27; } d = min(d, 4.0 - max(abs(f.x), max(abs(f.y), abs(f.z))) + 0.3);
    }
  }
  // the schematic on the bare die, scratched by hand: the lines wander and vary in weight
  if (uSchem > 0.01 && pw.y < 3.0 && abs(pw.x) < 130.0 && abs(pw.z) < 90.0) {
    vec2 wob = 1.1*(vec2(vn(vec3(pw.xz*0.09, 1.0)), vn(vec3(pw.xz*0.09, 7.0))) - 0.5);
    t = length(vec2(schem(pw.xz + wob), pw.y - 0.12)) - (0.26 + 0.22*vn(vec3(pw.xz*0.55, 3.0))); if (t < d) { d = t; id = 25; }
  }
  // the die is a tile of silicon whose top is y = 0; the wafer it came from has dropped away by uLift
  float gnd = sdRBox(pw - vec3(0.0, -6.0, 0.0), vec3(CELL.x*0.5 - 2.0, 6.0, CELL.y*0.5 - 2.0), 0.6);
  float wy = pw.y + uLift;
  float wafer = max(max(wy, -(wy + 12.0)), length(pw.xz - WAFER_C) - WAFER_R);
  wafer = max(wafer, -sdBox(vec3(pw.x, wy + 6.0, pw.z), vec3(CELL.x*0.5, 9.0, CELL.y*0.5)));
  gnd = min(gnd, wafer);
  if (gnd < d) { d = gnd; id = 1; }
  if (wy + 13.0 < d) { d = wy + 13.0; id = 31; }
  // a ray must not step past the edge of a die into a neighbour whose chip this evaluation did not look at
  gStep = uGhost > 0.0 ? max(cellEdge(pw.xz) + 0.5, pw.y - 70.0) : 1e9;
  return d;
}
float mapG(vec3 pw){
  vec3 p = pw; float bY = uBuildY;
  if (uGhost > 0.0) {
    vec2 ci = floor(pw.xz/CELL + 0.5);
    if (ci != vec2(0.0)) { bY = cellOk(ci) ? cellBuild(ci) : -5.0; p = vec3(pw.x - ci.x*CELL.x, pw.y + uLift, pw.z - ci.y*CELL.y); }
  }
  float h = min(${F(D.glass)}, bY + 2.5); float d = 1e9;
  if (h > 1.0) d = sdRBox(p - vec3(0.0, h*0.5, 0.0), vec3(${F(D.hw)}, h*0.5, ${F(D.hd)}), min(1.2, h*0.4));
  return d;
}
bool march(vec3 ro, vec3 rd, float tmax, bool inside, out float t, out int id){
  t = 0.0; id = 0;
  for (int i = 0; i < 420; i++) {
    vec3 p = ro + rd*t; int mid; float d = mapS(p, mid);
    float g = mapG(p); if (inside) g = -g; if (g < d) { d = g; mid = 30; }
    if (d < 0.0005*t + 0.0015) { id = mid; return true; }
    t += min(d, gStep); if (t > tmax) break;
  }
  return false;
}
bool visible(vec3 ro, vec3 rd, float tmax){
  float t = 0.05; int k;
  for (int i = 0; i < 110; i++) { float d = mapS(ro + rd*t, k); if (d < 0.01) return false; t += min(d, gStep); if (t > tmax) return true; }
  return true;
}
vec3 nrmS(vec3 p){ int k; vec3 n = vec3(0.0);
  for (int i = ZERO; i < 4; i++) { vec3 e = 0.5773*(2.0*vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0); n += e*mapS(p + 0.012*e, k); }
  return normalize(n); }
vec3 nrmG(vec3 p){ vec2 e = vec2(1.0, -1.0)*0.02;
  return normalize(e.xyy*mapG(p + e.xyy) + e.yyx*mapG(p + e.yyx) + e.yxy*mapG(p + e.yxy) + e.xxx*mapG(p + e.xxx)); }

struct Mat { vec3 alb; float rough; float metal; vec3 emi; };
// how hot a device runs: e = 0 reset (switches precharge the nodes), e = 1 decided (left stack and right PMOS win)
float devHeat(int dev, float fi){
  float e = uPhase; float m = mod(fi, 4.0); float A = (m < 0.5 || m > 2.5) ? 1.0 : 0.0;
  if (dev == 0) return mix(0.55, 0.08, A)*e;
  if (dev == 1) return 0.42*(1.0 - e);
  if (dev == 2) return mix(0.12, 0.62, A)*e;
  if (dev == 3) return mix(0.28, 0.60, A)*e;
  return 0.5*e;
}
// lod is 1 close to the camera and falls with distance: fine surface detail is dropped where it would only be noise
Mat getMat(int id, float fi, float by, vec3 p, inout vec3 n, float lod){
  Mat m; m.alb = vec3(0.42, 0.43, 0.46); m.rough = 0.42; m.metal = 1.0; m.emi = vec3(0.0);
  float T = 0.0;
  if (id == 1) {
    vec2 ci = floor(p.xz/CELL + 0.5); vec2 q = p.xz - ci*CELL; vec2 dm = CELL*0.5 - abs(q);
    float line = 1.0 - smoothstep(1.6, 3.0, min(dm.x, dm.y));               // scribe lines between the dies
    float tone = h21(ci + 17.0);                                            // every die takes the light a little differently
    vec2 mk = abs(abs(q) - (CELL*0.5 - 14.0));                              // alignment marks in the corners
    float mark = step(max(mk.x, mk.y), 5.0)*step(min(mk.x, mk.y), 0.9)*(1.0 - line);
    m.alb = mix(vec3(0.19, 0.205, 0.24)*(0.78 + 0.44*tone), vec3(0.06, 0.07, 0.09), line);
    m.alb = mix(m.alb, vec3(0.46, 0.48, 0.53), mark);
    m.rough = mix(0.05 + 0.10*tone, 0.4, max(line, mark)) + 0.06*vn(p*0.7);
  }
  else if (id == 31) {      // the stage under the wafer: dark turned metal with grooves in rings; beyond it, nothing
    float r = length(p.xz - WAFER_C); float on = 1.0 - smoothstep(2380.0, 2420.0, r);
    float ring = smoothstep(0.30, 0.46, abs(fract(r/42.0) - 0.5));
    m.alb = mix(vec3(0.006, 0.008, 0.012), vec3(0.10, 0.11, 0.135)*(0.8 + 0.2*ring), on); m.rough = mix(0.95, 0.40 + 0.12*ring, on); m.metal = on;
    vec2 a = abs(p.xz) - CELL*0.5; if (max(a.x, a.y) < 0.0) m.emi = vec3(0.20, 0.36, 0.70)*0.07;      // the place our die was taken from
  }
  else if (id >= 40 && id < 55) { int k = id - 40; int dev = k/3; int part = k - dev*3; T = devHeat(dev, fi)*uHeat;
    // the channel under each gate finger is where the current runs: fingers glow, the metal strips over them stay dark like a grate
    if (part == 0) { m.alb = vec3(0.20, 0.19, 0.22); m.rough = 0.3; T *= 0.7; }
    else if (part == 1) { m.alb = vec3(0.33, 0.32, 0.33); m.rough = 0.55; float cr = smoothstep(0.46, 0.66, fbm(p*0.5 + 5.0)); T *= mix(1.0, 0.7, cr); }
    else { m.alb = vec3(0.40, 0.41, 0.45); m.rough = 0.34; T *= mix(0.62, 0.16, smoothstep(0.3, 0.9, n.y)); } }
  else if (id == 5) { m.alb = vec3(0.15, 0.17, 0.22); m.rough = 0.22; }
  else if (id == 17) { m.alb = vec3(0.30, 0.31, 0.35); m.rough = 0.34; }
  else if (id == 18) { m.alb = vec3(0.12, 0.13, 0.16); m.rough = 0.62; }
  else if (id == 10) { m.alb = vec3(0.60, 0.62, 0.66); m.rough = 0.12; }
  else if (id == 11) { m.alb = vec3(0.62, 0.64, 0.68); m.rough = 0.09; }
  else if (id == 12) { m.alb = vec3(0.05); m.rough = 0.4; m.metal = 0.0; m.emi = vec3(0.16, 0.40, 1.0)*uHeat*(1.1 + 1.1*vn(vec3(p.x*0.7, 1.0, p.z*0.7))) + vec3(0.010, 0.022, 0.05); }
  else if (id == 60) { m.rough = 0.36; m.emi = vec3(0.16, 0.40, 1.0)*uHeat*(1.0 - uPhase)*0.35; }                // outn: high in reset, low once decided
  else if (id == 61) { m.rough = 0.36; m.emi = vec3(0.16, 0.40, 1.0)*uHeat*(0.35 + 0.5*uPhase); }              // outp: stays high
  else if (id == 62) { m.rough = 0.38; T = uHeat*uPhase*0.30; }
  else if (id == 63) { m.rough = 0.38; m.emi = vec3(0.16, 0.40, 1.0)*uHeat*uPhase*0.18; }
  else if (id == 64) { m.rough = 0.38; }
  else if (id == 65) { m.alb = vec3(0.50, 0.51, 0.55); m.rough = 0.30; T = uHeat*uPhase*0.34; }
  else if (id == 19 || id == 20) { m.alb = vec3(0.60, 0.61, 0.65); m.rough = 0.42; }
  else if (id == 21) { m.alb = vec3(1.0, 0.74, 0.32); m.rough = 0.24; }
  else if (id == 22) { T = uHeat*uPhase*0.25; }
  else if (id == 25) { m.alb = mix(vec3(0.19, 0.205, 0.24), vec3(0.50, 0.57, 0.68), uSchem); m.rough = mix(0.12, 0.9, uSchem); m.metal = 1.0 - uSchem; }
  else if (id == 26) { m.alb = vec3(0.0); m.rough = 1.0; m.metal = 0.0; m.emi = vec3(0.40, 0.68, 1.0)*7.0; }
  else if (id == 27) { m.alb = vec3(0.0); m.rough = 1.0; m.metal = 0.0; m.emi = heatColor(0.70 + 0.30*h31(floor((p - vec3(0.0, 17.0, 0.0))/8.0) + 3.3))*2.6; }
  bool solid = id != 12 && id != 25 && id != 26 && id != 27 && id != 31;
  if (solid && id != 1 && id != 21) {
    float big = vn(p*0.11 + 9.0);                     // broad tone of forged metal, kept at any distance
    float sc = mix(0.5, fbm(p*0.9), lod);
    m.rough = clamp(m.rough + (sc - 0.5)*0.4 + (big - 0.5)*0.10, 0.05, 1.0); m.alb *= (0.72 + 0.56*sc)*(0.86 + 0.28*big);
    if (lod > 0.25) { vec3 bp = p*1.3; float b0 = fbm(bp);
      vec3 g = vec3(fbm(bp + vec3(0.2, 0.0, 0.0)) - b0, fbm(bp + vec3(0.0, 0.2, 0.0)) - b0, fbm(bp + vec3(0.0, 0.0, 0.2)) - b0)/0.2;
      n = normalize(n - 0.20*lod*(g - n*dot(g, n))); }
  }
  if (by < 900.0) T = 0.0;                           // a chip does not run until it is finished
  if (T > 0.0) { m.emi += heatColor(T); m.alb *= 1.0 - 0.5*T; }
  // the layer being laid down right now glows like fresh metal
  if (solid && id != 1 && id != 21 && by < 900.0) { float fr0 = smoothstep(2.6, 0.0, by - p.y); m.emi += heatColor(0.34 + 0.27*fr0)*fr0*(id == 18 || id == 5 ? 0.10 : 0.6)*(by == uBuildY ? 1.0 : 0.09); }      // much fainter on the other dies
  if (id == 19 || id == 20) {
    // a little frost on the top metal, in broad patches away from the heat
    float fw = fbm(p*0.012 + 3.0);
    float fr = smoothstep(0.58, 0.72, fbm(p*0.07 + fw*4.0)*0.5 + fw*0.6)*smoothstep(0.30, 0.9, n.y)*uFrost*0.5*smoothstep(60.0, 150.0, length(p.xz));
    m.alb = mix(m.alb, vec3(0.62, 0.70, 0.80), fr); m.rough = mix(m.rough, 0.95, fr); m.metal = mix(m.metal, 0.0, fr);
  }
  return m;
}
mat3 basis(vec3 n){ vec3 a = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0); vec3 t = normalize(cross(a, n)); return mat3(t, cross(n, t), n); }
vec3 cosineDir(vec3 n){ vec2 u = rnd2(); float r = sqrt(u.x), ph = 2.0*PI*u.y; return normalize(basis(n)*vec3(r*cos(ph), r*sin(ph), sqrt(max(0.0, 1.0 - u.x)))); }
vec3 ggxNormal(vec3 n, float a){ vec2 u = rnd2(); float ct = sqrt((1.0 - u.x)/(1.0 + (a*a - 1.0)*u.x)); float st = sqrt(max(0.0, 1.0 - ct*ct)); float ph = 2.0*PI*u.y;
  return normalize(basis(n)*vec3(st*cos(ph), st*sin(ph), ct)); }
vec3 coneDir(vec3 d, float ang){ vec2 u = rnd2(); float ct = 1.0 - u.x*(1.0 - cos(ang)); float st = sqrt(max(0.0, 1.0 - ct*ct)); float ph = 2.0*PI*u.y;
  return normalize(basis(d)*vec3(st*cos(ph), st*sin(ph), ct)); }
float D_GGX(float nh, float a){ float a2 = a*a; float d = nh*nh*(a2 - 1.0) + 1.0; return a2/(PI*d*d + 1e-9); }
float G1(float nv, float a){ float k = a*0.5; return nv/(nv*(1.0 - k) + k); }
vec3 evalBsdf(vec3 n, vec3 wo, vec3 wi, Mat m){
  float nl = max(dot(n, wi), 0.0), nv = max(dot(n, wo), 1e-4); vec3 h = normalize(wo + wi); float nh = max(dot(n, h), 0.0), vh = max(dot(wo, h), 0.0);
  float a = max(m.rough*m.rough, 0.003);
  vec3 F0 = mix(vec3(0.04), m.alb, m.metal); vec3 Fr = F0 + (1.0 - F0)*pow(1.0 - vh, 5.0);
  vec3 spec = Fr*(D_GGX(nh, a)*G1(nv, a)*G1(nl, a)/(4.0*nv*max(nl, 1e-4)));
  return m.alb*(1.0 - m.metal)*(1.0 - Fr)/PI + min(spec, vec3(30.0));
}
bool sampleBsdf(vec3 n, vec3 wo, Mat m, out vec3 wi, out vec3 w, out bool specular){
  float a = max(m.rough*m.rough, 0.003);
  vec3 F0 = mix(vec3(0.04), m.alb, m.metal); float nv = max(dot(n, wo), 1e-4);
  float f0 = (F0.r + F0.g + F0.b)/3.0; float pS = mix(clamp(f0 + (1.0 - f0)*pow(1.0 - nv, 5.0), 0.12, 0.9), 1.0, m.metal);
  if (rnd() < pS) {
    vec3 h = ggxNormal(n, a); wi = reflect(-wo, h); float nl = dot(n, wi); if (nl <= 0.0) return false;
    float vh = max(dot(wo, h), 1e-4), nh = max(dot(n, h), 1e-4);
    vec3 Fr = F0 + (1.0 - F0)*pow(1.0 - vh, 5.0);
    w = Fr*(G1(nv, a)*G1(nl, a)*vh/(nv*nh))/pS; specular = m.rough < 0.12; return true;
  }
  wi = cosineDir(n); vec3 h = normalize(wo + wi); vec3 Fr = F0 + (1.0 - F0)*pow(1.0 - max(dot(wo, h), 0.0), 5.0);
  w = m.alb*(1.0 - m.metal)*(1.0 - Fr)/(1.0 - pS); specular = false; return true;
}
// light escaping upward from the device rows that are conducting, treated as four glowing patches.
// Returns what arrives along l from the distance dist; the caller checks that nothing is in the way.
vec3 fromHot(vec3 p, out vec3 l, out float dist){
  float r = rnd()*4.0; vec3 c; vec2 h; float T;
  if (r < 1.0) { c = vec3(0.0, 16.5, 24.0); h = vec2(36.0, 15.0); T = 0.46; }
  else if (r < 2.0) { c = vec3(0.0, 16.5, -14.0); h = vec2(27.0, 8.0); T = 0.42; }
  else if (r < 3.0) { c = vec3(0.0, 16.5, -50.0); h = vec2(27.0, 9.0); T = 0.36; }
  else { c = vec3(0.0, 16.5, 58.0); h = vec2(31.0, 7.0); T = 0.50; }
  T *= uHeat*uPhase; l = vec3(0.0, 1.0, 0.0); dist = 0.0;
  if (T < 0.02 || uBuildY < 17.0) return vec3(0.0);
  vec3 q = c + vec3((rnd()*2.0 - 1.0)*h.x, 0.0, (rnd()*2.0 - 1.0)*h.y);
  vec3 dv = q - p; float d2 = dot(dv, dv); dist = sqrt(d2); l = dv/dist;
  if (dist < 1.5 || l.y > -0.02) return vec3(0.0);
  return heatColor(T)*(0.40*4.0*h.x*h.y*abs(l.y)/max(d2, 40.0))*4.0;
}
vec3 env(vec3 rd, bool spec){
  vec3 c = uSky*(0.30 + 0.70*pow(1.0 - max(rd.y, 0.0), 3.0));
  c += uBox*smoothstep(0.78, 0.96, dot(rd, uBoxDir));
  // a long band of light low behind the scene: it is what the wafer and the top of the glass reflect
  c += uBack*smoothstep(0.015, 0.09, rd.y)*exp(-5.5*rd.y)*smoothstep(-0.3, 0.75, dot(normalize(rd.xz + 1e-5), uBackDir));
  if (spec && dot(rd, uKeyDir) > cos(uKeyCone)) c += min(uKeyCol/(PI*uKeyCone*uKeyCone), vec3(9.0));      // seen in a mirror, the key is held down so it glints without flooding the frame
  return c;
}
// the key lights a pool around our die and falls away toward the rim of the wafer
float pool(vec3 p){ return 1.0 - 0.88*smoothstep(uPool*0.25, uPool, length(p.xz)); }
float glassRough(vec3 p){
  float f = smoothstep(0.56, 0.84, fbm(p*0.03 + 11.0))*smoothstep(50.0, 68.0, p.y + uLift*step(${F(D.hw + 4)}, abs(p.x)))*smoothstep(70.0, 175.0, length(p.xz));
  return 0.012 + uFrost*0.4*f;
}
vec3 trace(vec3 ro, vec3 rd){
  vec3 L = vec3(0.0), thr = vec3(1.0);
  bool inside = mapG(ro) < 0.0, spec = true; int diffB = 0;
  // shadow rays of one bounce (0 fog, 1 key light, 2 hot devices) are gathered, then tested in a single loop
  vec3 sO[3]; vec3 sD[3]; vec3 sC[3]; float sT[3]; float travelled = 0.0;
  const vec3 ABSORB = vec3(0.0024, 0.0013, 0.0009);
  for (int ev = ZERO; ev < 20; ev++) {
    bool done = false; sT[0] = -1.0; sT[1] = -1.0; sT[2] = -1.0;
    float t; int id; bool hit = march(ro, rd, 9000.0, inside, t, id); float fiHit = gFi; float byHit = gBY;
    float tEnd = hit ? t : 9000.0; travelled += tEnd;
    if (inside) {
      // the glass over the hot devices carries their glow: one sample of scattered light along the ray
      if (uGlow > 0.0 && ev < 4 && uHeat*uPhase > 0.02) {
        float ts = rnd()*tEnd; vec3 ps = ro + rd*ts; vec3 l2; float dist; vec3 Li = fromHot(ps, l2, dist);
        if (Li.r > 0.0) { sO[0] = ps; sD[0] = l2; sT[0] = dist - 0.5; sC[0] = min(thr*exp(-ABSORB*ts)*Li*(uGlow*tEnd/(4.0*PI)), vec3(4.0)); }
      }
      thr *= exp(-ABSORB*tEnd);
    }
    else if (uFogD > 0.0) {
      float tf = min(tEnd, 2400.0); vec3 pm = ro + rd*(tf*0.5); float dens = uFogD*exp(-max(pm.y + uLift, 0.0)/uFogH); float Tr = exp(-dens*tf);
      if (ev == 0) {
        float ts = rnd()*tf; vec3 ps = ro + rd*ts; float dl = uFogD*exp(-max(ps.y + uLift, 0.0)/uFogH);
        sO[0] = ps; sD[0] = coneDir(uKeyDir, uKeyCone); sT[0] = 9000.0; sC[0] = thr*exp(-dens*ts)*dl*uKeyCol*pool(ps)*tf*(1.0/(4.0*PI));
      }
      L += thr*(1.0 - Tr)*uFogCol; thr *= Tr;
    }
    if (!hit) { L += thr*env(rd, spec); done = true; }
    else {
      vec3 p = ro + rd*tEnd;
      if (id == 30) {
        vec3 n = nrmG(p); if (inside) n = -n;
        float gr = glassRough(p); vec3 h = gr > 0.02 ? ggxNormal(n, gr*gr) : n;
        float cosi = max(dot(-rd, h), 0.0); float eta = inside ? 1.46 : 1.0/1.46;
        float Fr = 0.035 + 0.965*pow(1.0 - cosi, 5.0);
        vec3 rf = refract(rd, h, eta); if (dot(rf, rf) < 1e-6) Fr = 1.0;
        if (rnd() < Fr) { rd = reflect(rd, h); if (dot(rd, n) < 0.0) rd = reflect(rd, n); ro = p + n*0.04; }
        else { rd = normalize(rf); ro = p - n*0.04; inside = !inside; }
      } else {
        vec3 n = nrmS(p); if (dot(n, rd) > 0.0) n = -n;
        Mat m = getMat(id, fiHit, byHit, p, n, diffB == 0 ? clamp(170.0/travelled, 0.0, 1.0) : 0.0);
        bool hasProxy = id >= 40 && id < 55;
        vec3 cap = diffB > 0 ? vec3(5.0) : vec3(1e9);
        if (spec || !hasProxy) L += min(thr*m.emi, cap);
        vec3 wo = -rd;
        if (m.rough >= 0.12 || m.metal < 0.5) {
          vec3 ps = p + n*0.06;
          vec3 ld = coneDir(uKeyDir, uKeyCone); float nl = dot(n, ld);
          if (nl > 0.0) { sO[1] = ps; sD[1] = ld; sT[1] = 9000.0; sC[1] = min(thr*evalBsdf(n, wo, ld, m)*uKeyCol*(nl*pool(p)), cap); }
          if (uHeat*uPhase > 0.02) { vec3 l2; float dist; vec3 Li = fromHot(ps, l2, dist); float nl2 = dot(n, l2);
            if (nl2 > 0.0 && Li.r > 0.0) { sO[2] = ps; sD[2] = l2; sT[2] = dist - 0.5; sC[2] = min(thr*evalBsdf(n, wo, l2, m)*Li*nl2, cap); } }
        }
        vec3 wi, w; bool sp;
        if (!sampleBsdf(n, wo, m, wi, w, sp)) done = true;
        else {
          thr *= w; spec = sp; ro = p + n*0.05; rd = wi;
          if (!sp) { diffB++; if (diffB > 3) done = true; }
          if (!done && ev > 3) { float q = min(max(thr.r, max(thr.g, thr.b)), 1.0); if (rnd() > q) done = true; else thr /= max(q, 1e-3); }
        }
      }
    }
    for (int s = ZERO; s < 3; s++) { if (sT[s] > 0.0) { if (visible(sO[s], sD[s], sT[s])) L += sC[s]; } }
    if (done) break;
  }
  return L;
}
void main(){
  ivec2 px = ivec2(gl_FragCoord.xy);
  rs = mix32(uint(px.x)*0xd453451bu ^ uint(px.y)*0x9cd6b38bu ^ uint(uFrame)*0xa83a1f43u);
  vec2 jit = rnd2();
  vec2 uv = ((gl_FragCoord.xy - 0.5 + jit)/uRes)*2.0 - 1.0; uv.x *= uRes.x/uRes.y;
  vec3 fw = normalize(uCamTgt - uCamPos); vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0))); vec3 up = cross(rt, fw);
  float f = 1.0/tan(radians(uFov)*0.5);
  vec3 rd = normalize(fw*f + rt*uv.x + up*uv.y); vec3 ro = uCamPos;
  if (uAper > 0.0) { vec3 fp = ro + rd*(uFocus/dot(rd, fw)); vec2 u = rnd2(); float r = sqrt(u.x)*uAper, ph = 2.0*PI*u.y; ro += rt*(r*cos(ph)) + up*(r*sin(ph)); rd = normalize(fp - ro); }
  vec3 col = trace(ro, rd);
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  col = min(col, vec3(36.0));
  vec4 prev = texelFetch(uPrev, px, 0);
  fragColor = vec4(prev.rgb + col, prev.a + 1.0);
}`;

const FS_HEAD = `#version 300 es
precision highp float; uniform sampler2D tA, tB; uniform vec2 uRes, uTexel; out vec4 o;
`;
const RESOLVE = FS_HEAD + `vec3 av(ivec2 q){ vec4 a = texelFetch(tA, clamp(q, ivec2(0), ivec2(uRes) - 1), 0); return a.rgb/max(a.a, 1.0); }
float lu(vec3 c){ return dot(c, vec3(0.3, 0.6, 0.1)); }
void main(){ ivec2 q = ivec2(gl_FragCoord.xy); vec3 c = av(q);
  float m = max(max(lu(av(q + ivec2(1,0))), lu(av(q - ivec2(1,0)))), max(lu(av(q + ivec2(0,1))), lu(av(q - ivec2(0,1)))));
  m = max(m, max(max(lu(av(q + ivec2(1,1))), lu(av(q - ivec2(1,1)))), max(lu(av(q + ivec2(1,-1))), lu(av(q - ivec2(1,-1))))));
  float l = lu(c); float lim = 2.2*m + 0.03; if (l > lim) c *= lim/l;
  o = vec4(c, 1.0); }`;
// edge-preserving smoothing: neighbours count only if they look alike, so grain goes and edges stay
const DENOISE = FS_HEAD + `uniform float uK;
void main(){ ivec2 q = ivec2(gl_FragCoord.xy); vec3 c = texelFetch(tA, q, 0).rgb; vec3 acc = c; float ws = 1.0; float lc = dot(c, vec3(0.3, 0.6, 0.1));
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { if (i == 0 && j == 0) continue;
    vec3 s = texelFetch(tA, clamp(q + ivec2(i, j), ivec2(0), ivec2(uRes) - 1), 0).rgb; vec3 dd = (s - c)/(0.04 + lc*0.35);
    float w = exp(-dot(dd, dd)*uK - float(i*i + j*j)*0.18); acc += s*w; ws += w; }
  o = vec4(acc/ws, 1.0); }`;
const PRE = FS_HEAD + `uniform float uTh;
void main(){ vec2 uv = gl_FragCoord.xy/uRes; vec3 c = (texture(tA, uv + uTexel*vec2(-.5,-.5)).rgb + texture(tA, uv + uTexel*vec2(.5,-.5)).rgb + texture(tA, uv + uTexel*vec2(-.5,.5)).rgb + texture(tA, uv + uTexel*vec2(.5,.5)).rgb)*0.25;
  float br = max(c.r, max(c.g, c.b)); float knee = uTh*0.6; float soft = clamp(br - uTh + knee, 0.0, 2.0*knee); soft = soft*soft/(4.0*knee + 1e-4);
  o = vec4(min(c*max(soft, br - uTh)/max(br, 1e-4), vec3(60.0)), 1.0); }`;
const DOWN = FS_HEAD + `void main(){ vec2 uv = gl_FragCoord.xy/uRes; vec3 c = texture(tA, uv).rgb*4.0;
  c += texture(tA, uv + uTexel*vec2(-1.,-1.)).rgb + texture(tA, uv + uTexel*vec2(1.,-1.)).rgb + texture(tA, uv + uTexel*vec2(-1.,1.)).rgb + texture(tA, uv + uTexel*vec2(1.,1.)).rgb;
  o = vec4(c/8.0, 1.0); }`;
const UP = FS_HEAD + `uniform float uW;
void main(){ vec2 uv = gl_FragCoord.xy/uRes;
  vec3 c = texture(tA, uv + uTexel*vec2(-2.,0.)).rgb + texture(tA, uv + uTexel*vec2(2.,0.)).rgb + texture(tA, uv + uTexel*vec2(0.,-2.)).rgb + texture(tA, uv + uTexel*vec2(0.,2.)).rgb;
  c += (texture(tA, uv + uTexel*vec2(-1.,-1.)).rgb + texture(tA, uv + uTexel*vec2(1.,-1.)).rgb + texture(tA, uv + uTexel*vec2(-1.,1.)).rgb + texture(tA, uv + uTexel*vec2(1.,1.)).rgb)*2.0;
  o = vec4(c/12.0 + texture(tB, uv).rgb*uW, 1.0); }`;
const FINAL = FS_HEAD + `uniform float uExp, uBloom, uCA, uVig, uGrain, uSeed;
uint mix32(uint x){ x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
float h21(vec2 p){ ivec2 q = ivec2(floor(p*256.0 + 0.5)); return float(mix32(uint(q.x)*0xd453451bu ^ uint(q.y)*0x9cd6b38bu) >> 8u)*(1.0/16777216.0); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }
void main(){ vec2 uv = gl_FragCoord.xy/uRes; vec2 d = uv - 0.5; float ca = uCA*dot(d, d);
  vec3 col = vec3(texture(tA, uv + d*ca).r, texture(tA, uv).g, texture(tA, uv - d*ca).b);
  col += texture(tB, uv).rgb*uBloom;
  vec2 vq = d*vec2(uRes.x/uRes.y/1.78, 1.0); col *= mix(1.0, 1.0 - uVig, smoothstep(0.30, 1.0, length(vq)));
  col = aces(col*uExp);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col*vec3(0.90, 0.98, 1.12), (1.0 - l)*0.5); col = mix(col, col*vec3(1.05, 1.0, 0.94), l*0.5);
  col = pow(col, vec3(1.0/2.2));
  col += (h21(gl_FragCoord.xy + uSeed) - 0.5)*uGrain*(1.0 - 0.5*l);
  o = vec4(col, 1.0); }`;

// Shaders compile in the background. Asking for the result before it is ready blocks the GPU, and a long block loses the context,
// so the page waits by polling.
function startProgram(fs) {
  const p = gl.createProgram(); p.sh = [];
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(p, s); p.sh.push(s); }
  gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
  const loc = {}; p.u = n => loc[n] ?? (loc[n] = gl.getUniformLocation(p, n)); return p;
}
async function finishProgram(name, p) {
  if (par) while (!gl.getProgramParameter(p, par.COMPLETION_STATUS_KHR)) { for (let i = 0; i < 400; i++) await tick(); }
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + (gl.getShaderInfoLog(p.sh[1]) || '') + ' ' + (gl.getProgramInfoLog(p) || ''));
}
const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
let P = null;
const ready = (async () => {
  const t0 = performance.now(); log('compiling shaders…');
  const src = { pt: PT, resolve: RESOLVE, den: DENOISE, pre: PRE, down: DOWN, up: UP, final: FINAL }, out = {};
  for (const k in src) out[k] = startProgram(src[k]);
  for (const k in out) await finishProgram(k, out[k]);
  P = out; window.__ready = true; window.__compileMs = Math.round(performance.now() - t0); log('ready (' + window.__compileMs + ' ms)');
})().catch(e => { window.__err += String(e) + '\n'; log('shader error:\n' + window.__err); });

function tex(w, h, half, linear) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, half ? gl.RGBA16F : gl.RGBA32F, w, h, 0, gl.RGBA, half ? gl.HALF_FLOAT : gl.FLOAT, null);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return { t, fb, w, h };
}
let RT = null;
function alloc(w, h) {
  if (RT && RT.w === w && RT.h === h) return;
  RT = { w, h, a: tex(w, h, false, false), b: tex(w, h, false, false), hdr: tex(w, h, true, true), hdr2: tex(w, h, true, true), bd: [], bu: [] };
  let bw = w >> 1, bh = h >> 1;
  for (let i = 0; i < 6; i++) { RT.bd.push(tex(Math.max(2, bw), Math.max(2, bh), true, true)); RT.bu.push(tex(Math.max(2, bw), Math.max(2, bh), true, true)); bw >>= 1; bh >>= 1; }
}
async function gpuIdle() {
  const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
  for (;;) { const r = gl.clientWaitSync(s, 0, 0); if (r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED || r === gl.WAIT_FAILED) break; await tick(); }
  gl.deleteSync(s);
}
function bind(p, unit, name, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(p.u(name), unit); }

// The scratched schematic as a distance field in a texture, so hundreds of line segments stay out of the shader.
function schemTexture() {
  const { nx, nz, x0, z0, w, h, far } = SF, data = new Float32Array(nx * nz).fill(far);
  for (const g of C.SCHEM) {
    const ax = g.a[0], az = g.a[1], bx = g.b[0] - ax, bz = g.b[1] - az, l2 = bx * bx + bz * bz || 1e-9;
    const i0 = Math.max(0, Math.floor((Math.min(g.a[0], g.b[0]) - far - x0) / w * nx)), i1 = Math.min(nx - 1, Math.ceil((Math.max(g.a[0], g.b[0]) + far - x0) / w * nx));
    const j0 = Math.max(0, Math.floor((Math.min(g.a[1], g.b[1]) - far - z0) / h * nz)), j1 = Math.min(nz - 1, Math.ceil((Math.max(g.a[1], g.b[1]) + far - z0) / h * nz));
    for (let j = j0; j <= j1; j++) { const z = z0 + (j + 0.5) / nz * h;
      for (let i = i0; i <= i1; i++) { const x = x0 + (i + 0.5) / nx * w, k = Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / l2));
        const d = Math.hypot(x - ax - bx * k, z - az - bz * k), q = j * nx + i; if (d < data[q]) data[q] = d; } }
  }
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nx, nz, 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
const schemTex = schemTexture();

// bond wires: one arc per pad, rising and leaning outward toward a point far above; `grow` 0..1 is how much of it exists
function wirePoints(star, grow) {
  const pts = new Float32Array(NW * 21), bnd = new Float32Array(NW * 4);
  C.PADS.forEach((pd, w) => {
    const a = [pd[0], 60, pd[1]], c = [a[0] + Math.sign(a[0]) * 46, a[1] + 150, a[2] + Math.sign(a[2]) * 22];
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < 7; j++) { const t = Math.pow(j / 6, 1.35) * 0.62 * Math.max(grow, 1e-3), u = 1 - t;
      for (let k = 0; k < 3; k++) pts[(w * 7 + j) * 3 + k] = u * u * a[k] + 2 * u * t * c[k] + t * t * star[k];
      cx += pts[(w * 7 + j) * 3]; cy += pts[(w * 7 + j) * 3 + 1]; cz += pts[(w * 7 + j) * 3 + 2]; }
    cx /= 7; cy /= 7; cz /= 7; let r = 0;
    for (let j = 0; j < 7; j++) r = Math.max(r, Math.hypot(pts[(w * 7 + j) * 3] - cx, pts[(w * 7 + j) * 3 + 1] - cy, pts[(w * 7 + j) * 3 + 2] - cz));
    bnd.set([cx, cy, cz, grow > 0 ? r + 9 : -1], w * 4);
  });
  return { pts, bnd };
}
const DEF = { w: 960, h: 540, spp: 32, fov: 24, aper: 0, focus: 400, heat: 1, phase: 1, sparks: 0, glow: 0.004, pool: 2300, frost: 1, wires: 1, ghost: 0, lift: 0, buildY: 1000, schem: 0,
  // The key comes from the front left, so that its mirror image on the flat wafer and the glass falls behind the scene, never in the frame.
  keyDir: [-0.72, 0.52, 0.46], keyCol: [0.5, 0.7, 1.0], keyI: 8, keyCone: 0.10, box: [0.22, 0.34, 0.6], boxDir: [0.2, 0.75, 0.6],
  back: [0.55, 0.85, 1.5], backDir: [0.1, -1],
  fogD: 0.0004, fogH: 60, fogCol: [0.012, 0.022, 0.045], sky: [0.006, 0.011, 0.022], star: [-40, 1500, -300], post: {}, to: 'save', ext: 'jpg', q: 0.93 };
const status = { state: 'idle' }; window.__status = status; let cancel = false;

async function render(shot) {
  await ready; if (!P) throw new Error('shader failed: ' + window.__err);
  const s = Object.assign({}, DEF, shot); const w = s.w, h = s.h, spp = s.spp;
  cancel = false; canvas.width = w; canvas.height = h; alloc(w, h);
  for (const t of [RT.a, RT.b]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  const ts = s.tile || 240, tiles = [];
  for (let y = 0; y < h; y += ts) for (let x = 0; x < w; x += ts) tiles.push([x, y, Math.min(ts, w - x), Math.min(ts, h - y)]);
  const kd = s.keyDir, kl = Math.hypot(...kd), bl = Math.hypot(...s.boxDir), t0 = performance.now(), wp = wirePoints(s.star, s.buildY >= 900 ? s.wires : 0);
  Object.assign(status, { state: 'rendering', name: s.name, frame: 0, spp, w, h, ms: 0, error: null });
  const p = P.pt; let src = RT.a, dst = RT.b;
  for (let frame = 0; frame < spp && !cancel; frame++) {
    gl.useProgram(p); gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, w, h);
    bind(p, 0, 'uPrev', src.t); bind(p, 1, 'uSchemTex', schemTex);
    gl.uniform2f(p.u('uRes'), w, h); gl.uniform1i(p.u('uFrame'), frame + (s.seed || 0) * 4099);
    gl.uniform3fv(p.u('uCamPos'), s.cam); gl.uniform3fv(p.u('uCamTgt'), s.tgt);
    gl.uniform1f(p.u('uFov'), s.fov); gl.uniform1f(p.u('uAper'), s.aper); gl.uniform1f(p.u('uFocus'), s.focus);
    gl.uniform1f(p.u('uHeat'), s.heat); gl.uniform1f(p.u('uPhase'), s.phase); gl.uniform1f(p.u('uSparks'), s.sparks); gl.uniform1f(p.u('uFrost'), s.frost);
    gl.uniform3f(p.u('uKeyDir'), kd[0] / kl, kd[1] / kl, kd[2] / kl); gl.uniform3f(p.u('uKeyCol'), s.keyCol[0] * s.keyI, s.keyCol[1] * s.keyI, s.keyCol[2] * s.keyI);
    gl.uniform1f(p.u('uKeyCone'), s.keyCone); gl.uniform1f(p.u('uFogD'), s.fogD); gl.uniform1f(p.u('uFogH'), s.fogH);
    gl.uniform3fv(p.u('uFogCol'), s.fogCol); gl.uniform3fv(p.u('uSky'), s.sky);
    gl.uniform3fv(p.u('uBox'), s.box); gl.uniform3f(p.u('uBoxDir'), s.boxDir[0] / bl, s.boxDir[1] / bl, s.boxDir[2] / bl);
    gl.uniform3fv(p.u('uBack'), s.back); gl.uniform2f(p.u('uBackDir'), s.backDir[0] / Math.hypot(...s.backDir), s.backDir[1] / Math.hypot(...s.backDir));
    gl.uniform3fv(p.u('uWire[0]'), wp.pts); gl.uniform4fv(p.u('uWireB[0]'), wp.bnd);
    gl.uniform1f(p.u('uGlow'), s.glow); gl.uniform1f(p.u('uPool'), s.pool);
    gl.uniform1f(p.u('uBuildY'), s.buildY); gl.uniform1f(p.u('uSchem'), s.schem); gl.uniform1f(p.u('uLift'), s.lift); gl.uniform1f(p.u('uGhost'), s.ghost);
    gl.enable(gl.SCISSOR_TEST);
    for (const tl of tiles) { gl.scissor(tl[0], tl[1], tl[2], tl[3]); gl.drawArrays(gl.TRIANGLES, 0, 3); await gpuIdle(); if (cancel) break; }
    gl.disable(gl.SCISSOR_TEST);
    [src, dst] = [dst, src]; status.frame = frame + 1; status.ms = Math.round(performance.now() - t0);
  }
  RT.acc = src;
  await post(s.post); await save(s.name || 'shot', s.to, s.ext, s.q);
  status.ms = Math.round(performance.now() - t0); status.state = 'done'; log(`${s.name}: done in ${status.ms} ms`);
}
function quad(target, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3); }
async function post(o) {
  const q = Object.assign({ exp: 1.15, bloom: 0.3, th: 1.0, ca: 0.010, vig: 0.55, grain: 0.03, den: 0 }, o); const { w, h } = RT;
  gl.disable(gl.SCISSOR_TEST);
  gl.useProgram(P.resolve); bind(P.resolve, 0, 'tA', RT.acc.t); gl.uniform2f(P.resolve.u('uRes'), w, h); quad(RT.hdr.fb, w, h);
  let hdr = RT.hdr, other = RT.hdr2;
  for (let i = 0; i < q.den; i++) { gl.useProgram(P.den); bind(P.den, 0, 'tA', hdr.t); gl.uniform2f(P.den.u('uRes'), w, h); gl.uniform1f(P.den.u('uK'), 1.6); quad(other.fb, w, h); [hdr, other] = [other, hdr]; }
  gl.useProgram(P.pre); bind(P.pre, 0, 'tA', hdr.t); gl.uniform2f(P.pre.u('uRes'), RT.bd[0].w, RT.bd[0].h); gl.uniform2f(P.pre.u('uTexel'), 1 / w, 1 / h); gl.uniform1f(P.pre.u('uTh'), q.th); quad(RT.bd[0].fb, RT.bd[0].w, RT.bd[0].h);
  gl.useProgram(P.down);
  for (let i = 1; i < 6; i++) { bind(P.down, 0, 'tA', RT.bd[i - 1].t); gl.uniform2f(P.down.u('uRes'), RT.bd[i].w, RT.bd[i].h); gl.uniform2f(P.down.u('uTexel'), 1 / RT.bd[i - 1].w, 1 / RT.bd[i - 1].h); quad(RT.bd[i].fb, RT.bd[i].w, RT.bd[i].h); }
  gl.useProgram(P.up); let srcT = RT.bd[5];
  for (let i = 4; i >= 0; i--) { bind(P.up, 0, 'tA', srcT.t); bind(P.up, 1, 'tB', RT.bd[i].t); gl.uniform2f(P.up.u('uRes'), RT.bu[i].w, RT.bu[i].h); gl.uniform2f(P.up.u('uTexel'), 1 / srcT.w, 1 / srcT.h); gl.uniform1f(P.up.u('uW'), i === 0 ? 0.7 : 1.0); quad(RT.bu[i].fb, RT.bu[i].w, RT.bu[i].h); srcT = RT.bu[i]; }
  gl.useProgram(P.final); bind(P.final, 0, 'tA', hdr.t); bind(P.final, 1, 'tB', RT.bu[0].t);
  gl.uniform2f(P.final.u('uRes'), w, h); gl.uniform1f(P.final.u('uExp'), q.exp); gl.uniform1f(P.final.u('uBloom'), q.bloom); gl.uniform1f(P.final.u('uCA'), q.ca);
  gl.uniform1f(P.final.u('uVig'), q.vig); gl.uniform1f(P.final.u('uGrain'), q.grain); gl.uniform1f(P.final.u('uSeed'), 17.0);
  quad(null, w, h); await gpuIdle();
}
function save(name, to = 'save', ext = 'jpg', q = 0.93) {
  return new Promise((res, rej) => canvas.toBlob(async b => { try { const r = await fetch('/' + to + '/' + name + '.' + ext, { method: 'POST', body: b }); res(await r.text()); } catch (e) { rej(e); } }, ext === 'webp' ? 'image/webp' : 'image/jpeg', q));
}
// a shot taken from the timeline at scroll position g
function shotAt(g, o = {}) {
  const t = C.timeline(g), d = Math.hypot(t.cam[0] - t.tgt[0], t.cam[1] - t.tgt[1], t.cam[2] - t.tgt[2]);
  return Object.assign({ cam: t.cam, tgt: t.tgt, fov: t.fov, lift: t.lift * LIFT_H, buildY: t.buildY, schem: t.scratch,
    heat: t.i > 8 ? 1 : t.power, phase: t.i > 8 ? 1 : t.decide, wires: t.i > 7 ? 1 : t.wires, ghost: t.ghost,
    focus: d, aper: 2.5, post: { exp: 1.15 + 0.4 * Math.min(1, Math.max(0, (d - 900) / 1700)), den: 1 } }, o);     // the wide views are exposed a little longer
}
// Bake the frame sequence the site scrubs through: one picture per entry of frameTimes(), saved to site/frames.
// Stations get more samples than moves, because the eye rests on them.
let bakeStop = false;
async function bake(from = 0, to = 1e9, o = {}) {
  const ts = C.frameTimes(); bakeStop = false; window.__bake = { i: from, n: ts.length, done: false, t0: performance.now(), err: null };
  const w = o.w || 1600, h = o.h || 900;
  await fetch('/saveframe1/index.json', { method: 'POST', body: JSON.stringify({ n: ts.length, w, h, ext: 'webp', times: ts.map(t => +t.toFixed(5)) }) });
  try {
    for (let i = from; i < Math.min(to, ts.length) && !bakeStop; i++) {
      const hold = C.BEATS[C.timeline(ts[i]).i].hold;
      await render(shotAt(ts[i], Object.assign({ name: 'f_' + String(i).padStart(4, '0'), w, h, spp: hold ? 96 : 48, to: 'saveframe1', ext: 'webp', q: 0.82 }, o)));
      window.__bake.i = i + 1; window.__bake.ms = Math.round(performance.now() - window.__bake.t0);
    }
  } catch (e) { window.__bake.err = String(e); }
  window.__bake.done = true;
}
async function queue(list) { window.__q = { done: [], cur: null, all: false };
  for (const s of list) { window.__q.cur = s.name; try { await render(s); window.__q.done.push([s.name, 'done', status.ms]); } catch (e) { status.state = 'error'; status.error = String(e); window.__q.done.push([s.name, 'error', String(e)]); } }
  window.__q.all = true; status.state = 'idle'; }
// several saved pictures side by side in one file, for looking over a camera move at a glance
async function sheet(names, cols, out, cw = 480) {
  const imgs = await Promise.all(names.map(n => fetch('/' + n + '?' + Date.now()).then(r => r.blob()).then(b => createImageBitmap(b))));
  const ch2 = Math.round(cw * imgs[0].height / imgs[0].width), rows = Math.ceil(imgs.length / cols);
  const cv = new OffscreenCanvas(cw * cols, ch2 * rows), cx = cv.getContext('2d');
  imgs.forEach((im, i) => cx.drawImage(im, (i % cols) * cw, Math.floor(i / cols) * ch2, cw, ch2));
  const b = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return (await fetch('/save/' + out + '.jpg', { method: 'POST', body: b })).text();
}
window.KV = {
  sheet, frameTimes: C.frameTimes, bake: (a, b, o) => { bake(a, b, o); return 'baking'; }, stopBake: () => { bakeStop = true; cancel = true; },
  render: shot => { status.state = 'starting'; render(shot).catch(e => { status.state = 'error'; status.error = String(e); }); return 'started'; },
  queue: list => { queue(list); return 'queued ' + list.length; },
  shotAt, timeline: C.timeline, TOTAL: C.TOTAL, BEATS: C.BEATS,
  repost: async (o, name) => { await post(o); return save(name); },
  cancel: () => { cancel = true; }, status, float: !!okF,
};
