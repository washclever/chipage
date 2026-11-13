// Baking the film: the frames of site/src/film.js, rendered by pt2.js (index.html) and saved into site/frames.
// In the console of the renderer page:
//   const B = await import('/bake.js?' + Date.now());
//   await B.preview(6)        a quick look: every sixth frame, small, into renders/p_NNNN.jpg  (then B.sheets())
//   await B.bake()            the film. Frames already on disk are skipped; B.bake({ redo: true, from: 120, to: 160 }) bakes a stretch again
//   await B.orbit()           the extra frames for turning the camera with the pointer (after the film: one queue at a time)
//   B.progress()              how far it is
// film.js is loaded afresh at each call, so that an edit to the timeline is picked up without reloading the page (and compiling the shader again)
const film = () => import('/site/src/film.js?' + Date.now());
const KV = () => window.KV;
const name = i => 'f_' + String(i).padStart(4, '0');
export async function bake(o = {}) {
  const F = await film(); const fr = F.frames(), w = o.w || 1600, h = o.h || 900, have = new Set(o.redo ? [] : await (await fetch('/frames.json')).json());
  await fetch('/saveframe/index.json', { method: 'POST', body: JSON.stringify({ n: fr.length, w, h, ext: 'webp', total: +F.TOTAL.toFixed(5), times: fr.map(f => +f.g.toFixed(5)), wipe: fr.map((f, i) => f.wipe ? i : -1).filter(i => i >= 0) }) });
  const list = fr.map((f, i) => ({ ...F.shot(f.g), w, h, spp: o.spp || 36, to: 'saveframe', ext: 'webp', q: o.q || 0.8, name: name(i), i }))
    .filter(s => !have.has(s.name + '.webp') && s.i >= (o.from || 0) && s.i <= (o.to ?? 1e9));
  KV().queue(list); return list.length + ' of ' + fr.length + ' to bake';
}
export async function preview(step = 6, o = {}) {
  const F = await film(); const fr = F.frames(), list = []; for (let i = o.from || 0; i < Math.min(fr.length, o.to ?? 1e9); i += step) list.push({ ...F.shot(fr[i].g), w: 480, h: 270, spp: 12, name: 'p_' + String(i).padStart(4, '0'), ...o.shot });
  window.__preview = list.map(s => s.name); KV().queue(list); return list.length;
}
export async function sheets(cols = 6, rows = 5, cw = 320) {
  const n = window.__preview || [], out = []; for (let i = 0, k = 0; i < n.length; i += cols * rows, k++) out.push(await KV().sheet(n.slice(i, i + cols * rows).map(x => 'renders/' + x + '.jpg'), cols, 'sheet_p' + k, cw)); return out;
}
// the frames for turning the camera with the pointer: site/frames/o_<beat>_<n>.webp
export async function orbit(o = {}) {
  const F = await film(), list = []; for (const id of F.ORBIT.beats) F.ORBIT.az.forEach((a, j) => list.push({ ...F.shotOf(F.orbit(id, j)), w: o.w || 1600, h: o.h || 900, spp: o.spp || 36, to: 'saveframe', ext: 'webp', q: o.q || 0.8, name: 'o_' + id + '_' + j }));
  KV().queue(list); return list.length;
}
export const progress = () => { const q = window.__q || {}; return { done: (q.done || []).length, cur: q.cur, all: !!q.all, errors: (q.done || []).filter(d => d[1] !== 'done').length, frame: KV().status.frame, spp: KV().status.spp }; };
// wait (up to ms) for the queue to finish
export const wait = (ms = 40000) => new Promise(r => { const t0 = performance.now(), c = new MessageChannel(); c.port1.onmessage = () => { if ((window.__q && window.__q.all) || performance.now() - t0 > ms) r(progress()); else c.port2.postMessage(0); }; c.port2.postMessage(0); });
