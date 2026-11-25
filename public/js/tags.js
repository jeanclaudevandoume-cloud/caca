// Name tags: which homes get a tag (scanTags) and where they go on screen (placeTags). No DOM: drawing is
// ui.js's job; names, heights and text widths are injected (tools/apptest.mjs drives this).
//  - Rescans only when the camera moved (a still camera keeps its tags), at most every 300 ms, not during a
//    flight; candidates live in a pool and keep their name only while they hold the same plot.
//  - Occlusion is tested at the scan, not per frame (heightAt runs the house recipe).
//  - Placement: at most 24, no overlaps, never under the search bar or the round buttons; while a home is
//    selected only its own name shows.
import { PITCH, K, kindAt, zoneLevel, plotFrame } from './town.js';
import { occupied } from './layout.js';
import { hyp2, hyp3, mulv } from './gfx.js';
import { plotKey } from './view.js';

export const MAX_TAGS = 24;

export function createTagState() {
  return {
    list: [], lastScan: 0, cand: [], sort: [], f: {}, cam: new Float64Array([NaN, 0, 0, 0, 0]),
    epoch: 0, memo: new Map(),            // plotKey -> name, so tags never blink between scans
    placed: new Float64Array(MAX_TAGS * 3), tv: new Float64Array([0, 0, 0, 1]), tc: new Float64Array(4),   // typed: an Array cleared with length = 0 reallocated every frame (round Q: 7.5 KB/frame)
    draw: [], keys: [], xy: new Float64Array(MAX_TAGS * 3), used: -1, sig: 0,   // used -1: the first placement always draws
  };
}
// a new layout or manifest: names may have changed
export function resetTags(st) {
  st.memo.clear(); st.epoch++; st.cam[0] = NaN;
  for (const c of st.cand) { c.key = -1; c.name = null; c.pending = -1; }
}

export function scanTags(st, now, cam, L, flying, view, nameOf) {
  // NaN in st.cam compares false with <=, so the first scan always runs
  const moved = !(Math.abs(cam.x - st.cam[0]) + Math.abs(cam.y - st.cam[1]) + Math.abs(cam.z - st.cam[2]) <= 1) || Math.abs(cam.yaw - st.cam[3]) + Math.abs(cam.pitch - st.cam[4]) > 0.01;
  if (!(now - st.lastScan > 300 && !flying && moved)) return false;   // names arriving later fill in without a rescan
  st.cam[0] = cam.x; st.cam[1] = cam.y; st.cam[2] = cam.z; st.cam[3] = cam.yaw; st.cam[4] = cam.pitch;
  st.lastScan = now;
  const R = cam.y < 60 ? 140 : 0;
  // scan around a point ahead of the camera, where the homes on screen are
  const ax = cam.x + Math.sin(cam.yaw) * R * 0.7, az = cam.z - Math.cos(cam.yaw) * R * 0.7;
  const SORT = st.sort, CAND = st.cand;
  let n = 0;
  SORT.length = 0;
  if (R) {
    const b0x = Math.floor((ax - R + 24) / PITCH), b1x = Math.floor((ax + R + 24) / PITCH);
    const b0z = Math.floor((az - R + 24) / PITCH), b1z = Math.floor((az + R + 24) / PITCH);
    const f = st.f;
    for (let bz = b0z; bz <= b1z; bz++) for (let bx = b0x; bx <= b1x; bx++) {
      if (kindAt(L, bx, bz) !== K.HOMES) continue;
      const zone = zoneLevel(bx, bz), occ = occupied(L, bx, bz);
      for (let s = 0; s < occ; s++) {
        plotFrame(bx, bz, s, zone, f);
        if (hyp2(f.x - ax, f.z - az) > R) continue;
        const c = CAND[n] || (CAND[n] = { key: -1, name: null });
        const key = plotKey(bx, bz, s);
        if (c.key !== key) { c.key = key; c.name = st.memo.get(key) || null; }
        c.bx = bx; c.bz = bz; c.s = s; c.x = f.x; c.z = f.z; c.y = view.homeTop(bx, bz, s, zone) + 2.5;
        c.d = hyp3(f.x - cam.x, f.z - cam.z, cam.y);
        SORT.push(c); n++;
      }
    }
  }
  // the 40 nearest by partial selection (Array.sort allocates its merge buffers)
  const list = st.list;
  list.length = 0;
  for (let k = 0; k < 40 && k < SORT.length; k++) {
    let m = k;
    for (let q = k + 1; q < SORT.length; q++) if (SORT[q].d < SORT[m].d) m = q;
    const tmp = SORT[k]; SORT[k] = SORT[m]; SORT[m] = tmp;
    list.push(SORT[k]);
  }
  for (const t of list) {
    t.hidden = false;
    for (let k = 1; k < 6 && !t.hidden; k++) {
      const f = k / 6, x = cam.x + (t.x - cam.x) * f, y = cam.y + (t.y - cam.y) * f, z = cam.z + (t.z - cam.z) * f;
      if (hyp2(x - t.x, z - t.z) > 8 && (y < view.heightAt(x, z) || view.inRail(x, y, z))) t.hidden = true;
    }
  }
  for (const t of list) {
    if (t.name || t.pending === t.key) continue;
    const key = t.key;
    t.pending = key;
    const ep = st.epoch;
    nameOf(t.bx, t.bz, t.s).then((nm) => {
      if (ep !== st.epoch) return;
      if (nm === null) { if (t.key === key) t.pending = -1; st.cam[0] = NaN; return; }   // network error: retry at the next scan
      st.memo.set(key, nm); if (t.key === key) t.name = nm;
    });
  }
  if (st.memo.size > 5000) st.memo.clear();
  return true;
}

// Places the scanned tags for view-projection VP on a W x H screen. ui = { top, toolsX, toolsY } (screen
// rectangles to keep clear), pinKey = the selected home's plotKey or undefined, measure(name) -> { cw, id }.
// Writes st.draw[i] (the measure result), st.keys[i] (the plot), st.xy[i*3..] = x, y, opacity*20; returns true if anything changed.
export function placeTags(st, VP, W, H, ui, pinKey, measure) {
  const placed = st.placed, TV = st.tv, TC = st.tc;
  let used = 0, sig = 0, np = 0;
  const list = st.list;
  for (let i = 0; i < list.length; i++) {             // indexed: for-of allocated iterator results here (~7 KB/frame)
    const t = list[i];
    if (!t.name || used >= MAX_TAGS) continue;
    TV[0] = t.x; TV[1] = t.y; TV[2] = t.z; TV[3] = 1;
    const c = mulv(VP, TV, TC);
    if (c[3] <= 0.5) continue;
    const sx = (c[0] / c[3] * 0.5 + 0.5) * W, sy = (0.5 - c[1] / c[3] * 0.5) * H;
    if (sx < -50 || sx > W + 50 || sy < -20 || sy > H + 20) continue;
    if (t.hidden) continue;                     // behind a building (tested at the last scan)
    if (pinKey !== undefined && t.key !== pinKey) continue;   // a home is selected: only its name (closing the card brings the others back)
    const b = measure(t.name);
    const w = b.cw;
    if (sy - 26 < ui.top || (sx + w / 2 > ui.toolsX && sy > ui.toolsY)) continue;
    let clash = false;
    for (let q = 0; q < np; q += 3) if (Math.abs(placed[q] - sx) < (placed[q + 2] + w) / 2 && Math.abs(placed[q + 1] - sy) < 20) { clash = true; break; }
    if (clash) continue;
    placed[np] = sx; placed[np + 1] = sy; placed[np + 2] = w; np += 3;
    const ix = Math.round(sx), iy = Math.round(sy), op = Math.round(Math.max(0.45, 1 - t.d / 400) * 20);
    st.draw[used] = b; st.keys[used] = t.key; st.xy[used * 3] = ix; st.xy[used * 3 + 1] = iy; st.xy[used * 3 + 2] = op;
    sig = (sig * 31 + ix * 7 + iy * 13 + op + b.id) | 0;
    used++;
  }
  if (sig === st.sig && used === st.used) return false;
  st.sig = sig; st.used = used;
  return true;
}
