// Hashes: for a few numbers in, one number in [0, 1) that looks random. The same arithmetic runs here, on the CPU, and in
// the shaders (shade.js, and the path tracer in renderer/web), so that what the page works out and what the GPU draws agree.
// Each input is rounded to 1/256 and multiplied by an odd constant of its own; the products are combined by exclusive or
// and stirred by a 32-bit mixer (shift, exclusive or, multiply; three times). The top 24 bits make the result.
export const HK = { a: 0xd453451b, b: 0x9cd6b38b, c: 0x8e373f21, d: 0xa83a1f43, m1: 0x7feb352d, m2: 0x846ca68b };

export function mix32(x) {
  x ^= x >>> 16; x = Math.imul(x, HK.m1);
  x ^= x >>> 15; x = Math.imul(x, HK.m2);
  x ^= x >>> 16; return x >>> 0;
}
const q8 = v => Math.floor(v * 256 + 0.5) | 0;
export const hash2 = (x, y) => (mix32(Math.imul(q8(x), HK.a) ^ Math.imul(q8(y), HK.b)) >>> 8) / 16777216;
export const hash3 = (x, y, z) => (mix32(Math.imul(q8(x), HK.a) ^ Math.imul(q8(y), HK.b) ^ Math.imul(q8(z), HK.c)) >>> 8) / 16777216;
// the k-th random number of the i-th thing
export const rnd = (i, k) => hash2(i, k);
