// The circuit of the second version: a 64-bit SRAM. 8 x 8 six-transistor cells, a row decoder with word-line drivers,
// precharge, write drivers and sense amplifiers. It is described once, two ways: as the boxes of a layout and as the
// line segments of a schematic. Both carry a tag, and a line with a tag becomes the boxes with the same tag.
// Repeated parts are written once as a template and folded: one bit cell, one decoder row, one column.
// Units are scene metres; x right, y up, z toward the viewer. The schematic is drawn with VDD at the far side (z-).

export const N = 8;                                   // rows and columns
export const CX = 24, CZ = 18;                        // pitch of a bit cell
export const XA = -69, ZA = -88;                      // far left corner of the array
export const XB = XA + N * CX, ZB = ZA + N * CZ;      // near right corner: 123, 56
export const DIE = { hw: 160, hd: 132, cellW: 372, cellD: 296, glass: 68 };
export const LAYER = { well: [0, 0.5], act: [0, 1.4], poly: [1.4, 5.0], con: [1.4, 12], m1: [12, 15.2], br: [17, 19], v1: [15.2, 22],
  m2: [22, 25.4], v2: [25.4, 28], m3: [28, 31], capB: [32, 34.5], capD: [34.5, 36.5], capT: [36.5, 39], top: [50, 59] };
// the order in which layers come up out of the schematic and are later laid in metal (0 first .. 1 last)
export const RANK = { well: 0, act: 0.05, poly: 0.15, con: 0.28, m1: 0.4, br: 0.5, v1: 0.52, m2: 0.62, v2: 0.7, m3: 0.76, capB: 0.82, capD: 0.84, capT: 0.86, top: 1 };
export const BITS = [0x81, 0xC3, 0xA5, 0x99, 0x81, 0x81, 0x81, 0x81];     // what gets written, row by row
export const bit = (r, c) => (BITS[r] >> (N - 1 - c)) & 1;

// ───────── layout
const bx = (layer, tag, x0, x1, z0, z1, y) => ({ layer, tag, lo: [x0, (y || LAYER[layer])[0], z0], hi: [x1, (y || LAYER[layer])[1], z1] });
const sq = (layer, tag, x, z, h, y) => bx(layer, tag, x - h, x + h, z - h, z + h, y);
// a small multi-finger transistor: active, n gate fingers along z (pitch 3) with their strap, metal-1 strips and one contact on source and drain
const dev = (tag, cx, cz, n, hl) => ({ tag, cx, cz, n, hl });
export function devBoxes(d, detail = true) {
  const { tag, cx, cz, n, hl } = d, p = 3, out = [bx('act', tag, cx - (n + 1) * p / 2, cx + (n + 1) * p / 2, cz - hl + 0.8, cz + hl - 0.8)];
  if (!detail) {         // seen from far, or while it is still changing: the fingers and the strips as one slab each
    out.push(bx('poly', tag, cx - (n - 1) * p / 2 - 0.6, cx + (n - 1) * p / 2 + 0.6, cz - hl - 1.3, cz + hl), bx('m1', tag, cx - n * p / 2 - 0.6, cx + n * p / 2 + 0.6, cz - hl + 1.3, cz + hl - 1.3));
    return out;
  }
  for (let i = 0; i < n; i++) { const x = cx + (i - (n - 1) / 2) * p; out.push(bx('poly', tag, x - 0.6, x + 0.6, cz - hl, cz + hl)); }
  out.push(bx('poly', tag, cx - (n - 1) * p / 2 - 0.6, cx + (n - 1) * p / 2 + 0.6, cz - hl - 1.3, cz - hl));
  for (let j = 0; j <= n; j++) { const x = cx + (j - n / 2) * p; out.push(bx('m1', tag, x - 0.6, x + 0.6, cz - hl + 1.3, cz + hl - 1.3), sq('con', tag, x, cz, 0.45)); }
  return out;
}
// one bit cell, about its own centre. Left and right n-strips carry the access and pull-down transistors, the two short
// strips in the middle the pull-ups; the two straps on metal 1 are the storage nodes, and the bridge crosses one over the other.
const CELL = [
  bx('act', 'AL', -9.3, -6.9, -9, 9), bx('act', 'AR', 6.9, 9.3, -9, 9), bx('act', 'L', -3.6, -1.4, -2.2, 7.2), bx('act', 'R', 1.4, 3.6, -2.2, 7.2),
  bx('poly', 'WL', -12, 12, -6.8, -5.2), bx('poly', 'L', -10.7, 0.2, 0.0, 1.6), bx('poly', 'R', -0.2, 10.7, 3.4, 5.0),
  sq('con', 'PWR', -8.1, 6.6, .55), sq('con', 'Q', -8.1, -2.6, .55), sq('con', 'BL', -8.1, -7.6, .55),
  sq('con', 'PWR', 8.1, 7.2, .55), sq('con', 'QB', 8.1, -1.0, .55), sq('con', 'BLB', 8.1, -7.6, .55),
  sq('con', 'PWR', -2.5, 5.0, .55), sq('con', 'Q', -2.5, -1.2, .55), sq('con', 'PWR', 2.5, 6.2, .55), sq('con', 'QB', 2.5, 1.2, .55),
  sq('con', 'QB', -0.9, 0.8, .5, [1.4, 17]), sq('con', 'Q', 0.6, 4.2, .5),
  bx('m1', 'Q', -9.0, 1.2, -3.2, -0.6), bx('m1', 'Q', 0.0, 1.2, -0.6, 4.9), bx('m1', 'QB', 1.9, 9.0, -1.6, 2.0),
  bx('m1', 'PWR', -11.8, -7.1, 5.6, 7.6), bx('m1', 'PWR', 7.1, 11.8, 6.2, 8.2), sq('m1', 'PWR', -2.5, 5.0, 1.0), sq('m1', 'PWR', 2.5, 6.2, 1.0),
  sq('m1', 'BL', -8.1, -7.6, 1.0), sq('m1', 'BLB', 8.1, -7.6, 1.0),
  bx('br', 'QB', -1.45, 2.6, 0.2, 1.4), sq('v1', 'QB', 2.3, 0.8, .45, [15.2, 17]),
  sq('v1', 'BL', -8.1, -7.6, .5), sq('v1', 'BLB', 8.1, -7.6, .5), sq('v1', 'PWR', -2.5, 5.0, .5), sq('v1', 'PWR', 2.5, 6.2, .5),
  sq('v1', 'PWR', -10.8, 6.6, .5, [15.2, 28]), sq('v1', 'PWR', 10.8, 7.2, .5, [15.2, 28]),
  sq('v1', 'WL', -12, -6.0, .5, [5.0, 28]), sq('v1', 'WL', 12, -6.0, .5, [5.0, 28]),
];
// one row: decoder gate and word-line driver to the left of the array (x is absolute, z about the row centre), and the two tracks of the row
const ROW_DEVS = [dev('DEC', XA - 41, -4.6, 3, 2.8), dev('DEC', XA - 41, 4.6, 3, 2.8), dev('DRV', XA - 25, -4.6, 4, 2.8), dev('DRV', XA - 25, 4.6, 4, 2.8)];
const ROW_DEV = [
  bx('m1', 'DEC', XA - 35.4, XA - 31.2, -0.6, 0.6), bx('m1', 'DRV', XA - 16.6, XA - 14.4, -7.4, 7.4), sq('v1', 'DRV', XA - 15.5, -6.0, .5, [15.2, 28]),
];
const ROW_TRK = [bx('m3', 'TWL', XA - 18, XB + 2, -7.0, -5.0), bx('m3', 'TGND', XA - 2, XB + 12, 5.9, 7.9)];
// one column (x about the column centre, z absolute): tracks, precharge above the array, write driver and sense amplifier below it
const COL_TRK = [
  bx('m2', 'TBL', -9.2, -7.0, ZA - 16, ZB + 30), bx('m2', 'TBLB', 7.0, 9.2, ZA - 16, ZB + 30),
  bx('m2', 'TVDD', -3.4, -1.6, ZA - 30, ZB + 2), bx('m2', 'TVDD', 1.6, 3.4, ZA - 30, ZB + 2),
  bx('well', 'WELL', -5.4, 5.4, ZA - 1, ZB + 1),
  sq('v2', 'TVDD', -2.5, ZA - 28, .7, [25.4, 50]), sq('v2', 'TVDD', 2.5, ZA - 28, .7, [25.4, 50]),
];
const COL_PRE_DEVS = [dev('PRE', 0, ZA - 9, 3, 3.0)];
const COL_PRE = [sq('v1', 'PRE', 0, ZA - 13.6, .5, [5.0, 28])];
const COL_IO_DEVS = [dev('WR', 0, ZB + 9, 4, 3.4), dev('SA', 0, ZB + 21, 5, 3.0), dev('SAL', -5.2, ZB + 33, 2, 3.0), dev('SAL', 5.2, ZB + 33, 2, 3.0)];
const COL_IO = [
  bx('m1', 'SAL', -6.4, 6.4, ZB + 25.6, ZB + 26.8), bx('br', 'SAL', -6.4, 6.4, ZB + 27.4, ZB + 28.6),
  sq('v1', 'SAL', -6.0, ZB + 28, .45, [15.2, 17]), sq('v1', 'SAL', 6.0, ZB + 28, .45, [15.2, 17]),
  sq('v1', 'WR', 0, ZB + 15.4, .5, [5.0, 28]), sq('v1', 'SAL', 0, ZB + 38, .6, [15.2, 28]),
];
// address lines: true and complement of each of the three bits, running down the decoder; a row taps one of each pair
export const busX = (k, v) => XA - 53 + k * 4.8 + (v ? 0 : 2.4);
export const tapZ = k => -6.4 + k * 6.4;
export const PADS = [[-146, -84, 'A0'], [-146, -42, 'A1'], [-146, 0, 'A2'], [-146, 42, 'CLK'], [-146, 84, 'WE'], [146, -84, 'VDD'], [146, -42, 'D'], [146, 0, 'Q'], [146, 42, 'EN'], [146, 84, 'GND']];
export const PADH = 12;
// what is there once: the buses, the control block with its decoupling capacitor, and the top metal with the pads
const BUS = [
  ...[0, 1, 2].flatMap(k => [1, 0].map(v => bx('m2', 'ADDR', busX(k, v) - 0.7, busX(k, v) + 0.7, ZA - 4, ZB + 26))),
  bx('m3', 'TGND', XB + 8, XB + 12, ZA + 4, 122), sq('v2', 'TGND', XB + 10, 119, .9, [31, 50]),
  bx('m3', 'CLKB', XA - 18, XB + 2, ZA - 14.6, ZA - 12.6), bx('m3', 'DBUS', XA - 6, XB + 14, ZB + 14.4, ZB + 16.4), bx('m3', 'QBUS', XA - 6, XB + 14, ZB + 37, ZB + 39),
];
const CTL_DEVS = [dev('CTL', XA - 31, ZB + 13, 7, 3.4), dev('CTL', XA - 31, ZB + 25, 7, 3.4), dev('CTL', XA - 31, ZB + 37, 7, 3.4)];
const CTL = [
  bx('capB', 'CAP', XA - 56, XA - 8, ZB + 5, ZB + 47), bx('capD', 'CAPD', XA - 55.6, XA - 8.4, ZB + 5.4, ZB + 46.6), bx('capT', 'CAP', XA - 53, XA - 11, ZB + 8, ZB + 44),
];
const TOP = [
  bx('top', 'PWR', -150, 150, -127, -113), bx('top', 'PWR', -150, 150, 113, 127), bx('top', 'PWR', 139, 153, -113, -96), bx('top', 'PWR', 139, 153, 96, 113),
  ...PADS.map(p => sq('top', 'PAD', p[0], p[1], PADH)),
  ...PADS.filter(p => p[2] !== 'VDD' && p[2] !== 'GND').map(p => sq('v2', 'PAD', p[0] - Math.sign(p[0]) * 9, p[1], .9, [28, 50])),
  ...PADS.filter(p => p[0] < 0).map(p => bx('m3', 'PAD', -138, XA - 53.6, p[1] - 0.8, p[1] + 0.8)),
  ...PADS.filter(p => p[0] > 0 && p[2] !== 'VDD' && p[2] !== 'GND').map(p => bx('m3', 'PAD', XB + 14, 138, p[1] - 0.8, p[1] + 0.8)),
];

// ───────── schematic (lines on the plane y = 0; every one is horizontal or vertical so that it can become a box)
const sg = (tag, x0, z0, x1, z1) => ({ tag, a: [x0, z0], b: [x1, z1] });
const rect = (tag, x0, z0, x1, z1) => [sg(tag, x0, z0, x1, z0), sg(tag, x1, z0, x1, z1), sg(tag, x1, z1, x0, z1), sg(tag, x0, z1, x0, z0)];
// a transistor whose channel runs along z: source at (x, z - 1.7), drain at (x, z + 1.7), gate plate on the side `s`; p-type gets a small square
function mosV(tag, x, z, s, p) {
  const out = [sg(tag, x, z - 1.7, x, z - 1.0), sg(tag, x, z - 1.0, x + s * 0.8, z - 1.0), sg(tag, x + s * 0.8, z - 1.0, x + s * 0.8, z + 1.0), sg(tag, x + s * 0.8, z + 1.0, x, z + 1.0), sg(tag, x, z + 1.0, x, z + 1.7),
    sg(tag, x + s * 1.3, z - 0.85, x + s * 1.3, z + 0.85)];
  if (p) out.push(...rect(tag, x + s * 1.3, z - 0.25, x + s * 1.8, z + 0.25)); else out.push(sg(tag, x + s * 1.3, z, x + s * 1.8, z));
  return out;
}
// a transistor whose channel runs along x, gate plate on the far side (z-)
function mosH(tag, x, z) {
  return [sg(tag, x - 1.7, z, x - 1.0, z), sg(tag, x - 1.0, z, x - 1.0, z - 0.8), sg(tag, x - 1.0, z - 0.8, x + 1.0, z - 0.8), sg(tag, x + 1.0, z - 0.8, x + 1.0, z), sg(tag, x + 1.0, z, x + 1.7, z),
    sg(tag, x - 0.85, z - 1.3, x + 0.85, z - 1.3)];
}
const S_CELL = [
  // left inverter and right inverter
  ...mosV('L', -5, -3.6, 1, true), ...mosV('L', -5, 2.9, 1, false), sg('L', -3.2, -3.6, -3.2, 2.9), sg('L', -5, -1.9, -5, 1.2),
  ...mosV('R', 5, -3.6, -1, true), ...mosV('R', 5, 2.9, -1, false), sg('R', 3.2, -3.6, 3.2, 2.9), sg('R', 5, -1.9, 5, 1.2),
  // each output goes to the other one's gates
  sg('Q', -5, -1.0, 3.2, -1.0), sg('QB', 5, 0.2, -3.2, 0.2),
  // access transistors between the bit lines and the two nodes, gates up to the word line
  ...mosH('AL', -8.2, 0.8), sg('AL', -11, 0.8, -9.9, 0.8), sg('AL', -6.5, 0.8, -5, 0.8), sg('AL', -8.2, -0.5, -8.2, -8),
  ...mosH('AR', 8.2, 0.8), sg('AR', 11, 0.8, 9.9, 0.8), sg('AR', 6.5, 0.8, 5, 0.8), sg('AR', 8.2, -0.5, 8.2, -8),
  // supply above, ground below
  sg('PWR', -5, -5.3, 5, -5.3), sg('PWR', 0, -5.3, 0, -6.1), sg('PWR', -0.9, -6.1, 0.9, -6.1),
  sg('PWR', -5, 4.6, 5, 4.6), sg('PWR', 0, 4.6, 0, 5.4), sg('PWR', -1.4, 5.4, 1.4, 5.4), sg('PWR', -0.8, 6.0, 0.8, 6.0),
  sg('WL', -12, -8, 12, -8), sg('BL', -11, -9, -11, 9), sg('BLB', 11, -9, 11, 9),
];
const S_ROW_DEV = [   // an AND of three address lines, then a buffer onto the word line
  ...rect('DEC', XA - 44, -10.8, XA - 36, -5.2), ...rect('DRV', XA - 28, -10.2, XA - 21, -5.8), sg('DEC', XA - 36, -8, XA - 28, -8), sg('DRV', XA - 21, -8, XA - 12, -8),
];
const S_ROW_TRK = [sg('TWL', XA - 12, -8, XB, -8)];
const S_COL_TRK = [sg('TBL', -11, ZA - 4, -11, ZB + 24), sg('TBLB', 11, ZA - 4, 11, ZB + 24)];
const S_COL_PRE = [...mosV('PRE', -11, ZA - 9.5, 1, true), ...mosV('PRE', 11, ZA - 9.5, -1, true), sg('PRE', -9.2, ZA - 9.5, 9.2, ZA - 9.5), sg('PRE', -11, ZA - 11.2, -11, ZA - 14), sg('PRE', 11, ZA - 11.2, 11, ZA - 14), sg('PRE', -11, ZA - 7.8, -11, ZA - 4), sg('PRE', 11, ZA - 7.8, 11, ZA - 4)];
const S_COL_IO = [
  ...rect('WR', -7, ZB + 6, 7, ZB + 12), sg('WR', -11, ZB + 9, -7, ZB + 9), sg('WR', 11, ZB + 9, 7, ZB + 9), sg('WR', 0, ZB + 12, 0, ZB + 15.4),
  ...rect('SA', -7, ZB + 19, 7, ZB + 30), sg('SA', -11, ZB + 22, -7, ZB + 22), sg('SA', 11, ZB + 22, 7, ZB + 22),
  sg('SAL', -3, ZB + 23, -3, ZB + 28), sg('SAL', 3, ZB + 23, 3, ZB + 28), sg('SAL', -4.5, ZB + 24.6, 4.5, ZB + 24.6), sg('SAL', -4.5, ZB + 26.4, 4.5, ZB + 26.4),
  sg('SAL', 0, ZB + 30, 0, ZB + 38),
];
const S_BUS = [
  ...[0, 1, 2].flatMap(k => [1, 0].map(v => sg('ADDR', busX(k, v), ZA - 4, busX(k, v), ZB + 26))),
  sg('CLKB', XA - 14, ZA - 14, XB, ZA - 14), sg('DBUS', XA - 6, ZB + 15.4, XB + 14, ZB + 15.4), sg('QBUS', XA - 6, ZB + 38, XB + 14, ZB + 38),
];
const S_CTL = [
  ...rect('CTL', XA - 46, ZB + 8, XA - 16, ZB + 42), sg('CTL', XA - 16, ZB + 15.4, XA - 6, ZB + 15.4), sg('CTL', XA - 30, ZB + 8, XA - 30, ZA - 14), sg('CTL', XA - 30, ZA - 14, XA - 14, ZA - 14),
];
const S_TOP = [
  ...PADS.flatMap(p => [...rect('PAD', p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3), p[0] < 0 ? sg('PAD', p[0] + 3, p[1], XA - 53.6, p[1]) : sg('PAD', p[0] - 3, p[1], XB + 14, p[1])]),
];
export const LABELS = [['WL', XA - 10, ZA + 1], ['BL', XA + 1, ZA - 6], ['BLB', XA + 23, ZA - 6], ['row decoder', XA - 44, ZA - 8], ['precharge', XA + 60, ZA - 20], ['write', XA - 6, ZB + 9], ['sense amp', XA - 6, ZB + 24],
  ...PADS.map(p => [p[2], p[0] + (p[0] < 0 ? -4 : 4), p[1] - 5])];

// The parts, each with how it repeats: 'xz' one per cell, 'z' one per row, 'x' one per column, '' once.
export const PARTS = [
  { id: 'cell', fold: 'xz', boxes: CELL, devs: [], segs: S_CELL },
  { id: 'rowDev', fold: 'z', boxes: ROW_DEV, devs: ROW_DEVS, segs: S_ROW_DEV },
  { id: 'rowTrk', fold: 'z', boxes: ROW_TRK, devs: [], segs: S_ROW_TRK },
  { id: 'colTrk', fold: 'x', boxes: COL_TRK, devs: [], segs: S_COL_TRK },
  { id: 'colPre', fold: 'x', boxes: COL_PRE, devs: COL_PRE_DEVS, segs: S_COL_PRE },
  { id: 'colIO', fold: 'x', boxes: COL_IO, devs: COL_IO_DEVS, segs: S_COL_IO },
  { id: 'bus', fold: '', boxes: BUS, devs: [], segs: S_BUS },
  { id: 'ctl', fold: '', boxes: CTL, devs: CTL_DEVS, segs: S_CTL },
  { id: 'top', fold: '', boxes: TOP, devs: [], segs: S_TOP },
];
export const colX = c => XA + (c + 0.5) * CX, rowZ = r => ZA + (r + 0.5) * CZ;

// What each line becomes. Lines and boxes with the same tag are paired, nearest to nearest; where there are more boxes
// than lines a line is used again, and a box nobody draws (a well, a track that the schematic does not show) grows out of nothing.
// A pair is { a: [centre, half] as a line, b: [centre, half] as a box, layer, tag, born }.
export const LINE_Y = 0.4;
export function pairs(part, lineH = 0.3) {
  const all = [...part.boxes, ...part.devs.flatMap(d => devBoxes(d, false))];       // while it changes, a transistor is three slabs
  const out = [], tags = [...new Set(all.map(b => b.tag))];
  const asBox = b => ({ c: [0, 1, 2].map(i => (b.lo[i] + b.hi[i]) / 2), h: [0, 1, 2].map(i => (b.hi[i] - b.lo[i]) / 2) });
  const asLine = s => ({ c: [(s.a[0] + s.b[0]) / 2, LINE_Y, (s.a[1] + s.b[1]) / 2], h: [Math.abs(s.b[0] - s.a[0]) / 2 + lineH, lineH, Math.abs(s.b[1] - s.a[1]) / 2 + lineH] });
  for (const tag of tags) {
    const B = all.filter(b => b.tag === tag).map(b => ({ ...asBox(b), layer: b.layer })), S = part.segs.filter(s => s.tag === tag).map(asLine);
    if (!S.length) { for (const b of B) out.push({ a: { c: [b.c[0], LINE_Y, b.c[2]], h: [0, 0, 0] }, b, layer: b.layer, tag, born: true }); continue; }
    const used = new Set();
    for (const b of B) {            // every box gets its nearest line
      let best = 0, bd = 1e9; S.forEach((s, i) => { const d = Math.hypot(s.c[0] - b.c[0], s.c[2] - b.c[2]) + (used.has(i) ? 3 : 0); if (d < bd) { bd = d; best = i; } });
      used.add(best); out.push({ a: S[best], b, layer: b.layer, tag });
    }
    S.forEach((s, i) => { if (used.has(i)) return;       // every line left over goes to its nearest box
      let best = B[0], bd = 1e9; for (const b of B) { const d = Math.hypot(s.c[0] - b.c[0], s.c[2] - b.c[2]); if (d < bd) { bd = d; best = b; } }
      out.push({ a: s, b: best, layer: best.layer, tag, extra: true }); });
  }
  for (const s of part.segs) if (!tags.includes(s.tag)) throw new Error('schematic tag without boxes: ' + part.id + ' ' + s.tag);
  return out;
}
// every box and every line of the whole memory, in place (for drawing it outside the path tracer)
export function expand() {
  const boxes = [], segs = [];
  for (const p of PARTS) {
    const xs = p.fold.includes('x') ? [...Array(N).keys()].map(colX) : [0], zs = p.fold.includes('z') ? [...Array(N).keys()].map(rowZ) : [0];
    for (const dz of zs) for (const dx of xs) {
      for (const b of [...p.boxes, ...p.devs.flatMap(d => devBoxes(d, true))]) boxes.push({ ...b, part: p.id, lo: [b.lo[0] + dx, b.lo[1], b.lo[2] + dz], hi: [b.hi[0] + dx, b.hi[1], b.hi[2] + dz] });
      for (const s of p.segs) segs.push({ ...s, part: p.id, a: [s.a[0] + dx, s.a[1] + dz], b: [s.b[0] + dx, s.b[1] + dz] });
    }
  }
  for (let r = 0; r < N; r++) for (let k = 0; k < 3; k++) { const v = (r >> k) & 1, x = busX(k, v), z = rowZ(r) + tapZ(k);
    boxes.push({ ...sq('v1', 'TAP', x, z, 0.6, [15.2, 22]), part: 'tap' }); segs.push({ tag: 'TAP', part: 'tap', a: [x, rowZ(r) - 8 - 1.6 + k * 1.6], b: [XA - 44, rowZ(r) - 8 - 1.6 + k * 1.6] }); }
  return { boxes, segs };
}
export const fmt = n => (Math.round(n * 1000) / 1000).toFixed(3);
