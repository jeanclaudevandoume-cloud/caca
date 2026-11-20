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
  await b.close();
  process.exit(ok ? 0 : 1);
})();
