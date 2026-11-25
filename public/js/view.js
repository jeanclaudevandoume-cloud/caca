// Where things are and where the camera goes: per-plot footprints and heights, picking, the home-arrival
// camera and the fly-to arc. No DOM; the layout is read live from `app.L` (tools/apptest.mjs drives this).
import { PITCH, FLOOR_H, K, plotOf, plotFrame, recipe, zoneLevel, kindAt, slotAt, plotIndex, homeRect, hash3, laneBlock } from './town.js';
import { mulv } from './gfx.js';

export const plotKey = (bx, bz, slot) => ((bx + 32768) * 65536 + (bz + 32768)) * 16 + slot;

const PROJ = new Array(8);
// screen-space area of a quad (corner indices into projected points; null corners count as 0)
function quadArea(P, ix) {
  let a = 0;
  for (let k = 0; k < 4; k++) { const p = P[ix[k]], q = P[ix[(k + 1) & 3]]; if (!p || !q) return 0; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}
export function createView(app) {
  // Per-plot footprint and top height, cached: tag scans and fly-to call these hundreds of times, and the
  // recipe allocates (round I: 16 KB/frame on the opening view while the camera turned).
  const PLOT = new Map();
  function plotInfo(bx, bz, slot, zone) {
    const k = plotKey(bx, bz, slot);
    let e = PLOT.get(k);
    if (!e) {
      if (PLOT.size > 8192) PLOT.clear();
      const r = recipe(bx, bz, slot, zone, null);
      const top = zone >= 2 ? r.floors * FLOOR_H + (r.crown === 1 ? 3 * FLOOR_H : r.crown === 4 && zone === 3 ? 4 * FLOOR_H : 0)
        : r.floors * FLOOR_H + (r.roofType === 2 ? 0.6 : 2.6);
      e = { top, q: homeRect(plotFrame(bx, bz, slot, zone), r) };
      PLOT.set(k, e);
    }
    return e;
  }
  const homeTop = (bx, bz, slot, zone) => plotInfo(bx, bz, slot, zone).top;
  function heightAt(x, z) {
    const L = app.L;
    if (!L) return 0;
    const bx = Math.floor((x + 24) / PITCH), bz = Math.floor((z + 24) / PITCH);
    if (bx === 0 && bz === 0 && Math.abs(x) < 7 && Math.abs(z) < 7) return 220;
    if (kindAt(L, bx, bz) !== K.HOMES) return 0;
    const zone = zoneLevel(bx, bz);
    const s = slotAt(zone, x - bx * PITCH, z - bz * PITCH, laneBlock(bx, bz, zone));
    if (s < 0 || plotIndex(L, bx, bz, s) < 0) return 0;
    const e = plotInfo(bx, bz, s, zone), q = e.q;
    if (x < q[0] - 0.5 || x > q[2] + 0.5 || z < q[1] - 0.5 || z > q[3] + 0.5) return 0;
    return e.top;
  }
  function plotAtWorld(x, z) {
    const L = app.L;
    const bx = Math.floor((x + 24) / PITCH), bz = Math.floor((z + 24) / PITCH);
    if (kindAt(L, bx, bz) !== K.HOMES) return null;
    const zone = zoneLevel(bx, bz);
    const s = slotAt(zone, x - bx * PITCH, z - bz * PITCH, laneBlock(bx, bz, zone));
    const p = s < 0 ? -1 : plotIndex(L, bx, bz, s);
    return p < 0 ? null : { p, bx, bz, slot: s, zone };
  }
  // the home under normalised device coordinates (nx, ny), marching the view ray
  function pick(invVP, cam, nx, ny) {
    const a = mulv(invVP, [nx, ny, -1, 1]), b = mulv(invVP, [nx, ny, 1, 1]);
    const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
    const p = [cam.x, cam.y, cam.z];
    for (let t = 0; t < 2500; t += 1.5) {
      const x = p[0] + d[0] * t, y = p[1] + d[1] * t, z = p[2] + d[2] * t;
      if (y < 0) break;
      if (y < heightAt(x, z)) return plotAtWorld(x, z);
    }
    if (d[1] < 0) { const t = -cam.y / d[1]; return plotAtWorld(cam.x + d[0] * t, cam.z + d[2] * t); }
    return null;
  }

  // The camera for arriving at follower p (screen aspect w/h).
  function homeView(p, aspect) {
    const { bx, bz, slot } = plotOf(app.L, p);
    const zone = zoneLevel(bx, bz);
    const f = plotFrame(bx, bz, slot, zone);
    const top = homeTop(bx, bz, slot, zone);
    const face = f.face;
    if (zone >= 2) {
      // city: hover above the tallest neighbour, a little toward the street, looking down at the roof
      let maxH = top;
      for (let dz = -45; dz <= 45; dz += 7.5) for (let dx = -45; dx <= 45; dx += 7.5) maxH = Math.max(maxH, heightAt(f.x + dx, f.z + dz + face * 20));
      const y = Math.max(top + 30, maxH + 14);
      return { x: f.x + 10, y, z: f.z + face * (24 + (y - top) * 0.75), yaw: 0, pitch: 0, bx, bz, slot, zone, tx: f.x, tz: f.z, ty: top / 0.6 };
    }
    // portrait of the home (round M): fit its front to 45-60% of the screen width, 20-30° off the facade normal,
    // eye 9-14 m up (above the house opposite when needed), the home a little above the screen centre so the
    // bottom sheet never covers it. Both sides are tried; the one with a clear sight line wins.
    const q = plotInfo(bx, bz, slot, zone).q, hx = (q[0] + q[2]) / 2, hz = (q[1] + q[3]) / 2, hw = q[2] - q[0];
    const front = face < 0 ? q[1] : q[3];
    const vfov = Math.PI / 3, hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dist = Math.max(16, Math.min(40, (hw / 0.52) / (2 * Math.tan(hfov / 2))));
    const pref = (hash3(bx, bz, slot) & 1) ? 1 : -1;
    // round Q: hard framing constraints. A candidate camera is accepted only if, with its final yaw / pitch,
    // (1) all 8 corners of the home's box are inside the safe rectangle (below the search bar, above the
    // sheet, 6% side margins), (2) the home spans 45-65% of the screen width, (3) the view is within 35° of
    // the facade normal (the front, not a side), (4) the door is not hidden behind anything, (5) the pin top is
    // below the search bar. Candidates sweep the angle off the normal, the distance and the height; among the
    // accepted ones the fewest foreground occluders wins. If none passes, the best-scoring one is used.
    const r = recipe(bx, bz, slot, zone, null);
    const doorX = zone === 0 && r.side ? (r.side > 0 ? q[0] + 1.3 : q[2] - 1.3) : hx;
    const safe = app.safe || { top: 0.84, bottom: -0.62, side: 0.88 };   // NDC: y up
    const tv = Math.tan(vfov / 2), th = Math.tan(hfov / 2);
    const corners = [];
    for (const cx of [q[0], q[2]]) for (const cz of [q[1], q[3]]) for (const cy of [0, top]) corners.push([cx, cy, cz]);
    // corner k = ix*4 + iz*2 + iy: the front face is the street-side z (iz = 0 when face < 0), the roof iy = 1
    const fz = face < 0 ? 0 : 1, FRONT = [0 + fz * 2, 1 + fz * 2, 5 + fz * 2, 4 + fz * 2], ROOF4 = [1, 3, 7, 5];
    const project = (cam, yaw, pitch, P) => {
      const fx = Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
      const rx = Math.cos(yaw), rz = Math.sin(yaw);                 // right = fwd x up (y up)
      const ux = -fy * rz, uy = Math.cos(pitch), uz = fy * rx;     // up' = right x fwd
      const dx = P[0] - cam[0], dy = P[1] - cam[1], dz = P[2] - cam[2];
      const zc = dx * fx + dy * fy + dz * fz;
      if (zc <= 0.1) return null;
      return [(dx * rx + dz * rz) / (zc * th), (dx * ux + dy * uy + dz * uz) / (zc * tv)];
    };
    const midY = (safe.top + safe.bottom) / 2;
    let best = null, bestOk = null;
    const AIM = [0.7, 0.2, 0];                                       // aim near the facade (centred front) or the box centre
    const DK = aspect > 1 ? [0.6, 0.8, 1, 1.25, 1.55, 1.9, 2.4, 3.0, 3.7, 4.5] : [0.6, 0.8, 1, 1.25, 1.55, 1.9, 2.4, 3.0];   // landscape: farther, flatter
    const wLo = aspect > 1 ? 0.15 : 0.45, wHi = aspect > 1 ? 0.4 : 0.68, wMid = (wLo + wHi) / 2;
    for (const sd of [pref, -pref]) for (const ang of [0.15, 0.3, 0.45, 0.6]) for (const dk of DK) for (const lift of [3, 7, 12, 18, 26]) for (const aim of AIM) {
      const d = dist * dk;
      const x = hx + sd * Math.sin(ang) * d, z = front + face * Math.cos(ang) * d;
      let y = Math.max(top + lift, heightAt(x, z) + 2);
      for (let ddz = -3; ddz <= 3; ddz += 3) for (let ddx = -3; ddx <= 3; ddx += 3) y = Math.max(y, heightAt(x + ddx, z + ddz) + 1.2);
      // aim at the home's centre, then tilt so it sits at the middle of the safe band
      const az0 = hz + (front - hz) * aim, ax = hx - x, az = az0 - z, ah = Math.hypot(ax, az);   // aim near the facade, not the box centre: the front sits centred
      const yaw = Math.atan2(ax, -az);
      const pitch = -Math.atan2(y - top * 0.5, ah) - Math.atan(midY * tv);
      const cam = [x, y, z];
      let ok = true, minX = 9, maxX = -9, minY = 9, maxY = -9;
      const P = PROJ;
      for (let k = 0; k < 8; k++) {
        const pr = P[k] = project(cam, yaw, pitch, corners[k]);
        if (!pr || Math.abs(pr[0]) > safe.side || pr[1] > safe.top || pr[1] < safe.bottom) { ok = false; }
        if (pr) { minX = Math.min(minX, pr[0]); maxX = Math.max(maxX, pr[0]); minY = Math.min(minY, pr[1]); maxY = Math.max(maxY, pr[1]); }
      }
      const width = (maxX - minX) / 2;                              // fraction of the screen width
      if (width < wLo || width > wHi) ok = false;
      const pin = project(cam, yaw, pitch, [hx, top + 3.2, front - face * 1.2]);
      if (!pin || pin[1] > safe.top) ok = false;
      // door sight line
      const door = [doorX, 1.2, front + face * 0.2];
      for (let t = 0.08; t < 0.95 && ok; t += 0.06) {
        const sx = x + (door[0] - x) * t, sz = z + (door[2] - z) * t, sy = y + (door[1] - y) * t;
        if (Math.hypot(sx - hx, sz - hz) > 6 && heightAt(sx, sz) > sy) ok = false;
      }
      let occl = 0;
      const ux = ax / ah, uz = az / ah;
      for (let fwd = 2; fwd <= 22; fwd += 4) for (let lat = -8; lat <= 8; lat += 4) {
        const px = x + ux * fwd - uz * lat, pz = z + uz * fwd + ux * lat;
        if (Math.hypot(px - hx, pz - hz) < 7) continue;
        const hh = heightAt(px, pz);
        if (hh > y - 2) occl += 2; else if (hh > 4 && fwd < 14) occl += 1;
      }
      if (heightAt(x, z) > 0) occl += 8;
      // composition (round R, ranked inside the hard gates): the home 45-60 % of the safe band's height, the
      // facade centred (x 45-55 %), and more facade than roof on screen
      let comp = 0, cm = null;
      if (ok) {
        const hgt = (maxY - minY) / (safe.top - safe.bottom);
        comp += Math.max(0, 0.45 - hgt, hgt - 0.6) * 12;
        const fr = FRONT, fc = (P[fr[0]][0] + P[fr[1]][0] + P[fr[2]][0] + P[fr[3]][0]) / 4;
        comp += Math.max(0, Math.abs(fc) - 0.1) * 10;
        const fa = quadArea(P, fr), ra = quadArea(P, ROOF4);
        if (fa < ra) comp += 3 + (ra - fa) / Math.max(fa, 1e-3);
        cm = { hgt, fc, front: fa, roof: ra, pitch };
        if (aspect > 1) comp += Math.max(0, -0.45 - pitch) * 20;     // landscape: flatter than -0.45 rad where the gates allow it
      }
      const score = occl + Math.abs(width - wMid) * 4 + ang + comp + (ok ? 0 : 100);
      const c = { x, y, z, yaw, pitch, score, cm };
      if (ok && (!bestOk || score < bestOk.score)) bestOk = c;
      if (!best || score < best.score) best = c;
    }
    const pick = bestOk || best;
    const { x, y, z, yaw, pitch } = pick;
    return { x, y, z, yaw, pitch, fixed: true, framed: !!bestOk, comp: pick.cm, bx, bz, slot, zone, tx: hx, tz: hz, ty: top, px: hx, py: top + 0.6, pz: front - face * 1.2 };   // pin on the roof's front edge, clear of a custom's ornament (round R)
  }
  function lookAtYaw(v) {
    if (v.fixed) return v;                              // homeView already framed it
    const dx = v.tx - v.x, dz = v.tz - v.z;
    v.yaw = Math.atan2(dx, -dz);
    v.pitch = -Math.atan2(v.y - (v.ty * 0.6), Math.hypot(dx, dz));
    return v;
  }
  // the pin for an arrival view (the roof's front edge for homes; above the roof in the city)
  const pinFor = (v) => ({ x: v.px !== undefined ? v.px : v.tx, y: v.py !== undefined ? v.py : v.ty * 0.6 + 9, z: v.pz !== undefined ? v.pz : v.tz, key: plotKey(v.bx, v.bz, v.slot) });

  // A flight from cam to view v starting at `now`. The arc clears every building under the path (a short hop
  // through the towers would fly through them). Instant: the camera jumps and there is no flight (null).
  function planFly(cam, v, now, instant) {
    const from = { ...cam };
    const d = Math.hypot(v.x - cam.x, v.z - cam.z);
    if (instant) { Object.assign(cam, { x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch }); return null; }
    let dyaw = v.yaw - from.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    let clear = 0;
    const steps = Math.max(32, Math.min(600, Math.ceil(d / 10)));   // every <= 10 m (up to 6 km)
    for (let k = 1; k < steps; k++) {
      const t = k / steps, h = heightAt(from.x + (v.x - from.x) * t, from.z + (v.z - from.z) * t);
      const base = from.y + (v.y - from.y) * t, arc = Math.sin(Math.PI * t);
      if (h > 0 && h + 15 > base) clear = Math.max(clear, (h + 15 - base) / Math.max(0.05, arc));
    }
    return { from, to: v, dyaw, t0: now, dur: Math.min(7000, 1800 + Math.sqrt(d) * 45), lift: Math.min(1800, Math.max(d * 0.35, clear)) };
  }
  // moves cam along `fly` at time `now`; returns the flight, or null once it has landed
  function stepFly(fly, cam, now) {
    if (!fly) return null;
    let t = (now - fly.t0) / fly.dur;
    if (t >= 1) t = 1;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const a = fly.from, b = fly.to;
    cam.x = a.x + (b.x - a.x) * e; cam.z = a.z + (b.z - a.z) * e;
    cam.y = a.y + (b.y - a.y) * e + Math.sin(Math.PI * e) * fly.lift;
    const turn = Math.min(1, t * 2.5);
    const te = turn * turn * (3 - 2 * turn);
    cam.yaw = a.yaw + fly.dyaw * te;
    const midPitch = fly.lift > 200 ? -0.55 : b.pitch;
    cam.pitch = t < 0.5 ? a.pitch + (midPitch - a.pitch) * Math.min(1, t * 3) : midPitch + (b.pitch - midPitch) * Math.min(1, (t - 0.5) * 2.2);
    return t >= 1 ? null : fly;
  }
  return { plotInfo, homeTop, heightAt, plotAtWorld, pick, homeView, lookAtYaw, pinFor, planFly, stepFly, clear: () => PLOT.clear() };
}
