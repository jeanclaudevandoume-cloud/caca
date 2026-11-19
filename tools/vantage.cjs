// Capture the fixed vantage set into shots/<tag>/ for before/after comparison:
//   timeout 1500 node tools/vantage.cjs <tag> [name ...]
// Needs the server on PORT (default 8080). One browser, one page at a time (SwiftShader is slow).
const { chromium } = require('playwright');
const fs = require('fs');
const V = {
  downtown: ['q=high&t=10&notags'],
  sunset: ['q=high&t=10&notags&tod=1'],
  night: ['q=high&t=10&notags&tod=2'],
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
  portrait: ['q=low&t=10&notags', 390, 844],
  downtownlow: ['q=low&t=10&notags', 844, 390],
};
(async () => {
  const [tag = 'cur', ...only] = process.argv.slice(2);
  const names = only.length ? only : Object.keys(V);
  fs.mkdirSync(`shots/${tag}`, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const out = {};
  for (const n of names) {
    const [q, w = 1100, h = 620] = V[n];
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', (e) => console.log(n, 'pageerror:', e.message.slice(0, 300)));
    await p.goto(`http://localhost:${process.env.PORT || 8080}/?shot&${q}`);
    try {
      await p.waitForFunction(() => { const t = window.__town; if (!t || !t.ready || !t.idle()) { window.__s = 0; return false; } return ++window.__s >= 4; }, null, { timeout: 110000, polling: 400 });
    } catch { console.log(n, 'timeout'); }
    await p.waitForTimeout(800);
    await p.screenshot({ path: `shots/${tag}/${n}.png` });
    out[n] = await p.evaluate(() => { const s = window.__town.stats; return { tris: s.tris, draws: s.draws, sky: s.sky, mb: s.mb }; });
    console.log(n, JSON.stringify(out[n]));
    await p.close();
  }
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(`shots/${tag}/stats.json`, 'utf8')); } catch { /* first run */ }
  fs.writeFileSync(`shots/${tag}/stats.json`, JSON.stringify({ ...prev, ...out }, null, 1));   // merge partial runs
  await b.close();
})();
