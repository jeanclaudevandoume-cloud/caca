// followers.txt + custom.json  ->  public/town/{manifest.json, n/, c/, s/}
//   node tools/build.mjs data/live [public/town]
// followers.txt: one name per line in follow order. Append only; blank a line when someone leaves,
// never delete it, so everyone after keeps their home.
// custom.json: { "name": { "shape": "mushroom", "color": "#ff4f7b", "garden": ["pool", "tree"] } }
// Only files whose content changed are rewritten, so a daily rebuild touches few files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildLayout, plotOf, regionOf, regionKey, lineIndex, normName, shardKey, SHAPES, GARDEN, REGION, SLOTS } from '../public/js/town.js';

const src = process.argv[2] || 'data/live';
const out = process.argv[3] || 'public/town';
const t0 = Date.now();
const SHARD_MAX = 1500;

const lines = fs.readFileSync(path.join(src, 'followers.txt'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);   // strip a BOM
while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
const n = lines.length;
let custom = {};
try { custom = JSON.parse(fs.readFileSync(path.join(src, 'custom.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }

const L = buildLayout(n);
const regions = new Map();
const shards = new Map();
const index = new Map();
const dupes = [];
for (let i = 0; i < n; i++) {
  const name = Array.from(lines[i].trim().replace(/[\r\n\t]/g, '')).slice(0, 40).join('');   // truncate by code point (never split an emoji)
  if (!name) continue;
  const { bx, bz, slot } = plotOf(L, i);
  const key = regionKey(regionOf(bx), regionOf(bz));
  let r = regions.get(key);
  if (!r) { r = new Array(REGION * REGION * SLOTS).fill(''); regions.set(key, r); }
  r[lineIndex(bx, bz, slot)] = name;
  const norm = normName(name);
  if (!norm) continue;
  if (!index.has(norm)) index.set(norm, i);
  else if (dupes.length < 20) dupes.push(`"${name}" (#${i + 1}) normalises like #${index.get(norm) + 1}; search finds the first`);
  const k = shardKey(norm, 2);
  if (!shards.has(k)) shards.set(k, []);
  shards.get(k).push([norm, i]);
}

// custom homes, validated
const cfiles = new Map();
let nc = 0, bad = 0;
for (const [name, spec] of Object.entries(custom)) {
  const i = index.get(normName(name));
  if (i === undefined || !spec || typeof spec !== 'object') { bad++; continue; }
  const clean = { shape: SHAPES.includes(spec.shape) ? spec.shape : 'cube' };
  if (typeof spec.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(spec.color)) clean.color = spec.color.toLowerCase();
  if (Array.isArray(spec.garden)) clean.garden = spec.garden.filter((g) => GARDEN.includes(g)).slice(0, 4);
  const { bx, bz, slot } = plotOf(L, i);
  const key = regionKey(regionOf(bx), regionOf(bz));
  if (!cfiles.has(key)) cfiles.set(key, {});
  cfiles.get(key)[lineIndex(bx, bz, slot)] = clean;
  nc++;
}

const hash = (t) => crypto.createHash('sha1').update(t).digest('base64url').slice(0, 10);

// write helpers: only touch changed files
let written = 0, kept = 0;
const live = new Set();
function put(rel, text) {
  const f = path.join(out, rel);
  live.add(path.normalize(f));
  try { if (fs.readFileSync(f, 'utf8') === text) { kept++; return; } } catch { /* new */ }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', text);
  fs.renameSync(f + '.tmp', f);                // atomic: a reader never sees a half-written file
  written++;
}

// Every file's URL carries its own content hash (from the manifest), so a daily edit only
// invalidates the files that actually changed.
const nh = {}, sh = {};
for (const [key, r] of regions) {
  let last = r.length;
  while (last > 0 && !r[last - 1]) last--;
  const t = r.slice(0, last).join('\n');
  nh[key] = hash(t);
  put(`n/${key}.txt`, t);
}
const cman = {};
for (const [key, obj] of cfiles) { const t = JSON.stringify(obj); cman[key] = hash(t); put(`c/${key}.json`, t); }

// search shards: split prefixes that grow too big
const split = [];
function emit(key, list, len) {
  if (list.length > SHARD_MAX && len < 6) {
    split.push(key);
    const sub = new Map();
    for (const e of list) { const k = shardKey(e[0], len + 1); if (!sub.has(k)) sub.set(k, []); sub.get(k).push(e); }
    for (const [k, l] of sub) emit(k, l, len + 1);
    return;
  }
  list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  const t = JSON.stringify(list);
  sh[key] = hash(t);
  put(`s/${key}.json`, t);
}
for (const [k, l] of shards) emit(k, l, 2);
split.sort();

// remove files that no longer belong (e.g. a shard that was split)
for (const sub of ['n', 'c', 's']) {
  const d = path.join(out, sub);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    const full = path.normalize(path.join(d, f));
    if (!live.has(full)) { fs.unlinkSync(full); written++; }
  }
}

// prebuilt block order so clients skip the sort (int16 bx,bz per inhabited block)
const ord = new Int16Array(L.count * 2);
for (let i = 0; i < L.count * 2; i++) ord[i] = L.blocks[i];
const ordBuf = Buffer.from(ord.buffer);
{
  const f = path.join(out, 'order.bin');
  live.add(path.normalize(f));
  let same = false;
  try { same = fs.readFileSync(f).equals(ordBuf); } catch { /* new */ }
  if (!same) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(f + '.tmp', ordBuf); fs.renameSync(f + '.tmp', f); written++; } else kept++;
}
const manifestBody = { v: 3, n, c: cman, split, nh, sh, order: hash(ordBuf) };
const built = hash(JSON.stringify(manifestBody) + JSON.stringify([...regions.keys()].sort()) + written);
let prev = null;
try { prev = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')); } catch { /* first build */ }
const manifest = { ...manifestBody, built: written || !prev ? built : prev.built, at: written || !prev ? new Date().toISOString() : prev.at };
put('manifest.json', JSON.stringify(manifest));
console.log(`${n} followers, ${nc} custom homes (${bad} skipped), ${regions.size} regions, ${shards.size} shards (${split.length} split); ` +
  `${written} files written, ${kept} unchanged, ${Date.now() - t0} ms`);
if (dupes.length) console.warn('warning: names that normalise to the same search key:\n  ' + dupes.join('\n  '));
