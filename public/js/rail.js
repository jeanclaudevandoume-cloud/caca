// Elevated railway (round R, design review): one east-west viaduct over the street south of block row
// RAIL_Z, crossing the mid-band of the opening view in front of the slab rows. It stands on the existing
// road (piers in the median, deck 10 m up, clear of the 8 m utility wires), so the follower layout and the
// ground shader do not change. A station every 12 blocks: a wide platform deck, a canopy and a name board.
// Chunks build the full viaduct; mid-band tiles a deck and one pier per block.
import { PITCH, mod, hash3, kindAt, K } from './town.js';
import { M, TALL, shade } from './mb.js';
import { board } from './props.js';

export const RAIL_Z = 19;                                      // the road on the +z side of block row 19: ~250 m ahead of the opening camera, > 100 m from the demo arrival (#120,001 at row 22)
const isStation = (bx) => mod(bx, 12) === 5;
const DECK = 0x9d9a93, DECK_TOP = 0x6f6c67, LINE = 0x2f9e5f, Y0 = 9.6, Y1 = 10.8, HW = 3.6;

// the train over block column bx, or 0: one train per group of 4 blocks on half the groups (a station breaks it)
function trainAt(bx) {
  const g = Math.floor(bx / 4), ht = hash3(g, RAIL_Z, 71);
  // group -1 (bx -4..-1) is the stretch the opening camera looks across: a train always stands there, so the first
  // frame shows the line in use (blind review round 3: an empty viaduct read as a UI divider)
  return ht % 2 === 0 || g === -1 ? (ht | 1) : 0;
}
// a white headlight on the leading end and a red tail light on the trailing end (the lit face is drawn on the
// group's first and last block only; 2 tris each)
function trainEnds(mb, bx, X, y, tz, h, ht) {
  const g4 = ((bx % 4) + 4) % 4, east = (ht >>> 5) & 1;
  for (const [end, s] of [[0, -1], [3, 1]]) {
    if (g4 !== end) continue;
    const head = (s > 0) === !!east, xe = X + s * 23.02;
    mb.xq(xe, tz - 1.2, tz + 1.2, y + 0.5, y + 1.1, s, head ? 0xfff6dc : 0xff2a1a, M.LIGHT, 0);
  }
}

// one block's 48 m of viaduct, centred on the road at Z + 24
export function viaduct(mb, bx, X, Z, lod, lite) {
  // TALL: the viaduct hands over to the mid-band copy per 192 m chunk, unscaled (a sunk/grown 48 m deck would
  // slope); its ends stop 1 cm short of the block edge so no vertex lands in the neighbouring chunk
  const zr = Z + 24, x0 = X - 23.99, x1 = X + 23.99, st = isStation(bx), hw = st ? 7.5 : HW;
  const flag = mb.flag; mb.flag = TALL;
  mb.box(x0, Y0, zr - hw, x1, Y1, zr + hw, DECK, DECK_TOP, M.PLAIN, 3);
  // the line colour along the deck fascia and a shadowed girder band under it: reads as a railway by day (4+4 tris)
  for (const s of [-1, 1]) {
    mb.wq(x0, x1, Y0 + 0.42, Y1 - 0.12, zr + s * (hw + 0.01), s, LINE, M.PLAIN, 3);   // 0.66 m: still a clear line from the opening camera
    mb.wq(x0, x1, Y0, Y0 + 0.36, zr + s * (hw + 0.01), s, shade(DECK, 0.6), M.PLAIN, 3);
    mb.wq(x0, x1, Y1 - 0.1, Y1 + 0.05, zr + s * (hw + 0.02), s, 0xfff0c8, M.LIGHT, 3);   // a line of deck lights: the viaduct draws itself across the town at dusk
  }
  if (!lite) mb.fqY(x0, Y0, zr - hw, x1, Y0, zr - hw, x1, Y0, zr + hw, x0, Y0, zr + hw, M.PLAIN, shade(DECK, 0.55), 3, -1);   // underside, seen from the street
  for (const px of lite || lod ? [X] : [X - 12, X + 12]) mb.cbox(px, 0, zr, 1.6, Y0, 2.6, shade(DECK, 0.92), M.PLAIN, 3, -1);
  if (!lod && !lite) {
    const cast = mb.cast; mb.cast = false;
    for (const s of [-1, 1]) mb.box(x0, Y1, zr + s * hw - 0.15, x1, Y1 + 1.0, zr + s * hw + 0.15, shade(DECK, 0.95), shade(DECK, 0.8), M.PLAIN, 3);   // parapets
    for (const rz of [-1.6, 1.6]) for (const d of [-0.55, 0.55]) mb.q(x0, Y1 + 0.03, zr + rz + d + 0.06, x1, Y1 + 0.03, zr + rz + d + 0.06, x1, Y1 + 0.03, zr + rz + d - 0.06, x0, Y1 + 0.03, zr + rz + d - 0.06, 0, 1, 0, 0, 0, 0, 0, M.METAL, 0x5a5550, 0);
    for (const mx of [X - 12, X + 12]) {                       // catenary masts and their cross-arm
      for (const s of [-1, 1]) mb.cbox(mx, Y1, zr + s * (hw - 0.4), 0.22, 5.2, 0.22, 0x6f7377, M.METAL, 0);
      mb.box(mx - 0.08, Y1 + 4.9, zr - hw + 0.4, mx + 0.08, Y1 + 5.1, zr + hw - 0.4, 0x6f7377, 0x6f7377, M.METAL, 0);
    }
    mb.cast = cast;
  }
  if (st) {                                                    // station: canopy on columns, a name board each side
    mb.box(X - 20, Y1 + 4.2, zr - 6.5, X + 20, Y1 + 4.6, zr + 6.5, 0xe9e6df, 0x9aa0a6, M.PLAIN, 3);
    if (!lite && !lod) for (const cx of [X - 16, X, X + 16]) for (const s of [-1, 1]) mb.cbox(cx, Y1, zr + s * 4.5, 0.4, 4.2, 0.4, 0x7a7f86, M.METAL, 0);
    mb.q(X - 19, Y1 + 4.18, zr + 6, X + 19, Y1 + 4.18, zr + 6, X + 19, Y1 + 4.18, zr - 6, X - 19, Y1 + 4.18, zr - 6, 0, -1, 0, 0, 0, 0, 0, M.LIGHT, 0xf6f2e6, 0);   // lit canopy soffit
    for (const s of [-1, 1]) mb.wq(X - 23.99, X + 23.99, Y1 - 0.25, Y1, zr + s * hw, s, 0xfff0c8, M.LIGHT, 0);   // platform edge lights
    if (!lod) {
      const h = hash3(bx, RAIL_Z, 73);
      board(mb, 'z', zr - 6.55, X - 6, X + 6, Y1 + 4.7, Y1 + 6.3, -1, 0x2f6f8f, h);
      board(mb, 'z', zr + 6.55, X - 6, X + 6, Y1 + 4.7, Y1 + 6.3, 1, 0x2f6f8f, h >>> 3);
    }
  }
  // trains: four blocks long (about 190 m) with gaps between, so they read as trains, not a continuous stripe;
  // silver cars, a coloured stripe, a lit window band, a headlight and a tail light on the end faces
  const ht = trainAt(bx);
  if (ht && !st) {
    const tz = zr + ((ht >>> 4) & 1 ? 1.6 : -1.6);
    mb.cbox(X, Y1 + 0.3, tz, 46, 3.4, 2.9, 0xdfe2e4, M.METAL, ht & 255);
    trainEnds(mb, bx, X, Y1 + 0.3, tz, 3.4, ht);
    if (lod) for (const s of [-1, 1]) mb.wq(X - 22.5, X + 22.5, Y1 + 1.7, Y1 + 2.8, tz + s * 1.47, s, 0xf4ecd8, M.LIGHT, 248);
    if (!lod) for (const s of [-1, 1]) {
      mb.wq(X - 23, X + 23, Y1 + 1.0, Y1 + 1.35, tz + s * 1.47, s, (ht >>> 6) & 1 ? 0x2f9e5f : 0xe07a2f, M.PLAIN, 0);
      mb.wq(X - 22.5, X + 22.5, Y1 + 1.7, Y1 + 2.8, tz + s * 1.47, s, 0xf4ecd8, M.LIGHT, 248);   // lit carriages: pale by day, warm at dusk
    }
  }
  mb.flag = flag;
}

// the mid-band's cheap version: the deck, a flat pier and the trains (14-24 tris)
export function viaductMid(mb, bx, X, Z) {
  const zr = Z + 24, hw = isStation(bx) ? 7.5 : HW, flag = mb.flag;
  mb.flag = TALL;
  mb.box(X - 23.99, Y0, zr - hw, X + 23.99, Y1 + 0.8, zr + hw, DECK, DECK_TOP, M.PLAIN, 3, 0);
  for (const s of [-1, 1]) {
    mb.wq(X - 23.99, X + 23.99, Y0 + 0.42, Y1 - 0.12, zr + s * (hw + 0.01), s, LINE, M.PLAIN, 3);
    mb.wq(X - 23.99, X + 23.99, Y1 - 0.1, Y1 + 0.05, zr + s * (hw + 0.02), s, 0xfff0c8, M.LIGHT, 3);
  }
  // the pier as one double-sided plane across the street (4 tris, not 8: round R, phone under 60k); a deck
  // without legs would float
  const pc = shade(DECK, 0.9);
  mb.wq(X - 0.9, X + 0.9, 0, Y0, zr, 1, pc, M.PLAIN, 3); mb.wq(X - 0.9, X + 0.9, 0, Y0, zr, -1, pc, M.PLAIN, 3);
  const ht = trainAt(bx);                                      // the same trains as the chunks (silver reads from afar)
  if (ht && !isStation(bx)) {
    const tz = zr + ((ht >>> 4) & 1 ? 1.6 : -1.6);
    mb.cbox(X, Y1 + 0.8, tz, 46, 3.0, 2.9, 0xdfe2e4, M.METAL, ht & 255);
    trainEnds(mb, bx, X, Y1 + 0.8, tz, 3.0, ht);
    for (const s of [-1, 1]) mb.wq(X - 22.5, X + 22.5, Y1 + 1.9, Y1 + 2.9, tz + s * 1.47, s, 0xf4ecd8, M.LIGHT, 248);
  }
  mb.flag = flag;
}
// ONE predicate for 'the viaduct exists over block column bx' (round S, code review: collision said yes over ~3.6 km
// of countryside where no mesh was built). The mesher and every collision test use it.
export const railAt = (L, bx) => { const k = kindAt(L, bx, RAIL_Z); return k !== K.SEA && k !== K.PORT && k !== K.COUNTRY; };
// the deck's footprint across z at x (stations are wider)
const inBand = (x, z) => Math.abs(z - (RAIL_Z * PITCH + 24)) <= (isStation(Math.floor((x + 24) / PITCH)) ? 7.8 : HW + 0.4);
export const RAIL_TOP = Y1 + 4.6;                              // deck, train and station canopy
// the viaduct is a slab (Y0 - 0.4 .. RAIL_TOP), not a solid column: cameras and pick rays pass under it
export const inRail = (L, x, y, z) => y >= Y0 - 0.4 && y <= RAIL_TOP && inBand(x, z) && railAt(L, Math.floor((x + 24) / PITCH));
// its top where it exists (flight arcs and occluder scoring go over it), else 0
export const railTop = (L, x, z) => (inBand(x, z) && railAt(L, Math.floor((x + 24) / PITCH)) ? RAIL_TOP : 0);
