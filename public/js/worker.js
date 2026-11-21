// Builds the layout, the ground data texture and chunk/skyline meshes off the main thread.
// Custom-home files are fetched once by the main thread and arrive with each chunk request.
import { buildLayout, layoutFromBin, buildGround, finishLayout, layoutTransfer, regionKey, fdiv, CHUNK, REGION } from './town.js';
import { buildChunk, buildSkyline, buildMid } from './mesher.js';
import { buildAtlas } from './atlas.js';

let L = null;
const customs = new Map();          // regionKey -> {line: spec} | null

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'atlas') {                                    // paint the facade atlas off the main thread
    let img = null;
    try { if (typeof OffscreenCanvas !== 'undefined') img = buildAtlas(); } catch { img = null; }
    if (img) postMessage({ type: 'atlas', data: img.data.buffer }, [img.data.buffer]);
    else postMessage({ type: 'atlas', data: null });
    return;
  }
  if (m.type === 'init') {
    try {
    if (m.layout) { L = finishLayout(m.layout); customs.clear(); }   // the main thread committed this layout
    else {
      // build a new layout into a local: this worker keeps meshing the current one until the main thread
      // commits the new one (it may reject it), and a failed build changes nothing here
      const nl = layoutFromBin(m.n, m.order) || buildLayout(m.n);   // prebuilt tables (layout.bin) or the counting pass
      const g = buildGround(nl);
      postMessage({ type: 'layout', build: m.build, layout: layoutTransfer(nl), ground: g }, [g.data.buffer]);
    }
    } catch (err) { postMessage({ type: 'error', fatal: true, build: m.build, message: 'layout: ' + String((err && err.stack) || err) }); }
    return;
  }
  try {
    let r;
    if (m.type === 'chunk') {
      customs.set(regionKey(fdiv(m.cx * CHUNK, REGION), fdiv(m.cz * CHUNK, REGION)), m.custom || null);
      r = buildChunk(L, m.cx, m.cz, m.lod, customs, !!m.lite);
    } else if (m.type === 'ground') {                         // a new ground window around the camera
      const g = buildGround(L, m.cx, m.cz);
      postMessage({ type: 'ground', id: m.id, ground: g }, [g.data.buffer]);
      return;
    } else if (m.type === 'mid') r = buildMid(L, m.rx, m.rz);
    else r = buildSkyline(L, m.rx, m.rz, !!m.lite);
    postMessage({ type: 'mesh', id: m.id, vb: r.vb, ib: r.ib, so: r.so, ns: r.ns, ymax: r.ymax }, [r.vb, r.ib.buffer]);
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String((err && err.stack) || err) });
  }
};
