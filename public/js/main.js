// Follower Town — GL setup, camera, streaming, time of day, search, fly-to, tags, quality.
import {
  PITCH, CHUNK, REGION, FLOOR_H, K, fdiv, finishLayout, plotOf, plotFrame, recipe, zoneLevel, cellKind, kindAt,
  occupied, slotAt, ROOF, chunkLod, chunkLite, skyLite, lowNext, plotIndex, homeRect, regionKey, regionOf, lineIndex, normName, shardFor, hash3,
} from './town.js';
import { MB, M, SKY, MID } from './mesher.js';
import { Supervisor } from './supervisor.js';
import { uploadAtlas } from './atlas.js';
import { GEO_VS, GEO_FS, SHADOW_VS, SHADOW_FS, FULL_VS, FULL_FS, COPY_FS } from './shaders.js';

window.__ftBooted = true;
const $ = (s) => document.querySelector(s);
// ---- diagnostics: on any failure show the reason on screen (phones have no console) ----
const DIAG = [];
function fail(msg, force = false) {
  if (!force && window.__ftGL && window.__ftGL.isContextLost()) return;   // force: terminal messages about the context itself      // the context-lost handler reloads; not an error
  if (window.__ftReady && !String(msg).includes('lost')) { console.error(msg); try { toast('Something went wrong: ' + String(msg).slice(0, 80)); } catch { /* ignore */ } return; }
  DIAG.push(String(msg).slice(0, 600) + (window.FT_BUILD ? '\n(build ' + window.FT_BUILD + ')' : ''));
  const el = document.getElementById('loading');
  if (el) { el.classList.remove('gone'); el.style.whiteSpace = 'pre-wrap'; el.style.fontSize = '13px'; el.style.padding = '16px'; el.style.textAlign = 'left'; el.textContent = 'Follower Town could not start on this device:\n\n' + DIAG.join('\n\n'); }
}
addEventListener('error', (e) => fail('Error: ' + (e.message || e.error)));
addEventListener('unhandledrejection', (e) => fail('Error: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
const params = new URLSearchParams(location.search);
const hashParams = () => new URLSearchParams(location.hash.slice(1));
const TOWN_URL = 'town/';

// ---------------- GL ----------------
const canvas = $('#c');
const qParam = params.get('q') || 'auto';
const PHONE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;
// MSAA on phones too (round G: jagged roof edges were the first "cheap" signal; on tile-based phone GPUs 4x
// MSAA resolves on chip and costs little). Only an explicit q=low (the budget test preset) goes without.
const gl = canvas.getContext('webgl2', { antialias: qParam !== 'low', stencil: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
window.__ftGL = gl;
if (!gl) { fail('This town needs WebGL2, which this browser does not provide.'); throw new Error('no webgl2'); }
// Context lost: reload once; if it happens again soon, explain instead of looping forever.
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  let n = 0;
  try { n = +(sessionStorage.getItem('ft-lost') || 0); sessionStorage.setItem('ft-lost', String(n + 1)); } catch { n = 9; }
  if (n < 1) {
    // keep the view across the reload (cam is defined later; the handler only runs after boot)
    try { sessionStorage.setItem('ft-cam', [cam.x, cam.y, cam.z, cam.yaw, cam.pitch].map((v) => v.toFixed(3)).join(',')); } catch { /* ignore */ }
    setTimeout(() => location.reload(), 500);
  } else {
    try { sessionStorage.removeItem('ft-cam'); } catch { /* ignore */ }
    window.__ftReady = false;                       // show the panel, not a toast
    fail('The graphics context was lost twice (the GPU ran out of memory or was reset). Try ?q=low or close other tabs.', true);
  }
});
setTimeout(() => { try { sessionStorage.removeItem('ft-lost'); } catch { /* ignore */ } }, 20000);

function prog(vs, fs) {
  const p = gl.createProgram();
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(t);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && gl.isContextLost()) throw new Error('context lost');   // the reload handles it
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { fail('Shader compile failed: ' + gl.getShaderInfoLog(s)); throw new Error(gl.getShaderInfoLog(s)); }
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { fail('Shader link failed: ' + gl.getProgramInfoLog(p)); throw new Error(gl.getProgramInfoLog(p)); }
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}
// The material shader exists in two variants; only the one the preset uses is compiled at boot,
// the other on first use (phones never pay for the high one).
const GEO_SRC = { geo: GEO_FS, geoLow: GEO_FS.replace('#version 300 es', '#version 300 es\n#define LOWQ') };
function geoProg(which) { if (!P[which]) P[which] = prog(GEO_VS, GEO_SRC[which]); return P[which]; }
const P = { shadow: prog(SHADOW_VS, SHADOW_FS), full: prog(FULL_VS, FULL_FS), copy: prog(FULL_VS, COPY_FS) };
const fullVao = gl.createVertexArray();
let atlasTex = null;
try { atlasTex = uploadAtlas(gl); } catch (e) { console.error('atlas', e); }   // windows fall back to flat colour without it
const hasStencil = !!(gl.getContextAttributes() || {}).stencil;      // without it shadows would darken twice
gl.useProgram(P.full.p);
gl.uniform3fv(P.full.u.uRoof, new Float32Array(ROOF.flatMap((c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255])));
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
  return { vao, vbo, ibo, n: m.ib.length - (m.so || 0), so: (m.so || 0) * m.ib.BYTES_PER_ELEMENT, nso: m.so || 0, ns: m.ns, ymax: m.ymax, it: m.ib.BYTES_PER_ELEMENT === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT, bytes: m.vb.byteLength + m.ib.byteLength };
}
function release(g) { if (!g) return; gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.vbo); gl.deleteBuffer(g.ibo); }

// ---------------- matrices ----------------
// Matrices write into preallocated arrays: the frame loop allocates nothing.
const M_PROJ = new Float32Array(16), M_VIEW = new Float32Array(16), M_VP = new Float32Array(16), M_INV = new Float32Array(16);
const INV64 = new Float64Array(16);
function persp(fovy, aspect, n, f) {
  const t = 1 / Math.tan(fovy / 2), o = M_PROJ;
  o.fill(0); o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f);
  return o;
}
function lookDir(e, f) {
  let sx = -f[2], sz = f[0]; const sl = hyp2(sx, sz) || 1; sx /= sl; sz /= sl;   // side = f x up
  const ux = -sz * f[1], uy = sz * f[0] - sx * f[2], uz = sx * f[1];               // up = side x f
  const o = M_VIEW;
  o[0] = sx; o[1] = ux; o[2] = -f[0]; o[3] = 0; o[4] = 0; o[5] = uy; o[6] = -f[1]; o[7] = 0; o[8] = sz; o[9] = uz; o[10] = -f[2]; o[11] = 0;
  o[12] = -(sx * e[0] + sz * e[2]); o[13] = -(ux * e[0] + uy * e[1] + uz * e[2]); o[14] = f[0] * e[0] + f[1] * e[1] + f[2] * e[2]; o[15] = 1;
  return o;
}
function mul(a, b, o = M_VP) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function invert(m) {
  const inv = INV64;
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
  const o = M_INV;
  for (let i = 0; i < 16; i++) o[i] = inv[i] * det;
  return o;
}
const PLANES = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
const PLANE_IDX = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1]];
function planes(m) {
  for (let k = 0; k < 5; k++) {
    const i = PLANE_IDX[k][0], s = PLANE_IDX[k][1];
    const a = m[3] + s * m[i], b = m[7] + s * m[4 + i], c = m[11] + s * m[8 + i], d = m[15] + s * m[12 + i];
    const l = hyp3(a, b, c), p = PLANES[k];
    p[0] = a / l; p[1] = b / l; p[2] = c / l; p[3] = d / l;
  }
  return PLANES;
}
const hyp2 = (a, b) => Math.sqrt(a * a + b * b);
const hyp3 = (a, b, c) => Math.sqrt(a * a + b * b + c * c);
function inFrustum(pl, x, y, z, r) {
  for (let i = 0; i < 5; i++) { const p = pl[i]; if (p[0] * x + p[1] * y + p[2] * z + p[3] <= -r) return false; }
  return true;
}

// ---------------- state ----------------
// ART.md composition (round F): a low drone over dense jutaku and villa lanes south-west of the river, the
// towers and spire as the backdrop. The product is "your follower's home", so homes fill the opening frame.
const HOME = { x: -176, y: 36, z: 1190, yaw: 0.12, pitch: -0.27 };   // over a north-south lane: the street leads the eye to the towers
if (innerWidth / innerHeight > 1.2) Object.assign(HOME, { y: 34, pitch: -0.30 });   // landscape: wider frame; a little steeper so the far field (tris, draws) stays in budget
const cam = { ...HOME };
const PRESETS = { low: { s: 0.55, pr: 1 }, mid: { s: 0.8, pr: 1.5 }, high: { s: 1, pr: 2 } };
const isPhone = PHONE;
let lowState = null;
// Low preset with hysteresis: the governor drifting around 0.7 must not rebuild every chunk back and forth.
function isLow() {
  lowState = lowNext(lowState, quality.s);
  return lowState;
}
const quality = { mode: qParam, ...(qParam === 'high' ? PRESETS.high : qParam === 'low' ? PRESETS.low : isPhone ? PRESETS.low : PRESETS.mid) };
quality.maxS = quality.s; quality.maxPr = quality.pr;
const RAD = { r0: 0, r1: 0, rs: 0 };
function radii() {          // fills one object (no per-frame allocation)
  RAD.r0 = 320 * Math.max(0.6, quality.s); RAD.r1 = 1100 * quality.s * (isLow() ? 0.6 : 1); RAD.rs = Math.min(5000, 7000 * quality.s * quality.s);
  return RAD;
}
const stats = { tris: 0, draws: 0, sky: 0, chunks: 0, mb: 0, fps: 0, ms: 0 };
let manifest = null, L = null, ready = false, bootMs = 0;
const chunks = new Map();     // key -> {cx,cz,lod,g,want,req,seen}
const skies = new Map();      // key -> {rx,rz,g,req,seen}
const mids = new Map();       // mid-band massing tiles beyond the house ring, same shape as skies
const t0 = performance.now();
const frozenT = params.has('t') ? parseFloat(params.get('t')) : null;
let tod = params.has('tod') ? parseFloat(params.get('tod')) : 0.22;
const showTags = !params.has('notags');

let restoredCam = false;
{ let c = params.get('cam'); try { if (!c) { c = sessionStorage.getItem('ft-cam'); restoredCam = !!c; } sessionStorage.removeItem('ft-cam'); } catch { /* ignore */ } if (c) { const v = c.split(',').map(Number); if (v.length === 5 && v.every(Number.isFinite)) Object.assign(cam, { x: v[0], y: v[1], z: v[2], yaw: v[3], pitch: v[4] }); } }

// ---------------- workers ----------------
const NW = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
// The pool, requests, back-off and layout-build tracking live in supervisor.js (unit-tested in selftest).
let badBuilt = null;
const sup = new Supervisor({
  size: NW,
  now: () => performance.now(),
  later: (fn, ms) => setTimeout(fn, ms),
  notice: (t) => fail(t),
  onFatal: (t) => fail(t),
  spawn: (s) => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = onWorker;
    w.onerror = (e) => { if (e.preventDefault) e.preventDefault(); console.error('worker died:', e.message); s.died(w, e.message || 'failed to start'); };
    return w;
  },
});
const reqs = sup.reqs;                                 // read-only views for streaming, idle() and the probe
function onWorker(e) {
  const m = e.data;
  if (m.type === 'layout') { if (sup.finishBuild(m.build)) onLayout(m.layout, m.ground); return; }   // stale builds are ignored
  const r = sup.reply(m.id);
  if (m.type === 'error') {
    console.error(m.message);
    if (m.fatal) {                              // a layout build failed: abandon it; the old layout and manifest stay
      sup.finishBuild(m.build);
      if (layoutStage) badBuilt = layoutStage.manifest.built;
      layoutStage = null;
      fail('Worker: ' + m.message);
    }
    if (r && r.target.req === m.id) {          // only the request that failed; give up after 3 tries
      const t = r.target;
      t.req = 0; t.fails = (t.fails || 0) + 1;
      if (t.fails >= 3) { t.loaded = true; t.lod = r.lod; }
    }
    return;
  }
  if (!r) return;
  const t = r.target;
  if (t.req !== m.id) return;      // superseded
  if (r.dead) { t.req = 0; return; }
  UPQ.push({ t, m, lod: r.lod, id: m.id });     // uploaded from the frame loop; t.req stays set until then (no re-requests)
}
// Mesh uploads are spread over frames (<= 512 KB per frame, nearest first) so streaming never hitches.
const UPQ = [];
const byTargetDist = (a, b) => (a.t.d || 0) - (b.t.d || 0);
function drainUploads() {
  if (!UPQ.length) return;
  UPQ.sort(byTargetDist);
  let bytes = 0;
  while (UPQ.length && (bytes < 512 * 1024 || !bytes)) {
    const { t, m, lod, id } = UPQ.shift();
    if (t.gone || t.req !== id) continue;
    t.req = 0;
    bytes += m.vb.byteLength + m.ib.byteLength;
    const g = m.ib.length ? upload(m) : null;
    release(t.g);
    t.g = g; t.lod = lod; t.loaded = true;
  }
}
document.addEventListener('visibilitychange', () => sup.resetClocks());
sup.start();
const send = (msg, target, lod) => sup.request(msg, target, lod);

// ---------------- boot ----------------
async function loadManifest() {
  const r = await fetch(TOWN_URL + 'manifest.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('manifest ' + r.status);
  return r.json();
}
let layoutStage = null;
let groundTex = null, groundExt = 0, groundBytes = 0, tallRegions = new Set();
function onLayout(lt, ground) {
  // validate before touching anything: a rejected layout leaves the current one (and every worker) as it was
  if (ground.size > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
    if (layoutStage) badBuilt = layoutStage.manifest.built;
    layoutStage = null;
    fail(`This town is too large for this GPU (${ground.size} > ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}).`);
    return;
  }
  const nl = finishLayout(lt);
  const old = L;
  L = nl;
  sup.commit(lt);                                   // every worker, the builder too (it built into a local)
  if (!groundTex) groundTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, groundTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, ground.size, ground.size, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, ground.data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  groundExt = ground.ext; groundBytes = ground.size * ground.size * 4;
  // regions that can hold skyline buildings (so empty ones are never requested)
  tallRegions = new Set(['0_0']);
  for (let i = 0; i < L.count; i++) {
    const bx = L.blocks[2 * i], bz = L.blocks[2 * i + 1];
    if (zoneLevel(bx, bz) >= 2) tallRegions.add(regionKey(fdiv(bx, SKY), fdiv(bz, SKY)));
  }
  if (layoutStage) {
    // commit the update: new manifest, fresh name caches (names may have changed), tags rescanned
    manifest = layoutStage.manifest;
    nameCache.clear(); shardCache.clear(); nameMemo.clear(); nameEpoch++; PLOT.clear(); tagCam[0] = NaN;
    for (const c of CAND) { c.key = -1; c.name = null; c.pending = -1; }
    if (old) flushChanged(old, layoutStage.oldC);
  }
  layoutStage = null;
  $('#count').textContent = L.n.toLocaleString() + ' homes';
  if (!ready) {
    ready = true;
    window.__ftReady = true;
    // desktops may switch presets: compile the other material variant while idle, never inside a frame
    if (!isPhone) (window.requestIdleCallback || ((f) => setTimeout(f, 2000)))(() => { try { geoProg(isLow() ? 'geo' : 'geoLow'); } catch (e) { console.error(e); } });
    bootMs = performance.now();
    $('#loading').classList.add('gone');
    const u = params.get('u') || hashParams().get('u');
    if (u && !restoredCam) flyToName(u, params.has('instant'));   // after a context-loss reload, stay where the viewer was
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
  for (const s of mids.values()) s.stale = true;
  for (const k of changed) customCache.delete(k);
}
// custom-home files: fetched once here and handed to whichever worker meshes the chunk
const customCache = new Map();   // regionKey -> object | null | Promise
function customFor(cx, cz) {
  const key = regionKey(regionOf(cx * CHUNK), regionOf(cz * CHUNK));
  if (!manifest.c || !manifest.c[key]) return null;
  const ck = key + '@' + manifest.c[key];           // versioned key: an old download can't overwrite new data
  const v = customCache.get(ck);
  if (v === undefined) {
    // a 404 is a real "no custom homes"; a network error is never cached (round M: one dropped request used to
    // turn every custom home of the region into a default house until the cache evicted it)
    const pr = fetch(`${TOWN_URL}c/${key}.json?v=${manifest.c[key]}`).then((r) => (r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error(r.status))))
      .then((j) => { if (customCache.get(ck) === pr) customCache.set(ck, j); })
      .catch(() => { if (customCache.get(ck) === pr) setTimeout(() => { if (customCache.get(ck) === pr) customCache.delete(ck); }, 3000); });   // retry after 3 s
    capSet(customCache, ck, pr);
    return undefined;
  }
  return v && v.then ? undefined : v;
}
// The block order is prebuilt by tools/build.mjs (order.bin), so phones don't sort the town at boot.
// A layout update builds against the staged manifest; it becomes `manifest` only when its layout arrives
// (onLayout), so a failed build leaves the old manifest and layout consistent.
async function initLayout() {
  const mf = layoutStage ? layoutStage.manifest : manifest;
  let order = null;
  if (mf.order) {
    try { const r = await fetch(`${TOWN_URL}order.bin?v=${mf.order}`); if (r.ok) order = await r.arrayBuffer(); } catch { /* fall back */ }
  }
  sup.startBuild(mf.n, order);
}
let stage = 'starting';
setTimeout(() => { if (!ready) fail('Still not ready after 25 s. Last step: ' + stage + '.'); }, 25000);
async function boot() {
  stage = 'loading the town data';
  try { manifest = await loadManifest(); } catch (e) { $('#loading').textContent = 'No town data yet. Run: npm run demo'; throw e; }
  stage = 'building the layout in the worker';
  initLayout();
  setInterval(async () => {
    try {
      const m = await loadManifest();
      if (m.built !== manifest.built && m.built !== badBuilt && !layoutStage) {   // skip while one is applied, and a rejected build
        layoutStage = { oldC: manifest.c, manifest: m };
        initLayout();
      }
    } catch { /* offline: keep the town we have */ }
  }, 5 * 60 * 1000);
}

// ---------------- streaming ----------------
let lastStream = 0;
function stream(now) {
  if (!L || now - lastStream < 150) return;
  lastStream = now;
  if (!document.hidden) sup.sweep();
  const { r0, r1, rs } = radii();
  const C = CHUNK * PITCH;
  const ccx = Math.floor((cam.x + 24) / C), ccz = Math.floor((cam.z + 24) / C);
  const n = Math.ceil(r1 / C) + 1;
  const want = [];
  for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) {
    const cx = ccx + dx, cz = ccz + dz;
    const ox = (cx * CHUNK + 1.5) * PITCH, oz = (cz * CHUNK + 1.5) * PITCH;
    const d = Math.hypot(Math.max(0, hyp2(ox - cam.x, oz - cam.z) - C * 0.7), cam.y);
    if (d > r1) continue;
    const prev = chunks.get(cx + ',' + cz);
    want.push({ cx, cz, d, lod: chunkLod(d, r0, prev ? prev.lod : -1) });
  }
  want.sort((a, b) => a.d - b.d);
  const seen = new Set();
  let budget = sup.workers.length * 3 - reqs.size;
  for (const w of want) {
    const key = w.cx + ',' + w.cz;
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
  const sseen = new Set();
  for (let dz = -rn; dz <= rn; dz++) for (let dx = -rn; dx <= rn; dx++) {
    const rx = crx + dx, rz = crz + dz;
    if (Math.abs(rx) > lim || Math.abs(rz) > lim || !tallRegions.has(regionKey(rx, rz))) continue;
    const ox = (rx * SKY + SKY / 2 - 0.5) * PITCH, oz = (rz * SKY + SKY / 2 - 0.5) * PITCH;
    const dh = Math.max(0, hyp2(ox - cam.x, oz - cam.z) - R * 0.7);
    const d = hyp2(dh, cam.y);
    if (d > rs || hyp2(dh + R * 1.4, cam.y) < r1 * 0.72) continue;
    const key = rx + ',' + rz;
    sseen.add(key);
    let s = skies.get(key);
    if (!s) { s = { rx, rz, g: null, req: 0, loaded: false }; skies.set(key, s); }
    s.seen = now; s.d = d;
    const slite = skyLite(isLow(), d, s.lite);                             // far tiles: plain boxes, no crowns
    if ((!s.loaded || s.stale || s.lite !== slite) && !s.req && budget > 0) { s.stale = false; s.lite = slite; send({ type: 'sky', rx, rz, lite: slite }, s, 0); budget--; }
  }
  for (const [key, s] of skies) if (!sseen.has(key) && now - s.seen > 5000) { if (s.req) { const r = reqs.get(s.req); if (r) r.dead = true; } release(s.g); s.gone = true; skies.delete(key); }
  // mid-band tiles: the ring from where homes start to shrink out to MID_OUT x r1
  const RM = MID * PITCH, mn = Math.ceil(r1 * MID_OUT / RM) + 1;
  const cmx = Math.floor((cam.x + 24) / RM), cmz = Math.floor((cam.z + 24) / RM);
  MSEEN.clear();
  for (let dz = -mn; dz <= mn; dz++) for (let dx = -mn; dx <= mn; dx++) {
    const mx = cmx + dx, mz = cmz + dz;
    const ox = (mx * MID + MID / 2 - 0.5) * PITCH, oz = (mz * MID + MID / 2 - 0.5) * PITCH;
    const dh = hyp2(ox - cam.x, oz - cam.z);
    if (dh - RM * 0.71 > r1 * MID_OUT || dh + RM * 0.71 < r1 * 0.72) continue;
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
const MID_OUT = 1.9, MSEEN = new Set();

// ---------------- time of day ----------------
// keys: 0 noon, 1 sunset, 2 night, 3 dawn (cycle of 4)
const KEYS = [
  { top: [0.14, 0.4, 0.86], hor: [0.64, 0.79, 0.95], sun: [1.3, 1.15, 0.95], sky: [0.28, 0.33, 0.43], gnd: [0.40, 0.34, 0.27], fog: [0.68, 0.79, 0.93], el: 0.62, night: 0 },
  { top: [0.22, 0.3, 0.62], hor: [1.0, 0.64, 0.42], sun: [1.05, 0.7, 0.42], sky: [0.42, 0.46, 0.62], gnd: [0.36, 0.3, 0.28], fog: [0.84, 0.66, 0.6], el: 0.12, night: 0.25 },
  { top: [0.015, 0.025, 0.08], hor: [0.06, 0.08, 0.18], sun: [0.22, 0.28, 0.42], sky: [0.26, 0.31, 0.5], gnd: [0.12, 0.12, 0.16], fog: [0.06, 0.08, 0.16], el: 0.9, night: 1 },
  { top: [0.3, 0.42, 0.75], hor: [1.0, 0.78, 0.62], sun: [1.0, 0.78, 0.56], sky: [0.45, 0.48, 0.65], gnd: [0.4, 0.34, 0.3], fog: [0.92, 0.8, 0.72], el: 0.14, night: 0.2 },
];
// Writes into one preallocated object (the frame loop allocates nothing).
const TOD_KEYS = ['top', 'hor', 'sun', 'sky', 'gnd', 'fog'];
const TOD = { top: new Float32Array(3), hor: new Float32Array(3), sun: new Float32Array(3), sky: new Float32Array(3), gnd: new Float32Array(3), fog: new Float32Array(3), dir: new Float32Array(3), night: 0 };
function todState(t) {
  t = ((t % 4) + 4) % 4;
  const i = Math.floor(t), f = t - i, a = KEYS[i], b = KEYS[(i + 1) % 4];
  const s = f * f * (3 - 2 * f);
  for (let j = 0; j < 6; j++) {
    const k = TOD_KEYS[j], x = a[k], y = b[k], o = TOD[k];
    o[0] = x[0] + (y[0] - x[0]) * s; o[1] = x[1] + (y[1] - x[1]) * s; o[2] = x[2] + (y[2] - x[2]) * s;
  }
  TOD.night = a.night + (b.night - a.night) * s;
  const el = a.el + (b.el - a.el) * s;
  const az = 2.20 + t * 0.9;     // ART.md LOCKED (round J): day sun from the south-west, ~45° to the lanes. From the opening
  // camera (looking north) street fronts take raking light, west walls are lit, east walls in shade, shadows fall east across the lanes
  TOD.dir[0] = Math.cos(el) * Math.cos(az); TOD.dir[1] = Math.sin(el); TOD.dir[2] = Math.cos(el) * Math.sin(az);
  return TOD;
}
function setTod(t) { tod = t; }

// ---------------- frame ----------------
let VP = null, invVP = null, PL = null;
let lastFrame = performance.now(), frameAcc = 0, frameN = 0, lastGov = performance.now();
let lastActive = 0, lastRender = 0;
const SIG = new Float64Array(10);
function changed() {            // did anything that affects the image change? (numeric, no allocation)
  const v0 = cam.x, v1 = cam.y, v2 = cam.z, v3 = cam.yaw, v4 = cam.pitch, v5 = tod, v6 = canvas.width, v7 = canvas.height, v8 = reqs.size, v9 = pin ? 1 : 0;
  const c = SIG[0] !== v0 || SIG[1] !== v1 || SIG[2] !== v2 || SIG[3] !== v3 || SIG[4] !== v4 || SIG[5] !== v5 || SIG[6] !== v6 || SIG[7] !== v7 || SIG[8] !== v8 || SIG[9] !== v9;
  SIG[0] = v0; SIG[1] = v1; SIG[2] = v2; SIG[3] = v3; SIG[4] = v4; SIG[5] = v5; SIG[6] = v6; SIG[7] = v7; SIG[8] = v8; SIG[9] = v9;
  return c;
}
const refresh = { samples: [], ms: 16.7 };
let UI_TOP = 0, UI_TOOLS_X = 1e9, UI_TOOLS_Y = 1e9;
function uiRects() {
  const t = $('#top'), b = $('#tools');
  if (t) UI_TOP = t.getBoundingClientRect().bottom + 6;
  if (b) { const r = b.getBoundingClientRect(); UI_TOOLS_X = r.left - 8; UI_TOOLS_Y = r.top - 8; }
}
function resize() {
  uiRects();
  const pr = Math.min(window.devicePixelRatio || 1, quality.pr);
  const w = Math.round(innerWidth * pr), h = Math.round(innerHeight * pr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function frame(now) {
  requestAnimationFrame(frame);
  if (gl.isContextLost()) return;          // the context-lost handler reloads; draw nothing meanwhile
  step(now);
}
function step(now) {
  const dtMs = now - lastFrame; lastFrame = now;
  const dt = Math.min(0.1, dtMs / 1000);
  if (refresh.samples.length < 90) { refresh.samples.push(dtMs); if (refresh.samples.length === 90) { const s = refresh.samples.slice(30).sort((a, b) => a - b); refresh.ms = Math.max(6.9, s[s.length >> 1]); } }
  governor(now);
  updateInput(dt);
  updateFly(now);
  resize();
  stream(now);
  drainUploads();
  if (!ready) return;                                            // nothing to draw until the layout exists
  // when nothing moves and nothing is loading, draw at ~12 fps (water and clouds still drift)
  if (changed() || fly) lastActive = now;
  // with frozen time (?t=) an idle frame is identical: don't redraw at all
  if (now - lastActive > 1500 && (frozenT !== null || now - lastRender < 80) && !params.has('shot')) return;
  lastRender = now;
  if (now - lastActive < 1500) { frameAcc += dtMs; frameN++; }   // the governor only counts active, rendered frames
  render(now);
  if (showTags) tags(now);
  if (params.has('debug')) $('#debug').textContent = `${stats.fps} fps · ${(stats.tris / 1000) | 0}k tris · ${stats.draws} draws · ${stats.sky} sky · ${stats.chunks} chunks · ${stats.mb} MB · pr ${quality.pr.toFixed(2)} s ${quality.s.toFixed(2)}`;
}

const ORDER = [], DRAWN = [], SKYORD = [], NONE = [];
// Perf probe (?probe or __town.probe()): times the passes with gl.finish on this machine. Only ratios
// between builds are meaningful (software GL here), never absolute device fps.
let PROBE = null;
const PIX = new Uint8Array(4);
const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PIX);   // forces the GPU to finish
function probe(n = 8) {
  const run = (mode) => {
    PROBE = mode; render(performance.now()); sync();
    const t = performance.now();
    for (let i = 0; i < n; i++) { render(performance.now()); sync(); }
    PROBE = null;
    return +((performance.now() - t) / n).toFixed(2);
  };
  return { allMs: run(null), groundMs: run('full'), geoMs: run('geo'), bootMs: Math.round(bootMs), w: canvas.width, h: canvas.height };
}
// Run the whole frame loop body n times without waiting for vsync (allocation measurements).
function spin(n = 30) {
  const yaw = cam.yaw;
  for (let i = 0; i < n; i++) { cam.yaw = yaw + i * 0.001; step(performance.now() + i * 16); }
  cam.yaw = yaw;
}
const FWD = new Float64Array(3), EYE = new Float64Array(3), SHD = new Float32Array(3);
const byDist = (a, b) => a.d - b.d;
function sortByDist(arr) {   // insertion sort: allocation-free, fast on nearly sorted lists
  for (let i = 1; i < arr.length; i++) { const v = arr[i]; let j = i - 1; while (j >= 0 && arr[j].d > v.d) { arr[j + 1] = arr[j]; j--; } arr[j + 1] = v; }
}
function render(now) {
  const time = frozenT ?? (now - t0) / 1000;
  const W = canvas.width, H = canvas.height;
  gl.viewport(0, 0, W, H);
  const T = todState(tod);
  const fwd = FWD;
  fwd[0] = Math.sin(cam.yaw) * Math.cos(cam.pitch); fwd[1] = Math.sin(cam.pitch); fwd[2] = -Math.cos(cam.yaw) * Math.cos(cam.pitch);
  EYE[0] = cam.x; EYE[1] = cam.y; EYE[2] = cam.z;
  const near = Math.min(20, Math.max(0.4, cam.y * 0.02));
  const proj = persp((60 * Math.PI) / 180, W / H, near, 40000);
  VP = mul(proj, lookDir(EYE, fwd));
  invVP = invert(VP);
  PL = planes(VP);
  const { r0, r1 } = radii();
  const fogD = Math.max(4800, 6000 + cam.y * 5) * (0.75 + 0.25 * quality.s);

  const half = isLow() && !halfBroken && !params.has('fullres') && PROBE !== 'geo' ? halfGround(W, H, T, time, fogD, r1) : null;
  gl.viewport(0, 0, W, H);
  gl.clearColor(T.fog[0], T.fog[1], T.fog[2], 1);
  gl.clearStencil(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
  gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);

  let tris = 0, draws = 0, sky = 0, bytes = 0;
  const geo = geoProg(isLow() ? 'geoLow' : 'geo');                  // low preset: cheaper material shader
  gl.useProgram(geo.p);
  setCommonU(geo.u, T, time, fogD);
  gl.uniformMatrix4fv(geo.u.uVP, false, VP);
  const fadeA = r1 * 0.72, fadeB = r1 * 0.96, shadowR = isLow() ? LOW_SHADOW : 650 * quality.s;
  gl.uniform4f(geo.u.uLod, fadeA, fadeB, 0, 0);
  const R = CHUNK * PITCH * 0.75;
  const drawn = DRAWN;
  drawn.length = 0;
  ORDER.length = 0;                                   // front to back: less overdraw (reused arrays)
  for (const c of chunks.values()) if (c.g) ORDER.push(c);
  sortByDist(ORDER);
  for (const c of (PROBE === 'full' ? NONE : ORDER)) {
    bytes += c.g.bytes;
    const ox = (c.cx * CHUNK + 1.5) * PITCH, oz = (c.cz * CHUNK + 1.5) * PITCH;
    const hy = c.g.ymax / 2;
    if (!inFrustum(PL, ox, hy, oz, hyp2(R, hy))) continue;
    gl.uniform3f(geo.u.uOrigin, ox, 0, oz);
    gl.bindVertexArray(c.g.vao);
    gl.drawElements(gl.TRIANGLES, c.g.n, c.g.it, c.g.so);       // shadow-only proxies are skipped
    tris += c.g.n / 3; draws++;
    // shadows: distance to the chunk's bounding square, not its centre (no corner gaps, no chunk-sized pops)
    if (hyp2(Math.max(0, Math.abs(ox - cam.x) - CHUNK * PITCH / 2), Math.max(0, Math.abs(oz - cam.z) - CHUNK * PITCH / 2)) < shadowR) drawn.push(c);
  }
  gl.uniform4f(geo.u.uLod, fadeA, fadeB, 1, 2);    // skyline tiles are stored at 1/32 m
  const RS = SKY * PITCH * 0.75;
  SKYORD.length = 0;
  for (const s of skies.values()) if (s.g) SKYORD.push(s);
  sortByDist(SKYORD);
  for (const s of (PROBE === 'full' ? NONE : SKYORD)) {
    bytes += s.g.bytes;
    const ox = (s.rx * SKY + SKY / 2 - 0.5) * PITCH, oz = (s.rz * SKY + SKY / 2 - 0.5) * PITCH;
    const hy = s.g.ymax * 0.5;
    if (!inFrustum(PL, ox, hy, oz, hyp2(RS, hy))) continue;
    if (hyp2(hyp2(ox - cam.x, oz - cam.z) + RS, cam.y) < fadeA) continue;
    gl.uniform3f(geo.u.uOrigin, ox, 0, oz);
    gl.bindVertexArray(s.g.vao);
    gl.drawElements(gl.TRIANGLES, s.g.n, s.g.it, s.g.so);
    tris += s.g.n / 3; draws++; sky++;
  }

  // mid-band massing (skyline mode: hidden where chunks still draw homes, growing in as they shrink)
  gl.uniform4f(geo.u.uLod, fadeA, fadeB, 1, 0);
  const RMd = MID * PITCH * 0.75;
  for (const s of (PROBE === 'full' ? NONE : mids.values())) {
    if (!s.g) continue;
    bytes += s.g.bytes;
    const ox = (s.rx * MID + MID / 2 - 0.5) * PITCH, oz = (s.rz * MID + MID / 2 - 0.5) * PITCH;
    if (!inFrustum(PL, ox, 8, oz, hyp2(RMd, 10))) continue;
    gl.uniform3f(geo.u.uOrigin, ox, 0, oz);
    gl.bindVertexArray(s.g.vao);
    gl.drawElements(gl.TRIANGLES, s.g.n, s.g.it, s.g.so);
    tris += s.g.n / 3; draws++;
  }

  if (pin && L && PROBE !== 'full') {
    if (!pinMesh) {
      const mb = new MB(0, 0, 256);
      mb.cyl(0, 0, 0, 0.01, 5, 1.6, 10, 0xff4f7b, M.LIGHT, 0, false);
      mb.ell(0, 6.6, 0, 2.6, 2.6, 2.6, 10, 4, 0xff4f7b, M.LIGHT, 0);
      mb.ell(0, 6.8, 2.2, 1.1, 1.1, 0.6, 8, 3, 0xffffff, M.LIGHT, 0);
      pinMesh = upload(mb.finish());
    }
    const d = hyp3(pin.x - cam.x, pin.y - cam.y, pin.z - cam.z);
    const sc = Math.max(0.4, d / 110);              // a marker, not a balloon over the home (constant-ish on screen)
    gl.uniform4f(geo.u.uLod, 1e9, 2e9, 0, sc);
    gl.uniform3f(geo.u.uOrigin, pin.x, pin.y + sc * (1.5 + Math.sin(time * 3) * 0.6), pin.z);
    gl.bindVertexArray(pinMesh.vao);
    gl.drawElements(gl.TRIANGLES, pinMesh.n, pinMesh.it, 0);
    draws++;
  }

  // full-screen sky + ground, only where nothing was drawn. On low quality it is rendered at
  // half resolution first (see halfGround) and only upsampled here.
  if (PROBE === 'geo') { /* probe: geometry only */ } else if (half) {
    gl.useProgram(P.copy.p);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, half.tex); gl.uniform1i(P.copy.u.uTex, 1);
    gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(fullVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    draws++;
  } else {
  const full = P.full;
  gl.useProgram(full.p);
  setFull(full.u, T, time, fogD, r1);
  gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.disable(gl.CULL_FACE);
  gl.bindVertexArray(fullVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  draws++;
  }

  // projected planar shadows on the ground (stencil: each pixel darkened once)
  const shDir = shadowDir(T);
  if (T.night < 0.6 && drawn.length && hasStencil && PROBE !== 'full') {   // low: only the nearest chunks cast; painted ground shadows take over beyond LOW_SHADOW
    const sh = P.shadow;
    gl.useProgram(sh.p);
    gl.uniformMatrix4fv(sh.u.uVP, false, VP);
    gl.uniform3f(sh.u.uCam, cam.x, cam.y, cam.z);
    gl.uniform3fv(sh.u.uShadowDir, shDir);
    const k = 1 - T.night * 1.4;
    gl.uniform3f(sh.u.uShadowCol, 1 - 0.42 * k, 1 - 0.38 * k, 1 - 0.26 * k);
    gl.uniform1f(sh.u.uShadowFar, shadowR);
    gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    for (const c of drawn) {
      // low preset: only the homes' shadow proxies (trees and the few taller casters are painted / skipped)
      const n = isLow() && c.g.nso ? c.g.nso : c.g.ns;
      if (!n) continue;
      gl.uniform3f(sh.u.uOrigin, (c.cx * CHUNK + 1.5) * PITCH, 0, (c.cz * CHUNK + 1.5) * PITCH);
      gl.bindVertexArray(c.g.vao);
      gl.drawElements(gl.TRIANGLES, n, c.g.it, 0);
      tris += n / 3; draws++;
    }
    gl.disable(gl.STENCIL_TEST); gl.disable(gl.BLEND);
  }
  gl.depthMask(true);
  gl.bindVertexArray(null);
  stats.tris = Math.round(tris); stats.draws = draws; stats.sky = sky; stats.chunks = chunks.size; stats.mb = Math.round((bytes + groundBytes + (halfRT ? halfRT.w * halfRT.h * 4 : 0)) / 1048576);   // meshes + ground texture + half-res target
}
function setCommonU(u, T, time, fogD) {
  gl.uniform3fv(u.uSunDir, T.dir); gl.uniform3fv(u.uSunCol, T.sun); gl.uniform3fv(u.uSkyCol, T.sky); gl.uniform3fv(u.uGndCol, T.gnd);
  gl.uniform3fv(u.uFogCol, T.fog); gl.uniform3fv(u.uSkyTop, T.top); gl.uniform3fv(u.uSkyHor, T.hor);
  gl.uniform1f(u.uFogD, fogD); gl.uniform1f(u.uNight, T.night); gl.uniform1f(u.uTime, time);
  gl.uniform3f(u.uCam, cam.x, cam.y, cam.z);
  if (u.uLowQ) gl.uniform1f(u.uLowQ, isLow() ? 1 : 0);
  if (u.uAtlas) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(u.uAtlas, 1); gl.activeTexture(gl.TEXTURE0); }
}
function setFull(u, T, time, fogD, r1) {
  setCommonU(u, T, time, fogD);
  gl.uniformMatrix4fv(u.uInvVP, false, invVP);
  gl.uniform4f(u.uTown, L ? L.townD2 : 100, groundExt, L ? L.seaX : 1e9, L ? L.seaBx : 1e6);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, groundTex); gl.uniform1i(u.uGround, 0);
  const shDir = shadowDir(T);
  gl.uniform4f(u.uFar, r1 * 0.72, r1 * 0.96, !isLow() ? 1 : hasStencil ? -LOW_SHADOW : 0, 5 / shDir[1] * 0.5);   // z < 0: low preset with cast shadows out to -z
  gl.uniform1f(u.uClouds, 1);
  gl.uniform1f(u.uPx, halfActive ? 0.5 : 1);
}

// Low quality: run the expensive ground/sky shader at half resolution into a texture
// (a quarter of the fragments), then upsample it where no geometry was drawn.
let halfRT = null, halfActive = false, halfBroken = false;
function halfGround(W, H, T, time, fogD, r1) {
  const w = Math.max(1, W >> 1), h = Math.max(1, H >> 1);
  if (!halfRT || halfRT.w !== w || halfRT.h !== h) {
    if (halfRT) { gl.deleteFramebuffer(halfRT.fb); gl.deleteTexture(halfRT.tex); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
      halfBroken = true;
      return null;
    }
    halfRT = { w, h, fb, tex };
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, halfRT.fb);
  gl.viewport(0, 0, w, h);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
  const full = P.full;
  gl.useProgram(full.p);
  halfActive = true;
  setFull(full.u, T, time, fogD, r1);
  halfActive = false;
  gl.bindVertexArray(fullVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.enable(gl.DEPTH_TEST);
  return halfRT;
}

// Low preset: cast shadows from the nearest chunks only (the opening view's homes are grounded; casters beyond
// this are painted by the ground shader, which fades its own shadows in where these fade out).
const LOW_SHADOW = 130;
function shadowDir(T) {
  const d = SHD;
  if (T.night > 0.5) { d[0] = 0.3; d[1] = 0.9; d[2] = 0.2; } else { d[0] = T.dir[0]; d[1] = T.dir[1]; d[2] = T.dir[2]; }
  if (d[1] < 0.3) { const h = hyp2(d[0], d[2]); const s = Math.sqrt(1 - 0.3 * 0.3) / h; d[0] *= s; d[2] *= s; d[1] = 0.3; }
  return d;
}

// ---------------- adaptive quality ----------------
let govGood = 0;
function governor(now) {
  if (now - lastGov < 1000) return;
  if (frameN < 10) { lastGov = now; return; }          // idle: nothing to judge
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
// Map used as a small LRU: newest last, oldest evicted beyond 64 entries.
function capSet(map, k, v) { map.delete(k); map.set(k, v); if (map.size > 64) map.delete(map.keys().next().value); }
const nameMemo = new Map();      // plotKey(bx, bz, slot) -> name, so tags never blink between scans
// Per-plot footprint and top height, cached: tag scans and fly-to call these hundreds of times, and the
// recipe allocates (round I: 16 KB/frame on the opening view while the camera turned).
const PLOT = new Map();
const plotKey = (bx, bz, slot) => ((bx + 32768) * 65536 + (bz + 32768)) * 16 + slot;
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
function homeTop(bx, bz, slot, zone) { return plotInfo(bx, bz, slot, zone).top; }
function heightAt(x, z) {
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
function mulv(m, v, o = [0, 0, 0, 0]) { for (let r = 0; r < 4; r++) o[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]; return o; }
function plotAtWorld(x, z) {
  const bx = Math.floor((x + 24) / PITCH), bz = Math.floor((z + 24) / PITCH);
  if (kindAt(L, bx, bz) !== K.HOMES) return null;
  const zone = zoneLevel(bx, bz);
  const s = slotAt(zone, x - bx * PITCH, z - bz * PITCH);
  const p = s < 0 ? -1 : plotIndex(L, bx, bz, s);
  return p < 0 ? null : { p, bx, bz, slot: s, zone };
}
async function nameOf(bx, bz, slot) {
  const ver = (manifest.nh && manifest.nh[regionKey(regionOf(bx), regionOf(bz))]) || manifest.built;
  const key = regionKey(regionOf(bx), regionOf(bz)) + '@' + ver;
  let lines = nameCache.get(key);
  if (!lines) {
    const pr = fetch(`${TOWN_URL}n/${regionKey(regionOf(bx), regionOf(bz))}.txt?v=${ver}`)
      .then((r) => (r.ok ? r.text() : r.status === 404 ? '' : Promise.reject(new Error(r.status)))).then((t) => t.split('\n')).catch(() => null);
    capSet(nameCache, key, pr);
    lines = pr;
  }
  if (lines.then) {
    const pr = lines;
    lines = await lines;
    if (nameCache.get(key) === pr) { if (lines) nameCache.set(key, lines); else nameCache.delete(key); }   // failures are not cached
  }
  if (!lines) return null;                            // network error: callers retry later (never "unclaimed")
  return lines[lineIndex(bx, bz, slot)] || '';
}

// ---------------- name tags ----------------
const tagPool = [];
const PLACED = [], TV = [0, 0, 0, 1], TC = [0, 0, 0, 0];
let tagList = [], lastTagScan = 0;
const CAND = [], SORT = [], TAGF = {};
const byTagD = (a, b) => a.d - b.d;
const tagCam = new Float64Array([NaN, 0, 0, 0, 0]);   // NaN: compared with !(<=) below, so the first scan always runs
let nameEpoch = 0;
function tags(now) {
  if (!L || !VP) return;
  // rescan only when the camera moved (a still camera keeps its tags: no per-scan allocations at rest)
  const moved = !(Math.abs(cam.x - tagCam[0]) + Math.abs(cam.y - tagCam[1]) + Math.abs(cam.z - tagCam[2]) <= 1) || Math.abs(cam.yaw - tagCam[3]) + Math.abs(cam.pitch - tagCam[4]) > 0.01;
  if (now - lastTagScan > 300 && !fly && moved) {               // names arriving later fill in without a rescan
    tagCam[0] = cam.x; tagCam[1] = cam.y; tagCam[2] = cam.z; tagCam[3] = cam.yaw; tagCam[4] = cam.pitch;
    lastTagScan = now;
    const R = cam.y < 60 ? 140 : 0;
    // scan around a point ahead of the camera, where the homes on screen are. Candidates live in a pool
    // (no per-scan objects); a pooled entry keeps its name only while it holds the same plot.
    const ax = cam.x + Math.sin(cam.yaw) * R * 0.7, az = cam.z - Math.cos(cam.yaw) * R * 0.7;
    let n = 0;
    SORT.length = 0;
    if (R) {
      const b0x = Math.floor((ax - R + 24) / PITCH), b1x = Math.floor((ax + R + 24) / PITCH);
      const b0z = Math.floor((az - R + 24) / PITCH), b1z = Math.floor((az + R + 24) / PITCH);
      const f = TAGF;
      for (let bz = b0z; bz <= b1z; bz++) for (let bx = b0x; bx <= b1x; bx++) {
        if (kindAt(L, bx, bz) !== K.HOMES) continue;
        const zone = zoneLevel(bx, bz), occ = occupied(L, bx, bz);
        for (let s = 0; s < occ; s++) {
          plotFrame(bx, bz, s, zone, f);
          if (Math.hypot(f.x - ax, f.z - az) > R) continue;
          const c = CAND[n] || (CAND[n] = { key: -1, name: null });
          const key = plotKey(bx, bz, s);
          if (c.key !== key) { c.key = key; c.name = nameMemo.get(key) || null; }
          c.bx = bx; c.bz = bz; c.s = s; c.x = f.x; c.z = f.z; c.y = homeTop(bx, bz, s, zone) + 2.5;
          c.d = Math.hypot(f.x - cam.x, f.z - cam.z, cam.y);
          SORT.push(c); n++;
        }
      }
      SORT.sort(byTagD);
    }
    tagList.length = 0;
    for (let k = 0; k < SORT.length && k < 40; k++) tagList.push(SORT[k]);
    // occlusion is tested here (every 300 ms), not per frame: heightAt runs the house recipe
    for (const t of tagList) {
      t.hidden = false;
      for (let k = 1; k < 6 && !t.hidden; k++) {
        const f = k / 6, x = cam.x + (t.x - cam.x) * f, y = cam.y + (t.y - cam.y) * f, z = cam.z + (t.z - cam.z) * f;
        if (Math.hypot(x - t.x, z - t.z) > 8 && y < heightAt(x, z)) t.hidden = true;
      }
    }
    for (const t of tagList) {
      if (t.name || t.pending === t.key) continue;
      const key = t.key;
      t.pending = key;
      const ep = nameEpoch;
      nameOf(t.bx, t.bz, t.s).then((nm) => {
        if (ep !== nameEpoch) return;
        if (nm === null) { if (t.key === key) t.pending = -1; tagCam[0] = NaN; return; }   // network error: retry at the next scan
        nameMemo.set(key, nm); if (t.key === key) t.name = nm;
      });
    }
    if (nameMemo.size > 5000) nameMemo.clear();
  }
  const W = innerWidth, H = innerHeight;
  const placed = PLACED;
  placed.length = 0;
  let used = 0;
  for (const t of tagList) {
    if (!t.name || used >= 24) continue;
    TV[0] = t.x; TV[1] = t.y; TV[2] = t.z; TV[3] = 1;
    const c = mulv(VP, TV, TC);
    if (c[3] <= 0.5) continue;
    const sx = (c[0] / c[3] * 0.5 + 0.5) * W, sy = (0.5 - c[1] / c[3] * 0.5) * H;
    if (sx < -50 || sx > W + 50 || sy < -20 || sy > H + 20) continue;
    if (t.hidden) continue;                     // behind a building (tested at the last scan)
    if (pin && pin.key !== undefined && t.key !== pin.key) continue;   // a home is selected: only its name (closing the card brings the others back)
    const w = t.name.length * 7 + 16;
    // never under the search bar or the round buttons (rects refreshed on resize)
    if (sy - 26 < UI_TOP || (sx + w / 2 > UI_TOOLS_X && sy > UI_TOOLS_Y)) continue;
    let clash = false;
    for (let q = 0; q < placed.length; q += 3) if (Math.abs(placed[q] - sx) < (placed[q + 2] + w) / 2 && Math.abs(placed[q + 1] - sy) < 20) { clash = true; break; }
    if (clash) continue;
    placed.push(sx, sy, w);
    let el = tagPool[used];
    if (!el) { el = document.createElement('div'); el.className = 'tag'; $('#tags').appendChild(el); tagPool.push(el); }
    if (el.textContent !== t.name) el.textContent = t.name;
    // touch the DOM only when the tag actually moved (each write builds a string)
    const ix = Math.round(sx), iy = Math.round(sy);   // whole pixels: small-integer strings are cached by the engine
    if (ix !== el.sx || iy !== el.sy || el.style.display === 'none') {
      el.sx = ix; el.sy = iy;
      el.style.transform = 'translate(' + ix + 'px,' + iy + 'px) translate(-50%,-100%)';
    }
    const op = Math.round(Math.max(0.45, 1 - t.d / 400) * 20);
    if (el.op !== op) { el.op = op; el.style.opacity = String(op / 20); }
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
function cancelFly() { fly = null; uiSeq++; }      // a manual move also outranks a pending tap or search
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
    return { x: f.x + 10, y, z: f.z + face * (24 + (y - top) * 0.75), yaw: 0, pitch: 0, bx, bz, slot, zone, tx: f.x, tz: f.z, ty: top / 0.6 };
  }
  // across the street and up: never inside the house opposite (its roof is checked around the camera too),
  // and high enough that the whole target home, roof included, is in view over anything in between
  // three-quarter view: 24 m out from the front, 25° off the axis, a storey or two above the roof
  // portrait of the home (round M): fit its front to 45-60% of the screen width, 20-30° off the facade normal,
  // eye 9-14 m up (above the house opposite when needed), the home a little above the screen centre so the
  // bottom sheet never covers it. Both sides are tried; the one with a clear sight line wins.
  const q = plotInfo(bx, bz, slot, zone).q, hx = (q[0] + q[2]) / 2, hz = (q[1] + q[3]) / 2, hw = q[2] - q[0];
  const front = face < 0 ? q[1] : q[3];
  const aspect = innerWidth / innerHeight, vfov = Math.PI / 3, hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const dist = Math.max(16, Math.min(40, (hw / 0.52) / (2 * Math.tan(hfov / 2))));
  const pref = (hash3(bx, bz, slot) & 1) ? 1 : -1;
  let best = null;
  for (const sd of [pref, -pref]) for (const ang of [0.44, 0.36]) {
    const x = hx + sd * Math.sin(ang) * dist, z = front + face * Math.cos(ang) * dist;
    let y = Math.max(9, Math.min(14, top + 4));
    y = Math.max(y, heightAt(x, z) + 2);                // above the house opposite, never inside it
    let block = 0;
    for (let t = 0.1; t < 0.85; t += 0.05) {
      const sx = x + (hx - x) * t, sz = z + (front - z) * t, sy = y + (top * 0.5 - y) * t;
      block = Math.max(block, heightAt(sx, sz) - sy);
    }
    if (!best || block < best.block) best = { x, y, z, block };
  }
  const { x, z } = best, y = best.y + Math.max(0, best.block + 1);
  const dx = hx - x, dz = (front - face * 1) - z, dh = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, -dz), pitch = -Math.atan2(y - top * 0.5, dh) - vfov * 0.12;   // home at ~38% from the top
  return { x, y, z, yaw, pitch, fixed: true, bx, bz, slot, zone, tx: hx, tz: hz, ty: top, px: hx, py: top + 1.2, pz: hz };
}
function lookAtYaw(v) {
  if (v.fixed) return v;                              // homeView already framed it
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
  // the arc must clear every building under the path (a short hop through the towers would fly through them)
  let clear = 0;
  const steps = Math.max(32, Math.min(600, Math.ceil(d / 10)));   // every <= 10 m (up to 6 km)
  for (let k = 1; k < steps; k++) {
    const t = k / steps, h = heightAt(from.x + (v.x - from.x) * t, from.z + (v.z - from.z) * t);
    const base = from.y + (v.y - from.y) * t, arc = Math.sin(Math.PI * t);
    if (h > 0 && h + 15 > base) clear = Math.max(clear, (h + 15 - base) / Math.max(0.05, arc));
  }
  fly = { from, to: v, dyaw, t0: performance.now(), dur: Math.min(7000, 1800 + Math.sqrt(d) * 45), lift: Math.min(1800, Math.max(d * 0.35, clear)) };
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
  if (!shardCache.has(key)) {
    const pr = fetch(`${TOWN_URL}s/${key}.json?v=${(manifest.sh && manifest.sh[key]) || manifest.built}`)
      .then((r) => (r.ok ? r.json() : r.status === 404 ? [] : Promise.reject(new Error(r.status))))
      .catch(() => { if (shardCache.get(key) === pr) shardCache.delete(key); return null; });   // not cached: the next search retries
    capSet(shardCache, key, pr);
  }
  return shardCache.get(key);
}
async function findName(q) {
  const norm = normName(q);
  if (!norm) return [];
  const list = await shard(norm);
  if (!list) return null;                             // network error (not "no such follower")
  const out = [];
  for (const e of list) { if (e[0].startsWith(norm)) { out.push(e); if (out.length > 60) break; } }
  out.sort((a, b) => (a[0] === norm ? -1 : b[0] === norm ? 1 : a[0].length - b[0].length || a[1] - b[1]));
  return out.slice(0, 8);
}
async function flyToName(name, instant) {
  if (!L) return false;
  const norm = normName(name);
  const my = ++uiSeq;
  const list = await findName(norm);
  if (my !== uiSeq) return false;                   // a later tap or search won
  if (list === null) { toast('Network problem: try again'); return false; }
  const hit = list.find((e) => e[0] === norm) || list[0];
  if (!hit) { toast(`No home for “${name}” yet`); return false; }
  const v = flyTo(hit[1], instant);
  pin = { x: v.px !== undefined ? v.px : v.tx, y: v.py !== undefined ? v.py : v.ty * 0.6 + 9, z: v.pz !== undefined ? v.pz : v.tz, key: plotKey(v.bx, v.bz, v.slot) };
  v.here = true;
  showCard(hit[0], hit[1], v);
  history.replaceState(null, '', '#u=' + encodeURIComponent(hit[0]));
  return true;
}
const search = $('#search'), sugg = $('#sugg');
let suggTimer = 0, suggSel = -1, suggSeq = 0;
search.addEventListener('input', () => {
  clearTimeout(suggTimer);
  suggTimer = setTimeout(async () => {
    const my = ++suggSeq;
    const list = (await findName(search.value)) || [];
    if (my !== suggSeq) return;              // a newer query answered first: never show stale suggestions
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
  // a Tokyo-style address: ward from the district, chome-ban-go from the block and plot
  const { bx, bz, slot } = plotOf(L, p);
  const ward = ['Jutaku', 'Villa', 'Shotengai', 'Tower'][v.zone] + ' ' + (['Kita', 'Minami', 'Higashi', 'Nishi'][(bx > 0) + 2 * (bz > 0)]);
  $('#card-name').textContent = name || 'Unclaimed home';
  $('#card-meta').textContent = `${ward} ${Math.abs(bx) % 9 + 1}-${Math.abs(bz) % 30 + 1}-${slot + 1} · home #${(p + 1).toLocaleString()}`;
  c.hidden = false;
  c.dataset.p = p;
  c.dataset.name = name || '';
  $('#card-go').hidden = !!v.here;                    // already there: no "Fly there"
  // neighbours: the two plots either side in follower order
  const nb = $('#card-nb');
  nb.textContent = '';
  for (const q of [p - 1, p + 1]) if (q >= 0 && q < L.n) nameOf(...Object.values(plotOf(L, q)).slice(0, 3)).then((n) => {
    if (c.dataset.p !== String(p) || !n) return;
    const b = document.createElement('button'); b.className = 'nb'; b.textContent = (q < p ? '‹ ' : '') + n + (q > p ? ' ›' : '');
    b.onclick = () => { uiSeq++; flyToIndex(q, n); };
    if (q < p) nb.prepend(b); else nb.appendChild(b);
  });
}
$('#card-close').onclick = () => { uiSeq++; $('#card').hidden = true; pin = null; };
$('#card-go').onclick = () => { uiSeq++; const p = +$('#card').dataset.p; if (p >= 0) flyToIndex(p, $('#card').dataset.name); };
$('#card-share').onclick = async () => {
  const n = $('#card').dataset.name, url = location.href.split('#')[0].split('?')[0] + '#u=' + encodeURIComponent(n);
  try { if (navigator.share) await navigator.share({ title: n + ' · Follower Town', url }); else { await navigator.clipboard.writeText(url); toast('Link copied'); } } catch { /* cancelled */ }
};
function flyToIndex(p, name) {
  const v = flyTo(p);
  pin = { x: v.px !== undefined ? v.px : v.tx, y: v.py !== undefined ? v.py : v.ty * 0.6 + 9, z: v.pz !== undefined ? v.pz : v.tz, key: plotKey(v.bx, v.bz, v.slot) };
  v.here = true;
  showCard(name, p, v);
  if (name) history.replaceState(null, '', '#u=' + encodeURIComponent(name));
}
let uiSeq = 0;                                       // only the latest tap / search may set the card, pin and flight
async function onTap(x, y) {
  if (!L || !invVP) return;
  const hit = pick(x, y);
  if (!hit) return;
  const my = ++uiSeq;
  const name = await nameOf(hit.bx, hit.bz, hit.slot);
  if (my !== uiSeq) return;                         // a later tap or search won
  if (name === null) { toast('Network problem: try again'); return; }
  const q = plotInfo(hit.bx, hit.bz, hit.slot, hit.zone).q;
  pin = { x: (q[0] + q[2]) / 2, y: homeTop(hit.bx, hit.bz, hit.slot, hit.zone) + 0.8, z: (q[1] + q[3]) / 2, key: plotKey(hit.bx, hit.bz, hit.slot) };
  showCard(name, hit.p, { zone: hit.zone });
}
let toastTimer = 0;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600); }

// ---------------- buttons ----------------
const TODS = [0.22, 1, 2];
$('#btn-time').onclick = () => { const i = TODS.findIndex((t) => Math.abs(t - tod) < 0.3); setTod(TODS[(i + 1) % TODS.length]); };
$('#btn-home').onclick = () => { uiSeq++; fly = { from: { ...cam }, to: { ...HOME }, dyaw: Math.atan2(Math.sin(HOME.yaw - cam.yaw), Math.cos(HOME.yaw - cam.yaw)), t0: performance.now(), dur: 3000, lift: 300 }; };
$('#btn-help').onclick = () => { $('#help').hidden = !$('#help').hidden; };
$('#help').onclick = () => { $('#help').hidden = true; };

// ---------------- debug / automation hooks ----------------
window.__town = {
  cam, stats, quality, chunks, skies, flyToName, setTod,
  killWorker: (i) => sup.died(sup.workers[i], 'killed by test'),
  probe, spin, get dbg() { return { reqs: reqs.size, upq: UPQ.length, budget: sup.workers.length * 3 - reqs.size, loads: sup.workers.map((w) => w.load) }; }, get layout() { return L; }, get ready() { return ready; }, get VP() { return VP; },
  idle() {
    if (!ready || reqs.size || UPQ.length) return false;
    for (const c of chunks.values()) if (c.lod !== c.want || c.stale) return false;
    for (const s of skies.values()) if (!s.loaded) return false;
    for (const s of mids.values()) if (!s.loaded) return false;
    return true;
  },
};
boot();
requestAnimationFrame(frame);
setTimeout(clampCam, 1500);
