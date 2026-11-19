// Fake followers for testing: node tools/demo-data.mjs data/demo 1000000
import fs from 'node:fs';
import path from 'node:path';
import { SHAPES, GARDEN } from '../public/js/town.js';

const dir = process.argv[2] || 'data/demo';
const N = +(process.argv[3] || 1000000);
fs.mkdirSync(dir, { recursive: true });

let s = 0x1234567;
const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const A = ['luna', 'max', 'mia', 'kai', 'noa', 'leo', 'zoe', 'yuki', 'min', 'jun', 'sora', 'aria', 'theo', 'ivy', 'nova', 'eli', 'ruby', 'finn', 'hana', 'ray', 'ji', 'seo', 'tae', 'ren', 'mila', 'omar', 'sam', 'lily', 'ari', 'jade', 'kenji', 'amir', 'nia', 'eva', 'ezra', 'chloe', 'dami', 'yuna', 'hugo', 'lea'];
const B = ['cat', 'wolf', 'sky', 'pop', 'bean', 'star', 'moon', 'fox', 'dance', 'vibes', 'art', 'chef', 'gamer', 'plays', 'films', 'fit', 'travels', 'bakes', 'loves', 'beats', 'mochi', 'boba', 'ramen', 'kimchi', 'sushi', 'pixel', 'dream', 'glow', 'wave', 'bloom'];
const SEP = ['', '_', '.', ''];
const seen = new Set();
const names = [];
const forced = new Map([[40, 'lunacat'], [250000, 'max_wolf']]);
for (const n of forced.values()) seen.add(n);
for (let i = 0; i < N; i++) {
  if (forced.has(i)) { names.push(forced.get(i)); continue; }
  let n;
  do {
    n = pick(A) + pick(SEP) + pick(B);
    const r = rnd();
    if (r < 0.65) n += Math.floor(rnd() * (r < 0.3 ? 100 : 100000));
    else if (r < 0.75) n = pick(SEP.slice(1, 3)) + n;
  } while (seen.has(n));
  seen.add(n);
  // ~0.5% left: blank lines keep everyone else's plot fixed
  names.push(rnd() < 0.005 && i > 100 ? '' : n);
}
fs.writeFileSync(path.join(dir, 'followers.txt'), names.join('\n') + '\n');

const COLORS = ['#ff4f7b', '#1fb5ad', '#ffb627', '#6c63ff', '#2ec27e', '#ff8fb1', '#e94f37', '#3d5a98', '#f6e27f', '#9b5de5'];
const custom = {};
custom.lunacat = { shape: 'mushroom', color: '#ff4f7b', garden: ['flowers', 'pond'] };
custom.max_wolf = { shape: 'castle', color: '#9aa7c7', garden: ['statue', 'tree'] };
for (let i = 0; i < N; i++) {
  if (!names[i] || rnd() > 0.03 || custom[names[i]]) continue;
  const g = [];
  const ng = Math.floor(rnd() * 3);
  for (let k = 0; k < ng; k++) g.push(pick(GARDEN));
  custom[names[i]] = { shape: pick(SHAPES), color: pick(COLORS), garden: g };
}
fs.writeFileSync(path.join(dir, 'custom.json'), JSON.stringify(custom));
console.log(`${N} followers, ${Object.keys(custom).length} custom homes -> ${dir}`);
