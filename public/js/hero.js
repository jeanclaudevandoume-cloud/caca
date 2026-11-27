// The pinned follower's home at full detail on the phone preset. The low preset meshes every near chunk with
// the lite builder (porch, plants, sills, AC boxes and the cantilevered storey are left out to stay under the
// tris budget), which is fine for the street but not for the product moment: arriving at YOUR home. This
// module rebuilds just that one home with the full builder (a few hundred tris) on the main thread, once per
// pin; render.js draws it with a polygon offset over the lite copy in its chunk, so the coplanar walls resolve
// to the detailed version and the extra parts stand in front of the lite box.
import { CHUNK, PITCH, zoneLevel, plotFrame } from './town.js';
import { occupied, lineIndex } from './layout.js';
import { recipe } from './recipe.js';
import { MB, M, CARS, VEND } from './mb.js';
import { hash3 } from './town.js';
import { home } from './homes.js';

export function createHero({ gfx, data }) {
  let key = null, out = null;
  const free = () => { if (out) gfx.release(out.mesh); out = null; };
  return {
    // { mesh, ox, oz } for the pin's home and its neighbours, or null (no pin, a tower plot, or its custom spec still loading)
    get(pin, L) {
      if (!pin || pin.key === undefined) return null;
      if (pin.key === key) return out;
      const slot = pin.key % 16, t = Math.floor(pin.key / 16), bz = (t % 65536) - 32768, bx = Math.floor(t / 65536) - 32768;
      const cx = Math.floor(bx / CHUNK), cz = Math.floor(bz / CHUNK), zone = zoneLevel(bx, bz);
      if (zone > 2) { free(); key = pin.key; return null; }          // towers are already full masses on the phone
      const cus = data.customFor(cx, cz);
      if (cus === undefined) return null;                             // still downloading: try again next frame
      const ox = (cx * CHUNK + 1.5) * PITCH, oz = (cz * CHUNK + 1.5) * PITCH;   // the chunk origin (mesher.js)
      const mb = new MB(ox, oz, 8192, false), f = {}, g = {};
      plotFrame(bx, bz, slot, zone, f);
      // the home and its side-by-side neighbours (they share the arrival frame): ~0.9k tris each
      const n = L ? occupied(L, bx, bz) : slot + 1;
      for (let s = 0; s < n; s++) {
        plotFrame(bx, bz, s, zone, g);
        if (s !== slot && Math.hypot(g.x - f.x, g.z - f.z) > 13) continue;
        home(mb, bx, bz, g, recipe(bx, bz, s, zone, cus ? cus[lineIndex(bx, bz, s)] : null), 0);
      }
      street(mb, f, hash3(bx, bz, slot * 13 + 5));
      free();
      out = { mesh: gfx.upload(mb.finish()), ox, oz };
      key = pin.key;
      return out;
    },
  };
}

// Life outside the follower's home (arrival only, ~60 tris): two neighbours chatting on the lane, a bicycle by the
// door, a kei car parked along the kerb and a lit vending machine at the plot corner. The arrival frame is the app's
// emotional payoff; a lane with no one on it read as an empty diorama (blind review).
function street(mb, f, h) {
  const fs = f.face, front = f.z + fs * f.d / 2, lane = front + fs * 1.7;
  const cast = mb.cast; mb.cast = false;
  const CL = [0xf4f1ea, 0xe8463a, 0xf2c23a, 0x3a8fd8, 0xffffff, 0xe86aa8];   // bright clothing: readable at phone size
  for (let i = 0; i < 3; i++) {                                  // three neighbours chatting on the lane
    const px = f.x + (h & 1 ? 1.6 : -1.6) + (i - 1) * 0.8, pz = lane + (i === 1 ? 0.6 : 0) * fs;
    mb.cyl(px, 0, pz, 0.2, 0.9, 0.18, 5, 0x2a2d36, M.PLAIN, 0, false);                       // trousers
    mb.cyl(px, 0.88, pz, 0.27, 1.5, 0.21, 5, CL[(h >>> (3 + i * 3)) % CL.length], M.PLAIN, 0, false);   // top
    mb.cyl(px, 1.5, pz, 0.14, 1.78, 0.12, 5, 0xf0c8a0, M.PLAIN, 0);                          // head
  }
  const bx = f.x + (h & 2 ? 3.2 : -3.2), bz = front + fs * 0.6;   // a bicycle by the gate (side-on)
  for (const dx of [-0.55, 0.55]) mb.cbox(bx + dx, 0, bz, 0.66, 0.66, 0.05, 0x1c1d20, M.METAL, 0);
  mb.cbox(bx, 0.5, bz, 1.2, 0.08, 0.07, 0xd8402f, M.METAL, 0);
  if (f.d !== 18) {                                               // a kei car parked on the street, on its wheels
    // parked parallel just off the kerb, on the side clear of the utility poles (mesher.js: X - 18 and X + 6)
    const X = Math.round((f.x + 15) / 48) * 48, clear = (x) => Math.abs(x - (X - 18)) > 2.4 && Math.abs(x - (X + 6)) > 2.4;
    let cx = f.x + (h & 4 ? -3.6 : 3.6); if (!clear(cx)) cx = 2 * f.x - cx;
    const cz = front + fs * 2.4;
    const cc = [0xf4f3ef, 0xe9d9a8, 0xa8c8e0, 0xe86a5a][(h >>> 9) & 3];   // light kei-car colours
    for (const wx of [-1.05, 1.05]) for (const wz of [-0.62, 0.62]) mb.cyl(cx + wx, 0, cz + wz, 0.3, 0.6, 0.3, 6, 0x1a1a1c, M.PLAIN, 0);
    mb.cbox(cx, 0.3, cz, 3.3, 0.75, 1.45, cc, M.METAL, 0);                  // body
    mb.cbox(cx - 0.15, 1.05, cz, 2.3, 0.7, 1.38, cc, M.METAL, 0);           // tall kei cabin
    for (const s2 of [-1, 1]) mb.wq(cx - 1.2, cx + 0.9, 1.15, 1.65, cz + s2 * 0.7, s2, 0x24303e, M.GLASS, 0);   // window band
  }
  const vx = f.x + (h & 8 ? f.w / 2 - 0.6 : -f.w / 2 + 0.6), vz = front - fs * 0.5;   // vending machine at the plot corner
  mb.cbox(vx, 0, vz, 0.9, 1.8, 0.7, VEND[(h >>> 12) % VEND.length], M.LIGHT, 0);
  mb.cast = cast;
}
