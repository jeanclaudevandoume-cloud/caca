// One home on its plot (jutaku, villa, mid-rise, tower), shop houses, civic cells and tower massing
// (round Q split of mesher.js).
import { FLOOR_H, hash3, homeRect } from './town.js';
import { ROOF, CITY, ACCENT } from './recipe.js';
import {
  M, TALL, shade, FLAT_MEM, flatMem, LEAVES, VEND, GLASS_DARK, CARS, ACCENT_SIGN,
} from './mb.js';
import {
  tree, kanban, board, shape, gardenItem, door, roofClutter,
} from './props.js';

// Home business on a house street (izakaya, salon, tiny shop): a lit kanban blade beside the door (6 tris, all
// presets) and, on full meshes, a red paper lantern under the eave. About one house in three: residential lanes
// in Tokyo and Seoul are dotted with small lit signs, not only the shopping streets.
function homeBiz(mb, x, wallZ, fs, r, y0, a) {
  if ((r.hash >>> 3) % 3 !== 0) return;
  const cast = mb.cast; mb.cast = false;
  const kh = 2.0 + ((r.hash >>> 5) & 3) * 0.6;
  kanban(mb, x, wallZ + fs * 0.5, y0, kh, 0.18, 0.85, 'z', fs, ACCENT_SIGN[(r.hash >>> 15) % ACCENT_SIGN.length], r.hash >>> 6);
  if (!mb.lite && (r.hash >>> 9) & 1) mb.cyl(x + 0.9, 2.0, wallZ + fs * 0.45, 0.24, 2.6, 0.24, 6, 0xe0322a, M.LIGHT, a, true, 0x2a2a2a);
  mb.cast = cast;
}

// Shop house on a shotengai (town.js shopLaneX): ground-floor shop facing the lane (r.shop = +-1 along x),
// recessed glazing with a warm interior, an awning, a lit vertical sign; flats above with city windows.
const AWNING = [0x2f6f8f, 0xb8452f, 0x3d7a4f, 0x7a3b5e];
function shopHouse(mb, f, r, lod, a) {
  const [x0, z0, x1, z1] = homeRect(f, r), top = r.floors * FLOOR_H, fs = r.shop, fx = fs > 0 ? x1 : x0;
  const wa = (a & 0xfc) | 3;                            // concrete style: windows on every face
  if (lod) { mb.box(x0, 0, z0, x1, top, z1, r.wall, 0x5a5f66, M.WIN, wa); return; }
  mb.shadowBox(x0, 0, z0, x1, top + 0.6, z1);
  mb.noCast = true;
  const gh = 3.6;
  mb.box(x0, 0, z0, x1, gh, z1, shade(r.wall, 0.72), -1, M.PLAIN, a);
  // shopfront: dark frame, warm lit interior, a mid mullion and a lit fascia band
  mb.xq(fx + fs * 0.02, z0 + 0.5, z1 - 0.5, 0.15, 3.0, fs, 0x2a2f36, M.PLAIN, a);
  {   // the shop itself from the atlas (u = tile .. tile + 1): shelves, noren, shutter or vending pair
    const t = (r.hash >>> 17) % 4, za = z0 + 0.8, zb = z1 - 0.8, xf = fx + fs * 0.04;
    if (fs > 0) mb.q(xf, 0.35, zb, xf, 0.35, za, xf, 2.75, za, xf, 2.75, zb, 1, 0, 0, t, 0, t + 1, 1, M.LIGHT, 0xffffff, 255);
    else mb.q(xf, 0.35, za, xf, 0.35, zb, xf, 2.75, zb, xf, 2.75, za, -1, 0, 0, t, 0, t + 1, 1, M.LIGHT, 0xffffff, 255);
  }
  if (!mb.lite) for (const zz of [z0 + (z1 - z0) / 3, z0 + (z1 - z0) * 2 / 3]) mb.cbox(fx + fs * 0.06, 0.15, zz, 0.08, 2.85, 0.12, 0x2a2f36, M.METAL, a);
  mb.xq(fx + fs * 0.03, z0 + 0.3, z1 - 0.3, 3.05, 3.55, fs, ACCENT_SIGN[r.sign], M.LIGHT, a);   // fascia sign
  // awning: a sloped sheet over the shopfront
  const ac = AWNING[r.awning], ax = fx + fs * 1.4;
  if (fs > 0) mb.q(fx, 3.0, z1 - 0.3, fx, 3.0, z0 + 0.3, ax, 2.55, z0 + 0.3, ax, 2.55, z1 - 0.3, 0.3, 0.95, 0, 0, 0, 0, 0, M.PLAIN, ac, a);
  else mb.q(fx, 3.0, z0 + 0.3, fx, 3.0, z1 - 0.3, ax, 2.55, z1 - 0.3, ax, 2.55, z0 + 0.3, -0.3, 0.95, 0, 0, 0, 0, 0, M.PLAIN, ac, a);
  mb.xq(ax, z0 + 0.3, z1 - 0.3, 2.3, 2.55, fs, shade(ac, 0.8), M.PLAIN, a);     // valance
  // flats above, a vertical sign on the lane corner, a parapet and a water tank
  const mem = FLAT_MEM[(r.hash >>> 21) & 3];
  if (r.roofType === 0) {
    mb.boxEave(x0, gh, z0, x1, top, z1, r.wall, -1, M.WIN, wa, 0.4);
    mb.gable(x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5, top, 2.2, ROOF[r.roof], r.wall, a, true, true, shade(ROOF[r.roof], 0.55));
  } else {
    mb.boxEave(x0, gh, z0, x1, top, z1, r.wall, mem, M.WIN, wa, 0.4);
    mb.parapet(x0, z0, x1, z1, top, 0.6, shade(r.wall, 0.85), 0xd9d3c7, a, mem);
    roofClutter(mb, x0, z0, x1, z1, top, r.wall, r.hash >>> 5, a);
    // a rooftop billboard on some corner shops, readable from the drone views
    if ((r.hash >>> 13) % 3 === 0) {
      const bz0 = z0 + 4, bz1 = z1 - 4, bx = fx - fs * 1.2;
      const bc = ACCENT_SIGN[(r.sign + 1) % ACCENT_SIGN.length];
      board(mb, 'x', bx, bz0, bz1, top + 0.8, top + 3.2, fs, bc, r.hash >>> 9);   // tategaki columns (mipmapped: no speckle far off)
      if (!mb.lite) mb.xq(bx - fs * 0.05, bz0, bz1, top + 0.8, top + 3.2, -fs, 0x3a3e45, M.PLAIN, a);
    }
  }
  // vertical sign on the lane corner: big enough to read from the opening camera
  const sz = (r.hash & 1) ? z0 + 0.9 : z1 - 0.9;
  kanban(mb, fx + fs * 0.6, sz, gh + 0.2, Math.max(3.0, top - gh + 0.6), 0.25, 1.2, 'x', fs, ACCENT_SIGN[(r.sign + 2) % ACCENT_SIGN.length], r.hash >>> 5);
  // every second shop: a tall banner sign standing out over the lane (reads from the opening camera)
  if ((r.hash >>> 23) & 1) {
    const bz = (r.hash & 1) ? z1 - 2.2 : z0 + 2.2, bc = AWNING[(r.awning + 1) % AWNING.length];
    mb.cbox(fx + fs * 1.1, gh + 0.6, bz, 1.2, 6.0, 0.16, bc, M.PLAIN, a);
    kanban(mb, fx + fs * 1.1, bz, gh + 1.6, 3.8, 0.24, 0.9, 'z', fs, ACCENT_SIGN[(r.sign + 4) % ACCENT_SIGN.length], (r.hash >>> 3) | 4);   // lit glyph column, not a blank white panel
  }
  mb.noCast = false;
}

// Shrine: a vermilion torii on the south edge, a gravel approach and forecourt, a dark-roofed hall, and a
// ring of tall trees (chinju no mori) that reads from the drone views.
export function shrine(mb, X, Z, h, lod) {
  mb.cast = false;
  mb.q(X - 6, 0.04, Z + 20, X + 6, 0.04, Z + 20, X + 6, 0.04, Z - 8, X - 6, 0.04, Z - 8, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, 0xc9c2b2, 1);   // gravel
  mb.q(X - 13, 0.03, Z - 4, X + 13, 0.03, Z - 4, X + 13, 0.03, Z - 18, X - 13, 0.03, Z - 18, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, 0xbdb6a6, 1);
  mb.cast = true;
  const V = 0xc8402e;
  for (const tz of lod ? [Z + 16] : [Z + 16, Z + 6]) {
    mb.cbox(X - 3.2, 0, tz, 0.55, 6.6, 0.55, V, M.PLAIN, 1); mb.cbox(X + 3.2, 0, tz, 0.55, 6.6, 0.55, V, M.PLAIN, 1);
    mb.cbox(X, 6.6, tz, 9.6, 0.55, 1.0, 0x2a2626, M.PLAIN, 1);                       // kasagi
    mb.cbox(X, 5.4, tz, 8.0, 0.4, 0.5, V, M.PLAIN, 1);                               // nuki
  }
  mb.box(X - 6, 0, Z - 16, X + 6, 1.0, Z - 6, 0xd8d3c6, -1, M.PLAIN, 1);            // stone platform
  mb.box(X - 5, 1.0, Z - 15, X + 5, 5.2, Z - 7, 0x6b4a32, -1, M.PLAIN, 1);          // hall
  mb.gable(X - 6.5, Z - 16.5, X + 6.5, Z - 5.5, 5.2, 3.8, 0x3a3e45, 0x6b4a32, 1, true, true, 0x2a2c30);
  const n = lod || mb.lite ? 10 : 22;
  for (let t = 0; t < n; t++) {
    const a = (t / n) * Math.PI * 2, r = 17 + (hash3(X, Z, 500 + t) % 3);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > 12 && Math.abs(x) < 7) continue;                                         // the approach stays open
    tree(mb, X + x, Z + z, 1.35 + (hash3(X, Z, 600 + t) % 4) * 0.12, (hash3(X, Z, 700 + t) & ~7) | 2, lod);
  }
}
// School: a white four-storey slab with a clock, a dirt sports field with white lines and a net fence.
export function school(mb, X, Z, h, lod) {
  for (const s of [-1, 1]) mb.box(s < 0 ? X - 17 : X, 0, Z - 19, s < 0 ? X : X + 17, 4 * FLOOR_H, Z - 9, 0xeceae4, 0x8c9096, M.WIN, (h & 0xfc) | 3);   // two halves: packed u stays < 32 m
  mb.parapet(X - 17, Z - 19, X + 17, Z - 9, 4 * FLOOR_H, 0.8, 0xd8d6d0, 0xf2f0ea, h & 255, 0x8c9096);
  mb.cast = false;
  mb.cbox(X, 4 * FLOOR_H - 2.6, Z - 8.9, 2.0, 2.0, 0.15, 0xf6f5f0, M.LIGHT, 1);     // clock face
  mb.cbox(X, 4 * FLOOR_H - 1.7, Z - 8.8, 0.12, 0.8, 0.1, 0x2a2c30, M.PLAIN, 1);
  mb.q(X - 18, 0.04, Z + 19, X + 18, 0.04, Z + 19, X + 18, 0.04, Z - 6, X - 18, 0.04, Z - 6, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, 0xb08a5c, 1);   // field
  if (!lod && !mb.lite) {
    mb.q(X - 14, 0.06, Z + 15, X + 14, 0.06, Z + 15, X + 14, 0.06, Z + 14.6, X - 14, 0.06, Z + 14.6, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, 0xf2f0ea, 1);
    mb.q(X - 14, 0.06, Z - 2, X + 14, 0.06, Z - 2, X + 14, 0.06, Z - 2.4, X - 14, 0.06, Z - 2.4, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, 0xf2f0ea, 1);
    mb.q(X - 0.2, 0.06, Z + 15, X + 0.2, 0.06, Z + 15, X + 0.2, 0.06, Z - 2.4, X - 0.2, 0.06, Z - 2.4, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, 0xf2f0ea, 1);
    for (const x of [-18, -9, 0, 9, 18]) mb.cbox(X + x, 0, Z + 19.5, 0.15, 7, 0.15, 0x6e7378, M.METAL, 1);   // net fence posts
    mb.wq(X - 18, X + 18, 0.5, 7, Z + 19.5, 1, 0x9aa0a6, M.PLAIN, 1);
  }
  mb.cast = true;
}

export function home(mb, bx, bz, f, r, lod) {
  mb.noCast = false;                                  // never inherit a house's 'detail does not cast' state
  const a = r.hash & 255;
  if (r.shop) { shopHouse(mb, f, r, lod, a); return; }
  const front = f.face < 0 ? f.z - f.d / 2 : f.z + f.d / 2;        // street edge of the plot
  mb.flag = r.height >= 6 * FLOOR_H ? TALL : 0;
  if (lod && r.zone <= 1) mb.cast = false;         // far low homes don't cast: the ground shader's contact AO grounds them
  const wa = (a & 0xfc) | r.style;                  // wall alpha: seed in the high bits, wall style in the low 2
  if (r.zone === 0) {
    // ---- Tokyo jutaku (LOD0 <= ~150 tris, LITE <= ~55, LOD1 ~16) ----
    const fs = f.face < 0 ? -1 : 1;
    const [x0, z0, x1, z1] = homeRect(f, r);
    const wallZ = f.face < 0 ? z0 : z1;
    const doorX = r.side > 0 ? x0 + 1.3 : x1 - 1.3;              // door on the open side, garage on the side line
    const top = r.floors * FLOOR_H, rc = ROOF[r.roof];
    // a custom home is a normal jutaku with its shape as a rooftop ornament (round Q: a whole house replaced by
    // a giant dome or castle broke the street and the art direction)
    if (r.shape) shape(mb, r.shape, (x0 + x1) / 2, top + (r.roofType === 2 ? 0.6 : r.roofType === 3 ? 2.2 : 1.6), (z0 + z1) / 2, 0.3, r.color, a & 0xfc, lod);
    if (lod) {
      mb.box(x0, 0, z0, x1, top, z1, r.wall, r.roofType === 2 ? flatMem(r) : -1, M.WIN, wa);
      if (r.roofType === 3) mb.mono(x0, z0, x1, z1, 0.2, top, 2.2, fs, rc, r.wall, a, 0, false);
      else if (r.roofType === 0) mb.gable(x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, top, 1.6, rc, r.wall, a, true, false);
    } else {
      mb.shadowBox(x0, 0, z0, x1, top + (r.roofType === 3 ? 1.1 : r.roofType === 0 ? 0.8 : 0.6), z1);
      mb.noCast = true;                                  // the detailed house below casts through its proxy only
      // ground storey (two-tone on half the houses: darker, with a string course), upper storeys with baked eave shade
      const g = shade(r.wall, r.twoTone ? 0.62 : 0.78);           // the ground storey is always darker: value structure
      // upper storeys cantilever 0.6 m over the garage toward the street (not on lite meshes)
      const cz0 = r.garage && f.face < 0 && !mb.lite ? z0 - 0.6 : z0, cz1 = r.garage && f.face > 0 && !mb.lite ? z1 + 0.6 : z1;
      if (mb.lite && r.floors < 3) {
        // lite (round P): one wall box for the whole house; the shader's contact ramp darkens the ground storey
        mb.box(x0, 0, z0, x1, top, z1, shade(r.wall, 0.94), r.roofType === 2 ? flatMem(r) : -1, M.WIN, wa);
        var rz0 = z0, rz1 = z1;
      } else {
      mb.box(x0, 0, z0, x1, FLOOR_H, z1, g, -1, M.WIN, wa);
      if (r.floors >= 3) {
        // stepped massing: the top storey sits back from the street (0 / 1.5 / 2.2 m), its roof terrace in front
        const sb = [0, 1.5, 2.2][(r.hash >>> 28) % 3];
        const zs0 = f.face < 0 ? cz0 + sb : cz0, zs1 = f.face < 0 ? cz1 : cz1 - sb;
        mb.box(x0, FLOOR_H, cz0, x1, 2 * FLOOR_H, cz1, r.wall, flatMem(r), M.WIN, wa, 1);
        mb.boxEave(x0, 2 * FLOOR_H, zs0, x1, top, zs1, r.wall, r.roofType === 2 ? flatMem(r) : -1, M.WIN, wa, 0.4);
        var rz0 = zs0, rz1 = zs1;
      } else { mb.boxEave(x0, FLOOR_H, cz0, x1, top, cz1, r.wall, r.roofType === 2 ? flatMem(r) : -1, M.WIN, wa, 0.4); var rz0 = cz0, rz1 = cz1; }
      }
      if (r.twoTone && !mb.lite) { mb.cast = false; mb.box(x0 - 0.03, FLOOR_H - 0.05, z0 - 0.03, x1 + 0.03, FLOOR_H + 0.02, z1 + 0.03, 0x3a3836, -1, M.PLAIN, a); mb.cast = true; }
      // roof: mono-pitch / low gable with thin eaves and a dark fascia / flat with a parapet ring
      const o = 0.65;
      if (r.roofType === 3) mb.mono(x0, rz0, x1, rz1, o, top, 2.2, fs, rc, r.wall, a, shade(rc, 0.55), true);
      else if (r.roofType === 0) mb.gable(x0 - o, rz0 - o, x1 + o, rz1 + o, top, 1.6, rc, r.wall, a, true, true, shade(rc, 0.55));
      else mb.parapet(x0, rz0, x1, rz1, top, 0.6, shade(r.wall, 0.82), 0xd9d3c7, a, flatMem(r));
      if (r.roofType === 2 && !lod) roofClutter(mb, x0, rz0, x1, rz1, top, r.wall, r.hash, a);
      mb.cast = false;
      // built-in garage: dark opening with a light lintel
      if (r.garage) {
        const gx0 = r.side > 0 ? x1 - 3.2 : x0 + 0.4, gx1 = gx0 + 2.8;
        const open = (r.hash >>> 25) & 1;
        mb.wq(gx0, gx1, 0, 2.5, wallZ + fs * 0.03, fs, open ? 0x1e1f22 : 0x5f676c, M.METAL, a);   // open bay (near black) or a roller shutter
        if (open && (r.hash >>> 27) % 5 < (mb.lite ? 2 : 3)) {     // a kei car parked in the open bay
          const cx = (gx0 + gx1) / 2, cz = wallZ + fs * 0.3, cc = CARS[(r.hash >>> 9) % CARS.length];
          if (mb.lite) {                                            // lite: body + a cabin face toward the street (12 tris)
            mb.cbox(cx, 0.2, cz + fs * 0.6, 1.45, 1.35, 2.6, cc, M.METAL, a);
            mb.wq(cx - 0.62, cx + 0.62, 0.95, 1.45, cz + fs * 1.92, fs, 0x2b3240, M.GLASS, a);
          } else {
            mb.cbox(cx, 0.2, cz, 1.45, 0.75, 1.4, cc, M.METAL, a);
            mb.cbox(cx, 0.95, cz - fs * 0.15, 1.35, 0.6, 0.9, 0x2b3240, M.GLASS, a);
          }
        }
        if (!mb.lite) mb.wq(gx0 - 0.15, gx1 + 0.15, 2.5, 2.7, wallZ + fs * 0.04, fs, 0xd9d3c7, M.PLAIN, a);
      }
      // floor-2 balcony: slab + solid parapet across 60% of the front
      if (r.balcony) {
        const bw = (x1 - x0) * 0.6, bx0 = r.side > 0 ? x0 + 0.3 : x1 - 0.3 - bw, bx1 = bx0 + bw;
        const zf = wallZ + fs * 0.9;
        const pc = (r.hash >>> 23) & 1 ? 0xeeebe4 : shade(r.wall, 0.85);
        mb.wq(bx0, bx1, FLOOR_H, FLOOR_H + 1.1, zf, fs, pc, M.PLAIN, a);                       // parapet front
        mb.q(bx0, FLOOR_H + 1.1, Math.min(wallZ, zf), bx1, FLOOR_H + 1.1, Math.min(wallZ, zf), bx1, FLOOR_H + 1.1, Math.max(wallZ, zf), bx0, FLOOR_H + 1.1, Math.max(wallZ, zf), 0, 1, 0, 0, 0, 0, 0, M.PLAIN, shade(pc, 1.05), a); // parapet top (as a slab)
        if (!mb.lite) {
          mb.xq(bx0, Math.min(wallZ, zf), Math.max(wallZ, zf), FLOOR_H, FLOOR_H + 1.1, -1, shade(pc, 0.9), M.PLAIN, a);
          mb.xq(bx1, Math.min(wallZ, zf), Math.max(wallZ, zf), FLOOR_H, FLOOR_H + 1.1, 1, shade(pc, 0.9), M.PLAIN, a);
        }
        if ((r.hash >>> 24) & 1)                      // laundry / futon hung over the balcony: a splash of colour
          mb.wq(bx0 + 0.4, bx0 + 0.4 + bw * 0.5, FLOOR_H + 0.5, FLOOR_H + 1.1, zf + fs * 0.03, fs, ACCENT[(r.hash >>> 3) % ACCENT.length], M.PLAIN, a);
      }
      // houses on a north street turn their back to the sun: a south balcony with laundry and the AC unit,
      // as in Tokyo, where the drying balcony faces south whatever the street does (all presets: ~10 tris)
      if (f.face < 0 && r.floors >= 2) {
        const bw = (x1 - x0) * (0.6 + 0.2 * ((r.hash >>> 19) & 1)), bx0 = r.side > 0 ? x1 - 0.3 - bw : x0 + 0.3, bx1 = bx0 + bw;
        const zb = z1, zf = z1 + 0.95, y = FLOOR_H;
        const pc = (r.hash >>> 22) & 1 ? 0xeeebe4 : shade(r.wall, 0.85);
        mb.wq(bx0, bx1, y, y + 1.1, zf, 1, pc, M.PLAIN, a);
        mb.q(bx0, y + 1.1, zb, bx1, y + 1.1, zb, bx1, y + 1.1, zf, bx0, y + 1.1, zf, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, shade(pc, 1.05), a);
        if (!mb.lite) mb.q(bx0, y, zf, bx1, y, zf, bx1, y, zb, bx0, y, zb, 0, -1, 0, 0, 0, 0, 0, M.PLAIN, shade(pc, 0.45), a);   // dark slab underside
        mb.wq(bx0 + 0.3, bx0 + 0.3 + bw * 0.45, y + 0.35, y + 1.1, zf + 0.03, 1, ACCENT[(r.hash >>> 13) % ACCENT.length], M.PLAIN, a);   // futon / laundry
        if (mb.lite) mb.wq(bx1 - 1.2, bx1 - 0.4, 0.2, 0.8, zb + 0.35, 1, 0xd8d8d4, M.METAL, a);
        else mb.cbox(bx1 - 0.8, 0, zb + 0.3, 0.85, 0.6, 0.4, 0xd8d8d4, M.METAL, a);           // AC unit under the balcony
      }
      // the open side wall faces the lane: outdoor AC unit, downpipe and meter box make it read as a real wall
      {
        const sx = r.side > 0 ? x0 : x1, sxs = r.side > 0 ? -1 : 1;
        const zm = (z0 + z1) / 2, zr = f.face < 0 ? z1 - 0.3 : z0 + 0.3;
        if (mb.lite) {                                   // lite: flat quads on the wall (2 tris each)
          mb.xq(sx + sxs * 0.02, zm + 0.8, zm + 1.6, 0.15, 0.75, sxs, 0xd8d8d4, M.METAL, a);
          mb.xq(sx + sxs * 0.02, zr - 0.05, zr + 0.05, 0, top, sxs, 0x5a5e62, M.METAL, a);
        } else {
          mb.cbox(sx + sxs * 0.2, 0.15, zm + 1.2, 0.4, 0.6, 0.85, 0xd8d8d4, M.METAL, a);
          mb.cbox(sx + sxs * 0.06, 0, zr, 0.1, top, 0.1, 0x5a5e62, M.METAL, a);
          mb.cbox(sx + sxs * 0.06, 1.2, zm - 1.4, 0.1, 0.5, 0.4, 0xbfc3c6, M.METAL, a);
        }
        if (!mb.lite) mb.cbox(sx + sxs * 0.2, FLOOR_H + 0.4, zm - 2.2, 0.4, 0.55, 0.8, 0xd8d8d4, M.METAL, a);
      }
      // potted plants either side of the door (cheap: a pot box and a small 8-tri crown)
      for (const px of mb.lite ? [] : [doorX - 0.95, doorX + 0.95]) {
        const pz = wallZ + fs * 0.45;
        mb.cbox(px, 0, pz, 0.45, 0.45, 0.45, 0x8a5a3c, M.PLAIN, a);
        mb.ell(px, 0.85, pz, 0.38, 0.45, 0.38, 4, 1, LEAVES[(r.hash >>> 7) % LEAVES.length], M.LEAF, a);
      }
      mb.cast = true;
      door(mb, doorX, wallZ, fs, r, rc, a);
      homeBiz(mb, doorX - 1.5, wallZ, fs, r, 1.9, a);
      mb.noCast = false;
    }
    if (!lod) {
      // side planting strip with a small tree; vending machine at the front corner
      const gapX = r.side > 0 ? x0 - 1.2 : x1 + 1.2;
      if (r.tree && (!mb.lite || (r.hash >>> 22) % 10 < 3)) tree(mb, gapX, (z0 + z1) / 2, 0.55, r.hash >>> 9, mb.lite ? 1 : 0);
      if (r.vending) {
        mb.cast = false;
        const vx = r.side > 0 ? f.x - 4.3 : f.x + 4.3, vz = front - fs * 0.6;
        if (mb.lite) mb.wq(vx - 0.45, vx + 0.45, 0, 1.8, vz + fs * 0.35, fs, VEND[(r.hash >>> 11) % VEND.length], M.LIGHT, a);   // lite: the lit front only
        else mb.cbox(vx, 0, vz, 0.9, 1.8, 0.7, VEND[(r.hash >>> 11) % VEND.length], M.LIGHT, a);
        mb.cast = true;
      }
      // people on the lane in front of about one home in six: a commuter, a shopper (all presets, 13 tris). A
      // street with no one on it reads as a model; these are what make the lanes feel lived in from the drone views.
      if ((r.hash >>> 28) % 10 === 0) {
        const cast = mb.cast; mb.cast = false;
        const px = f.x + (((r.hash >>> 4) & 7) - 3.5) * 1.1, pz = front + fs * (1.2 + ((r.hash >>> 12) & 1) * 1.6);
        const cloth = [0x2b3a55, 0x3d3d3d, 0xd8d2c4, 0x7a2e3a, 0x34594a, 0xe8b23a][(r.hash >>> 14) % 6];
        mb.cyl(px, 0, pz, 0.22, 1.5, 0.26, 3, cloth, M.PLAIN, a, false);              // body (6 tris)
        mb.cyl(px, 1.5, pz, 0.14, 1.72, 0.12, 3, 0xe0b894, M.PLAIN, a);                // head (7 tris)
        if ((r.hash >>> 17) & 1) mb.wq(px + 0.25, px + 1.85, 0.05, 0.95, pz + 0.3, fs, 0x2a2c30, M.METAL, a);   // a bicycle by them (side-on silhouette)
        mb.cast = cast;
      }
      if (!mb.lite) {
        const spots = [r.side > 0 ? -2.5 : 2.5];
        const backZ = f.face < 0 ? f.z + f.d / 2 - 2 : f.z - f.d / 2 + 2;
        for (let i = 0; i < r.garden.length && i < spots.length; i++) gardenItem(mb, r.garden[i], f.x + spots[i], backZ, r.hash >>> (i * 3));
      }
    }
  } else if (r.zone === 1) {
    // ---- Seoul villa: open parking storey on columns, brick above, flat roof (LOD0 <= ~160, LITE <= ~60) ----
    const fs = f.face < 0 ? -1 : 1, setback = 1.5;
    const z0 = f.face < 0 ? front + setback : front - setback - r.d, z1 = z0 + r.d;
    const x0 = f.x - r.w / 2, x1 = f.x + r.w / 2, wallZ = f.face < 0 ? z0 : z1;
    const top = r.floors * FLOOR_H;
    if (r.shape) shape(mb, r.shape, f.x, top + (r.mansard ? 1.4 : 0.6), (z0 + z1) / 2, 0.3, r.color, a & 0xfc, lod);   // ornament on the roof
    if (lod) {
      mb.box(x0, 0, z0, x1, top, z1, r.wall, r.roofMem, M.WIN, wa);
    } else {
      mb.shadowBox(x0, 0, z0, x1, top + (r.mansard ? 1.0 : 0.6), z1);
      mb.noCast = true;
      // pilotis: dark parking void at the front half, columns, upper mass from floor 2
      const pz0 = f.face < 0 ? z0 : z0 + r.d * 0.5, pz1 = f.face < 0 ? z0 + r.d * 0.5 : z1;
      const bz0 = f.face < 0 ? pz1 : z0, bz1 = f.face < 0 ? z1 : pz0;
      if (mb.lite) mb.wq(x0 + 0.3, x1 - 0.3, 0, FLOOR_H, f.face < 0 ? bz0 : bz1, fs, 0x4a4744, M.PLAIN, a);   // lite: the face seen through the void
      else mb.box(x0 + 0.3, 0, bz0, x1 - 0.3, FLOOR_H, bz1, 0x4a4744, -1, M.PLAIN, a);          // back of the parking storey
      mb.q(x0, FLOOR_H - 0.01, pz0, x1, FLOOR_H - 0.01, pz0, x1, FLOOR_H - 0.01, pz1, x0, FLOOR_H - 0.01, pz1, 0, -1, 0, 0, 0, 0, 0, M.PLAIN, 0x2a2c30, a);
      const cz = f.face < 0 ? z0 + 0.25 : z1 - 0.25;
      if (mb.lite) {                                  // lite: each corner column is its street face and its outer side (4 tris, not 10)
        const zf = cz + fs * 0.225, za = Math.min(cz - 0.225, cz + 0.225), zb = za + 0.45;
        mb.wq(x0 + 0.025, x0 + 0.475, 0, FLOOR_H, zf, fs, 0xbdb6aa, M.PLAIN, a); mb.xq(x0 + 0.025, za, zb, 0, FLOOR_H, -1, 0xbdb6aa, M.PLAIN, a);
        mb.wq(x1 - 0.475, x1 - 0.025, 0, FLOOR_H, zf, fs, 0xbdb6aa, M.PLAIN, a); mb.xq(x1 - 0.025, za, zb, 0, FLOOR_H, 1, 0xbdb6aa, M.PLAIN, a);
      } else for (const cx of [x0 + 0.25, x1 - 0.25, (x0 + x1) / 2]) mb.cbox(cx, 0, cz, 0.45, FLOOR_H, 0.45, 0xbdb6aa, M.PLAIN, a);
      mb.boxEave(x0, FLOOR_H, z0, x1, top, z1, r.wall, -1, M.WIN, wa, 0.4);
      // glass stair strip on the street face
      mb.cast = false;
      const sx = f.x + (r.hash & 16 ? 2.2 : -2.2);
      mb.wq(sx - 0.6, sx + 0.6, FLOOR_H, top - 0.3, wallZ + fs * 0.04, fs, 0x6f8fa6, M.GLASS, a);
      mb.cast = true;
      // flat roof: coloured membrane, parapet, water tank; some get a faux mansard
      if (r.mansard) mb.mansard(x0, z0, x1, z1, top, 1.4, 0x7a2f26, r.roofMem, a);
      else { mb.parapet(x0, z0, x1, z1, top, 0.6, shade(r.wall, 0.85), 0xd9d3c7, a, r.roofMem); }
      if (!mb.lite) mb.cyl(x0 + 1.6, top, (z0 + z1) / 2, 0.9, top + 1.6, 0.9, 6, (r.hash >>> 7) & 1 ? 0x2f6fb0 : 0xd9a441, M.METAL, a);
      if (!r.mansard) roofClutter(mb, x0 + 2.6, z0, x1, z1, top, r.wall, r.hash >>> 3, a);
      door(mb, f.x, wallZ, fs, r, ROOF[r.roof], a);
      homeBiz(mb, f.x - 1.6, wallZ, fs, r, FLOOR_H + 0.2, a);   // villas: the sign hangs over the parking storey
      mb.noCast = false;
    }
  } else {
    const tower = r.zone === 3;
    if (tower) f = { ...f, x: f.x + r.ox };            // towers stand over two plots
    if (tower && r.pod) {                              // odd slot: a two-storey podium with a roof garden
      const pc = CITY[(r.hash >>> 5) % CITY.length];
      mb.box(f.x - 4.8, 0, f.z - 9.5, f.x + 4.8, 2 * FLOOR_H, f.z + 9.5, pc, 0x5f7f4a, M.WIN, a & 0xfc);
      if (!lod && !mb.lite) for (let i = 0; i < 3; i++) tree(mb, f.x - 3 + i * 3, f.z + (i - 1) * 5, 0.5, r.hash >>> i, 1);
      if (r.top) shape(mb, r.shape, f.x, 2 * FLOOR_H, f.z, 0.75, r.color, a & 0xfc, lod);
      mb.flag = 0; mb.cast = true;
      return;
    }
    const aw = (a & 0xfc) | (tower ? 0 : 3);          // wall style 3 = concrete panels (never siding/brick)
    const w = r.w, d = tower ? r.d : r.d;
    const x0 = f.x - w / 2, x1 = f.x + w / 2, z0 = f.z - d / 2, z1 = f.z + d / 2;
    const top = r.floors * FLOOR_H;
    const roofC = [0x7d7870, 0x6a6660, 0x8a847a, 0x5e615f][(r.hash >>> 21) & 3];   // warm concrete (no lavender rooftops)
    let base = 0;
    const fz = f.face < 0 ? z0 : z1, fs = f.face < 0 ? -1 : 1;     // street-facing wall
    const sign = ACCENT_SIGN[(r.hash >>> 13) % ACCENT_SIGN.length];
    if (tower && !r.sig) { towerMass(mb, f, r, bx, bz, r.slot, mb.lite || !!lod, !lod && !mb.lite); mb.flag = 0; mb.cast = true; return; }
    if (tower) {
      const pod = CITY[(r.hash >>> 5) % CITY.length];
      mb.box(f.x - w / 2 - 0.4, 0, f.z - 9.4, f.x + w / 2 + 0.4, 2 * FLOOR_H, f.z + 9.4, pod, shade(pod, 0.85), M.WIN, a & 0xfc);
      base = 2 * FLOOR_H;
      if (!lod && !mb.lite) {                      // lobby glass and a lit sign over the entrance
        mb.cast = false;
        const pz = f.face < 0 ? f.z - 9.4 : f.z + 9.4;
        mb.cbox(f.x, 0, pz + fs * 0.05, 7, 3.4, 0.3, 0x9fc4dd, M.GLASS, a);
        mb.cbox(f.x, 4.2, pz + fs * 0.25, 5, 0.9, 0.3, sign, M.LIGHT, a);
        mb.cast = true;
      }
    } else if (!lod) {
      // shopfront: glass ground floor, a coloured awning fixed to the wall and a lit sign
      mb.cast = false;
      const gc = shade(0x9fc4dd, 0.9 + ((r.hash >>> 3) & 3) * 0.05);
      if (mb.lite) mb.wq(f.x - w / 2 + 0.6, f.x + w / 2 - 0.6, 0, 2.8, fz + fs * 0.12, fs, gc, M.GLASS, a);   // lite: the street face only
      else mb.cbox(f.x, 0, fz + fs * 0.06, w - 1.2, 2.8, 0.25, gc, M.GLASS, a);
      {   // sloped awning: thin, fixed to the wall, front edge dropped
        const zw = fz, zf = fz + fs * 1.3, ac = ROOF[r.roof];
        if (fs < 0) {
          mb.fq(x1 - 0.3, 2.7, zf, x0 + 0.3, 2.7, zf, x0 + 0.3, 3.1, zw, x1 - 0.3, 3.1, zw, M.PLAIN, ac, a);
          mb.fq(x0 + 0.3, 2.7, zf, x1 - 0.3, 2.7, zf, x1 - 0.3, 3.1, zw, x0 + 0.3, 3.1, zw, M.PLAIN, shade(ac, 0.7), a);
        } else {
          mb.fq(x0 + 0.3, 2.7, zf, x1 - 0.3, 2.7, zf, x1 - 0.3, 3.1, zw, x0 + 0.3, 3.1, zw, M.PLAIN, ac, a);
          mb.fq(x1 - 0.3, 2.7, zf, x0 + 0.3, 2.7, zf, x0 + 0.3, 3.1, zw, x1 - 0.3, 3.1, zw, M.PLAIN, shade(ac, 0.7), a);
        }
        mb.wq(x0 + 0.3, x1 - 0.3, 2.45, 2.7, zf, fs, ac, M.PLAIN, a);
      }
      if ((r.hash >>> 17) % 3) {
        const sw = Math.min(5, w - 2) / 2;
        if (mb.lite) mb.wq(f.x - sw, f.x + sw, 3.3, 4.1, fz + fs * 0.2, fs, sign, M.LIGHT, a);
        else mb.cbox(f.x, 3.3, fz + fs * 0.15, sw * 2, 0.8, 0.25, sign, M.LIGHT, a);
      }
      mb.cast = true;
    }
    if (top > base) mb.box(x0, base, z0, x1, top, z1, r.wall, roofC, r.mat, aw, base / FLOOR_H);
    let roofTop = top;
    const crown = tower && r.sig ? 5 : r.crown;
    if (crown === 1) {
      const t2 = top + 3 * FLOOR_H;
      mb.box(x0 + 1.4, top, z0 + (tower ? 2.5 : 1.4), x1 - 1.4, t2, z1 - (tower ? 2.5 : 1.4), shade(r.wall, 1.06), roofC, r.mat, aw, r.floors);
      roofTop = t2;
    } else if (crown === 2 && tower) {
      mb.cbox(f.x, top, f.z, 0.4, 14, 0.4, 0xd0d4dc, M.METAL, a);
      mb.cbox(f.x, top + 13.4, f.z, 0.7, 0.7, 0.7, 0xff3030, M.LIGHT, a);
    } else if (crown === 3 && tower) {
      mb.gable(x0, z0, x1, z1, top, 4, 0xb8bec8, shade(r.wall, 0.95), a, false);
    } else if (crown === 4 && tower) {
      const t2 = top + 2 * FLOOR_H, t3 = t2 + 2 * FLOOR_H;
      mb.box(x0 + 0.8, top, z0 + 1.6, x1 - 0.8, t2, z1 - 1.6, shade(r.wall, 1.08), roofC, r.mat, aw, r.floors);
      mb.box(x0 + 1.8, t2, z0 + 3.4, x1 - 1.8, t3, z1 - 3.4, shade(r.wall, 1.16), 0xd0d4dc, r.mat, aw, r.floors + 2);
      roofTop = t3;
    } else if (crown === 5) {
      // signature tower: stepped crown, a lit glass lantern and a spire
      const t2 = top + 3 * FLOOR_H, t3 = t2 + 3 * FLOOR_H;
      mb.box(x0 + 1, top, z0 + 2, x1 - 1, t2, z1 - 2, shade(r.wall, 1.1), roofC, r.mat, aw, r.floors);
      mb.box(x0 + 2.2, t2, z0 + 4.5, x1 - 2.2, t3, z1 - 4.5, 0xffc878, 0xd0d4dc, M.LIGHT, a);
      mb.cyl(f.x, t3, f.z, 1.2, t3 + 22, 0.15, 6, 0xe8ebf0, M.METAL, a, false);
      mb.cbox(f.x, t3 + 21.5, f.z, 0.8, 0.8, 0.8, 0xff3030, M.LIGHT, a);
      roofTop = t3;
    }
    // aviation lights on the corners of tall roofs (red specks that make the skyline sparkle at night)
    if (top >= 30 * FLOOR_H && crown !== 5) {
      mb.cast = false;
      mb.cbox(x0 + 0.4, roofTop, z0 + 0.4, 0.6, 0.6, 0.6, 0xff3030, M.LIGHT, a);
      mb.cbox(x1 - 0.4, roofTop, z1 - 0.4, 0.6, 0.6, 0.6, 0xff3030, M.LIGHT, a);
      mb.cast = true;
    }
    if (!lod && !mb.lite && !r.top && crown !== 5) {
      // rooftop plant: position and size vary per building so roofs don't look stamped
      mb.cast = false;
      const ux = ((r.hash >>> 22) % 5 - 2) * (w / 7), uz = ((r.hash >>> 25) % 5 - 2) * (d / 9);
      const uw = 1.6 + ((r.hash >>> 28) & 3) * 0.5;
      mb.cbox(f.x + ux, roofTop, f.z + uz, uw, 1.4 + ((r.hash >>> 6) & 1), uw * 1.3, 0xd6d8dc, M.METAL, a);
      if (r.crown === 0 && !tower) mb.cyl(f.x - ux * 0.8, roofTop, f.z - uz - 1, 1.1, roofTop + 2.6, 1.1, 6, 0xc9c4ba, M.PLAIN, a);
      mb.cast = true;
    }
    if (r.top) shape(mb, r.shape, f.x, roofTop, f.z, tower ? 0.85 : 0.75, r.color, a & 0xfc, lod);
    if (!tower && !lod) {
      // Tokyo-style street face (kanban also on lite): a vertical lit sign, balconies and air-conditioner boxes
      mb.cast = false;
      {                                          // vertical kanban on every street face, plus stacked signs on some
        const kx = r.hash & 1 ? x0 + 0.5 : x1 - 0.5, kh = 6 + ((r.hash >>> 6) % 4);
        kanban(mb, kx, fz + fs * 0.75, 4.0, kh, 0.3, 1.2, 'z', fs, ACCENT[(r.hash >>> 9) % ACCENT.length], r.hash >>> 7);
        if (r.hash & 2 && !mb.lite) {
          const n = 1 + ((r.hash >>> 5) % 2);
          for (let i = 0; i < n; i++) kanban(mb, r.hash & 1 ? x1 - 0.4 : x0 + 0.4, fz + fs * 0.45, 4.2 + i * 4.0, 3.5, 0.25, 0.6, 'z', fs, ACCENT_SIGN[((r.hash >>> 9) + i * 3) % ACCENT_SIGN.length], (r.hash >>> 11) + i);
        }
        if ((r.hash >>> 26) % 4 === 0) {           // rooftop billboard (lite: a double-sided panel, 4 tris)
          const bc = ACCENT_SIGN[(r.hash >>> 4) % ACCENT_SIGN.length];   // sign colours, not the wall accents
          const by0 = roofTop + 2.5, by1 = roofTop + 5.5;
          if (mb.lite) { board(mb, 'z', f.z, f.x - 3, f.x + 3, by0, by1, 1, bc, r.hash >>> 3); board(mb, 'z', f.z, f.x - 3, f.x + 3, by0, by1, -1, bc, r.hash >>> 5); }
          else {
            mb.cbox(f.x - 2, roofTop, f.z, 0.2, 2.5, 0.2, 0x3a3e45, M.METAL, a); mb.cbox(f.x + 2, roofTop, f.z, 0.2, 2.5, 0.2, 0x3a3e45, M.METAL, a);
            board(mb, 'z', f.z + 0.15, f.x - 3, f.x + 3, by0, by1, 1, bc, r.hash >>> 3); board(mb, 'z', f.z - 0.15, f.x - 3, f.x + 3, by0, by1, -1, bc, r.hash >>> 5);
            mb.xq(f.x + 3, f.z - 0.15, f.z + 0.15, by0, by1, 1, bc, M.LIGHT, a); mb.xq(f.x - 3, f.z - 0.15, f.z + 0.15, by0, by1, -1, bc, M.LIGHT, a);
            mb.q(f.x - 3, by1, f.z + 0.15, f.x + 3, by1, f.z + 0.15, f.x + 3, by1, f.z - 0.15, f.x - 3, by1, f.z - 0.15, 0, 1, 0, 0, 0, 0, 0, M.METAL, 0x3a3e45, a);
          }
        }
      }
      if (r.hash & 4 && !mb.lite) {
        const bz0 = f.face < 0 ? z0 - 1.0 : z1, bz1 = bz0 + 1.0;
        for (let fl = 2; fl < Math.min(r.floors, 6); fl++) mb.box(x0 + 1.2, fl * FLOOR_H - 0.1, bz0, x1 - 1.2, fl * FLOOR_H + 0.08, bz1, 0xe8e6e0, 0xe8e6e0, M.PLAIN, a);
      }
      if (!mb.lite) for (let i = 0; i < 2; i++) mb.cbox(i ? x1 - 1.4 : x0 + 1.4, FLOOR_H * (2 + i * 2) + 0.3, fz + fs * 0.25, 0.8, 0.6, 0.4, 0xd8d8d4, M.METAL, a);
      mb.cast = true;
    }
  }
  mb.flag = 0;
  mb.cast = true;
}

// Tower massing (round P), shared by near chunks and skyline tiles so the handover never changes a building:
// a warm-stone podium (4-6 floors, the whole plot pair), a shaft set back 2-3 m, an optional second setback
// at 60-75% of the height, and one of four crowns. Facade family by position, so neighbours rarely match:
// 0 dark glass ribbons, 1 warm stone with punched windows, 2 light concrete with ribbon windows, 3 bronze.
const STONE = [0xc9a27e, 0xd8c3a0, 0xb5876a, 0xcdb89a];
const FAMILY = [0, 1, 0, 2, 0, 1, 3, 2, 0, 1];          // 40% glass, 30% stone, 20% light, 10% bronze
export function towerMass(mb, f, r, bx, bz, slot, lite, near) {
  const h = r.hash, top = r.floors * FLOOR_H;
  const fam = FAMILY[(bx * 3 + bz * 7 + (slot >> 1) * 5 + ((h >>> 29) & 1)) % FAMILY.length];
  const facade = [0, 2, 0, 3][fam];
  const wall = fam === 0 ? GLASS_DARK[(h >>> 9) % GLASS_DARK.length] : fam === 1 ? STONE[(h >>> 9) & 3] : fam === 2 ? 0xdcd8cf : 0x6b5a45;
  const aw = (h & 0xf0) | (facade << 2);              // shader: seed & 3 = facade
  const podF = 4 + (h % 3), pod = Math.min(top - 6 * FLOOR_H, podF * FLOOR_H);
  const hw = r.w / 2 + 0.4, hd = r.d / 2 + 0.4;
  const stone = STONE[(h >>> 13) & 3];
  if (pod > 0 && !lite) mb.box(f.x - hw, 0, f.z - hd, f.x + hw, pod, f.z + hd, stone, shade(stone, 0.8), M.WIN, (h & 0xf0) | 3);   // lite (far skyline): the mid-band hides podiums
  const sb = lite ? 0 : 2 + ((h >>> 3) & 1);            // shaft setback (none on far lite tiles: no 'pencils' through the fog)
  const x0 = f.x - r.w / 2 + sb, x1 = f.x + r.w / 2 - sb, z0 = f.z - r.d / 2 + sb * 0.7, z1 = f.z + r.d / 2 - sb * 0.7;
  const second = (h >>> 5) % 3 !== 0 && top > 24 * FLOOR_H && !lite;
  const y2 = second ? Math.round(top * (0.6 + ((h >>> 7) % 4) * 0.05) / FLOOR_H) * FLOOR_H : top;
  const roof = 0x5e615f;
  const y0 = lite ? 0 : Math.max(pod, 0);
  mb.box(x0, y0, z0, x1, y2, z1, wall, roof, M.GLASS, aw, y0 / FLOOR_H);
  let cx0 = x0, cx1 = x1, cz0 = z0, cz1 = z1;
  if (second) {
    cx0 += 1.8; cx1 -= 1.8; cz0 += 1.4; cz1 -= 1.4;
    mb.box(cx0, y2, cz0, cx1, top, cz1, wall, roof, M.GLASS, aw, y2 / FLOOR_H);
  }
  // crown
  const crown = (h >>> 11) & 3, mx = (cx0 + cx1) / 2, mz = (cz0 + cz1) / 2;
  if (lite) {
    // lite (phone skyline): every top gets a cheap crown, ~10 tris like the old penthouse (the phone vantage is at
    // its 60k budget): a setback tier in the facade colour with a light cap, a pale lantern, a dark plant box, or a
    // three-sided spire. Caps read in the family's own colour instead of one tan slab.
    const t2 = top + 2 * FLOOR_H, cap = fam === 0 ? 0xc9ccd0 : shade(wall, 1.12);
    if (crown === 0) mb.box(cx0 + 2.2, top, cz0 + 1.8, cx1 - 2.2, t2, cz1 - 1.8, wall, cap, M.GLASS, aw, r.floors);   // setback tier
    else if (crown === 1) mb.box(cx0 + 2.4, top, cz0 + 2.2, cx1 - 2.4, top + 2.6 * FLOOR_H, cz1 - 2.2, 0xf0e2c0, 0xd8d4ca, M.LIGHT, aw);   // lantern: frosted by day, a lit crown after dusk
    else if (crown === 2) mb.box(cx0 + 3, top, cz0 + 2.6, cx1 - 5, top + 2.2 * FLOOR_H, cz1 - 3.2, 0x5b6066, 0x7d8288, M.METAL, aw);   // plant box
    else mb.cyl(mx, top, mz, 2.2, top + 22, 0, 3, 0xe4e6ea, M.METAL, aw, false);   // spire (3 tris)
    // aviation light (3 tris, blinks in the shader: alpha 249): the red dots that mark a Tokyo skyline at dusk
    if (top >= 24 * FLOOR_H) { const py = crown === 3 ? top + 22 : crown === 0 ? t2 : crown === 1 ? top + 2.6 * FLOOR_H : top + 2.2 * FLOOR_H; mb.cyl(mx, py, mz, 1.7, py + 2.6, 0, 3, 0xff2a1f, M.LIGHT, 249, false); }
    return;
  }
  if (crown === 0) {                                     // mechanical penthouse with louvre bands
    mb.box(cx0 + 1.5, top, cz0 + 1.5, cx1 - 1.5, top + 2 * FLOOR_H, cz1 - 1.5, 0x8a8f94, 0x5e615f, M.METAL, aw);
  } else if (crown === 1) {                              // a sloped cut across the top
    mb.mono(cx0, cz0, cx1, cz1, 0, top, 3 * FLOOR_H, (h & 1) ? 1 : -1, shade(wall, 0.9), wall, aw, 0, false);
  } else if (crown === 2) {                              // an exposed frame of roof fins
    for (const fx of lite ? [cx0 + 0.3, cx1 - 0.3] : [cx0 + 0.3, mx, cx1 - 0.3]) mb.box(fx - 0.25, top, cz0, fx + 0.25, top + 2.6 * FLOOR_H, cz1, shade(wall, 1.1), shade(wall, 1.1), M.PLAIN, aw);
  } else {                                               // helipad with a red / white rim
    mb.cyl(mx, top, mz, Math.min(cx1 - cx0, cz1 - cz0) * 0.45, top + 0.9, Math.min(cx1 - cx0, cz1 - cz0) * 0.45, lite ? 6 : 10, 0x4a4d52, M.PLAIN, aw);
    if (!lite) mb.cyl(mx, top + 0.9, mz, Math.min(cx1 - cx0, cz1 - cz0) * 0.46, top + 1.05, Math.min(cx1 - cx0, cz1 - cz0) * 0.46, 10, 0xd8342c, M.LIGHT, aw);
  }
  if (top >= 24 * FLOOR_H) mb.cbox(mx, crown === 0 ? top + 2 * FLOOR_H : crown === 1 ? top + 3 * FLOOR_H : crown === 2 ? top + 2.6 * FLOOR_H : top + 1.05, mz, 1.4, 1.4, 1.4, 0xff2a1f, M.LIGHT, 249);   // aviation light (blinks: alpha 249)
  if (near) {                                            // lobby glass and a lit sign over the entrance
    const fs = f.face < 0 ? -1 : 1, pz = f.z + fs * hd, sign = ACCENT_SIGN[(h >>> 13) % ACCENT_SIGN.length];
    const cast = mb.cast; mb.cast = false;
    mb.cbox(f.x, 0, pz + fs * 0.05, 7, 3.4, 0.3, 0x9fc4dd, M.GLASS, aw);
    mb.cbox(f.x, 4.2, pz + fs * 0.25, 5, 0.9, 0.3, sign, M.LIGHT, h & 255);
    mb.cast = cast;
  }
}
