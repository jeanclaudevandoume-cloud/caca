// npm test — determinism, mirrors and packing checks (no browser needed).
//   node tools/selftest.mjs            compare against tools/selftest.golden.json
//   node tools/selftest.mjs --update   rewrite the golden file (only after an intended rule change)
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as T from '../public/js/town.js';
import * as Mz from '../public/js/mesher.js';
import * as S from '../public/js/shaders.js';

const update = process.argv.includes('--update');
const GOLD = 'tools/selftest.golden.json';
const gold = update ? {} : JSON.parse(fs.readFileSync(GOLD, 'utf8'));
const got = {};
let fails = 0;
const h = (x) => crypto.createHash('sha1').update(typeof x === 'string' ? x : Buffer.from(x.buffer || x)).digest('hex').slice(0, 16);
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const golden = (name, value) => { got[name] = value; if (!update) check(name, gold[name] === value, gold[name] === value ? '' : `expected ${gold[name]} got ${value}`); };

// 1. layout: deterministic, prefix-stable (append-only), and order.bin equivalent
const L = T.buildLayout(100000);
golden('layout 1e5 blocks', h(L.blocks));
const L2 = T.buildLayout(100500);
let prefix = true;
for (let i = 0; i < L.count * 2 - 2; i++) if (L.blocks[i] !== L2.blocks[i]) { prefix = false; break; }
check('layout is append-only (1e5 is a prefix of 1e5+500)', prefix);
const ord = new Int16Array(L.blocks.length); for (let i = 0; i < ord.length; i++) ord[i] = L.blocks[i];
const LO = T.layoutFromOrder(100000, ord);
check('layoutFromOrder == buildLayout', LO.count === L.count && LO.maxD2 === L.maxD2 && h(LO.start) === h(L.start));

// shadow-only proxies come first and the colour range never starts inside them
{
  let bad = '';
  for (const [cx, cz, lite] of [[11, 6, false], [11, 6, true], [3, 2, false]]) {
    const m = Mz.buildChunk(L, cx, cz, 0, null, lite), ib = m.ib;
    if (!(m.so > 0 && m.so <= m.ns && m.ns <= ib.length && m.so % 3 === 0)) { bad += ` ${cx},${cz}: so=${m.so} ns=${m.ns} n=${ib.length}`; continue; }
    const proxyV = new Set(ib.subarray(0, m.so));
    for (let i = m.so; i < ib.length; i++) if (proxyV.has(ib[i])) { bad += ` ${cx},${cz}: colour range uses proxy vertex ${ib[i]}`; break; }
  }
  check('shadow-only proxies: 0 < so <= ns <= n, and the colour range never draws a proxy vertex', !bad, bad);
}
// follower names: no bidi/zero-width/control characters, emoji and flags intact, grapheme-safe truncation
{
  const C = String.fromCodePoint, fam = C(0x1F468, 0x200D, 0x1F469, 0x200D, 0x1F467), eng = C(0x1F3F4, 0xE0067, 0xE0062, 0xE0065, 0xE006E, 0xE0067, 0xE007F);
  const cases = [['a' + C(0x202E) + 'b', 'ab'], ['x' + C(0x200B) + 'y', 'xy'], ['a' + C(0x2028) + 'b', 'ab'], [C(0x200D), ''], [' ', ''], ['ab' + C(1) + C(0xE0041) + C(1) + C(0xE0042) + 'c', 'abc'], ['a' + C(0) + 'b', 'ab'], ['a' + C(0xE0041), 'a'], ['a' + C(0x200D) + 'b', 'ab'],
    [fam.repeat(41), fam.repeat(40)], [eng, eng], ['</script>', '</script>'], ['z' + C(0x300, 0x301, 0x302, 0x303, 0x304, 0x305), 'z' + C(0x300, 0x301, 0x302, 0x303)]];
  const bad = cases.filter(([i, o]) => T.cleanName(i) !== o).map(([i]) => JSON.stringify(i));
  check('cleanName strips control/format characters, keeps emoji and flags, truncates by grapheme', !bad.length, bad.join(' '));
}

// 2. rules over a grid
let rules = '';
for (let bz = -100; bz < 100; bz += 1) for (let bx = -100; bx < 100; bx += 1) {
  const k = T.cellKind(bx, bz), z = T.zoneLevel(bx, bz);
  rules += k + '' + z;
  if (k === 0 && ((bx * 7 + bz) & 15) === 0) { const r = T.recipe(bx, bz, 3, z, null); rules += r.floors + r.wall + r.roof + r.roofType; }
}
golden('cellKind/zoneLevel/recipe 200x200', h(rules));
golden('buildGround 1e5', h(T.buildGround(L).data));

// 3. meshes (and packed-format overflow)
Mz.MB.strict = true;
let meshes = '';
for (const [cx, cz, lod, lite] of [[0, 0, 0, false], [3, 2, 0, false], [11, 6, 0, false], [11, 6, 0, true], [5, -4, 1, false], [8, -3, 0, false]]) {
  const m = Mz.buildChunk(L, cx, cz, lod, null, lite); meshes += h(m.vb) + h(m.ib);
}
for (const [sx, sz] of [[0, 0], [-1, 0], [1, 1]]) { const m = Mz.buildSkyline(L, sx, sz); meshes += h(m.vb) + h(m.ib); }
golden('chunk + skyline meshes', h(meshes));
const Lbig = T.buildLayout(1000000);
for (const [cx, cz] of [[0, 0], [-1, -1], [1, 0]]) Mz.buildChunk(Lbig, cx, cz, 0, null);
Mz.buildSkyline(Lbig, 0, 0);
check('vertex positions and uv fit their packed formats (1M core)', Mz.MB.overflow.length === 0, Mz.MB.overflow.slice(0, 3).join(' | '));

// 3b. no zero-area triangles after quantisation (they cost vertex work and inflate budgets)
{
  let degen = 0, total = 0;
  for (const [cx, cz, lod, lite] of [[0, 0, 0, false], [11, 6, 0, false], [11, 6, 0, true], [5, -4, 1, false]]) {
    const m = Mz.buildChunk(Lbig, cx, cz, lod, null, lite), p = new Int16Array(m.vb), ib = m.ib;
    for (let i = 0; i < ib.length; i += 3) {
      const a = ib[i] * 8, b = ib[i + 1] * 8, c = ib[i + 2] * 8;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      if (uy * vz - uz * vy === 0 && uz * vx - ux * vz === 0 && ux * vy - uy * vx === 0) degen++;
      total++;
    }
  }
  check('no zero-area triangles', degen === 0, `${degen} of ${total}`);
}

// 3c. streaming hysteresis: sweeping across each threshold switches at most once per direction
{
  const sweep = (f) => { let prev = null, flips = 0; for (const x of [...Array(200).keys()].map((i) => i / 200).concat([...Array(200).keys()].map((i) => 1 - i / 200))) { for (let k = 0; k < 3; k++) { const v = f(x, prev); if (prev !== null && v !== prev) flips++; prev = v; } } return flips; };
  check('LOD hysteresis (chunkLod)', sweep((x, p) => T.chunkLod(x * 640, 320, p === null ? -1 : p)) <= 2);
  check('mid-ring lite hysteresis (chunkLite)', sweep((x, p) => T.chunkLite(false, 0, x * 320, 320, !!p)) <= 2);
  check('far skyline hysteresis (skyLite)', sweep((x, p) => T.skyLite(false, x * 3000, !!p)) <= 2);
  check('low-preset hysteresis (lowNext)', sweep((x, p) => T.lowNext(p, 0.5 + x * 0.4)) <= 2);
}

// 4. shader mirror of the river (shader computes round(6 sin), town.js uses a table)
let river = true;
for (let bx = -96; bx < 96; bx++) { const t = ((bx % 48) + 48) % 48; if (9 + Math.floor(6 * Math.sin(6.2831853 * t / 48) + 0.5) !== T.riverZ(bx)) river = false; }
check('shader river formula == town.js riverZ', river);

// 5. every shader is valid GLSL ES 3.00 (what phones run)
let glslang = true;
try { execFileSync('glslangValidator', ['--version'], { stdio: 'pipe' }); } catch { glslang = false; }
if (!glslang) console.log('skip GLSL validation (install glslang-tools)');
else for (const [name, src] of [...Object.entries(S), ['GEO_FS (LOWQ)', S.GEO_FS.replace('#version 300 es', '#version 300 es\n#define LOWQ')]]) {
  if (typeof src !== 'string' || !src.includes('#version')) continue;
  const f = path.join(os.tmpdir(), `ft-${name.replace(/\W+/g, '_')}.${name.endsWith('VS') ? 'vert' : 'frag'}`);
  fs.writeFileSync(f, src);
  let ok = true, msg = '';
  try { execFileSync('glslangValidator', [f], { stdio: 'pipe' }); } catch (e) { ok = false; msg = String(e.stdout).slice(0, 300); }
  check(`GLSL ES 3.00: ${name}`, ok, msg);
  fs.unlinkSync(f);
}

// the phone build: a 5k town bundled into one file (parse check + worker smoke run happen inside single.mjs)
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-single-'));
  let ok = true, why = '';
  try {
    execFileSync(process.execPath, ['tools/demo-data.mjs', path.join(tmp, 'd'), '5000'], { stdio: 'pipe' });
    execFileSync(process.execPath, ['tools/build.mjs', path.join(tmp, 'd'), path.join(tmp, 't')], { stdio: 'pipe' });
    execFileSync(process.execPath, ['tools/single.mjs', path.join(tmp, 't'), path.join(tmp, 'x.html')], { stdio: 'pipe' });
    const html = fs.readFileSync(path.join(tmp, 'x.html'), 'utf8');
    if (/import\.meta|new Worker\(new URL/.test(html)) { ok = false; why = 'module-only worker code left in the bundle'; }
  } catch (e) { ok = false; why = String(e.stderr || e.message).slice(0, 300); }
  fs.rmSync(tmp, { recursive: true, force: true });
  check('single-file phone build (5k town) bundles, parses and runs its worker', ok, why);
}
if (update) { fs.writeFileSync(GOLD, JSON.stringify(got, null, 1) + '\n'); console.log('golden file updated'); }
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
