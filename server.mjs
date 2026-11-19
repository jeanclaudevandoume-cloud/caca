// Zero-dependency static server with gzip and ETags. Any static host (nginx, a CDN, GitHub Pages) works too.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'public');
const PORT = +process.env.PORT || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const cache = new Map();   // path -> {mtime, etag, raw, gz}

http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (p.includes('\0')) { res.writeHead(400).end(); return; }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      let c = cache.get(file);
      if (!c || c.mtime !== st.mtimeMs) {
        const raw = fs.readFileSync(file);
        const ext = path.extname(file);
        const gz = ['.html', '.js', '.json', '.txt', '.css', '.svg'].includes(ext) && raw.length > 512 ? zlib.gzipSync(raw, { level: 6 }) : null;
        c = { mtime: st.mtimeMs, etag: '"' + crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20) + '"', raw, gz, type: TYPES[ext] || 'application/octet-stream' };
        if (cache.size > 4000) cache.clear();
        cache.set(file, c);
      }
      const town = p.startsWith('/town/');
      const headers = {
        'content-type': c.type, etag: c.etag, vary: 'accept-encoding',
        'cache-control': town ? (p === '/town/manifest.json' ? 'no-cache' : 'public, max-age=86400') : 'no-cache',
      };
      if (req.headers['if-none-match'] === c.etag) { res.writeHead(304, headers).end(); return; }
      const useGz = c.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const body = useGz ? c.gz : c.raw;
      if (useGz) headers['content-encoding'] = 'gzip';
      headers['content-length'] = body.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(PORT, () => console.log(`Follower Town on http://localhost:${PORT}`));
