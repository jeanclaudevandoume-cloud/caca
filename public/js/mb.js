// Mesh builder (MB), the shared palettes and the mesh tile sizes (round Q split of mesher.js).
// Vertex = 16 bytes:
//   0..5  int16 x,y,z  (metres * 64, relative to the mesh origin)
//   6     uint8 u      (metres along the wall * 8)
//   7     uint8 v      (floors * 4, so up to 63 floors)
//   8..10 int8 normal  (* 127)
//   11    uint8 material (low 3 bits) | 8 = tall (hands over to the skyline)
//   12..15 rgba8 colour, alpha = per-home random byte
// Index buffer: shadow-only proxies (count `so`, never drawn in the colour pass), then visible casters (the
// shadow pass draws the first `ns` indices, proxies included), then visible non-casters. The colour pass draws
// from `so` to the end.
import { FLOOR_H, REGION } from './town.js';
import { ROOF } from './recipe.js';

// Trig rounded to 1e-7 so every JS engine builds byte-identical geometry (positions are then
// quantised to 1/64 m, so an ulp of difference between engines can no longer flip a value).
export const rcos = (a) => Math.round(Math.cos(a) * 1e7) / 1e7;
export const rsin = (a) => Math.round(Math.sin(a) * 1e7) / 1e7;

export const M = { PLAIN: 0, WIN: 1, LEAF: 2, METAL: 3, LIGHT: 4, GLASS: 5, WATER: 6, ROOF: 7 };
export const TALL = 8;

// Mesh tile sizes in blocks (mesher.js builds them; render.js and streaming.js place them, without pulling in mesher.js).
export const SKY = 2 * REGION;   // skyline tile = 2x2 data regions (32x32 blocks, ~1.5 km)
export const MID = 16;           // mid-band tile

export class MB {
  static strict = false;
  static overflow = [];
  constructor(ox, oz, cap = 4096, lite = false) {
    this.ox = ox; this.oz = oz;
    this.lite = lite;   // lite (low-quality) chunk: cheaper trees, fewer props; read by every helper that gets this mb
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
    if (this.lite) { this.box(x0, y0, z0, x1, y1, z1, c, top, m, a, y0 / FLOOR_H); return; }   // lite: no eave band (8 tris a house)
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
      if (!this.lite) this.fqY(x0 - o, yfo - 0.01, zfo, x1 + o, yfo - 0.01, zfo, x1 + o, yt - 0.01, zf, x0 - o, yt - 0.01, zf, M.PLAIN, shade(wallC, 0.7), a, -1);   // underside
    }
  }
  // Flat-roof parapet ring: outer faces, coping on top, inner faces (not on lite); optional roof membrane.
  parapet(x0, z0, x1, z1, y, h, sideC, capC, a, membrane = -1) {
    const t = 0.22, yt = y + h;
    if (membrane !== -1 && membrane !== false && membrane !== true) this.q(x0, y + 0.02, z1, x1, y + 0.02, z1, x1, y + 0.02, z0, x0, y + 0.02, z0, 0, 1, 0, 0, 0, 0, 0, M.ROOF, membrane, (a & 0xf0) | (((a >> 4) & 3) << 2) | 3);   // flat roof surface from the atlas (alpha: tile << 2 | 3)
    this.wq(x0, x1, y, yt, z1, 1, sideC, M.PLAIN, a); this.wq(x0, x1, y, yt, z0, -1, sideC, M.PLAIN, a);
    this.xq(x1, z0, z1, y, yt, 1, sideC, M.PLAIN, a); this.xq(x0, z0, z1, y, yt, -1, sideC, M.PLAIN, a);
    const top = (ax0, az0, ax1, az1) => this.q(ax0, yt, az1, ax1, yt, az1, ax1, yt, az0, ax0, yt, az0, 0, 1, 0, 0, 0, 0, 0, M.PLAIN, capC, a);
    if (!this.lite) {                                 // lite: no coping (sub-pixel at lite range; the wall band carries the rim)
      top(x0, z0, x1, z0 + t); top(x0, z1 - t, x1, z1); top(x0, z0 + t, x0 + t, z1 - t); top(x1 - t, z0 + t, x1, z1 - t);
    }
    if (!this.lite) {
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
  box(x0, y0, z0, x1, y1, z1, c, top, m, a, vb = 0, skip = 0) {   // skip: 1 drops the +z face, 2 the -z face
    const v0 = vb, v1 = vb + (y1 - y0) / FLOOR_H, w = x1 - x0, d = z1 - z0;
    // centre the window grid on each wall so no window is cut at a corner
    const sp = m === M.GLASS ? 1.7 : 2.6, win = m === M.WIN || m === M.GLASS;
    // every wall holds a whole number of window cells (stretched to fit), so no window wraps a corner
    const uw = win ? Math.max(1, Math.round(w / sp)) * sp : 0, ud = win ? Math.max(1, Math.round(d / sp)) * sp : 0;   // non-window materials never read u
    if (!(skip & 1)) this.q(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, 0, v0, uw, v1, m, c, a);
    if (!(skip & 2)) this.q(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, 0, v0, uw, v1, m, c, a);
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
        if (!this.lite) this.box(x0 - 0.05, y + h - 0.12, zm - 0.18, x1 + 0.05, y + h + 0.1, zm + 0.18, shade(c, 0.75), shade(c, 0.75), M.PLAIN, a);
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
        if (!this.lite) this.box(xm - 0.18, y + h - 0.12, z0 - 0.05, xm + 0.18, y + h + 0.1, z1 + 0.05, shade(c, 0.75), shade(c, 0.75), M.PLAIN, a);
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
export const shade = (c, f) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f)), g = Math.min(255, Math.round(((c >> 8) & 255) * f)), b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};
// flat-roof membranes on houses: Seoul green, blue, slate, olive (V .35-.50: always darker than the wall)
export const FLAT_MEM = [0x4f7d6e, 0x3f6f8c, 0x5a5f66, 0x6b7a5a];
export const flatMem = (r) => FLAT_MEM[(r.hash >>> 21) & 3];
export const LEAVES = [0x3e7d3a, 0x4f8f3f, 0x2f6b3c, 0x5f9a45, 0x6d8f3a, 0x467f43];
export const BLOSSOM = [0xf2a7c3, 0xe98fb4, 0xf7c1d5];
export const TRUNK = 0x7a5233;

// palettes shared by the mesh modules
export const VEND = [0xe8433a, 0x2a6fb5, 0xf2f2ee, 0x2a9d6f];
export const DOORS = [0x2f4d7a, 0x7e2d2d, 0x2e5a45, 0xc8402f, 0xd9a441];
// Front door: frame, inset door, step, optional canopy and a porch light.
export const GLASS_DARK = [0x2f4a72, 0x2a4a63, 0x1f2a3a, 0x2c3f4f, 0x355f8f, 0x3b5a4f];
export const CARS = [0xe8e8e8, 0x2b2b2b, 0x9aa3ad, 0x7e2d2d, 0x2f4d7a, 0xd9d4c8, 0x4f5a4a];
export const ACCENT_SIGN = [0xff5d8f, 0x3ad6ff, 0xffd23f, 0x7dff9a, 0xff8a3d, 0xc58bff];
export const BOX_COLS = [0xd8563b, 0x2a6fb5, 0xf0a030, 0x2a9d6f, 0x1fb5ad, 0xc2304f, 0x7b4b94, 0xe8e4dc];
