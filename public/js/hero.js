// The pinned follower's home at full detail on the phone preset. The low preset meshes every near chunk with
// the lite builder (porch, plants, sills, AC boxes and the cantilevered storey are left out to stay under the
// tris budget), which is fine for the street but not for the product moment: arriving at YOUR home. This
// module rebuilds just that one home with the full builder (a few hundred tris) on the main thread, once per
// pin; render.js draws it with a polygon offset over the lite copy in its chunk, so the coplanar walls resolve
// to the detailed version and the extra parts stand in front of the lite box.
import { CHUNK, PITCH, zoneLevel, plotFrame } from './town.js';
import { occupied, lineIndex } from './layout.js';
import { recipe } from './recipe.js';
import { MB } from './mb.js';
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
      free();
      out = { mesh: gfx.upload(mb.finish()), ox, oz };
      key = pin.key;
      return out;
    },
  };
}
