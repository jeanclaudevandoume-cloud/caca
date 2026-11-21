// Session: worker message routing and the layout lifecycle (first build, live updates, commit). No DOM: the
// supervisor, renderer, streamer and data are injected, so tools/apptest.mjs drives it with fakes.
//
//  - The layout is a formula (town.js); the worker builds a few small tables from n. A live update builds
//    against the *staged* manifest; it becomes current only when its layout arrives and is accepted, so a
//    failed build leaves the old manifest and layout consistent.
//  - A rejected layout (its ground texture is larger than the GPU allows) is remembered (badBuilt) and never
//    retried; a fatal worker error during a build is transient (out of memory...): the next poll retries.
//  - The ground data window has a generation: a window requested before a commit was built from the old
//    layout and is dropped when it arrives, even if the request id still matches.
import { finishLayout } from './town.js';

// The ground window is shared with render.js (uploads it) and streaming.js (asks for a new one when the camera
// moves far, recording the generation it asked under); the session owns its lifecycle.
export const createGroundWin = () => ({ ox: 0, oz: 0, cx: 0, cz: 0, full: true, req: 0, gen: 0, reqGen: -1 });

export function createSession({ sup, renderer, streamer, data, app, groundWin, tagState, resetTags, view, onReady = () => {}, onCount = () => {}, fail = () => {} }) {
  const s = { groundWin, tallRegions: new Set(), layoutStage: null, badBuilt: null, ready: false };

  function onWorker(e) {
    const m = e.data;
    if (m.type === 'ground') {                         // a new ground window around the camera
      sup.reply(m.id);
      if (groundWin.req === m.id) {
        groundWin.req = 0;
        if (groundWin.reqGen === groundWin.gen) renderer.setGround(m.ground);   // never a window of an older layout
      }
      return;
    }
    if (m.type === 'layout') { if (sup.finishBuild(m.build)) onLayout(m.layout, m.ground); return; }   // stale builds are ignored
    const r = sup.reply(m.id);
    if (m.type === 'error') {
      console.error(m.message);
      if (m.fatal) {                                   // the layout build failed: the old layout and manifest stay
        sup.finishBuild(m.build);
        s.layoutStage = null;                          // transient: the next poll tries this manifest again
        fail('Worker: ' + m.message);
      }
      streamer.onError(m, r);
      return;
    }
    streamer.onMesh(m, r);
  }

  function onLayout(lt, ground) {
    // validate before touching anything: a rejected layout leaves the current one (and every worker) as it was
    if (!renderer.setGround(ground)) {
      if (s.layoutStage) s.badBuilt = s.layoutStage.manifest.built;
      s.layoutStage = null;
      fail(`This town is too large for this GPU (ground texture ${ground.size}).`);
      return false;
    }
    groundWin.req = 0; groundWin.gen++;                // windows requested before this commit are stale
    const old = app.L;
    app.L = finishLayout(lt);
    sup.commit(lt);                                    // every worker, the builder too (it built into a local)
    s.tallRegions = new Set(app.L.tall);               // regions that can hold skyline buildings
    if (s.layoutStage) {
      // commit the update: new manifest, fresh name caches, tags rescanned; rebuild only what changed:
      // the ring of new homes and regions whose custom file changed
      const oldC = s.layoutStage.oldC;
      data.commit(s.layoutStage.manifest);
      resetTags(tagState); view.clear();
      if (old) {
        const mc = data.manifest.c, changed = new Set();
        for (const k of Object.keys(mc || {})) if (!oldC || oldC[k] !== mc[k]) changed.add(k);
        for (const k of Object.keys(oldC || {})) if (!mc || !mc[k]) changed.add(k);
        streamer.flushChanged(old, changed);
        for (const k of changed) data.dropCustom(k);
      }
    }
    s.layoutStage = null;
    onCount(app.L.n);
    if (!s.ready) { s.ready = true; onReady(); }
    return true;
  }

  function initLayout() {
    const mf = s.layoutStage ? s.layoutStage.manifest : data.manifest;
    sup.startBuild(mf.n, null);
  }
  // first manifest: becomes current at once
  function boot(manifest) { data.commit(manifest); initLayout(); }
  // a polled manifest: start a staged build unless one is running, it is current, or it was rejected
  function poll(m) {
    if (m.built === data.manifest.built || m.built === s.badBuilt || s.layoutStage) return false;
    s.layoutStage = { oldC: data.manifest.c, manifest: m };
    initLayout();
    return true;
  }

  return Object.assign(s, { onWorker, onLayout, initLayout, boot, poll });
}
