// Bundle the whole town into ONE self-contained HTML file (code, worker and data) for testing on a
// phone without a server:
//   node tools/demo-data.mjs data/small 100000 && node tools/build.mjs data/small /tmp/town-small
//   node tools/single.mjs /tmp/town-small dist/follower-town.html [--force]
//
// Safe by construction:
//  - every ES module keeps its own scope (a tiny module registry), so two modules declaring the same
//    top-level name can never collide (that once broke every phone build for several rounds);
//  - only a strict import/export grammar is accepted — anything else stops the build;
//  - both bundles are parse-checked, and the worker bundle is actually executed in Node (layout +
//    one chunk + one skyline tile) before the file is written;
//  - embedded data is escaped so no follower name can close a <script> element;
//  - a size guard refuses accidental huge files.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // works from any directory

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const force = process.argv.includes('--force');
const townDir = args[0];
const out = args[1] || 'dist/follower-town.html';
if (!townDir) { console.error('usage: node tools/single.mjs <town dir> [out.html] [--force]'); process.exit(1); }
const die = (msg) => { console.error('single.mjs: ' + msg); process.exit(1); };

// ---- modules -> scoped registry ----
// The main bundle carries only the mesh modules main needs (mb.js for render.js; rail.js and props.js for view.js's
// rail collision); homes.js and mesher.js live in the worker bundle only.
const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*'(\.\/[a-z]+\.js)';[ \t]*$/gm;
function wrap(file) {
  let src = fs.readFileSync(path.join(ROOT, 'public/js', file), 'utf8');
  const head = [];
  src = src.replace(IMPORT, (m, list, from) => {
    const parts = list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const mm = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(s);
      if (!mm) die(`${file}: unsupported import specifier "${s}"`);
      return mm[2] ? `${mm[1]}: ${mm[2]}` : mm[1];
    });
    head.push(`const { ${parts.join(', ')} } = __req('${from}');`);
    return '';
  });
  const names = [];
  src = src.replace(/^export\s+(async\s+function\*?|function\*?|const|class)\s+([A-Za-z_$][\w$]*)/gm, (m, kind, name) => {
    names.push(name);
    return `${kind} ${name}`;
  });
  // anything left that looks like module syntax is unsupported here
  const left = /^\s*(import\b|export\b)/m.exec(src);
  if (left) die(`${file}: unsupported module syntax near "${src.slice(left.index, left.index + 60).trim()}"`);
  if (/import\.meta/.test(src)) {
    if (file !== 'main.js') die(`${file}: import.meta is not supported`);
    const w = "new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })";
    if (!src.includes(w)) die('main.js: unexpected import.meta use');
    src = src.replace(w, 'new Worker(WORKER_URL)');
  }
  if (/<\/?script|<!--/i.test(src)) die(`${file}: contains "<script" or "<!--", which would break the HTML`);
  return `__def('./${file}', function (__req) {\n${head.join('\n')}\n${src}\nreturn { ${names.join(', ')} };\n});\n`;
}
const RUNTIME = `const __mods = {}, __cache = {};
function __def(name, fn) { __mods[name] = fn; }
function __req(name) {
  if (!(name in __cache)) { if (!__mods[name]) throw new Error('module not bundled: ' + name); __cache[name] = null; __cache[name] = __mods[name](__req); }
  if (__cache[name] === null) throw new Error('circular import: ' + name);
  return __cache[name];
}
`;
const workerSrc = '"use strict";\n' + RUNTIME + ['town.js', 'recipe.js', 'layout.js', 'mb.js', 'props.js', 'homes.js', 'rail.js', 'mesher.js', 'atlas.js', 'worker.js'].map(wrap).join('') + "__req('./worker.js');\n";

// ---- data ----
const files = {};
for (const sub of ['n', 'c', 's']) {
  const d = path.join(townDir, sub);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) files[`${sub}/${f}`] = fs.readFileSync(path.join(d, f), 'utf8');
}
files['manifest.json'] = fs.readFileSync(path.join(townDir, 'manifest.json'), 'utf8');
const bins = {};
for (const b of ['layout.bin']) if (fs.existsSync(path.join(townDir, b))) bins[b] = fs.readFileSync(path.join(townDir, b)).toString('base64');
const manifest = JSON.parse(files['manifest.json']);

let stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
try { stamp = execFileSync('git', ['describe', '--always', '--dirty'], { stdio: 'pipe', cwd: ROOT }).toString().trim() + ' ' + stamp; } catch { /* not a git checkout */ }   // -dirty: built from uncommitted code

const prelude = `
window.FT_BUILD = ${JSON.stringify(stamp)};
const WORKER_URL = URL.createObjectURL(new Blob([document.getElementById('worker-src').textContent], { type: 'text/javascript' }));
const TOWN_ALL = JSON.parse(document.getElementById('town-data').textContent), TOWN_FILES = TOWN_ALL.f, TOWN_BIN = TOWN_ALL.b;
const netFetch = window.fetch.bind(window);
window.fetch = (u, o) => {
  const s = String(u), i = s.indexOf('town/');
  if (i < 0) return netFetch(u, o);
  const p = s.slice(i + 5).split('?')[0];
  if (p in TOWN_BIN) return Promise.resolve(new Response(Uint8Array.from(atob(TOWN_BIN[p]), (c) => c.charCodeAt(0)), { status: 200 }));
  return Promise.resolve(p in TOWN_FILES ? new Response(TOWN_FILES[p], { status: 200 }) : new Response('', { status: 404 }));
};
`;
const mainSrc = '"use strict";\n' + RUNTIME + prelude + ['town.js', 'names.js', 'recipe.js', 'layout.js', 'mb.js', 'props.js', 'rail.js', 'shaders.js', 'supervisor.js', 'session.js', 'governor.js', 'atlas.js', 'gfx.js', 'view.js', 'data.js', 'streaming.js', 'tags.js', 'render.js', 'ui.js', 'main.js'].map(wrap).join('') + "__req('./main.js');\n";

// ---- checks ----
for (const [label, src] of [['main bundle', mainSrc], ['worker bundle', workerSrc]]) {
  const tmp = path.join(os.tmpdir(), `ft-check-${process.pid}.js`);
  fs.writeFileSync(tmp, src);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) { die(`${label} does not parse:\n` + String(e.stderr).slice(0, 800)); }
  finally { fs.unlinkSync(tmp); }
}
// run the worker bundle for real: layout, one chunk, one skyline tile
{
  const replies = [];
  const ctx = { onmessage: null, postMessage: (m) => replies.push(m), console, URL, Math, Date, performance: { now: () => 0 } };
  ctx.self = ctx;
  vm.createContext(ctx);
  try {
    vm.runInContext(workerSrc, ctx, { timeout: 30000 });
    if (typeof ctx.onmessage !== 'function') die('worker bundle did not install onmessage');
    ctx.onmessage({ data: { type: 'init', n: Math.min(manifest.n || 1000, 5000) } });
    // the commit path: a worker that receives a finished layout (every worker after a build) must mesh with it
    const lay = replies.find((r) => r.type === 'layout');
    if (!lay) die('worker bundle: init produced no layout');
    ctx.onmessage({ data: { type: 'init', layout: lay.layout } });
    ctx.onmessage({ data: { type: 'chunk', id: 1, cx: 0, cz: 0, lod: 0, custom: null } });
    ctx.onmessage({ data: { type: 'chunk', id: 2, cx: 1, cz: 0, lod: 0, custom: null, lite: true } });
    ctx.onmessage({ data: { type: 'sky', id: 3, rx: 0, rz: 0 } });
    ctx.onmessage({ data: { type: 'chunk', id: 4, cx: 2, cz: 1, lod: 1, custom: null } });
    ctx.onmessage({ data: { type: 'sky', id: 5, rx: 0, rz: 0, lite: true } });
  } catch (e) { die('worker bundle failed when run: ' + (e.stack || e)); }
  const err = replies.find((r) => r.type === 'error');
  if (err) die('worker bundle reported an error: ' + err.message);
  const meshes = replies.filter((r) => r.type === 'mesh' && r.ib && r.ib.length > 0);
  if (!replies.some((r) => r.type === 'layout') || meshes.length < 5) die(`worker bundle smoke run incomplete (${replies.map((r) => r.type).join(',')})`);
}

// ---- HTML ----
// data: escape every '<' so nothing in a follower name can end the <script> element
const dataJson = JSON.stringify({ f: files, b: bins }).replace(/</g, '\\u003c');
let html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const tag = '<script type="module" src="js/main.js"></script>';
if (!html.includes(tag)) die('index.html script tag not found');
html = html.replace(tag, () =>
  `<script type="text/plain" id="worker-src">${workerSrc}</script>\n` +
  `<script type="application/json" id="town-data">${dataJson}</script>\n` +
  `<script>${mainSrc}</script>`);
const mb = html.length / 1048576;
if (mb > 15 && !force) die(`output would be ${mb.toFixed(1)} MB (> 15 MB). Use a smaller dataset or --force.`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}: ${mb.toFixed(1)} MB, ${Object.keys(files).length} embedded files, build ${stamp}`);
