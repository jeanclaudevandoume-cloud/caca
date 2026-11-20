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

// The river: a smooth meander (6 * sin, rounded, period 48 blocks) ~9 blocks south of the plaza.
// The ground shader holds the same table.
const RIV = [0,1,2,2,3,4,4,5,5,6,6,6,6,6,6,6,5,5,4,4,3,2,2,1,0,-1,-2,-2,-3,-4,-4,-5,-5,-6,-6,-6,-6,-6,-6,-6,-5,-5,-4,-4,-3,-2,-2,-1];
export const riverZ = (bx) => 9 + RIV[mod(bx, 48)];
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

// The bay: a static wedge of sea starting ~1.1 km east of the plaza, widening into a channel
// that runs out to the open sea. The river flows into it.
export const bayHalf = (bx) => Math.min(3 + fdiv((bx - 24) * 3, 4), 18);
export const bayAt = (bx, bz) => bx >= 24 && bz >= 2 - bayHalf(bx) && bz <= 2 + bayHalf(bx);
// Container port on the bay's north shore: lane 0 = quay, 1 = containers, 2 = warehouses (-1 = none).
export function portLane(bx, bz) {
  if (bx < 25 || bx > 40) return -1;
  const e = 1 - bayHalf(bx) - bz;
  return e >= 0 && e <= 2 ? e : -1;
}

// Static kind: never depends on follower count.
export function cellKind(bx, bz) {
  if (bx === 0 && bz === 0) return K.PLAZA;
  if (bayAt(bx, bz)) return K.SEA;
  if (portLane(bx, bz) >= 0) return K.PORT;
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
    // hubs: jittered off the lattice and of three sizes, so the far field does not read as a grid
    const dx = bx - hx - ((hh >>> 4) % 13 - 6), dz = bz - hz - ((hh >>> 8) % 13 - 6);
    const dh2 = dx * dx + dz * dz, sz = (hh >>> 12) % 3;
    if (dh2 < (sz ? 3 + 2 * sz : 1) + (j >> 3)) return 3;
    if (dh2 < 10 + 8 * sz + (j >> 1)) return 2;
    if (dh2 < 36 + 22 * sz + j) return 1;
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
  const k = cellKind(bx, bz);
  if (bx * bx + bz * bz <= L.townD2 || k === K.RIVER || k === K.SEA || k === K.PORT) return k;
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
  const base = hash3(fdiv(bx, 5), fdiv(bz, 5), 101), h = hash3(bx, bz, slot * 7 + 100), v = h % 100;
  return (v < 25 ? base : v < 50 ? base >>> 4 : h >>> 8) % 8;   // a district leans on a colour, but streets stay varied
}
export const districtAccent = (bx, bz) => hash3(fdiv(bx, 4), fdiv(bz, 4), 31) % 6;

// Palettes (0xRRGGBB). The ground shader holds ROOF too.
export const WALL = [0xf0ece2, 0xe2d8c4, 0xcdbfa5, 0x9a8f80, 0xf4f2ec, 0xc9b49a, 0x8a5a3c, 0x5c6870];   // ART.md: Tokyo/Seoul palette (round B: one house in ~4 is dark, for rhythm)
// townhouses: three brick tones, then stucco
export const TOWN = [0x9a5a43, 0xb07a5a, 0xc8b08e, 0x8e8a84, 0xe3dccf];
export const ROOF = [0x3a3e45, 0x4b5663, 0x9aa3a8, 0x2f4d7a, 0x8a4a34, 0x9a4a30, 0x3f6b6e, 0x2b2d31];   // ART.md: charcoal/slate, galvalume (metal OVERRIDE: V .66), navy, terracotta, teal; green only on villas
// ART.md city facades: S <= .30, V <= .85 (the palette is clamped to the table)
export const CITY = [0xc9a27e, 0x8e9aa6, 0xd8c3a0, 0x5f6b78, 0xb5876a, 0xe0d6c4, 0x4a5560].map((c) => clampSV(c, 0.295, 0.845));
export const ACCENT = [0xff6b6b, 0x1fb5ad, 0xffb627, 0x6c63ff, 0x2ec27e, 0xff8fb1];
export const GLASS = [0x4d7799, 0x2f7f86, 0x2f4a72, 0x2a4a63, 0x8a6a4a, 0x3b5a4f, 0x6b4f3a, 0x1f2a3a, 0x7a5a3e, 0x355f8f, 0x2c3f4f, 0x5a6f80];   // ART.md: dark only

export const SHAPES = ['mushroom', 'dome', 'castle', 'pyramid', 'ufo', 'treehouse', 'lighthouse', 'igloo', 'rocket', 'cube'];
export const GARDEN = ['fountain', 'pool', 'flowers', 'tree', 'car', 'trampoline', 'statue', 'bench', 'swing', 'pond', 'palm', 'tent'];

// How a home looks. `custom` (optional) = { shape, color: '#rrggbb', garden: [..] }.
export function recipe(bx, bz, slot, zone, custom) {
  const h = hash3(bx * 16 + slot, bz, 21), h2 = hash3(bx, bz * 16 + slot, 22);
  const r = { zone, slot, hash: h, roof: roofIdx(bx, bz, slot), wall: 0, floors: 1, w: 7, d: 9,
    roofType: 0, mat: 1, style: 0, sig: false, ox: 0, garden: [], tree: false, shape: null, color: -1, top: false, crown: 0 };
  if (zone === 0) {
    // Tokyo jutaku: narrow 2-3 storey house close to the street, hugging one side line
    r.floors = 2 + (h & 1);                   // half are 3 storeys
    r.w = 8.0 + ((h >>> 1) % 4) * 0.3;        // packed: side gaps 0.7-1.6 m
    r.d = 11 + ((h >>> 4) % 4) * 0.75;
    const rt = (h >>> 8) % 20;
    r.roofType = rt < 9 ? 3 : rt < 15 ? 0 : 2;  // 3 mono-pitch, 0 low gable, 2 flat with parapet
    r.wall = WALL[(h >>> 11) % 8];
    r.style = (h >>> 26) & 1;                 // 1 = ceramic siding (vertical joints)
    r.twoTone = ((h >>> 27) & 1) === 1;       // darker ground storey + string course
    r.side = h & 8 ? 1 : -1;                  // the house sits 0.9 m from this side line
    r.balcony = (h >>> 14) % 10 < 6;
    r.garage = (h >>> 18) % 10 < 7;           // built-in garage on the side away from the door
    r.tree = (h >>> 22) % 10 < 5;             // a small tree in the side planting strip
    r.vending = (h >>> 29) % 3 === 0;         // a vending machine at the front corner
    if ((h >>> 18) % 3 === 0) r.garden.push(GARDEN[(h2 >>> 3) % GARDEN.length]);
  } else if (zone === 1) {
    // Seoul villa: 4-5 storeys of brick over an open parking storey (pilotis), flat roof
    r.floors = 4 + (h & 1);
    r.w = 9.4; r.d = 12 + ((h >>> 4) % 7) * 0.5;
    r.roofType = 2;
    r.mansard = (h >>> 8) % 10 < 3;
    const mr = (h >>> 20) % 20;
    r.roofMem = mr < 12 ? 0x4f8a6e : mr < 15 ? 0x5f86a8 : 0x8c8f93;   // Seoul green / blue / grey roofs
    const ti = (h >>> 11) % 5;
    r.wall = TOWN[ti];
    r.style = ti < 2 ? 2 : 0;                 // 2 = brick
    r.tree = ((h >>> 14) % 10) < 3;
  } else if (zone === 2) {
    // shotengai massing: low shop buildings on the street rows, taller ones behind (height/width <= ~3.3,
    // no "pencil palisade" on the horizon); outer columns step down too so blocks read as stepped masses
    const row = slot >> 2, col = slot & 3, street = row === 0 || row === 3, edge = col === 0 || col === 3;
    r.floors = street ? 3 + (h % 4) - (edge && (h & 16) ? 1 : 0) : 5 + (h % 5);
    r.w = 8.6; r.d = 8.0 + ((h >>> 20) % 3) * 0.8; r.roofType = 2;
    r.wall = (h >>> 9) % 5 === 0 ? clampSV(blend(ACCENT[districtAccent(bx, bz)], CITY[(h >>> 11) % CITY.length], 0.75), 0.295, 0.845) : CITY[(h >>> 11) % CITY.length];
    r.crown = (h >>> 15) % 3;
  } else {
    // towers: height tapers from the centre, with ragged variety and the odd landmark
    const d = isqrt(bx * bx + bz * bz);
    const hubFar = d > 10;
    // a landmark cluster right around the plaza, tapering steadily outward
    const maxF = hubFar ? 30 : d <= 2 ? 58 : Math.max(18, 48 - 4 * d);
    const roll = h % 100;
    r.floors = Math.max(8, Math.floor(maxF * ((d <= 3 ? 60 : 35) + (h >>> 7) % (d <= 3 ? 41 : 66)) / 100));
    if (roll < 6) r.floors = Math.min(58, Math.floor(maxF * 1.25));   // 58 + a 4-floor crown stays under the packed v limit (63.75 floors)
    r.sig = d <= 1 && roll < 6;                  // the few signature towers (lantern crown + spire)
    // plots pair up: even slots build one wide tower over both plots, odd slots a 2-storey podium
    r.pod = (slot & 1) === 1;
    if (r.pod) { r.floors = 2; r.w = 9.6; r.d = 19; r.ox = 0; }
    else {
      r.w = 17.5; r.d = 15 + ((h >>> 5) % 5); r.ox = 5;
      if (!r.sig) r.floors = Math.min(r.floors, Math.floor(9 * r.w / FLOOR_H));   // height/width <= 9: no needles
    }
    r.roofType = 2; r.mat = 5;
    r.wall = GLASS[(h >>> 9) % GLASS.length];
    r.crown = (h >>> 15) % 5;
  }
  if (custom) {
    if (zone >= 2) r.top = true;
    r.shape = SHAPES.includes(custom.shape) ? custom.shape : 'cube';
    r.color = soften(parseColor(custom.color, ACCENT[h % ACCENT.length]));
    if (Array.isArray(custom.garden)) r.garden = custom.garden.filter((g) => GARDEN.includes(g)).slice(0, 4);
  }
  r.height = zone >= 2 || !r.shape || r.top ? r.floors * FLOOR_H : 0;
  return r;
}

// Cap a colour's HSV saturation and value (hue kept).
export function clampSV(c, smax, vmax) {
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = Math.min(mx, vmax), sat = mx > 0 ? Math.min((mx - mn) / mx, smax) : 0;
  const f = (x) => { const s0 = mx > mn ? (mx - x) / (mx - mn) : 0; return Math.round((v * (1 - sat * s0)) * 255); };
  return (f(r) << 16) | (f(g) << 8) | f(b);
}
// Custom colours are owner-chosen and often neon: cap saturation and brightness so they sit in the palette.
export const soften = (c) => clampSV(c, 0.32, 0.75);
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
      return finishLayout({ n, count, blocks, start, plots, maxD2 });
    }
    R = Math.ceil(R * 1.25);
  }
}

// Layout from the prebuilt block order (order.bin: int16 bx,bz pairs written by tools/build.mjs).
export function layoutFromOrder(n, o) {
  const count = o.length >> 1;
  const blocks = new Int32Array(count * 2), start = new Int32Array(count + 1), plots = new Uint8Array(count);
  let acc = 0, maxD2 = 0;
  for (let i = 0; i < count; i++) {
    const bx = o[2 * i], bz = o[2 * i + 1];
    blocks[2 * i] = bx; blocks[2 * i + 1] = bz; plots[i] = plotsIn(bx, bz);
    start[i] = acc; acc += plots[i]; maxD2 = bx * bx + bz * bz;
  }
  start[count] = acc;
  return finishLayout({ n, count, blocks, start, plots, maxD2 });
}

// Rebuild derived fields (also used after posting a layout between threads).
export function finishLayout(L) {
  const rB = Math.max(3, Math.ceil(Math.sqrt(L.maxD2)));
  L.rB = rB;
  L.townD2 = (rB + 1) * (rB + 1);
  L.seaBx = Math.max(rB + 7, 46);
  L.portX = 32 * PITCH;
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

// Per-block data for the ground shader (so it does not re-derive the rules per pixel).
// RGBA8, (2*ext+1)^2 texels centred on the plaza, ext = rB + 10:
//   R kind · G zone | inhabited<<2 | avenueX<<3 | avenueZ<<4 · B roof colours c0 | c1<<3 · A c2
export function buildGround(L) {
  const ext = L.rB + 10, S = 2 * ext + 1;
  const d = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const bx = i - ext, bz = j - ext, o = (j * S + i) * 4;
    const k = kindAt(L, bx, bz);
    const homes = k === K.HOMES;
    const base = hash3(fdiv(bx, 5), fdiv(bz, 5), 101);
    d[o] = k;
    d[o + 1] = (homes ? zoneLevel(bx, bz) : 0) | (homes && bx * bx + bz * bz <= L.maxD2 ? 4 : 0) | (avenueX(bx) ? 8 : 0) | (avenueZ(bz) ? 16 : 0);
    d[o + 2] = (base % 8) | (((base >>> 4) % 8) << 3);
    d[o + 3] = (base >>> 8) % 8;
  }
  return { ext, size: S, data: d };
}

// Footprint of a regular home on its plot (matches mesher.home), world metres.
export function homeRect(f, r) {
  if (r.zone >= 2) return [f.x + r.ox - r.w / 2, f.z - r.d / 2, f.x + r.ox + r.w / 2, f.z + r.d / 2];
  const front = f.face < 0 ? f.z - f.d / 2 : f.z + f.d / 2, setback = r.zone === 0 ? 0.8 : 1.5;
  const z0 = f.face < 0 ? front + setback : front - setback - r.d;
  if (r.zone === 0) {                         // hugs one side line (mirrored in the ground shader)
    const x0 = r.side > 0 ? f.x + 5 - 0.4 - r.w : f.x - 5 + 0.4;
    return [x0, z0, x0 + r.w, z0 + r.d];
  }
  return [f.x - r.w / 2, z0, f.x + r.w / 2, z0 + r.d];
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

// ---- streaming decisions (pure, with hysteresis so nothing ping-pongs at a boundary; tested in selftest) ----
export const chunkLod = (d, r0, prevLod) => (d < r0 * (prevLod === 0 ? 1.1 : 0.9) ? 0 : 1);
export const chunkLite = (low, lod, d, r0, prevLite) => low || (lod === 0 && d >= r0 * (prevLite ? 0.45 : 0.55));
export const skyLite = (low, d, prevLite) => low || d > (prevLite ? 1350 : 1650);
export const lowNext = (prev, s) => (prev === null || (prev && s > 0.74) || (!prev && s < 0.66) ? s < 0.7 : prev);

// ---- follower names (build time) ----
// NFC; no control or format characters (bidi overrides, zero-width spaces, line separators) except a ZWJ
// between two pictographs (emoji sequences) and tag characters after a black flag (England, Scotland, Wales);
// runs of combining marks capped at 4 (no "zalgo" towers; Hebrew and Tibetan names keep theirs); truncated to
// 40 grapheme clusters so no emoji is split. A name with nothing visible left becomes ''.
const SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export function cleanName(s) {
  let t = String(s).normalize('NFC')
    .replace(/(?<=\p{Extended_Pictographic}\p{M}*)‍(?=\p{Extended_Pictographic})/gu, '\u0000')   // protect emoji ZWJ
    .replace(/(?<=\u{1F3F4}[\u{E0020}-\u{E007F}]*)([\u{E0020}-\u{E007F}])/gu, '\u0001$1')            // protect flag tags
    .replace(/\u0001([\u{E0020}-\u{E007F}])|[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (m, tag) => (tag || (m === '\u0000' ? m : '')))
    .replace(/\u0000/g, '‍')
    .replace(/(\p{M}{4})\p{M}+/gu, '$1')
    .trim();
  if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(t)) return '';
  const g = SEG ? Array.from(SEG.segment(t), (x) => x.segment) : Array.from(t);
  return g.slice(0, 40).join('');
}
