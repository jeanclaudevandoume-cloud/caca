// Follower Town — wiring: GL context, quality, camera, workers, boot and layout updates, the frame loop.
// The parts live in their own modules: gfx (GL helpers, maths), streaming (chunk requests and uploads),
// data (names, search, custom homes), view (heights, picking, arrival camera, flights), tags (which names
// show where), render (one frame), ui (page, input, card, tag overlay), supervisor (the worker pool),
// session (worker routing and the layout lifecycle).
import { lowNext } from './town.js';
import { ROOF } from './recipe.js';
import { Supervisor } from './supervisor.js';
import { buildAtlas, atlasTexture, fillAtlas } from './atlas.js';
import { GEO_VS, GEO_FS, SHADOW_VS, SHADOW_FS, FULL_VS, FULL_FS, COPY_FS } from './shaders.js';
import { createGfx } from './gfx.js';
import { createStreamer } from './streaming.js';
import { createTownData } from './data.js';
import { createView } from './view.js';
import { createTagState, resetTags, scanTags, placeTags } from './tags.js';
import { createRenderer } from './render.js';
import { createUI } from './ui.js';
import { createSession, createGroundWin } from './session.js';
import { createGovernor } from './governor.js';

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
try { atlasTex = atlasTexture(gl); } catch (e) { console.error('atlas', e); }   // windows fall back to flat colour without it
const hasStencil = !!(gl.getContextAttributes() || {}).stencil;      // without it shadows would darken twice
gl.useProgram(P.full.p);
gl.uniform3fv(P.full.u.uRoof, new Float32Array(ROOF.flatMap((c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255])));

// ---------------- state ----------------
// ART.md composition (round F): a low drone over dense jutaku and villa lanes south-west of the river, the
// towers and spire as the backdrop. The product is "your follower's home", so homes fill the opening frame.
const HOME = { x: -176, y: 24, z: 1190, yaw: 0.12, pitch: -0.17 };   // low over a north-south lane: a lit street canyon leads the eye to the towers
if (innerWidth / innerHeight > 1.2) Object.assign(HOME, { y: 26, pitch: -0.2 });   // landscape: wider frame; a little steeper so the far field (tris, draws) stays in budget
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
  RAD.r0 = 320 * Math.max(0.6, quality.s); RAD.r1 = isLow() ? RAD.r0 * 1.0 : 1100 * quality.s; RAD.rs = Math.min(5000, 7000 * quality.s * quality.s);
  return RAD;
}
// shared state the modules read live
const app = { cam, L: null, pin: null, fly: null, tod: params.has('tod') ? parseFloat(params.get('tod')) : 2, bootMs: 0 };
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
    w.onmessage = (e) => session.onWorker(e);
    w.onerror = (e) => { if (e.preventDefault) e.preventDefault(); console.error('worker died:', e.message); s.died(w, e.message || 'failed to start'); };
    return w;
  },
});
// the ground data texture's window (render.js uploads it, streaming.js asks for a new one, session.js owns it)
const groundWin = createGroundWin();
const streamer = createStreamer({
  sup, customFor: (cx, cz) => data.customFor(cx, cz), upload: gfx.upload, release: gfx.release, isLow, radii,
  groundWin, hyst: !params.has('nohyst'),          // ?nohyst / ?nosink: planted pops for tools/poptest.cjs
  onTick: () => { if (!document.hidden) sup.sweep(); session.ensureAtlas(); },
});
const renderer = createRenderer({ gl, gfx, P, geoProg, app, streamer, quality, isLow, radii, hasStencil, atlasTex, canvas, groundWin, fullres: params.has('fullres'), nosink: params.has('nosink'), frozenT, t0 });
function flyTo(p, instant) {
  const v = view.lookAtYaw(view.homeView(p, innerWidth / innerHeight));
  app.fly = view.planFly(cam, v, performance.now(), instant);
  return v;
}
ui = createUI({ app, view, data, HOME, canvas, flyTo, getInvVP: () => renderer.invVP, hashParams });
const reqs = sup.reqs;

// ---------------- workers, boot and layout updates (session.js) ----------------
const fetchLayout = (mf) => fetch(`${TOWN_URL}layout.bin?v=${mf.layout}`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
const session = createSession({
  fetchLayout,
  sup, renderer, streamer, data, app, groundWin, tagState, resetTags, view, fail,
  onAtlas: (buf) => {
    const aniso = !PHONE && qParam !== 'low';
    try { fillAtlas(gl, atlasTex, buf ? new Uint8Array(buf) : buildAtlas().data, aniso); }   // null: no OffscreenCanvas in workers, paint here
    catch (err) { console.error('atlas', err); }
  },
  onCount: (n) => ui.setCount(n),
  onReady: () => {
    window.__ftReady = true;
    // desktops may switch presets: compile the other material variant while idle, never inside a frame
    if (!isPhone) (window.requestIdleCallback || ((f) => setTimeout(f, 2000)))(() => { try { geoProg(isLow() ? 'geo' : 'geoLow'); } catch (err) { console.error(err); } });
    app.bootMs = performance.now();
    $('#loading').classList.add('gone');
    const u = params.get('u') || hashParams().get('u');
    if (u && !restoredCam) ui.flyToName(u, params.has('instant'));   // after a context-loss reload, stay where the viewer was
  },
});
document.addEventListener('visibilitychange', () => sup.resetClocks());
sup.start();
session.ensureAtlas();                                // painted off the main thread (tracked: re-asked if its worker dies)
async function loadManifest() {
  const r = await fetch(TOWN_URL + 'manifest.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('manifest ' + r.status);
  return r.json();
}
let stage = 'starting';
setTimeout(() => { if (!session.ready) fail('Still not ready after 25 s. Last step: ' + stage + '.'); }, 25000);
async function boot() {
  stage = 'loading the town data';
  let m;
  try { m = await loadManifest(); } catch (e) { $('#loading').textContent = 'No town data yet. Run: npm run demo'; throw e; }
  stage = 'building the layout in the worker';
  session.boot(m);
  setInterval(async () => { try { session.poll(await loadManifest()); } catch { /* offline: keep the town we have */ } }, 5 * 60 * 1000);
}

// ---------------- frame ----------------
let lastFrame = performance.now();
const gov = createGovernor({ quality, stats: renderer.stats, hidden: () => document.hidden });
let lastActive = 0, lastRender = 0;
const SIG = new Float64Array(10);
function changed() {            // did anything that affects the image change? (numeric, no allocation)
  const v0 = cam.x, v1 = cam.y, v2 = cam.z, v3 = cam.yaw, v4 = cam.pitch, v5 = app.tod, v6 = canvas.width, v7 = canvas.height, v8 = reqs.size, v9 = app.pin ? 1 : 0;
  const c = SIG[0] !== v0 || SIG[1] !== v1 || SIG[2] !== v2 || SIG[3] !== v3 || SIG[4] !== v4 || SIG[5] !== v5 || SIG[6] !== v6 || SIG[7] !== v7 || SIG[8] !== v8 || SIG[9] !== v9;
  SIG[0] = v0; SIG[1] = v1; SIG[2] = v2; SIG[3] = v3; SIG[4] = v4; SIG[5] = v5; SIG[6] = v6; SIG[7] = v7; SIG[8] = v8; SIG[9] = v9;
  return c;
}
function resize() {
  ui.uiRects();
  // the arrival camera keeps the home between the search bar and the card / bottom sheet (NDC, y up)
  {
    const H = innerHeight, top = document.getElementById('top'), tb = top ? top.getBoundingClientRect().bottom + 16 : 80;
    const sheet = innerWidth <= 600 && innerHeight > innerWidth ? 200 : 0.12 * H;
    app.safe = { top: 1 - 2 * tb / H, bottom: -1 + 2 * (sheet + 16) / H, side: 0.88 };
  }
  ui.resizeTags();
  const pr = Math.min(window.devicePixelRatio || 1, quality.pr);
  const w = Math.round(innerWidth * pr), h = Math.round(innerHeight * pr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function frame(now) {
  requestAnimationFrame(frame);
  if (gl.isContextLost()) return;          // the context-lost handler reloads; draw nothing meanwhile
  if (simClock) return;                    // tools/poptest.cjs drives frames itself (__town.sim)
  step(now);
}
function step(now) {
  const dtMs = now - lastFrame; lastFrame = now;
  const dt = Math.min(0.1, dtMs / 1000);
  gov.sample(dtMs);
  gov.tick(now);
  ui.updateInput(dt);
  app.fly = view.stepFly(app.fly, cam, now);
  resize();
  streamer.stream(now, cam, app.L, session.tallRegions);
  streamer.drain();
  if (!session.ready) return;                                    // nothing to draw until the layout exists
  // when nothing moves and nothing is loading, draw at ~12 fps (water and clouds still drift)
  if (changed() || app.fly) lastActive = now;
  // with frozen time (?t=) an idle frame is identical: don't redraw at all
  if (now - lastActive > 1500 && (frozenT !== null || now - lastRender < 80) && !params.has('shot')) return;
  lastRender = now;
  if (now - lastActive < 1500) gov.count(dtMs);                  // the governor only counts active, rendered frames
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
// Simulated frames on a virtual 60 fps clock (poptest.cjs): once called, the rAF loop stops for good (a test-only
// hook: reload the page to get the real loop back); every call draws n frames 16 ms apart.
let simClock = 0;
function sim(n = 4) {
  if (!simClock) simClock = lastFrame || performance.now();
  for (let i = 0; i < n; i++) { simClock += 16; step(simClock); }
}
function spin(n = 30) {
  const yaw = cam.yaw;
  for (let i = 0; i < n; i++) { cam.yaw = yaw + i * 0.001; step(performance.now() + i * 16); }
  cam.yaw = yaw;
}

// ---------------- debug / automation hooks ----------------
window.__town = {
  cam, stats: renderer.stats, quality, chunks: streamer.chunks, skies: streamer.skies, flyToName: (n, i) => ui.flyToName(n, i), setTod: (t) => { app.tod = t; },
  get tagCount() { return tagState.used; },
  killWorker: (i) => sup.died(sup.workers[i], 'killed by test'),
  probe: (n) => renderer.probe(n), spin, sim, set lodCam(v) { app.lodCam = v; },
  get dbg() { return { reqs: reqs.size, upq: streamer.UPQ.length, budget: sup.workers.length * 3 - reqs.size, loads: sup.workers.map((w) => w.load) }; },
  get layout() { return app.L; }, get ready() { return session.ready; }, get VP() { return renderer.VP; },
  idle() { return session.ready && streamer.idle(); },
};
boot();
requestAnimationFrame(frame);
setTimeout(() => ui.clampCam(), 1500);
