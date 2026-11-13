// Dev server for the homepage project.
//   /            the renderer (renderer/web): index.html bakes the film, v1.html is the renderer of the first film
//   /site/...    the homepage (site/)
//   /v1/...      the first version of the homepage, kept for reference (archive/v1/site/)
//   /renders/... saved stills (for contact sheets)
//   POST /save/<name>        -> renders/<name>                  (stills)
//   POST /saveframe/<name>   -> site/frames/<name>              (the baked film)
//   POST /saveframe1/<name>  -> archive/v1/site/frames/<name>   (the first film)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const web = path.join(here, 'web'), site = path.join(root, 'site'), v1 = path.join(root, 'archive', 'v1', 'site'), renders = path.join(root, 'renders');
const frames = path.join(site, 'frames'), frames1 = path.join(v1, 'frames');
fs.mkdirSync(renders, { recursive: true }); fs.mkdirSync(frames, { recursive: true });
const port = Number(process.argv[2] || 4320);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
function send(res, base, rel) {
  const f = path.join(base, path.normalize(rel));
  if (!f.startsWith(base)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(b);
  });
}
const SAVE = { '/save/': renders, '/saveframe/': frames, '/saveframe1/': frames1 };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname);
  const sv = req.method === 'POST' && Object.keys(SAVE).find(k => p.startsWith(k));
  if (sv) {
    const name = path.basename(p).replace(/[^\w.-]/g, '_');
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { fs.writeFileSync(path.join(SAVE[sv], name), Buffer.concat(chunks)); res.writeHead(200, { 'content-type': 'text/plain' }); res.end('saved ' + name); });
    return;
  }
  // which frames of the film are on disk: the baker skips these, the site does not ask for what is not there
  if (p === '/frames.json') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(fs.readdirSync(frames).filter(n => /\.webp$/.test(n)))); return; }
  if (p === '/site' || p === '/v1') { res.writeHead(301, { location: p + '/' }); res.end(); return; }      // relative addresses in the page need the slash
  if (p.startsWith('/renders/')) return send(res, renders, p.slice(9));
  if (p.startsWith('/site/')) return send(res, site, p.slice(6) || 'index.html');
  if (p.startsWith('/v1/')) return send(res, v1, p.slice(4) || 'index.html');
  send(res, web, p === '/' ? 'index.html' : p);
}).listen(port, '127.0.0.1', () => console.log('homepage dev server on http://127.0.0.1:' + port));
