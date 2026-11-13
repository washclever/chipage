// What the page takes from three.js, bundled into one file (three.js beside this one) by `npm run vendor`.
// three/webgpu brings the renderer (WebGPU, with WebGL 2 as the fallback) and, as TSL, the shading language.
export * from 'three/webgpu';
export { bloom } from 'three/addons/tsl/display/BloomNode.js';
