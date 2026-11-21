// Where things are and where the camera goes: per-plot footprints and heights, picking, the home-arrival
// camera and the fly-to arc. No DOM; the layout is read live from `app.L` (tools/apptest.mjs drives this).
import { PITCH, FLOOR_H, K, plotOf, plotFrame, recipe, zoneLevel, kindAt, slotAt, plotIndex, homeRect, hash3 } from './town.js';
import { mulv } from './gfx.js';

export const plotKey = (bx, bz, slot) => ((bx + 32768) * 65536 + (bz + 32768)) * 16 + slot;

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
    const s = slotAt(zone, x - bx * PITCH, z - bz * PITCH);
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
    const s = slotAt(zone, x - bx * PITCH, z - bz * PITCH);
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
    let best = null;
    // round P: more candidate angles, and each is also scored for foreground occluders: anything within 22 m of
    // the camera, in the lower half of the view, that rises above eye height minus 2 m (a neighbour's roof
    // filling a third of the portrait was the arrival's main flaw)
    const cands = [];
    for (const sd of [pref, -pref]) for (const ang of [0.44, 0.36, 0.56]) cands.push([hx + sd * Math.sin(ang) * dist, front + face * Math.cos(ang) * dist]);
    for (const sd of [pref, -pref]) for (const k of [0.6, 0.8]) cands.push([hx + sd * Math.max(15, dist * k), front + face * 4.5]);   // standing in the lane (further back on a narrow portrait screen)
    for (const [x, z] of cands) {
      let y = Math.max(9, Math.min(14, top + 4));
      y = Math.max(y, heightAt(x, z) + 2);                // above the house opposite, never inside it
      // and above every roof within 3 m: a camera beside a taller neighbour made the flight's last metre cut
      // through that roof's corner (found by tools/apptest.mjs)
      for (let ddz = -3; ddz <= 3; ddz += 3) for (let ddx = -3; ddx <= 3; ddx += 3) y = Math.max(y, heightAt(x + ddx, z + ddz) + 1.2);
      let block = 0;
      for (let t = 0.1; t < 0.85; t += 0.05) {
        const sx = x + (hx - x) * t, sz = z + (front - z) * t, sy = y + (top * 0.5 - y) * t;
        block = Math.max(block, heightAt(sx, sz) - sy);
      }
      let occl = 0;
      const ax = hx - x, az = front - z, al = Math.hypot(ax, az), ux = ax / al, uz = az / al;
      for (let fwd = 2; fwd <= 22; fwd += 3) for (let lat = -8; lat <= 8; lat += 4) {
        const px = x + ux * fwd - uz * lat, pz = z + uz * fwd + ux * lat;
        if (Math.hypot(px - hx, pz - hz) < 7) continue;     // the home itself
        const hh = heightAt(px, pz);
        if (hh > y - 2) occl += 2;                          // rises into the view
        else if (hh > 4 && fwd < 14) occl += 1;             // a roof just under the camera fills the lower frame
      }
      if (heightAt(x, z) > 0) occl += 8;                    // never hover right above a house
      const score = Math.max(0, block) * 2 + occl;
      if (!best || score < best.score) best = { x, y, z, block, score };
    }
    const { x, z } = best, y = best.y + Math.max(0, best.block + 1);
    // aim a third of the way from the centre to the front door (the door is on the open side of a jutaku)
    const r = recipe(bx, bz, slot, zone, null);
    const doorX = zone === 0 && r.side ? (r.side > 0 ? q[0] + 1.3 : q[2] - 1.3) : hx;
    const aimX = hx + (doorX - hx) / 3;
    const dx = aimX - x, dz = (front - face * 1) - z, dh = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, -dz), pitch = -Math.atan2(y - top * 0.5, dh) - vfov * 0.12;   // home at ~38% from the top
    return { x, y, z, yaw, pitch, fixed: true, bx, bz, slot, zone, tx: hx, tz: hz, ty: top, px: hx, py: top + 0.6, pz: front - face * 2.5 };   // pin on the roof's front edge: it can't read as the house behind
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
