// Drawing one frame: time of day, camera matrices, chunk / skyline / mid-band / pin draws, the full-screen
// sky and ground (half resolution on the low preset), planar shadows, and the perf probe. No DOM.
import { PITCH, CHUNK } from './town.js';
import { MB, M, SKY, MID } from './mb.js';
import { hyp2, hyp3, vfovFor, persp, lookDir, mul, invert, planes, inFrustum } from './gfx.js';

// keys: 0 noon, 1 sunset, 2 blue hour, 3 night, 4 dawn (cycle of 5)
const KEYS = [
  // noon: crisp and saturated, a clear blue sky, little haze
  { top: [0.1, 0.36, 0.86], hor: [0.58, 0.77, 0.97], sun: [1.36, 1.2, 0.98], sky: [0.26, 0.33, 0.47], gnd: [0.40, 0.34, 0.27], fog: [0.62, 0.76, 0.95], el: 0.62, night: 0 },
  // sunset: a low burning sun (west faces orange), violet shadow side, a hot horizon, first windows and signs on
  { top: [0.16, 0.2, 0.52], hor: [1.0, 0.52, 0.3], sun: [1.55, 0.78, 0.36], sky: [0.34, 0.34, 0.6], gnd: [0.32, 0.25, 0.26], fog: [0.92, 0.58, 0.48], el: 0.085, night: 0.36 },
  // blue hour (the default opening look): violet sky, a magenta glow on the horizon, lights on, the sun just set
  { top: [0.05, 0.09, 0.3], hor: [0.78, 0.42, 0.55], sun: [0.36, 0.28, 0.38], sky: [0.34, 0.32, 0.43], gnd: [0.24, 0.19, 0.2], fog: [0.36, 0.3, 0.5], el: 0.05, night: 0.78 },
  { top: [0.015, 0.025, 0.08], hor: [0.06, 0.08, 0.18], sun: [0.22, 0.28, 0.42], sky: [0.26, 0.31, 0.5], gnd: [0.12, 0.12, 0.16], fog: [0.06, 0.08, 0.16], el: 0.9, night: 1 },
  // dawn: peach horizon under a clear pale blue, soft cool light, a few windows still lit
  { top: [0.22, 0.4, 0.8], hor: [1.0, 0.72, 0.58], sun: [1.15, 0.82, 0.6], sky: [0.4, 0.46, 0.68], gnd: [0.38, 0.32, 0.3], fog: [0.86, 0.76, 0.78], el: 0.14, night: 0.22 },
];
// Writes into one preallocated object (the frame loop allocates nothing).
const TOD_KEYS = ['top', 'hor', 'sun', 'sky', 'gnd', 'fog'];
const TOD = { top: new Float32Array(3), hor: new Float32Array(3), sun: new Float32Array(3), sky: new Float32Array(3), gnd: new Float32Array(3), fog: new Float32Array(3), dir: new Float32Array(3), night: 0 };
function todState(t) {
  t = ((t % 5) + 5) % 5;
  const i = Math.floor(t), f = t - i, a = KEYS[i], b = KEYS[(i + 1) % 5];
  const s = f * f * (3 - 2 * f);
  for (let j = 0; j < 6; j++) {
    const k = TOD_KEYS[j], x = a[k], y = b[k], o = TOD[k];
    o[0] = x[0] + (y[0] - x[0]) * s; o[1] = x[1] + (y[1] - x[1]) * s; o[2] = x[2] + (y[2] - x[2]) * s;
  }
  TOD.night = a.night + (b.night - a.night) * s;
  const el = a.el + (b.el - a.el) * s;
  const az = 2.20 + t * 0.72;     // ART.md LOCKED (round J): day sun from the south-west, ~45° to the lanes. From the opening
  // camera (looking north) street fronts take raking light, west walls are lit, east walls in shade, shadows fall east across the lanes
  TOD.dir[0] = Math.cos(el) * Math.cos(az); TOD.dir[1] = Math.sin(el); TOD.dir[2] = Math.cos(el) * Math.sin(az);
  return TOD;
}

// Low preset: cast shadows from the nearest chunks only (the opening view's homes are grounded; casters beyond
// this are painted by the ground shader, which fades its own shadows in where these fade out).
const LOW_SHADOW = 95;

function sortByDist(arr) {   // insertion sort: allocation-free, fast on nearly sorted lists
  for (let i = 1; i < arr.length; i++) { const v = arr[i]; let j = i - 1; while (j >= 0 && arr[j].d > v.d) { arr[j + 1] = arr[j]; j--; } arr[j + 1] = v; }
}

// deps: gl, gfx, P (shadow/full/copy programs), geoProg(name), app (cam, L, pin, tod, bootMs), streamer,
// quality, isLow, radii, hasStencil, atlasTex, canvas, groundWin, fullres, frozenT, t0
export function createRenderer(d) {
  const { gl, gfx, P, geoProg, app, streamer, quality, isLow, radii, hasStencil, canvas } = d;
  const { chunks, skies, mids } = streamer;
  const stats = { tris: 0, draws: 0, sky: 0, chunks: 0, mb: 0, fps: 0, ms: 0 };
  const fullVao = gl.createVertexArray();
  const ORDER = [], DRAWN = [], SKYORD = [], NONE = [], MIDORD = [];
  const pushOrder = (c) => { if (c.g) ORDER.push(c); }, pushSky = (s) => { if (s.g) SKYORD.push(s); }, pushMid = (s) => { if (s.g) MIDORD.push(s); };
  const FWD = new Float64Array(3), EYE = new Float64Array(3), SHD = new Float32Array(3);
  let pinMesh = null, ringMesh = null;
  let groundTex = null, groundExt = 0, groundBytes = 0;
  // The ground data texture is a window of at most 641^2 blocks (1.6 MB) (layout.js buildGround): the whole town when it
  // fits, otherwise centred near the camera and replaced by a worker-built window when the camera has moved
  // more than 96 blocks from its centre (streaming.js asks for it). Same size at 1M and 10M followers.
  const groundWin = d.groundWin;                     // shared with streaming.js, which asks for new windows
  let halfRT = null, halfActive = false, halfBroken = false;
  const r = { stats, VP: null, invVP: null, PL: null, PROBE: null, groundWin };

  function render(now) {
    const cam = app.cam;
    const PROBE = r.PROBE;
    const time = d.frozenT ?? (now - d.t0) / 1000;
    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    const T = todState(app.tod);
    const fwd = FWD;
    fwd[0] = Math.sin(cam.yaw) * Math.cos(cam.pitch); fwd[1] = Math.sin(cam.pitch); fwd[2] = -Math.cos(cam.yaw) * Math.cos(cam.pitch);
    EYE[0] = cam.x; EYE[1] = cam.y; EYE[2] = cam.z;
    const near = Math.min(20, Math.max(0.4, cam.y * 0.02));
    const proj = persp(vfovFor(W / H), W / H, near, 40000);
    const VP = r.VP = mul(proj, lookDir(EYE, fwd));
    r.invVP = invert(VP);
    const PL = r.PL = planes(VP);
    const { r1 } = radii();
    const fogD = Math.max(4800, 6000 + cam.y * 5) * (0.75 + 0.25 * quality.s);

    const half = isLow() && !halfBroken && !d.fullres && PROBE !== 'geo' ? halfGround(W, H, T, time, fogD, r1) : null;
    gl.viewport(0, 0, W, H);
    gl.clearColor(T.fog[0], T.fog[1], T.fog[2], 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);

    let tris = 0, draws = 0, sky = 0, bytes = 0; const tier = stats.tier || (stats.tier = {});
    const geo = geoProg(isLow() ? 'geoLow' : 'geo');                  // low preset: cheaper material shader
    gl.useProgram(geo.p);
    setCommonU(geo.u, T, time, fogD);
    gl.uniformMatrix4fv(geo.u.uVP, false, VP);
    const fadeA = r1 * 0.72, fadeB = d.nosink ? fadeA + 0.01 : r1 * 0.96,   // ?nosink: no tier sink (poptest's planted pop)
      shadowR = isLow() ? LOW_SHADOW : 650 * quality.s;
    gl.uniform4f(geo.u.uLod, fadeA, fadeB, 0, 0);
    const R = CHUNK * PITCH * 0.75;
    const drawn = DRAWN;
    drawn.length = 0;
    ORDER.length = 0;                                   // front to back: less overdraw (reused arrays)
    chunks.forEach(pushOrder);                         // forEach with a fixed callback: no iterator objects per frame
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
    tier.chunk = Math.round(tris);
    gl.uniform4f(geo.u.uLod, fadeA, fadeB, 1, 2);    // skyline tiles are stored at 1/32 m
    const RS = SKY * PITCH * 0.75;
    SKYORD.length = 0;
    skies.forEach(pushSky);
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

    tier.sky = Math.round(tris) - tier.chunk;
    // mid-band massing (skyline mode: hidden where chunks still draw homes, growing in as they shrink)
    gl.uniform4f(geo.u.uLod, fadeA, fadeB, 1, 0);
    const RMd = MID * PITCH * 0.75;
    MIDORD.length = 0;
    if (PROBE !== 'full') mids.forEach(pushMid);
    for (const s of MIDORD) {
      bytes += s.g.bytes;
      const ox = (s.rx * MID + MID / 2 - 0.5) * PITCH, oz = (s.rz * MID + MID / 2 - 0.5) * PITCH;
      if (!inFrustum(PL, ox, 8, oz, hyp2(RMd, 10))) continue;
      gl.uniform3f(geo.u.uOrigin, ox, 0, oz);
      gl.bindVertexArray(s.g.vao);
      gl.drawElements(gl.TRIANGLES, s.g.n, s.g.it, s.g.so);
      tris += s.g.n / 3; draws++;
    }

    tier.mid = Math.round(tris) - tier.chunk - tier.sky;
    const pin = app.pin;
    // phone: the pinned home at full detail over its lite copy (hero.js)
    const hero = pin && isLow() && d.hero && PROBE !== 'full' ? d.hero.get(pin, app.L) : null;
    if (hero) {
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -8);
      gl.uniform4f(geo.u.uLod, 1e9, 2e9, 0, 0);
      gl.uniform3f(geo.u.uOrigin, hero.ox, 0, hero.oz);
      gl.bindVertexArray(hero.mesh.vao);
      gl.drawElements(gl.TRIANGLES, hero.mesh.n, hero.mesh.it, hero.mesh.so);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      tris += hero.mesh.n / 3; draws++;
    }
    if (pin && app.L && PROBE !== 'full') {
      if (!ringMesh) {
        // a glowing pink ring on the ground around the follower's home: the home is singled out, not only the pin
        const mb = new MB(0, 0, 256);
        for (let i = 0; i < 20; i++) {
          const a0 = i / 20 * Math.PI * 2, a1 = (i + 1) / 20 * Math.PI * 2, R = 8.2, r = 7.75, y = 0.07;
          mb.fq(Math.cos(a0) * R, y, Math.sin(a0) * R, Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r, Math.cos(a1) * R, y, Math.sin(a1) * R, M.LIGHT, 0xff4f7b, 0);
        }
        ringMesh = gfx.upload(mb.finish());
      }
      gl.uniform4f(geo.u.uLod, 1e9, 2e9, 0, 0);
      gl.uniform3f(geo.u.uOrigin, pin.x, 0, pin.z);
      gl.bindVertexArray(ringMesh.vao);
      gl.drawElements(gl.TRIANGLES, ringMesh.n, ringMesh.it, 0);
      draws++;
      if (!pinMesh) {
        const mb = new MB(0, 0, 256);
        mb.cyl(0, 0, 0, 0.01, 5, 1.6, 10, 0xff4f7b, M.LIGHT, 0, false);
        mb.ell(0, 6.6, 0, 2.6, 2.6, 2.6, 10, 4, 0xff4f7b, M.LIGHT, 0);
        mb.ell(0, 6.8, 2.2, 1.1, 1.1, 0.6, 8, 3, 0xffffff, M.LIGHT, 0);
        pinMesh = gfx.upload(mb.finish());
      }
      const dd = hyp3(pin.x - cam.x, pin.y - cam.y, pin.z - cam.z);
      const sc = Math.max(0.4, dd / 110);              // a marker, not a balloon over the home (constant-ish on screen)
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
      gl.uniform3f(sh.u.uShadowCol, 1 - 0.4 * k, 1 - 0.33 * k, 1 - 0.16 * k);   // sky-lit shade: lighter and blue, not a grey slab
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
    tier.rest = Math.round(tris) - tier.chunk - tier.sky - tier.mid;
    gl.depthMask(true);
    gl.bindVertexArray(null);
    stats.tris = Math.round(tris); stats.draws = draws; stats.sky = sky; stats.chunks = chunks.size; stats.mb = Math.round((bytes + groundBytes + (halfRT ? halfRT.w * halfRT.h * 4 : 0)) / 1048576);   // meshes + ground texture + half-res target
  }
  function setCommonU(u, T, time, fogD) {
    const cam = app.cam;
    gl.uniform3fv(u.uSunDir, T.dir); gl.uniform3fv(u.uSunCol, T.sun); gl.uniform3fv(u.uSkyCol, T.sky); gl.uniform3fv(u.uGndCol, T.gnd);
    gl.uniform3fv(u.uFogCol, T.fog); gl.uniform3fv(u.uSkyTop, T.top); gl.uniform3fv(u.uSkyHor, T.hor);
    gl.uniform1f(u.uFogD, fogD); gl.uniform1f(u.uNight, T.night); gl.uniform1f(u.uTime, time);
    gl.uniform3f(u.uCam, cam.x, cam.y, cam.z);
    if (u.uLodCam) { const lc = app.lodCam || cam; gl.uniform3f(u.uLodCam, lc.x, lc.y, lc.z); }   // app.lodCam: poptest only
    if (u.uLowQ) gl.uniform1f(u.uLowQ, isLow() ? 1 : 0);
    if (u.uAtlas) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, d.atlasTex); gl.uniform1i(u.uAtlas, 1); gl.activeTexture(gl.TEXTURE0); }
  }
  function setFull(u, T, time, fogD, r1) {
    const L = app.L;
    setCommonU(u, T, time, fogD);
    gl.uniformMatrix4fv(u.uInvVP, false, r.invVP);
    gl.uniform4f(u.uTown, L ? L.townD2 : 100, groundExt, L ? L.seaX : 1e9, L ? L.seaBx : 1e6);
    gl.uniform2f(u.uGroundO, groundWin.ox, groundWin.oz);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, groundTex); gl.uniform1i(u.uGround, 0);
    const shDir = shadowDir(T);
    gl.uniform4f(u.uFar, r1 * 0.72, r1 * 0.96, !isLow() ? 1 : hasStencil ? -LOW_SHADOW : 0, 5 / shDir[1] * 0.5);   // z < 0: low preset with cast shadows out to -z
    gl.uniform1f(u.uClouds, 1);
    gl.uniform1f(u.uPx, halfActive ? 0.5 : 1);
  }
  // Low quality: run the expensive ground/sky shader at half resolution into a texture
  // (a quarter of the fragments), then upsample it where no geometry was drawn.
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
  function shadowDir(T) {
    const s = SHD;
    if (T.night > 0.5) { s[0] = 0.3; s[1] = 0.9; s[2] = 0.2; } else { s[0] = T.dir[0]; s[1] = T.dir[1]; s[2] = T.dir[2]; }
    if (s[1] < 0.3) { const h = hyp2(s[0], s[2]); const k = Math.sqrt(1 - 0.3 * 0.3) / h; s[0] *= k; s[2] *= k; s[1] = 0.3; }
    return s;
  }
  // the ground data texture (layout.js buildGround); false if this GPU can't hold it (nothing changed then)
  r.setGround = (ground) => {
    if (ground.size > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return false;
    if (!groundTex) groundTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, groundTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, ground.size, ground.size, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, ground.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    groundExt = ground.size; groundBytes = ground.size * ground.size * 4;
    Object.assign(groundWin, { ox: ground.ox, oz: ground.oz, cx: ground.cx, cz: ground.cz, full: ground.full });
    return true;
  };
  r.render = render;
  // Perf probe (?probe or __town.probe()): times the passes with readPixels as a sync on this machine. Only
  // ratios between builds are meaningful (software GL here), never absolute device fps.
  const PIX = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PIX);   // forces the GPU to finish
  r.probe = (n = 8) => {
    const run = (mode) => {
      r.PROBE = mode; render(performance.now()); sync();
      const t = performance.now();
      for (let i = 0; i < n; i++) { render(performance.now()); sync(); }
      r.PROBE = null;
      return +((performance.now() - t) / n).toFixed(2);
    };
    return { allMs: run(null), groundMs: run('full'), geoMs: run('geo'), bootMs: Math.round(app.bootMs), w: canvas.width, h: canvas.height };
  };
  return r;
}
