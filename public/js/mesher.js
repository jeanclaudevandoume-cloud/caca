// Mesh building. Vertex = 16 bytes:
//   0..5  int16 x,y,z  (metres * 64, relative to the mesh origin)
//   6     uint8 u      (metres along the wall * 8)
//   7     uint8 v      (floors * 4, so up to 63 floors)
//   8..10 int8 normal  (* 127)
//   11    uint8 material (low 3 bits) | 8 = tall (hands over to the skyline)
//   12..15 rgba8 colour, alpha = per-home random byte
// Index buffer: caster triangles first (count `ns`), then non-casters.
import {
  PITCH, FLOOR_H, K, hash3, mod, fdiv, kindAt, cellKind, zoneLevel, plotsIn, plotFrame, recipe, occupied,
  ROOF, CITY, avenueX, avenueZ, isRiver, portLane, bayHalf, regionOf, regionKey, lineIndex, CHUNK, REGION,
} from './town.js';

// Trig rounded to 1e-7 so every JS engine builds byte-identical geometry (positions are then
// quantised to 1/64 m, so an ulp of difference between engines can no longer flip a value).
const rcos = (a) => Math.round(Math.cos(a) * 1e7) / 1e7;
const rsin = (a) => Math.round(Math.sin(a) * 1e7) / 1e7;

export const M = { PLAIN: 0, WIN: 1, LEAF: 2, METAL: 3, LIGHT: 4, GLASS: 5, WATER: 6, ROOF: 7 };
const TALL = 8;

export class MB {
  constructor(ox, oz, cap = 4096) {
    this.ox = ox; this.oz = oz;
    this.alloc(cap);
    this.nv = 0;
    this.ic = new Uint32Array(cap * 2); this.nc = 0;
    this.io = new Uint32Array(cap); this.no = 0;
    this.cast = true; this.flag = 0; this.ymax = 0; this.sc = 64;
  }
  alloc(cap) {
    const nb = new ArrayBuffer(cap * 16);
    if (this.u8) new Uint8Array(nb).set(this.u8.subarray(0, this.nv * 16));
    this.cap = cap; this.buf = nb;
    this.i16 = new Int16Array(nb); this.u8 = new Uint8Array(nb); this.i8 = new Int8Array(nb);
  }
  v(x, y, z, u, v, nx, ny, nz, m, c, a) {
    if (this.nv >= this.cap) this.alloc(this.cap * 2);
    const n = this.nv, o = n * 8, b = n * 16;
    this.i16[o] = Math.round((x - this.ox) * this.sc);
    this.i16[o + 1] = Math.round(y * this.sc);
    this.i16[o + 2] = Math.round((z - this.oz) * this.sc);
    if (y > this.ymax) this.ymax = y;
    this.u8[b + 6] = Math.min(255, Math.max(0, Math.round(u * 8)));
    this.u8[b + 7] = Math.min(255, Math.max(0, Math.round(v * 4)));
    this.i8[b + 8] = Math.round(nx * 127); this.i8[b + 9] = Math.round(ny * 127); this.i8[b + 10] = Math.round(nz * 127);
    this.u8[b + 11] = m | this.flag;
    this.u8[b + 12] = (c >> 16) & 255; this.u8[b + 13] = (c >> 8) & 255; this.u8[b + 14] = c & 255; this.u8[b + 15] = a;
    return this.nv++;
  }
  tri(a, b, c) {
    if (this.cast) {
      if (this.nc + 3 > this.ic.length) { const t = new Uint32Array(this.ic.length * 2); t.set(this.ic); this.ic = t; }
      this.ic[this.nc++] = a; this.ic[this.nc++] = b; this.ic[this.nc++] = c;
    } else {
      if (this.no + 3 > this.io.length) { const t = new Uint32Array(this.io.length * 2); t.set(this.io); this.io = t; }
      this.io[this.no++] = a; this.io[this.no++] = b; this.io[this.no++] = c;
    }
  }
  // Quad p0..p3 counter-clockwise seen from outside (p0 bottom-left, p1 bottom-right, p2 top-right, p3 top-left).
  q(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, nx, ny, nz, u0, v0, u1, v1, m, c, a) {
    const i = this.v(x0, y0, z0, u0, v0, nx, ny, nz, m, c, a);
    this.v(x1, y1, z1, u1, v0, nx, ny, nz, m, c, a);
    this.v(x2, y2, z2, u1, v1, nx, ny, nz, m, c, a);
    this.v(x3, y3, z3, u0, v1, nx, ny, nz, m, c, a);
    this.tri(i, i + 1, i + 2); this.tri(i, i + 2, i + 3);
  }
  // Flat-shaded quad/triangle with computed normal.
  fq(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, m, c, a) {
    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0, bx = x3 - x0, by = y3 - y0, bz = z3 - z0;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    this.q(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, nx / l, ny / l, nz / l, 0, 0, 0, 0, m, c, a);
  }
  ft(x0, y0, z0, x1, y1, z1, x2, y2, z2, m, c, a) {
    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0, bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i = this.v(x0, y0, z0, 0, 0, nx, ny, nz, m, c, a);
    this.v(x1, y1, z1, 0, 0, nx, ny, nz, m, c, a);
    this.v(x2, y2, z2, 0, 0, nx, ny, nz, m, c, a);
    this.tri(i, i + 1, i + 2);
  }
  // Axis-aligned box without a bottom. Walls get window uv (u metres, v floors from vb).
  // Residential walls with baked shade: the 0.7 m under the eaves darkens to 60% (vertex colours),
  // so the shade under the roof works on every preset with zero shader cost.
  boxEave(x0, y0, z0, x1, y1, z1, c, top, m, a) {
    const ys = y1 - 0.7, cd = shade(c, 0.6);
    this.box(x0, y0, z0, x1, ys, z1, c, -1, m, a);
    const v0 = (ys - y0) / FLOOR_H, v1 = (y1 - y0) / FLOOR_H, sp = 2.6;
    const uw = Math.max(1, Math.round((x1 - x0) / sp)) * sp, ud = Math.max(1, Math.round((z1 - z0) / sp)) * sp;
    const g = (px0, pz0, px1, pz1, nx, nz, u1) => {
      const i = this.v(px0, ys, pz0, 0, v0, nx, 0, nz, m, c, a);
      this.v(px1, ys, pz1, u1, v0, nx, 0, nz, m, c, a);
      this.v(px1, y1, pz1, u1, v1, nx, 0, nz, m, cd, a);
      this.v(px0, y1, pz0, 0, v1, nx, 0, nz, m, cd, a);
      this.tri(i, i + 1, i + 2); this.tri(i, i + 2, i + 3);
    };
    g(x0, z1, x1, z1, 0, 1, uw); g(x1, z0, x0, z0, 0, -1, uw); g(x1, z1, x1, z0, 1, 0, ud); g(x0, z0, x0, z1, -1, 0, ud);
    if (top >= 0) this.q(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, top, a);
  }
  box(x0, y0, z0, x1, y1, z1, c, top, m, a, vb = 0) {
    const v0 = vb, v1 = vb + (y1 - y0) / FLOOR_H, w = x1 - x0, d = z1 - z0;
    // centre the window grid on each wall so no window is cut at a corner
    const sp = m === M.GLASS ? 1.7 : 2.6, win = m === M.WIN || m === M.GLASS;
    // every wall holds a whole number of window cells (stretched to fit), so no window wraps a corner
    const uw = win ? Math.max(1, Math.round(w / sp)) * sp : w, ud = win ? Math.max(1, Math.round(d / sp)) * sp : d;
    this.q(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, 0, v0, uw, v1, m, c, a);
    this.q(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, 0, v0, uw, v1, m, c, a);
    this.q(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, 0, v0, ud, v1, m, c, a);
    this.q(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, 0, v0, ud, v1, m, c, a);
    if (top >= 0) this.q(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, top, a);
  }
  // Vertical quad in the plane z = zc spanning [x0,x1]x[y0,y1], facing +z (fs > 0) or -z.
  wq(x0, x1, y0, y1, zc, fs, c, m, a) {
    if (fs > 0) this.q(x0, y0, zc, x1, y0, zc, x1, y1, zc, x0, y1, zc, 0, 0, 1, 0, 0, 0, 0, m, c, a);
    else this.q(x1, y0, zc, x0, y0, zc, x0, y1, zc, x1, y1, zc, 0, 0, -1, 0, 0, 0, 0, m, c, a);
  }
  // Vertical quad in the plane x = xc spanning [z0,z1]x[y0,y1], facing +x (fs > 0) or -x.
  xq(xc, z0, z1, y0, y1, fs, c, m, a) {
    if (fs > 0) this.q(xc, y0, z1, xc, y0, z0, xc, y1, z0, xc, y1, z1, 1, 0, 0, 0, 0, 0, 0, m, c, a);
    else this.q(xc, y0, z0, xc, y0, z1, xc, y1, z1, xc, y1, z0, -1, 0, 0, 0, 0, 0, 0, m, c, a);
  }
  // Box centred at x,z.
  cbox(x, y0, z, w, h, d, c, m = M.PLAIN, a = 0, top = c) {
    this.box(x - w / 2, y0, z - d / 2, x + w / 2, y0 + h, z + d / 2, c, top, m, a);
  }
  // Truncated cone / cylinder, smooth sides. r1 = 0 makes a cone.
  cyl(x, y0, z, r0, y1, r1, sides, c, m = M.PLAIN, a = 0, cap = true, capC = c) {
    const slope = (r0 - r1) / (y1 - y0 || 1);
    const ny = slope / Math.hypot(1, slope), nh = 1 / Math.hypot(1, slope);
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2, t1 = ((i + 1) / sides) * Math.PI * 2, tm = (t0 + t1) / 2;
      const c0 = rcos(t0), s0 = rsin(t0), c1 = rcos(t1), s1 = rsin(t1);
      const nx = rcos(tm) * nh, nz = rsin(tm) * nh;
      const u = r0 * (t1 - t0);
      if (r1 > 0.001) {
        this.q(x + c1 * r0, y0, z + s1 * r0, x + c0 * r0, y0, z + s0 * r0, x + c0 * r1, y1, z + s0 * r1, x + c1 * r1, y1, z + s1 * r1,
          nx, ny, nz, 0, 0, u, (y1 - y0) / FLOOR_H, m, c, a);
      } else {
        const i0 = this.v(x + c1 * r0, y0, z + s1 * r0, 0, 0, nx, ny, nz, m, c, a);
        this.v(x + c0 * r0, y0, z + s0 * r0, 0, 0, nx, ny, nz, m, c, a);
        this.v(x, y1, z, 0, 0, nx, ny, nz, m, c, a);
        this.tri(i0, i0 + 1, i0 + 2);
      }
    }
    if (cap && r1 > 0.001) {
      const ic = this.v(x, y1, z, 0, 0, 0, 1, 0, M.PLAIN, capC, a);
      for (let i = 0; i <= sides; i++) {
        const t = (i / sides) * Math.PI * 2;
        this.v(x + rcos(t) * r1, y1, z + rsin(t) * r1, 0, 0, 0, 1, 0, M.PLAIN, capC, a);
      }
      for (let i = 0; i < sides; i++) this.tri(ic, ic + 2 + i, ic + 1 + i);
    }
  }
  // Ellipsoid (or upper half). Smooth normals.
  ell(x, y, z, rx, ry, rz, sides, rings, c, m = M.PLAIN, a = 0, half = false, under = 1) {
    const base = this.nv;
    const r0 = half ? rings : 0, rows = half ? rings : rings * 2;
    for (let j = 0; j <= rows; j++) {
      const phi = ((j + (half ? rings : 0)) / (rings * 2)) * Math.PI;   // 0 = bottom pole
      const sy = -rcos(phi), sr = rsin(phi);
      for (let i = 0; i <= sides; i++) {
        const t = (i / sides) * Math.PI * 2;
        const nx = rcos(t) * sr, nz = rsin(t) * sr;
        this.v(x + nx * rx, y + sy * ry, z + nz * rz, 0, 0, nx, sy, nz, m, under < 1 ? shade(c, under + (1 - under) * Math.min(1, (sy + 1) * 0.8)) : c, a);
      }
    }
    void r0;
    const W = sides + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < sides; i++) {
      const p = base + j * W + i;
      this.tri(p, p + W + 1, p + 1); this.tri(p, p + W, p + W + 1);
    }
  }
  pyramid(x, y0, z, w, d, h, c, a = 0) {
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y0 + h;
    this.ft(x0, y0, z1, x1, y0, z1, x, y1, z, M.PLAIN, c, a);
    this.ft(x1, y0, z0, x0, y0, z0, x, y1, z, M.PLAIN, c, a);
    this.ft(x1, y0, z1, x1, y0, z0, x, y1, z, M.PLAIN, c, a);
    this.ft(x0, y0, z0, x0, y0, z1, x, y1, z, M.PLAIN, c, a);
  }
  // Gable roof over [x0,x1]x[z0,z1] with ridge along x (alongX) or z.
  // Gable roof over [x0,x1]x[z0,z1], ridge along x (alongX) or z. trim adds fascia boards and a ridge cap.
  gable(x0, z0, x1, z1, y, h, c, wallC, a, alongX, trim = false, fc = 0xf2eee6) {
    const R = M.ROOF;
    if (alongX) {
      const zm = (z0 + z1) / 2;
      this.fq(x0, y, z1, x1, y, z1, x1, y + h, zm, x0, y + h, zm, R, c, a);
      this.fq(x1, y, z0, x0, y, z0, x0, y + h, zm, x1, y + h, zm, R, c, a);
      this.ft(x1, y, z1, x1, y, z0, x1, y + h, zm, M.PLAIN, wallC, a);
      this.ft(x0, y, z0, x0, y, z1, x0, y + h, zm, M.PLAIN, wallC, a);
      if (trim) {
        this.wq(x0, x1, y - 0.22, y, z1, 1, fc, M.PLAIN, a);
        this.wq(x0, x1, y - 0.22, y, z0, -1, fc, M.PLAIN, a);
        if (!LITE) this.box(x0 - 0.05, y + h - 0.12, zm - 0.18, x1 + 0.05, y + h + 0.1, zm + 0.18, shade(c, 0.75), shade(c, 0.75), M.PLAIN, a);
      }
    } else {
      const xm = (x0 + x1) / 2;
      this.fq(x1, y, z1, x1, y, z0, xm, y + h, z0, xm, y + h, z1, R, c, a);
      this.fq(x0, y, z0, x0, y, z1, xm, y + h, z1, xm, y + h, z0, R, c, a);
      this.ft(x0, y, z1, x1, y, z1, xm, y + h, z1, M.PLAIN, wallC, a);
      this.ft(x1, y, z0, x0, y, z0, xm, y + h, z0, M.PLAIN, wallC, a);
      if (trim) {
        this.q(x1, y - 0.22, z1, x1, y - 0.22, z0, x1, y, z0, x1, y, z1, 1, 0, 0, 0, 0, 0, 0, M.PLAIN, fc, a);
        this.q(x0, y - 0.22, z0, x0, y - 0.22, z1, x0, y, z1, x0, y, z0, -1, 0, 0, 0, 0, 0, 0, M.PLAIN, fc, a);
        if (!LITE) this.box(xm - 0.18, y + h - 0.12, z0 - 0.05, xm + 0.18, y + h + 0.1, z1 + 0.05, shade(c, 0.75), shade(c, 0.75), M.PLAIN, a);
      }
    }
  }
  hip(x0, z0, x1, z1, y, h, c, a) {
    const w = x1 - x0, d = z1 - z0;
    if (w >= d) {
      const i = d / 2, zm = (z0 + z1) / 2;
      this.fq(x0, y, z1, x1, y, z1, x1 - i, y + h, zm, x0 + i, y + h, zm, M.ROOF, c, a);
      this.fq(x1, y, z0, x0, y, z0, x0 + i, y + h, zm, x1 - i, y + h, zm, M.ROOF, c, a);
      this.ft(x1, y, z1, x1, y, z0, x1 - i, y + h, zm, M.ROOF, c, a);
      this.ft(x0, y, z0, x0, y, z1, x0 + i, y + h, zm, M.ROOF, c, a);
    } else {
      const i = w / 2, xm = (x0 + x1) / 2;
      this.fq(x1, y, z1, x1, y, z0, xm, y + h, z0 + i, xm, y + h, z1 - i, M.ROOF, c, a);
      this.fq(x0, y, z0, x0, y, z1, xm, y + h, z1 - i, xm, y + h, z0 + i, M.ROOF, c, a);
      this.ft(x0, y, z1, x1, y, z1, xm, y + h, z1 - i, M.ROOF, c, a);
      this.ft(x1, y, z0, x0, y, z0, xm, y + h, z0 + i, M.ROOF, c, a);
    }
  }
  finish() {
    const ib = this.nv <= 65535 ? new Uint16Array(this.nc + this.no) : new Uint32Array(this.nc + this.no);
    ib.set(this.ic.subarray(0, this.nc)); ib.set(this.io.subarray(0, this.no), this.nc);
    return { vb: this.buf.slice(0, this.nv * 16), ib, ns: this.nc, nv: this.nv, ymax: this.ymax };
  }
}

// ---------- small helpers ----------
const shade = (c, f) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f)), g = Math.min(255, Math.round(((c >> 8) & 255) * f)), b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};
const LEAVES = [0x3e7d3a, 0x4f8f3f, 0x2f6b3c, 0x5f9a45, 0x6d8f3a, 0x467f43];
const BLOSSOM = [0xf2a7c3, 0xe98fb4, 0xf7c1d5];
const TRUNK = 0x7a5233;

let LITE = false;     // low-quality chunks: cheaper trees and fewer props
export function tree(mb, x, z, s, h, lod) {
  const cast = mb.cast;
  if (cast && lod) mb.cast = false;                 // far trees don't cast at all
  else if (cast && !LITE) {
    // cheap shadow stand-in (hidden inside the crown); the detailed crown below does not cast
    mb.ell(x, 3.6 * s, z, 1.8 * s, 1.6 * s, 1.8 * s, 4, 1, 0x3e6d3a, M.LEAF, 0);
    mb.cast = false;
  }
  treeBody(mb, x, z, s, h, lod);
  mb.cast = cast;
}
function treeBody(mb, x, z, s, h, lod) {
  const kind = h % 7;
  if (LITE) {
    const c = kind === 6 ? BLOSSOM[(h >>> 3) % 3] : LEAVES[(h >>> 3) % LEAVES.length];
    mb.cyl(x, 0, z, 0.25 * s, 1.6 * s, 0.25 * s, 3, TRUNK, M.PLAIN, h & 255, false);
    if (kind < 2) mb.cyl(x, 1.0 * s, z, 2.2 * s, 6 * s, 0, 4, shade(c, 0.85), M.LEAF, h & 255);
    else mb.ell(x, 3.6 * s, z, 2.3 * s, 2.0 * s, 2.3 * s, 4, 1, c, M.LEAF, h & 255);
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

function lamp(mb, x, z, a) {
  const cast = mb.cast; mb.cast = false;
  mb.cbox(x, 0, z, 0.25, 5.2, 0.25, 0x3a3f4a, M.METAL, a);
  mb.cbox(x, 5.0, z, 0.7, 0.35, 0.7, 0xfff1c1, M.LIGHT, a);
  mb.cast = cast;
}

// ---------- custom shapes ----------
export function shape(mb, name, x, y, z, s, c, a, lod) {
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
      mb.cbox(x, y, z, 7 * s, 5 * s, 7 * s, c, M.WIN, a);
      for (let i = 0; i < 4; i++) {
        const tx = x + (i & 1 ? 3.5 : -3.5) * s, tz = z + (i & 2 ? 3.5 : -3.5) * s;
        mb.cyl(tx, y, tz, 1.4 * s, y + 7.5 * s, 1.4 * s, lod ? 5 : 8, shade(c, 0.9), M.WIN, a);
        mb.cyl(tx, y + 7.5 * s, tz, 1.8 * s, y + 10 * s, 0, lod ? 5 : 8, 0xc2304f, M.PLAIN, a);
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

function gardenItem(mb, item, x, z, h) {
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

// ---------- homes ----------
const DOORS = [0x2f4d7a, 0x7e2d2d, 0x2e5a45, 0x2b2b2b, 0xd9a441];
// Front door: frame, inset door, step, optional canopy and a porch light.
function door(mb, x, zw, fs, r, rc, a) {
  const cast = mb.cast; mb.cast = false;
  mb.wq(x - 0.6, x + 0.6, 0, 2.3, zw + fs * 0.04, fs, DOORS[(r.hash >>> 19) % 5], M.PLAIN, a);
  if (!LITE) {
    mb.wq(x - 0.85, x + 0.85, 0, 2.7, zw + fs * 0.02, fs, 0xf2eee6, M.PLAIN, a);
    mb.cbox(x, 0, zw + fs * 0.55, 1.8, 0.18, 1.0, 0xbdb8ae, M.PLAIN, a);
    mb.cbox(x + 0.95, 2.05, zw + fs * 0.1, 0.22, 0.3, 0.12, 0xffe2a8, M.LIGHT, a);
  }
  mb.cast = cast;
  if (LITE) return;
  if (hash3(r.hash, 7, 3) % 10 < 3) {            // porch: roof on two posts
    mb.cbox(x, 2.6, zw + fs * 0.8, 3.0, 0.14, 1.6, rc, M.PLAIN, a);
    mb.cbox(x - 1.35, 0, zw + fs * 1.45, 0.2, 2.6, 0.2, 0xf2eee6, M.PLAIN, a);
    mb.cbox(x + 1.35, 0, zw + fs * 1.45, 0.2, 2.6, 0.2, 0xf2eee6, M.PLAIN, a);
  } else if (r.hash & 32) mb.cbox(x, 2.6, zw + fs * 0.5, 2.0, 0.12, 1.0, rc, M.PLAIN, a);
}
const F = {};
export function home(mb, bx, bz, f, r, lod) {
  const a = r.hash & 255;
  const front = f.face < 0 ? f.z - f.d / 2 : f.z + f.d / 2;        // street edge of the plot
  mb.flag = r.height >= 6 * FLOOR_H ? TALL : 0;
  if (lod && r.zone <= 1) mb.cast = false;         // far low homes don't cast: the ground shader's contact AO grounds them
  const wa = (a & 0xfc) | r.style;                  // wall alpha: seed in the high bits, wall style in the low 2
  if (r.zone === 0) {
    const setback = 3, fs = f.face < 0 ? -1 : 1;
    const z0 = f.face < 0 ? front + setback : front - setback - r.d, z1 = z0 + r.d;
    const doorX = f.x + (r.hash & 8 ? 1.5 : -1.5), wallZ = f.face < 0 ? z0 : z1;
    // massing: ~55% of homes get a one-storey side wing (garage) opposite the door
    const hw = hash3(r.hash, 5, 9);
    const wing = !r.shape && r.roofType !== 2 && hw % 20 < 11;
    const ww = 3.5 + ((hw >>> 5) % 3) * 0.5, side = r.hash & 8 ? -1 : 1;     // wing on the side away from the door
    const mainW = wing ? Math.max(5.5, Math.min(r.w, 9.4 - ww)) : r.w;
    const x0 = wing ? (side < 0 ? f.x - 4.7 + ww : f.x + 4.7 - ww - mainW) : f.x - r.w / 2;
    const x1 = x0 + mainW;
    const backZ = f.face < 0 ? f.z + f.d / 2 - 3 : f.z - f.d / 2 + 3;
    if (r.shape) {
      shape(mb, r.shape, f.x, 0, (z0 + z1) / 2, 0.95, r.color, a & 0xfc, lod);
    } else {
      const top = r.floors * FLOOR_H;
      const rc = ROOF[r.roof];
      if (lod) mb.box(x0, 0, z0, x1, top, z1, r.wall, r.roofType === 2 ? 0x8c8f93 : -1, M.WIN, wa);
      else {
        mb.boxEave(x0, 0, z0, x1, top, z1, r.wall, r.roofType === 2 ? 0x8c8f93 : -1, M.WIN, wa);
        mb.cast = false;                            // light corner boards
        const cb = 0xeeeae2;
        // corner boards: only the two outward faces of each corner (4 tris per corner); not on lite (phone budget)
        if (!LITE) for (const [cx, cz, sx, sz] of [[x0, z0, -1, -1], [x1, z0, 1, -1], [x0, z1, -1, 1], [x1, z1, 1, 1]]) {
          mb.wq(Math.min(cx, cx - sx * 0.22), Math.max(cx, cx - sx * 0.22), 0.45, top, cz + sz * 0.03, sz, cb, M.PLAIN, a);
          mb.xq(cx + sx * 0.03, Math.min(cz, cz - sz * 0.22), Math.max(cz, cz - sz * 0.22), 0.45, top, sx, cb, M.PLAIN, a);
        }
        mb.cast = true;
      }
      if (!lod && !LITE) {                          // plinth: a darker base 8 cm proud of the wall (lite: the shader's plinth band)
        const pc = shade(r.wall, 0.7);
        mb.box(x0 - 0.08, 0, z0 - 0.08, x1 + 0.08, 0.5, z1 + 0.08, pc, -1, M.PLAIN, a);
      }
      const o = lod ? 0.4 : 0.9;
      if (r.roofType <= 1 && !lod && !LITE) {       // dark soffit under the deep eaves: a shadow line under the roof
        mb.cast = false;
        mb.q(x0 - o, top - 0.01, z0 - o, x1 + o, top - 0.01, z0 - o, x1 + o, top - 0.01, z1 + o, x0 - o, top - 0.01, z1 + o, 0, -1, 0, 0, 0, 0, 0, M.PLAIN, shade(r.wall, 0.75), a);
        mb.cast = true;
      }
      if (r.roofType === 0) mb.gable(x0 - o, z0 - o, x1 + o, z1 + o, top, 2.6, rc, r.wall, a, mainW > r.d, !lod, shade(rc, 0.6));
      else if (r.roofType === 1) mb.hip(x0 - o, z0 - o, x1 + o, z1 + o, top, 2.4, rc, a);
      else if (!lod) {                               // flat roof: parapet around a grey membrane
        const pc = shade(r.wall, 0.8), cap = 0xd9d3c7;      // parapet sides darker than the wall, light coping on top
        mb.box(x0, top, z0, x1, top + 0.4, z0 + 0.25, pc, cap, M.PLAIN, a);
        mb.box(x0, top, z1 - 0.25, x1, top + 0.4, z1, pc, cap, M.PLAIN, a);
        mb.box(x0, top, z0 + 0.25, x0 + 0.25, top + 0.4, z1 - 0.25, pc, cap, M.PLAIN, a);
        mb.box(x1 - 0.25, top, z0 + 0.25, x1, top + 0.4, z1 - 0.25, pc, cap, M.PLAIN, a);
      }
      if (wing) {                                    // side wing at every LOD (same massing, no pop)
        const wx0 = side < 0 ? f.x - 4.7 : x1, wx1 = side < 0 ? x0 : f.x + 4.7;
        const wz0 = f.face < 0 ? z0 + 1 : z1 - 6, wz1 = wz0 + 5, wf = f.face < 0 ? wz0 : wz1;
        if (lod) mb.box(wx0, 0, wz0, wx1, 3.0, wz1, r.wall, shade(rc, 0.9), M.PLAIN, wa);
        else {
          mb.box(wx0, 0, wz0, wx1, 3.0, wz1, r.wall, -1, M.PLAIN, wa);
          mb.gable(wx0 - 0.3, wz0 - 0.4, wx1 + 0.3, wz1 + 0.4, 3.0, 1.4, shade(rc, 0.9), r.wall, a, false, false);
          mb.wq(wx0 + 0.5, wx1 - 0.5, 0, 2.3, wf + fs * 0.02, fs, 0xd8d4cc, M.PLAIN, a);   // garage door
        }
      }
      if (!lod) {
        door(mb, doorX, wallZ, fs, r, rc, a);
        if (r.roofType === 0 && (r.hash & 64)) mb.cbox(x0 + 1.2, top + 0.5, (z0 + z1) / 2 + 1, 0.8, 2.6, 0.8, 0x8e5a48, M.PLAIN, a);
      }
    }
    if (!lod) {
      const sg = r.hash & 1 ? 1 : -1;
      const spots = r.tree ? [-3 * sg, 0] : [-3 * sg, 0, 3 * sg];
      if (r.tree && !LITE) tree(mb, f.x + 3 * sg, backZ, 0.8 + ((r.hash >>> 23) % 4) * 0.12, r.hash >>> 9, 0);
      for (let i = 0; i < r.garden.length && i < spots.length; i++) gardenItem(mb, r.garden[i], f.x + spots[i], backZ, r.hash >>> (i * 3));
      if (!LITE) {
        // low block garden wall with gate posts at the path (hedge on some lots)
        mb.cast = false;
        const hz0 = front - fs * 0.35 - 0.15, hz1 = hz0 + 0.3, hedge = (r.hash >>> 24) % 3 === 0;
        const wc = hedge ? 0x3f6a3a : 0xbdb6a8, wt = hedge ? 0x4a7a43 : 0xd2ccc0, wm = hedge ? M.LEAF : M.PLAIN, wh = hedge ? 1.0 : 1.2;
        mb.box(f.x - 4.7, 0, hz0, doorX - 0.75, wh, hz1, wc, wt, wm, a);
        mb.box(doorX + 0.75, 0, hz0, f.x + 4.7, wh, hz1, wc, wt, wm, a);
        if (!hedge) { mb.cbox(doorX - 0.75, 0, (hz0 + hz1) / 2, 0.4, 1.45, 0.4, 0xa79f90, M.PLAIN, a); mb.cbox(doorX + 0.75, 0, (hz0 + hz1) / 2, 0.4, 1.45, 0.4, 0xa79f90, M.PLAIN, a); }
        mb.cast = true;
      }
    }
  } else if (r.zone === 1) {
    const setback = 1.5, fs = f.face < 0 ? -1 : 1;
    const z0 = f.face < 0 ? front + setback : front - setback - r.d, z1 = z0 + r.d;
    const x0 = f.x - r.w / 2, x1 = f.x + r.w / 2, wallZ = f.face < 0 ? z0 : z1;
    if (r.shape) {
      shape(mb, r.shape, f.x, 0, (z0 + z1) / 2, 0.95, r.color, a & 0xfc, lod);
    } else {
      const top = r.floors * FLOOR_H;
      const rc = ROOF[r.roof];
      if (lod) mb.box(x0, 0, z0, x1, top, z1, r.wall, r.roofType === 2 ? 0x9a9c9e : -1, M.WIN, wa);
      else mb.boxEave(x0, 0, z0, x1, top, z1, r.wall, r.roofType === 2 ? 0x9a9c9e : -1, M.WIN, wa);
      if (r.roofType === 0) mb.gable(x0 - 0.2, z0 - 0.4, x1 + 0.2, z1 + 0.4, top, 2.2, rc, r.wall, a, false, !lod);
      else {
        // cornice: a light band that overhangs the street wall
        const cc = r.style === 2 ? 0xe6dccb : shade(r.wall, 0.86);
        mb.box(x0, top, z0 - (f.face < 0 ? 0.3 : 0), x1, top + 0.4, z1 + (f.face < 0 ? 0 : 0.3), cc, 0x6f6a64, M.PLAIN, a);
        if (!lod) {
          mb.box(x0, top + 0.4, z0, x0 + 0.25, top + 0.9, z1, shade(cc, 0.85), 0xd9d3c7, M.PLAIN, a);
          mb.box(x1 - 0.25, top + 0.4, z0, x1, top + 0.9, z1, shade(cc, 0.85), 0xd9d3c7, M.PLAIN, a);
          if (!LITE) {
            const hz = f.face < 0 ? z1 - 3 : z0 + 3;
            if (r.hash & 128) mb.cbox(f.x + (r.hash & 64 ? 2 : -2), top + 0.4, hz, 2.4, 2.6, 2.4, shade(r.wall, 0.92), M.PLAIN, a, 0x6f6a64);
            else mb.cyl(f.x + (r.hash & 64 ? 2 : -2), top + 0.4, hz, 1.1, top + 2.8, 1.1, 6, 0x8a6a4a, M.PLAIN, a);
          }
        }
      }
      if (!lod) {
        door(mb, f.x + (r.hash & 8 ? 2.2 : -2.2), wallZ, fs, r, rc, a);
        if (r.hash & 16) {                          // balcony
          mb.cast = false;
          mb.box(f.x - 2, FLOOR_H + 0.9, f.face < 0 ? z0 - 1.0 : z1, f.x + 2, FLOOR_H + 1.05, f.face < 0 ? z0 : z1 + 1.0, 0xe8e6e0, 0xe8e6e0, M.PLAIN, a);
          mb.box(f.x - 2, FLOOR_H + 1.05, f.face < 0 ? z0 - 1.0 : z1 + 0.94, f.x + 2, FLOOR_H + 1.95, f.face < 0 ? z0 - 0.94 : z1 + 1.0, 0x3a3e45, 0x3a3e45, M.METAL, a);
          mb.cast = true;
        }
      }
    }
    if (!lod && r.tree) tree(mb, f.x, f.face < 0 ? z0 + r.d + 2.5 : z0 - 2.5, 0.75, r.hash >>> 9, 0);
  } else {
    const tower = r.zone === 3;
    const aw = (a & 0xfc) | (tower ? 0 : 3);          // wall style 3 = concrete panels (never siding/brick)
    const w = r.w, d = tower ? r.d : r.d;
    const x0 = f.x - w / 2, x1 = f.x + w / 2, z0 = f.z - d / 2, z1 = f.z + d / 2;
    const top = r.floors * FLOOR_H;
    const roofC = [0x8d9199, 0x6f747d, 0xa9a39a, 0x7f8a86][(r.hash >>> 21) & 3];
    let base = 0;
    const fz = f.face < 0 ? z0 : z1, fs = f.face < 0 ? -1 : 1;     // street-facing wall
    const sign = ACCENT_SIGN[(r.hash >>> 13) % ACCENT_SIGN.length];
    if (tower) {
      const pod = CITY[(r.hash >>> 5) % CITY.length];
      mb.box(f.x - 4.8, 0, f.z - 9.4, f.x + 4.8, 2 * FLOOR_H, f.z + 9.4, pod, shade(pod, 0.85), M.WIN, a & 0xfc);
      base = 2 * FLOOR_H;
      if (!lod && !LITE) {                      // lobby glass and a lit sign over the entrance
        mb.cast = false;
        const pz = f.face < 0 ? f.z - 9.4 : f.z + 9.4;
        mb.cbox(f.x, 0, pz + fs * 0.05, 7, 3.4, 0.3, 0x9fc4dd, M.GLASS, a);
        mb.cbox(f.x, 4.2, pz + fs * 0.25, 5, 0.9, 0.3, sign, M.LIGHT, a);
        mb.cast = true;
      }
    } else if (!lod) {
      // shopfront: glass ground floor, a coloured awning fixed to the wall and a lit sign
      mb.cast = false;
      mb.cbox(f.x, 0, fz + fs * 0.06, w - 1.2, 2.8, 0.25, shade(0x9fc4dd, 0.9 + ((r.hash >>> 3) & 3) * 0.05), M.GLASS, a);
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
      if ((r.hash >>> 17) % 3) mb.cbox(f.x, 3.3, fz + fs * 0.15, Math.min(5, w - 2), 0.8, 0.25, sign, M.LIGHT, a);
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
    if (!lod && !LITE && !r.top && crown !== 5) {
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
      // Tokyo-style street face: a vertical lit sign, balconies and air-conditioner boxes
      mb.cast = false;
      if (r.hash & 2) {                          // stacked projecting signs over floors 2-5
        const n = 1 + ((r.hash >>> 5) % 3);
        for (let i = 0; i < n; i++) mb.cbox(i & 1 ? x0 + 0.4 : x1 - 0.4, 4.2 + i * 4.0, fz + fs * 0.45, 0.25, 3.5, 0.6, ACCENT_SIGN[((r.hash >>> 9) + i * 3) % ACCENT_SIGN.length], M.LIGHT, a);
      }
      if (r.hash & 4 && !LITE) {
        const bz0 = f.face < 0 ? z0 - 1.0 : z1, bz1 = bz0 + 1.0;
        for (let fl = 2; fl < Math.min(r.floors, 6); fl++) mb.box(x0 + 1.2, fl * FLOOR_H - 0.1, bz0, x1 - 1.2, fl * FLOOR_H + 0.08, bz1, 0xe8e6e0, 0xe8e6e0, M.PLAIN, a);
      }
      if (!LITE) for (let i = 0; i < 2; i++) mb.cbox(i ? x1 - 1.4 : x0 + 1.4, FLOOR_H * (2 + i * 2) + 0.3, fz + fs * 0.25, 0.8, 0.6, 0.4, 0xd8d8d4, M.METAL, a);
      mb.cast = true;
    }
  }
  mb.flag = 0;
  mb.cast = true;
}

// ---------- chunk ----------
export function chunkOrigin(cx, cz) {
  return [(cx * CHUNK + 1.5) * PITCH, (cz * CHUNK + 1.5) * PITCH];
}

export function buildChunk(L, cx, cz, lod, customs, lite = false) {
  LITE = lite;
  const [ox, oz] = chunkOrigin(cx, cz);
  const mb = new MB(ox, oz, lod ? 2048 : 8192);
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
        if (!lod && !LITE && zone === 2) {
          // overhead wires spanning the street in front of mid-rise blocks (a Tokyo staple)
          // only where the block across the street is also mid-rise, so wires never end in mid-air
          const midN = cellKind(bx, bz - 1) === K.HOMES && zoneLevel(bx, bz - 1) === 2;
          const midW = cellKind(bx - 1, bz) === K.HOMES && zoneLevel(bx - 1, bz) === 2;
          for (const wx of [-12, 12]) {
            mb.cast = false;
            if (midN) mb.box(X + wx - 0.03, 7.5, Z - 28, X + wx + 0.03, 7.56, Z - 20, 0x1a1a1a, 0x1a1a1a, M.PLAIN, 0);
            if (midW) mb.box(X - 28, 7.2, Z + wx - 0.03, X - 20, 7.26, Z + wx + 0.03, 0x1a1a1a, 0x1a1a1a, M.PLAIN, 0);
            mb.cast = true;
          }
        }
        if (!lod && !LITE && zone <= 1) {
          for (let s = 0; s < occ; s++) {
            const hc = hash3(bx, bz, s + 300);
            if (hc % 3) continue;
            plotFrame(bx, bz, s, zone, f);
            const fs = f.face < 0 ? -1 : 1, cz = f.z + fs * (f.d / 2 + 1.3), cx = f.x + ((hc >>> 4) % 5 - 2) * 0.6;
            const cc = CARS[(hc >>> 8) % CARS.length];
            mb.cbox(cx, 0.25, cz, 4.2, 0.75, 1.8, cc, M.METAL, hc & 255);
            mb.cbox(cx - 0.3, 1.0, cz, 2.3, 0.6, 1.6, 0x2b3240, M.GLASS, hc & 255);
          }
        }
        if (!lod) {
          if (zone <= 1) {
            // street trees along the outer sidewalks
            for (let t = -16; t <= 16; t += 8) {
              const hh = hash3(bx * 8 + t, bz, 61);
              if (hh % 3 && (!LITE || t === 0)) { tree(mb, X + t, Z - 19, 0.6, hh, 0); }
              // (one side of the block only: the triangle budget goes to the houses)
            }
          }
          lamp(mb, X - 19.3, Z - 19.3, hb & 255);
          lamp(mb, X + 19.3, Z + 19.3, hb & 255);
        }
        break;
      }
      case K.PARK: {
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
          if (hb & 1) { mb.cbox(X + 10, 0, Z + 10, 6, 0.25, 6, 0xd8cbb0, M.PLAIN, 1); mb.cyl(X + 10, 0.25, Z + 10, 0.2, 2.8, 0.2, 4, 0xffffff); mb.pyramid(X + 10, 2.8, Z + 10, 6.6, 6.6, 2, 0xc2304f, 1); }
        }
        break;
      }
      case K.AVENUE: {
        const ax = avenueX(bx), az = avenueZ(bz);
        if (ax && az) { if (!lod) { lamp(mb, X - 19, Z - 19, 1); lamp(mb, X + 19, Z + 19, 1); } break; }
        const step = lod ? 13.3 : 6.66;
        for (let t = -20 + step / 2; t < 20; t += step) {
          const h = hash3(bx, bz, 300 + Math.round(t));
          if (ax) { tree(mb, X - 1.6, Z + t, 0.75, h, lod); if (!lod) tree(mb, X + 1.6, Z + t, 0.7, h >>> 5, lod); }
          else { tree(mb, X + t, Z - 1.6, 0.75, h, lod); if (!lod) tree(mb, X + t, Z + 1.6, 0.7, h >>> 5, lod); }
        }
        if (!lod) {
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
          mb.cbox(X + 8, 0, Z - 6, 7, 3.5, 10, 0xb3402f, M.PLAIN, hb & 255);
          mb.gable(X + 4.5, Z - 11, X + 11.5, Z - 1, 3.5, 2.5, 0x5a5f6a, 0xb3402f, hb & 255, false);
          if (!lod) mb.cyl(X - 2, 0, Z - 8, 1.8, 9, 1.8, 8, 0xd9d6cf, M.METAL, 0, true, 0x8d9199);
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
  mb.box(X - 14, 2.2, Z - 24, X + 14, 3.0, Z + 24, 0x8e8a82, 0x4a4e56, M.PLAIN, 3);          // deck
  for (const pz of [-12, 12]) mb.box(X - 12, -1, Z + pz - 1.2, X + 12, 2.2, Z + pz + 1.2, c, -1, M.PLAIN, 3);   // piers
  if (lod) return;
  mb.cast = false;
  mb.box(X - 14, 3.0, Z - 24, X - 11, 3.15, Z + 24, c, c, M.PLAIN, 3);                       // sidewalks
  mb.box(X + 11, 3.0, Z - 24, X + 14, 3.15, Z + 24, c, c, M.PLAIN, 3);
  mb.box(X - 14, 3.15, Z - 24, X - 13.85, 4.25, Z + 24, 0x8e8a82, 0xd9d3c7, M.PLAIN, 3);    // 1.1 m railings
  mb.box(X + 13.85, 3.15, Z - 24, X + 14, 4.25, Z + 24, 0x8e8a82, 0xd9d3c7, M.PLAIN, 3);
  for (let dz = -21; dz < 24; dz += 6) {                                                   // lane dashes
    mb.q(X - 0.08, 3.01, dz + Z + 3, X + 0.08, 3.01, dz + Z + 3, X + 0.08, 3.01, dz + Z, X - 0.08, 3.01, dz + Z, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, 0xe8dca0, 3);
  }
  for (const lz of [-18, -6, 6, 18]) for (const lx of [-13.3, 13.3]) {                     // lamps every 12 m
    mb.cbox(X + lx, 3.15, Z + lz, 0.2, 5.0, 0.2, 0x3a3f4a, M.METAL, 3);
    mb.cbox(X + lx - Math.sign(lx) * 0.5, 8.0, Z + lz, 1.0, 0.25, 0.4, 0xfff1c1, M.LIGHT, 3);
  }
  mb.cast = true;
}

function plaza(mb, X, Z, lod) {
  // the central beacon: a slender 220 m spire
  const a = 7;
  mb.flag = TALL;
  mb.box(X - 7, 0, Z - 7, X + 7, 12, Z + 7, 0xf2efe8, 0xcfd3da, M.WIN, a);
  mb.box(X - 4.5, 12, Z - 4.5, X + 4.5, 90, Z + 4.5, 0xe6e9ee, -1, M.GLASS, a, 12 / FLOOR_H);
  mb.box(X - 6, 90, Z - 6, X + 6, 98, Z + 6, 0x2a9d8f, 0xd0d4dc, M.GLASS, a, 90 / FLOOR_H);
  mb.cyl(X, 98, Z, 3.6, 180, 1.4, 8, 0xf2efe8, M.METAL, a, false);
  mb.cyl(X, 150, Z, 5.5, 156, 5.5, 12, 0x2a9d8f, M.GLASS, a);
  mb.cyl(X, 180, Z, 1.4, 216, 0.3, 6, 0xd0d4dc, M.METAL, a, false);
  mb.ell(X, 218, Z, 2.6, 2.6, 2.6, 8, 3, 0xffe28a, M.LIGHT, a);
  mb.cyl(X, 90.0, Z, 4.6, 91.2, 4.6, 12, 0xffe28a, M.LIGHT, a, false);
  mb.flag = 0;
  if (!lod) {
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2 + 0.39;
      tree(mb, X + rcos(t) * 15, Z + rsin(t) * 15, 0.9, i * 7 + 13, 0);
    }
    mb.cyl(X + 13, 0, Z - 13, 3, 0.7, 3, 12, 0xe8e4dc, M.PLAIN, 0, true, 0x6fd3f7);
  }
}

const CARS = [0xe8e8e8, 0x2b2b2b, 0x9aa3ad, 0x7e2d2d, 0x2f4d7a, 0xd9d4c8, 0x4f5a4a];
const ACCENT_SIGN = [0xff5d8f, 0x3ad6ff, 0xffd23f, 0x7dff9a, 0xff8a3d, 0xc58bff];
const BOX_COLS = [0xd8563b, 0x2a6fb5, 0xf0a030, 0x2a9d6f, 0x1fb5ad, 0xc2304f, 0x7b4b94, 0xe8e4dc];
function port(mb, L, bx, bz, X, Z, lod) {
  const lane = portLane(bx, bz);     // 0 quay with cranes (water to +z), 1 containers, 2 warehouses
  const hb = hash3(bx, bz, 81);
  if (lane === 2) {
    const c = (hb & 1) ? 0xe6e1d6 : 0xc9d2da;
    mb.box(X - 18, 0, Z - 16, X + 18, 9, Z + 16, c, -1, M.PLAIN, 0);
    for (let i = 0; i < 6; i++) {                     // sawtooth roof
      const z0 = Z - 16 + i * (32 / 6), z1 = z0 + 32 / 6;
      mb.fq(X + 18, 9, z0, X - 18, 9, z0, X - 18, 12, z1, X + 18, 12, z1, M.PLAIN, 0x8d9aa8, 0);
      mb.q(X - 18, 9, z1, X + 18, 9, z1, X + 18, 12, z1, X - 18, 12, z1, 0, 0, 1, 0, 0, 0, 0, M.GLASS, 0x9fc4dd, 0);
      mb.ft(X - 18, 9, z0, X - 18, 9, z1, X - 18, 12, z1, M.PLAIN, c, 0);
      mb.ft(X + 18, 9, z1, X + 18, 9, z0, X + 18, 12, z1, M.PLAIN, c, 0);
    }
    if (!lod) for (let i = 0; i < 4; i++) mb.cbox(X - 12 + i * 8, 0, Z + 19, 6, 2.6, 2.4, BOX_COLS[(hb >>> i) & 7], M.METAL, 0);
  } else if (lane === 1) {
    const step = lod ? 2 : 1;
    for (let r = 0; r < 6; r += step) for (let c = 0; c < 3; c++) {
      const h = hash3(bx * 7 + r, bz * 5 + c, 82);
      const n = 1 + (h % 4);
      const cx = X - 14 + c * 14, cz = Z - 17 + r * 6.8;
      for (let s = 0; s < n; s++) {
        const col = BOX_COLS[(h >>> (s * 3 + 4)) & 7];
        mb.box(cx - 6, s * 2.6, cz - 1.25, cx + 6, s * 2.6 + 2.6, cz + 1.25 + (step - 1) * 6.8, col, s === n - 1 ? shade(col, 0.9) : -1, M.METAL, 0);
      }
    }
  } else {
    // quay: two gantry cranes per block, booms reaching out over the moored ships
    for (const ox of [-10, 10]) {
      const cx = X + ox, c = 0xe2492e;
      mb.box(cx - 6, 0, Z + 6, cx - 4.8, 30, Z + 7.2, c, c, M.METAL, 0);
      mb.box(cx + 4.8, 0, Z + 6, cx + 6, 30, Z + 7.2, c, c, M.METAL, 0);
      mb.box(cx - 6, 0, Z + 20.8, cx - 4.8, 30, Z + 22, c, c, M.METAL, 0);
      mb.box(cx + 4.8, 0, Z + 20.8, cx + 6, 30, Z + 22, c, c, M.METAL, 0);
      mb.box(cx - 6, 30, Z + 6, cx + 6, 32, Z + 22, c, c, M.METAL, 0);
      mb.box(cx - 1.2, 32, Z - 8, cx + 1.2, 34.5, Z + 62, 0xf0f0ec, 0xf0f0ec, M.METAL, 0);
      mb.box(cx - 2, 34.5, Z + 11, cx + 2, 38, Z + 17, 0xf0f0ec, 0xd0d4dc, M.WIN, 0);
      if (!lod) mb.cbox(cx, 38, Z + 14, 0.6, 0.6, 0.6, 0xff4040, M.LIGHT, 0);
    }
  }
}

// Container ship lying along x (bow toward +x).
function ship(mb, x, z, h, lod) {
  const Ln = 140 + (h % 5) * 12, W = 22;
  const hull = [0x1f3b63, 0x8e2b2b, 0x23614f, 0x2b2f3a][h & 3], deck = 0x9b4535;
  const x0 = x - Ln / 2, x1 = x + Ln / 2, z0 = z - W / 2, z1 = z + W / 2, xb = x1 - 16;
  mb.box(x0, -2, z0, xb, 7, z1, hull, deck, M.PLAIN, 0);
  mb.fq(xb, -2, z1, x1, -2, z, x1, 7, z, xb, 7, z1, M.PLAIN, hull, 0);
  mb.fq(x1, -2, z, xb, -2, z0, xb, 7, z0, x1, 7, z, M.PLAIN, hull, 0);
  mb.ft(xb, 7, z1, x1, 7, z, xb, 7, z0, M.PLAIN, deck, 0);
  mb.box(x0 + 2, 7, z0 + 1, x0 + 14, 22, z1 - 1, 0xf2f2ee, 0xd0d4dc, M.WIN, 0);
  mb.box(x0 + 6, 22, z - 2, x0 + 10, 28, z + 2, hull, 0x2b2f3a, M.PLAIN, 0);
  const rows = lod ? 4 : 8;
  for (let r = 0; r < rows; r++) {
    const xx = x0 + 18 + (r * (Ln - 40)) / rows, len = (Ln - 40) / rows - 0.6;
    const n = 1 + (hash3(h, r, 3) % 3);
    for (let s = 0; s < n; s++) {
      const col = BOX_COLS[(hash3(h, r, s) >>> 3) & 7];
      mb.box(xx, 7 + s * 2.6, z0 + 1.5, xx + len, 9.6 + s * 2.6, z1 - 1.5, col, s === n - 1 ? shade(col, 0.9) : -1, M.METAL, 0);
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
export function buildSkyline(L, sx, sz, lite = false) {
  const ox = (sx * SKY + SKY / 2 - 0.5) * PITCH, oz = (sz * SKY + SKY / 2 - 0.5) * PITCH;
  const mb = new MB(ox, oz, 4096);
  mb.sc = 32;
  const f = F;
  mb.flag = TALL;
  for (let j = 0; j < SKY; j++) for (let i = 0; i < SKY; i++) {
    const bx = sx * SKY + i, bz = sz * SKY + j;
    if (bx === 0 && bz === 0) {
      const X = 0, Z = 0;
      mb.box(X - 7, 0, Z - 7, X + 7, 12, Z + 7, 0xf2efe8, 0xcfd3da, M.WIN, 7);
      mb.box(X - 4.5, 12, Z - 4.5, X + 4.5, 98, Z + 4.5, 0xe6e9ee, -1, M.GLASS, 7, 12 / FLOOR_H);
      mb.cyl(X, 98, Z, 3.6, 216, 0.3, 6, 0xf2efe8, M.METAL, 7, false);
      mb.ell(X, 218, Z, 2.6, 2.6, 2.6, 6, 2, 0xffe28a, M.LIGHT, 7);
      continue;
    }
    if (cellKind(bx, bz) !== K.HOMES) continue;
    const zone = zoneLevel(bx, bz);
    if (zone < 2) continue;
    const occ = occupied(L, bx, bz);
    for (let s = 0; s < occ; s++) {
      const r = recipe(bx, bz, s, zone, null);
      if (r.height < (lite ? 12 : 6) * FLOOR_H) continue;      // lite (low quality): only the real skyline
      plotFrame(bx, bz, s, zone, f);
      const top = r.floors * FLOOR_H;
      mb.box(f.x - r.w / 2, 0, f.z - r.d / 2, f.x + r.w / 2, top, f.z + r.d / 2, r.wall, 0x8d9199, r.mat, (r.hash & 0xfc) | (zone === 3 ? 0 : 3));
      if (lite) continue;                                          // lite: plain boxes, no crowns
      const sig = zone === 3 && r.sig;
      if (r.crown === 1 && !sig) mb.box(f.x - r.w / 2 + 1.4, top, f.z - r.d / 2 + 2, f.x + r.w / 2 - 1.4, top + 3 * FLOOR_H, f.z + r.d / 2 - 2, r.wall, 0x8d9199, r.mat, (r.hash & 0xfc) | (zone === 3 ? 0 : 3), r.floors);
      if (top >= 30 * FLOOR_H && !sig) mb.cbox(f.x - r.w / 2 + 0.4, top, f.z - r.d / 2 + 0.4, 0.9, 0.9, 0.9, 0xff3030, M.LIGHT, r.hash & 255);
      if (sig) {
        mb.box(f.x - r.w / 2 + 1, top, f.z - r.d / 2 + 2, f.x + r.w / 2 - 1, top + 3 * FLOOR_H, f.z + r.d / 2 - 2, r.wall, 0x8d9199, r.mat, (r.hash & 0xfc) | (zone === 3 ? 0 : 3), r.floors);
        mb.box(f.x - r.w / 2 + 2.2, top + 3 * FLOOR_H, f.z - r.d / 2 + 4.5, f.x + r.w / 2 - 2.2, top + 6 * FLOOR_H, f.z + r.d / 2 - 4.5, 0xffc878, 0xd0d4dc, M.LIGHT, r.hash & 255);
        mb.cyl(f.x, top + 6 * FLOOR_H, f.z, 1.2, top + 6 * FLOOR_H + 22, 0.15, 4, 0xe8ebf0, M.METAL, r.hash & 255, false);
      } else if (r.crown === 2 && zone === 3) mb.cbox(f.x, top, f.z, 0.5, 14, 0.5, 0xd0d4dc, M.METAL, r.hash & 255);
      else if (r.crown === 3 && zone === 3) mb.gable(f.x - r.w / 2, f.z - r.d / 2, f.x + r.w / 2, f.z + r.d / 2, top, 4, 0xb8bec8, shade(r.wall, 0.95), r.hash & 255, false);
      else if (r.crown === 4 && zone === 3) mb.box(f.x - r.w / 2 + 0.8, top, f.z - r.d / 2 + 1.6, f.x + r.w / 2 - 0.8, top + 4 * FLOOR_H, f.z + r.d / 2 - 1.6, r.wall, 0x8d9199, r.mat, (r.hash & 0xfc) | (zone === 3 ? 0 : 3), r.floors);
    }
  }
  return mb.finish();
}

void mod; void isRiver;
