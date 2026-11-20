// Phone smoke test of the single-file build: node tools/phonetest.cjs [file]
// Emulates a Pixel 7 (mobile UA, touch, DPR 2.6) in portrait and landscape, opens the file from disk,
// and fails if the town is not ready, any error is logged, or the diagnostics panel shows.
const { chromium, devices } = require('playwright');
const path = require('path');
(async () => {
  const file = 'file://' + path.resolve(process.argv[2] || 'dist/follower-town.html');
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let ok = true;
  for (const [name, vp] of [['portrait', null], ['landscape', { width: 915, height: 412 }]]) {
    const ctx = await b.newContext({ ...devices['Pixel 7'], ...(vp ? { viewport: vp } : {}) });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    const t0 = Date.now();
    await p.goto(file);
    let ready = false;
    try { await p.waitForFunction(() => window.__town && window.__town.ready && window.__town.idle(), null, { timeout: 100000, polling: 500 }); ready = true; } catch { /* report below */ }
    const diag = await p.evaluate(() => { const el = document.getElementById('loading'); return el && !el.classList.contains('gone') ? el.textContent : ''; });
    const st = await p.evaluate(() => window.__town && { ...window.__town.stats, q: window.__town.quality.s });
    await p.screenshot({ path: `shots/phonetest-${name}.png` });
    const pass = ready && !errs.length && !diag;
    ok = ok && pass;
    console.log(`${name}: ${pass ? 'PASS' : 'FAIL'} ready=${ready} ${((Date.now() - t0) / 1000).toFixed(1)}s quality=${st && st.q} tris=${st && st.tris} draws=${st && st.draws}`);
    if (diag) console.log('  diagnostics: ' + diag.slice(0, 400));
    for (const e of errs) console.log('  ' + e.slice(0, 300));
    await ctx.close();
  }
  // Recovery: kill workers repeatedly mid-stream, move 2 km, and lose the GL context. The town must load
  // fully again (no holes: every wanted chunk near the camera has a mesh), and the camera must survive the
  // context-loss reload.
  {
    const ctx = await b.newContext({ ...devices['Pixel 7'] });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    // console errors fail the run, except the ones this test provokes on purpose
    p.on('console', (m) => { if (m.type() === 'error' && !/worker died|killed by test|keeps failing|kept failing|context|WebGL/i.test(m.text())) errs.push('console: ' + m.text()); });
    await p.goto(file + '#u=');
    let pass = true, why = '';
    try {
      await p.waitForFunction(() => window.__town && window.__town.ready && window.__town.idle(), null, { timeout: 100000, polling: 500 });
      for (let k = 0; k < 10; k++) {                  // kills while chunks are in flight (the camera keeps moving)
        await p.evaluate((k) => { const t = window.__town; t.cam.x += 200; t.cam.z -= 120 * (k & 1 ? -1 : 1); t.killWorker(0); }, k);
        await p.waitForTimeout(400);
        const nw = await p.evaluate(() => window.__town.dbg.loads.length);
        if (nw < 1) { await p.waitForTimeout(2500); if ((await p.evaluate(() => window.__town.dbg.loads.length)) < 1) { pass = false; why += ` no worker after kill ${k + 1};`; } }
      }
      await p.waitForFunction(() => window.__town.idle(), null, { timeout: 90000, polling: 500 });
      // after the back-off the pool is refilled
      await p.waitForTimeout(31000);
      const pool = await p.evaluate(() => window.__town.dbg.loads.length);
      if (pool < 2 && (await p.evaluate(() => navigator.hardwareConcurrency)) > 2) { pass = false; why += ` pool not refilled (${pool});`; }
      const holes = await p.evaluate(() => { let n = 0; for (const c of window.__town.chunks.values()) if (c.loaded && !c.g && c.d < 400 && c.want === 0) n++; return n; });
      if (holes) { pass = false; why += ` ${holes} empty chunks near the camera;`; }
      const before = await p.evaluate(() => { const c = window.__town.cam; c.x = 100; c.y = 50; c.z = 500; return [c.x, c.y, c.z]; });
      await p.waitForTimeout(300);
      await p.evaluate(() => { const e = document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); e.loseContext(); });
      await p.waitForTimeout(1500);
      await p.waitForFunction(() => window.__town && window.__town.ready, null, { timeout: 100000, polling: 500 });
      const after = await p.evaluate(() => { const c = window.__town.cam; return [c.x, c.y, c.z]; });
      if (Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) > 1) { pass = false; why += ` camera not restored (${after.map((v) => v.toFixed(0))});`; }
      const diag = await p.evaluate(() => { const el = document.getElementById('loading'); return el && !el.classList.contains('gone') ? el.textContent : ''; });
      if (diag) { pass = false; why += ' diagnostics shown: ' + diag.slice(0, 200); }
      // a second loss within 20 s must explain itself instead of reloading forever
      await p.evaluate(() => document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
      await p.waitForTimeout(1500);
      const diag2 = await p.evaluate(() => { const el = document.getElementById('loading'); return el && !el.classList.contains('gone') ? el.textContent : ''; });
      if (!/lost twice/.test(diag2)) { pass = false; why += ' second context loss showed no message;'; }
    } catch (e) { pass = false; why += ' ' + String(e.message || e).slice(0, 200); }
    if (errs.length) { pass = false; why += ' ' + errs.join('; ').slice(0, 300); }
    ok = ok && pass;
    console.log(`recovery: ${pass ? 'PASS' : 'FAIL'}${why}`);
    await ctx.close();
  }
  await b.close();
  process.exit(ok ? 0 : 1);
})();
