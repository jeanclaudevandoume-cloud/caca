// Builds the layout and chunk/skyline meshes off the main thread.
import { buildLayout, finishLayout, layoutTransfer, regionKey, fdiv, CHUNK, REGION } from './town.js';
import { buildChunk, buildSkyline } from './mesher.js';

let L = null, manifest = null;
const BASE = new URL('../town/', import.meta.url).href;
const customs = new Map();          // regionKey -> {line: spec} | null
const loading = new Map();

function getCustom(rx, rz) {
  const key = regionKey(rx, rz);
  if (customs.has(key)) return null;
  if (!manifest.c || !manifest.c[key]) { customs.set(key, null); return null; }
  if (!loading.has(key)) {
    loading.set(key, fetch(`${BASE}c/${key}.json?v=${manifest.c[key]}`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => { customs.set(key, j); loading.delete(key); }));
  }
  return loading.get(key);
}

const queue = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const m = queue.shift();
    try {
      if (m.type === 'chunk') {
        const p = getCustom(fdiv(m.cx * CHUNK, REGION), fdiv(m.cz * CHUNK, REGION));
        if (p) await p;
        const r = buildChunk(L, m.cx, m.cz, m.lod, customs);
        postMessage({ type: 'mesh', id: m.id, vb: r.vb, ib: r.ib, ns: r.ns, ymax: r.ymax }, [r.vb, r.ib.buffer]);
      } else if (m.type === 'sky') {
        const r = buildSkyline(L, m.rx, m.rz);
        postMessage({ type: 'mesh', id: m.id, vb: r.vb, ib: r.ib, ns: r.ns, ymax: r.ymax }, [r.vb, r.ib.buffer]);
      }
    } catch (e) {
      postMessage({ type: 'error', id: m.id, message: String(e && e.stack || e) });
    }
  }
  busy = false;
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    manifest = m.manifest;
    if (m.layout) L = finishLayout(m.layout);
    else {
      L = buildLayout(manifest.n);
      const t = layoutTransfer(L);
      postMessage({ type: 'layout', layout: t });
    }
    for (const k of m.flush || []) customs.delete(k);
    return;
  }
  if (m.type === 'cancel') {
    const ids = new Set(m.ids);
    for (let i = queue.length - 1; i >= 0; i--) if (ids.has(queue[i].id)) queue.splice(i, 1);
    return;
  }
  queue.push(m);
  pump();
};
