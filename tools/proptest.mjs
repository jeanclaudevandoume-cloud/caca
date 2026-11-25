// Property / fuzz tests for the layout and the mesher (round Q): seeded, ~2,000 cases, < 20 s.
//   node tools/proptest.mjs [seed]
// Layout: plotOf / plotIndex are inverses, layout.bin round-trips, growth is append-only.
// Meshes (chunks lod 0/1 lite/full, skyline lite/full, mid-band tiles, random and garbage custom homes):
// indices in range, no zero-area triangles, nothing overflows the packed vertex format, the shadow-only proxy
// prefix is ordered and never shares a vertex with the colour range, vertices stay inside the tile box and
// under ymax, and building the same tile twice is byte-identical. Custom specs never throw and their colours
// stay soft.
import * as Town from '../public/js/town.js';
import * as Layout from '../public/js/layout.js';
import * as Recipe from '../public/js/recipe.js';
import * as Mz from '../public/js/mesher.js';
import { MB, SKY, MID } from '../public/js/mb.js';
const T = { ...Town, ...Layout, ...Recipe };   // the town rules (town.js, layout.js, recipe.js) as one namespace

let seed = +(process.argv[2] || 20261121) >>> 0;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
let fails = 0, cases = 0;
const failed = [];
const check = (name, ok, detail = '') => { if (!ok) { fails++; if (failed.length < 12) failed.push(`${name}${detail ? ': ' + detail : ''}`); } };
const t0 = performance.now();

// ---- layout ----
for (let k = 0; k < 140; k++, cases++) {
  const n = ri(1, 200000), L = T.buildLayout(n);
  for (let j = 0; j < 24; j++) {
    const p = ri(0, n - 1), b = T.plotOf(L, p);
    check('plotIndex(plotOf(p)) == p', T.plotIndex(L, b.bx, b.bz, b.slot) === p, `n=${n} p=${p}`);
    check('plotOf lands on an occupied slot', b.slot < T.occupied(L, b.bx, b.bz), `n=${n} p=${p}`);
  }
  const B = T.layoutFromBin(n, T.layoutToBin(L));
  check('layout.bin round-trips', !!B && B.maxD2 === L.maxD2 && B.dv.length === L.dv.length && B.cs.every((v, i) => v === L.cs[i]) && B.tall.join() === L.tall.join(), `n=${n}`);
  check('layout.bin is rejected for another n', T.layoutFromBin(n + 1, T.layoutToBin(L)) === null, `n=${n}`);
  if (k % 4 === 0) {
    const n2 = n + ri(1, 5000), L2 = T.buildLayout(n2);
    for (let j = 0; j < 16; j++) {
      const p = ri(0, n - 1), a = T.plotOf(L, p), c = T.plotOf(L2, p);
      check('append-only growth', a.bx === c.bx && a.bz === c.bz && a.slot === c.slot, `n=${n}->${n2} p=${p}`);
    }
  }
}

// ---- meshes ----
MB.strict = true;
const before = MB.overflow.length;
function meshProps(name, m, sc, half, ymaxCap) {
  const p = new Int16Array(m.vb), ib = m.ib, nv = m.vb.byteLength / 16;
  let bad = '';
  if (!(m.so >= 0 && m.so <= m.ns && m.ns <= ib.length && m.so % 3 === 0 && ib.length % 3 === 0)) bad += ` order so=${m.so} ns=${m.ns} n=${ib.length}`;
  let outIdx = 0, degen = 0, outBox = 0;
  for (let i = 0; i < ib.length; i++) if (ib[i] >= nv) outIdx++;
  for (let i = 0; i < ib.length; i += 3) {
    const a = ib[i] * 8, b = ib[i + 1] * 8, c = ib[i + 2] * 8;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    if (uy * vz - uz * vy === 0 && uz * vx - ux * vz === 0 && ux * vy - uy * vx === 0) degen++;
  }
  for (let v = 0; v < nv; v++) {
    const x = p[v * 8] / sc, y = p[v * 8 + 1] / sc, z = p[v * 8 + 2] / sc;
    if (Math.abs(x) > half || Math.abs(z) > half || y < -1 || y > Math.min(m.ymax, ymaxCap) + 0.05) outBox++;
  }
  if (outIdx) bad += ` ${outIdx} indices out of range`;
  if (degen) bad += ` ${degen} zero-area`;
  if (outBox) bad += ` ${outBox} vertices outside the box / above ymax`;
  if (m.so) {
    const proxyV = new Set(ib.subarray(0, m.so));
    for (let i = m.so; i < ib.length; i++) if (proxyV.has(ib[i])) { bad += ' colour range uses a proxy vertex'; break; }
  }
  check(name, !bad, bad);
}
const same = (a, b) => a.vb.byteLength === b.vb.byteLength && Buffer.from(a.vb).equals(Buffer.from(b.vb)) && Buffer.from(a.ib.buffer, a.ib.byteOffset, a.ib.byteLength).equals(Buffer.from(b.ib.buffer, b.ib.byteOffset, b.ib.byteLength));
const towns = [T.buildLayout(1000000), T.buildLayout(ri(2000, 60000))];
const CH = T.CHUNK * T.PITCH;
// garbage custom homes for a region: valid and invalid shapes, colours and gardens
const JUNK = ['', 'cube', 'castle', 'rocket', '<script>', 'ufo', 'pyramid', '🏠', 'mushroom', 'nope', null, 42];
const COL = ['#ff0000', '#00ff00', '#fff', 'red', '#12345', 'zzz', '', null, '#000000', '#ffffff', '#8a2be2', 7];
function junkSpec() {
  const g = [];
  for (let i = ri(0, 8); i > 0; i--) g.push(rnd() < 0.5 ? T.GARDEN[ri(0, T.GARDEN.length - 1)] : JUNK[ri(0, JUNK.length - 1)]);
  return { shape: JUNK[ri(0, JUNK.length - 1)], color: COL[ri(0, COL.length - 1)], garden: rnd() < 0.8 ? g : 'notarray' };
}
for (let k = 0; k < 260; k++, cases++) {
  const L = towns[k & 1], lim = Math.max(2, Math.ceil(L.rB / T.CHUNK));
  const cx = ri(-lim, lim), cz = ri(-lim, lim), lod = rnd() < 0.3 ? 1 : 0, lite = rnd() < 0.5;
  let customs = null;
  if (rnd() < 0.3) {                                // a region full of custom homes, junk included
    customs = new Map();
    const bx0 = cx * T.CHUNK, bz0 = cz * T.CHUNK, spec = {};
    for (let s = 0; s < 64; s++) spec[T.lineIndex(bx0 + (s & 3), bz0 + ((s >> 2) & 3), s >> 4)] = junkSpec();
    customs.set(T.regionKey(T.regionOf(bx0), T.regionOf(bz0)), spec);
  }
  let m = null;
  try { m = Mz.buildChunk(L, cx, cz, lod, customs, lite); } catch (e) { check('buildChunk never throws', false, `${cx},${cz} ${e.message}`); continue; }
  meshProps(`chunk ${cx},${cz} lod${lod}${lite ? ' lite' : ''}${customs ? ' custom' : ''}`, m, 64, CH / 2 + 40, 400);
  if (k % 5 === 0) check('chunk is deterministic', same(m, Mz.buildChunk(L, cx, cz, lod, customs, lite)), `${cx},${cz}`);
}
for (let k = 0; k < 60; k++, cases++) {
  const L = towns[0], lim = Math.ceil(L.rB / SKY) + 1, sx = ri(-lim, lim), sz = ri(-lim, lim), lite = rnd() < 0.5;
  const m = Mz.buildSkyline(L, sx, sz, lite);
  meshProps(`skyline ${sx},${sz}${lite ? ' lite' : ''}`, m, 32, SKY * T.PITCH / 2 + 60, 400);
  if (k % 6 === 0) check('skyline is deterministic', same(m, Mz.buildSkyline(L, sx, sz, lite)), `${sx},${sz}`);
}
for (let k = 0; k < 60; k++, cases++) {
  const L = towns[k & 1], lim = Math.ceil(L.rB / MID) + 1, mx = ri(-lim, lim), mz = ri(-lim, lim);
  const m = Mz.buildMid(L, mx, mz);
  meshProps(`mid ${mx},${mz}`, m, 64, MID * T.PITCH / 2 + 30, 60);
}
check('nothing overflows the packed vertex format', MB.overflow.length === before, MB.overflow.slice(before, before + 3).join(' | '));

// ---- custom specs: never throw, colours stay soft ----
const hsv = (c) => { const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b); return [mx ? (mx - mn) / mx : 0, mx]; };
for (let k = 0; k < 1500; k++, cases++) {
  const bx = ri(-200, 200), bz = ri(-200, 200), zone = ri(0, 3), slot = ri(0, 15);
  let r = null;
  try { r = T.recipe(bx, bz, slot, zone, junkSpec()); } catch (e) { check('recipe never throws on a junk spec', false, e.message); continue; }
  const [sat, val] = hsv(r.color);   // soften caps saturation at .32 and value at .75
  check('custom colours stay soft', sat <= 0.32 + 0.02 && val <= 0.75 + 0.02, `#${r.color.toString(16)} s=${sat.toFixed(2)} v=${val.toFixed(2)}`);
  check('custom shape is a known one', T.SHAPES.includes(r.shape), String(r.shape));
  check('custom garden is a clean list', Array.isArray(r.garden) && r.garden.length <= 4 && r.garden.every((g) => T.GARDEN.includes(g)));
}

const ms = performance.now() - t0;
for (const f of failed) console.log('FAIL ' + f);
console.log(`${fails ? fails + ' property failure(s)' : 'all properties hold'} — ${cases} cases, seed ${process.argv[2] || 20261121}, ${(ms / 1000).toFixed(1)} s`);
process.exit(fails ? 1 : 0);
