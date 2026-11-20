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

// 4. shader mirror of the river (shader computes round(6 sin), town.js uses a table)
let river = true;
for (let bx = -96; bx < 96; bx++) { const t = ((bx % 48) + 48) % 48; if (9 + Math.floor(6 * Math.sin(6.2831853 * t / 48) + 0.5) !== T.riverZ(bx)) river = false; }
check('shader river formula == town.js riverZ', river);

// 5. every shader is valid GLSL ES 3.00 (what phones run)
let glslang = true;
try { execFileSync('glslangValidator', ['--version'], { stdio: 'pipe' }); } catch { glslang = false; }
if (!glslang) console.log('skip GLSL validation (install glslang-tools)');
else for (const [name, src] of Object.entries(S)) {
  if (typeof src !== 'string' || !src.includes('#version')) continue;
  const f = path.join(os.tmpdir(), `ft-${name}.${name.endsWith('VS') ? 'vert' : 'frag'}`);
  fs.writeFileSync(f, src);
  let ok = true, msg = '';
  try { execFileSync('glslangValidator', [f], { stdio: 'pipe' }); } catch (e) { ok = false; msg = String(e.stdout).slice(0, 300); }
  check(`GLSL ES 3.00: ${name}`, ok, msg);
  fs.unlinkSync(f);
}

if (update) { fs.writeFileSync(GOLD, JSON.stringify(got, null, 1) + '\n'); console.log('golden file updated'); }
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
