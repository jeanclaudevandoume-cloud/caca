// How a home looks: the palettes and recipe() (split from town.js). Deterministic through hash3 only.
import { FLOOR_H, hash3, isqrt, shopLaneX, laneBlock, roofIdx, districtAccent } from './town.js';

// Palettes (0xRRGGBB). The ground shader holds ROOF too.
const WALL = [0xf0ece2, 0xe2d8c4, 0xcdbfa5, 0xd99a6c, 0xf4f2ec, 0xc9b49a, 0xb8c9a3, 0x5c6870];   // ART.md: cream, sand, terracotta, sage, slate (picked through WALL_PICK)
const WALL_PICK = [0, 1, 2, 3, 4, 5, 6, 7, 3, 6];   // terracotta (3) and sage (6) twice: less cream, more colour
// townhouses: three brick tones, then stucco
const TOWN = [0xb46a4c, 0xb07a5a, 0xc8b08e, 0xc9a27e, 0xe3dccf];
export const ROOF = [0x3a3e45, 0x4b5663, 0x2f5d8a, 0x2f4d7a, 0x8a4a34, 0x9a4a30, 0x3f6b6e, 0x7a3b2a];   // ART.md: charcoal/slate, Japanese blue, navy, terracotta, teal, oxblood (round H: 2 of 8 grey, not 4); green only on villas
// ART.md city facades: S <= .30, V <= .85 (the palette is clamped to the table)
export const CITY = [0xc9a27e, 0x8e9aa6, 0xd8c3a0, 0x5f6b78, 0xb5876a, 0xe0d6c4, 0x4a5560].map((c) => clampSV(c, 0.295, 0.845));
export const ACCENT = [0xff6b6b, 0x1fb5ad, 0xffb627, 0x6c63ff, 0x2ec27e, 0xff8fb1];
export const GLASS = [0x4d7799, 0x2f7f86, 0x2f4a72, 0x2a4a63, 0x8a6a4a, 0x3b5a4f, 0x6b4f3a, 0x1f2a3a, 0x7a5a3e, 0x355f8f, 0x2c3f4f, 0x5a6f80];   // ART.md: dark only

export const SHAPES = ['mushroom', 'dome', 'castle', 'pyramid', 'ufo', 'treehouse', 'lighthouse', 'igloo', 'rocket', 'cube'];
export const GARDEN = ['fountain', 'pool', 'flowers', 'tree', 'car', 'trampoline', 'statue', 'bench', 'swing', 'pond', 'palm', 'tent'];

// How a home looks. `custom` (optional) = { shape, color: '#rrggbb', garden: [..] }.
export function recipe(bx, bz, slot, zone, custom) {
  const h = hash3(bx * 16 + slot, bz, 21), h2 = hash3(bx, bz * 16 + slot, 22);
  const r = { zone, slot, hash: h, roof: roofIdx(bx, bz, slot), wall: 0, floors: 1, w: 7, d: 9,
    roofType: 0, mat: 1, style: 0, sig: false, ox: 0, garden: [], tree: false, shape: null, color: -1, top: false, crown: 0 };
  const col = slot & 3, lane = laneBlock(bx, bz, zone);
  if (zone <= 1 && !custom && !lane && ((col === 3 && shopLaneX(bx)) || (col === 0 && shopLaneX(bx - 1)))) {
    // shop house on a shotengai: shop on the ground floor facing the lane, 2-4 storeys of flats above
    r.shop = col === 3 ? 1 : -1;
    r.floors = (zone === 1 ? 3 : 2) + (h % 3);
    r.w = 9.4; r.d = 18.6; r.roofType = (h >>> 20) % 10 < 4 ? 0 : 2;   // 40% pitched (gable along the lane)
    r.wall = TOWN[(h >>> 11) % TOWN.length];
    r.sign = (h >>> 7) % 6; r.awning = (h >>> 10) % 4;
    r.height = r.floors * FLOOR_H;
    return r;
  }
  if (zone === 0) {
    // Tokyo jutaku: narrow 2-3 storey house close to the street, hugging one side line
    r.floors = 2 + (h & 1);                   // half are 3 storeys
    r.w = lane ? 6.4 + ((h >>> 1) % 4) * 0.2 : 8.0 + ((h >>> 1) % 4) * 0.3;   // packed: side gaps 0.7-1.6 m (narrower on 8 m lane plots)
    r.d = 11 + ((h >>> 4) % 4) * 0.75;
    const rt = (h >>> 8) % 20;
    r.roofType = rt < 9 ? 3 : rt < 15 ? 0 : 2;  // 3 mono-pitch, 0 low gable, 2 flat with parapet
    r.wall = WALL[WALL_PICK[(h >>> 11) % WALL_PICK.length]];   // creams (0,1,4) are 3 in 10, not 3 in 8
    r.style = (h >>> 26) & 1;                 // 1 = ceramic siding (vertical joints)
    r.twoTone = ((h >>> 27) & 1) === 1;       // darker ground storey + string course
    r.side = h & 8 ? 1 : -1;                  // the house sits 0.9 m from this side line
    r.balcony = (h >>> 14) % 10 < 6;
    r.garage = (h >>> 18) % 10 < 7;           // built-in garage on the side away from the door
    r.tree = (h >>> 22) % 10 < 5;             // a small tree in the side planting strip
    r.vending = (h >>> 29) % 3 === 0;         // a vending machine at the front corner
    if ((h >>> 18) % 3 === 0) r.garden.push(GARDEN[(h2 >>> 3) % GARDEN.length]);
  } else if (zone === 1) {
    // Seoul villa: 4-5 storeys of brick over an open parking storey (pilotis), flat roof
    r.floors = 4 + (h & 1);
    r.w = lane ? 7.2 : 9.4; r.d = 12 + ((h >>> 4) % 7) * 0.5;
    r.roofType = 2;
    r.mansard = (h >>> 8) % 10 < 3;
    const mr = (h >>> 20) % 20;
    r.roofMem = mr < 12 ? 0x4f8a6e : mr < 15 ? 0x5f86a8 : 0x5a5f66;   // Seoul green / blue / grey roofs
    const ti = (h >>> 11) % 5;
    r.wall = TOWN[ti];
    r.style = ti < 2 ? 2 : 0;                 // 2 = brick
    r.tree = ((h >>> 14) % 10) < 3;
  } else if (zone === 2) {
    // shotengai massing: low shop buildings on the street rows, taller ones behind (height/width <= ~3.3,
    // no "pencil palisade" on the horizon); outer columns step down too so blocks read as stepped masses
    const row = slot >> 2, col = slot & 3, street = row === 0 || row === 3, edge = col === 0 || col === 3;
    r.floors = street ? 3 + (h % 4) - (edge && (h & 16) ? 1 : 0) : 5 + (h % 5);
    r.w = 8.6; r.d = 8.0 + ((h >>> 20) % 3) * 0.8; r.roofType = 2;
    r.wall = (h >>> 9) % 5 === 0 ? clampSV(blend(ACCENT[districtAccent(bx, bz)], CITY[(h >>> 11) % CITY.length], 0.75), 0.295, 0.845) : CITY[(h >>> 11) % CITY.length];
    r.crown = (h >>> 15) % 3;
  } else {
    // towers: height tapers from the centre, with ragged variety and the odd landmark
    const d = isqrt(bx * bx + bz * bz);
    const hubFar = d > 10;
    // a landmark cluster right around the plaza, tapering steadily outward
    const maxF = hubFar ? 30 : d <= 2 ? 58 : Math.max(18, 48 - 4 * d);
    const roll = h % 100;
    r.floors = Math.max(8, Math.floor(maxF * ((d <= 3 ? 60 : 35) + (h >>> 7) % (d <= 3 ? 41 : 66)) / 100));
    if (roll < 6) r.floors = Math.min(58, Math.floor(maxF * 1.25));   // 58 + a 4-floor crown stays under the packed v limit (63.75 floors)
    r.sig = d <= 1 && roll < 6;                  // the few signature towers (lantern crown + spire)
    // plots pair up: even slots build one wide tower over both plots, odd slots a 2-storey podium
    r.pod = (slot & 1) === 1;
    if (r.pod) { r.floors = 2; r.w = 9.6; r.d = 19; r.ox = 0; }
    else {
      r.w = 17.5; r.d = 15 + ((h >>> 5) % 5); r.ox = 5;
      if (!r.sig) r.floors = Math.min(r.floors, Math.floor(9 * r.w / FLOOR_H));   // height/width <= 9: no needles
    }
    r.roofType = 2; r.mat = 5;
    r.wall = GLASS[(h >>> 9) % GLASS.length];
    r.crown = (h >>> 15) % 5;
  }
  if (custom) {
    if (zone >= 2) r.top = true;
    r.shape = SHAPES.includes(custom.shape) ? custom.shape : 'cube';
    r.color = soften(parseColor(custom.color, ACCENT[h % ACCENT.length]));
    if (Array.isArray(custom.garden)) r.garden = custom.garden.filter((g) => GARDEN.includes(g)).slice(0, 4);
  }
  r.height = r.floors * FLOOR_H;   // custom homes keep their house (the shape is an ornament on top)
  return r;
}

// Cap a colour's HSV saturation and value (hue kept).
export function clampSV(c, smax, vmax) {
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = Math.min(mx, vmax), sat = mx > 0 ? Math.min((mx - mn) / mx, smax) : 0;
  const f = (x) => { const s0 = mx > mn ? (mx - x) / (mx - mn) : 0; return Math.round((v * (1 - sat * s0)) * 255); };
  return (f(r) << 16) | (f(g) << 8) | f(b);
}
// Custom colours are owner-chosen and often neon: cap saturation and brightness so they sit in the palette.
export const soften = (c) => clampSV(c, 0.32, 0.75);
export function blend(a, b, t) {
  const f = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) << s;
  return f(16) | f(8) | f(0);
}

function parseColor(s, dflt) {
  if (typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)) return parseInt(s.slice(1), 16);
  return dflt;
}
