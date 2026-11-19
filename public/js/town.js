// Follower Town — every rule that decides WHERE things are and HOW a home looks.
// Shared verbatim by the browser, the mesh worker and the Node build tool.
//
// Determinism: only integer math through hash3 decides anything. No Math.random, no time,
// no GPU. Math.sqrt is only used on exact integers (IEEE sqrt is correctly rounded, so
// floor(sqrt(int)) is identical everywhere).
//
// The ground shader (shaders.js, groundBase) mirrors hash3, riverZ, cellKind, zoneLevel,
// plot layout and roofIdx by hand. Change one, change the other.

export const PITCH = 48;        // block + road
export const BLK = 40;          // block size
export const HALF = 20;
export const CHUNK = 4;         // blocks per chunk side
export const REGION = 16;       // blocks per data region side
export const SLOTS = 16;        // data slots per block in region files
export const FLOOR_H = 3.2;

export const K = { HOMES: 0, PLAZA: 1, PARK: 2, LAKE: 3, RIVER: 4, AVENUE: 5, COUNTRY: 6, HIGHWAY: 7, PORT: 8, SEA: 9 };

export function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export const fdiv = (a, b) => Math.floor(a / b);
export const mod = (a, b) => ((a % b) + b) % b;
export const isqrt = (n) => Math.floor(Math.sqrt(n));

// ---- static city structure (pure functions of block coordinates) ----

// The river: a gentle zig-zag running west-east, ~9 blocks south of the plaza.
export function riverZ(bx) {
  const t = mod(bx + 12, 48);
  const tri = t < 24 ? t - 12 : 36 - t;
  return 9 + fdiv(tri, 2);
}
// Three blocks wide; the union with the next column keeps the water continuous at every step.
export function isRiver(bx, bz) {
  const a = riverZ(bx), b = riverZ(bx + 1);
  return (bz >= a - 1 && bz <= a + 1) || (bz >= b - 1 && bz <= b + 1);
}
export const avenueX = (bx) => mod(bx, 10) === 0;   // avenue running north-south
export const avenueZ = (bz) => mod(bz, 10) === 0;   // avenue running east-west

export function lakeAt(bx, bz) {
  if (bx * bx + bz * bz <= 400) return false;
  const cx = fdiv(bx, 9), cz = fdiv(bz, 9);
  const hl = hash3(cx, cz, 9);
  if (hl % 100 >= 35) return false;
  const lx = cx * 9 + 2 + ((hl >>> 8) % 5), lz = cz * 9 + 2 + ((hl >>> 12) % 5);
  if (bx === lx && bz === lz) return true;
  if (((hl >>> 16) & 1) && bx === lx + 1 && bz === lz) return true;
  if (((hl >>> 17) & 1) && bx === lx && bz === lz + 1) return true;
  return false;
}

// Static kind: never depends on follower count.
export function cellKind(bx, bz) {
  if (bx === 0 && bz === 0) return K.PLAZA;
  if (isRiver(bx, bz)) return K.RIVER;
  if (avenueX(bx) || avenueZ(bz)) return K.AVENUE;
  const d2 = bx * bx + bz * bz;
  if (d2 > 16 && hash3(bx, bz, 3) % 100 < 5) return K.PARK;
  if (lakeAt(bx, bz)) return K.LAKE;
  return K.HOMES;
}

// 3 = tower core, 2 = mid-rise, 1 = townhouses, 0 = suburbs. Hubs repeat on a 32-block grid.
export function zoneLevel(bx, bz) {
  const j = hash3(bx, bz, 11) % 32;
  const d2 = bx * bx + bz * bz;
  if (d2 < 36 + j) return 3;
  if (d2 < 144 + 3 * j) return 2;
  if (d2 < 400 + 6 * j) return 1;
  const hx = fdiv(bx + 16, 32) * 32, hz = fdiv(bz + 16, 32) * 32;
  const hh = hash3(hx, hz, 5);
  if (hh % 4 !== 0) {
    const dx = bx - hx - ((hh >>> 4) % 7 - 3), dz = bz - hz - ((hh >>> 8) % 7 - 3);
    const dh2 = dx * dx + dz * dz;
    if (dh2 < 4 + (j >> 3)) return 3;
    if (dh2 < 20 + (j >> 1)) return 2;
    if (dh2 < 64 + j) return 1;
  }
  return 0;
}

export function plotsIn(bx, bz) {
  if (cellKind(bx, bz) !== K.HOMES) return 0;
  return zoneLevel(bx, bz) === 2 ? 16 : 8;
}

// Kind including the follower-count dependent outskirts (country, highways, port, sea).
export function kindAt(L, bx, bz) {
  if (bx >= L.seaBx) return K.SEA;
  if (bx >= L.seaBx - 3 && bz >= -9 && bz <= -1) return K.PORT;
  const k = cellKind(bx, bz);
  if (bx * bx + bz * bz <= L.townD2 || k === K.RIVER) return k;
  if (bx === 0 || bz === 0) return K.HIGHWAY;
  return K.COUNTRY;
}

// ---- plots ----

// Plot frame in world metres: centre, size, and which way the front faces (+1 = +z street, -1 = -z).
export function plotFrame(bx, bz, slot, zone, out = {}) {
  const x0 = bx * PITCH, z0 = bz * PITCH;
  const col = slot & 3, row = slot >> 2;
  out.x = x0 - 15 + col * 10;
  out.w = 10;
  if (zone === 2) { out.z = z0 - 15 + row * 10; out.d = 10; out.face = row < 2 ? -1 : 1; }
  else { out.z = z0 - 10 + row * 20; out.d = 20; out.face = row === 0 ? -1 : 1; }
  return out;
}

// Which plot of a block is at a local position (lx, lz relative to block centre)?
export function slotAt(zone, lx, lz) {
  if (lx < -20 || lx >= 20 || lz < -20 || lz >= 20) return -1;
  const col = Math.min(3, Math.floor((lx + 20) / 10));
  const row = zone === 2 ? Math.min(3, Math.floor((lz + 20) / 10)) : (lz < 0 ? 0 : 1);
  return row * 4 + col;
}

// Roofs: each 5x5-block district has a main colour, a second and a rare third, so
// neighbourhoods read as places instead of confetti.
export function roofIdx(bx, bz, slot) {
  const base = hash3(fdiv(bx, 5), fdiv(bz, 5), 101), v = hash3(bx, bz, slot * 7 + 100) % 10;
  return (v < 6 ? base : v < 9 ? base >>> 4 : base >>> 8) % 8;
}
export const districtAccent = (bx, bz) => hash3(fdiv(bx, 4), fdiv(bz, 4), 31) % 6;

// Palettes (0xRRGGBB). The ground shader holds ROOF too.
export const WALL = [0xfff1d6, 0xffd2b8, 0xc9f0dc, 0xc7e4ff, 0xe3d4ff, 0xfff0a8, 0xffc4c4, 0xfafafa];
export const ROOF = [0xd8563b, 0x2a9d8f, 0x3d5a98, 0xc2304f, 0x3c8d4f, 0x7b4b94, 0x4a4e5a, 0xe0a030];
export const CITY = [0xd9d6cf, 0xc3c7cc, 0xe8dcc6, 0xb7beca, 0xf2efe8, 0xcfc2b0];
export const ACCENT = [0xff6b6b, 0x1fb5ad, 0xffb627, 0x6c63ff, 0x2ec27e, 0xff8fb1];
export const GLASS = [0x5d8fb3, 0x3f9a9a, 0x2f4a72, 0x9fb4c8, 0xb08a5a, 0x4f8a6a, 0xd8dde4, 0x6a5f8a];

export const SHAPES = ['mushroom', 'dome', 'castle', 'pyramid', 'ufo', 'treehouse', 'lighthouse', 'igloo', 'rocket', 'cube'];
export const GARDEN = ['fountain', 'pool', 'flowers', 'tree', 'car', 'trampoline', 'statue', 'bench', 'swing', 'pond', 'palm', 'tent'];

// How a home looks. `custom` (optional) = { shape, color: '#rrggbb', garden: [..] }.
export function recipe(bx, bz, slot, zone, custom) {
  const h = hash3(bx * 16 + slot, bz, 21), h2 = hash3(bx, bz * 16 + slot, 22);
  const r = { zone, slot, hash: h, roof: roofIdx(bx, bz, slot), wall: 0, floors: 1, w: 7, d: 9,
    roofType: 0, mat: 1, garden: [], tree: false, shape: null, color: -1, top: false, crown: 0 };
  if (zone === 0) {
    r.floors = 1 + (h & 1);
    r.w = 6.5 + ((h >>> 1) % 5) * 0.5;
    r.d = 8 + ((h >>> 4) % 7) * 0.5;
    r.roofType = (h >>> 8) % 3;              // 0 gable, 1 hip, 2 flat
    r.wall = WALL[(h >>> 11) % 8];
    r.tree = ((h >>> 14) % 10) < 7;
    if ((h >>> 18) % 3 === 0) r.garden.push(GARDEN[(h2 >>> 3) % GARDEN.length]);
  } else if (zone === 1) {
    r.floors = 2 + (h % 3);
    r.w = 9.4; r.d = 12 + ((h >>> 4) % 7) * 0.5;
    r.roofType = (h >>> 8) % 4 === 0 ? 0 : 2;
    r.wall = WALL[(h >>> 11) % 8];
    r.tree = ((h >>> 14) % 10) < 3;
  } else if (zone === 2) {
    r.floors = 4 + (h % 9);
    r.w = 8.6; r.d = 8.6; r.roofType = 2;
    r.wall = (h >>> 9) % 5 === 0 ? blend(ACCENT[districtAccent(bx, bz)], 0xf2efe8, 0.45) : CITY[(h >>> 11) % CITY.length];
    r.crown = (h >>> 15) % 3;
  } else {
    // towers: height tapers from the centre, with ragged variety and the odd landmark
    const d = isqrt(bx * bx + bz * bz);
    const hubFar = d > 10;
    const maxF = hubFar ? 30 : Math.max(18, 50 - 4 * d);
    const roll = h % 100;
    r.floors = Math.max(8, Math.floor(maxF * (30 + (h >>> 7) % 71) / 100));
    if (roll < 7) r.floors = Math.min(60, Math.floor(maxF * 1.2));
    r.w = 7.5 + ((h >>> 3) % 5) * 0.5; r.d = 11 + ((h >>> 5) % 7);
    r.roofType = 2; r.mat = 5;
    r.wall = GLASS[(h >>> 9) % GLASS.length];
    r.crown = (h >>> 15) % 5;
  }
  if (custom) {
    if (zone >= 2) r.top = true;
    r.shape = SHAPES.includes(custom.shape) ? custom.shape : 'cube';
    r.color = parseColor(custom.color, ACCENT[h % ACCENT.length]);
    if (Array.isArray(custom.garden)) r.garden = custom.garden.filter((g) => GARDEN.includes(g)).slice(0, 4);
  }
  r.height = zone >= 2 || !r.shape || r.top ? r.floors * FLOOR_H : 0;
  return r;
}

export function blend(a, b, t) {
  const f = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
  return f(16) | f(8) | f(0);
}

export function parseColor(s, dflt) {
  if (typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)) return parseInt(s.slice(1), 16);
  return dflt;
}

// ---- layout: which block holds follower #n ----
// Residential blocks are ordered by squared distance from the plaza, ties broken by hash.
// Follower #n gets plot #n forever (append-only growth).

export function buildLayout(n) {
  let R = Math.ceil(Math.sqrt(Math.max(n, 1) / (8 * 0.5) / Math.PI)) + 4;
  for (;;) {
    const R2 = R * R;
    const cand = [];
    for (let bz = -R; bz <= R; bz++) for (let bx = -R; bx <= R; bx++) {
      const d2 = bx * bx + bz * bz;
      if (d2 > R2) continue;
      const p = plotsIn(bx, bz);
      if (p) cand.push([d2, hash3(bx, bz, 77), bx, bz, p]);
    }
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
    let total = 0, count = 0;
    while (count < cand.length && total < n) total += cand[count++][4];
    if (total >= n || n === 0) {
      const blocks = new Int32Array(count * 2), start = new Int32Array(count + 1), plots = new Uint8Array(count);
      let acc = 0, maxD2 = 0;
      for (let i = 0; i < count; i++) {
        const c = cand[i];
        blocks[2 * i] = c[2]; blocks[2 * i + 1] = c[3]; plots[i] = c[4];
        start[i] = acc; acc += c[4]; maxD2 = c[0];
      }
      start[count] = acc;
      return finishLayout({ n, count, blocks, start, plots, maxD2 });
    }
    R = Math.ceil(R * 1.25);
  }
}

// Rebuild derived fields (also used after posting a layout between threads).
export function finishLayout(L) {
  const rB = Math.max(3, Math.ceil(Math.sqrt(L.maxD2)));
  L.rB = rB;
  L.townD2 = (rB + 1) * (rB + 1);
  L.seaBx = rB + 7;
  L.portX = (L.seaBx - 2) * PITCH;
  L.seaX = L.seaBx * PITCH - 24;
  const G = 2 * rB + 3;
  L.G = G;
  if (!L.grid) {
    L.grid = new Int32Array(G * G);
    for (let i = 0; i < L.count; i++) {
      const gx = L.blocks[2 * i] + rB + 1, gz = L.blocks[2 * i + 1] + rB + 1;
      L.grid[gz * G + gx] = i + 1;
    }
  }
  return L;
}

export function layoutTransfer(L) {
  return { n: L.n, count: L.count, blocks: L.blocks, start: L.start, plots: L.plots, maxD2: L.maxD2, grid: L.grid };
}

// Order index of a block (or -1).
export function blockOrder(L, bx, bz) {
  const gx = bx + L.rB + 1, gz = bz + L.rB + 1;
  if (gx < 0 || gz < 0 || gx >= L.G || gz >= L.G) return -1;
  return L.grid[gz * L.G + gx] - 1;
}

// Occupied slots in a block (0 if nobody lives there).
export function occupied(L, bx, bz) {
  const i = blockOrder(L, bx, bz);
  if (i < 0) return 0;
  return Math.min(L.plots[i], L.n - L.start[i]);
}

// Plot index of a slot (or -1).
export function plotIndex(L, bx, bz, slot) {
  const i = blockOrder(L, bx, bz);
  if (i < 0 || slot >= Math.min(L.plots[i], L.n - L.start[i])) return -1;
  return L.start[i] + slot;
}

// Plot #p -> block and slot.
export function plotOf(L, p) {
  let lo = 0, hi = L.count - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (L.start[m] <= p) lo = m; else hi = m - 1;
  }
  return { bx: L.blocks[2 * lo], bz: L.blocks[2 * lo + 1], slot: p - L.start[lo] };
}

// ---- data files ----

export const regionOf = (b) => fdiv(b, REGION);
export const regionKey = (rx, rz) => `${rx}_${rz}`;
export function lineIndex(bx, bz, slot) {
  const lx = mod(bx, REGION), lz = mod(bz, REGION);
  return (lz * REGION + lx) * SLOTS + slot;
}

export function normName(s) {
  return String(s).trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._]/g, '');
}
export function shardKey(norm, len) {
  let k = norm.slice(0, len);
  while (k.length < len) k += '-';
  return k.replace(/\./g, '~');
}
// Pick the shard file for a name given the manifest's list of split prefixes.
export function shardFor(norm, split) {
  let len = 2;
  while (split && split.includes(shardKey(norm, len)) && len < 6) len++;
  return shardKey(norm, len);
}
