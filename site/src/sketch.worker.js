// The loading drawing on a thread of its own (sketch.js). The page hands over its canvas and tells the size, when the scene
// is ready (hurry) and when to stop; the drawing tells back where the chip is on the page and, once all of it is drawn, the
// finished picture, which the stage takes over and heats into the scene (main.js, stage.js).
import { createDrawing } from './sketch.js';

const frame = self.requestAnimationFrame ? f => self.requestAnimationFrame(f) : f => setTimeout(() => f(performance.now()), 16);
const OPENED = 0.8;          // how far the drawing's clock has run when its first lines (the centre lines, the chip's outline, the nearest grid) are down
let d = null, running = false, live = true, sent = false, told = false, log = null;          // log: (tests, ?sketchlog) the time between frames of the drawing

function run() {
  if (running || !live) return;
  running = true;
  let was = -1;
  frame(function step(now) {
    if (!live) return;
    if (log) { if (was >= 0) log.push(+(now - was).toFixed(1)); was = now; }
    if (!told && d.clock >= OPENED) { told = true; self.postMessage({ opened: true }); }
    if (d.draw(now)) { frame(step); return; }
    running = false;
    finish();
  });
}
// all of it drawn: the finished lines are the picture (sent once; a new size draws it again and sends it again)
function finish() {
  if (sent || !live) return;
  sent = true;
  createImageBitmap(d.kept).then(bmp => { if (live) self.postMessage({ done: true, bmp, at: d.at, log }, [bmp]); else bmp.close(); },
    e => self.postMessage({ failed: String(e) }));
}

self.onmessage = e => {
  const m = e.data;
  if (m.canvas) {
    if (m.log) log = [];
    d = createDrawing(m.canvas, (w, h) => new OffscreenCanvas(w, h));
    d.build(m.w, m.h, m.dpr); self.postMessage({ at: d.at }); run();
  } else if (m.size && d) {
    d.resize(m.w, m.h, m.dpr); sent = false; self.postMessage({ at: d.at }); run();
  } else if (m.hurry && d) d.hurry();
  else if (m.stop) { live = false; self.close(); }
};
