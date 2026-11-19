// Builds the layout, the ground data texture and chunk/skyline meshes off the main thread.
// Custom-home files are fetched once by the main thread and arrive with each chunk request.
import { buildLayout, buildGround, finishLayout, layoutTransfer, regionKey, fdiv, CHUNK, REGION } from './town.js';
import { buildChunk, buildSkyline } from './mesher.js';

let L = null;
const customs = new Map();          // regionKey -> {line: spec} | null

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    customs.clear();
    if (m.layout) L = finishLayout(m.layout);
    else {
      L = buildLayout(m.n);
      const g = buildGround(L);
      postMessage({ type: 'layout', layout: layoutTransfer(L), ground: g }, [g.data.buffer]);
    }
    return;
  }
  try {
    let r;
    if (m.type === 'chunk') {
      customs.set(regionKey(fdiv(m.cx * CHUNK, REGION), fdiv(m.cz * CHUNK, REGION)), m.custom || null);
      r = buildChunk(L, m.cx, m.cz, m.lod, customs);
    } else r = buildSkyline(L, m.rx, m.rz);
    postMessage({ type: 'mesh', id: m.id, vb: r.vb, ib: r.ib, ns: r.ns, ymax: r.ymax }, [r.vb, r.ib.buffer]);
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String((err && err.stack) || err) });
  }
};
