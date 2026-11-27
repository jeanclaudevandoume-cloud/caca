// Street props and small parts shared by homes and chunks: trees, wires, lamps, kanban and billboards,
// custom shapes, garden items, doors and rooftop clutter (round Q split of mesher.js).
import { hash3 } from './town.js';
import { ROOF, clampSV } from './recipe.js';
import {
  rcos, rsin, M, shade, LEAVES, BLOSSOM, TRUNK, DOORS,
} from './mb.js';

export function tree(mb, x, z, s, h, lod) {
  const cast = mb.cast;
  if (cast && lod) mb.cast = false;                 // far trees don't cast at all
  else if (cast && !mb.lite) {
    // cheap shadow stand-in (hidden inside the crown); the detailed crown below does not cast
    mb.ell(x, 3.6 * s, z, 1.8 * s, 1.6 * s, 1.8 * s, 4, 1, 0x3e6d3a, M.LEAF, 0);
    mb.cast = false;
  }
  treeBody(mb, x, z, s, h, lod);
  mb.cast = cast;
}
function treeBody(mb, x, z, s, h, lod) {
  const kind = h % 7;
  if (mb.lite) {
    const c = kind === 6 ? BLOSSOM[(h >>> 3) % 3] : LEAVES[(h >>> 3) % LEAVES.length];
    mb.cyl(x, 0, z, 0.34 * s, 1.7 * s, 0.3 * s, 3, TRUNK, M.PLAIN, h & 255, false);   // the trunk stays (and reads): a crown without one floats
    if (kind < 2) mb.cyl(x, 1.0 * s, z, 2.2 * s, 6 * s, 0, 4, shade(c, 0.85), M.LEAF, h & 255);
    else if (kind === 6) mb.ell(x, 3.0 * s, z, 2.8 * s, 1.25 * s, 2.8 * s, 6, 2, c, M.LEAF, h & 255, false, 0.62);   // sakura: a wide, flat canopy, not a pink ball
    else mb.ell(x, 3.4 * s, z, 2.2 * s, 1.9 * s, 2.2 * s, 4, 2, c, M.LEAF, h & 255, false, 0.62);   // 24 tris, rounder than a diamond
    return;
  }
  const c = kind === 6 ? BLOSSOM[(h >>> 3) % 3] : LEAVES[(h >>> 3) % LEAVES.length];
  const a = h & 255;
  const sides = lod ? 5 : 6;
  if (kind < 2) { // conifer
    mb.cbox(x, 0, z, 0.4 * s, 1.4 * s, 0.4 * s, TRUNK, M.PLAIN, a);
    mb.cyl(x, 1.0 * s, z, 2.2 * s, 4.6 * s, 0, sides, shade(c, 0.8), M.LEAF, a);
    if (!lod) mb.cyl(x, 3.2 * s, z, 1.6 * s, 6.6 * s, 0, sides, shade(c, 0.9), M.LEAF, a);
  } else {
    mb.cbox(x, 0, z, 0.45 * s, 2.2 * s, 0.45 * s, TRUNK, M.PLAIN, a);
    if (!lod && s >= 0.8) {          // fuller crown: two offset blobs
      const ox = ((h >>> 9) & 1 ? 0.7 : -0.7) * s;
      mb.ell(x - ox, 3.5 * s, z, 2.1 * s, 1.8 * s, 2.1 * s, sides, 3, c, M.LEAF, a, false, 0.62);
      mb.ell(x + ox, 4.3 * s, z + 0.4 * s, 1.6 * s, 1.5 * s, 1.6 * s, sides, 2, shade(c, 1.08), M.LEAF, a, false, 0.62);
    } else mb.ell(x, 3.6 * s, z, 2.3 * s, 2.0 * s, 2.3 * s, sides, lod ? 2 : 3, c, M.LEAF, a, false, 0.62);
  }
}

// Overhead wires between two poles at x0 -> x1 (z fixed): thin dark ribbons that sag 0.4 m mid-span,
// seen from both sides (two faces), the cheapest strong Tokyo street signal.
export function wires(mb, x0, x1, z, n, alongZ = false) {
  const cast = mb.cast; mb.cast = false;
  const c = 0x222428, xm = (x0 + x1) / 2;
  // P(a, y, off): a = position along the wire, off = sideways offset (axis swapped when alongZ)
  const P = (a, off) => (alongZ ? [z + off, a] : [a, z + off]);
  for (let i = 0; i < n; i++) {
    const y = 8.15 - i * 0.12, dz = (i - 1) * 0.5;
    for (const [ax, bx, ay, by] of [[x0, xm, y, y - 0.4], [xm, x1, y - 0.4, y]]) {
      for (const fs of [1, -1]) {
        // flat-shaded ribbon tilted 45 degrees, so it has width seen from the street AND from a drone (a vertical
        // ribbon vanished from above into broken dashes); fq computes the normal, the two windings show both sides
        const [p0x, p0z] = P(ax, dz - 0.025), [p1x, p1z] = P(bx, dz - 0.025), [q0x, q0z] = P(ax, dz + 0.025), [q1x, q1z] = P(bx, dz + 0.025);
        if (fs > 0) mb.fq(p0x, ay - 0.035, p0z, p1x, by - 0.035, p1z, q1x, by, q1z, q0x, ay, q0z, M.PLAIN, c, 0);
        else mb.fq(p1x, by - 0.035, p1z, p0x, ay - 0.035, p0z, q0x, ay, q0z, q1x, by, q1z, M.PLAIN, c, 0);
      }
    }
  }
  mb.cast = cast;
}

export function lamp(mb, x, z, a) {
  const cast = mb.cast; mb.cast = false;
  if (mb.lite) mb.cyl(x, 0, z, 0.14, 5.2, 0.14, 3, 0x3a3f4a, M.METAL, a, false);   // lite: a 3-sided post (6 tris, not 10)
  else mb.cbox(x, 0, z, 0.25, 5.2, 0.25, 0x3a3f4a, M.METAL, a);
  if (mb.lite) mb.cyl(x, 5.0, z, 0.45, 5.35, 0.45, 3, 0xfff1c1, M.LIGHT, a);   // lite: a 3-sided lantern (7 tris)
  else mb.cbox(x, 5.0, z, 0.7, 0.35, 0.7, 0xfff1c1, M.LIGHT, a);
  mb.cast = cast;
}

// Vertical kanban blade (round Q): both faces carry a tategaki glyph column from atlas row 6, the street edge is
// plain. axis 'z': the blade sticks out along z (faces look along x); 'x': it sticks out along x. fs = which way
// it sticks out (the outer edge). 4-6 tris, cheaper than the 10-tri box it replaces.
export function kanban(mb, cx, cz, y0, kh, t, dep, axis, fs, c, h) {
  const y1 = y0 + kh, n = Math.max(2, Math.round(kh / 0.95)), v1 = 16 - ((h >>> 3) & 3) / 4, v0 = v1 - n / 4;   // v: 4 glyphs per tile, quarter steps
  const k = h & 3, a = ((h >>> 2) & 3) === 0 ? 253 : 254;    // tile, and board style (253: pale board, coloured ink; 1 in 4)
  if (axis === 'z') {
    const za = cz - dep / 2, zb = cz + dep / 2;
    mb.q(cx + t / 2, y0, zb, cx + t / 2, y0, za, cx + t / 2, y1, za, cx + t / 2, y1, zb, 1, 0, 0, k, v0, k + 1, v1, M.LIGHT, c, a);
    mb.q(cx - t / 2, y0, za, cx - t / 2, y0, zb, cx - t / 2, y1, zb, cx - t / 2, y1, za, -1, 0, 0, k, v0, k + 1, v1, M.LIGHT, c, a);
    mb.wq(cx - t / 2, cx + t / 2, y0, y1, fs > 0 ? zb : za, fs, c, M.LIGHT, h & 255);
  } else {
    const xa = cx - dep / 2, xb = cx + dep / 2;
    mb.q(xa, y0, cz + t / 2, xb, y0, cz + t / 2, xb, y1, cz + t / 2, xa, y1, cz + t / 2, 0, 0, 1, k, v0, k + 1, v1, M.LIGHT, c, a);
    mb.q(xb, y0, cz - t / 2, xa, y0, cz - t / 2, xa, y1, cz - t / 2, xb, y1, cz - t / 2, 0, 0, -1, k, v0, k + 1, v1, M.LIGHT, c, a);
    mb.xq(fs > 0 ? xb : xa, cz - t / 2, cz + t / 2, y0, y1, fs, c, M.LIGHT, h & 255);
  }
}

// Billboard face with tategaki lettering (round Q): glyph columns about 1.5 m wide, 1 m glyphs (atlas row 6).
// plane 'z': z = c0, spanning x in [a0, a1]; plane 'x': x = c0, spanning z. 2 tris.
export function board(mb, plane, c0, a0, a1, y0, y1, fs, c, h) {
  const nc = Math.max(1, Math.round((a1 - a0) / 1.5)), ng = Math.max(1, Math.min(4, Math.round((y1 - y0) / 1.0)));
  const u0 = h & 3, u1 = u0 + nc, v1 = 16 - ((h >>> 3) & 3) / 4, v0 = v1 - ng / 4, a = 254;   // billboards: always a lit coloured board with light lettering (pale boards washed out)
  if (plane === 'z') {
    if (fs > 0) mb.q(a0, y0, c0, a1, y0, c0, a1, y1, c0, a0, y1, c0, 0, 0, 1, u0, v0, u1, v1, M.LIGHT, c, a);
    else mb.q(a1, y0, c0, a0, y0, c0, a0, y1, c0, a1, y1, c0, 0, 0, -1, u0, v0, u1, v1, M.LIGHT, c, a);
  } else {
    if (fs > 0) mb.q(c0, y0, a1, c0, y0, a0, c0, y1, a0, c0, y1, a1, 1, 0, 0, u0, v0, u1, v1, M.LIGHT, c, a);
    else mb.q(c0, y0, a0, c0, y0, a1, c0, y1, a1, c0, y1, a0, -1, 0, 0, u0, v0, u1, v1, M.LIGHT, c, a);
  }
}

// ---------- custom shapes ----------
export function shape(mb, name, x, y, z, s, c, a, lod) {
  c = clampSV(c, 0.32, 0.75);                    // ART.md: custom homes stay inside the palette (no candy)
  const sd = lod ? 6 : 10;
  const white = 0xfaf7f0;
  switch (name) {
    case 'mushroom':
      mb.cyl(x, y, z, 1.8 * s, y + 3.4 * s, 1.5 * s, sd, 0xf4ead2, M.WIN, a);
      mb.ell(x, y + 3.2 * s, z, 4.4 * s, 3.0 * s, 4.4 * s, sd, lod ? 2 : 4, c, M.PLAIN, a, true);
      if (!lod) for (let i = 0; i < 5; i++) {
        const t = i * 1.257 + 0.4;
        mb.ell(x + rcos(t) * 2.7 * s, y + 5.0 * s, z + rsin(t) * 2.7 * s, 0.6 * s, 0.5 * s, 0.6 * s, 5, 2, white, M.PLAIN, a);
      }
      break;
    case 'dome':
      mb.ell(x, y, z, 4.6 * s, 4.2 * s, 4.6 * s, sd, lod ? 2 : 5, c, M.PLAIN, a, true);
      mb.cyl(x, y + 4.0 * s, z, 0.6 * s, y + 5.2 * s, 0.1, 6, 0xffd34d, M.METAL, a, false);
      break;
    case 'castle': {
      c = clampSV(c, 0.25, 0.72);
      mb.cbox(x, y, z, 7 * s, 5 * s, 7 * s, c, M.WIN, a);
      for (let i = 0; i < 4; i++) {
        const tx = x + (i & 1 ? 3.5 : -3.5) * s, tz = z + (i & 2 ? 3.5 : -3.5) * s;
        mb.cyl(tx, y, tz, 1.4 * s, y + 7.5 * s, 1.4 * s, lod ? 5 : 8, shade(c, 0.9), M.WIN, a);
        mb.cyl(tx, y + 7.5 * s, tz, 1.8 * s, y + 10 * s, 0, lod ? 5 : 8, 0x7a3a32, M.PLAIN, a);   // muted cones (ART: no candy)
      }
      if (!lod) mb.cbox(x, y + 5 * s, z, 2 * s, 3 * s, 2 * s, shade(c, 1.1), M.WIN, a);
      break;
    }
    case 'pyramid':
      mb.pyramid(x, y, z, 9 * s, 9 * s, 7.5 * s, c, a);
      if (!lod) mb.pyramid(x, y + 6.2 * s, z, 1.6 * s, 1.6 * s, 1.3 * s, 0xffd34d, a);
      break;
    case 'ufo':
      for (let i = 0; i < 3 && !lod; i++) { const t = i * 2.094; mb.cbox(x + rcos(t) * 3 * s, y, z + rsin(t) * 3 * s, 0.3, 2.2 * s, 0.3, 0x9aa3b0, M.METAL, a); }
      mb.cyl(x, y + 2.0 * s, z, 1.5 * s, y + 3.0 * s, 5.5 * s, sd, shade(c, 0.85), M.METAL, a, false);
      mb.cyl(x, y + 3.0 * s, z, 5.5 * s, y + 3.8 * s, 2.5 * s, sd, c, M.METAL, a);
      mb.ell(x, y + 3.8 * s, z, 2.4 * s, 2.0 * s, 2.4 * s, sd, lod ? 2 : 3, 0x9ff6ff, M.LIGHT, a, true);
      break;
    case 'treehouse':
      mb.cyl(x, y, z, 1.0 * s, y + 9 * s, 0.7 * s, 6, TRUNK, M.PLAIN, a, false);
      mb.ell(x, y + 10 * s, z, 5 * s, 3.6 * s, 5 * s, lod ? 5 : 7, lod ? 2 : 3, LEAVES[a % 6], M.LEAF, a);
      mb.cbox(x + 1.2 * s, y + 5 * s, z, 4 * s, 3 * s, 4 * s, c, M.WIN, a);
      mb.gable(x - 0.8 * s - 0.3, z - 2 * s - 0.3, x + 3.2 * s + 0.3, z + 2 * s + 0.3, y + 8 * s, 1.6 * s, 0xd8563b, c, a, true);
      break;
    case 'lighthouse': {
      const n = lod ? 2 : 4, H = 14 * s;
      for (let i = 0; i < n; i++) {
        const y0 = y + (H * i) / n, y1 = y + (H * (i + 1)) / n;
        const r0 = 2.4 * s - (1.0 * s * i) / n, r1 = 2.4 * s - (1.0 * s * (i + 1)) / n;
        mb.cyl(x, y0, z, r0, y1, r1, sd, i & 1 ? white : c, M.PLAIN, a, i === n - 1);
      }
      mb.cyl(x, y + H, z, 1.1 * s, y + H + 1.6 * s, 1.1 * s, 6, 0xfff4b0, M.LIGHT, a);
      mb.cyl(x, y + H + 1.6 * s, z, 1.6 * s, y + H + 3 * s, 0, 6, c, M.PLAIN, a);
      break;
    }
    case 'igloo':
      mb.ell(x, y, z, 4.2 * s, 3.4 * s, 4.2 * s, sd, lod ? 2 : 4, 0xeef6ff, M.PLAIN, a, true);
      if (!lod) mb.cbox(x, y, z + 4 * s, 2 * s, 2 * s, 2.4 * s, 0xe4eef8, M.PLAIN, a);
      break;
    case 'rocket':
      mb.cyl(x, y + 1.5 * s, z, 1.8 * s, y + 11 * s, 1.8 * s, sd, white, M.WIN, a, false);
      mb.cyl(x, y + 11 * s, z, 1.8 * s, y + 15 * s, 0, sd, c, M.PLAIN, a);
      for (let i = 0; i < 3; i++) {
        const t = i * 2.094, cx = rcos(t), cz = rsin(t);
        mb.fq(x + cx * 1.6 * s, y, z + cz * 1.6 * s, x + cx * 3.6 * s, y, z + cz * 3.6 * s, x + cx * 1.8 * s, y + 5 * s, z + cz * 1.8 * s, x + cx * 1.7 * s, y + 5 * s, z + cz * 1.7 * s, M.PLAIN, c, a);
        mb.fq(x + cx * 3.6 * s, y, z + cz * 3.6 * s, x + cx * 1.6 * s, y, z + cz * 1.6 * s, x + cx * 1.7 * s, y + 5 * s, z + cz * 1.7 * s, x + cx * 1.8 * s, y + 5 * s, z + cz * 1.8 * s, M.PLAIN, c, a);
      }
      mb.cyl(x, y, z, 1.4 * s, y + 1.5 * s, 1.8 * s, sd, 0x50555e, M.METAL, a, false);
      break;
    default: // cube
      mb.cbox(x, y, z, 7 * s, 7 * s, 7 * s, c, M.WIN, a, shade(c, 0.8));
      if (!lod) mb.cbox(x, y + 7 * s, z, 3 * s, 1 * s, 3 * s, shade(c, 1.15), M.PLAIN, a);
  }
}

export function gardenItem(mb, item, x, z, h) {
  const a = h & 255;
  const c = ROOF[h % 8];
  switch (item) {
    case 'fountain': mb.cyl(x, 0, z, 1.4, 0.5, 1.4, 8, 0xd8d4cc, M.PLAIN, a, true, 0x6fd3f7); mb.cyl(x, 0.5, z, 0.2, 1.6, 0.15, 5, 0xd8d4cc, M.PLAIN, a); break;
    case 'pool': mb.box(x - 1.6, 0, z - 2.6, x + 1.6, 0.12, z + 2.6, 0xe8e4dc, 0x4fd0f0, M.PLAIN, a); break;
    case 'pond': mb.cyl(x, 0, z, 1.8, 0.06, 1.8, 8, 0x3a8fb0, M.WATER, a); break;
    case 'flowers':
      for (let i = 0; i < 4; i++) mb.cbox(x - 1.5 + i, 0, z, 0.8, 0.45, 0.8, [0xff5d8f, 0xffd23f, 0xb084f5, 0xff8a3d][(h + i) & 3], M.PLAIN, a);
      break;
    case 'tree': tree(mb, x, z, 0.9, h >>> 2, 0); break;
    case 'palm':
      mb.cyl(x, 0, z, 0.25, 5.5, 0.18, 5, 0x9a7a52, M.PLAIN, a, false);
      for (let i = 0; i < 5; i++) { const t = i * 1.2566; mb.fq(x, 5.6, z, x + rcos(t + 0.3) * 0.6, 5.6, z + rsin(t + 0.3) * 0.6, x + rcos(t) * 3, 4.6, z + rsin(t) * 3, x + rcos(t - 0.3) * 0.6, 5.6, z + rsin(t - 0.3) * 0.6, M.LEAF, 0x3fae49, a); }
      break;
    case 'car': mb.cbox(x, 0.25, z, 1.8, 0.8, 4.2, c, M.METAL, a); mb.cbox(x, 1.05, z + 0.2, 1.6, 0.6, 2.2, 0x2b3240, M.GLASS, a); break;
    case 'trampoline': mb.cyl(x, 0, z, 1.6, 0.9, 1.6, 8, 0x2a2a30, M.PLAIN, a, true, 0x1e1e24); break;
    case 'statue': mb.cbox(x, 0, z, 1, 1, 1, 0xdedbd2, M.PLAIN, a); mb.ell(x, 1.7, z, 0.5, 0.75, 0.5, 6, 2, 0xffc93c, M.METAL, a); break;
    case 'bench': mb.cbox(x, 0.4, z, 1.8, 0.12, 0.6, 0x9a6b43, M.PLAIN, a); mb.cbox(x, 0, z, 1.6, 0.4, 0.4, 0x50555e, M.PLAIN, a); break;
    case 'swing': mb.cbox(x - 1.2, 0, z, 0.15, 2.4, 0.15, 0xc2304f, M.PLAIN, a); mb.cbox(x + 1.2, 0, z, 0.15, 2.4, 0.15, 0xc2304f, M.PLAIN, a); mb.cbox(x, 2.4, z, 2.6, 0.15, 0.15, 0xc2304f, M.PLAIN, a); mb.cbox(x, 0.6, z, 0.7, 0.08, 0.4, 0xffd23f, M.PLAIN, a); break;
    case 'tent': mb.pyramid(x, 0, z, 2.6, 2.6, 2.2, c, a); break;
  }
}

export function door(mb, x, zw, fs, r, rc, a) {
  const cast = mb.cast; mb.cast = false;
  mb.wq(x - 0.6, x + 0.6, 0, 2.3, zw + fs * 0.04, fs, DOORS[(r.hash >>> 19) % 5], M.PLAIN, a);
  if (!mb.lite) {
    mb.wq(x - 0.85, x + 0.85, 0, 2.7, zw + fs * 0.02, fs, 0xf2eee6, M.PLAIN, a);
    mb.cbox(x, 0, zw + fs * 0.55, 1.8, 0.18, 1.0, 0xbdb8ae, M.PLAIN, a);
    mb.cbox(x + 0.95, 2.05, zw + fs * 0.1, 0.22, 0.3, 0.12, 0xffe2a8, M.LIGHT, a);
  }
  else mb.wq(x + 0.85, x + 1.05, 1.92, 2.28, zw + fs * 0.06, fs, 0xffe2a8, M.LIGHT, a);   // lite: the door lamp as one lit quad (lights the street at dusk)
  mb.cast = cast;
  if (mb.lite) return;
  if (hash3(r.hash, 7, 3) % 10 < 3) {            // porch: roof on two posts
    mb.cbox(x, 2.6, zw + fs * 0.8, 3.0, 0.14, 1.6, rc, M.PLAIN, a);
    mb.cbox(x - 1.35, 0, zw + fs * 1.45, 0.2, 2.6, 0.2, 0xf2eee6, M.PLAIN, a);
    mb.cbox(x + 1.35, 0, zw + fs * 1.45, 0.2, 2.6, 0.2, 0xf2eee6, M.PLAIN, a);
  } else if (r.hash & 32) mb.cbox(x, 2.6, zw + fs * 0.5, 2.0, 0.12, 1.0, rc, M.PLAIN, a);
}
// Rooftop clutter on a flat roof (round M): a stair hut in the wall colour with a door, an AC condenser,
// and on fuller meshes a water tank on a stand and a solar water heater. ~20 tris lite, ~60 full.
export function roofClutter(mb, x0, z0, x1, z1, top, wall, h, a) {
  const cast = mb.cast; mb.cast = false;
  const w = x1 - x0, d = z1 - z0, hx = (h & 1) ? x0 + 1.5 : x1 - 1.5, hz = (h & 2) ? z0 + 1.6 : z1 - 1.6;
  mb.box(hx - 1.1, top, hz - 1.2, hx + 1.1, top + 2.5, hz + 1.2, shade(wall, 0.92), 0x6e7378, M.PLAIN, a);   // stair hut
  if (!mb.lite) mb.wq(hx - 0.45, hx + 0.45, top + 0.05, top + 2.0, (h & 2) ? hz + 1.21 : hz - 1.21, (h & 2) ? 1 : -1, 0x5a5f66, M.METAL, a);
  if (mb.lite && (h & 224) === 224) {                   // lite, an eighth of the roofs: a water tank still breaks the flat roof (7 tris)
    const tx = (h & 1) ? x1 - 1.4 : x0 + 1.4, tz = z0 + d * 0.5;
    mb.cbox(tx, top, tz, 1.4, 1.8, 1.4, (h & 16) ? 0x9fb3c2 : 0xd9dcd6, M.METAL, a);   // squared to the roof (a 3-sided prism read as a tumbled die)
  }
  if (!mb.lite) {
    mb.cbox(x0 + w * 0.5, top, z0 + d * ((h & 4) ? 0.3 : 0.7), 0.9, 0.65, 0.4, 0xe9e9e6, M.METAL, a);       // AC condenser
    const tx = (h & 1) ? x1 - 1.4 : x0 + 1.4, tz = z0 + d * 0.5;
    for (const [lx, lz] of [[-0.5, -0.5], [0.5, 0.5]]) mb.cbox(tx + lx, top, tz + lz, 0.08, 0.9, 0.08, 0x5a5f66, M.METAL, a);
    mb.cyl(tx, top + 0.9, tz, 0.7, top + 2.1, 0.7, 6, 0x9fb3c2, M.METAL, a);                                // tank on a stand
    if (h & 8) mb.q(x0 + w * 0.3, top + 0.3, z0 + d * 0.62, x0 + w * 0.3 + 2, top + 0.3, z0 + d * 0.62, x0 + w * 0.3 + 2, top + 1.1, z0 + d * 0.62 - 0.9, x0 + w * 0.3, top + 1.1, z0 + d * 0.62 - 0.9, 0, 0.75, -0.66, 0, 0, 0, 0, M.GLASS, 0x2b3d5c, a);   // solar heater
  }
  mb.cast = cast;
}
