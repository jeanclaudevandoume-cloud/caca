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
  const fs = f.face, front = f.z + fs * f.d / 2, lane = front + fs * 1.6;
  const cast = mb.cast; mb.cast = false;
  const CL = [0x2b3a55, 0xd8d2c4, 0x7a2e3a, 0x34594a, 0xe8b23a, 0x3d3d3d];
  for (let i = 0; i < 2; i++) {                                  // two people facing each other
    const px = f.x + (h & 1 ? 1.8 : -1.8) + i * 0.75, pz = lane + i * 0.2 * fs;
    mb.cyl(px, 0, pz, 0.2, 0.95, 0.17, 5, 0x2a2a2e, M.PLAIN, 0, false);
    mb.cyl(px, 0.9, pz, 0.25, 1.48, 0.2, 5, CL[(h >>> (3 + i * 3)) % CL.length], M.PLAIN, 0, false);
    mb.cyl(px, 1.48, pz, 0.13, 1.72, 0.11, 5, 0xe0b894, M.PLAIN, 0);
  }
  const bx = f.x + (h & 2 ? 3.2 : -3.2), bz = front + fs * 0.5;   // a bicycle against the front wall line
  for (const dx of [-0.55, 0.55]) mb.cyl(bx + dx, 0, bz, 0.34, 0.06, 0.34, 6, 0x1c1d20, M.METAL, 0);   // wheels (flat discs read from above)
  mb.cbox(bx, 0.45, bz, 1.2, 0.08, 0.06, 0x8a2f2f, M.METAL, 0);
  mb.cbox(bx + 0.45, 0.45, bz, 0.06, 0.5, 0.06, 0x1c1d20, M.METAL, 0);
  if (f.d !== 18) {                                               // a kei car parked along the street (not in a 4 m roji)
    const cx = f.x + (h & 4 ? -3.4 : 3.4), cz = front + fs * 3.4, cc = CARS[(h >>> 9) % CARS.length];
    mb.cbox(cx, 0.15, cz, 3.3, 0.8, 1.45, cc, M.METAL, 0);
    mb.cbox(cx - 0.2, 0.95, cz, 2.0, 0.6, 1.3, 0x2b3240, M.GLASS, 0);
  }
  const vx = f.x + (h & 8 ? f.w / 2 - 0.6 : -f.w / 2 + 0.6), vz = front - fs * 0.5;   // vending machine at the plot corner
  mb.cbox(vx, 0, vz, 0.9, 1.8, 0.7, VEND[(h >>> 12) % VEND.length], M.LIGHT, 0);
  mb.cast = cast;
}
