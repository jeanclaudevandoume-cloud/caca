// Follower Town — the cell and zone rules: WHERE things are (river, bay, avenues, roji, civic cells, zones, plot
// frames) and the streaming decisions. Home recipes and palettes are in recipe.js, the follower -> plot layout
// and the ground texture in layout.js, name handling in names.js. Shared verbatim by the browser, the mesh worker
// and the Node build tool.
//
// Determinism: only integer math through hash3 decides anything. No Math.random, no time,
// no GPU. Math.sqrt is only used on exact integers (IEEE sqrt is correctly rounded, so
// floor(sqrt(int)) is identical everywhere).
//
// The ground shader (shaders.js, groundBase) mirrors hash3, riverZ, cellKind, zoneLevel,
// plot layout and roofIdx by hand. Change one, change the other.

export const PITCH = 48;        // block (40 m) + road
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
// Arterials (round P): one per 10 blocks but jittered +-2 (the central ones stay on the plaza), so the plan
// is not graph paper. avenueX(bx): is the north-south avenue of its 10-block band at bx?
const aveOff = (k, salt) => (k === 0 ? 0 : (hash3(k, salt, 61) % 5) - 2);
export const avenueX = (bx) => { const k = Math.round(bx / 10); return bx === k * 10 + aveOff(k, 1); };
// Shotengai (round M): the north-south lane on the +x side of block bx is a shop street every 5 blocks.
// The corner plots on both sides of it become shop houses facing the lane (see recipe / mesher shopHouse).
export const shopLaneX = (bx) => mod(bx + 4, 5) === 0 && !avenueX(bx) && !avenueX(bx + 1);
export const avenueZ = (bz) => { const k = Math.round(bz / 10); return bz === k * 10 + aveOff(k, 2); };   // east-west
// Roji (round P): a narrow paved lane through the middle of about one residential block in three
export const rojiAt = (bx, bz) => hash3(bx, bz, 23) % 3 === 0;

function lakeAt(bx, bz) {
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
// Civic cells (round M): one per 6x6-block neighbourhood, never on its border, so two are never adjacent.
function isCivic(bx, bz) {
  const nx = fdiv(bx, 6), nz = fdiv(bz, 6), h = hash3(nx, nz, 3);
  return bx === nx * 6 + 1 + (h % 4) && bz === nz * 6 + 1 + ((h >>> 4) % 4);
}
// 0 park, 1 shrine, 2 school
export const civicType = (bx, bz) => { const t = hash3(bx, bz, 33) % 10; return t < 4 ? 1 : t < 7 ? 2 : 0; };
export function cellKind(bx, bz) {
  if (bx === 0 && bz === 0) return K.PLAZA;
  if (bayAt(bx, bz)) return K.SEA;
  if (portLane(bx, bz) >= 0) return K.PORT;
  if (isRiver(bx, bz)) return K.RIVER;
  if (avenueX(bx) || avenueZ(bz)) return K.AVENUE;
  const d2 = bx * bx + bz * bz;
  if (d2 > 16 && isCivic(bx, bz)) return K.PARK;   // one civic cell per 6x6 neighbourhood (park, shrine or school)
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

// Lane-split blocks (round Q): a residential block with a roji is cut into 2 rows of 5 plots (8 x 18 m) that
// FRONT the 4 m lane through its middle, instead of 2 rows of 4 backing onto it. The ground shader mirrors this.
export const laneBlock = (bx, bz, zone) => zone <= 1 && rojiAt(bx, bz);
export function plotsIn(bx, bz) {
  if (cellKind(bx, bz) !== K.HOMES) return 0;
  const z = zoneLevel(bx, bz);
  return z === 2 ? 16 : laneBlock(bx, bz, z) ? 10 : 8;
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
  if (laneBlock(bx, bz, zone)) {
    const col = slot % 5, row = slot < 5 ? 0 : 1;
    out.x = x0 - 16 + col * 8; out.w = 8;
    out.z = z0 + (row ? 11 : -11); out.d = 18; out.face = row ? -1 : 1;   // fronts on the lane at z0 -+ 2
    return out;
  }
  const col = slot & 3, row = slot >> 2;
  out.x = x0 - 15 + col * 10;
  out.w = 10;
  if (zone === 2) { out.z = z0 - 15 + row * 10; out.d = 10; out.face = row < 2 ? -1 : 1; }
  else { out.z = z0 - 10 + row * 20; out.d = 20; out.face = row === 0 ? -1 : 1; }
  return out;
}

// Which plot of a block is at a local position (lx, lz relative to block centre)?
export function slotAt(zone, lx, lz, lane = false) {
  if (lx < -20 || lx >= 20 || lz < -20 || lz >= 20) return -1;
  if (lane) { if (Math.abs(lz) < 2) return -1; return (lz < 0 ? 0 : 5) + Math.min(4, Math.floor((lx + 20) / 8)); }
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

// Footprint of a regular home on its plot (matches mesher.home), world metres.
export function homeRect(f, r) {
  if (r.zone >= 2 || r.shop) return [f.x + r.ox - r.w / 2, f.z - r.d / 2, f.x + r.ox + r.w / 2, f.z + r.d / 2];
  const front = f.face < 0 ? f.z - f.d / 2 : f.z + f.d / 2, setback = r.zone === 0 ? 0.8 : 1.5;
  const z0 = f.face < 0 ? front + setback : front - setback - r.d;
  if (r.zone === 0) {                         // hugs one side line (mirrored in the ground shader)
    const x0 = r.side > 0 ? f.x + f.w / 2 - 0.4 - r.w : f.x - f.w / 2 + 0.4;
    return [x0, z0, x0 + r.w, z0 + r.d];
  }
  return [f.x - r.w / 2, z0, f.x + r.w / 2, z0 + r.d];
}

// ---- streaming decisions (pure, with hysteresis so nothing ping-pongs at a boundary; tested in selftest) ----
export const chunkLod = (d, r0, prevLod) => (d < r0 * (prevLod === 0 ? 1.1 : 0.9) ? 0 : 1);
export const chunkLite = (low, lod, d, r0, prevLite) => low || (lod === 0 && d >= r0 * (prevLite ? 0.45 : 0.55));
export const skyLite = (low, d, prevLite) => low || d > (prevLite ? 1350 : 1650);
export const lowNext = (prev, s) => (prev === null || (prev && s > 0.74) || (!prev && s < 0.66) ? s < 0.7 : prev);
