// Follower Town — GL setup, camera, streaming, time of day, search, fly-to, tags, quality.
import {
  PITCH, CHUNK, REGION, FLOOR_H, K, fdiv, finishLayout, plotOf, plotFrame, recipe, zoneLevel, cellKind, kindAt,
  occupied, slotAt, plotIndex, regionKey, regionOf, lineIndex, normName, shardFor,
} from './town.js';
import { MB, M } from './mesher.js';
import { GEO_VS, GEO_FS, SHADOW_VS, SHADOW_FS, FULL_VS, FULL_FS } from './shaders.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const hashParams = () => new URLSearchParams(location.hash.slice(1));
const TOWN = 'town/';

// ---------------- GL ----------------
const canvas = $('#c');
const qParam = params.get('q') || 'auto';
const gl = canvas.getContext('webgl2', { antialias: qParam !== 'low', stencil: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
if (!gl) { $('#loading').textContent = 'This town needs WebGL2. Try a newer browser.'; throw new Error('no webgl2'); }
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setTimeout(() => location.reload(), 500); });

function prog(vs, fs) {
  const p = gl.createProgram();
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(t);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n'));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}
const P = { geo: prog(GEO_VS, GEO_FS), shadow: prog(SHADOW_VS, SHADOW_FS), full: prog(FULL_VS, FULL_FS) };
const fullVao = gl.createVertexArray();
let pinMesh = null, pin = null;   // marker over the selected home

function upload(m) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, m.vb, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.SHORT, false, 16, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.UNSIGNED_BYTE, false, 16, 6);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.BYTE, true, 16, 8);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, false, 16, 11);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, 16, 12);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.ib, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, vbo, ibo, n: m.ib.length, ns: m.ns, ymax: m.ymax, bytes: m.vb.byteLength + m.ib.byteLength };
}
function release(g) { if (!g) return; gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.vbo); gl.deleteBuffer(g.ibo); }

// ---------------- matrices ----------------
function persp(fovy, aspect, n, f) {
  const t = 1 / Math.tan(fovy / 2);
  return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]);
}
function lookDir(e, f) {
  let sx = -f[2], sz = f[0]; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;   // side = f x up
  const ux = -sz * f[1], uy = sz * f[0] - sx * f[2], uz = sx * f[1];               // up = side x f
  return new Float32Array([sx, ux, -f[0], 0, 0, uy, -f[1], 0, sz, uz, -f[2], 0,
    -(sx * e[0] + sz * e[2]), -(ux * e[0] + uy * e[1] + uz * e[2]), f[0] * e[0] + f[1] * e[1] + f[2] * e[2], 1]);
}
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function invert(m) {
  const inv = new Float64Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = 1 / (m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12]);
  const o = new Float32Array(16);
  for (let i = 0; i < 16; i++) o[i] = inv[i] * det;
  return o;
}
function planes(m) {
  const p = [];
  for (const [i, s] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1]]) {
    const a = m[3] + s * m[i], b = m[7] + s * m[4 + i], c = m[11] + s * m[8 + i], d = m[15] + s * m[12 + i];
    const l = Math.hypot(a, b, c);
    p.push([a / l, b / l, c / l, d / l]);
  }
  return p;
}
const inFrustum = (pl, x, y, z, r) => pl.every((p) => p[0] * x + p[1] * y + p[2] * z + p[3] > -r);

// ---------------- state ----------------
const HOME = { x: 520, y: 260, z: 760, yaw: -0.6, pitch: -0.3 };
const cam = { ...HOME };
const PRESETS = { low: { s: 0.55, pr: 1 }, mid: { s: 0.8, pr: 1.5 }, high: { s: 1, pr: 2 } };
const isPhone = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;
const quality = { mode: qParam, ...(qParam === 'high' ? PRESETS.high : qParam === 'low' ? PRESETS.low : isPhone ? PRESETS.low : PRESETS.mid) };
quality.maxS = quality.s; quality.maxPr = quality.pr;
const radii = () => ({ r0: 320 * Math.max(0.6, quality.s), r1: 1400 * quality.s, rs: 7000 * quality.s });
const stats = { tris: 0, draws: 0, sky: 0, chunks: 0, mb: 0, fps: 0, ms: 0 };
let manifest = null, L = null, ready = false;
const chunks = new Map();     // key -> {cx,cz,lod,g,want,req,seen}
const skies = new Map();      // key -> {rx,rz,g,req,seen}
const t0 = performance.now();
const frozenT = params.has('t') ? parseFloat(params.get('t')) : null;
let tod = params.has('tod') ? parseFloat(params.get('tod')) : 0.22;
const showTags = !params.has('notags');

{ const c = params.get('cam'); if (c) { const v = c.split(',').map(Number); if (v.length === 5 && v.every(Number.isFinite)) Object.assign(cam, { x: v[0], y: v[1], z: v[2], yaw: v[3], pitch: v[4] }); } }

// ---------------- workers ----------------
const NW = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
const workers = [];
const reqs = new Map();
let nextId = 1;
function onWorker(e) {
  const m = e.data;
  if (m.type === 'layout') { onLayout(m.layout); return; }
  const r = reqs.get(m.id);
  reqs.delete(m.id);
  if (r) r.w.load--;
  if (m.type === 'error') { console.error(m.message); if (r) r.target.req = 0; return; }
  if (!r) return;
  const t = r.target;
  if (t.req !== m.id) return;      // superseded
  t.req = 0;
  if (r.dead) return;
  const g = m.ib.length ? upload(m) : null;
  release(t.g);
  t.g = g; t.lod = r.lod; t.loaded = true;
}
for (let i = 0; i < NW; i++) {
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  w.load = 0; w.onmessage = onWorker; w.onerror = (e) => console.error('worker', e.message);
  workers.push(w);
}
function send(msg, target, lod) {
  let w = workers[0];
  for (const x of workers) if (x.load < w.load) w = x;
  const id = nextId++;
  msg.id = id;
  w.load++;
  reqs.set(id, { w, target, lod });
  target.req = id;
  w.postMessage(msg);
}

// ---------------- boot ----------------
async function loadManifest() {
  const r = await fetch(TOWN + 'manifest.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('manifest ' + r.status);
  return r.json();
}
let layoutStage = null;
function onLayout(lt) {
  const nl = finishLayout(lt);
  const old = L;
  L = nl;
  for (let i = 1; i < workers.length; i++) workers[i].postMessage({ type: 'init', manifest, layout: lt, flush: layoutStage ? layoutStage.flush : [] });
  if (old && layoutStage) flushChanged(old, layoutStage.oldC);
  layoutStage = null;
  $('#count').textContent = L.n.toLocaleString() + ' homes';
  if (!ready) {
    ready = true;
    $('#loading').classList.add('gone');
    const u = params.get('u') || hashParams().get('u');
    if (u) flyToName(u, params.has('instant'));
  }
}
function flushChanged(old, oldC) {
  // only rebuild what changed: the ring of new homes and regions whose custom file changed
  const changed = new Set();
  for (const k of Object.keys(manifest.c || {})) if (!oldC || oldC[k] !== manifest.c[k]) changed.add(k);
  for (const k of Object.keys(oldC || {})) if (!manifest.c || !manifest.c[k]) changed.add(k);
  const ring = Math.max(0, Math.floor(Math.sqrt(old.maxD2)) - 1);
  for (const c of chunks.values()) {
    const bx = c.cx * CHUNK, bz = c.cz * CHUNK;
    const far = Math.max(Math.abs(bx + 2), Math.abs(bz + 2)) + 3 >= ring;
    if (far || changed.has(regionKey(regionOf(bx), regionOf(bz)))) c.stale = true;
  }
  for (const s of skies.values()) s.stale = true;
}
async function boot() {
  try { manifest = await loadManifest(); } catch (e) { $('#loading').textContent = 'No town data yet. Run: npm run demo'; throw e; }
  workers[0].postMessage({ type: 'init', manifest });
  setInterval(async () => {
    try {
      const m = await loadManifest();
      if (m.built !== manifest.built) {
        const oldC = manifest.c;
        manifest = m;
        layoutStage = { oldC, flush: Object.keys(m.c || {}).filter((k) => !oldC || oldC[k] !== m.c[k]) };
        workers[0].postMessage({ type: 'init', manifest, flush: layoutStage.flush });
        nameCache.clear();
      }
    } catch { /* offline: keep the town we have */ }
  }, 5 * 60 * 1000);
}

// ---------------- streaming ----------------
let lastStream = 0;
function stream(now) {
  if (!L || now - lastStream < 150) return;
  lastStream = now;
  const { r0, r1, rs } = radii();
  const C = CHUNK * PITCH;
  const ccx = Math.floor((cam.x + 24) / C), ccz = Math.floor((cam.z + 24) / C);
  const n = Math.ceil(r1 / C) + 1;
  const want = [];
  for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) {
    const cx = ccx + dx, cz = ccz + dz;
    const ox = (cx * CHUNK + 1.5) * PITCH, oz = (cz * CHUNK + 1.5) * PITCH;
    const d = Math.hypot(ox - cam.x, oz - cam.z) - C * 0.7;
    if (d > r1) continue;
    want.push({ cx, cz, d, lod: d < r0 ? 0 : 1 });
  }
  want.sort((a, b) => a.d - b.d);
  const seen = new Set();
  let budget = workers.length * 3 - reqs.size;
  for (const w of want) {
    const key = w.cx + ',' + w.cz;
    seen.add(key);
    let c = chunks.get(key);
    if (!c) { c = { cx: w.cx, cz: w.cz, g: null, lod: -1, req: 0, loaded: false }; chunks.set(key, c); }
    c.seen = now; c.want = w.lod; c.d = w.d;
    if ((c.lod !== w.lod || c.stale) && !c.req && budget > 0) {
      c.stale = false;
      send({ type: 'chunk', cx: w.cx, cz: w.cz, lod: w.lod }, c, w.lod);
      budget--;
    }
  }
  for (const [key, c] of chunks) {
    if (!seen.has(key) && now - c.seen > 3000) {
      if (c.req) { const r = reqs.get(c.req); if (r) r.dead = true; }
      release(c.g); chunks.delete(key);
    }
  }
  // skyline regions
  const R = REGION * PITCH;
  const rn = Math.ceil(rs / R) + 1;
  const crx = Math.floor((cam.x + 24) / R), crz = Math.floor((cam.z + 24) / R);
  const lim = Math.ceil((L.rB + 2) / REGION);
  const sseen = new Set();
  for (let dz = -rn; dz <= rn; dz++) for (let dx = -rn; dx <= rn; dx++) {
    const rx = crx + dx, rz = crz + dz;
    if (Math.abs(rx) > lim || Math.abs(rz) > lim) continue;
    const ox = (rx * REGION + 7.5) * PITCH, oz = (rz * REGION + 7.5) * PITCH;
    const d = Math.hypot(ox - cam.x, oz - cam.z) - R * 0.7;
    if (d > rs || d + R * 1.4 < r1 * 0.72) continue;
    const key = rx + ',' + rz;
    sseen.add(key);
    let s = skies.get(key);
    if (!s) { s = { rx, rz, g: null, req: 0, loaded: false }; skies.set(key, s); }
    s.seen = now;
    if ((!s.loaded || s.stale) && !s.req && budget > 0) { s.stale = false; send({ type: 'sky', rx, rz }, s, 0); budget--; }
  }
  for (const [key, s] of skies) if (!sseen.has(key) && now - s.seen > 5000) { if (s.req) { const r = reqs.get(s.req); if (r) r.dead = true; } release(s.g); skies.delete(key); }
}

// ---------------- time of day ----------------
// keys: 0 noon, 1 sunset, 2 night, 3 dawn (cycle of 4)
const KEYS = [
  { top: [0.22, 0.5, 0.93], hor: [0.72, 0.87, 1.0], sun: [1.05, 0.98, 0.88], sky: [0.5, 0.6, 0.78], gnd: [0.42, 0.38, 0.32], fog: [0.75, 0.86, 0.98], el: 0.95, night: 0 },
  { top: [0.24, 0.3, 0.6], hor: [1.0, 0.62, 0.4], sun: [1.05, 0.62, 0.36], sky: [0.42, 0.38, 0.55], gnd: [0.4, 0.3, 0.25], fog: [0.95, 0.68, 0.55], el: 0.12, night: 0.25 },
  { top: [0.015, 0.025, 0.08], hor: [0.06, 0.08, 0.18], sun: [0.22, 0.28, 0.42], sky: [0.22, 0.27, 0.45], gnd: [0.1, 0.1, 0.14], fog: [0.06, 0.08, 0.16], el: 0.9, night: 1 },
  { top: [0.3, 0.42, 0.75], hor: [1.0, 0.78, 0.62], sun: [1.0, 0.78, 0.56], sky: [0.45, 0.48, 0.65], gnd: [0.4, 0.34, 0.3], fog: [0.92, 0.8, 0.72], el: 0.14, night: 0.2 },
];
function todState(t) {
  t = ((t % 4) + 4) % 4;
  const i = Math.floor(t), f = t - i, a = KEYS[i], b = KEYS[(i + 1) % 4];
  const s = f * f * (3 - 2 * f);
  const L3 = (x, y) => x.map((v, k) => v + (y[k] - v) * s);
  const o = {};
  for (const k of ['top', 'hor', 'sun', 'sky', 'gnd', 'fog']) o[k] = L3(a[k], b[k]);
  o.night = a.night + (b.night - a.night) * s;
  const el = a.el + (b.el - a.el) * s;
  const az = 2.2 + t * 0.9;
  o.dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  return o;
}
function setTod(t) { tod = t; }

// ---------------- frame ----------------
let VP = null, invVP = null, PL = null;
let lastFrame = performance.now(), frameAcc = 0, frameN = 0, lastGov = performance.now();
const refresh = { samples: [], ms: 16.7 };
function resize() {
  const pr = Math.min(window.devicePixelRatio || 1, quality.pr);
  const w = Math.round(innerWidth * pr), h = Math.round(innerHeight * pr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = now - lastFrame; lastFrame = now;
  const dt = Math.min(0.1, dtMs / 1000);
  if (refresh.samples.length < 90) { refresh.samples.push(dtMs); if (refresh.samples.length === 90) { const s = refresh.samples.slice(30).sort((a, b) => a - b); refresh.ms = Math.max(6.9, s[s.length >> 1]); } }
  frameAcc += dtMs; frameN++;
  governor(now);
  updateInput(dt);
  updateFly(now);
  resize();
  stream(now);
  render(now);
  if (showTags) tags(now);
  if (params.has('debug')) $('#debug').textContent = `${stats.fps} fps · ${(stats.tris / 1000) | 0}k tris · ${stats.draws} draws · ${stats.sky} sky · ${stats.chunks} chunks · ${stats.mb} MB · pr ${quality.pr.toFixed(2)} s ${quality.s.toFixed(2)}`;
}

function render(now) {
  const time = frozenT ?? (now - t0) / 1000;
  const W = canvas.width, H = canvas.height;
  gl.viewport(0, 0, W, H);
  const T = todState(tod);
  const fwd = [Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch)];
  const near = Math.min(20, Math.max(0.4, cam.y * 0.02));
  const proj = persp((60 * Math.PI) / 180, W / H, near, 40000);
  VP = mul(proj, lookDir([cam.x, cam.y, cam.z], fwd));
  invVP = invert(VP);
  PL = planes(VP);
  const { r0, r1 } = radii();
  const fogD = Math.max(2600, 3200 + cam.y * 5) * (0.75 + 0.25 * quality.s);

  gl.clearColor(T.fog[0], T.fog[1], T.fog[2], 1);
  gl.clearStencil(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
  gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);

  const setCommon = (u) => {
    gl.uniform3fv(u.uSunDir, T.dir); gl.uniform3fv(u.uSunCol, T.sun); gl.uniform3fv(u.uSkyCol, T.sky); gl.uniform3fv(u.uGndCol, T.gnd);
    gl.uniform3fv(u.uFogCol, T.fog); gl.uniform3fv(u.uSkyTop, T.top); gl.uniform3fv(u.uSkyHor, T.hor);
    gl.uniform1f(u.uFogD, fogD); gl.uniform1f(u.uNight, T.night); gl.uniform1f(u.uTime, time);
    gl.uniform3f(u.uCam, cam.x, cam.y, cam.z);
  };
  let tris = 0, draws = 0, sky = 0, bytes = 0;
  const geo = P.geo;
  gl.useProgram(geo.p);
  setCommon(geo.u);
  gl.uniformMatrix4fv(geo.u.uVP, false, VP);
  const fadeA = r1 * 0.72, fadeB = r1 * 0.96;
  gl.uniform4f(geo.u.uLod, fadeA, fadeB, 0, 0);
  const R = CHUNK * PITCH * 0.75;
  const drawn = [];
  for (const c of chunks.values()) {
    if (!c.g) continue;
    bytes += c.g.bytes;
    const ox = (c.cx * CHUNK + 1.5) * PITCH, oz = (c.cz * CHUNK + 1.5) * PITCH;
    const hy = c.g.ymax / 2;
    if (!inFrustum(PL, ox, hy, oz, Math.hypot(R, hy))) continue;
    gl.uniform3f(geo.u.uOrigin, ox, 0, oz);
    gl.bindVertexArray(c.g.vao);
    gl.drawElements(gl.TRIANGLES, c.g.n, gl.UNSIGNED_INT, 0);
    tris += c.g.n / 3; draws++;
    if (c.lod === 0) drawn.push(c);
  }
  gl.uniform4f(geo.u.uLod, fadeA, fadeB, 1, 0);
  const RS = REGION * PITCH * 0.75;
  for (const s of skies.values()) {
    if (!s.g) continue;
    bytes += s.g.bytes;
    const ox = (s.rx * REGION + 7.5) * PITCH, oz = (s.rz * REGION + 7.5) * PITCH;
    const hy = s.g.ymax / 2;
    if (!inFrustum(PL, ox, hy, oz, Math.hypot(RS, hy))) continue;
    if (Math.hypot(ox - cam.x, oz - cam.z) + RS < fadeA) continue;
    gl.uniform3f(geo.u.uOrigin, ox, 0, oz);
    gl.bindVertexArray(s.g.vao);
    gl.drawElements(gl.TRIANGLES, s.g.n, gl.UNSIGNED_INT, 0);
    tris += s.g.n / 3; draws++; sky++;
  }

  if (pin) {
    if (!pinMesh) {
      const mb = new MB(0, 0, 256);
      mb.cyl(0, 0, 0, 0.01, 5, 1.6, 10, 0xff4f7b, M.LIGHT, 0, false);
      mb.ell(0, 6.6, 0, 2.6, 2.6, 2.6, 10, 4, 0xff4f7b, M.LIGHT, 0);
      mb.ell(0, 6.8, 2.2, 1.1, 1.1, 0.6, 8, 3, 0xffffff, M.LIGHT, 0);
      pinMesh = upload(mb.finish());
    }
    const d = Math.hypot(pin.x - cam.x, pin.y - cam.y, pin.z - cam.z);
    const sc = Math.max(1, d / 60);
    gl.uniform4f(geo.u.uLod, 1e9, 1e9, 0, sc);
    gl.uniform3f(geo.u.uOrigin, pin.x, pin.y + sc * (1.5 + Math.sin(time * 3) * 0.6), pin.z);
    gl.bindVertexArray(pinMesh.vao);
    gl.drawElements(gl.TRIANGLES, pinMesh.n, gl.UNSIGNED_INT, 0);
    draws++;
  }

  // full-screen sky + ground, only where nothing was drawn
  const full = P.full;
  gl.useProgram(full.p);
  setCommon(full.u);
  gl.uniformMatrix4fv(full.u.uInvVP, false, invVP);
  gl.uniform4f(full.u.uTown, L ? L.townD2 : 100, L ? L.maxD2 : 0, L ? L.seaX : 1e9, L ? L.seaBx : 1e6);
  const shDir = shadowDir(T);
  gl.uniform4f(full.u.uFar, fadeA, fadeB, quality.s > 0.7 ? 1 : 0, 5 / shDir[1] * 0.5);
  gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.disable(gl.CULL_FACE);
  gl.bindVertexArray(fullVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  draws++;

  // projected planar shadows on the ground (stencil: each pixel darkened once)
  if (T.night < 0.6 && drawn.length) {
    const sh = P.shadow;
    gl.useProgram(sh.p);
    gl.uniformMatrix4fv(sh.u.uVP, false, VP);
    gl.uniform3f(sh.u.uCam, cam.x, cam.y, cam.z);
    gl.uniform3fv(sh.u.uShadowDir, shDir);
    const k = 1 - T.night * 1.4;
    gl.uniform3f(sh.u.uShadowCol, 1 - 0.42 * k, 1 - 0.38 * k, 1 - 0.26 * k);
    gl.uniform1f(sh.u.uShadowFar, r0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    for (const c of drawn) {
      if (!c.g.ns) continue;
      gl.uniform3f(sh.u.uOrigin, (c.cx * CHUNK + 1.5) * PITCH, 0, (c.cz * CHUNK + 1.5) * PITCH);
      gl.bindVertexArray(c.g.vao);
      gl.drawElements(gl.TRIANGLES, c.g.ns, gl.UNSIGNED_INT, 0);
      tris += c.g.ns / 3; draws++;
    }
    gl.disable(gl.STENCIL_TEST); gl.disable(gl.BLEND);
  }
  gl.depthMask(true);
  gl.bindVertexArray(null);
  Object.assign(stats, { tris: Math.round(tris), draws, sky, chunks: chunks.size, mb: Math.round(bytes / 1048576) });
}
function shadowDir(T) {
  const d = T.night > 0.5 ? [0.3, 0.9, 0.2] : T.dir.slice();
  if (d[1] < 0.42) { const h = Math.hypot(d[0], d[2]); const s = Math.sqrt(1 - 0.42 * 0.42) / h; d[0] *= s; d[2] *= s; d[1] = 0.42; }
  return d;
}

// ---------------- adaptive quality ----------------
let govGood = 0;
function governor(now) {
  if (now - lastGov < 1000) return;
  const avg = frameAcc / Math.max(1, frameN);
  stats.fps = Math.round(1000 / avg); stats.ms = avg;
  frameAcc = 0; frameN = 0; lastGov = now;
  if (quality.mode !== 'auto' || document.hidden || refresh.samples.length < 90) return;
  const target = refresh.ms < 12 ? 16.7 : refresh.ms;   // high refresh displays: aim for 60
  if (avg > target * 1.3) {
    govGood = -3;
    if (quality.pr > 1) quality.pr = Math.max(1, quality.pr - 0.25);
    else if (quality.s > 0.45) quality.s = Math.max(0.45, quality.s - 0.1);
    else if (quality.pr > 0.6) quality.pr = Math.max(0.6, quality.pr - 0.1);
  } else if (avg < target * 1.08) {
    if (++govGood >= 4) {
      govGood = 0;
      if (quality.pr < 1) quality.pr = Math.min(1, quality.pr + 0.1);
      else if (quality.s < quality.maxS) quality.s = Math.min(quality.maxS, quality.s + 0.05);
      else if (quality.pr < quality.maxPr) quality.pr = Math.min(quality.maxPr, quality.pr + 0.25);
    }
  } else govGood = 0;
}

// ---------------- heights & picking ----------------
const nameCache = new Map();
function customFor() { return null; }   // the main thread only needs heights; customs are cosmetic here
function homeTop(bx, bz, slot, zone) {
  const r = recipe(bx, bz, slot, zone, customFor());
  if (zone >= 2) return r.floors * FLOOR_H + (r.crown === 1 ? 3 * FLOOR_H : r.crown === 4 && zone === 3 ? 4 * FLOOR_H : 0);
  return r.floors * FLOOR_H + (r.roofType === 2 ? 0.6 : 2.6);
}
function heightAt(x, z) {
  if (!L) return 0;
  const bx = Math.floor((x + 24) / PITCH), bz = Math.floor((z + 24) / PITCH);
  if (bx === 0 && bz === 0 && Math.abs(x) < 7 && Math.abs(z) < 7) return 220;
  if (kindAt(L, bx, bz) !== K.HOMES) return 0;
  const zone = zoneLevel(bx, bz);
  const s = slotAt(zone, x - bx * PITCH, z - bz * PITCH);
  if (s < 0 || plotIndex(L, bx, bz, s) < 0) return 0;
  const f = plotFrame(bx, bz, s, zone);
  const r = recipe(bx, bz, s, zone, null);
  if (Math.abs(x - f.x) > r.w / 2 + 0.5) return 0;
  return homeTop(bx, bz, s, zone);
}
function pick(px, py) {
  const nx = (px / innerWidth) * 2 - 1, ny = 1 - (py / innerHeight) * 2;
  const a = mulv(invVP, [nx, ny, -1, 1]), b = mulv(invVP, [nx, ny, 1, 1]);
  const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
  let p = [cam.x, cam.y, cam.z];
  for (let t = 0; t < 2500; t += 1.5) {
    const x = p[0] + d[0] * t, y = p[1] + d[1] * t, z = p[2] + d[2] * t;
    if (y < 0) break;
    if (y < heightAt(x, z)) return plotAtWorld(x, z);
  }
  if (d[1] < 0) { const t = -cam.y / d[1]; return plotAtWorld(cam.x + d[0] * t, cam.z + d[2] * t); }
  return null;
}
function mulv(m, v) { const o = [0, 0, 0, 0]; for (let r = 0; r < 4; r++) o[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]; return o; }
function plotAtWorld(x, z) {
  const bx = Math.floor((x + 24) / PITCH), bz = Math.floor((z + 24) / PITCH);
  if (kindAt(L, bx, bz) !== K.HOMES) return null;
  const zone = zoneLevel(bx, bz);
  const s = slotAt(zone, x - bx * PITCH, z - bz * PITCH);
  const p = s < 0 ? -1 : plotIndex(L, bx, bz, s);
  return p < 0 ? null : { p, bx, bz, slot: s, zone };
}
async function nameOf(bx, bz, slot) {
  const key = regionKey(regionOf(bx), regionOf(bz));
  let lines = nameCache.get(key);
  if (!lines) {
    lines = fetch(`${TOWN}n/${key}.txt?v=${manifest.built}`).then((r) => (r.ok ? r.text() : '')).then((t) => t.split('\n')).catch(() => []);
    nameCache.set(key, lines);
  }
  if (lines.then) { lines = await lines; nameCache.set(key, lines); }
  return lines[lineIndex(bx, bz, slot)] || '';
}

// ---------------- name tags ----------------
const tagPool = [];
let tagList = [], lastTagScan = 0;
function tags(now) {
  if (!L || !VP) return;
  if (now - lastTagScan > 300 && !fly) {
    lastTagScan = now;
    const list = [];
    const R = cam.y < 60 ? 130 : 0;
    if (R) {
      const b0x = Math.floor((cam.x - R + 24) / PITCH), b1x = Math.floor((cam.x + R + 24) / PITCH);
      const b0z = Math.floor((cam.z - R + 24) / PITCH), b1z = Math.floor((cam.z + R + 24) / PITCH);
      const f = {};
      for (let bz = b0z; bz <= b1z; bz++) for (let bx = b0x; bx <= b1x; bx++) {
        if (kindAt(L, bx, bz) !== K.HOMES) continue;
        const zone = zoneLevel(bx, bz), occ = occupied(L, bx, bz);
        for (let s = 0; s < occ; s++) {
          plotFrame(bx, bz, s, zone, f);
          const d = Math.hypot(f.x - cam.x, f.z - cam.z);
          if (d > R) continue;
          list.push({ bx, bz, s, x: f.x, z: f.z, y: homeTop(bx, bz, s, zone) + 2.5, d });
        }
      }
      list.sort((a, b) => a.d - b.d);
    }
    tagList = list.slice(0, 40);
    for (const t of tagList) nameOf(t.bx, t.bz, t.s).then((n) => { t.name = n; });
  }
  const W = innerWidth, H = innerHeight;
  const placed = [];
  let used = 0;
  for (const t of tagList) {
    if (!t.name || used >= 24) continue;
    const c = mulv(VP, [t.x, t.y, t.z, 1]);
    if (c[3] <= 0.5) continue;
    const sx = (c[0] / c[3] * 0.5 + 0.5) * W, sy = (0.5 - c[1] / c[3] * 0.5) * H;
    if (sx < -50 || sx > W + 50 || sy < -20 || sy > H + 20) continue;
    // hidden behind a building? test a few points along the line of sight
    let hidden = false;
    for (let k = 1; k < 6 && !hidden; k++) {
      const f = k / 6, x = cam.x + (t.x - cam.x) * f, y = cam.y + (t.y - cam.y) * f, z = cam.z + (t.z - cam.z) * f;
      if (Math.hypot(x - t.x, z - t.z) > 8 && y < heightAt(x, z)) hidden = true;
    }
    if (hidden) continue;
    const w = t.name.length * 7 + 16;
    if (placed.some((p) => Math.abs(p[0] - sx) < (p[2] + w) / 2 && Math.abs(p[1] - sy) < 20)) continue;
    placed.push([sx, sy, w]);
    let el = tagPool[used];
    if (!el) { el = document.createElement('div'); el.className = 'tag'; $('#tags').appendChild(el); tagPool.push(el); }
    if (el.textContent !== t.name) el.textContent = t.name;
    el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-100%)`;
    el.style.opacity = String(Math.max(0.35, 1 - t.d / 140));
    el.style.display = '';
    used++;
  }
  for (let i = used; i < tagPool.length; i++) tagPool[i].style.display = 'none';
}

// ---------------- input ----------------
const keys = new Set();
addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; keys.add(e.key.toLowerCase()); });
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
const pointers = new Map();
let dragDist = 0, pinch0 = 0, mid0 = null;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); dragDist = 0; pinch0 = 0; mid0 = null; });
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p[0], dy = e.clientY - p[1];
  dragDist += Math.abs(dx) + Math.abs(dy);
  p[0] = e.clientX; p[1] = e.clientY;
  if (pointers.size === 1) {
    if (e.buttons & 2 || e.shiftKey) pan(-dx, -dy);
    else { cam.yaw += dx * 0.004; cam.pitch = Math.max(-1.5, Math.min(1.2, cam.pitch - dy * 0.004)); }
    cancelFly();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (pinch0) forward((dist - pinch0) * Math.max(1, cam.y) * 0.012);
    if (mid0) pan(-(mid[0] - mid0[0]), -(mid[1] - mid0[1]));
    pinch0 = dist; mid0 = mid;
    cancelFly();
  }
});
const up = (e) => {
  if (pointers.size === 1 && dragDist < 6 && e.type === 'pointerup') onTap(e.clientX, e.clientY);
  pointers.delete(e.pointerId); pinch0 = 0; mid0 = null;
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { e.preventDefault(); forward(-e.deltaY * Math.max(2, cam.y) * 0.004); cancelFly(); }, { passive: false });
function forward(d) {
  cam.x += Math.sin(cam.yaw) * Math.cos(cam.pitch) * d; cam.y += Math.sin(cam.pitch) * d; cam.z -= Math.cos(cam.yaw) * Math.cos(cam.pitch) * d;
  clampCam();
}
function pan(dx, dy) {
  const s = Math.max(0.3, cam.y) * 0.0025;
  cam.x += (Math.cos(cam.yaw) * dx - Math.sin(cam.yaw) * dy) * s;
  cam.z += (Math.sin(cam.yaw) * dx + Math.cos(cam.yaw) * dy) * s;
  clampCam();
}
function clampCam() {
  cam.y = Math.min(6000, Math.max(cam.y, 2, heightAt(cam.x, cam.z) + 3));
  const lim = L ? (L.seaBx + 60) * PITCH : 20000;
  cam.x = Math.max(-lim, Math.min(lim, cam.x)); cam.z = Math.max(-lim, Math.min(lim, cam.z));
}
function updateInput(dt) {
  if (!keys.size) return;
  const sp = Math.max(12, cam.y * 0.9) * (keys.has('shift') ? 3 : 1) * dt;
  const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const r = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  if (keys.has('arrowleft')) cam.yaw -= dt * 1.5;
  if (keys.has('arrowright')) cam.yaw += dt * 1.5;
  const u = (keys.has('e') || keys.has(' ') ? 1 : 0) - (keys.has('q') ? 1 : 0);
  cam.x += (Math.sin(cam.yaw) * f + Math.cos(cam.yaw) * r) * sp;
  cam.z += (-Math.cos(cam.yaw) * f + Math.sin(cam.yaw) * r) * sp;
  cam.y += u * sp;
  if (f || r || u) cancelFly();
  clampCam();
}

// ---------------- fly-to ----------------
let fly = null;
function cancelFly() { fly = null; }
function homeView(p) {
  const { bx, bz, slot } = plotOf(L, p);
  const zone = zoneLevel(bx, bz);
  const f = plotFrame(bx, bz, slot, zone);
  const top = homeTop(bx, bz, slot, zone);
  const face = f.face;
  if (zone >= 2) {
    // city: hover above the tallest neighbour, a little toward the street, looking down at the roof
    let maxH = top;
    for (let dz = -45; dz <= 45; dz += 7.5) for (let dx = -45; dx <= 45; dx += 7.5) maxH = Math.max(maxH, heightAt(f.x + dx, f.z + dz + face * 20));
    const y = Math.max(top + 30, maxH + 14);
    return { x: f.x + 8, y, z: f.z + face * (14 + (y - top) * 0.35), yaw: 0, pitch: 0, bx, bz, slot, zone, tx: f.x, tz: f.z, ty: top / 0.6 };
  }
  const dist = 30;
  return { x: f.x + 5, y: 12, z: f.z + face * (f.d / 2 + dist), yaw: 0, pitch: -0.2, bx, bz, slot, zone, tx: f.x, tz: f.z, ty: top };
}
function lookAtYaw(v) {
  const dx = v.tx - v.x, dz = v.tz - v.z;
  v.yaw = Math.atan2(dx, -dz);
  v.pitch = -Math.atan2(v.y - (v.ty * 0.6), Math.hypot(dx, dz));
  return v;
}
function flyTo(p, instant) {
  const v = lookAtYaw(homeView(p));
  const from = { ...cam };
  const d = Math.hypot(v.x - cam.x, v.z - cam.z);
  if (instant) { Object.assign(cam, { x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch }); fly = null; return v; }
  let dyaw = v.yaw - from.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  fly = { from, to: v, dyaw, t0: performance.now(), dur: Math.min(7000, 1800 + Math.sqrt(d) * 45), lift: Math.min(1800, d * 0.35) };
  return v;
}
function updateFly(now) {
  if (!fly) return;
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
  if (t >= 1) fly = null;
}

// ---------------- search & info card ----------------
const shardCache = new Map();
async function shard(norm) {
  const key = shardFor(norm, manifest.split);
  if (!shardCache.has(key)) shardCache.set(key, fetch(`${TOWN}s/${key}.json?v=${manifest.built}`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
  return shardCache.get(key);
}
async function findName(q) {
  const norm = normName(q);
  if (!norm) return [];
  const list = await shard(norm);
  const out = [];
  for (const e of list) { if (e[0].startsWith(norm)) { out.push(e); if (out.length > 60) break; } }
  out.sort((a, b) => (a[0] === norm ? -1 : b[0] === norm ? 1 : a[0].length - b[0].length || a[1] - b[1]));
  return out.slice(0, 8);
}
async function flyToName(name, instant) {
  if (!L) return false;
  const norm = normName(name);
  const list = await findName(norm);
  const hit = list.find((e) => e[0] === norm) || list[0];
  if (!hit) { toast(`No home for “${name}” yet`); return false; }
  const v = flyTo(hit[1], instant);
  pin = { x: v.tx, y: v.zone >= 2 ? v.ty * 0.6 + 9 : v.ty + 1, z: v.tz };
  showCard(hit[0], hit[1], v);
  history.replaceState(null, '', '#u=' + encodeURIComponent(hit[0]));
  return true;
}
const search = $('#search'), sugg = $('#sugg');
let suggTimer = 0, suggSel = -1;
search.addEventListener('input', () => {
  clearTimeout(suggTimer);
  suggTimer = setTimeout(async () => {
    const list = await findName(search.value);
    suggSel = -1;
    sugg.innerHTML = '';
    for (const [n, p] of list) {
      const li = document.createElement('li');
      li.textContent = n;
      const small = document.createElement('small'); small.textContent = '#' + (p + 1).toLocaleString(); li.appendChild(small);
      li.onpointerdown = (e) => { e.preventDefault(); go(n); };
      sugg.appendChild(li);
    }
    sugg.hidden = !list.length;
  }, 120);
});
search.addEventListener('keydown', (e) => {
  const items = [...sugg.children];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    suggSel = Math.max(0, Math.min(items.length - 1, suggSel + (e.key === 'ArrowDown' ? 1 : -1)));
    items.forEach((li, i) => li.classList.toggle('sel', i === suggSel));
  } else if (e.key === 'Enter') go(suggSel >= 0 && items[suggSel] ? items[suggSel].firstChild.textContent : search.value);
  else if (e.key === 'Escape') { sugg.hidden = true; search.blur(); }
});
search.addEventListener('blur', () => setTimeout(() => { sugg.hidden = true; }, 150));
function go(n) { sugg.hidden = true; search.blur(); search.value = n; flyToName(n); }
addEventListener('hashchange', () => { const u = hashParams().get('u'); if (u) flyToName(u); });

function showCard(name, p, v) {
  const c = $('#card');
  const zoneName = ['Garden suburbs', 'Townhouse quarter', 'Mid-rise district', 'Downtown towers'][v.zone];
  $('#card-name').textContent = name || 'Unclaimed home';
  $('#card-meta').textContent = `Home #${(p + 1).toLocaleString()} · ${zoneName}`;
  c.hidden = false;
  c.dataset.p = p;
}
$('#card-close').onclick = () => { $('#card').hidden = true; pin = null; };
$('#card-go').onclick = () => { const p = +$('#card').dataset.p; if (p >= 0) flyTo(p); };
async function onTap(x, y) {
  if (!L || !invVP) return;
  const hit = pick(x, y);
  if (!hit) return;
  const name = await nameOf(hit.bx, hit.bz, hit.slot);
  const f = plotFrame(hit.bx, hit.bz, hit.slot, hit.zone);
  pin = { x: f.x, y: homeTop(hit.bx, hit.bz, hit.slot, hit.zone) + 1, z: f.z };
  showCard(name, hit.p, { zone: hit.zone });
}
let toastTimer = 0;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600); }

// ---------------- buttons ----------------
const TODS = [0.22, 1, 2];
$('#btn-time').onclick = () => { const i = TODS.findIndex((t) => Math.abs(t - tod) < 0.3); setTod(TODS[(i + 1) % TODS.length]); };
$('#btn-home').onclick = () => { fly = { from: { ...cam }, to: { ...HOME }, dyaw: Math.atan2(Math.sin(HOME.yaw - cam.yaw), Math.cos(HOME.yaw - cam.yaw)), t0: performance.now(), dur: 3000, lift: 300 }; };
$('#btn-help').onclick = () => { $('#help').hidden = !$('#help').hidden; };
$('#help').onclick = () => { $('#help').hidden = true; };

// ---------------- debug / automation hooks ----------------
window.__town = {
  cam, stats, quality, chunks, skies, flyToName, setTod,
  get layout() { return L; }, get ready() { return ready; }, get VP() { return VP; },
  idle() {
    if (!ready || reqs.size) return false;
    for (const c of chunks.values()) if (c.lod !== c.want || c.stale) return false;
    for (const s of skies.values()) if (!s.loaded) return false;
    return true;
  },
};
void cellKind; void fdiv;
boot();
requestAnimationFrame(frame);
setTimeout(clampCam, 1500);
