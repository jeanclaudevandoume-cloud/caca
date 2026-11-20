// Builds the layout, the ground data texture and chunk/skyline meshes off the main thread.
// Custom-home files are fetched once by the main thread and arrive with each chunk request.
import { buildLayout, buildGround, finishLayout, layoutTransfer, regionKey, fdiv, CHUNK, REGION } from './town.js';
import { buildChunk, buildSkyline, buildMid } from './mesher.js';

let L = null;
const customs = new Map();          // regionKey -> {line: spec} | null

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
    if (m.layout) { L = finishLayout(m.layout); customs.clear(); }   // the main thread committed this layout
    else {
      // build a new layout into a local: this worker keeps meshing the current one until the main thread
      // commits the new one (it may reject it), and a failed build changes nothing here
      const nl = buildLayout(m.n);                              // a few small tables: no per-block arrays
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
    } else if (m.type === 'mid') r = buildMid(L, m.rx, m.rz);
    else r = buildSkyline(L, m.rx, m.rz, !!m.lite);
    postMessage({ type: 'mesh', id: m.id, vb: r.vb, ib: r.ib, so: r.so, ns: r.ns, ymax: r.ymax }, [r.vb, r.ib.buffer]);
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String((err && err.stack) || err) });
  }
};
