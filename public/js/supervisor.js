// Worker supervisor: the pool of mesh workers, their requests, and the layout build. Pure state machine:
// the clock, timers and worker creation are injected, so tools/selftest.mjs drives it with fake workers.
//
//   spawn(sup) -> worker  must return an object with postMessage(msg, transfer?) and terminate(); the caller
//                         wires the real worker's messages to sup.reply()/onLayout and its errors to sup.died().
//   now() -> ms, later(fn, ms) -> handle, notice(text) for the user.
//
// Rules:
//  - A worker that dies (or hangs: a request older than STALE ms) is terminated and its requests released,
//    so their targets are asked for again. Deaths never count as mesh failures.
//  - More than MAX_DEATHS deaths within a minute: no more replacements for BACKOFF ms (running on the
//    survivors, or on none: requests just wait), one notice, then the pool is refilled to `size`.
//  - A layout build is tracked on its own (id, worker, clock). A reply from an older build is ignored;
//    only the builder's death or hang re-posts the build; with no worker it waits for the refill.
//  - Before the first layout is committed a dead worker is fatal (onFatal).
const STALE = 20000, BUILD_STALE = 30000, BACKOFF = 30000;
export const MAX_DEATHS = 6;

export class Supervisor {
  constructor({ size, spawn, now, later, notice = () => {}, onFatal = () => {} }) {
    Object.assign(this, { size, spawnFn: spawn, now, later, notice, onFatal });
    this.workers = [];
    this.reqs = new Map();
    this.deaths = [];
    this.backoff = null;
    this.build = null;
    this.buildSeq = 0;
    this.nextId = 1;
    this.layout = null;            // the committed layout (sent to every new worker)
  }
  start() { while (this.workers.length < this.size) this.spawn(); return this; }
  spawn() {
    const w = this.spawnFn(this);
    w.load = 0;
    this.workers.push(w);
    if (this.layout) w.postMessage({ type: 'init', layout: this.layout });
    return w;
  }
  // ---- requests ----
  request(msg, target, lod) {
    if (!this.workers.length) return 0;            // backing off: the target is asked again later
    let w = this.workers[0];
    for (const x of this.workers) if (x.load < w.load) w = x;
    const id = this.nextId++;
    msg.id = id;
    w.load++;
    this.reqs.set(id, { w, target, lod, t0: this.now() });
    target.req = id;
    w.postMessage(msg);
    return id;
  }
  // a mesh or error reply: returns the request (or undefined if it was released)
  reply(id) {
    const r = this.reqs.get(id);
    if (!r) return undefined;
    this.reqs.delete(id);
    r.w.load--;
    return r;
  }
  // ---- layout build ----
  startBuild(n, order) {
    this.build = { id: ++this.buildSeq, n, order, w: null, t0: 0 };
    this.postBuild();
    return this.build.id;
  }
  postBuild() {
    const b = this.build;
    b.w = this.workers[0] || null;
    b.t0 = this.now();
    if (b.w) b.w.postMessage({ type: 'init', n: b.n, order: b.order ? b.order.slice(0) : null, build: b.id });   // copied: a re-post needs it
  }
  // true when `id` is the current build (it is then finished); stale replies return false
  finishBuild(id) {
    if (!this.build || this.build.id !== id) return false;
    this.build = null;
    return true;
  }
  commit(layout) {
    this.layout = layout;
    for (const w of this.workers) w.postMessage({ type: 'init', layout });   // the builder too: it built into a local
  }
  // ---- failure ----
  died(w, why) {
    const i = this.workers.indexOf(w);
    if (i < 0) return;                             // already gone
    if (!this.layout) { this.onFatal('Worker: ' + why); return; }
    try { w.terminate(); } catch { /* already gone */ }
    for (const [id, r] of this.reqs) if (r.w === w) { this.reqs.delete(id); if (r.target.req === id) r.target.req = 0; }
    const t = this.now();
    this.deaths = this.deaths.filter((d) => t - d < 60000);
    this.deaths.push(t);
    this.workers.splice(i, 1);
    if (this.backoff) { /* pausing: the refill brings the pool back */ }
    else if (this.deaths.length <= MAX_DEATHS) this.spawn();
    else {
      this.backoff = this.later(() => {
        this.backoff = null; this.deaths = [];
        while (this.workers.length < this.size) this.spawn();
        if (this.build && !this.build.w) this.postBuild();
      }, BACKOFF);
      this.notice(this.workers.length ? 'A background worker keeps failing; running with fewer for 30 s.' : 'The background worker keeps failing; retrying in 30 s.');
    }
    if (this.build && this.build.w === w) this.postBuild();
  }
  // hung workers count as dead; call regularly (not while the page is hidden)
  sweep() {
    const t = this.now();
    if (this.build && this.build.w && t - this.build.t0 > BUILD_STALE) { this.died(this.build.w, 'layout build: no reply in 30 s'); return; }
    for (const r of this.reqs.values()) if (t - r.t0 > STALE) { this.died(r.w, 'no reply in 20 s'); return; }
  }
  // after the page was hidden: nothing is stale just because the tab slept
  resetClocks() {
    const t = this.now();
    for (const r of this.reqs.values()) r.t0 = t;
    if (this.build) this.build.t0 = t;
  }
}
