// Screenshot helper: timeout 115 node tools/shot.cjs <name> "<query>" [width height]
// Needs the server running on PORT (default 8080). Writes shots/<name>.png and prints window.__town.stats.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [name = 'shot', q = '', w = '1100', h = '620'] = process.argv.slice(2);
  fs.mkdirSync('shots', { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 2000)); });
  p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 3000)));
  const port = process.env.PORT || 8080;
  await p.goto(`http://localhost:${port}/?shot&${q}`);
  try {
    // idle must hold for several polls in a row (streaming queues work every 150 ms)
    await p.waitForFunction(() => {
      const t = window.__town;
      if (!t || !t.ready || !t.idle()) { window.__stable = 0; return false; }
      return ++window.__stable >= 4;
    }, null, { timeout: 95000, polling: 400 });
  } catch (e) { console.log('timeout waiting for idle'); }
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `shots/${name}.png` });
  console.log(JSON.stringify(await p.evaluate(() => window.__town && { ...window.__town.stats, cam: window.__town.cam })));
  await b.close();
})();
