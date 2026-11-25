// Town data from the server: follower names per region, search shards, custom-home files. No DOM: fetch and
// the timer are injected (tools/apptest.mjs drives this with a fake fetch).
//  - Every cache key carries the data version, so an old download can never overwrite new data.
//  - A 404 is a real "nothing here" and is cached; a network error never is: the next caller retries
//    (round M: one dropped request used to blank a region's names / custom homes until eviction).
//  - Concurrent callers share one in-flight fetch.
import { CHUNK } from './town.js';
import { normName, shardFor } from './names.js';
import { regionKey, regionOf, lineIndex } from './layout.js';

// Map used as a small LRU: newest last, oldest evicted beyond 64 entries.
function capSet(map, k, v) { map.delete(k); map.set(k, v); if (map.size > 64) map.delete(map.keys().next().value); }

export function createTownData({ fetch, base = 'town/', later = (fn, ms) => setTimeout(fn, ms) }) {
  let manifest = null;
  const nameCache = new Map(), shardCache = new Map(), customCache = new Map();

  // custom-home files: fetched once and handed to whichever worker meshes the chunk.
  // undefined = still downloading (the chunk waits), null = none, else the region's specs
  function customFor(cx, cz) {
    const key = regionKey(regionOf(cx * CHUNK), regionOf(cz * CHUNK));
    if (!manifest.c || !manifest.c[key]) return null;
    const ck = key + '@' + manifest.c[key];
    const v = customCache.get(ck);
    if (v === undefined) {
      const pr = fetch(`${base}c/${key}.json?v=${manifest.c[key]}`).then((r) => (r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error(r.status))))
        .then((j) => { if (customCache.get(ck) === pr) customCache.set(ck, j); })
        .catch(() => { if (customCache.get(ck) === pr) later(() => { if (customCache.get(ck) === pr) customCache.delete(ck); }, 3000); });   // retry after 3 s
      capSet(customCache, ck, pr);
      return undefined;
    }
    return v && v.then ? undefined : v;
  }

  // a follower's name, '' for an empty plot, null on a network error (callers retry; never "unclaimed")
  async function nameOf(bx, bz, slot) {
    const ver = (manifest.nh && manifest.nh[regionKey(regionOf(bx), regionOf(bz))]) || manifest.built;
    const key = regionKey(regionOf(bx), regionOf(bz)) + '@' + ver;
    let lines = nameCache.get(key);
    if (!lines) {
      const pr = fetch(`${base}n/${regionKey(regionOf(bx), regionOf(bz))}.txt?v=${ver}`)
        .then((r) => (r.ok ? r.text() : r.status === 404 ? '' : Promise.reject(new Error(r.status)))).then((t) => t.split('\n')).catch(() => null);
      capSet(nameCache, key, pr);
      lines = pr;
    }
    if (lines.then) {
      const pr = lines;
      lines = await lines;
      if (nameCache.get(key) === pr) { if (lines) nameCache.set(key, lines); else nameCache.delete(key); }   // failures are not cached
    }
    if (!lines) return null;
    return lines[lineIndex(bx, bz, slot)] || '';
  }

  function shard(norm) {
    const key = shardFor(norm, manifest.split);
    if (!shardCache.has(key)) {
      const pr = fetch(`${base}s/${key}.json?v=${(manifest.sh && manifest.sh[key]) || manifest.built}`)
        .then((r) => (r.ok ? r.json() : r.status === 404 ? [] : Promise.reject(new Error(r.status))))
        .catch(() => { if (shardCache.get(key) === pr) shardCache.delete(key); return null; });   // not cached: the next search retries
      capSet(shardCache, key, pr);
    }
    return shardCache.get(key);
  }
  // up to 8 [name, index] matches, the exact one first; null on a network error (not "no such follower")
  async function findName(q) {
    const norm = normName(q);
    if (!norm) return [];
    const list = await shard(norm);
    if (!list) return null;
    const out = [];
    for (const e of list) { if (e[0].startsWith(norm)) { out.push(e); if (out.length > 60) break; } }
    out.sort((a, b) => (a[0] === norm ? -1 : b[0] === norm ? 1 : a[0].length - b[0].length || a[1] - b[1]));
    return out.slice(0, 8);
  }

  return {
    get manifest() { return manifest; },
    // a new manifest becomes current: names and search shards may have changed (custom files are versioned)
    commit(m) { manifest = m; nameCache.clear(); shardCache.clear(); },
    dropCustom(k) { for (const ck of [...customCache.keys()]) if (ck.startsWith(k + '@')) customCache.delete(ck); },   // every version of region k
    customFor, nameOf, shard, findName,
  };
}

// "Only the latest wins": every tap / search / manual move takes a ticket; an async result is applied only
// if its ticket is still the latest.
export function createLatest() {
  let n = 0;
  return { take: () => ++n, bump: () => { n++; }, isCurrent: (k) => k === n };
}
// Resolves a search for a home: { hit: [name, index] }, { none }, { error } (network), or { stale } when a
// later tap or search took over while this one was waiting.
export async function searchHome(data, seq, name) {
  const norm = normName(name);
  const my = seq.take();
  const list = await data.findName(norm);
  if (!seq.isCurrent(my)) return { stale: true };
  if (list === null) return { error: true };
  const hit = list.find((e) => e[0] === norm) || list[0];
  return hit ? { hit } : { none: true };
}
