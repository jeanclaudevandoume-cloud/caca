// Flythrough pop metric (round Q, optimization review): fly a fixed path at drone height on the high preset and
// measure how much of the screen changes abruptly while the camera is NOT moving.
//   node tools/poptest.cjs [steps=90] [extra query]   Q=low for the phone preset   (server on PORT, default 8080; DUMP=1 saves pairs)
// Per step the camera moves 7 m (4 frames at 60 fps ~ 110 m/s, a fast drone pass) and one frame is drawn: A.
// The workers answer, then four more frames are drawn at the same pose (__town.sim, a virtual 60 fps clock, so
// SwiftShader's real speed does not matter): B. Animation is frozen (?shot&t=), so A -> B differs only where
// meshes were swapped in. A 16 px tile whose
// mean change exceeds 3 levels is 'popped'; the report is the popped screen share per step (mean, p95, max),
// the steps with > 0.5 % popped, and the abruptness: peak =
// the largest single-tile change in one step (levels; > 20 reads as a pop), its max and how many steps exceed 20.
const { chromium } = require('playwright');
const zlib = require('zlib');
const fs = require('fs');

function decodePNG(buf) {               // 8-bit RGB/RGBA, non-interlaced (what Chrome writes)
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    else if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h * 3), stride = w * bpp;
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = cur[x * bpp + k];
    [prev, cur] = [cur, prev];
  }
  return { w, h, d: out };
}

function popped(A, B) {
  const T = 16, tw = Math.floor(A.w / T), th = Math.floor(A.h / T);
  let n = 0, peak = 0;
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    let s = 0;
    for (let y = ty * T; y < ty * T + T; y++) for (let x = tx * T; x < tx * T + T; x++) {
      const i = (y * A.w + x) * 3;
      s += Math.abs(A.d[i] - B.d[i]) + Math.abs(A.d[i + 1] - B.d[i + 1]) + Math.abs(A.d[i + 2] - B.d[i + 2]);
    }
    const m = s / (T * T * 3);
    if (m > 3) n++;
    if (m > peak) peak = m;
  }
  return { share: n / (tw * th), peak };
}

(async () => {
  const steps = +(process.argv[2] || 90), extra = process.argv[3] ? '&' + process.argv[3] : '';
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('pageerror', (e) => { console.log('pageerror', e.message); process.exitCode = 1; });
  // start over the suburbs, fly north-west towards downtown at 40 m, looking ahead and down
  const x0 = 2184, z0 = 1500, dx = -3.7, dz = -5.9;
  await p.goto(`http://localhost:${process.env.PORT || 8080}/?shot&q=${process.env.Q || 'high'}&t=10&notags${extra}&cam=${x0},40,${z0},-0.56,-0.22`);
  await p.waitForFunction(() => { const t = window.__town; if (!t || !t.ready || !t.idle()) { window.__s = 0; return false; } return ++window.__s >= 4; }, null, { timeout: 150000, polling: 400 });
  const pops = [], peaks = [];
  for (let i = 0; i < steps; i++) {
    await p.evaluate(([x, z]) => { const c = window.__town.cam; c.x = x; c.z = z; window.__town.sim(1); }, [x0 + dx * i, z0 + dz * i]);
    const pngA = await p.screenshot();
    await p.waitForTimeout(150);                       // the workers answer in real time ...
    await p.evaluate(() => window.__town.sim(4));      // ... then four simulated 60 fps frames at the same pose
    const pngB = await p.screenshot();
    const pp = popped(decodePNG(pngA), decodePNG(pngB));
    pops.push(pp.share); peaks.push(pp.peak);
    if (process.env.DUMP && pp.share > 0.005) { fs.mkdirSync('shots/pop', { recursive: true }); fs.writeFileSync(`shots/pop/${i}a.png`, pngA); fs.writeFileSync(`shots/pop/${i}b.png`, pngB); }
  }
  await b.close();
  const s = [...pops].sort((a, c) => a - c), pc = (v) => +(v * 100).toFixed(2);
  const res = { steps, mean: pc(pops.reduce((a, c) => a + c, 0) / pops.length), p95: pc(s[Math.floor(s.length * 0.95)]), max: pc(s[s.length - 1]), framesOver05: pops.filter((v) => v > 0.005).length, peakMax: +Math.max(...peaks).toFixed(1), peakOver20: peaks.filter((v) => v > 20).length, preset: process.env.Q || 'high', extra };
  console.log(JSON.stringify(res));
  fs.mkdirSync('shots', { recursive: true });
  fs.appendFileSync('shots/poptest.jsonl', JSON.stringify({ at: new Date().toISOString(), ...res }) + '\n');
})();
