// Everything on the page around the 3D view: input, search and suggestions, the home card (a bottom sheet on
// phones), toasts, buttons, and the name-tag overlay canvas. The only module besides main.js that touches the
// DOM. a 'latest' ticket (data.js createLatest): only the latest tap / search / manual move may set the card, the pin and the flight.
import { PITCH } from './town.js';
import { plotOf } from './layout.js';
import { createLatest, searchHome } from './data.js';
import { plotKey } from './view.js';

// deps: app (cam, L, pin, fly, tod), view, data, HOME, flyTo(p, instant) -> view, canvas, getInvVP(), hashParams()
export function createUI(deps) {
  const { app, view, data, HOME, canvas } = deps;
  const $ = (s) => document.querySelector(s);
  const cam = app.cam;
  const seq = createLatest();
  const cancelFly = () => { app.fly = null; seq.bump(); };   // a manual move also outranks a pending tap or search

  // ---- toast ----
  let toastTimer = 0;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600); }

  // ---- screen areas tags must keep clear of (refreshed on resize) ----
  const rects = { top: 0, toolsX: 1e9, toolsY: 1e9 };
  function uiRects() {
    const t = $('#top'), b = $('#tools');
    if (t) rects.top = t.getBoundingClientRect().bottom + 6;
    if (b) { const r = b.getBoundingClientRect(); rects.toolsX = r.left - 8; rects.toolsY = r.top - 8; }
  }

  // ---- tag overlay ----
  // Tags are drawn on a 2D overlay canvas at the screen's full pixel ratio from cached name bitmaps (round M):
  // crisp text even when the 3D view renders at 1x, no DOM writes and no per-frame strings.
  const tagC = document.getElementById('tagc'), tagG = tagC.getContext('2d');
  let tagDpr = 1, tagIds = 0, tagState = null;
  function resizeTags() {
    const dpr = Math.min(3, devicePixelRatio || 1), w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (dpr === tagDpr && w === tagC.width && h === tagC.height) return;   // called every frame: only a real change reallocates
    if (dpr !== tagDpr) TAGBMP.clear();                // bitmaps are rendered at the old pixel ratio
    tagDpr = dpr; tagC.width = w; tagC.height = h;
    if (tagState) { tagState.sig = 1; tagState.used = -1; }        // redraw at the next placement
  }
  // a name's pill (white rounded box, shadow, pointer), rendered once at device resolution; LRU of 96
  const TAGBMP = new Map();
  let tagTick = 0;
  resizeTags();
  function measure(name) {
    let b = TAGBMP.get(name);
    if (b) { b.t = ++tagTick; return b; }   // LRU by a use stamp: delete + set on a hit churned the Map's table every frame
    const dpr = tagDpr, font = `600 ${12 * dpr}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    const m = document.createElement('canvas').getContext('2d');
    m.font = font;
    const tw = Math.ceil(m.measureText(name).width / dpr), cw = tw + 16, ch = 26;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil((cw + 6) * dpr); cv.height = Math.ceil((ch + 4) * dpr);
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.shadowColor = 'rgba(0,0,0,0.18)'; g.shadowBlur = 5; g.shadowOffsetY = 2;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.roundRect ? g.roundRect(1, 1, cw, 20, 10) : g.rect(1, 1, cw, 20); g.fill();
    g.shadowColor = 'transparent';
    g.beginPath(); g.moveTo(1 + cw / 2 - 4, 21); g.lineTo(1 + cw / 2 + 4, 21); g.lineTo(1 + cw / 2, 25); g.fill();
    g.fillStyle = '#1d2433'; g.font = font.replace(`${12 * dpr}px`, '12px'); g.textBaseline = 'middle';
    g.fillText(name, 9, 11.5);
    b = { img: cv, cw: cw + 2, ch, id: ++tagIds, t: ++tagTick };
    TAGBMP.set(name, b);
    if (TAGBMP.size > 96) {                       // evict the least recently used (rare: only when a new name is drawn)
      let old = null, ot = Infinity;
      for (const [k, v] of TAGBMP) if (v.t < ot) { ot = v.t; old = k; }
      TAGBMP.delete(old);
    }
    return b;
  }
  function drawTags(st) {
    tagState = st;
    const dpr = tagDpr;
    tagG.clearRect(0, 0, tagC.width, tagC.height);
    for (let i = 0; i < st.used; i++) {
      const b = st.draw[i];
      tagG.globalAlpha = st.xy[i * 3 + 2] / 20;
      tagG.drawImage(b.img, Math.round((st.xy[i * 3] - b.cw / 2) * dpr), Math.round((st.xy[i * 3 + 1] - b.ch) * dpr));
    }
    tagG.globalAlpha = 1;
  }

  // ---- input ----
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
    cam.y = Math.min(6000, Math.max(cam.y, 2, view.heightAt(cam.x, cam.z) + 3));
    if (view.inRail(cam.x, cam.y, cam.z)) cam.y = view.railTop(cam.x, cam.z) + 1.5;   // out of the viaduct's slab (under it is fine)
    const lim = app.L ? (app.L.seaBx + 60) * PITCH : 20000;
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

  // ---- search, card, fly-to ----
  async function flyToName(name, instant) {
    if (!app.L) return false;
    const res = await searchHome(data, seq, name);
    if (res.stale) return false;                      // a later tap or search won
    if (res.error) { toast('Network problem: try again'); return false; }
    if (res.none) { toast(`No home for “${name}” yet`); return false; }
    arrive(res.hit[1], res.hit[0], instant);
    return true;
  }
  // fly to follower p, pin the home, show its card (already there: no "Fly there")
  function arrive(p, name, instant) {
    const v = deps.flyTo(p, instant);
    app.pin = view.pinFor(v);
    v.here = true;
    showCard(name, p, v);
    if (name) history.replaceState(null, '', '#u=' + encodeURIComponent(name));
  }
  const search = $('#search'), sugg = $('#sugg');
  let suggTimer = 0, suggSel = -1, suggSeq = 0;
  search.addEventListener('input', () => {
    clearTimeout(suggTimer);
    suggTimer = setTimeout(async () => {
      const my = ++suggSeq;
      const list = (await data.findName(search.value)) || [];
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
  addEventListener('hashchange', () => { const u = deps.hashParams().get('u'); if (u) flyToName(u); });

  function showCard(name, p, v) {
    const c = $('#card');
    // a Tokyo-style address: ward from the district, chome-ban-go from the block and plot
    const { bx, bz, slot } = plotOf(app.L, p);
    const ward = ['Jutaku', 'Villa', 'Shotengai', 'Tower'][v.zone] + ' ' + (['Kita', 'Minami', 'Higashi', 'Nishi'][(bx > 0) + 2 * (bz > 0)]);
    $('#card-name').textContent = name || 'Unclaimed home';
    $('#card-meta').textContent = `${ward} ${Math.abs(bx) % 9 + 1}-${Math.abs(bz) % 30 + 1}-${slot + 1} · home #${(p + 1).toLocaleString()}`;
    c.hidden = false;
    c.dataset.p = p;
    c.dataset.name = name || '';
    $('#card-go').hidden = !!v.here;
    // neighbours: the two plots either side in follower order
    const nb = $('#card-nb');
    nb.textContent = '';
    for (const q of [p - 1, p + 1]) if (q >= 0 && q < app.L.n) data.nameOf(...Object.values(plotOf(app.L, q)).slice(0, 3)).then((n) => {
      if (c.dataset.p !== String(p) || !n) return;
      const b = document.createElement('button'); b.className = 'nb'; b.textContent = (q < p ? '‹ ' : '') + n + (q > p ? ' ›' : '');
      b.onclick = () => { seq.bump(); arrive(q, n); };
      if (q < p) nb.prepend(b); else nb.appendChild(b);
    });
  }
  // the round buttons sit 12 px above the bottom sheet, whatever its height (neighbour row, long names)
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { const c = $('#card'); document.documentElement.style.setProperty('--sheet-h', (c && !c.hidden ? c.offsetHeight : 0) + 'px'); }).observe($('#card'));
  }
  $('#card-close').onclick = () => { seq.bump(); $('#card').hidden = true; app.pin = null; };
  $('#card-go').onclick = () => { seq.bump(); const p = +$('#card').dataset.p; if (p >= 0) arrive(p, $('#card').dataset.name); };
  $('#card-share').onclick = async () => {
    const n = $('#card').dataset.name, url = location.href.split('#')[0].split('?')[0] + '#u=' + encodeURIComponent(n);
    try { if (navigator.share) await navigator.share({ title: n + ' · Follower Town', url }); else { await navigator.clipboard.writeText(url); toast('Link copied'); } } catch { /* cancelled */ }
  };
  async function onTap(x, y) {
    const invVP = deps.getInvVP();
    if (!app.L || !invVP) return;
    const hit = view.pick(invVP, cam, (x / innerWidth) * 2 - 1, 1 - (y / innerHeight) * 2);
    if (!hit) return;
    const my = seq.take();
    const name = await data.nameOf(hit.bx, hit.bz, hit.slot);
    if (!seq.isCurrent(my)) return;                   // a later tap or search won
    if (name === null) { toast('Network problem: try again'); return; }
    const q = view.plotInfo(hit.bx, hit.bz, hit.slot, hit.zone).q;
    app.pin = { x: (q[0] + q[2]) / 2, y: view.homeTop(hit.bx, hit.bz, hit.slot, hit.zone) + 0.8, z: (q[1] + q[3]) / 2, key: plotKey(hit.bx, hit.bz, hit.slot), q: hit.zone <= 1 ? q : null };
    showCard(name, hit.p, { zone: hit.zone });
  }

  // ---- buttons ----
  const TODS = [2, 0.22, 1, 3];   // evening first (the default), day, sunset, night
  $('#btn-time').onclick = () => { const i = TODS.findIndex((t) => Math.abs(t - app.tod) < 0.3); app.tod = TODS[(i + 1) % TODS.length]; };
  $('#btn-home').onclick = () => { seq.bump(); app.fly = { from: { ...cam }, to: { ...HOME }, dyaw: Math.atan2(Math.sin(HOME.yaw - cam.yaw), Math.cos(HOME.yaw - cam.yaw)), t0: performance.now(), dur: 3000, lift: 300 }; };
  $('#btn-help').onclick = () => { $('#help').hidden = !$('#help').hidden; };
  $('#help').onclick = () => { $('#help').hidden = true; };

  return {
    toast, rects, uiRects, resizeTags, measure, drawTags, updateInput, clampCam, flyToName, cancelFly,
    setCount: (n) => { $('#count').textContent = n.toLocaleString() + ' homes'; },
  };
}
