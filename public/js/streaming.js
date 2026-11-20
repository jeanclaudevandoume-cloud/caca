// Mesh streaming: which chunks / skyline tiles / mid-band tiles are wanted around the camera, the requests
// to the worker pool (through the supervisor), the replies and the upload queue. No DOM, no GL: upload and
// release are injected (tools/apptest.mjs drives this with a fake supervisor).
//  - A reply is uploaded only if its target still wants exactly that request (gone or superseded: dropped).
//  - Uploads are spread over frames (<= 512 KB per drain, nearest first) so streaming never hitches.
//  - A target that failed 3 times gives up (loaded, empty) instead of retrying forever.
import { PITCH, CHUNK, chunkLod, chunkLite, skyLite, regionKey, regionOf } from './town.js';
import { SKY, MID } from './mesher.js';
import { hyp2 } from './gfx.js';

export const MID_OUT = 1.9;
export const ckey = (x, z) => (x + 32768) * 65536 + (z + 32768);   // numeric map keys: no strings in the stream loop
const byWantD = (a, b) => a.d - b.d;
const byTargetDist = (a, b) => (a.t.d || 0) - (b.t.d || 0);

export function createStreamer({ sup, customFor, upload, release, isLow, radii, groundWin = { full: true }, onTick = () => {} }) {
  const chunks = new Map();     // key -> {cx,cz,lod,g,want,req,seen}
  const skies = new Map();      // key -> {rx,rz,g,req,seen}
  const mids = new Map();       // mid-band massing tiles beyond the house ring, same shape as skies
  const UPQ = [];
  const WANT = [], WANTP = [], SEEN = new Set(), SSEEN = new Set(), MSEEN = new Set();
  let lastStream = 0;
  const send = (msg, target, lod) => sup.request(msg, target, lod);

  function stream(now, cam, L, tallRegions) {
    if (!L || now - lastStream < 150) return;
    lastStream = now;
    onTick();
    const reqs = sup.reqs;
    const { r0, r1, rs } = radii();
    const C = CHUNK * PITCH;
    const ccx = Math.floor((cam.x + 24) / C), ccz = Math.floor((cam.z + 24) / C);
    const n = Math.ceil(r1 / C) + 1;
    // a big town: keep the ground window around the camera
    if (!groundWin.full && !groundWin.req) {
      const bx = Math.floor((cam.x + 24) / PITCH), bz = Math.floor((cam.z + 24) / PITCH);
      if (Math.max(Math.abs(bx - groundWin.cx), Math.abs(bz - groundWin.cz)) > 96) sup.request({ type: 'ground', cx: bx, cz: bz }, groundWin, 0);
    }
    // allocation-free (round M): pooled wants, numeric keys, reused sets
    const want = WANT;
    want.length = 0;
    for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      const ox = (cx * CHUNK + 1.5) * PITCH, oz = (cz * CHUNK + 1.5) * PITCH;
      const d = hyp2(Math.max(0, hyp2(ox - cam.x, oz - cam.z) - C * 0.7), cam.y);
      if (d > r1) continue;
      const prev = chunks.get(ckey(cx, cz));
      const w = WANTP[want.length] || (WANTP[want.length] = { cx: 0, cz: 0, d: 0, lod: 0 });
      w.cx = cx; w.cz = cz; w.d = d; w.lod = chunkLod(d, r0, prev ? prev.lod : -1);
      want.push(w);
    }
    want.sort(byWantD);
    const seen = SEEN;
    seen.clear();
    let budget = sup.workers.length * 3 - reqs.size;
    for (const w of want) {
      const key = ckey(w.cx, w.cz);
      seen.add(key);
      let c = chunks.get(key);
      if (!c) { c = { cx: w.cx, cz: w.cz, g: null, lod: -1, req: 0, loaded: false }; chunks.set(key, c); }
      c.seen = now; c.want = w.lod; c.d = w.d;
      // the outer half of the detail ring uses the lighter meshes (details there are sub-pixel anyway)
      const lite = chunkLite(isLow(), w.lod, w.d, r0, c.lite);
      if ((c.lod !== w.lod || c.stale || (c.g && c.lite !== lite)) && !c.req && budget > 0) {
        const custom = customFor(w.cx, w.cz);
        if (custom === undefined) continue;          // still downloading
        c.stale = false;
        c.lite = lite;
        send({ type: 'chunk', cx: w.cx, cz: w.cz, lod: w.lod, custom, lite }, c, w.lod);
        budget--;
      }
    }
    for (const [key, c] of chunks) {
      if (!seen.has(key) && now - c.seen > 3000) {
        if (c.req) { const r = reqs.get(c.req); if (r) r.dead = true; }
        release(c.g); c.gone = true; chunks.delete(key);
      }
    }
    // skyline tiles (2x2 data regions each)
    const R = SKY * PITCH;
    const rn = Math.ceil(rs / R) + 1;
    const crx = Math.floor((cam.x + 24) / R), crz = Math.floor((cam.z + 24) / R);
    const lim = Math.ceil((L.rB + 2) / SKY);
    const sseen = SSEEN;
    sseen.clear();
    for (let dz = -rn; dz <= rn; dz++) for (let dx = -rn; dx <= rn; dx++) {
      const rx = crx + dx, rz = crz + dz;
      if (Math.abs(rx) > lim || Math.abs(rz) > lim || !tallRegions.has(regionKey(rx, rz))) continue;
      const ox = (rx * SKY + SKY / 2 - 0.5) * PITCH, oz = (rz * SKY + SKY / 2 - 0.5) * PITCH;
      const dh = Math.max(0, hyp2(ox - cam.x, oz - cam.z) - R * 0.7);
      const d = hyp2(dh, cam.y);
      if (d > rs || hyp2(dh + R * 1.4, cam.y) < r1 * 0.72) continue;
      const key = ckey(rx, rz);
      sseen.add(key);
      let s = skies.get(key);
      if (!s) { s = { rx, rz, g: null, req: 0, loaded: false }; skies.set(key, s); }
      s.seen = now; s.d = d;
      const slite = skyLite(isLow(), d, s.lite);                             // far tiles: plain boxes, no crowns
      if ((!s.loaded || s.stale || s.lite !== slite) && !s.req && budget > 0) { s.stale = false; s.lite = slite; send({ type: 'sky', rx, rz, lite: slite }, s, 0); budget--; }
    }
    for (const [key, s] of skies) if (!sseen.has(key) && now - s.seen > 5000) { if (s.req) { const r = reqs.get(s.req); if (r) r.dead = true; } release(s.g); s.gone = true; skies.delete(key); }
    // mid-band tiles: the ring from where homes start to shrink out to MID_OUT x r1
    const midOut = isLow() ? MID_OUT : 1.35;               // high preset: r1 is already 1.1 km; a narrower massing ring
    const RM = MID * PITCH, mn = Math.ceil(r1 * midOut / RM) + 1;
    const cmx = Math.floor((cam.x + 24) / RM), cmz = Math.floor((cam.z + 24) / RM);
    MSEEN.clear();
    for (let dz = -mn; dz <= mn; dz++) for (let dx = -mn; dx <= mn; dx++) {
      const mx = cmx + dx, mz = cmz + dz;
      const ox = (mx * MID + MID / 2 - 0.5) * PITCH, oz = (mz * MID + MID / 2 - 0.5) * PITCH;
      const dh = hyp2(ox - cam.x, oz - cam.z);
      if (dh - RM * 0.71 > r1 * midOut || dh + RM * 0.71 < r1 * 0.72) continue;
      if ((mx * MID) ** 2 + (mz * MID) ** 2 > (L.rB + MID) ** 2) continue;
      const key = mx * 65536 + mz;
      MSEEN.add(key);
      let s = mids.get(key);
      if (!s) { s = { rx: mx, rz: mz, g: null, req: 0, loaded: false }; mids.set(key, s); }
      s.seen = now; s.d = dh;
      if ((!s.loaded || s.stale) && !s.req && budget > 0) { s.stale = false; send({ type: 'mid', rx: mx, rz: mz }, s, 0); budget--; }
    }
    for (const [key, s] of mids) if (!MSEEN.has(key) && now - s.seen > 5000) { if (s.req) { const r = reqs.get(s.req); if (r) r.dead = true; } release(s.g); s.gone = true; mids.delete(key); }
  }

  // a mesh reply for request r (from sup.reply): queued for upload if its target still wants it
  function onMesh(m, r) {
    if (!r) return;
    const t = r.target;
    if (t.req !== m.id) return;      // superseded
    if (r.dead) { t.req = 0; return; }
    UPQ.push({ t, m, lod: r.lod, id: m.id });     // uploaded from the frame loop; t.req stays set until then (no re-requests)
  }
  // an error reply: only the request that failed is released; after 3 tries the target gives up
  function onError(m, r) {
    if (r && r.target.req === m.id) {
      const t = r.target;
      t.req = 0; t.fails = (t.fails || 0) + 1;
      if (t.fails >= 3) { t.loaded = true; t.lod = r.lod; }
    }
  }
  function drain(maxBytes = 512 * 1024) {
    if (!UPQ.length) return;
    UPQ.sort(byTargetDist);
    let bytes = 0;
    while (UPQ.length && (bytes < maxBytes || !bytes)) {
      const { t, m, lod, id } = UPQ.shift();
      if (t.gone || t.req !== id) continue;
      t.req = 0;
      bytes += m.vb.byteLength + m.ib.byteLength;
      const g = m.ib.length ? upload(m) : null;
      release(t.g);
      t.g = g; t.lod = lod; t.loaded = true;
    }
  }
  // after a layout update: rebuild the ring of new homes (beyond the old town's edge) and regions in `changed`
  function flushChanged(old, changed) {
    const ring = Math.max(0, Math.floor(Math.sqrt(old.maxD2)) - 1);
    for (const c of chunks.values()) {
      const bx = c.cx * CHUNK, bz = c.cz * CHUNK;
      const far = Math.max(Math.abs(bx + 2), Math.abs(bz + 2)) + 3 >= ring;
      if (far || changed.has(regionKey(regionOf(bx), regionOf(bz)))) c.stale = true;
    }
    for (const s of skies.values()) s.stale = true;
    for (const s of mids.values()) s.stale = true;
  }
  function idle() {
    if (sup.reqs.size || UPQ.length) return false;
    for (const c of chunks.values()) if (c.lod !== c.want || c.stale) return false;
    for (const s of skies.values()) if (!s.loaded) return false;
    for (const s of mids.values()) if (!s.loaded) return false;
    return true;
  }
  return { chunks, skies, mids, UPQ, stream, onMesh, onError, drain, flushChanged, idle };
}
