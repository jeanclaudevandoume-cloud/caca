// Chunk, mid-band and skyline meshes (the worker's entry points). The builder and palettes live in mb.js,
// props in props.js, homes in homes.js (round Q split: every file < 500 lines).
// MB and M are re-exported for render.js and the tools.
import {
  PITCH, FLOOR_H, K, hash3, fdiv, kindAt, cellKind, zoneLevel, plotsIn, plotFrame, recipe, occupied, ROOF,
  civicType, rojiAt, avenueX, avenueZ, portLane, bayHalf, regionOf, regionKey, lineIndex, CHUNK, REGION,
} from './town.js';
import { MB as MB_, M as M_, rcos, rsin, TALL, shade, ctx, CARS, BOX_COLS } from './mb.js';
import { tree, wires, lamp, gardenItem } from './props.js';
import { shrine, school, home, towerMass } from './homes.js';

export const MB = MB_;
export const M = M_;

// ---------- chunk ----------
export function chunkOrigin(cx, cz) {
  return [(cx * CHUNK + 1.5) * PITCH, (cz * CHUNK + 1.5) * PITCH];
}

export function buildChunk(L, cx, cz, lod, customs, lite = false) {
  ctx.LITE = lite;
  const [ox, oz] = chunkOrigin(cx, cz);
  const mb = new MB_(ox, oz, lod ? 2048 : 8192);
  const f = F;
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
    const bx = cx * CHUNK + i, bz = cz * CHUNK + j;
    const X = bx * PITCH, Z = bz * PITCH;
    const k = kindAt(L, bx, bz);
    const hb = hash3(bx, bz, 51);
    switch (k) {
      case K.HOMES: {
        const zone = zoneLevel(bx, bz), np = plotsIn(bx, bz), occ = occupied(L, bx, bz);
        const cus = customs && customs.get(regionKey(regionOf(bx), regionOf(bz)));
        for (let s = 0; s < occ; s++) {
          plotFrame(bx, bz, s, zone, f);
          const spec = cus ? cus[lineIndex(bx, bz, s)] : null;
          home(mb, bx, bz, f, recipe(bx, bz, s, zone, spec), lod);
        }
        if (!lod && !ctx.LITE && zone === 2) {
          // overhead wires spanning the street in front of mid-rise blocks (a Tokyo staple)
          // only where the block across the street is also mid-rise, so wires never end in mid-air
          const midN = cellKind(bx, bz - 1) === K.HOMES && zoneLevel(bx, bz - 1) === 2;
          const midW = cellKind(bx - 1, bz) === K.HOMES && zoneLevel(bx - 1, bz) === 2;
          for (const wx of [-12, 12]) {
            mb.cast = false;
            if (midN) mb.box(X + wx - 0.03, 7.5, Z - 28, X + wx + 0.03, 7.56, Z - 20, 0x1a1a1a, 0x1a1a1a, M_.PLAIN, 0);
            if (midW) mb.box(X - 28, 7.2, Z + wx - 0.03, X - 20, 7.26, Z + wx + 0.03, 0x1a1a1a, 0x1a1a1a, M_.PLAIN, 0);
            mb.cast = true;
          }
        }
        if (!lod && !ctx.LITE && zone <= 1 && rojiAt(bx, bz)) { lamp(mb, X - 11, Z + 1.9, hb & 255); lamp(mb, X + 11, Z - 1.9, hb & 255); }   // roji lamps
        if (!lod && !ctx.LITE && zone <= 1) {
          for (let s = 0; s < occ; s++) {
            const hc = hash3(bx, bz, s + 300);
            if (hc % 3) continue;
            plotFrame(bx, bz, s, zone, f);
            const fs = f.face < 0 ? -1 : 1, cz = f.z + fs * (f.d / 2 + 1.3), cx = f.x + ((hc >>> 4) % 5 - 2) * 0.6;
            const cc = CARS[(hc >>> 8) % CARS.length];
            mb.cbox(cx, 0.25, cz, 4.2, 0.75, 1.8, cc, M_.METAL, hc & 255);
            mb.cbox(cx - 0.3, 1.0, cz, 2.3, 0.6, 1.6, 0x2b3240, M_.GLASS, hc & 255);
          }
        }
        if (!lod) {
          if (zone <= 1) {
            // concrete utility poles on the north kerb (every 24 m) with three sagging wires to the next pole
            const pz = Z - 19.6;
            const pole = (px, pzz) => {
              mb.cyl(px, 0, pzz, 0.17, 9.0, 0.12, ctx.LITE ? 3 : 6, 0xa7a49c, M_.PLAIN, hb & 255, false);   // lite: 3 sides (6 tris)
              if (!ctx.LITE) { mb.cbox(px, 8.2, pzz, 1.4, 0.12, 0.12, 0x8a877f, M_.PLAIN, 0); mb.cbox(px + 0.3, 6.6, pzz, 0.35, 0.5, 0.35, 0x7f8a8a, M_.METAL, 0); }
            };
            for (const px of [X - 18, X + 6]) { pole(px, pz); wires(mb, px, X + (px === X - 18 ? 6 : 30), pz, ctx.LITE ? 1 : 3, false); }
            // and along the west kerb, so north-south lanes have them too
            const wx = X - 19.6;
            for (const pzz of [Z - 6, Z + 18]) { pole(wx, pzz); wires(mb, pzz, Z + (pzz === Z - 6 ? 18 : 42), wx, ctx.LITE ? 1 : 3, true); }
            if (!ctx.LITE) lamp(mb, X - 19.3, Z + 19.3, hb & 255);
          } else {
            lamp(mb, X - 19.3, Z - 19.3, hb & 255);
            lamp(mb, X + 19.3, Z + 19.3, hb & 255);
          }
        }
        break;
      }
      case K.PARK: {
        const ct = civicType(bx, bz);
        if (ct === 1) { shrine(mb, X, Z, hb, lod); break; }
        if (ct === 2) { school(mb, X, Z, hb, lod); break; }
        const n = lod ? 7 : 14;
        for (let t = 0; t < n; t++) {
          const h = hash3(bx, bz, 200 + t);
          let x = (h % 36) - 18, z = ((h >>> 8) % 36) - 18;
          if (Math.abs(x) < 3) x += x < 0 ? -4 : 4;
          if (Math.abs(z) < 3) z += z < 0 ? -4 : 4;
          tree(mb, X + x, Z + z, 0.9 + ((h >>> 16) % 5) * 0.12, h >>> 3, lod);
        }
        if (!lod) {
          gardenItem(mb, 'fountain', X, Z, hb);
          gardenItem(mb, 'bench', X + 5, Z - 2, hb);
          gardenItem(mb, 'bench', X - 5, Z + 2, hb);
          if (hb & 1) { mb.cbox(X + 10, 0, Z + 10, 6, 0.25, 6, 0xd8cbb0, M_.PLAIN, 1); mb.cyl(X + 10, 0.25, Z + 10, 0.2, 2.8, 0.2, 4, 0xffffff); mb.pyramid(X + 10, 2.8, Z + 10, 6.6, 6.6, 2, 0xc2304f, 1); }
        }
        break;
      }
      case K.AVENUE: {
        const ax = avenueX(bx), az = avenueZ(bz);
        if (ax && az) { if (!lod) { lamp(mb, X - 19, Z - 19, 1); lamp(mb, X + 19, Z + 19, 1); } break; }
        const step = lod ? 13.3 : 6.66;
        for (let t = -20 + step / 2; t < 20; t += step) {
          const h = hash3(bx, bz, 300 + Math.round(t));
          const hz = ((h >>> 3) & ~7) | 2;                 // zelkova: one round leafy species, no cones or blossom
          if (ax) { tree(mb, X, Z + t, 0.8, hz, lod); }
          else { tree(mb, X + t, Z, 0.8, hz, lod); }
        }
        if (!lod) {
          // traffic: taxis, cars and the odd bus on the carriageways (LITE too, ~10 tris each)
          for (let i = 0; i < 4; i++) {
            const hc = hash3(bx, bz, 700 + i);
            if (hc % 3 === 0) continue;
            const lane = (i & 1 ? 1 : -1) * (6 + ((hc >>> 4) % 3) * 3.4), along = -16 + i * 10 + ((hc >>> 8) % 5);
            const bus = (hc >>> 12) % 9 === 0, len = bus ? 10 : 4.2, wid = bus ? 2.5 : 1.8, hgt = bus ? 3.0 : 1.4;
            const col = bus ? 0x2f8f6f : (hc >>> 14) % 4 === 0 ? 0xf2c230 : CARS[(hc >>> 16) % CARS.length];
            if (ax) mb.cbox(X + lane, 0.2, Z + along, wid, hgt, len, col, M_.METAL, hc & 255);
            else mb.cbox(X + along, 0.2, Z + lane, len, hgt, wid, col, M_.METAL, hc & 255);
          }
          if (ax) { lamp(mb, X - 4.2, Z, 2); lamp(mb, X + 4.2, Z - 10, 2); }
          else { lamp(mb, X, Z - 4.2, 2); lamp(mb, X - 10, Z + 4.2, 2); }
        }
        break;
      }
      case K.RIVER: {
        if (avenueX(bx) || (bx === 0)) bridge(mb, X, Z, lod);
        break;
      }
      case K.PLAZA: plaza(mb, X, Z, lod); break;
      case K.COUNTRY: {
        const hw = hash3(fdiv(bx, 3), fdiv(bz, 3), 41) % 5;
        if (hw < 2) {
          const n = lod ? 6 : 16;
          for (let t = 0; t < n; t++) {
            const h = hash3(bx, bz, 500 + t);
            tree(mb, X + (h % 46) - 23, Z + ((h >>> 8) % 46) - 23, 1.0 + ((h >>> 16) % 6) * 0.15, (h >>> 2) | 1, lod);
          }
        } else if (hb % 9 === 0) {
          mb.cbox(X + 8, 0, Z - 6, 7, 3.5, 10, 0xb3402f, M_.PLAIN, hb & 255);
          mb.gable(X + 4.5, Z - 11, X + 11.5, Z - 1, 3.5, 2.5, 0x5a5f6a, 0xb3402f, hb & 255, false);
          if (!lod) mb.cyl(X - 2, 0, Z - 8, 1.8, 9, 1.8, 8, 0xd9d6cf, M_.METAL, 0, true, 0x8d9199);
        }
        break;
      }
      case K.HIGHWAY: {
        if (!lod && bx === 0) { lamp(mb, X - 7, Z, 3); } else if (!lod) lamp(mb, X, Z - 7, 3);
        break;
      }
      case K.PORT: port(mb, L, bx, bz, X, Z, lod); break;
      case K.SEA: break;
    }
  }
  // ships moored at the port (belong to whichever chunk holds their centre)
  const x0 = cx * CHUNK * PITCH - 24, x1 = x0 + CHUNK * PITCH, z0 = cz * CHUNK * PITCH - 24, z1 = z0 + CHUNK * PITCH;
  for (const [sx, sz, h] of SHIPS) if (sx >= x0 && sx < x1 && sz >= z0 && sz < z1) ship(mb, sx, sz, h, lod);
  return mb.finish();
}

function bridge(mb, X, Z, lod) {
  const c = 0xb9b4aa;
  mb.box(X - 14, 2.2, Z - 24, X + 14, 3.0, Z + 24, 0x8e8a82, 0x4a4e56, M_.PLAIN, 3);          // deck
  for (const pz of [-12, 12]) mb.box(X - 12, -1, Z + pz - 1.2, X + 12, 2.2, Z + pz + 1.2, c, -1, M_.PLAIN, 3);   // piers
  if (lod) return;
  mb.cast = false;
  mb.box(X - 14, 3.0, Z - 24, X - 11, 3.15, Z + 24, c, c, M_.PLAIN, 3);                       // sidewalks
  mb.box(X + 11, 3.0, Z - 24, X + 14, 3.15, Z + 24, c, c, M_.PLAIN, 3);
  mb.box(X - 14, 3.15, Z - 24, X - 13.85, 4.25, Z + 24, 0x8e8a82, 0xd9d3c7, M_.PLAIN, 3);    // 1.1 m railings
  mb.box(X + 13.85, 3.15, Z - 24, X + 14, 4.25, Z + 24, 0x8e8a82, 0xd9d3c7, M_.PLAIN, 3);
  for (let dz = -21; dz < 24; dz += 6) {                                                   // lane dashes
    mb.q(X - 0.08, 3.01, dz + Z + 3, X + 0.08, 3.01, dz + Z + 3, X + 0.08, 3.01, dz + Z, X - 0.08, 3.01, dz + Z, 0, 1, 0, 0, 0, 0, 0, M_.PLAIN, 0xe8dca0, 3);
  }
  for (const lz of [-18, -6, 6, 18]) for (const lx of [-13.3, 13.3]) {                     // lamps every 12 m
    mb.cbox(X + lx, 3.15, Z + lz, 0.2, 5.0, 0.2, 0x3a3f4a, M_.METAL, 3);
    mb.cbox(X + lx - Math.sign(lx) * 0.5, 8.0, Z + lz, 1.0, 0.25, 0.4, 0xfff1c1, M_.LIGHT, 3);
  }
  mb.cast = true;
}

const F = {};

function plaza(mb, X, Z, lod) {
  // the central beacon: a slender 220 m spire
  const a = 7;
  mb.flag = TALL;
  mb.box(X - 7, 0, Z - 7, X + 7, 12, Z + 7, 0xf2efe8, 0xcfd3da, M_.WIN, a);
  mb.box(X - 4.5, 12, Z - 4.5, X + 4.5, 90, Z + 4.5, 0xe6e9ee, -1, M_.GLASS, a, 12 / FLOOR_H);
  mb.box(X - 6, 90, Z - 6, X + 6, 98, Z + 6, 0x2a9d8f, 0xd0d4dc, M_.GLASS, a, 90 / FLOOR_H);
  mb.cyl(X, 98, Z, 3.6, 180, 1.4, 8, 0xf2efe8, M_.METAL, a, false);
  mb.cyl(X, 150, Z, 5.5, 156, 5.5, 12, 0x2a9d8f, M_.GLASS, a);
  mb.cyl(X, 180, Z, 1.4, 216, 0.3, 6, 0xd0d4dc, M_.METAL, a, false);
  mb.ell(X, 218, Z, 2.6, 2.6, 2.6, 8, 3, 0xffe28a, M_.LIGHT, a);
  mb.cyl(X, 90.0, Z, 4.6, 91.2, 4.6, 12, 0xffe28a, M_.LIGHT, a, false);
  mb.flag = 0;
  if (!lod) {
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2 + 0.39;
      tree(mb, X + rcos(t) * 15, Z + rsin(t) * 15, 0.9, i * 7 + 13, 0);
    }
    mb.cyl(X + 13, 0, Z - 13, 3, 0.7, 3, 12, 0xe8e4dc, M_.PLAIN, 0, true, 0x6fd3f7);
  }
}

function port(mb, L, bx, bz, X, Z, lod) {
  const lane = portLane(bx, bz);     // 0 quay with cranes (water to +z), 1 containers, 2 warehouses
  const hb = hash3(bx, bz, 81);
  if (lane === 2) {
    const c = (hb & 1) ? 0xe6e1d6 : 0xc9d2da;
    mb.box(X - 18, 0, Z - 16, X + 18, 9, Z + 16, c, -1, M_.PLAIN, 0);
    for (let i = 0; i < 6; i++) {                     // sawtooth roof
      const z0 = Z - 16 + i * (32 / 6), z1 = z0 + 32 / 6;
      mb.fq(X + 18, 9, z0, X - 18, 9, z0, X - 18, 12, z1, X + 18, 12, z1, M_.PLAIN, 0x8d9aa8, 0);
      mb.q(X - 18, 9, z1, X + 18, 9, z1, X + 18, 12, z1, X - 18, 12, z1, 0, 0, 1, 0, 0, 0, 0, M_.GLASS, 0x9fc4dd, 0);
      mb.ft(X - 18, 9, z0, X - 18, 9, z1, X - 18, 12, z1, M_.PLAIN, c, 0);
      mb.ft(X + 18, 9, z1, X + 18, 9, z0, X + 18, 12, z1, M_.PLAIN, c, 0);
    }
    if (!lod) for (let i = 0; i < 4; i++) mb.cbox(X - 12 + i * 8, 0, Z + 19, 6, 2.6, 2.4, BOX_COLS[(hb >>> i) & 7], M_.METAL, 0);
  } else if (lane === 1) {
    const step = lod ? 2 : 1;
    for (let r = 0; r < 6; r += step) for (let c = 0; c < 3; c++) {
      const h = hash3(bx * 7 + r, bz * 5 + c, 82);
      const n = 1 + (h % 4);
      const cx = X - 14 + c * 14, cz = Z - 17 + r * 6.8;
      for (let s = 0; s < n; s++) {
        const col = BOX_COLS[(h >>> (s * 3 + 4)) & 7];
        mb.box(cx - 6, s * 2.6, cz - 1.25, cx + 6, s * 2.6 + 2.6, cz + 1.25 + (step - 1) * 6.8, col, s === n - 1 ? shade(col, 0.9) : -1, M_.METAL, 0);
      }
    }
  } else {
    // quay: two gantry cranes per block, booms reaching out over the moored ships
    for (const ox of [-10, 10]) {
      const cx = X + ox, c = 0xe2492e;
      mb.box(cx - 6, 0, Z + 6, cx - 4.8, 30, Z + 7.2, c, c, M_.METAL, 0);
      mb.box(cx + 4.8, 0, Z + 6, cx + 6, 30, Z + 7.2, c, c, M_.METAL, 0);
      mb.box(cx - 6, 0, Z + 20.8, cx - 4.8, 30, Z + 22, c, c, M_.METAL, 0);
      mb.box(cx + 4.8, 0, Z + 20.8, cx + 6, 30, Z + 22, c, c, M_.METAL, 0);
      mb.box(cx - 6, 30, Z + 6, cx + 6, 32, Z + 22, c, c, M_.METAL, 0);
      mb.box(cx - 1.2, 32, Z - 8, cx + 1.2, 34.5, Z + 62, 0xf0f0ec, 0xf0f0ec, M_.METAL, 0);
      mb.box(cx - 2, 34.5, Z + 11, cx + 2, 38, Z + 17, 0xf0f0ec, 0xd0d4dc, M_.WIN, 0);
      if (!lod) mb.cbox(cx, 38, Z + 14, 0.6, 0.6, 0.6, 0xff4040, M_.LIGHT, 0);
    }
  }
}

// Container ship lying along x (bow toward +x).
function ship(mb, x, z, h, lod) {
  const Ln = 140 + (h % 5) * 12, W = 22;
  const hull = [0x1f3b63, 0x8e2b2b, 0x23614f, 0x2b2f3a][h & 3], deck = 0x9b4535;
  const x0 = x - Ln / 2, x1 = x + Ln / 2, z0 = z - W / 2, z1 = z + W / 2, xb = x1 - 16;
  mb.box(x0, -2, z0, xb, 7, z1, hull, deck, M_.PLAIN, 0);
  mb.fq(xb, -2, z1, x1, -2, z, x1, 7, z, xb, 7, z1, M_.PLAIN, hull, 0);
  mb.fq(x1, -2, z, xb, -2, z0, xb, 7, z0, x1, 7, z, M_.PLAIN, hull, 0);
  mb.ft(xb, 7, z1, x1, 7, z, xb, 7, z0, M_.PLAIN, deck, 0);
  mb.box(x0 + 2, 7, z0 + 1, x0 + 14, 22, z1 - 1, 0xf2f2ee, 0xd0d4dc, M_.WIN, 0);
  mb.box(x0 + 6, 22, z - 2, x0 + 10, 28, z + 2, hull, 0x2b2f3a, M_.PLAIN, 0);
  const rows = lod ? 4 : 8;
  for (let r = 0; r < rows; r++) {
    const xx = x0 + 18 + (r * (Ln - 40)) / rows, len = (Ln - 40) / rows - 0.6;
    const n = 1 + (hash3(h, r, 3) % 3);
    for (let s = 0; s < n; s++) {
      const col = BOX_COLS[(hash3(h, r, s) >>> 3) & 7];
      mb.box(xx, 7 + s * 2.6, z0 + 1.5, xx + len, 9.6 + s * 2.6, z1 - 1.5, col, s === n - 1 ? shade(col, 0.9) : -1, M_.METAL, 0);
    }
  }
}

// Ships: moored along the quay, plus a few at anchor out in the channel.
export function ships() {
  const out = [];
  for (let bx = 26; bx <= 38; bx += 4) out.push([bx * PITCH + 24, (1 - bayHalf(bx)) * PITCH + 24 + 15, hash3(bx, 7, 71)]);
  for (let i = 0; i < 4; i++) out.push([(48 + i * 14) * PITCH, (2 + (i & 1 ? 7 : -6)) * PITCH, hash3(i, 9, 72)]);
  return out;
}
const SHIPS = ships();

// ---------- skyline: one mesh per data region, tall buildings as boxes ----------
// Skyline tile = 2x2 data regions (32x32 blocks, ~1.5 km), stored at 1/32 m so it fits int16.
export const SKY = 2 * REGION;
// Mid-band tiles (round M): MID x MID blocks of low massing for the ring just beyond the house ring, so
// rooftops run on to the towers instead of a flat painted band. Per row of homes two masses (left and right
// heights by hash) with windows from the facade shader and the row's roof colour; ~20 tris a block.
// Not TALL: GEO_VS (skyline mode) grows them in exactly as the real homes shrink away.
export const MID = 16;
export function buildMid(L, mx, mz) {
  const ox = (mx * MID + MID / 2 - 0.5) * PITCH, oz = (mz * MID + MID / 2 - 0.5) * PITCH;
  const mb = new MB_(ox, oz, 4096);
  mb.cast = false;
  for (let j = 0; j < MID; j++) for (let i = 0; i < MID; i++) {
    const bx = mx * MID + i, bz = mz * MID + j;
    if (cellKind(bx, bz) !== K.HOMES) continue;
    const zone = zoneLevel(bx, bz);
    if (zone >= 2) continue;                                     // mid-rise and towers come from the skyline
    const occ = occupied(L, bx, bz);
    if (!occ) continue;
    const X = bx * PITCH, Z = bz * PITCH;
    for (let row = 0; row < 2; row++) {
      // one mass per row of homes, 30 m wide (packed window u stays < 32 m): 10 tris
      const slot = row * 4;
      if (slot >= occ) continue;
      const r = recipe(bx, bz, slot, zone, null), h = hash3(bx, bz, 91 + slot);
      const near = zoneLevel(bx + 1, bz) >= 2 || zoneLevel(bx - 1, bz) >= 2 || zoneLevel(bx, bz + 1) >= 2 || zoneLevel(bx, bz - 1) >= 2;
      const top = (zone === 1 ? 12.5 : 6.6) + (near ? 6.4 : 0) + (h % 6) * 0.7;   // blocks next to mid-rise step up: the skyline ramps
      const x0 = X - 15, x1 = X + 15;
      const z0 = row ? Z + 2 : Z - 18, z1 = row ? Z + 18 : Z - 2;
      const roof = zone === 1 ? (r.roofMem || 0x4f8a6e) : ROOF[r.roof];
      mb.box(x0, 0, z0, x1, top, z1, r.wall, -1, M_.WIN, (h & 0xfc) | 1, 0, row ? 2 : 1);
      // the roof: plain, alpha 250 (jutaku: per-house colours and a fake ridge on the high preset) or 246 (villa
      // membranes), see shaders.js. Plain, not M.ROOF: the roof-tile hash on every far pixel cost the phone geo pass.
      mb.q(x0, top, z1, x1, top, z1, x1, top, z0, x0, top, z0, 0, 1, 0, 0, 0, 0, 0, M_.PLAIN, roof, zone === 1 ? 246 : 250);   // the faces across the 4 m lane are never seen from the mid band
    }
  }
  return mb.finish();
}

export function buildSkyline(L, sx, sz, lite = false) {
  const ox = (sx * SKY + SKY / 2 - 0.5) * PITCH, oz = (sz * SKY + SKY / 2 - 0.5) * PITCH;
  const mb = new MB_(ox, oz, 4096);
  mb.sc = 32;
  const f = F;
  mb.flag = TALL;
  for (let j = 0; j < SKY; j++) for (let i = 0; i < SKY; i++) {
    const bx = sx * SKY + i, bz = sz * SKY + j;
    if (bx === 0 && bz === 0) {
      const X = 0, Z = 0;
      mb.box(X - 7, 0, Z - 7, X + 7, 12, Z + 7, 0xf2efe8, 0xcfd3da, M_.WIN, 7);
      mb.box(X - 4.5, 12, Z - 4.5, X + 4.5, 98, Z + 4.5, 0xe6e9ee, -1, M_.GLASS, 7, 12 / FLOOR_H);
      mb.cyl(X, 98, Z, 3.6, 216, 0.3, 6, 0xf2efe8, M_.METAL, 7, false);
      mb.ell(X, 218, Z, 2.6, 2.6, 2.6, 6, 2, 0xffe28a, M_.LIGHT, 7);
      continue;
    }
    if (cellKind(bx, bz) !== K.HOMES) continue;
    const zone = zoneLevel(bx, bz);
    if (zone < 2) continue;
    const occ = occupied(L, bx, bz);
    for (let s = 0; s < occ; s++) {
      const r = recipe(bx, bz, s, zone, null);
      if (r.height < (lite ? 16 : 6) * FLOOR_H) continue;      // lite (low quality): only the real skyline
      plotFrame(bx, bz, s, zone, f);
      f.x += r.ox;                                                  // paired-plot towers
      const top = r.floors * FLOOR_H;
      if (zone === 3 && !r.sig) { towerMass(mb, f, r, bx, bz, s, lite, false); continue; }
      mb.box(f.x - r.w / 2, 0, f.z - r.d / 2, f.x + r.w / 2, top, f.z + r.d / 2, r.wall, 0x8d9199, r.mat, (r.hash & 0xfc) | (zone === 3 ? 0 : 3));
      if (lite) continue;                                          // lite: plain boxes, no crowns
      const sig = zone === 3 && r.sig;
      if (r.crown === 1 && !sig) mb.box(f.x - r.w / 2 + 1.4, top, f.z - r.d / 2 + 2, f.x + r.w / 2 - 1.4, top + 3 * FLOOR_H, f.z + r.d / 2 - 2, r.wall, 0x8d9199, r.mat, (r.hash & 0xfc) | (zone === 3 ? 0 : 3), r.floors);
      if (top >= 30 * FLOOR_H && !sig) mb.cbox(f.x - r.w / 2 + 0.4, top, f.z - r.d / 2 + 0.4, 0.9, 0.9, 0.9, 0xff3030, M_.LIGHT, r.hash & 255);
      if (sig) {
        mb.box(f.x - r.w / 2 + 1, top, f.z - r.d / 2 + 2, f.x + r.w / 2 - 1, top + 3 * FLOOR_H, f.z + r.d / 2 - 2, r.wall, 0x8d9199, r.mat, (r.hash & 0xfc) | (zone === 3 ? 0 : 3), r.floors);
        mb.box(f.x - r.w / 2 + 2.2, top + 3 * FLOOR_H, f.z - r.d / 2 + 4.5, f.x + r.w / 2 - 2.2, top + 6 * FLOOR_H, f.z + r.d / 2 - 4.5, 0xffc878, 0xd0d4dc, M_.LIGHT, r.hash & 255);
        mb.cyl(f.x, top + 6 * FLOOR_H, f.z, 1.2, top + 6 * FLOOR_H + 22, 0.15, 4, 0xe8ebf0, M_.METAL, r.hash & 255, false);
      } else if (r.crown === 2 && zone === 3) mb.cbox(f.x, top, f.z, 0.5, 14, 0.5, 0xd0d4dc, M_.METAL, r.hash & 255);
      else if (r.crown === 3 && zone === 3) mb.gable(f.x - r.w / 2, f.z - r.d / 2, f.x + r.w / 2, f.z + r.d / 2, top, 4, 0xb8bec8, shade(r.wall, 0.95), r.hash & 255, false);
      else if (r.crown === 4 && zone === 3) mb.box(f.x - r.w / 2 + 0.8, top, f.z - r.d / 2 + 1.6, f.x + r.w / 2 - 0.8, top + 4 * FLOOR_H, f.z + r.d / 2 - 1.6, r.wall, 0x8d9199, r.mat, (r.hash & 0xfc) | (zone === 3 ? 0 : 3), r.floors);
    }
  }
  return mb.finish();
}
