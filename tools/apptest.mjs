// Headless tests of the app modules (no browser, no GL): streaming, data, tags, view (arrival camera and
// flights) and search sequencing, with fake workers, a fake fetch and fake GL handles.
//   node tools/apptest.mjs
// Each check guards a past bug class; tools/selftest.mjs runs this file too.
import * as Town from '../public/js/town.js';
import * as Layout from '../public/js/layout.js';
import { SKY } from '../public/js/mb.js';
import { Supervisor } from '../public/js/supervisor.js';
import { createStreamer } from '../public/js/streaming.js';
import { createTownData, createLatest, searchHome } from '../public/js/data.js';
import { createView, plotKey } from '../public/js/view.js';
import { createTagState, scanTags, placeTags, resetTags, MAX_TAGS } from '../public/js/tags.js';
import { createSession, createGroundWin } from '../public/js/session.js';
import { persp, lookDir, mul } from '../public/js/gfx.js';
const T = { ...Town, ...Layout };   // the town rules (town.js, layout.js) as one namespace

const t0 = Date.now();
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }

let L = T.buildLayout(100000);
if (L.rB === undefined) L = T.finishLayout(L);
const tall = new Set(L.tall);                         // regions with skyline buildings (the formula layout lists them)
void SKY;
const HOME = { x: -176, y: 36, z: 1190, yaw: 0.12, pitch: -0.27 };

// ---------------- streaming ----------------
function harness({ meshBytes = 40000 } = {}) {
  let now = 0;
  const timers = [];
  const workers = [];
  const sup = new Supervisor({
    size: 3, now: () => now, later: (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; },
    spawn: () => { const w = { inbox: [], dead: false, postMessage(m) { this.inbox.push(m); }, terminate() { this.dead = true; } }; workers.push(w); return w; },
  });
  sup.start(); sup.commit({});
  const uploads = [], released = new Map();
  let handles = 0;
  const upload = (m) => { const g = { id: ++handles, bytes: m.vb.byteLength + m.ib.byteLength }; uploads.push(g); return g; };
  const release = (g) => { if (!g) return; released.set(g.id, (released.get(g.id) || 0) + 1); };
  const st = createStreamer({ sup, customFor: () => null, upload, release, isLow: () => true, radii: () => ({ r0: 192, r1: 363, rs: 2117 }) });
  const cam = { ...HOME };
  // the fake workers answer every request in their inbox with a mesh (or an error)
  function answer(errorFor = () => false) {
    for (const w of sup.workers) {
      const msgs = w.inbox.splice(0);
      for (const m of msgs) {
        if (m.type === 'init') continue;
        const r = sup.reply(m.id);
        if (errorFor(m)) st.onError({ type: 'error', id: m.id, message: 'boom' }, r);
        else st.onMesh({ type: 'mesh', id: m.id, vb: new ArrayBuffer(meshBytes - 600), ib: new Uint16Array(300) }, r);
      }
    }
  }
  function cycle(n = 1, opts = {}) {
    for (let i = 0; i < n; i++) {
      now += 200;
      for (const x of timers.splice(0)) if (x.at <= now) x.fn(); else timers.push(x);
      st.stream(now, cam, L, tall);
      if (!opts.noAnswer) answer(opts.errorFor);
      if (!opts.noDrain) st.drain();
    }
  }
  return { st, sup, cam, cycle, answer, uploads, released, workers, get now() { return now; }, set now(v) { now = v; } };
}
{
  const h = harness();
  h.cycle(1, { noAnswer: true, noDrain: true });
  check('streaming: never more requests in flight than 3 per worker', h.sup.reqs.size <= h.sup.workers.length * 3, `${h.sup.reqs.size}`);
  h.cycle(200);
  const holes = [...h.st.chunks.values()].filter((c) => c.d < 192 && !c.g);
  check('streaming: reaches idle from HOME with no holes inside r0', h.st.idle() && !holes.length, `idle=${h.st.idle()} holes=${holes.length}`);
  // a 150 m move: chunks cross r0 and are re-meshed at another detail level; the replaced meshes are released
  h.cam.x += 150; h.cam.z -= 150;
  h.cycle(40);
  const live = new Set([...h.st.chunks.values(), ...h.st.skies.values(), ...h.st.mids.values()].map((c) => c.g && c.g.id).filter(Boolean));
  const leaked = h.uploads.filter((g) => !live.has(g.id) && h.released.get(g.id) !== 1).length;
  const remeshed = h.uploads.length - live.size;
  check('streaming: re-meshed chunks release their old mesh exactly once (no GL leaks)', remeshed > 0 && leaked === 0, `replaced=${remeshed} leaked=${leaked}`);
  // a 2 km move: old chunks unload after 3 s, each GL handle released exactly once
  const before = [...h.st.chunks.values()].map((c) => c.g && c.g.id).filter(Boolean);
  h.cam.x += 2000;
  h.cycle(10);                                        // 2 s: nothing unloaded yet
  const early = before.filter((id) => h.released.get(id)).length;
  h.cycle(40);
  const twice = [...h.released.values()].filter((n) => n > 1).length;
  const freed = before.filter((id) => h.released.get(id) === 1).length;
  check('streaming: a 2 km move unloads after 3 s, releasing each handle exactly once', early === 0 && freed === before.length && twice === 0, `early=${early} freed=${freed}/${before.length} twice=${twice}`);
}
{
  // a reply that arrives for a target that is then unloaded (gone) is never uploaded
  const h = harness();
  h.cycle(1, { noAnswer: true, noDrain: true });
  h.answer();                                         // replies queued, not uploaded yet
  const queued = h.st.UPQ.length;
  h.cam.x += 5000; h.now += 3500;
  h.st.stream(h.now, h.cam, L, tall);                  // the old targets are gone
  const n0 = h.uploads.length;
  h.st.drain(1e12);
  check('streaming: a queued reply for a gone chunk is never uploaded', queued > 0 && h.uploads.length === n0, `queued=${queued} uploaded=${h.uploads.length - n0}`);
  // superseded: a target re-requested after its first reply was queued
  const h2 = harness();
  h2.cycle(1, { noAnswer: true, noDrain: true });
  h2.answer();
  const t = h2.st.UPQ[0].t;
  t.req = 999999;                                     // a newer request owns the target now
  const n1 = h2.uploads.length;
  h2.st.drain(1e12);
  check('streaming: a superseded reply is never uploaded', !h2.uploads.slice(n1).some((g) => g === t.g && t.req === 999999) && t.req === 999999, '');
}
{
  // a worker dies mid-flight: its targets are asked for again; 3 errors make a target give up
  const h = harness();
  h.cycle(1, { noAnswer: true, noDrain: true });
  const w = h.sup.workers[0];
  const lost = [...h.sup.reqs.values()].filter((r) => r.w === w).map((r) => r.target);
  h.sup.died(w, 'test');
  const freed = lost.every((t) => t.req === 0);
  h.cycle(1, { noAnswer: true, noDrain: true });
  const again = lost.filter((t) => t.req !== 0).length;
  check('streaming: a mid-flight worker death leads to a re-request', lost.length > 0 && freed && again > 0, `lost=${lost.length} re-requested=${again}`);
  const h2 = harness();
  let target = null;
  h2.cycle(4, { errorFor: (m) => { if (m.type !== 'chunk') return false; if (!target) target = `${m.cx},${m.cz}`; return target === `${m.cx},${m.cz}`; } });
  const c = [...h2.st.chunks.values()].find((x) => `${x.cx},${x.cz}` === target);
  const tries = c && c.fails;
  h2.cycle(5, { errorFor: () => false });
  check('streaming: 3 errors make a chunk give up (no endless retries)', c && tries === 3 && c.loaded && !c.req, `fails=${tries}`);
}
{
  // uploads: nearest first, <= 512 KB per drain
  const h = harness({ meshBytes: 200000 });
  h.cycle(1, { noAnswer: true, noDrain: true });
  h.answer();
  const ds = h.st.UPQ.map((q) => q.t.d).sort((a, b) => a - b);
  const n0 = h.uploads.length;
  h.st.drain();
  const up = h.uploads.length - n0;
  const nearest = [...h.st.chunks.values(), ...h.st.skies.values(), ...h.st.mids.values()].filter((c) => c.g).map((c) => c.d).sort((a, b) => a - b);
  check('streaming: one drain uploads <= 512 KB, nearest first', up === 3 && nearest.every((d, i) => d === ds[i]), `uploaded=${up}`);
}

// ---------------- data ----------------
function fakeFetch() {
  const calls = [];
  let mode = 'ok';
  const files = { n: 'alice\nbob\n', s: JSON.stringify([['ab', 2], ['abc', 1], ['abd', 3]]) };
  const f = (url) => {
    calls.push(url);
    const m = mode;
    if (m === 'net') return Promise.reject(new TypeError('network'));
    if (m === '404') return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => null });
    if (m === 'slow') return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, text: async () => files.n, json: async () => JSON.parse(files.s) }), 30));
    return Promise.resolve({ ok: true, status: 200, text: async () => files.n, json: async () => JSON.parse(files.s) });
  };
  return { f, calls, set mode(v) { mode = v; } };
}
{
  const ff = fakeFetch();
  const data = createTownData({ fetch: ff.f, later: (fn) => fn() });
  data.commit({ built: 1, split: [], c: {} });
  ff.mode = 'net';
  const a = await data.nameOf(0, 0, 0);
  ff.mode = 'ok';
  const b = await data.nameOf(0, 0, 0);
  check('data: a failed fetch is not cached; the retry succeeds', a === null && typeof b === 'string' && ff.calls.length === 2, `first=${a} second=${JSON.stringify(b)} fetches=${ff.calls.length}`);
  const ff2 = fakeFetch();
  const d2 = createTownData({ fetch: ff2.f });
  d2.commit({ built: 1, split: [], c: {} });
  ff2.mode = '404';
  const x = await d2.nameOf(3, 3, 0), y = await d2.nameOf(3, 3, 1);
  check('data: a 404 is "empty" (not an error) and is cached', x === '' && y === '' && ff2.calls.length === 1, `fetches=${ff2.calls.length}`);
  const ff3 = fakeFetch();
  const d3 = createTownData({ fetch: ff3.f });
  d3.commit({ built: 1, split: [], c: {} });
  ff3.mode = 'slow';
  await Promise.all([d3.nameOf(0, 0, 0), d3.nameOf(0, 0, 1), d3.findName('ab'), d3.findName('abc')]);
  check('data: concurrent callers share one fetch per file', ff3.calls.length === 2, `fetches=${ff3.calls.length}`);
  d3.commit({ built: 2, split: [], c: {} });
  ff3.mode = 'ok';
  await d3.nameOf(0, 0, 0);
  check('data: commit invalidates (a new version is fetched)', ff3.calls.length === 3 && ff3.calls[2].includes('v=2'), ff3.calls[2] || '');
  const ff4 = fakeFetch();
  const d4 = createTownData({ fetch: ff4.f });
  d4.commit({ built: 1, split: [], c: {} });
  ff4.mode = 'net';
  const s1 = await d4.findName('ab');
  ff4.mode = 'ok';
  const s2 = await d4.findName('ab');
  check('data: a failed search shard is not cached', s1 === null && Array.isArray(s2) && s2.length === 3, `first=${s1}`);
  check('search: the exact match ranks first', s2[0][0] === 'ab', JSON.stringify(s2));
}
{
  // a later search beats an earlier one that resolves late
  const slow = { findName: (n) => new Promise((r) => setTimeout(() => r([[n, 1]]), 40)) };
  const fast = { findName: (n) => Promise.resolve([[n, 2]]) };
  const seq = createLatest();
  const first = searchHome(slow, seq, 'aaa');
  const second = await searchHome(fast, seq, 'bbb');
  const r1 = await first;
  check('search: a later search beats an earlier one that resolves late', r1.stale && second.hit && second.hit[0] === 'bbb', JSON.stringify({ r1, second }));
  const seq2 = createLatest();
  const p = searchHome(slow, seq2, 'ccc');
  seq2.bump();                                         // a manual move / close in the meantime
  check('search: a manual move outranks a pending search', (await p).stale === true);
}

{
  // custom-home files: a network error is retried (without the retry the chunk would wait forever: a hole)
  const ff = fakeFetch();
  const d = createTownData({ fetch: ff.f, later: (fn) => fn() });
  d.commit({ built: 1, split: [], c: { '0_0': 'v1' } });
  ff.mode = 'net';
  const a = d.customFor(0, 0);
  await settle();
  ff.mode = 'ok';
  const b = d.customFor(0, 0);
  await settle();
  const c = d.customFor(0, 0);
  check('data: a failed custom-home file is fetched again and then arrives', a === undefined && b === undefined && c !== undefined && c !== null && ff.calls.length === 2, `fetches=${ff.calls.length} last=${JSON.stringify(c)}`);
  d.dropCustom('0_0');
  d.customFor(0, 0);
  check('data: dropCustom drops every version of a region', ff.calls.length === 3, `fetches=${ff.calls.length}`);
}

// ---------------- session: worker routing and the layout lifecycle ----------------
function sessionHarness({ maxTex = 1e9 } = {}) {
  const sup = new Supervisor({ size: 1, now: () => 0, later: () => 0, spawn: () => ({ sent: [], postMessage(m) { this.sent.push(m); }, terminate() {} }) });
  sup.start();
  const grounds = [], flushed = [], atlases = [];
  const renderer = { setGround: (g) => { if (g.size > maxTex) return false; grounds.push(g); return true; } };
  const streamer = { flushChanged: (old, changed) => flushed.push({ old, changed: [...changed].sort() }), onMesh() {}, onError() {} };
  const ff = fakeFetch();
  const data = createTownData({ fetch: ff.f });
  const app = { L: null };
  const tagState = createTagState();
  const view = { cleared: 0, clear() { this.cleared++; } };
  const groundWin = createGroundWin();
  const s = createSession({ sup, renderer, streamer, data, app, groundWin, tagState, resetTags, view, onAtlas: (d) => atlases.push(d) });
  const finish = (n, size = 9) => {
    const b = sup.build;
    s.onWorker({ data: { type: 'layout', build: b.id, layout: T.layoutTransfer(T.buildLayout(n)), ground: { size, ox: 0, oz: 0, cx: 0, cz: 0, full: true } } });
  };
  return { s, sup, data, app, grounds, flushed, finish, tagState, view, groundWin, atlases };
}
{
  // the facade atlas is a tracked job: its worker dying before the reply re-asks, and only the live reply lands
  const h = sessionHarness();
  h.s.boot({ built: 1, n: 5000, split: [], c: {} });
  h.finish(5000);
  h.s.ensureAtlas();
  const id1 = h.s.atlas.req, w1 = h.sup.reqs.get(id1).w;
  h.sup.died(w1, 'killed before the atlas arrived');
  const released = h.s.atlas.req === 0;
  h.s.ensureAtlas();
  const id2 = h.s.atlas.req;
  const posted = h.sup.workers.some((w) => w.sent.some((m) => m.type === 'atlas' && m.id === id2));
  h.s.onWorker({ data: { type: 'atlas', id: id1, data: new ArrayBuffer(4) } });   // the dead worker's late reply
  const staleIgnored = h.atlases.length === 0;
  h.s.onWorker({ data: { type: 'atlas', id: id2, data: null } });                  // no OffscreenCanvas: painted on the main thread
  h.s.ensureAtlas();
  check('session: the atlas is re-asked after its worker dies, a stale reply is ignored, the live one lands once',
    released && id2 && id2 !== id1 && posted && staleIgnored && h.atlases.length === 1 && h.atlases[0] === null && h.s.atlas.loaded && h.s.atlas.req === 0,
    `released=${released} posted=${posted} stale=${staleIgnored} n=${h.atlases.length}`);
}
{
  // a ground window requested before a layout commit is never applied after it
  const h = sessionHarness();
  h.s.boot({ built: 1, n: 5000, split: [], c: {} });
  h.finish(5000);
  h.groundWin.full = false;
  h.groundWin.reqGen = h.groundWin.gen;
  const id = h.sup.request({ type: 'ground', cx: 0, cz: 0 }, h.groundWin, 0);
  h.s.poll({ built: 2, n: 5100, split: [], c: {} });
  h.finish(5100);
  const n0 = h.grounds.length;
  // bypass the req reset done at commit: only the layout generation may stop this reply
  h.groundWin.req = id;
  h.s.onWorker({ data: { type: 'ground', id, ground: { size: 7, ox: 0, oz: 0, cx: 0, cz: 0, full: false } } });
  check('session: a stale ground window (asked before a commit) is ignored', h.grounds.length === n0 && h.app.L.n === 5100, `applied=${h.grounds.length - n0}`);
  // a window asked after the commit does land
  h.groundWin.reqGen = h.groundWin.gen;
  const id2 = h.sup.request({ type: 'ground', cx: 0, cz: 0 }, h.groundWin, 0);
  h.s.onWorker({ data: { type: 'ground', id: id2, ground: { size: 7, ox: 0, oz: 0, cx: 0, cz: 0, full: false } } });
  check('session: a current ground window lands', h.grounds.length === n0 + 1);
}
{
  // a fatal build error keeps the old manifest and layout; the next poll retries the same manifest
  const h = sessionHarness();
  h.s.boot({ built: 1, n: 5000, split: [], c: {} });
  h.finish(5000);
  const L1 = h.app.L;
  h.s.poll({ built: 2, n: 5100, split: [], c: {} });
  const b = h.sup.build.id;
  h.s.onWorker({ data: { type: 'error', fatal: true, build: b, message: 'out of memory' } });
  const kept = h.app.L === L1 && h.data.manifest.built === 1 && !h.sup.build;
  const retried = h.s.poll({ built: 2, n: 5100, split: [], c: {} });
  check('session: a fatal build keeps the old manifest and layout, the next poll retries', kept && retried, `kept=${kept} retried=${retried}`);
}
{
  // a layout whose ground texture is too large for the GPU is rejected and never retried
  const h = sessionHarness({ maxTex: 100 });
  h.s.boot({ built: 1, n: 5000, split: [], c: {} });
  h.finish(5000);
  const L1 = h.app.L;
  h.s.poll({ built: 3, n: 5100, split: [], c: {} });
  h.finish(5100, 400);
  const again = h.s.poll({ built: 3, n: 5100, split: [], c: {} });
  check('session: an oversize layout is rejected and not retried', h.app.L === L1 && h.data.manifest.built === 1 && !again, `again=${again}`);
}
{
  // a live update commits: manifest, name epoch, tag candidates, and flushes only what changed
  const h = sessionHarness();
  h.s.boot({ built: 1, n: 5000, split: [], c: { a: 1, b: 1, d: 1 } });
  h.finish(5000);
  h.tagState.cand.push({ key: 5, name: 'x', pending: 5 });
  const ep = h.tagState.epoch;
  h.s.poll({ built: 2, n: 5100, split: [], c: { a: 1, b: 2, c: 1 } });
  h.finish(5100);
  const f = h.flushed[0];
  const cand = h.tagState.cand[h.tagState.cand.length - 1];
  check('session: an update commits the manifest and name caches, resets tag candidates', h.data.manifest.built === 2 && h.tagState.epoch === ep + 1 && cand.key === -1 && cand.name === null && cand.pending === -1 && h.view.cleared === 1);
  check('session: an update flushes only the changed custom regions (+ the outer ring)', f && f.old.n === 5000 && JSON.stringify(f.changed) === '["b","c","d"]', JSON.stringify(f && f.changed));
}
{
  // streaming.flushChanged marks only the outer ring and the changed regions stale
  const h = harness();
  h.cycle(200);
  const ring = Math.max(0, Math.floor(Math.sqrt(L.maxD2)) - 1);
  const c0 = [...h.st.chunks.values()][0];
  const rk = T.regionKey(T.regionOf(c0.cx * T.CHUNK), T.regionOf(c0.cz * T.CHUNK));   // a region with loaded chunks
  h.st.flushChanged(L, new Set([rk]));
  let wrong = 0, marked = 0;
  for (const c of h.st.chunks.values()) {
    const bx = c.cx * T.CHUNK, bz = c.cz * T.CHUNK;
    const should = Math.max(Math.abs(bx + 2), Math.abs(bz + 2)) + 3 >= ring || T.regionKey(T.regionOf(bx), T.regionOf(bz)) === rk;
    if (!!c.stale !== should) wrong++;
    if (c.stale) marked++;
  }
  check('streaming: flushChanged re-requests only the outer ring and changed regions', wrong === 0 && marked > 0 && marked < h.st.chunks.size, `marked=${marked}/${h.st.chunks.size} wrong=${wrong}`);
}

// ---------------- tags ----------------
{
  const app = { L };
  const view = createView(app);
  const st = createTagState();
  const cam = { ...HOME };
  const names = (bx, bz, s) => Promise.resolve(`f${bx}_${bz}_${s}_xx`);
  scanTags(st, 1000, cam, L, false, view, names);
  await settle();
  const W = 412, H = 839;
  const fwd = [Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch)];
  const VP = mul(persp(Math.PI / 3, W / H, 0.72, 40000), lookDir([cam.x, cam.y, cam.z], fwd));
  const ui = { top: 70, toolsX: 300, toolsY: 760 };
  let ids = 0;
  const measure = (n) => ({ cw: n.length * 7 + 18, ch: 26, id: ++ids });
  placeTags(st, VP, W, H, ui, undefined, measure);
  const boxes = [];
  for (let i = 0; i < st.used; i++) boxes.push([st.xy[i * 3], st.xy[i * 3 + 1], st.draw[i].cw]);
  let overlap = 0, underUI = 0;
  for (let i = 0; i < boxes.length; i++) {
    const [x, y, w] = boxes[i];
    if (y - 26 < ui.top || (x + w / 2 > ui.toolsX && y > ui.toolsY)) underUI++;
    for (let j = i + 1; j < boxes.length; j++) if (Math.abs(x - boxes[j][0]) < (w + boxes[j][2]) / 2 - 1 && Math.abs(y - boxes[j][1]) < 19) overlap++;
  }
  check('tags: placed, at most 24, no overlaps, none under the search bar or buttons', st.used > 0 && st.used <= MAX_TAGS && !overlap && !underUI, `used=${st.used} overlaps=${overlap} underUI=${underUI}`);
  const keep = st.keys[1];                             // a home that had a tag: select it
  placeTags(st, VP, W, H, ui, keep, measure);
  check('tags: with a home selected only its name shows', st.used === 1 && st.keys[0] === keep, `used=${st.used}`);
  const again = scanTags(st, 1100, cam, L, false, view, names);
  check('tags: a still camera does not rescan', again === false);
}

// ---------------- view: arrival camera and flights ----------------
{
  const app = { L };
  const view = createView(app);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  let inside = 0, through = 0, offEnd = 0, zones = [0, 0, 0, 0];
  for (let i = 0; i < 300; i++) {
    const p = Math.floor(rnd() * L.n);
    const v = view.lookAtYaw(view.homeView(p, 412 / 839));
    zones[v.zone]++;
    if (v.y <= view.heightAt(v.x, v.z)) inside++;
    const cam = { ...HOME };
    let fly = view.planFly(cam, v, 0, false);
    const dur = fly.dur;
    for (let t = 16; t <= dur + 16 && fly; t += 16) {
      fly = view.stepFly(fly, cam, t);
      if (fly && cam.y <= view.heightAt(cam.x, cam.z)) { through++; break; }   // inside a building
    }
    if (fly || Math.abs(cam.x - v.x) > 1e-6 || Math.abs(cam.y - v.y) > 1e-6 || Math.abs(cam.z - v.z) > 1e-6) offEnd++;
  }
  check('view: 300 arrivals across zones never start inside a building', inside === 0, `inside=${inside} zones=${zones}`);
  // round Q: hard framing for low-zone homes, portrait and landscape
  for (const [asp, safe] of [[412 / 839, { top: 0.80, bottom: -0.55, side: 0.88 }], [915 / 412, { top: 0.70, bottom: -0.45, side: 0.88 }]]) {
    app.safe = safe;
    let framed = 0, n = 0, sd = 7;
    const r2 = () => ((sd = (sd * 1103515245 + 12345) >>> 0) / 4294967296);
    let tall = 0, centred = 0, facade = 0;
    while (n < 50) {
      const p = Math.floor(r2() * L.n); const b = T.plotOf(L, p); if (T.zoneLevel(b.bx, b.bz) >= 2) continue; n++;
      const v = view.homeView(p, asp);
      if (v.framed) framed++; else if (process.env.DBG) console.log("unframed", asp.toFixed(2), b.bx, b.bz, b.slot);
      if (v.comp) { if (v.comp.hgt >= 0.3) tall++; if (Math.abs(v.comp.fc) <= 0.15) centred++; if (v.comp.front >= v.comp.roof) facade++; }
    }
    // composition (round R): ranked, not gated, so the floors are below 50
    check(`view: arrival composition, aspect ${asp.toFixed(2)}: the facade outweighs the roof in >= 40/50, centred (|x| <= 15 %) in >= 40/50`, facade >= 40 && centred >= 40, `facade ${facade}/50, centred ${centred}/50, height >= 30 % of the band ${tall}/50`);
    check(`view: 50 low-zone arrivals framed (box in the safe area, 45-68% / 15-40% wide, door visible, pin below the bar), aspect ${asp.toFixed(2)}`, framed === 50, `${framed}/50`);
  }
  delete app.safe;
  check('view: every flight clears the buildings under it', through === 0, `through=${through}`);
  check('view: every flight ends exactly on the arrival view', offEnd === 0, `off=${offEnd}`);
  check('view: plotKey is unique per plot', plotKey(1, 2, 3) !== plotKey(1, 3, 2) && plotKey(-1, 0, 0) !== plotKey(0, -1, 0));
}

console.log(fails ? `${fails} check(s) FAILED` : `all app checks passed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exitCode = fails ? 1 : 0;
