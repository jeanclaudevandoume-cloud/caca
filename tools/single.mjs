// Bundle the whole town into ONE self-contained HTML file (code, worker and data), for testing
// on a phone without a server:  node tools/single.mjs <town dir> [out.html]
//   e.g. node tools/demo-data.mjs data/small 100000 && node tools/build.mjs data/small /tmp/town-small
//        node tools/single.mjs /tmp/town-small dist/follower-town.html
// The data is embedded, so keep it small (100k followers ≈ 4 MB). Real deployments use the
// normal static files instead.
import fs from 'node:fs';
import path from 'node:path';

const townDir = process.argv[2];
const out = process.argv[3] || 'dist/follower-town.html';
if (!townDir) { console.error('usage: node tools/single.mjs <town dir> [out.html]'); process.exit(1); }
const js = (f) => fs.readFileSync(path.join('public/js', f), 'utf8');
// strip ES module syntax so the files can be concatenated into one script
const flat = (src) => src.replace(/^import[\s\S]*?from\s+'[^']+';\s*$/gm, '').replace(/^export\s+(?=(const|let|function|class)\b)/gm, '');

const workerSrc = [flat(js('town.js')), flat(js('mesher.js')), flat(js('worker.js'))].join('\n;\n');
let mainSrc = flat(js('main.js')).replace(
  "new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })",
  'new Worker(WORKER_URL)');
if (mainSrc.includes('import.meta')) throw new Error('main.js still references import.meta');

const files = {};
for (const sub of ['n', 'c', 's']) {
  const d = path.join(townDir, sub);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) files[`${sub}/${f}`] = fs.readFileSync(path.join(d, f), 'utf8');
}
files['manifest.json'] = fs.readFileSync(path.join(townDir, 'manifest.json'), 'utf8');

const prelude = `
const WORKER_URL = URL.createObjectURL(new Blob([document.getElementById('worker-src').textContent], { type: 'text/javascript' }));
const TOWN_FILES = JSON.parse(document.getElementById('town-data').textContent);
const netFetch = window.fetch.bind(window);
window.fetch = (u, o) => {
  const s = String(u), i = s.indexOf('town/');
  if (i < 0) return netFetch(u, o);
  const p = s.slice(i + 5).split('?')[0];
  return Promise.resolve(p in TOWN_FILES ? new Response(TOWN_FILES[p], { status: 200 }) : new Response('', { status: 404 }));
};
`;
const bundle = [prelude, flat(js('town.js')), flat(js('mesher.js')), flat(js('shaders.js')), mainSrc].join('\n;\n');
const safe = (t) => t.replace(/<\/(script)/gi, '<\\/$1');

let html = fs.readFileSync('public/index.html', 'utf8');
const tag = '<script type="module" src="js/main.js"></script>';
if (!html.includes(tag)) throw new Error('index.html script tag not found');
html = html.replace(tag, () =>
  `<script type="text/plain" id="worker-src">${safe(workerSrc)}</script>\n` +
  `<script type="application/json" id="town-data">${safe(JSON.stringify(files))}</script>\n` +
  `<script type="module">${safe(bundle)}</script>`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1048576).toFixed(1)} MB, ${Object.keys(files).length} embedded files`);
