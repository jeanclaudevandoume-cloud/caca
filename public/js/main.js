// Follower Town — wiring: GL context, quality, camera, workers, boot and layout updates, the frame loop.
// The parts live in their own modules: gfx (GL helpers, maths), streaming (chunk requests and uploads),
// data (names, search, custom homes), view (heights, picking, arrival camera, flights), tags (which names
// show where), render (one frame), ui (page, input, card, tag overlay), supervisor (the worker pool).
import { finishLayout, ROOF, lowNext } from './town.js';
import { Supervisor } from './supervisor.js';
import { uploadAtlas } from './atlas.js';
import { GEO_VS, GEO_FS, SHADOW_VS, SHADOW_FS, FULL_VS, FULL_FS, COPY_FS } from './shaders.js';
import { createGfx } from './gfx.js';
import { createStreamer } from './streaming.js';
import { createTownData } from './data.js';
import { createView } from './view.js';
import { createTagState, resetTags, scanTags, placeTags } from './tags.js';
import { createRenderer } from './render.js';
import { createUI } from './ui.js';

window.__ftBooted = true;
const $ = (s) => document.querySelector(s);
// ---- diagnostics: on any failure show the reason on screen (phones have no console) ----
const DIAG = [];
let ui = null;
function fail(msg, force = false) {
  if (!force && window.__ftGL && window.__ftGL.isContextLost()) return;   // the context-lost handler reloads; not an error
  if (window.__ftReady && !String(msg).includes('lost')) { console.error(msg); try { ui.toast('Something went wrong: ' + String(msg).slice(0, 80)); } catch { /* ignore */ } return; }
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
    // keep the view across the reload (the handler only runs after boot)
    try { sessionStorage.setItem('ft-cam', [cam.x, cam.y, cam.z, cam.yaw, cam.pitch].map((v) => v.toFixed(3)).join(',')); } catch { /* ignore */ }
    setTimeout(() => location.reload(), 500);
  } else {
    try { sessionStorage.removeItem('ft-cam'); } catch { /* ignore */ }
    window.__ftReady = false;                       // show the panel, not a toast
    fail('The graphics context was lost twice (the GPU ran out of memory or was reset). Try ?q=low or close other tabs.', true);
  }
});
setTimeout(() => { try { sessionStorage.removeItem('ft-lost'); } catch { /* ignore */ } }, 20000);

const gfx = createGfx(gl, fail);
// The material shader exists in two variants; only the one the preset uses is compiled at boot,
// the other on first use (phones never pay for the high one).
const GEO_SRC = { geo: GEO_FS, geoLow: GEO_FS.replace('#version 300 es', '#version 300 es\n#define LOWQ') };
function geoProg(which) { if (!P[which]) P[which] = gfx.prog(GEO_VS, GEO_SRC[which]); return P[which]; }
const P = { shadow: gfx.prog(SHADOW_VS, SHADOW_FS), full: gfx.prog(FULL_VS, FULL_FS), copy: gfx.prog(FULL_VS, COPY_FS) };
let atlasTex = null;
try { atlasTex = uploadAtlas(gl, !PHONE && qParam !== 'low'); } catch (e) { console.error('atlas', e); }   // windows fall back to flat colour without it
const hasStencil = !!(gl.getContextAttributes() || {}).stencil;      // without it shadows would darken twice
gl.useProgram(P.full.p);
gl.uniform3fv(P.full.u.uRoof, new Float32Array(ROOF.flatMap((c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255])));

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
  // low (round M): full houses only; the massing tiles replace the simplified-house ring
  RAD.r0 = 320 * Math.max(0.6, quality.s); RAD.r1 = isLow() ? RAD.r0 * 1.12 : 1100 * quality.s; RAD.rs = Math.min(5000, 7000 * quality.s * quality.s);
  return RAD;
}
// shared state the modules read live
const app = { cam, L: null, pin: null, fly: null, tod: params.has('tod') ? parseFloat(params.get('tod')) : 0.22, bootMs: 0 };
let ready = false;
const t0 = performance.now();
const frozenT = params.has('t') ? parseFloat(params.get('t')) : null;
const showTags = !params.has('notags');

let restoredCam = false;
{ let c = params.get('cam'); try { if (!c) { c = sessionStorage.getItem('ft-cam'); restoredCam = !!c; } sessionStorage.removeItem('ft-cam'); } catch { /* ignore */ } if (c) { const v = c.split(',').map(Number); if (v.length === 5 && v.every(Number.isFinite)) Object.assign(cam, { x: v[0], y: v[1], z: v[2], yaw: v[3], pitch: v[4] }); } }

// ---------------- modules ----------------
const data = createTownData({ fetch: (u, o) => fetch(u, o), base: TOWN_URL });
const view = createView(app);
const tagState = createTagState();
const NW = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
// The pool, requests, back-off and layout-build tracking live in supervisor.js (unit-tested in selftest).
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
// the ground data texture's window (render.js uploads it, streaming.js asks for a new one as the camera moves)
const groundWin = { ox: 0, oz: 0, cx: 0, cz: 0, full: true, req: 0 };
const streamer = createStreamer({
  sup, customFor: (cx, cz) => data.customFor(cx, cz), upload: gfx.upload, release: gfx.release, isLow, radii,
  groundWin,
  onTick: () => { if (!document.hidden) sup.sweep(); },
});
const renderer = createRenderer({ gl, gfx, P, geoProg, app, streamer, quality, isLow, radii, hasStencil, atlasTex, canvas, groundWin, fullres: params.has('fullres'), frozenT, t0 });
function flyTo(p, instant) {
  const v = view.lookAtYaw(view.homeView(p, innerWidth / innerHeight));
  app.fly = view.planFly(cam, v, performance.now(), instant);
  return v;
}
ui = createUI({ app, view, data, HOME, canvas, flyTo, getInvVP: () => renderer.invVP, hashParams });
const reqs = sup.reqs;

// ---------------- workers ----------------
let badBuilt = null, layoutStage = null, tallRegions = new Set();
function onWorker(e) {
  const m = e.data;
  if (m.type === 'ground') { sup.reply(m.id); if (groundWin.req === m.id) { groundWin.req = 0; renderer.setGround(m.ground); } return; }   // a new ground window
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
    streamer.onError(m, r);
    return;
  }
  streamer.onMesh(m, r);
}
document.addEventListener('visibilitychange', () => sup.resetClocks());
sup.start();

// ---------------- boot and layout updates ----------------
async function loadManifest() {
  const r = await fetch(TOWN_URL + 'manifest.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('manifest ' + r.status);
  return r.json();
}
function onLayout(lt, ground) {
  // validate before touching anything: a rejected layout leaves the current one (and every worker) as it was
  if (!renderer.setGround(ground)) {
    if (layoutStage) badBuilt = layoutStage.manifest.built;
    layoutStage = null;
    fail(`This town is too large for this GPU (${ground.size} > ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}).`);
    return;
  }
  // a ground window requested before this commit was built from the old layout: never let it land
  groundWin.req = 0;
  const old = app.L;
  app.L = finishLayout(lt);
  sup.commit(lt);                                   // every worker, the builder too (it built into a local)
  tallRegions = new Set(app.L.tall);                 // regions that can hold skyline buildings (computed by the worker)
  if (layoutStage) {
    // commit the update: new manifest, fresh name caches (names may have changed), tags rescanned; rebuild
    // only what changed: the ring of new homes and regions whose custom file changed
    const oldC = layoutStage.oldC;
    data.commit(layoutStage.manifest);
    resetTags(tagState); view.clear();
    if (old) {
      const mc = data.manifest.c, changed = new Set();
      for (const k of Object.keys(mc || {})) if (!oldC || oldC[k] !== mc[k]) changed.add(k);
      for (const k of Object.keys(oldC || {})) if (!mc || !mc[k]) changed.add(k);
      streamer.flushChanged(old, changed);
      for (const k of changed) data.dropCustom(k);
    }
  }
  layoutStage = null;
  ui.setCount(app.L.n);
  if (!ready) {
    ready = true;
    window.__ftReady = true;
    // desktops may switch presets: compile the other material variant while idle, never inside a frame
    if (!isPhone) (window.requestIdleCallback || ((f) => setTimeout(f, 2000)))(() => { try { geoProg(isLow() ? 'geo' : 'geoLow'); } catch (err) { console.error(err); } });
    app.bootMs = performance.now();
    $('#loading').classList.add('gone');
    const u = params.get('u') || hashParams().get('u');
    if (u && !restoredCam) ui.flyToName(u, params.has('instant'));   // after a context-loss reload, stay where the viewer was
  }
}
// The layout is a formula (town.js): the worker builds a few small tables from n. A layout update builds
// against the staged manifest; it becomes current only when its layout arrives (onLayout), so a failed build
// leaves the old manifest and layout consistent.
function initLayout() {
  const mf = layoutStage ? layoutStage.manifest : data.manifest;
  sup.startBuild(mf.n, null);
}
let stage = 'starting';
setTimeout(() => { if (!ready) fail('Still not ready after 25 s. Last step: ' + stage + '.'); }, 25000);
async function boot() {
  stage = 'loading the town data';
  try { data.commit(await loadManifest()); } catch (e) { $('#loading').textContent = 'No town data yet. Run: npm run demo'; throw e; }
  stage = 'building the layout in the worker';
  initLayout();
  setInterval(async () => {
    try {
      const m = await loadManifest();
      if (m.built !== data.manifest.built && m.built !== badBuilt && !layoutStage) {   // skip while one is applied, and a rejected build
        layoutStage = { oldC: data.manifest.c, manifest: m };
        initLayout();
      }
    } catch { /* offline: keep the town we have */ }
  }, 5 * 60 * 1000);
}

// ---------------- frame ----------------
let lastFrame = performance.now(), frameAcc = 0, frameN = 0, lastGov = performance.now();
let lastActive = 0, lastRender = 0;
const SIG = new Float64Array(10);
function changed() {            // did anything that affects the image change? (numeric, no allocation)
  const v0 = cam.x, v1 = cam.y, v2 = cam.z, v3 = cam.yaw, v4 = cam.pitch, v5 = app.tod, v6 = canvas.width, v7 = canvas.height, v8 = reqs.size, v9 = app.pin ? 1 : 0;
  const c = SIG[0] !== v0 || SIG[1] !== v1 || SIG[2] !== v2 || SIG[3] !== v3 || SIG[4] !== v4 || SIG[5] !== v5 || SIG[6] !== v6 || SIG[7] !== v7 || SIG[8] !== v8 || SIG[9] !== v9;
  SIG[0] = v0; SIG[1] = v1; SIG[2] = v2; SIG[3] = v3; SIG[4] = v4; SIG[5] = v5; SIG[6] = v6; SIG[7] = v7; SIG[8] = v8; SIG[9] = v9;
  return c;
}
const refresh = { samples: [], ms: 16.7 };
function resize() {
  ui.uiRects();
  ui.resizeTags();
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
  ui.updateInput(dt);
  app.fly = view.stepFly(app.fly, cam, now);
  resize();
  streamer.stream(now, cam, app.L, tallRegions);
  streamer.drain();
  if (!ready) return;                                            // nothing to draw until the layout exists
  // when nothing moves and nothing is loading, draw at ~12 fps (water and clouds still drift)
  if (changed() || app.fly) lastActive = now;
  // with frozen time (?t=) an idle frame is identical: don't redraw at all
  if (now - lastActive > 1500 && (frozenT !== null || now - lastRender < 80) && !params.has('shot')) return;
  lastRender = now;
  if (now - lastActive < 1500) { frameAcc += dtMs; frameN++; }   // the governor only counts active, rendered frames
  renderer.render(now);
  if (showTags) tags(now);
  const stats = renderer.stats;
  if (params.has('debug')) $('#debug').textContent = `${stats.fps} fps · ${(stats.tris / 1000) | 0}k tris · ${stats.draws} draws · ${stats.sky} sky · ${stats.chunks} chunks · ${stats.mb} MB · pr ${quality.pr.toFixed(2)} s ${quality.s.toFixed(2)}`;
}
function tags(now) {
  if (!app.L || !renderer.VP) return;
  scanTags(tagState, now, cam, app.L, !!app.fly, view, (bx, bz, s) => data.nameOf(bx, bz, s));
  const pinKey = app.pin && app.pin.key !== undefined ? app.pin.key : undefined;
  if (placeTags(tagState, renderer.VP, innerWidth, innerHeight, ui.rects, pinKey, ui.measure)) ui.drawTags(tagState);
}
// Run the whole frame loop body n times without waiting for vsync (allocation measurements).
function spin(n = 30) {
  const yaw = cam.yaw;
  for (let i = 0; i < n; i++) { cam.yaw = yaw + i * 0.001; step(performance.now() + i * 16); }
  cam.yaw = yaw;
}

// ---------------- adaptive quality ----------------
let govGood = 0;
function governor(now) {
  if (now - lastGov < 1000) return;
  if (frameN < 10) { lastGov = now; return; }          // idle: nothing to judge
  const avg = frameAcc / Math.max(1, frameN);
  renderer.stats.fps = Math.round(1000 / avg); renderer.stats.ms = avg;
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

// ---------------- debug / automation hooks ----------------
window.__town = {
  cam, stats: renderer.stats, quality, chunks: streamer.chunks, skies: streamer.skies, flyToName: (n, i) => ui.flyToName(n, i), setTod: (t) => { app.tod = t; },
  get tagCount() { return tagState.used; },
  killWorker: (i) => sup.died(sup.workers[i], 'killed by test'),
  probe: (n) => renderer.probe(n), spin,
  get dbg() { return { reqs: reqs.size, upq: streamer.UPQ.length, budget: sup.workers.length * 3 - reqs.size, loads: sup.workers.map((w) => w.load) }; },
  get layout() { return app.L; }, get ready() { return ready; }, get VP() { return renderer.VP; },
  idle() { return ready && streamer.idle(); },
};
boot();
requestAnimationFrame(frame);
setTimeout(() => ui.clampCam(), 1500);
