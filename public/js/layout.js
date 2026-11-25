// Which plot holds follower #n: the layout tables (formula, binary file, reference sort), the ring
// enumeration and the follower <-> plot mapping, data-file keys, and the ground data texture (split from town.js).
import { PITCH, REGION, SLOTS, K, hash3, fdiv, mod, isqrt, avenueX, avenueZ, rojiAt, cellKind, zoneLevel, laneBlock, plotsIn, kindAt } from './town.js';

// ---- layout: which block holds follower #n ----
// Residential blocks are ordered by squared distance from the plaza, ties broken by hash.
// Follower #n gets plot #n forever (append-only growth).

// Layout (round M): the order is a pure function: blocks sorted by squared distance from the plaza, ties by
// (hash3(bx,bz,77), bx, bz), each block holding plotsIn() homes, followers filling them in order. So it is
// stored as one small table — the distinct squared distances that hold homes (`dv`) and the number of homes
// before each (`cs`), ~1.3 MB at 10M followers — and the blocks on one ring are enumerated when needed.
// No per-block arrays, no order.bin, nothing that grows per block is copied between threads.
// buildLayoutRef (below) is the old sort, kept so tools/selftest.mjs can prove the two agree.
export function buildLayout(n) {
  let R = Math.ceil(Math.sqrt(Math.max(n, 1) / (8 * 0.5) / Math.PI)) + 4;
  for (;;) {
    const R2 = R * R, cnt = new Int32Array(R2 + 1), tallD = new Map();   // region -> nearest tall block's d2
    for (let bz = -R; bz <= R; bz++) {
      const dz = bz * bz;
      if (dz > R2) continue;
      const w = isqrt(R2 - dz);                                   // only the disk: no per-block d2 rejection
      for (let bx = -w; bx <= w; bx++) {
        if (cellKind(bx, bz) !== K.HOMES) continue;
        const d2 = bx * bx + dz, z = zoneLevel(bx, bz);
        cnt[d2] += z === 2 ? 16 : laneBlock(bx, bz, z) ? 10 : 8;   // = plotsIn
        if (z >= 2) { const rk = regionKey(fdiv(bx, 16), fdiv(bz, 16)), o = tallD.get(rk); if (o === undefined || d2 < o) tallD.set(rk, d2); }
      }
    }
    let total = 0, nd = 0, maxD2 = 0;
    for (let d = 0; d <= R2 && total < n; d++) if (cnt[d]) { total += cnt[d]; nd++; maxD2 = d; }
    if (total >= n || n === 0) {
      const dv = new Int32Array(nd), cs = new Int32Array(nd + 1);
      let k = 0, acc = 0;
      for (let d = 0; d <= maxD2; d++) if (cnt[d]) { dv[k] = d; cs[k] = acc; acc += cnt[d]; k++; }
      cs[nd] = acc;
      // regions that can hold skyline buildings (skyline tiles: SKY in mb.js), so empty skyline tiles are never requested
      const tall = ['0_0'];
      for (const [rk, d2] of tallD) if (d2 <= maxD2 && rk !== '0_0') tall.push(rk);
      return finishLayout({ n, dv, cs, maxD2, tall });
    }
    R = Math.ceil(R * 1.25);
  }
}

// The layout tables as a small binary file (tools/build.mjs writes it), so clients skip the 50-400 ms counting
// pass at boot. Round Q: the tables are delta + varint packed (dv rises by 1-3 a ring, a ring holds < 2^14 homes),
// ~2.3 bytes a ring instead of 8: 1M followers 26 KB (was 95), 10M 230 KB (was 825); parse 1-6 ms.
// Layout: magic 'FTL2', then varints: n, rings, maxD2, tall count, dv deltas, homes per ring (cs deltas),
// tall regions as zigzag (rx, rz). layoutFromBin returns null if the file does not match n.
const LMAGIC = 0x324c5446;   // 'FTL2' little-endian
export function layoutToBin(L) {
  const out = [];
  const vu = (v) => { while (v >= 128) { out.push((v & 127) | 128); v = Math.floor(v / 128); } out.push(v); };
  const zz = (v) => vu(v < 0 ? -2 * v - 1 : 2 * v);
  const nd = L.dv.length, tall = L.tall.map((k) => k.split('_').map(Number));
  vu(L.n); vu(nd); vu(L.maxD2); vu(tall.length);
  for (let k = 0; k < nd; k++) vu(L.dv[k] - (k ? L.dv[k - 1] : 0));
  for (let k = 0; k < nd; k++) vu(L.cs[k + 1] - L.cs[k]);
  for (const [x, z] of tall) { zz(x); zz(z); }
  const a = new Uint8Array(4 + out.length);
  new DataView(a.buffer).setUint32(0, LMAGIC, true);
  a.set(out, 4);
  return a.buffer;
}
export function layoutFromBin(n, buf) {
  if (!buf || buf.byteLength < 8) return null;
  const b = new Uint8Array(buf);
  if (new DataView(buf).getUint32(0, true) !== LMAGIC) return null;
  let p = 4, bad = false;
  const vu = () => {
    let v = 0, m = 1;
    for (;;) { if (p >= b.length) { bad = true; return 0; } const c = b[p++]; v += (c & 127) * m; if (c < 128) return v; m *= 128; }
  };
  const zz = () => { const v = vu(); return v & 1 ? -(v + 1) / 2 : v / 2; };
  const fn = vu(), nd = vu(), maxD2 = vu(), nt = vu();
  if (bad || fn !== n || nd <= 0 || nd > b.length) return null;
  const dv = new Int32Array(nd), cs = new Int32Array(nd + 1);
  for (let k = 0, d = 0; k < nd; k++) { d += vu(); dv[k] = d; }
  for (let k = 0; k < nd; k++) cs[k + 1] = cs[k] + vu();
  const tall = [];
  for (let i = 0; i < nt; i++) { const x = zz(), z = zz(); tall.push(regionKey(x, z)); }
  if (bad || p !== b.length || cs[nd] < n) return null;
  return finishLayout({ n, dv, cs, maxD2, tall });
}

// Blocks with homes on the ring bx^2+bz^2 = d, in layout order. Cached (rings are re-read a lot).
const RINGS = new Map();
function ring(d) {
  let r = RINGS.get(d);
  if (r) return r;
  const out = [], m = isqrt(d);
  for (let bx = -m; bx <= m; bx++) {
    const rest = d - bx * bx, z = isqrt(rest);
    if (z * z !== rest) continue;
    for (const bz of z ? [-z, z] : [0]) { const p = plotsIn(bx, bz); if (p) out.push([bx, bz, p, hash3(bx, bz, 77)]); }
  }
  out.sort((a, b) => (a[3] !== b[3] ? (a[3] < b[3] ? -1 : 1) : a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
  if (RINGS.size > 8192) RINGS.clear();
  RINGS.set(d, out);
  return out;
}
function ringIndex(L, d) {                         // index of d in L.dv, or -1
  let lo = 0, hi = L.dv.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, v = L.dv[m]; if (v === d) return m; if (v < d) lo = m + 1; else hi = m - 1; }
  return -1;
}
// first plot index of a block (or -1 if the block is outside the town or holds no homes)
function blockStart(L, bx, bz) {
  const d = bx * bx + bz * bz;
  if (d > L.maxD2) return -1;
  const k = ringIndex(L, d);
  if (k < 0) return -1;
  let s = L.cs[k];
  for (const e of ring(d)) { if (e[0] === bx && e[1] === bz) return s; s += e[2]; }
  return -1;
}

// Reference implementation: the original sort (tools/selftest.mjs only).
export function buildLayoutRef(n) {
  // Counting sort by squared distance into typed arrays (no per-block JS objects), ties by
  // (hash, bx, bz) inside each distance bucket. Same order as a full comparison sort.
  let R = Math.ceil(Math.sqrt(Math.max(n, 1) / (8 * 0.5) / Math.PI)) + 4;
  for (;;) {
    const R2 = R * R, cap = Math.ceil(Math.PI * R2 + 8 * R + 16);
    const cbx = new Int16Array(cap), cbz = new Int16Array(cap), cd2 = new Int32Array(cap), ch = new Uint32Array(cap), cp = new Uint8Array(cap);
    const cnt = new Int32Array(R2 + 2);
    let N = 0;
    for (let bz = -R; bz <= R; bz++) for (let bx = -R; bx <= R; bx++) {
      const d2 = bx * bx + bz * bz;
      if (d2 > R2) continue;
      const p = plotsIn(bx, bz);
      if (!p) continue;
      cbx[N] = bx; cbz[N] = bz; cd2[N] = d2; ch[N] = hash3(bx, bz, 77); cp[N] = p; N++;
      cnt[d2 + 1]++;
    }
    for (let i = 1; i <= R2 + 1; i++) cnt[i] += cnt[i - 1];
    const ord = new Int32Array(N), fill = cnt.slice(0, R2 + 1);
    for (let i = 0; i < N; i++) ord[fill[cd2[i]]++] = i;
    const less = (i, j) => ch[i] !== ch[j] ? ch[i] < ch[j] : cbx[i] !== cbx[j] ? cbx[i] < cbx[j] : cbz[i] < cbz[j];
    for (let d = 0; d <= R2; d++) {                       // buckets are small: insertion sort
      for (let i = cnt[d] + 1; i < cnt[d + 1]; i++) {
        const v = ord[i]; let j = i - 1;
        while (j >= cnt[d] && less(v, ord[j])) { ord[j + 1] = ord[j]; j--; }
        ord[j + 1] = v;
      }
    }
    let total = 0, count = 0;
    while (count < N && total < n) total += cp[ord[count++]];
    if (total >= n || n === 0) {
      const blocks = new Int32Array(count * 2), start = new Int32Array(count + 1), plots = new Uint8Array(count);
      let acc = 0, maxD2 = 0;
      for (let i = 0; i < count; i++) {
        const c = ord[i];
        blocks[2 * i] = cbx[c]; blocks[2 * i + 1] = cbz[c]; plots[i] = cp[c];
        start[i] = acc; acc += cp[c]; maxD2 = cd2[c];
      }
      start[count] = acc;
      return { n, count, blocks, start, plots, maxD2 };
    }
    R = Math.ceil(R * 1.25);
  }
}

// Rebuild derived fields (also used after posting a layout between threads).
export function finishLayout(L) {
  const rB = Math.max(3, Math.ceil(Math.sqrt(L.maxD2)));
  L.rB = rB;
  L.townD2 = (rB + 1) * (rB + 1);
  L.seaBx = Math.max(rB + 7, 46);
  L.portX = 32 * PITCH;
  L.seaX = L.seaBx * PITCH - 24;
  return L;
}

// Per-block data for the ground shader (so it does not re-derive the rules per pixel).
// RGBA8, (2*ext+1)^2 texels centred on the plaza, ext = rB + 10:
//   R kind · G zone | inhabited<<2 | avenueX<<3 | avenueZ<<4 · B roof colours c0 | c1<<3 · A c2
// A window of at most GROUND_MAX^2 blocks (round M; 641: a 1.2M-follower town fits whole): the whole town when it fits, otherwise centred on
// (cx, cz) — the main thread asks for a new window when the camera moves far — so the texture is the same
// size at 1M and at 10M followers. ox/oz: the block at texel (0, 0).
const GROUND_MAX = 641;
export function buildGround(L, cx = 0, cz = 0) {
  const full = 2 * (L.rB + 10) + 1, S = Math.min(full, GROUND_MAX), h = (S - 1) / 2;
  const ox = full <= GROUND_MAX ? -h : cx - h, oz = full <= GROUND_MAX ? -h : cz - h;
  const d = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const bx = i + ox, bz = j + oz, o = (j * S + i) * 4;
    const k = kindAt(L, bx, bz);
    const homes = k === K.HOMES;
    const base = hash3(fdiv(bx, 5), fdiv(bz, 5), 101);
    d[o] = k;
    d[o + 1] = (homes ? zoneLevel(bx, bz) : 0) | (homes && bx * bx + bz * bz <= L.maxD2 ? 4 : 0) | (avenueX(bx) ? 8 : 0) | (avenueZ(bz) ? 16 : 0) | (homes && zoneLevel(bx, bz) <= 1 && rojiAt(bx, bz) ? 32 : 0);
    d[o + 2] = (base % 8) | (((base >>> 4) % 8) << 3);
    d[o + 3] = (base >>> 8) % 8;
  }
  return { size: S, ox, oz, cx, cz, full: full <= GROUND_MAX, data: d };
}

export function layoutTransfer(L) {
  return { n: L.n, dv: L.dv, cs: L.cs, maxD2: L.maxD2, tall: L.tall };
}

// Occupied slots in a block (0 if nobody lives there).
export function occupied(L, bx, bz) {
  const st = blockStart(L, bx, bz);
  if (st < 0 || st >= L.n) return 0;
  return Math.min(plotsIn(bx, bz), L.n - st);
}

// Plot index of a slot (or -1).
export function plotIndex(L, bx, bz, slot) {
  const st = blockStart(L, bx, bz);
  if (st < 0 || slot >= Math.min(plotsIn(bx, bz), L.n - st)) return -1;
  return st + slot;
}

// Plot #p -> block and slot.
export function plotOf(L, p) {
  let lo = 0, hi = L.dv.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L.cs[m] <= p) lo = m; else hi = m - 1; }
  let s = L.cs[lo];
  for (const e of ring(L.dv[lo])) { if (p < s + e[2]) return { bx: e[0], bz: e[1], slot: p - s }; s += e[2]; }
  return { bx: 0, bz: 0, slot: 0 };
}

// ---- data files ----

export const regionOf = (b) => fdiv(b, REGION);
export const regionKey = (rx, rz) => `${rx}_${rz}`;
export function lineIndex(bx, bz, slot) {
  const lx = mod(bx, REGION), lz = mod(bz, REGION);
  return (lz * REGION + lx) * SLOTS + slot;
}
