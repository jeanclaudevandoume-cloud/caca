// Zero-dependency static server with gzip and ETags. Any static host (nginx, a CDN, GitHub Pages) works too.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'public');
const PORT = +process.env.PORT || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.bin': 'application/octet-stream' };
// LRU of prepared responses (raw + gzip + etag), bounded by bytes; reads and compression are async.
const cache = new Map();
let cacheBytes = 0;
const CACHE_MAX = 64 * 1024 * 1024;
const COMPRESS = ['.html', '.js', '.json', '.txt', '.css', '.svg', '.bin'];
const pending = new Map();

function prepare(file, st) {
  const hit = cache.get(file);
  if (hit && hit.mtime === st.mtimeMs) { cache.delete(file); cache.set(file, hit); return Promise.resolve(hit); }
  if (pending.has(file)) return pending.get(file);
  const p = fs.promises.readFile(file).then((raw) => new Promise((resolve) => {
    const ext = path.extname(file);
    const done = (gz) => {
      const c = { mtime: st.mtimeMs, raw, gz, type: TYPES[ext] || 'application/octet-stream',
        etag: '"' + crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20) + '"' };
      if (hit) { cacheBytes -= hit.raw.length + (hit.gz ? hit.gz.length : 0); cache.delete(file); }
      cache.set(file, c);
      cacheBytes += raw.length + (gz ? gz.length : 0);
      for (const [k, v] of cache) { if (cacheBytes <= CACHE_MAX) break; cache.delete(k); cacheBytes -= v.raw.length + (v.gz ? v.gz.length : 0); }
      resolve(c);
    };
    if (COMPRESS.includes(ext) && raw.length > 512) zlib.gzip(raw, { level: 6 }, (err, gz) => done(err ? null : gz));
    else done(null);
  })).finally(() => pending.delete(file));
  pending.set(file, p);
  return p;
}

http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (p.includes('\0')) { res.writeHead(400).end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    prepare(file, st).then((c) => {
      const town = p.startsWith('/town/');
      const headers = {
        'content-type': c.type, etag: c.etag, vary: 'accept-encoding',
        // town files are addressed with ?v=<content hash>, so they can be cached for long
        'cache-control': town ? (p === '/town/manifest.json' ? 'no-cache' : 'public, max-age=604800') : 'no-cache',
      };
      if (req.headers['if-none-match'] === c.etag) { res.writeHead(304, headers).end(); return; }
      const useGz = c.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const body = useGz ? c.gz : c.raw;
      if (useGz) headers['content-encoding'] = 'gzip';
      headers['content-length'] = body.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    }).catch((e) => { console.error(e); if (!res.headersSent) res.writeHead(500); res.end(); });
  });
}).listen(PORT, () => console.log(`Follower Town on http://localhost:${PORT}`));
