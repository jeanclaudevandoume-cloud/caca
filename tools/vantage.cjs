// Capture the fixed vantage set into shots/<tag>/ for before/after comparison:
//   timeout 1500 node tools/vantage.cjs <tag> [name ...]
// Needs the server on PORT (default 8080). One browser, one page at a time (SwiftShader is slow).
const { chromium } = require('playwright');
const fs = require('fs');
const V = {
  downtown: ['q=high&t=10&notags&cam=6,24,660,0,-0.03'],
  sunset: ['q=high&t=10&notags&tod=1&cam=6,24,660,0,-0.03'],
  night: ['q=high&t=10&notags&tod=2&cam=6,24,660,0,-0.03'],
  core: ['q=high&t=10&notags&cam=168,5,230,0,0.1'],
  hub: ['q=high&t=10&notags&cam=3000,7,3000,0.9,-0.05'],
  suburb: ['q=high&t=10&notags&cam=2184,7,1260,0,-0.05'],
  drone: ['q=high&t=10&notags&cam=2184,30,1300,0,-0.45'],
  midalt: ['q=high&t=10&notags&cam=-900,450,-900,2.356,-0.45'],
  high: ['q=high&t=10&notags&cam=0,2500,-2500,3.14159,-0.75'],
  port: ['q=high&t=10&notags&cam=1250,140,350,0.5,-0.25'],
  custom: ['q=high&u=maxramen95643&instant&t=10'],
  phone: ['q=low&t=10&notags&cam=2184,7,1260,0,-0.05', 844, 390],
  house: ['q=high&t=10&notags&cam=2200,5,1272,-0.25,-0.1'],
  portrait: ['q=low&t=10&notags&cam=6,24,660,0,-0.07', 390, 844],
  downtownlow: ['q=low&t=10&notags&cam=6,24,660,0,-0.03', 844, 390],
  lowclose: ['q=low&t=10&notags&cam=2200,5,1272,-0.25,-0.1', 844, 390],
  lowdrone: ['q=low&t=10&notags&cam=2184,30,1300,0,-0.45', 844, 390],
  phonefull: ['q=low&t=10&notags&fullres&cam=2184,7,1260,0,-0.05', 844, 390],
  portraitfull: ['q=low&t=10&notags&fullres&cam=6,24,660,0,-0.07', 390, 844],
};
(async () => {
  const [tag = 'cur', ...only] = process.argv.slice(2);
  const names = only.length ? only : Object.keys(V);
  fs.mkdirSync(`shots/${tag}`, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const probeAll = process.env.PROBE === '1';   // default: probe only the low-preset vantages (high ones are very slow here)
  const perf = {};
  const out = {};
  const save = () => {
    let prev = {}, pp = {};
    try { prev = JSON.parse(fs.readFileSync(`shots/${tag}/stats.json`, 'utf8')); } catch { /* first run */ }
    try { pp = JSON.parse(fs.readFileSync(`shots/${tag}/perf.json`, 'utf8')); } catch { /* first run */ }
    fs.writeFileSync(`shots/${tag}/stats.json`, JSON.stringify({ ...prev, ...out }, null, 1));
    if (Object.keys(perf).length) fs.writeFileSync(`shots/${tag}/perf.json`, JSON.stringify({ ...pp, ...perf }, null, 1));
  };
  for (const n of names) {
    const [q, w = 1100, h = 620] = V[n];
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', (e) => console.log(n, 'pageerror:', e.message.slice(0, 300)));
    let bytes = 0;
    p.on('response', async (r) => { try { const h = await r.allHeaders(); bytes += +(h['content-length'] || 0); } catch { /* ignore */ } });
    await p.goto(`http://localhost:${process.env.PORT || 8080}/?shot&${q}`);
    try {
      await p.waitForFunction(() => { const t = window.__town; if (!t || !t.ready || !t.idle()) { window.__s = 0; return false; } return ++window.__s >= 4; }, null, { timeout: 110000, polling: 400 });
    } catch { console.log(n, 'timeout'); }
    await p.waitForTimeout(800);
    await p.screenshot({ path: `shots/${tag}/${n}.png` });
    out[n] = await p.evaluate(() => { const s = window.__town.stats; return { tris: s.tris, draws: s.draws, sky: s.sky, mb: s.mb }; });
    if (probeAll || q.includes('q=low')) {
      // pass timings (relative, this machine) + allocated bytes per frame from Chrome's sampling heap profiler
      const t = await p.evaluate(() => window.__town.probe(6));
      const cdp = await p.context().newCDPSession(p);
      await p.evaluate(() => window.__town.spin(600));          // warm up: let the JIT optimise the frame loop
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      await p.evaluate(() => window.__town.spin(20));
      const prof = await cdp.send('HeapProfiler.stopSampling');
      let alloc = 0;
      const walk = (nd) => { alloc += nd.selfSize; (nd.children || []).forEach(walk); };
      walk(prof.profile.head);
      if (process.env.TOP) {
        const by = {};
        const w2 = (nd) => { const k = nd.callFrame.functionName + ':' + nd.callFrame.lineNumber; by[k] = (by[k] || 0) + nd.selfSize; (nd.children || []).forEach(w2); };
        w2(prof.profile.head);
        console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + ' ' + Math.round(v / 20) + 'B/f').join('\n'));
      }
      perf[n] = { ...t, kbPerFrame: +(alloc / 20 / 1024).toFixed(1), downloadKB: Math.round(bytes / 1024) };
      console.log(n, 'perf', JSON.stringify(perf[n]));
    }
    console.log(n, JSON.stringify(out[n]));
    save();
    await p.close();
  }
  await b.close();
})();
