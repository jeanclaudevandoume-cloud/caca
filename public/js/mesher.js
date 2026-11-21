// Mesh building. Vertex = 16 bytes:
//   0..5  int16 x,y,z  (metres * 64, relative to the mesh origin)
//   6     uint8 u      (metres along the wall * 8)
//   7     uint8 v      (floors * 4, so up to 63 floors)
//   8..10 int8 normal  (* 127)
//   11    uint8 material (low 3 bits) | 8 = tall (hands over to the skyline)
//   12..15 rgba8 colour, alpha = per-home random byte
// Index buffer: shadow-only proxies (count `so`, never drawn in the colour pass), then visible casters (the
// shadow pass draws the first `ns` indices, proxies included), then visible non-casters. The colour pass draws
// from `so` to the end.
import {
  PITCH, FLOOR_H, K, hash3, mod, fdiv, kindAt, cellKind, zoneLevel, plotsIn, plotFrame, recipe, occupied,
  ROOF, CITY, ACCENT, clampSV, civicType, rojiAt, avenueX, avenueZ, isRiver, portLane, bayHalf, homeRect, regionOf, regionKey, lineIndex, CHUNK, REGION,
} from './town.js';

// Trig rounded to 1e-7 so every JS engine builds byte-identical geometry (positions are then
// quantised to 1/64 m, so an ulp of difference between engines can no longer flip a value).
const rcos = (a) => Math.round(Math.cos(a) * 1e7) / 1e7;
const rsin = (a) => Math.round(Math.sin(a) * 1e7) / 1e7;

export const M = { PLAIN: 0, WIN: 1, LEAF: 2, METAL: 3, LIGHT: 4, GLASS: 5, WATER: 6, ROOF: 7 };
const TALL = 8;

export class MB {
  static strict = false;
  static overflow = [];
  constructor(ox, oz, cap = 4096) {
    this.ox = ox; this.oz = oz;
    this.alloc(cap);
    this.nv = 0;
    this.ic = new Uint32Array(cap * 2); this.nc = 0;
    this.io = new Uint32Array(cap); this.no = 0;
    this.is = new Uint32Array(256); this.nso = 0; this.proxy = false; this.noCast = false;
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
    if (MB.strict) {      // tools/selftest.mjs: vertex attributes must fit their packed formats
      const px = (x - this.ox) * this.sc, py = y * this.sc, pz = (z - this.oz) * this.sc;
      if (Math.abs(px) > 32767 || Math.abs(py) > 32767 || Math.abs(pz) > 32767) MB.overflow.push(`pos ${x},${y},${z}`);
      if (u * 8 > 255.5 || v * 4 > 255.5) MB.overflow.push(`uv ${u.toFixed(1)},${v.toFixed(1)}`);
    }
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
    if (this.proxy) {
      if (this.nso + 3 > this.is.length) { const t = new Uint32Array(this.is.length * 2); t.set(this.is); this.is = t; }
      this.is[this.nso++] = a; this.is[this.nso++] = b; this.is[this.nso++] = c;
    } else if (this.cast && !this.noCast) {
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
  boxEave(x0, y0, z0, x1, y1, z1, c, top, m, a, band = 0.7) {
    if (LITE) { this.box(x0, y0, z0, x1, y1, z1, c, top, m, a, y0 / FLOOR_H); return; }   // lite: no eave band (8 tris a house)
    const ys = y1 - band, cd = shade(c, 0.6);
    this.box(x0, y0, z0, x1, ys, z1, c, -1, m, a, y0 / FLOOR_H);   // window rows count from the ground
    const v0 = ys / FLOOR_H, v1 = y1 / FLOOR_H, sp = 2.6;
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
  // Flat-shaded quad whose winding is fixed so it faces up (normal y > 0) or down (dir < 0).
  fqY(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, m, c, a, dir = 1) {
    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0, bx = x3 - x0, by = y3 - y0, bz = z3 - z0;
    if ((az * bx - ax * bz) * dir >= 0) this.fq(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, m, c, a);
    else this.fq(x0, y0, z0, x3, y3, z3, x2, y2, z2, x1, y1, z1, m, c, a);
  }
  // Mono-pitch roof over the house rect: high edge at the street (fs), sloping to the back; o = overhang.
  mono(x0, z0, x1, z1, o, y, rise, fs, c, wallC, a, fc, trim) {
    const zf = fs < 0 ? z0 : z1, zb = fs < 0 ? z1 : z0, s = fs < 0 ? -1 : 1;
    const zfo = zf + s * o, zbo = zb - s * o, yt = y + rise, slope = rise / Math.abs(zf - zb);
    const yfo = yt + o * slope, ybo = y - o * slope;
    this.fqY(x0 - o, yfo, zfo, x1 + o, yfo, zfo, x1 + o, ybo, zbo, x0 - o, ybo, zbo, M.ROOF, c, a, 1);
    this.wq(x0, x1, y, yt, zf, s, wallC, M.PLAIN, a);                                  // front fill wall
    this.ft(x0, y, zb, x0, y, zf, x0, yt, zf, M.PLAIN, wallC, a);                       // side triangles
    this.ft(x1, y, zf, x1, y, zb, x1, yt, zf, M.PLAIN, wallC, a);
    if (trim) {
      this.wq(x0 - o, x1 + o, yfo - 0.15, yfo, zfo, s, fc, M.PLAIN, a);                 // thin dark fascia
      if (!LITE) this.fqY(x0 - o, yfo - 0.01, zfo, x1 + o, yfo - 0.01, zfo, x1 + o, yt - 0.01, zf, x0 - o, yt - 0.01, zf, M.PLAIN, shade(wallC, 0.7), a, -1);   // underside
    }
  }
  // Flat-roof parapet ring: outer faces, coping on top, inner faces (not on lite); optional roof membrane.
  parapet(x0, z0, x1, z1, y, h, sideC, capC, a, membrane = -1) {
    const t = 0.22, yt = y + h;
    if (membrane !== -1 && membrane !== false && membrane !== true) this.q(x0, y + 0.02, z1, x1, y + 0.02, z1, x1, y + 0.02, z0, x0, y + 0.02, z0, 0, 1, 0, 0, 0, 0, 0, M.ROOF, membrane, (a & 0xf0) | (((a >> 4) & 3) << 2) | 3);   // flat roof surface from the atlas (alpha: tile << 2 | 3)
    this.wq(x0, x1, y, yt, z1, 1, sideC, M.PLAIN, a); this.wq(x0, x1, y, yt, z0, -1, sideC, M.PLAIN, a);
    this.xq(x1, z0, z1, y, yt, 1, sideC, M.PLAIN, a); this.xq(x0, z0, z1, y, yt, -1, sideC, M.PLAIN, a);
    const top = (ax0, az0, ax1, az1) => this.q(ax0, yt, az1, ax1, yt, az1, ax1, yt, az0, ax0, yt, az0, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, capC, a);
    top(x0, z0, x1, z0 + t); top(x0, z1 - t, x1, z1); top(x0, z0 + t, x0 + t, z1 - t); top(x1 - t, z0 + t, x1, z1 - t);
    if (!LITE) {
      const ic = shade(sideC, 0.8);
      this.wq(x0 + t, x1 - t, y, yt, z1 - t, -1, ic, M.PLAIN, a); this.wq(x0 + t, x1 - t, y, yt, z0 + t, 1, ic, M.PLAIN, a);
      this.xq(x1 - t, z0 + t, z1 - t, y, yt, -1, ic, M.PLAIN, a); this.xq(x0 + t, z0 + t, z1 - t, y, yt, 1, ic, M.PLAIN, a);
    }
  }
  // Faux mansard: four sloped faces rising h with a 0.8 m inset, flat membrane on top.
  mansard(x0, z0, x1, z1, y, h, c, memC, a) {
    const i = 0.8, yt = y + h;
    this.fq(x0, y, z1, x1, y, z1, x1 - i, yt, z1 - i, x0 + i, yt, z1 - i, M.ROOF, c, a);
    this.fq(x1, y, z0, x0, y, z0, x0 + i, yt, z0 + i, x1 - i, yt, z0 + i, M.ROOF, c, a);
    this.fq(x1, y, z1, x1, y, z0, x1 - i, yt, z0 + i, x1 - i, yt, z1 - i, M.ROOF, c, a);
    this.fq(x0, y, z0, x0, y, z1, x0 + i, yt, z1 - i, x0 + i, yt, z0 + i, M.ROOF, c, a);
    this.q(x0 + i, yt, z1 - i, x1 - i, yt, z1 - i, x1 - i, yt, z0 + i, x0 + i, yt, z0 + i, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, memC, a);
  }
  box(x0, y0, z0, x1, y1, z1, c, top, m, a, vb = 0) {
    const v0 = vb, v1 = vb + (y1 - y0) / FLOOR_H, w = x1 - x0, d = z1 - z0;
    // centre the window grid on each wall so no window is cut at a corner
    const sp = m === M.GLASS ? 1.7 : 2.6, win = m === M.WIN || m === M.GLASS;
    // every wall holds a whole number of window cells (stretched to fit), so no window wraps a corner
    const uw = win ? Math.max(1, Math.round(w / sp)) * sp : 0, ud = win ? Math.max(1, Math.round(d / sp)) * sp : 0;   // non-window materials never read u
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
    const rows = half ? rings : rings * 2;
    for (let j = 0; j <= rows; j++) {
      const phi = ((j + (half ? rings : 0)) / (rings * 2)) * Math.PI;   // 0 = bottom pole
      const sy = -rcos(phi), sr = rsin(phi);
      for (let i = 0; i <= sides; i++) {
        const t = (i / sides) * Math.PI * 2;
        const nx = rcos(t) * sr, nz = rsin(t) * sr;
        this.v(x + nx * rx, y + sy * ry, z + nz * rz, 0, 0, nx, sy, nz, m, under < 1 ? shade(c, under + (1 - under) * Math.min(1, (sy + 1) * 0.8)) : c, a);
      }
    }
    const W = sides + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < sides; i++) {
      const p = base + j * W + i;
      if (half || j > 0) this.tri(p, p + W + 1, p + 1);   // bottom pole row would be zero-area
      if (j < rows - 1) this.tri(p, p + W, p + W + 1);     // top pole row would be zero-area
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
  // A shadow-only stand-in: an open-bottomed box (10 tris) that casts the shadow of a detailed building whose
  // own triangles then don't cast (round G: full-detail casters cost the phone 8-43% frame time).
  shadowBox(x0, y0, z0, x1, y1, z1) {
    if (!this.cast || this.noCast) return;
    this.proxy = true;
    this.box(x0, y0, z0, x1, y1, z1, 0, 0, M.PLAIN, 0);   // walls + top: rays reaching the far half of the shadow enter through the roof
    this.proxy = false;
  }
  finish() {
    const n = this.nso + this.nc + this.no;
    const ib = this.nv <= 65535 ? new Uint16Array(n) : new Uint32Array(n);
    ib.set(this.is.subarray(0, this.nso)); ib.set(this.ic.subarray(0, this.nc), this.nso); ib.set(this.io.subarray(0, this.no), this.nso + this.nc);
    return { vb: this.buf.slice(0, this.nv * 16), ib, so: this.nso, ns: this.nso + this.nc, nv: this.nv, ymax: this.ymax };
  }
}

// ---------- small helpers ----------
const shade = (c, f) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f)), g = Math.min(255, Math.round(((c >> 8) & 255) * f)), b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};
// flat-roof membranes on houses: Seoul green, blue, slate, olive (V .35-.50: always darker than the wall)
const FLAT_MEM = [0x4f7d6e, 0x3f6f8c, 0x5a5f66, 0x6b7a5a];
const flatMem = (r) => FLAT_MEM[(r.hash >>> 21) & 3];
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
    mb.cyl(x, 0, z, 0.25 * s, 1.6 * s, 0.25 * s, 3, TRUNK, M.PLAIN, h & 255, false);   // the trunk stays: a crown without one floats
    if (kind < 2) mb.cyl(x, 1.0 * s, z, 2.2 * s, 6 * s, 0, 4, shade(c, 0.85), M.LEAF, h & 255);
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
function wires(mb, x0, x1, z, n, alongZ = false) {
  const cast = mb.cast; mb.cast = false;
  const c = 0x222428, xm = (x0 + x1) / 2;
  // P(a, y, off): a = position along the wire, off = sideways offset (axis swapped when alongZ)
  const P = (a, off) => (alongZ ? [z + off, a] : [a, z + off]);
  for (let i = 0; i < n; i++) {
    const y = 8.15 - i * 0.12, dz = (i - 1) * 0.5;
    for (const [ax, bx, ay, by] of [[x0, xm, y, y - 0.4], [xm, x1, y - 0.4, y]]) {
      for (const fs of [1, -1]) {
        const [p0x, p0z] = P(ax, dz + fs * 0.005), [p1x, p1z] = P(bx, dz + fs * 0.005);
        // flat-shaded ribbon; fq computes the normal, the two windings make it visible from both sides
        if (fs > 0) mb.fq(p0x, ay - 0.04, p0z, p1x, by - 0.04, p1z, p1x, by, p1z, p0x, ay, p0z, M.PLAIN, c, 0);
        else mb.fq(p1x, by - 0.04, p1z, p0x, ay - 0.04, p0z, p0x, ay, p0z, p1x, by, p1z, M.PLAIN, c, 0);
      }
    }
  }
  mb.cast = cast;
}

function lamp(mb, x, z, a) {
  const cast = mb.cast; mb.cast = false;
  mb.cbox(x, 0, z, 0.25, 5.2, 0.25, 0x3a3f4a, M.METAL, a);
  mb.cbox(x, 5.0, z, 0.7, 0.35, 0.7, 0xfff1c1, M.LIGHT, a);
  mb.cast = cast;
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
const VEND = [0xe8433a, 0x2a6fb5, 0xf2f2ee, 0x2a9d6f];
const DOORS = [0x2f4d7a, 0x7e2d2d, 0x2e5a45, 0xc8402f, 0xd9a441];
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
// Rooftop clutter on a flat roof (round M): a stair hut in the wall colour with a door, an AC condenser,
// and on fuller meshes a water tank on a stand and a solar water heater. ~20 tris lite, ~60 full.
function roofClutter(mb, x0, z0, x1, z1, top, wall, h, a) {
  const cast = mb.cast; mb.cast = false;
  const w = x1 - x0, d = z1 - z0, hx = (h & 1) ? x0 + 1.5 : x1 - 1.5, hz = (h & 2) ? z0 + 1.6 : z1 - 1.6;
  mb.box(hx - 1.1, top, hz - 1.2, hx + 1.1, top + 2.5, hz + 1.2, shade(wall, 0.92), 0x6e7378, M.PLAIN, a);   // stair hut
  if (!LITE) mb.wq(hx - 0.45, hx + 0.45, top + 0.05, top + 2.0, (h & 2) ? hz + 1.21 : hz - 1.21, (h & 2) ? 1 : -1, 0x5a5f66, M.METAL, a);
  if (!LITE) {
    mb.cbox(x0 + w * 0.5, top, z0 + d * ((h & 4) ? 0.3 : 0.7), 0.9, 0.65, 0.4, 0xe9e9e6, M.METAL, a);       // AC condenser
    const tx = (h & 1) ? x1 - 1.4 : x0 + 1.4, tz = z0 + d * 0.5;
    for (const [lx, lz] of [[-0.5, -0.5], [0.5, 0.5]]) mb.cbox(tx + lx, top, tz + lz, 0.08, 0.9, 0.08, 0x5a5f66, M.METAL, a);
    mb.cyl(tx, top + 0.9, tz, 0.7, top + 2.1, 0.7, 6, 0x9fb3c2, M.METAL, a);                                // tank on a stand
    if (h & 8) mb.q(x0 + w * 0.3, top + 0.3, z0 + d * 0.62, x0 + w * 0.3 + 2, top + 0.3, z0 + d * 0.62, x0 + w * 0.3 + 2, top + 1.1, z0 + d * 0.62 - 0.9, x0 + w * 0.3, top + 1.1, z0 + d * 0.62 - 0.9, 0, 0.75, -0.66, 0, 0, 0, 0, M.GLASS, 0x2b3d5c, a);   // solar heater
  }
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
  if (!LITE) for (const zz of [z0 + (z1 - z0) / 3, z0 + (z1 - z0) * 2 / 3]) mb.cbox(fx + fs * 0.06, 0.15, zz, 0.08, 2.85, 0.12, 0x2a2f36, M.METAL, a);
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
      const bc = ACCENT_SIGN[(r.sign + 1) % ACCENT_SIGN.length], ba = a & 0xfe;
      // a solid board with one bold text band (procedural lettering turned to speckle at drone distance)
      mb.xq(bx, bz0, bz1, top + 0.8, top + 3.2, fs, bc, M.LIGHT, ba);
      mb.xq(bx + fs * 0.18, bz0 + 1.2, bz1 - 1.2, top + 1.6, top + 2.4, fs, 0xf6f4ee, M.LIGHT, ba);   // 18 cm proud: no depth fight at distance
      if (!LITE) mb.xq(bx - fs * 0.05, bz0, bz1, top + 0.8, top + 3.2, -fs, 0x3a3e45, M.PLAIN, a);
    }
  }
  // vertical sign on the lane corner: big enough to read from the opening camera
  const sz = (r.hash & 1) ? z0 + 0.9 : z1 - 0.9;
  mb.cbox(fx + fs * 0.6, gh + 0.2, sz, 0.25, Math.max(3.0, top - gh + 0.6), 1.5, ACCENT_SIGN[(r.sign + 2) % ACCENT_SIGN.length], M.LIGHT, a);
  // every second shop: a tall banner sign standing out over the lane (reads from the opening camera)
  if ((r.hash >>> 23) & 1) {
    const bz = (r.hash & 1) ? z1 - 2.2 : z0 + 2.2, bc = AWNING[(r.awning + 1) % AWNING.length];
    mb.cbox(fx + fs * 1.1, gh + 0.6, bz, 1.2, 6.0, 0.16, bc, M.PLAIN, a);
    mb.cbox(fx + fs * 1.1, gh + 2.0, bz, 0.7, 3.2, 0.2, 0xf6f4ee, M.LIGHT, a);
  }
  mb.noCast = false;
}

// Shrine: a vermilion torii on the south edge, a gravel approach and forecourt, a dark-roofed hall, and a
// ring of tall trees (chinju no mori) that reads from the drone views.
function shrine(mb, X, Z, h, lod) {
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
  const n = lod || LITE ? 10 : 22;
  for (let t = 0; t < n; t++) {
    const a = (t / n) * Math.PI * 2, r = 17 + (hash3(X, Z, 500 + t) % 3);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > 12 && Math.abs(x) < 7) continue;                                         // the approach stays open
    tree(mb, X + x, Z + z, 1.35 + (hash3(X, Z, 600 + t) % 4) * 0.12, (hash3(X, Z, 700 + t) & ~7) | 2, lod);
  }
}
// School: a white four-storey slab with a clock, a dirt sports field with white lines and a net fence.
function school(mb, X, Z, h, lod) {
  for (const s of [-1, 1]) mb.box(s < 0 ? X - 17 : X, 0, Z - 19, s < 0 ? X : X + 17, 4 * FLOOR_H, Z - 9, 0xeceae4, 0x8c9096, M.WIN, (h & 0xfc) | 3);   // two halves: packed u stays < 32 m
  mb.parapet(X - 17, Z - 19, X + 17, Z - 9, 4 * FLOOR_H, 0.8, 0xd8d6d0, 0xf2f0ea, h & 255, 0x8c9096);
  mb.cast = false;
  mb.cbox(X, 4 * FLOOR_H - 2.6, Z - 8.9, 2.0, 2.0, 0.15, 0xf6f5f0, M.LIGHT, 1);     // clock face
  mb.cbox(X, 4 * FLOOR_H - 1.7, Z - 8.8, 0.12, 0.8, 0.1, 0x2a2c30, M.PLAIN, 1);
  mb.q(X - 18, 0.04, Z + 19, X + 18, 0.04, Z + 19, X + 18, 0.04, Z - 6, X - 18, 0.04, Z - 6, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, 0xb08a5c, 1);   // field
  if (!lod && !LITE) {
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
      const cz0 = r.garage && f.face < 0 && !LITE ? z0 - 0.6 : z0, cz1 = r.garage && f.face > 0 && !LITE ? z1 + 0.6 : z1;
      if (LITE && r.floors < 3) {
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
      if (r.twoTone && !LITE) { mb.cast = false; mb.box(x0 - 0.03, FLOOR_H - 0.05, z0 - 0.03, x1 + 0.03, FLOOR_H + 0.02, z1 + 0.03, 0x3a3836, -1, M.PLAIN, a); mb.cast = true; }
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
        if (open && !LITE && (r.hash >>> 27) % 5 < 3) {         // a kei car parked in the open bay
          const cx = (gx0 + gx1) / 2, cz = wallZ + fs * 0.3, cc = CARS[(r.hash >>> 9) % CARS.length];
          mb.cbox(cx, 0.2, cz, 1.45, 0.75, 1.4, cc, M.METAL, a);
          mb.cbox(cx, 0.95, cz - fs * 0.15, 1.35, 0.6, 0.9, 0x2b3240, M.GLASS, a);
        }
        if (!LITE) mb.wq(gx0 - 0.15, gx1 + 0.15, 2.5, 2.7, wallZ + fs * 0.04, fs, 0xd9d3c7, M.PLAIN, a);
      }
      // floor-2 balcony: slab + solid parapet across 60% of the front
      if (r.balcony) {
        const bw = (x1 - x0) * 0.6, bx0 = r.side > 0 ? x0 + 0.3 : x1 - 0.3 - bw, bx1 = bx0 + bw;
        const zf = wallZ + fs * 0.9;
        const pc = (r.hash >>> 23) & 1 ? 0xeeebe4 : shade(r.wall, 0.85);
        mb.wq(bx0, bx1, FLOOR_H, FLOOR_H + 1.1, zf, fs, pc, M.PLAIN, a);                       // parapet front
        mb.q(bx0, FLOOR_H + 1.1, Math.min(wallZ, zf), bx1, FLOOR_H + 1.1, Math.min(wallZ, zf), bx1, FLOOR_H + 1.1, Math.max(wallZ, zf), bx0, FLOOR_H + 1.1, Math.max(wallZ, zf), 0, 1, 0, 0, 0, 0, 0, M.PLAIN, shade(pc, 1.05), a); // parapet top (as a slab)
        if (!LITE) {
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
        if (!LITE) mb.q(bx0, y, zf, bx1, y, zf, bx1, y, zb, bx0, y, zb, 0, -1, 0, 0, 0, 0, 0, M.PLAIN, shade(pc, 0.45), a);   // dark slab underside
        mb.wq(bx0 + 0.3, bx0 + 0.3 + bw * 0.45, y + 0.35, y + 1.1, zf + 0.03, 1, ACCENT[(r.hash >>> 13) % ACCENT.length], M.PLAIN, a);   // futon / laundry
        if (LITE) mb.wq(bx1 - 1.2, bx1 - 0.4, 0.2, 0.8, zb + 0.35, 1, 0xd8d8d4, M.METAL, a);
        else mb.cbox(bx1 - 0.8, 0, zb + 0.3, 0.85, 0.6, 0.4, 0xd8d8d4, M.METAL, a);           // AC unit under the balcony
      }
      // the open side wall faces the lane: outdoor AC unit, downpipe and meter box make it read as a real wall
      {
        const sx = r.side > 0 ? x0 : x1, sxs = r.side > 0 ? -1 : 1;
        const zm = (z0 + z1) / 2, zr = f.face < 0 ? z1 - 0.3 : z0 + 0.3;
        if (LITE) {                                   // lite: flat quads on the wall (2 tris each)
          mb.xq(sx + sxs * 0.02, zm + 0.8, zm + 1.6, 0.15, 0.75, sxs, 0xd8d8d4, M.METAL, a);
          mb.xq(sx + sxs * 0.02, zr - 0.05, zr + 0.05, 0, top, sxs, 0x5a5e62, M.METAL, a);
        } else {
          mb.cbox(sx + sxs * 0.2, 0.15, zm + 1.2, 0.4, 0.6, 0.85, 0xd8d8d4, M.METAL, a);
          mb.cbox(sx + sxs * 0.06, 0, zr, 0.1, top, 0.1, 0x5a5e62, M.METAL, a);
          mb.cbox(sx + sxs * 0.06, 1.2, zm - 1.4, 0.1, 0.5, 0.4, 0xbfc3c6, M.METAL, a);
        }
        if (!LITE) mb.cbox(sx + sxs * 0.2, FLOOR_H + 0.4, zm - 2.2, 0.4, 0.55, 0.8, 0xd8d8d4, M.METAL, a);
      }
      // potted plants either side of the door (cheap: a pot box and a small 8-tri crown)
      for (const px of LITE ? [] : [doorX - 0.95, doorX + 0.95]) {
        const pz = wallZ + fs * 0.45;
        mb.cbox(px, 0, pz, 0.45, 0.45, 0.45, 0x8a5a3c, M.PLAIN, a);
        mb.ell(px, 0.85, pz, 0.38, 0.45, 0.38, 4, 1, LEAVES[(r.hash >>> 7) % LEAVES.length], M.LEAF, a);
      }
      mb.cast = true;
      door(mb, doorX, wallZ, fs, r, rc, a);
      mb.noCast = false;
    }
    if (!lod) {
      // side planting strip with a small tree; vending machine at the front corner
      const gapX = r.side > 0 ? x0 - 1.2 : x1 + 1.2;
      if (r.tree && (!LITE || (r.hash >>> 22) % 10 < 3)) tree(mb, gapX, (z0 + z1) / 2, 0.55, r.hash >>> 9, LITE ? 1 : 0);
      if (r.vending) {
        mb.cast = false;
        const vx = r.side > 0 ? f.x - 4.3 : f.x + 4.3, vz = front - fs * 0.6;
        if (LITE) mb.wq(vx - 0.45, vx + 0.45, 0, 1.8, vz + fs * 0.35, fs, VEND[(r.hash >>> 11) % VEND.length], M.LIGHT, a);   // lite: the lit front only
        else mb.cbox(vx, 0, vz, 0.9, 1.8, 0.7, VEND[(r.hash >>> 11) % VEND.length], M.LIGHT, a);
        mb.cast = true;
      }
      if (!LITE) {
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
      mb.box(x0 + 0.3, 0, bz0, x1 - 0.3, FLOOR_H, bz1, 0x4a4744, -1, M.PLAIN, a);          // back of the parking storey
      mb.q(x0, FLOOR_H - 0.01, pz0, x1, FLOOR_H - 0.01, pz0, x1, FLOOR_H - 0.01, pz1, x0, FLOOR_H - 0.01, pz1, 0, -1, 0, 0, 0, 0, 0, M.PLAIN, 0x2a2c30, a);
      const cz = f.face < 0 ? z0 + 0.25 : z1 - 0.25;
      for (const cx of LITE ? [x0 + 0.25, x1 - 0.25] : [x0 + 0.25, x1 - 0.25, (x0 + x1) / 2]) mb.cbox(cx, 0, cz, 0.45, FLOOR_H, 0.45, 0xbdb6aa, M.PLAIN, a);
      mb.boxEave(x0, FLOOR_H, z0, x1, top, z1, r.wall, -1, M.WIN, wa, 0.4);
      // glass stair strip on the street face
      mb.cast = false;
      const sx = f.x + (r.hash & 16 ? 2.2 : -2.2);
      mb.wq(sx - 0.6, sx + 0.6, FLOOR_H, top - 0.3, wallZ + fs * 0.04, fs, 0x6f8fa6, M.GLASS, a);
      mb.cast = true;
      // flat roof: coloured membrane, parapet, water tank; some get a faux mansard
      if (r.mansard) mb.mansard(x0, z0, x1, z1, top, 1.4, 0x7a2f26, r.roofMem, a);
      else { mb.parapet(x0, z0, x1, z1, top, 0.6, shade(r.wall, 0.85), 0xd9d3c7, a, r.roofMem); }
      if (!LITE) mb.cyl(x0 + 1.6, top, (z0 + z1) / 2, 0.9, top + 1.6, 0.9, 6, (r.hash >>> 7) & 1 ? 0x2f6fb0 : 0xd9a441, M.METAL, a);
      if (!r.mansard) roofClutter(mb, x0 + 2.6, z0, x1, z1, top, r.wall, r.hash >>> 3, a);
      door(mb, f.x, wallZ, fs, r, ROOF[r.roof], a);
      mb.noCast = false;
    }
  } else {
    const tower = r.zone === 3;
    if (tower) f = { ...f, x: f.x + r.ox };            // towers stand over two plots
    if (tower && r.pod) {                              // odd slot: a two-storey podium with a roof garden
      const pc = CITY[(r.hash >>> 5) % CITY.length];
      mb.box(f.x - 4.8, 0, f.z - 9.5, f.x + 4.8, 2 * FLOOR_H, f.z + 9.5, pc, 0x5f7f4a, M.WIN, a & 0xfc);
      if (!lod && !LITE) for (let i = 0; i < 3; i++) tree(mb, f.x - 3 + i * 3, f.z + (i - 1) * 5, 0.5, r.hash >>> i, 1);
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
    if (tower && !r.sig) { towerMass(mb, f, r, bx, bz, r.slot, LITE || !!lod, !lod && !LITE); mb.flag = 0; mb.cast = true; return; }
    if (tower) {
      const pod = CITY[(r.hash >>> 5) % CITY.length];
      mb.box(f.x - w / 2 - 0.4, 0, f.z - 9.4, f.x + w / 2 + 0.4, 2 * FLOOR_H, f.z + 9.4, pod, shade(pod, 0.85), M.WIN, a & 0xfc);
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
      // Tokyo-style street face (kanban also on lite): a vertical lit sign, balconies and air-conditioner boxes
      mb.cast = false;
      {                                          // vertical kanban on every street face, plus stacked signs on some
        const kx = r.hash & 1 ? x0 + 0.5 : x1 - 0.5, kh = 6 + ((r.hash >>> 6) % 4);
        mb.cbox(kx, 4.0, fz + fs * 0.75, 0.3, kh, 1.2, ACCENT[(r.hash >>> 9) % ACCENT.length], M.LIGHT, a);
        if (r.hash & 2 && !LITE) {
          const n = 1 + ((r.hash >>> 5) % 2);
          for (let i = 0; i < n; i++) mb.cbox(r.hash & 1 ? x1 - 0.4 : x0 + 0.4, 4.2 + i * 4.0, fz + fs * 0.45, 0.25, 3.5, 0.6, ACCENT_SIGN[((r.hash >>> 9) + i * 3) % ACCENT_SIGN.length], M.LIGHT, a);
        }
        if ((r.hash >>> 26) % 4 === 0) {           // rooftop billboard (lite: a double-sided panel, 4 tris)
          const bc = ACCENT[(r.hash >>> 4) % ACCENT.length];
          if (LITE) { mb.wq(f.x - 3, f.x + 3, roofTop + 2.5, roofTop + 5.5, f.z, 1, bc, M.LIGHT, a); mb.wq(f.x - 3, f.x + 3, roofTop + 2.5, roofTop + 5.5, f.z, -1, bc, M.LIGHT, a); }
          else {
            mb.cbox(f.x - 2, roofTop, f.z, 0.2, 2.5, 0.2, 0x3a3e45, M.METAL, a); mb.cbox(f.x + 2, roofTop, f.z, 0.2, 2.5, 0.2, 0x3a3e45, M.METAL, a);
            mb.cbox(f.x, roofTop + 2.5, f.z, 6, 3, 0.3, bc, M.LIGHT, a);
          }
        }
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
        if (!lod && !LITE && zone <= 1 && rojiAt(bx, bz)) { lamp(mb, X - 11, Z + 1.9, hb & 255); lamp(mb, X + 11, Z - 1.9, hb & 255); }   // roji lamps
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
            // concrete utility poles on the north kerb (every 24 m) with three sagging wires to the next pole
            const pz = Z - 19.6;
            const pole = (px, pzz) => {
              mb.cyl(px, 0, pzz, 0.17, 9.0, 0.12, LITE ? 4 : 6, 0xa7a49c, M.PLAIN, hb & 255, false);
              if (!LITE) { mb.cbox(px, 8.2, pzz, 1.4, 0.12, 0.12, 0x8a877f, M.PLAIN, 0); mb.cbox(px + 0.3, 6.6, pzz, 0.35, 0.5, 0.35, 0x7f8a8a, M.METAL, 0); }
            };
            for (const px of [X - 18, X + 6]) { pole(px, pz); wires(mb, px, X + (px === X - 18 ? 6 : 30), pz, LITE ? 1 : 3, false); }
            // and along the west kerb, so north-south lanes have them too
            const wx = X - 19.6;
            for (const pzz of [Z - 6, Z + 18]) { pole(wx, pzz); wires(mb, pzz, Z + (pzz === Z - 6 ? 18 : 42), wx, LITE ? 1 : 3, true); }
            if (!LITE) lamp(mb, X - 19.3, Z + 19.3, hb & 255);
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
            if (ax) mb.cbox(X + lane, 0.2, Z + along, wid, hgt, len, col, M.METAL, hc & 255);
            else mb.cbox(X + along, 0.2, Z + lane, len, hgt, wid, col, M.METAL, hc & 255);
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
  const crown = lite ? ((h >>> 11) & 1) : (h >>> 11) & 3, mx = (cx0 + cx1) / 2, mz = (cz0 + cz1) / 2;   // lite: penthouse or sloped cut only
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
  if (top >= 30 * FLOOR_H && !lite) mb.cbox(cx0 + 0.4, top, cz0 + 0.4, 0.9, 0.9, 0.9, 0xff3030, M.LIGHT, h & 255);   // aviation light
  if (near) {                                            // lobby glass and a lit sign over the entrance
    const fs = f.face < 0 ? -1 : 1, pz = f.z + fs * hd, sign = ACCENT_SIGN[(h >>> 13) % ACCENT_SIGN.length];
    const cast = mb.cast; mb.cast = false;
    mb.cbox(f.x, 0, pz + fs * 0.05, 7, 3.4, 0.3, 0x9fc4dd, M.GLASS, aw);
    mb.cbox(f.x, 4.2, pz + fs * 0.25, 5, 0.9, 0.3, sign, M.LIGHT, h & 255);
    mb.cast = cast;
  }
}
const GLASS_DARK = [0x2f4a72, 0x2a4a63, 0x1f2a3a, 0x2c3f4f, 0x355f8f, 0x3b5a4f];

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
// Mid-band tiles (round M): MID x MID blocks of low massing for the ring just beyond the house ring, so
// rooftops run on to the towers instead of a flat painted band. Per row of homes two masses (left and right
// heights by hash) with windows from the facade shader and the row's roof colour; ~20 tris a block.
// Not TALL: GEO_VS (skyline mode) grows them in exactly as the real homes shrink away.
export const MID = 16;
export function buildMid(L, mx, mz) {
  const ox = (mx * MID + MID / 2 - 0.5) * PITCH, oz = (mz * MID + MID / 2 - 0.5) * PITCH;
  const mb = new MB(ox, oz, 4096);
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
      mb.box(x0, 0, z0, x1, top, z1, r.wall, roof, M.WIN, (h & 0xfc) | 1);
    }
  }
  return mb.finish();
}

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
      if (r.height < (lite ? 16 : 6) * FLOOR_H) continue;      // lite (low quality): only the real skyline
      plotFrame(bx, bz, s, zone, f);
      f.x += r.ox;                                                  // paired-plot towers
      const top = r.floors * FLOOR_H;
      if (zone === 3 && !r.sig) { towerMass(mb, f, r, bx, bz, s, lite, false); continue; }
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

