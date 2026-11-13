// Second version of the renderer: a progressive GPU path tracer over a signed-distance scene.
// The scene is the 64-bit memory of site/src/memory.js in every state the film needs:
//   a schematic of thin lines of light, the same lines grown into boxes of glass (the layout), the boxes laid in metal
//   from the bottom up inside a block of glass, and the finished chip writing its bits;
// set in a dark hall where wafers lie under columns of cold light.
import * as M from '/site/src/memory.js';
const canvas = document.getElementById('c'), logEl = document.getElementById('log');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
const okF = gl.getExtension('EXT_color_buffer_float'); gl.getExtension('OES_texture_float_linear');
const par = gl.getExtension('KHR_parallel_shader_compile');
window.__err = ''; window.__ready = false;
canvas.addEventListener('webglcontextlost', () => { window.__err += 'context lost\n'; });
const log = s => { logEl.textContent = s; };
const ch = new MessageChannel(); let wake = null; ch.port1.onmessage = () => { const w = wake; wake = null; if (w) w(); };
const tick = () => new Promise(r => { wake = r; ch.port2.postMessage(0); });
const F = M.fmt, D = M.DIE, NW = M.PADS.length;
const TEX = { x0: -164, z0: -136, w: 328, h: 272, nx: 2624, nz: 2176, far: 6 };       // the area of the die that the texture of schematic lines covers
const v3 = a => `vec3(${F(a[0])}, ${F(a[1])}, ${F(a[2])})`;

// ───────── the scene function is written out from the data
// material numbers: by layer, with a few tags of their own (the storage nodes, the lines that carry a signal)
const LID = { well: 5, act: 40, poly: 41, con: 42, m1: 43, br: 44, v1: 45, m2: 46, v2: 47, m3: 48, capB: 10, capD: 12, capT: 11, top: 19 };
const TID = { 'm1:Q': 49, 'm1:QB': 50, 'br:QB': 50, 'm3:TWL': 51, 'm2:TBL': 52, 'm2:TBLB': 53, 'm2:ADDR': 54, 'poly:WL': 55, 'top:PAD': 20, 'm3:TGND': 56, 'm2:TVDD': 57 };
const gid = b => TID[b.layer + ':' + b.tag] ?? LID[b.layer];
const cen = b => [0, 1, 2].map(i => (b.lo[i] + b.hi[i]) / 2), half = b => [0, 1, 2].map(i => (b.hi[i] - b.lo[i]) / 2);
function bounds(list) { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const b of list) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.lo[i]); hi[i] = Math.max(hi[i], b.hi[i]); } return { lo, hi }; }
// A part of the memory as a distance function. Every layer can stand anywhere between lying flat on the plane of the
// schematic (thin, the layers a hair apart, which reads as a layout drawn in two dimensions) and its place in the stack.
const YF = l => M.LINE_Y + M.RANK[l] * 0.8, LI = Object.fromEntries(Object.keys(M.RANK).map((l, i) => [l, i]));
function partFn(part) {
  const all = [...part.boxes, ...part.devs.flatMap(d => M.devBoxes(d, true))], bb = bounds(all), groups = {}; bb.lo[1] = 0;
  for (const b of part.boxes) { const k = gid(b) + ':' + b.layer; (groups[k] = groups[k] || []).push(b); }
  let s = `float f_${part.id}(vec3 q, out int id){ id = 0; float bd = sdBox(q - ${v3(cen(bb))}, ${v3(half(bb))}); if (bd > 2.0) return bd; float d = 1e9, t, m; int k;\n`;
  for (const [key, list] of Object.entries(groups)) { const [id, layer] = key.split(':');
    s += `  m = uR[${LI[layer]}];\n` + list.map((b, i) => { const c = cen(b), h = half(b);
      return `  t = ${i ? 'min(t, ' : ''}sdBox(q - vec3(${F(c[0])}, mix(${F(YF(layer))}, ${F(c[1])}, m), ${F(c[2])}), vec3(${F(h[0])}, mix(uThin, ${F(h[1])}, m), ${F(h[2])}))${i ? ')' : ''};\n`; }).join('') + `  if (t < d) { d = t; id = ${id}; }\n`; }
  for (const dv of part.devs) s += `  t = dv(q, ${F(dv.cx)}, ${F(dv.cz)}, ${F(dv.n)}, ${F(dv.hl)}, k); if (t < d) { d = t; id = k == 0 ? 40 : (k == 1 ? 41 : 43); }\n`;
  return s + '  return d; }\n';
}
const HEAD = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uPrev; uniform vec2 uRes; uniform int uFrame, uMaxEv;
uniform vec3 uCamPos, uCamTgt; uniform float uFov, uAper, uFocus;
uniform vec3 uKeyDir, uKeyCol; uniform float uKeyCone;
uniform float uFogD, uFogH; uniform vec3 uFogCol, uSky, uBox, uBoxDir, uBack; uniform vec2 uBackDir;
uniform vec3 uWire[${NW * 7}]; uniform vec4 uWireB[${NW}];
uniform float uLift, uBuildY, uMorph, uLine, uTile, uPeri, uSim, uSimT, uPower, uWrite, uCand, uPick, uVar, uGhost;
uniform float uWaferHeat, uHall, uShaft, uSparks, uSparkY, uSparkR, uSparkS, uSparkH, uFrost, uGlow, uPool, uStars, uDisp, uObj;
uniform float uSparkL, uSparkA, uOwn, uHP, uHJ, uObjY; uniform vec2 uCol, uBeam;        // a spark's size and length; our own column of light; the hall
#define HP uHP
const mat3 LAT = mat3(0.89157, 0.09441, -0.44294,  0.00000, 0.97803, 0.20846,  0.45289, -0.18586, 0.87198);        // the lattice of the sparks, turned out of line with the scene
uniform vec2 uCarve, uSparkX;        // the sheet: where the carving has got to (x) and how thick the sheet is; sparks: a band in x (centre, half width)
uniform int uBits[8]; uniform sampler2D uLines; uniform float uK[16]; uniform float uR[14];
out vec4 fragColor;
#define PI 3.14159265359
// loops start from a value the compiler cannot know, so it keeps them as loops instead of copying the scene function into each pass
#define ZERO min(uFrame, 0)
const float XA = ${F(M.XA)}, ZA = ${F(M.ZA)}, CX = ${F(M.CX)}, CZ = ${F(M.CZ)}, NN = ${F(M.N)};
const vec2 DCELL = vec2(${F(D.cellW)}, ${F(D.cellD)}); const vec3 DHALF = vec3(${F(D.hw)}, 0.0, ${F(D.hd)}); const float GLASS = ${F(D.glass)};
const vec2 WC = vec2(0.0, -300.0); const float WR = 2100.0;

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
const vec3 COLD = vec3(0.34, 0.60, 1.0);          // the colour of voltage and of the light that writes
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdRBox(vec3 p, vec3 b, float r){ return sdBox(p, b - r) - r; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h) - r; }
// The change from schematic to layout has two halves. First the lines swell into the layout lying flat (uMorph 0 .. 0.5);
// then the layers come up off the plane to their heights, the lower ones first (0.4 .. 1).
// How far each layer has come up is uR[layer], worked out once per picture.
#define uThin (uLine + 0.06)
// a small transistor: active (0), gate fingers and their strap (1), metal strips with a contact each (2)
float dv(vec3 p, float cx, float cz, float n, float hl, out int part){
  vec3 q = vec3(p.x - cx, p.y, p.z - cz); part = 0;
  float bd = sdBox(q - vec3(0.0, 7.7, -0.65), vec3((n + 1.0)*1.5, 7.7, hl + 0.65)); if (bd > 1.5) return bd;       // a bound in all three directions: a bound that ignored height made rays crawl under every transistor
  float mA = uR[${LI.act}], mP = uR[${LI.poly}], mC = uR[${LI.con}], mM = uR[${LI.m1}];
  float d = sdBox(q - vec3(0.0, mix(${F(YF('act'))}, 0.7, mA), 0.0), vec3((n + 1.0)*1.5, mix(uThin, 0.7, mA), hl - 0.8));
  float fi = clamp(floor(q.x/3.0 + (n - 1.0)*0.5 + 0.5), 0.0, n - 1.0); float yP = mix(${F(YF('poly'))}, 3.2, mP), hP = mix(uThin, 1.8, mP);
  float t = sdBox(vec3(q.x - (fi - (n - 1.0)*0.5)*3.0, q.y - yP, q.z), vec3(0.6, hP, hl));
  t = min(t, sdBox(q - vec3(0.0, yP, -hl - 0.65), vec3((n - 1.0)*1.5 + 0.6, hP, 0.65)));
  if (t < d) { d = t; part = 1; }
  float sj = clamp(floor(q.x/3.0 + n*0.5 + 0.5), 0.0, n); float sx = q.x - (sj - n*0.5)*3.0;
  t = min(sdBox(vec3(sx, q.y - mix(${F(YF('m1'))}, 13.6, mM), q.z), vec3(0.6, mix(uThin, 1.6, mM), hl - 1.3)), sdBox(vec3(sx, q.y - mix(${F(YF('con'))}, 6.7, mC), q.z), vec3(0.45, mix(uThin, 5.3, mC), 0.45)));
  if (t < d) { d = t; part = 2; }
  return d;
}
// what the last point evaluated belongs to: which part, which row and column, where inside the part,
// how far it is from line to box, how long ago it was drawn, which copy it is and how tall that copy has been laid
int gReg; vec2 gRC; vec3 gLoc; float gMM, gDr, gBY, gInst, gSel, gStep; vec2 gHC; vec3 gRd;        // gRd: the direction of the ray being followed
`;
const parts = M.PARTS.map(partFn).join('\n');
// The memory, about its own centre: the boxes of its layout wherever they stand, blended with the lines of its schematic.
const CHIP = `
float chip(vec3 p, float tile, float peri, out int id){
  float d = 1e9; id = 0; float t; int k;
  vec2 a = p.xz - vec2(XA, ZA); vec2 ci = clamp(floor(a/vec2(CX, CZ)), 0.0, NN - 1.0);
  vec3 q = vec3(a.x - (ci.x + 0.5)*CX, p.y, a.y - (ci.y + 0.5)*CZ), qr = vec3(p.x, p.y, q.z), qc = vec3(q.x, p.y, p.z);
  t = f_cell(q, k); if (t < d) { d = t; id = k; gReg = 0; gRC = ci; gLoc = q; }
  t = f_rowDev(qr, k); if (t < d) { d = t; id = k; gReg = 1; gRC = ci; gLoc = qr; }
  t = f_rowTrk(qr, k); if (t < d) { d = t; id = k; gReg = 2; gRC = ci; gLoc = qr; }
  if (p.y < 24.0 && p.x < XA - 38.0 && p.x > XA - 56.0) {       // each row taps the address lines that spell its number
    float m = uR[${LI.v1}]; int r = int(ci.y); for (int j = ZERO; j < 3; j++) { float x = XA - 53.0 + float(j)*4.8 + (((r >> j) & 1) == 1 ? 0.0 : 2.4);
      t = sdBox(vec3(p.x - x, p.y - mix(${F(YF('v1'))}, 18.6, m), qr.z + 6.4 - float(j)*6.4), vec3(0.6, mix(uThin, 3.4, m), 0.6)); if (t < d) { d = t; id = 45; gReg = 1; gRC = ci; gLoc = qr; } } }
  t = f_colTrk(qc, k); if (t < d) { d = t; id = k; gReg = 3; gRC = ci; gLoc = qc; }
  t = f_colPre(qc, k); if (t < d) { d = t; id = k; gReg = 4; gRC = ci; gLoc = qc; }
  t = f_colIO(qc, k); if (t < d) { d = t; id = k; gReg = 5; gRC = ci; gLoc = qc; }
  t = f_bus(p, k); if (t < d) { d = t; id = k; gReg = 6; gLoc = p; }
  t = f_ctl(p, k); if (t < d) { d = t; id = k; gReg = 7; gLoc = p; }
  t = f_top(p, k); if (t < d) { d = t; id = k; gReg = 8; gLoc = p; }
  gMM = 1.0; gDr = 1.0;
  bool inX = a.x > -2.0 && a.x < NN*CX + 2.0, inZ = a.y > -2.0 && a.y < NN*CZ + 2.0, inDie = abs(p.x) < DHALF.x && abs(p.z) < DHALF.z;
  if (uMorph < 0.999) {
    // the schematic: its lines, and how much of it has been drawn. The cells are stamped outward from the first one;
    // the decoder, the column circuits and the rest are drawn away from the array after them.
    float w = smoothstep(0.0, 0.5, uMorph), dl = 1e9, rv = -1.0, age = 1.0;
    if (inDie && p.y < 8.0) { float e = textureLod(uLines, (p.xz - vec2(${F(TEX.x0)}, ${F(TEX.z0)}))/vec2(${F(TEX.w)}, ${F(TEX.h)}), 0.0).r; dl = length(vec2(e, p.y - ${F(M.LINE_Y)})) - uLine; }
    else dl = max(p.y - 7.0, 0.0) + 1.0 + (inDie ? 0.0 : max(max(abs(p.x) - DHALF.x, abs(p.z) - DHALF.z), 0.0));
    if (inX && inZ) { float ring = max(abs(ci.x - 3.0), abs(ci.y - 4.0)), dc = tile*5.6 - ring; rv = length(q.xz) - clamp(dc, 0.0, 1.0)*17.5; age = clamp(dc - 1.0, 0.0, 1.0); }
    else rv = length(max(vec2(max(XA - p.x, p.x - ${F(M.XB)}), max(ZA - p.z, p.z - ${F(M.ZB)})), 0.0)) + 2.0 - peri*134.0;
    if (rv > -4.0) age = min(age, clamp(-rv/4.0, 0.0, 1.0));       // what the pen has just drawn is still hot
    d = max(mix(dl, d, w), rv);
    gMM = w; gDr = age;
  }
  // near the edge of a cell, a row or a column the fold cannot see the neighbour: do not step far
  if (p.y < 32.0 && p.y > -2.0 && inDie) { vec2 e = vec2(CX, CZ)*0.5 - abs(q.xz); float lim = 1e9;
    if (e.x < 0.0) e.x = 1e9; if (e.y < 0.0) e.y = 1e9;       // beyond the last one there is no neighbour to miss
    if (inX && inZ) lim = min(e.x, e.y); else if (inZ && p.x < XA) lim = e.y; else if (inX) lim = e.x;
    gStep = min(gStep, lim + 0.3); }
  return d;
}`;
const BODY = `
bool cellOk(vec2 ci){ return length(ci*DCELL - WC) < WR - 250.0; }
float cellEdge(vec2 xz){ vec2 e = DCELL*0.5 - abs(xz - floor(xz/DCELL + 0.5)*DCELL); return min(e.x, e.y); }
// Which copy of the memory a point belongs to. Ours is at the origin. While candidates are tried there are others on the
// neighbouring dies, each drawing the same thing in its own time; at the end every die of the wafer gets the chip.
bool inst(vec3 pw, out vec3 p, out float by, out float sc, out float tile, out float peri){
  p = pw; by = uBuildY; sc = 1.0; tile = uTile; peri = uPeri; gInst = 0.0; gSel = 1.0;
  if (uObj < 0.5) return false;                     // nothing has been made yet
  if (uCand <= 0.0 && uGhost <= 0.0) return true;
  vec2 ci = floor(pw.xz/DCELL + 0.5);
  if (pw.y > -2.0) gStep = min(gStep, max(cellEdge(pw.xz) + 0.5, pw.y - 70.0));
  if (ci == vec2(0.0)) return true;
  p = vec3(pw.x - ci.x*DCELL.x, pw.y, pw.z - ci.y*DCELL.y);
  float h = h21(ci + 3.7); gInst = 0.15 + 0.85*h;
  if (uGhost > 0.0) {
    if (!cellOk(ci)) return false;
    float pr = clamp((uGhost - 0.55*length(ci*DCELL)/2600.0)/0.45, 0.0, 1.0);
    by = pr <= 0.0 ? -5.0 : (pr >= 1.0 ? 1000.0 : -2.0 + pr*74.0); tile = 1.0; peri = 1.0; return pr > 0.0;
  }
  if (abs(ci.x) > 2.0 || abs(ci.y) > 1.0) return false;
  float ap = clamp(uCand*1.7 - 0.7*h, 0.0, 1.0);
  tile = min(uTile, ap); peri = min(uPeri, ap*ap); by = -5.0;
  gSel = 1.0 - smoothstep(0.0, 1.0, clamp(uPick*1.6 - 0.6*h, 0.0, 1.0));                 // the ones not chosen cool and go out
  if (uVar > 0.5) { if (h > 0.5) p.x = -p.x; if (fract(h*7.3) > 0.5) p.z = -p.z; }       // other floorplans
  return ap > 0.0 && gSel > 0.02;
}
float mapS(vec3 pw, out int id){
  float d = 1e9; id = 0; gStep = 1e9; gReg = -1; gMM = 1.0; gDr = 1.0; float t; int k;
  vec3 po = vec3(pw.x, pw.y - uObjY, pw.z); vec3 p; float by, sc, tile, peri; bool on = inst(po, p, by, sc, tile, peri); gBY = by;
  if (on) { t = chip(p/sc, tile, peri, k)*sc; if (t < d) { d = t; id = k; } }
  if (on && uCarve.y > 0.0 && gInst <= 0.0) { float x0 = max(uCarve.x, -DHALF.x), hx = 0.5*(DHALF.x - 1.0 - x0);
    if (hx > 0.0) { t = sdBox(p - vec3(x0 + hx, by - 0.5*uCarve.y, 0.0), vec3(hx, 0.5*uCarve.y, DHALF.z - 1.0)); if (t < d) { d = t; id = 33; } } }
  // bond wires (ours only, once the chip is whole)
  if (pw.y > 54.0) {
    for (int w = ZERO; w < ${NW}; w++) { vec4 b = uWireB[w]; if (b.w > 0.0 && length(pw - b.xyz) - b.w < d) {
      for (int j = ZERO; j < 6; j++) { t = sdCapsule(pw, uWire[w*7 + j], uWire[w*7 + j + 1], 1.9); if (t < d) { d = t; id = 21; } }
      vec3 a = uWire[w*7]; t = length((pw - a)*vec3(1.0, 1.7, 1.0)) - 5.5; if (t < d) { d = t; id = 21; } } }
  }
  // sparks: over the layer being laid, or over the wafer while it is hot
  if (uSparks > 0.0 && pw.y > uSparkY && pw.y < uSparkY + uSparkH && length(pw.xz) < uSparkR && (uSparkX.y <= 0.0 || abs(pw.x - uSparkX.x) < uSparkX.y)) {
    vec3 q = LAT*(pw - vec3(0.0, uSparkY, 0.0))/uSparkS; vec3 c = floor(q); vec3 f = q - c - 0.5; float hh = h31(c);
    vec3 o = (vec3(h31(c + 1.7), h31(c + 5.3), h31(c + 9.1)) - 0.5)*0.4;
    vec3 dir = normalize(vec3(h31(c + 2.2) - 0.5, 0.9, h31(c + 4.4) - 0.5)); float len = 0.05 + 0.19*h31(c + 6.6);
    float ds = hh > mix(1.0 - 0.5*uSparks, 0.985, (pw.y - uSparkY)/uSparkH) ? sdCapsule(f - o, -dir*len*uSparkL*uSparkA, dir*len*uSparkL*uSparkA, 0.011*uSparkL)*uSparkS : 1e9;
    if (ds < d) { d = ds; id = 27; } vec3 rl = LAT*gRd; vec3 sg = mix(vec3(-1.0), vec3(1.0), step(0.0, rl)); rl = sg*max(abs(rl), 1e-5);
    vec3 tn = (0.5*sg - f)/rl; gStep = min(gStep, (min(tn.x, min(tn.y, tn.z)) + 0.02)*uSparkS);
  }
  // the floor: our wafer, the others far off in the hall, the stage they lie on
  float wy = pw.y + uLift;
  t = max(max(wy, -(wy + 12.0)), length(pw.xz - WC) - WR); if (t < d) { d = t; id = 1; }
  if (uHall > 0.5) { vec2 hp = pw.xz - WC; vec2 hc = floor(hp/HP + 0.5);
    if (hc != vec2(0.0)) { vec2 off = (vec2(h21(hc + 1.3), h21(hc + 8.1)) - 0.5)*uHJ;
      t = max(max(wy, -(wy + 12.0)), length(hp - hc*HP - off) - WR); if (t < d) { d = t; id = 2; gHC = hc; } } }
  if (wy + 13.0 < d) { d = wy + 13.0; id = 31; }
  return d;
}
float mapG(vec3 pw){
  vec3 po = vec3(pw.x, pw.y - uObjY, pw.z); vec3 p; float by, sc, tile, peri; bool on = inst(po, p, by, sc, tile, peri);
  float h = min(GLASS, by - 3.0);
  if (!on || h <= 1.0) return 1e9;
  return sdRBox(p - vec3(0.0, h*0.5, 0.0), vec3(DHALF.x, h*0.5, DHALF.z), min(1.2, h*0.4));
}
// One ray cast does every job, so that the scene function is compiled into the shader only once.
// mode 0, 1, 2: follow a ray to the first surface, starting in the air, inside the block of glass, or inside a box of the
// layout while it is still glass. mode 3: sample the scene round the point ro and leave its normal in gN.
vec3 gN; int gIter;
bool shoot(vec3 ro, vec3 rd, float tmax, int mode, out float t, out int id){
  t = 0.0; id = 0; gN = vec3(0.0); gRd = rd;
  for (int i = ZERO; i < 720; i++) {
    gIter = i;
    vec3 e = 0.5773*(2.0*vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    vec3 p = mode == 3 ? ro + 0.008*e : ro + rd*t; int mid; float d = mapS(p, mid);
    if (mode == 3) { gN += e*d; if (i >= 3) { gN = normalize(gN); return true; } continue; }
    if (mode == 2) { d = -d; if (d < 0.004) { id = mid; return true; } t += max(d, 0.02); }
    else { float g = mapG(p); if (mode == 1) g = -g; if (g < d) { d = g; mid = 30; }
      if (d < 0.0004*t + 0.0015) { id = mid; return true; }
      t += min(uMorph < 0.999 ? d*0.7 : d, gStep); }
    if (t > tmax) break;
  }
  return false;
}
vec3 nrmG(vec3 p){ vec2 e = vec2(1.0, -1.0)*0.02;
  return normalize(e.xyy*mapG(p + e.xyy) + e.yyx*mapG(p + e.yyx) + e.yxy*mapG(p + e.yxy) + e.xxx*mapG(p + e.xxx)); }

struct Mat { vec3 alb; float rough; float metal; vec3 emi; float glass; vec3 tint; };
struct Hit { int reg; vec2 rc; vec3 loc; float mm, dr, by, inst, sel; vec2 hc; };
// how hot the wafer is at a point: it cools from the rim inward, and unevenly
float waferT(vec3 p, vec2 c, float heat){ float r = length(p.xz - c)/WR; float n = fbm(vec3(p.xz*0.0016, 1.0));
  return clamp(heat*1.3 - 0.62*r - 0.36*n + 0.12, 0.0, 1.0); }
int bitAt(vec2 rc){ return (uBits[int(rc.y)] >> (7 - int(rc.x))) & 1; }
// lod is 1 close to the camera and falls with distance: fine surface detail is dropped where it would only be noise
Mat getMat(int id, Hit h, vec3 p, inout vec3 n, float lod){
  Mat m; m.alb = vec3(0.42, 0.43, 0.46); m.rough = 0.42; m.metal = 1.0; m.emi = vec3(0.0); m.glass = 0.0; m.tint = vec3(1.0);
  float T = 0.0;
  if (id == 1 || id == 2) {          // a wafer: dies, the lines between them, marks in the corners; glowing while it is hot
    vec2 c = id == 1 ? WC : WC + h.hc*HP + (vec2(h21(h.hc + 1.3), h21(h.hc + 8.1)) - 0.5)*uHJ;
    vec2 ci = floor(p.xz/DCELL + 0.5); vec2 q = p.xz - ci*DCELL; vec2 dm = DCELL*0.5 - abs(q);
    float line = 1.0 - smoothstep(1.6, 3.0, min(dm.x, dm.y)), tone = h21(ci + 17.0);
    vec2 mk = abs(abs(q) - (DCELL*0.5 - 14.0)); float mark = step(max(mk.x, mk.y), 5.0)*step(min(mk.x, mk.y), 0.9)*(1.0 - line);
    m.alb = mix(vec3(0.19, 0.205, 0.24)*(0.78 + 0.44*tone), vec3(0.06, 0.07, 0.09), line); m.alb = mix(m.alb, vec3(0.46, 0.48, 0.53), mark);
    m.rough = mix(0.05 + 0.10*tone, 0.4, max(line, mark)) + 0.06*vn(p*0.7);
    float heat = id == 1 ? uWaferHeat : (h21(h.hc + 5.5) > 0.62 ? 0.25 + 0.7*h21(h.hc + 2.9) : 0.0);
    if (heat > 0.0) { T = waferT(p, c, heat)*(1.0 - 0.28*line)*(0.86 + 0.28*tone);
      float cr = fbm(vec3(p.xz*0.02, 3.0)); T *= 0.82 + 0.36*cr; m.rough = mix(m.rough, 0.6, smoothstep(0.1, 0.5, T)); }
    float rim = length(p.xz - c)/WR;       // frost gathers at the cold rim
    float fr = smoothstep(0.55, 0.75, fbm(vec3(p.xz*0.006, 7.0)))*smoothstep(0.72, 0.98, rim)*(1.0 - smoothstep(0.02, 0.2, T))*uFrost;
    m.alb = mix(m.alb, vec3(0.62, 0.70, 0.80), fr); m.rough = mix(m.rough, 0.9, fr); m.metal = mix(m.metal, 0.0, fr);
  }
  else if (id == 31) {      // the stage: dark turned metal with grooves in rings round each wafer
    vec2 hp = p.xz - WC; vec2 hc = uHall > 0.5 ? floor(hp/HP + 0.5) : vec2(0.0);
    vec2 off = hc == vec2(0.0) ? vec2(0.0) : (vec2(h21(hc + 1.3), h21(hc + 8.1)) - 0.5)*uHJ;
    float r = length(hp - hc*HP - off); float on = 1.0 - smoothstep(2500.0, 2560.0, r);
    float ring = smoothstep(0.30, 0.46, abs(fract(r/42.0) - 0.5));
    m.alb = mix(vec3(0.035, 0.04, 0.05), vec3(0.10, 0.11, 0.135)*(0.8 + 0.2*ring), on); m.rough = mix(0.55, 0.40 + 0.12*ring, on); m.metal = 1.0;
  }
  else if (id == 21) { m.alb = vec3(1.0, 0.74, 0.32); m.rough = 0.24; }
  else if (id == 33) {      // the sheet of metal poured for the layer being laid: glowing, and white along the edge where it is being carved
    float cr = fbm(p*0.16 + 5.0), edge = exp(-max(p.x - uCarve.x, 0.0)/5.0);
    m.alb = vec3(0.30, 0.30, 0.32); m.rough = 0.38; m.emi = heatColor(clamp(uK[14]*(0.82 + 0.36*cr) + 0.42*edge, 0.0, 1.0)); return m; }
  else if (id == 27) { m.alb = vec3(0.0); m.rough = 1.0; m.metal = 0.0; m.emi = mix(heatColor(0.56 + 0.44*pow(h31(floor(LAT*(p - vec3(0.0, uSparkY, 0.0))/uSparkS) + 3.3), 2.5)), vec3(0.55, 0.75, 1.0)*2.2, clamp(uK[13]*smoothstep(0.25, 0.9, (p.y - uSparkY)/uSparkH) + max(uK[13] - 1.0, 0.0), 0.0, 1.0))*uK[12]; return m; }       // an ember cools as it rises: with uK[13] it ends as a point of cold light
  else {
    // ───── the memory
    vec3 tint = vec3(0.70, 0.80, 1.0);
    if (id == 40) { m.alb = vec3(0.20, 0.19, 0.22); m.rough = 0.3; tint = vec3(0.45, 0.55, 1.0); }
    else if (id == 41 || id == 55) { m.alb = vec3(0.33, 0.32, 0.33); m.rough = 0.5; tint = vec3(1.0, 0.55, 0.30); }
    else if (id == 42 || id == 45 || id == 47) { m.alb = vec3(0.46, 0.46, 0.48); m.rough = 0.34; tint = vec3(1.0, 0.78, 0.40); }
    else if (id == 43 || id == 44 || id == 49 || id == 50) { m.alb = vec3(0.42, 0.43, 0.47); m.rough = 0.36; tint = vec3(0.55, 0.72, 1.0); }
    else if (id == 46 || id == 52 || id == 53 || id == 54 || id == 57) { m.alb = vec3(0.46, 0.47, 0.51); m.rough = 0.33; tint = vec3(0.66, 0.84, 1.0); }
    else if (id == 48 || id == 51 || id == 56) { m.alb = vec3(0.50, 0.51, 0.55); m.rough = 0.31; tint = vec3(0.82, 0.92, 1.0); }
    else if (id == 19 || id == 20) { m.alb = vec3(0.50, 0.51, 0.55); m.rough = 0.46; tint = vec3(1.0, 0.96, 0.88); }
    else if (id == 10 || id == 11) { m.alb = vec3(0.60, 0.62, 0.66); m.rough = 0.11; tint = vec3(0.5, 0.7, 1.0); }
    else if (id == 12) { m.alb = vec3(0.05); m.rough = 0.4; m.metal = 0.0; tint = vec3(0.3, 0.5, 1.0); }
    else if (id == 5) { m.alb = vec3(0.15, 0.17, 0.22); m.rough = 0.22; tint = vec3(0.4, 0.5, 0.9); }
    float k = h.by - (p.y - uObjY);           // how far below the layer being laid
    if (k < 0.0) {
      // ── still design: a line of light, or a box of glass
      float g = smoothstep(0.10, 0.55, h.mm);
      vec3 line = mix(vec3(1.0, 0.50, 0.16)*1.5, COLD*1.25 + 0.12, h.dr);           // drawn hot, then it cools
      float st = mod(uSimT + (h.inst > 0.0 ? h.inst*23.0 : 0.0), 9.0), dq = (h.rc.y + 0.5 - st)/0.6;      // the simulation: row after row
      float colp = pow(abs(sin(PI*st)), 3.0)*step(st, 8.2);        // the bit lines run through every cell: they answer faintly, the circuits at their ends strongly
      float pulse = h.reg <= 2 ? exp(-dq*dq) : (h.reg == 3 ? 0.08 + 0.2*colp : (h.reg <= 5 ? 0.25 + 0.75*colp : 0.3));
      line = mix(vec3(0.55, 0.07, 0.01), line, smoothstep(0.25, 0.9, h.sel))*(1.0 + 2.2*pulse*uSim)*h.sel*(h.inst > 0.0 ? 0.5 + 0.5*h.inst : 1.0);
      float write = smoothstep(-3.5, 0.0, k)*step(-900.0, -h.by);                    // just above the layer being laid: the light that writes it
      float lying = (1.0 - smoothstep(0.45, 0.78, uMorph))*g;                         // lying flat it is a layout drawn in colour; standing up it clears to glass
      vec3 plot = id == 40 ? vec3(0.10, 0.20, 0.95) : (id == 41 || id == 55 ? vec3(1.0, 0.26, 0.06) : (id == 42 || id == 45 || id == 47 ? vec3(1.0, 0.62, 0.12) :
                  (id == 43 || id == 49 || id == 50 ? vec3(0.16, 0.55, 1.0) : (id == 19 || id == 20 ? vec3(1.0, 0.88, 0.66) : (id == 5 ? vec3(0.05, 0.08, 0.3) : tint)))));
      vec3 glow = mix(tint, plot, 0.75);
      m.emi = (line*(1.0 - g)*uK[2] + glow*g*uK[8] + plot*lying*uK[10])*h.sel + COLD*write*uK[4];
      m.glass = g*(1.0 - 0.85*write)*(1.0 - 0.75*lying); m.tint = glow; m.alb = vec3(0.0); m.rough = mix(0.04, 0.7, lying); m.metal = 0.0;
      return m;
    }
    // ── metal
    if (id == 12) m.emi = COLD*uPower*(1.2 + 1.2*vn(vec3(p.x*0.7, 1.0, p.z*0.7))) + vec3(0.010, 0.022, 0.05);
    float pw = uPower*(h.by >= 900.0 ? 1.0 : 0.0);
    if (pw > 0.0 && h.inst <= 0.0) {
      // what it is doing: rows are written one after another; a cell that holds a one stays warm
      float w = uWrite - h.rc.y, now = step(0.0, w)*step(w, 1.0), done = step(1.0, w), act = now*sin(PI*clamp(w, 0.0, 1.0));
      if (h.reg == 0) { float b = float(bitAt(h.rc));
        float hold = b*(done*uK[0] + now*mix(1.0, uK[0], smoothstep(0.3, 1.0, w)));     // a one: the node is charged; at the moment it is written it flares
        if (id == 49) T = hold;
        else if (id == 50 || id == 42 || id == 45) T = hold*0.55;
        else if (id == 41) T = hold*0.36;
        else if (id == 40) T = max(hold*0.24, h.loc.z < -3.0 ? act*0.5 : 0.0);
        else if (id == 55) m.emi += COLD*act*3.0;
        if (id == 50) m.emi += COLD*(1.0 - b)*done*0.06;
      }
      else if (h.reg == 2 && id == 51) m.emi += COLD*(act*4.0 + 0.03);
      else if (h.reg == 3 && (id == 52 || id == 53)) { float r = clamp(floor(uWrite), 0.0, 7.0); float b = float((uBits[int(r)] >> (7 - int(h.rc.x))) & 1);
        float a2 = sin(PI*fract(uWrite))*step(uWrite, 7.999); m.emi += COLD*(0.06 + uK[1]*a2*(id == 52 ? b : 1.0 - b)); }
      else if (h.reg == 1) T = act*(id == 41 ? 0.55 : 0.3);
      else if (h.reg == 5 && h.loc.z < ${F(M.ZB + 14)}) { float r = clamp(floor(uWrite), 0.0, 7.0); T = sin(PI*fract(uWrite))*step(uWrite, 7.999)*float((uBits[int(r)] >> (7 - int(h.rc.x))) & 1)*(id == 41 ? 0.5 : 0.25); }
      else if (id == 54) m.emi += COLD*0.25;
    }
    if (h.inst > 0.0 && pw > 0.0 && h.reg == 0 && (id == 49 || id == 50)) T = 0.55*float(bitAt(h.rc));      // the other chips simply hold the same bits
    // freshly laid metal: white at the surface where it has just been poured, glowing for a while below
    if (h.by < 900.0) { float amt = h.inst > 0.0 ? 0.35 : 1.0; float cr = fbm(p*0.35 + 2.0);
      float near = uCarve.y > 0.0 && h.inst <= 0.0 ? exp(-max(uCarve.x - p.x, 0.0)/uK[7]) : 1.0;       // what the carving left behind has had time to cool
      T = max(T, amt*(uK[5]*smoothstep(4.5, 0.0, k)*near + uK[6]*smoothstep(20.0, 2.0, k)*(0.35 + 0.65*near))*(0.8 + 0.4*cr)); }
  }
  bool solid = id != 12 && id != 31;
  if (solid && id > 2 && id != 21) {
    float big = vn(p*0.11 + 9.0), sc = mix(0.5, fbm(p*0.9), lod);
    m.rough = clamp(m.rough + (sc - 0.5)*0.4 + (big - 0.5)*0.10, 0.05, 1.0); m.alb *= (0.72 + 0.56*sc)*(0.86 + 0.28*big);
    if (lod > 0.25) { vec3 bp = p*1.3; float b0 = fbm(bp);
      vec3 g = vec3(fbm(bp + vec3(0.2, 0.0, 0.0)) - b0, fbm(bp + vec3(0.0, 0.2, 0.0)) - b0, fbm(bp + vec3(0.0, 0.0, 0.2)) - b0)/0.2;
      n = normalize(n - 0.20*lod*(g - n*dot(g, n))); }
  }
  if (T > 0.0) { m.emi += heatColor(T); m.alb *= 1.0 - 0.5*T; }
  if (id == 19 || id == 20) {      // a little frost on the top metal, in broad patches away from the heat
    float fw = fbm(p*0.012 + 3.0);
    float fr = smoothstep(0.56, 0.70, fbm(p*0.07 + fw*4.0)*0.5 + fw*0.6)*smoothstep(0.30, 0.9, n.y)*uFrost*0.7*(1.0 - smoothstep(0.02, 0.2, T));
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
// Light that the working chip throws on what is around it, as two glowing patches over the array:
// the cells that hold a one (warm), and the row being written (cold). The caller checks that nothing is in the way.
vec3 fromHot(vec3 p, out vec3 l, out float dist){
  l = vec3(0.0, 1.0, 0.0); dist = 0.0; if (uPower <= 0.0 || uBuildY < 900.0) return vec3(0.0);
  bool row = rnd() < 0.5; float r = clamp(floor(uWrite), 0.0, 7.0);
  vec3 c = row ? vec3(XA + 96.0, 31.5, ZA + (r + 0.5)*CZ - 6.0) : vec3(XA + 96.0, 16.0, ZA + min(uWrite, 8.0)*CZ*0.5); c.y += uObjY;
  vec2 hf = row ? vec2(98.0, 1.2) : vec2(96.0, max(min(uWrite, 8.0)*CZ*0.5, 0.5));
  vec3 Le = row ? COLD*4.0*sin(PI*fract(uWrite))*step(uWrite, 7.999) : heatColor(0.60)*0.22;
  vec3 q = c + vec3((rnd()*2.0 - 1.0)*hf.x, 0.0, (rnd()*2.0 - 1.0)*hf.y);
  vec3 dvv = q - p; float d2 = dot(dvv, dvv); dist = sqrt(d2); l = dvv/dist;
  if (dist < 1.5 || l.y > -0.02) return vec3(0.0);
  return Le*(4.0*hf.x*hf.y*abs(l.y)/max(d2, 40.0))*2.0*uPower;
}
float pool(vec3 p){ return 1.0 - 0.88*smoothstep(uPool*0.25, uPool, length(p.xz)); }
vec3 env(vec3 rd, bool spec){
  vec3 c = uSky*(0.30 + 0.70*pow(1.0 - max(rd.y, 0.0), 3.0));
  c += uBox*smoothstep(0.78, 0.96, dot(rd, uBoxDir));
  c += uBack*smoothstep(0.015, 0.09, rd.y)*exp(-5.5*rd.y)*smoothstep(-0.3, 0.75, dot(normalize(rd.xz + 1e-5), uBackDir));
  if (uStars > 0.0 && rd.y > -0.02) {       // stars: small cold points, a few of them bright
    vec3 d = rd*190.0; vec3 cc = floor(d); float hh = h31(cc);
    if (hh > 0.972) { vec3 f = d - cc - 0.5 - (vec3(h31(cc + 1.7), h31(cc + 5.1), h31(cc + 9.3)) - 0.5)*0.5;
      float s = smoothstep(0.30, 0.0, length(f)); c += vec3(0.72, 0.84, 1.0)*s*s*(0.3 + 5.0*pow(fract(hh*91.7), 3.0))*uStars; } }
  if (spec && dot(rd, uKeyDir) > cos(uKeyCone)) c += min(uKeyCol/(PI*uKeyCone*uKeyCone), vec3(9.0));
  return c;
}
float glassRough(vec3 p){ p.y -= uObjY;
  float f = smoothstep(0.56, 0.84, fbm(p*0.03 + 11.0))*smoothstep(50.0, 68.0, p.y)*smoothstep(70.0, 175.0, length(p.xz));
  return 0.012 + uFrost*0.4*f;
}
// light hanging in the air over a wafer: the cold column that comes down on it, and the warm haze that rises off it while it is hot
float colInt(vec3 ro, vec3 rd, float tmax, vec2 c, float R, float fall, float sh){
  vec2 o = ro.xz - c; float a = dot(rd.xz, rd.xz); if (a < 1e-6) return 0.0;
  float b = dot(o, rd.xz), cc = dot(o, o) - R*R, disc = b*b - a*cc; if (disc <= 0.0) return 0.0;
  float s = sqrt(disc), t0 = max((-b - s)/a, 0.0), t1 = min((-b + s)/a, tmax); if (t1 <= t0) return 0.0;
  float acc = 0.0; for (int i = ZERO; i < 4; i++) { float tt = mix(t0, t1, (float(i) + 0.5)/4.0); vec3 pm = ro + rd*tt; float rr = length(pm.xz - c)/R;
    acc += exp(-rr*rr*sh)*exp(-max(pm.y + uLift, 0.0)/fall); }
  return acc*0.25*(t1 - t0);
}
vec3 columns(vec3 ro, vec3 rd, float tmax){
  vec3 acc = uKeyCol*(0.000011*uShaft*uOwn)*colInt(ro, rd, tmax, WC, WR*1.15, 5200.0, 2.4);
  if (uBeam.x > 0.0) acc += uKeyCol*(0.00002*uBeam.x)*colInt(ro, rd, tmax, vec2(0.0), uBeam.y, 5200.0, 3.0);
  if (uWaferHeat > 0.0) acc += heatColor(0.45 + 0.25*uWaferHeat)*(0.000022*uWaferHeat)*colInt(ro, rd, tmax, WC, WR*0.9, 520.0, 2.4);
  if (uHall > 0.5) for (int j = ZERO - 2; j <= 2; j++) for (int i = -2; i <= 2; i++) { vec2 hc = vec2(float(i), float(j)); if (hc == vec2(0.0)) continue;
    vec2 c = WC + hc*HP + (vec2(h21(hc + 1.3), h21(hc + 8.1)) - 0.5)*uHJ;
    acc += uKeyCol*(0.000008*uShaft)*colInt(ro, rd, tmax, c, WR*uCol.x, 5200.0, uCol.y);
    if (h21(hc + 5.5) > 0.62) acc += heatColor(0.6)*0.000012*colInt(ro, rd, tmax, c, WR*0.9, 520.0, 2.4); }
  return acc;
}
vec3 trace(vec3 ro, vec3 rd){
  vec3 L = vec3(0.0), thr = vec3(1.0);
  int med = mapG(ro) < 0.0 ? 1 : 0; bool spec = true, done = false; int diffB = 0, ch = -1, ev = 0; float ior = 1.46;
  // Up to three shadow rays wait at a time (0 fog or glow, 1 the key light, 2 the working chip). Each is followed by the same
  // cast as the path itself; glass on the way does not stop it.
  vec3 sO[3]; vec3 sD[3]; vec3 sC[3]; float sT[3]; int sM[3]; int sN[3]; sT[0] = -1.0; sT[1] = -1.0; sT[2] = -1.0;
  float travelled = 0.0; vec3 tintIn = vec3(1.0);
  const vec3 ABSORB = vec3(0.0024, 0.0013, 0.0009);
  int kind = 0;                 // what the next cast is for: 0 the path, 1 the normal at the surface just found, 2 a shadow ray
  vec3 hp = ro; int hid = 0; Hit h;
  for (int it = ZERO; it < uMaxEv*6; it++) {
    int si = -1;
    if (kind != 1) { for (int s = ZERO; s < 3; s++) { if (si < 0 && sT[s] > 0.0) si = s; } kind = si >= 0 ? 2 : 0; }
    if (kind == 0 && (done || ev >= uMaxEv)) break;
    vec3 cO = ro, cD = rd; float cT = 30000.0; int cM = med;
    if (kind == 2) { cO = sO[si]; cD = sD[si]; cT = sT[si]; cM = sM[si]; } else if (kind == 1) { cO = hp; cM = 3; }
    float t; int id; bool hit = shoot(cO, cD, cT, cM, t, id);
    if (kind == 2) {            // a shadow ray: lit if nothing solid was in the way
      if (!hit) { L += sC[si]; sT[si] = -1.0; }
      else { vec3 p = cO + cD*t; bool clear = id == 30 || (id >= 40 && id < 60 && p.y - uObjY >= gBY);
        if (clear && sN[si] < 14) { sN[si]++; float adv = id == 30 ? 0.06 : 0.6; if (id == 30) sM[si] = 1 - sM[si];
          sO[si] = p + cD*adv; sT[si] -= t + adv; if (sT[si] <= 0.0) { L += sC[si]; sT[si] = -1.0; } }
        else sT[si] = -1.0; }
      continue;
    }
    if (kind == 0) {            // the path has reached something, or left the scene
      h.reg = gReg; h.rc = gRC; h.loc = gLoc; h.mm = gMM; h.dr = gDr; h.by = gBY; h.inst = gInst; h.sel = gSel; h.hc = gHC;
      float tEnd = hit ? t : 30000.0; travelled += tEnd;
      if (med == 1) {
        if (uGlow > 0.0 && ev < 4 && uPower > 0.0) {        // the glass over the working chip carries its glow
          float ts = rnd()*tEnd; vec3 ps = ro + rd*ts; vec3 l2; float dist; vec3 Li = fromHot(ps, l2, dist);
          if (Li.r + Li.b > 0.0) { sO[0] = ps; sD[0] = l2; sT[0] = dist - 0.5; sM[0] = 1; sN[0] = 0; sC[0] = min(thr*exp(-ABSORB*ts)*Li*(uGlow*tEnd/(4.0*PI)), vec3(4.0)); }
        }
        thr *= exp(-ABSORB*tEnd);
      }
      else if (med == 2) thr *= exp(-(1.0 - tintIn)*uK[3]*tEnd);
      else {
        if (ev == 0) L += thr*columns(ro, rd, tEnd);
        if (uFogD > 0.0) {
          float tf = min(tEnd, 2400.0); vec3 pm = ro + rd*(tf*0.5); float dens = uFogD*exp(-max(pm.y + uLift, 0.0)/uFogH); float Tr = exp(-dens*tf);
          if (ev == 0) { float ts = rnd()*tf; vec3 ps = ro + rd*ts; float dl = uFogD*exp(-max(ps.y + uLift, 0.0)/uFogH);
            sO[0] = ps; sD[0] = coneDir(uKeyDir, uKeyCone); sT[0] = 9000.0; sM[0] = 0; sN[0] = 0; sC[0] = thr*exp(-dens*ts)*dl*uKeyCol*pool(ps)*tf*(1.0/(4.0*PI)); }
          L += thr*(1.0 - Tr)*uFogCol; thr *= Tr;
        }
      }
      if (!hit && uK[15] > 1.5) return vec3(float(gIter)/720.0, float(med)*0.5, float(ev)/20.0);       // for finding out why a ray ended in nothing
      if (!hit) { L += thr*env(rd, spec); done = true; continue; }
      hp = ro + rd*tEnd; hid = id;
      if (med == 2) { ro = hp + rd*0.03; med = 0; ev++; continue; }        // out of the far side of a box of the layout: straight on
      if (id == 30) {                 // the face of the block
        vec3 p = hp; vec3 n = nrmG(p); if (med == 1) n = -n;
        float gr = glassRough(p); vec3 hn = gr > 0.02 ? ggxNormal(n, gr*gr) : n;
        float cosi = max(dot(-rd, hn), 0.0); float eta = med == 1 ? 1.46 : 1.0/1.46;
        float Fr = 0.035 + 0.965*pow(1.0 - cosi, 5.0);
        vec3 rf = refract(rd, hn, eta); if (dot(rf, rf) < 1e-6) Fr = 1.0;
        if (rnd() < Fr) { rd = reflect(rd, hn); if (dot(rd, n) < 0.0) rd = reflect(rd, n); ro = p + n*0.04; }
        else { rd = normalize(rf); ro = p - n*0.04; med = med == 1 ? 0 : 1; }
        ev++; continue;
      }
      kind = 1; continue;       // next, the normal there
    }
    // the normal of the surface is in gN: shade it and choose where the path goes on
    kind = 0; ev++; vec3 p = hp; id = hid; vec3 n = gN;
    if (uK[15] > 0.5) return vec3(float(id)/60.0, float(h.reg + 1)/10.0, clamp(0.5 + p.y*0.01, 0.0, 1.0));       // for finding out what a surface is
    if (dot(n, rd) > 0.0) n = -n;
    Mat m = getMat(id, h, p, n, diffB == 0 ? clamp(170.0/travelled, 0.0, 1.0) : 0.0);
    vec3 cap = diffB > 0 ? vec3(5.0) : vec3(1e9);
    if (h.sel < 0.999 && id >= 40 && id < 60 && rnd() > h.sel) { L += min(thr*m.emi, cap); ro = p - n*0.03; med = 2; tintIn = vec3(1.0); continue; }
    if (m.glass > 0.0 && rnd() < m.glass) {      // a box of the layout while it is glass: its faces catch the light, the rest lets it through
      float cosi = max(dot(-rd, n), 0.0), rim = pow(1.0 - cosi, 3.0), Fr = (0.04 + 0.96*pow(1.0 - cosi, 5.0))*h.sel;
      L += min(thr*(m.emi + m.tint*rim*uK[9]*h.sel), cap);
      if (rnd() < Fr) { rd = reflect(rd, n); ro = p + n*0.03; }
      else { thr *= mix(vec3(1.0), mix(vec3(1.0), m.tint, 0.5), uK[11]*h.sel); ro = p - n*0.03; med = 2; tintIn = vec3(1.0); }
      continue;
    }
    bool lit = id >= 40 && id < 60 && h.reg == 0 && uPower > 0.0;
    if (spec || !lit) L += min(thr*m.emi, cap);
    vec3 wo = -rd;
    if (m.rough >= 0.12 || m.metal < 0.5) {
      vec3 ps = p + n*0.06;
      vec3 ld = coneDir(uKeyDir, uKeyCone); float nl = dot(n, ld);
      if (nl > 0.0) { sO[1] = ps; sD[1] = ld; sT[1] = 9000.0; sM[1] = med; sN[1] = 0; sC[1] = min(thr*evalBsdf(n, wo, ld, m)*uKeyCol*(nl*pool(p)), cap); }
      if (uPower > 0.0) { vec3 l2; float dist; vec3 Li = fromHot(ps, l2, dist); float nl2 = dot(n, l2);
        if (nl2 > 0.0 && Li.r + Li.b > 0.0) { sO[2] = ps; sD[2] = l2; sT[2] = dist - 0.5; sM[2] = med; sN[2] = 0; sC[2] = min(thr*evalBsdf(n, wo, l2, m)*Li*nl2, cap); } }
    }
    vec3 wi, w; bool sp;
    if (!sampleBsdf(n, wo, m, wi, w, sp)) { done = true; continue; }
    thr *= w; spec = sp; ro = p + n*0.05; rd = wi;
    if (!sp) { diffB++; if (diffB > 3) done = true; }
    if (!done && ev > 4) { float q = min(max(thr.r, max(thr.g, thr.b)), 1.0); if (rnd() > q) done = true; else thr /= max(q, 1e-3); }
  }
  if (ch >= 0) L *= 3.0*vec3(ch == 0 ? 1.0 : 0.0, ch == 1 ? 1.0 : 0.0, ch == 2 ? 1.0 : 0.0);      // one colour of light per path: glass splits them
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
const VS = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
const PT = HEAD + parts + CHIP + BODY;

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

// Shaders compile in the background. Asking for the result before it is ready blocks the GPU, and a long block loses the context.
function startProgram(fs) {
  const p = gl.createProgram(); p.sh = [];
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(p, s); p.sh.push(s); }
  gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
  const loc = {}; p.u = n => loc[n] ?? (loc[n] = gl.getUniformLocation(p, n)); return p;
}
async function finishProgram(name, p) {
  if (par) while (!gl.getProgramParameter(p, par.COMPLETION_STATUS_KHR)) { for (let i = 0; i < 400; i++) await tick(); }
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + (gl.getShaderInfoLog(p.sh[1]) || '') + ' ' + (gl.getProgramInfoLog(p) || ''));
  return p;
}
const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
let P = null;
const ready = (async () => {
  log('compiling shaders…');
  const t0 = performance.now(), src = { pt: PT, resolve: RESOLVE, den: DENOISE, pre: PRE, down: DOWN, up: UP, final: FINAL }, out = {};
  for (const k in src) out[k] = startProgram(src[k]);
  for (const k in out) await finishProgram(k, out[k]);
  P = out; window.__compile = Math.round(performance.now() - t0); window.__ready = true; log('ready (' + window.__compile + ' ms)');
})().catch(e => { window.__err += String(e) + '\n'; log('shader error:\n' + window.__err); });

function tex(w, h, hf, linear) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, hf ? gl.RGBA16F : gl.RGBA32F, w, h, 0, gl.RGBA, hf ? gl.HALF_FLOAT : gl.FLOAT, null);
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
// The lines of the whole schematic as a distance field in a texture: one lookup instead of five thousand segments.
function linesTexture() {
  const { nx, nz, x0, z0, w, h, far } = TEX, data = new Float32Array(nx * nz).fill(far);
  for (const g of M.expand().segs) {
    const ax = g.a[0], az = g.a[1], bx = g.b[0] - ax, bz = g.b[1] - az, l2 = bx * bx + bz * bz || 1e-9;
    const i0 = Math.max(0, Math.floor((Math.min(g.a[0], g.b[0]) - far - x0) / w * nx)), i1 = Math.min(nx - 1, Math.ceil((Math.max(g.a[0], g.b[0]) + far - x0) / w * nx));
    const j0 = Math.max(0, Math.floor((Math.min(g.a[1], g.b[1]) - far - z0) / h * nz)), j1 = Math.min(nz - 1, Math.ceil((Math.max(g.a[1], g.b[1]) + far - z0) / h * nz));
    for (let j = j0; j <= j1; j++) { const z = z0 + (j + 0.5) / nz * h;
      for (let i = i0; i <= i1; i++) { const x = x0 + (i + 0.5) / nx * w, k = Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / l2));
        const dd = Math.hypot(x - ax - bx * k, z - az - bz * k), q = j * nx + i; if (dd < data[q]) data[q] = dd; } }
  }
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nx, nz, 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
const linesTex = linesTexture();
// bond wires: one arc per pad, rising and leaning outward toward the light far above; `grow` 0..1 is how much of it exists
function wirePoints(star, grow) {
  const pts = new Float32Array(NW * 21), bnd = new Float32Array(NW * 4);
  M.PADS.forEach((pd, w) => {
    const a = [pd[0], 60, pd[1]], c = [a[0] + Math.sign(a[0]) * 46, a[1] + 150, a[2] + Math.sign(a[2] || 1) * 22];
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
// Everything a shot can set. The light that plays the star stands high over the wafer; its mirror image on flat metal
// falls where a camera near the floor never looks.
const DEF = { w: 960, h: 540, spp: 32, fov: 24, aper: 0, focus: 400, tile: 280, maxEv: 22,
  obj: 1, lift: 0, buildY: 1000, morph: 1, tileUp: 1, peri: 1, sim: 0, simT: 0, power: 1, write: 8, cand: 0, pick: 0, vari: 0, ghost: 0, wires: 1,
  waferHeat: 0, hall: 1, shaft: 1, sparks: 0, sparkY: 60, sparkR: 150, sparkS: 8, sparkH: 34, sparkX: [0, 0], sparkL: 1, sparkA: 1, carve: [1e4, 0], objY: 0, own: 1, hp: 9000, hj: 1800, col: [1.1, 2.4], beam: [0, 300], frost: 1, glow: 0.004, pool: 2600, stars: 1, disp: 0,
  keyDir: [-0.30, 0.90, 0.32], keyCol: [0.5, 0.7, 1.0], keyI: 8, keyCone: 0.07, box: [0.16, 0.25, 0.45], boxDir: [0.2, 0.75, 0.6],
  back: [0.55, 0.85, 1.5], backDir: [0.1, -1], fogD: 0.0004, fogH: 60, fogCol: [0.012, 0.022, 0.045], sky: [0.004, 0.007, 0.014], star: [-600, 5200, 1500],
  // knobs, so that a look can be tried without compiling again: 0 heat of a stored one, 1 active bit line, 2 schematic line, 3 absorption
  // in the layout of light, 4 the light that writes, 5 metal just poured, 6 metal cooling, 8 glow of the layout of light, 9 its rim,
  // 7 how far behind the carving the metal stays hot, 10 the colour of the flat layout, 11 tint per face, 12 sparks, 13 an ember cools to
  // a cold point as it rises, 14 how hot the poured sheet is, 15 debug pictures
  k: [0.76, 1.5, 3.0, 0.02, 1.2, 0.62, 0.34, 60, 0.03, 0.4, 0.8, 0.10, 0.6, 0, 0.6, 0],
  post: {}, to: 'save', ext: 'jpg', q: 0.93 };
// how far each layer has come up off the plane of the schematic: the second half of the change, the lower layers first
const riseOf = morph => new Float32Array(Object.values(M.RANK).map(r => { const t = Math.min(1, Math.max(0, (morph - 0.4) / 0.6 * 1.5 - r * 0.5)); return t * t * (3 - 2 * t); }));
const status = { state: 'idle' }; window.__status = status; let cancel = false;
async function render(shot) {
  await ready; if (!P) throw new Error('shader failed: ' + window.__err);
  const s = Object.assign({}, DEF, shot); const w = s.w, h = s.h, spp = s.spp;
  const p = P.pt;
  cancel = false; canvas.width = w; canvas.height = h; alloc(w, h);
  for (const t of [RT.a, RT.b]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  const ts = s.tile, tiles = [];
  for (let y = 0; y < h; y += ts) for (let x = 0; x < w; x += ts) tiles.push([x, y, Math.min(ts, w - x), Math.min(ts, h - y)]);
  const nrm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const kd = nrm(s.keyDir), bd = nrm(s.boxDir), kb = nrm(s.backDir), t0 = performance.now(), wp = wirePoints(s.star, s.buildY >= 900 ? s.wires : 0);
  const dist = Math.hypot(s.cam[0] - s.tgt[0], s.cam[1] - s.tgt[1], s.cam[2] - s.tgt[2]);
  const line = s.line ?? Math.max(0.05, 0.85 * dist * 2 * Math.tan(s.fov * Math.PI / 360) / h);          // lines of the schematic are about two pixels wide whatever the distance
  Object.assign(status, { state: 'rendering', name: s.name, frame: 0, spp, w, h, ms: 0, error: null });
  let src = RT.a, dst = RT.b;
  const f1 = (n, v) => gl.uniform1f(p.u(n), v), f3 = (n, v) => gl.uniform3f(p.u(n), v[0], v[1], v[2]);
  for (let frame = 0; frame < spp && !cancel; frame++) {
    gl.useProgram(p); gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, w, h);
    bind(p, 0, 'uPrev', src.t); bind(p, 1, 'uLines', linesTex); gl.uniform1fv(p.u('uK[0]'), new Float32Array(s.k)); gl.uniform1fv(p.u('uR[0]'), riseOf(s.morph));
    gl.uniform2f(p.u('uRes'), w, h); gl.uniform1i(p.u('uFrame'), frame + (s.seed || 0) * 4099); gl.uniform1i(p.u('uMaxEv'), s.maxEv);
    f3('uCamPos', s.cam); f3('uCamTgt', s.tgt); f1('uFov', s.fov); f1('uAper', s.aper); f1('uFocus', s.focus ?? dist);
    f3('uKeyDir', kd); f3('uKeyCol', s.keyCol.map(v => v * s.keyI)); f1('uKeyCone', s.keyCone);
    f1('uFogD', s.fogD); f1('uFogH', s.fogH); f3('uFogCol', s.fogCol); f3('uSky', s.sky); f3('uBox', s.box); f3('uBoxDir', bd); f3('uBack', s.back); gl.uniform2f(p.u('uBackDir'), kb[0], kb[1]);
    gl.uniform3fv(p.u('uWire[0]'), wp.pts); gl.uniform4fv(p.u('uWireB[0]'), wp.bnd); gl.uniform1iv(p.u('uBits[0]'), new Int32Array(M.BITS));
    f1('uLift', s.lift); f1('uBuildY', s.buildY); f1('uMorph', s.morph); f1('uLine', line); f1('uTile', s.tileUp); f1('uPeri', s.peri); f1('uSim', s.sim); f1('uSimT', s.simT);
    f1('uPower', s.power); f1('uWrite', s.write); f1('uCand', s.cand); f1('uPick', s.pick); f1('uVar', s.vari); f1('uGhost', s.ghost);
    f1('uWaferHeat', s.waferHeat); f1('uHall', s.hall); f1('uShaft', s.shaft); f1('uSparks', s.sparks); f1('uSparkY', s.sparkY); f1('uSparkR', s.sparkR); f1('uSparkS', s.sparkS); f1('uSparkH', s.sparkH);
    f1('uFrost', s.frost); f1('uGlow', s.glow); f1('uPool', s.pool); f1('uStars', s.stars); f1('uDisp', s.disp); f1('uObj', s.obj);
    f1('uObjY', s.objY); f1('uSparkL', s.sparkL); f1('uSparkA', s.sparkA); f1('uOwn', s.own); f1('uHP', s.hp); f1('uHJ', s.hj); gl.uniform2f(p.u('uCol'), s.col[0], s.col[1]); gl.uniform2f(p.u('uBeam'), s.beam[0], s.beam[1]); gl.uniform2f(p.u('uCarve'), s.carve[0], s.carve[1]); gl.uniform2f(p.u('uSparkX'), s.sparkX[0], s.sparkX[1]);
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
  const q = Object.assign({ exp: 1.15, bloom: 0.34, th: 1.0, ca: 0.010, vig: 0.55, grain: 0.03, den: 0 }, o); const { w, h } = RT;
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
async function queue(list) { window.__q = { done: [], cur: null, all: false };
  for (const s of list) { window.__q.cur = s.name; try { await render(s); window.__q.done.push([s.name, 'done', status.ms]); } catch (e) { status.state = 'error'; status.error = String(e); window.__q.done.push([s.name, 'error', String(e)]); } }
  window.__q.all = true; status.state = 'idle'; }
// several saved pictures side by side in one file
async function sheet(names, cols, out, cw = 480) {
  const imgs = await Promise.all(names.map(n => fetch('/' + n + '?' + Date.now()).then(r => r.blob()).then(b => createImageBitmap(b))));
  const ch2 = Math.round(cw * imgs[0].height / imgs[0].width), rows = Math.ceil(imgs.length / cols);
  const cv = new OffscreenCanvas(cw * cols, ch2 * rows), cx = cv.getContext('2d');
  imgs.forEach((im, i) => cx.drawImage(im, (i % cols) * cw, Math.floor(i / cols) * ch2, cw, ch2));
  const b = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return (await fetch('/save/' + out + '.jpg', { method: 'POST', body: b })).text();
}
// a camera from where it looks: side (degrees, 0 = front, negative = from the left), height above the horizon, distance, target
const view = (az, el, r, q = [0, 20, 0], fov = 24) => { const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return { cam: [q[0] + Math.sin(a) * Math.cos(e) * r, q[1] + Math.sin(e) * r, q[2] + Math.cos(a) * Math.cos(e) * r], tgt: q, fov }; };
window.KV = {
  render: shot => { status.state = 'starting'; render(shot).catch(e => { status.state = 'error'; status.error = String(e); }); return 'started'; },
  queue: list => { queue(list); return 'queued ' + list.length; }, sheet, view,
  repost: async (o, name) => { await post(o); return save(name); },
  cancel: () => { cancel = true; }, status, float: !!okF, size: PT.length,
};
