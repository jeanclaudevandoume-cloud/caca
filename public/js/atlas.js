// Facade and roof atlas, painted once at load on a 2D canvas and uploaded with mipmaps (round M).
// 4 x 4 tiles of 256 px. Each window tile is the whole window opening: aluminium frame, sash bars, glass
// with a sky gradient, a reveal shadow, sill, and what is behind the glass (curtains, blinds, a lamp).
// Alpha = how much of the pixel is glass (the shader adds sky reflection and night glow there).
//
//   row 0: sliding sash windows (4 variants: lace curtain, open dark room, blinds, curtains + plant)
//   row 1: 0-1 small frosted windows, 2-3 balcony doors with an aluminium railing and laundry
//   row 2: tower glass (ribbon, fins, punched stone grid, bronze curtain wall)
//   row 3: 0 kawara tiles, 1 galvalume standing seams, 2 ALC wall panels, 3 ceramic siding
//   row 4: flat roof surfaces (grey, multiplied by the roof colour): 0 urethane membrane with seams and a drain,
//          1 asphalt sheet with tar patches, 2 concrete pavers, 3 membrane with rust stains
//   row 5: shopfronts: 0 lit shelves with goods, 1 noren over a dark entrance, 2 roller shutter, 3 vending pair
//   row 6: kanban lettering (round Q): one vertical column of four kanji-like glyphs per tile; rgb white,
//          alpha = ink. Signs map u across the board and v down the column (tategaki).
//   row 7: mid-band roof strips (round R): 0-1 jutaku rows, 2-3 villa rows (stair huts, tanks, AC, NE shadows)
export const ATLAS_TILES = 4, ATLAS_SIZE = 1024, ATLAS_ROWS = 8, ATLAS_H = 2048;
const T = ATLAS_SIZE / ATLAS_TILES, PAD = 6;   // a gutter inside each tile so mip levels don't bleed

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function glass(g, x, y, w, h, r, opts = {}) {
  // glass with a sky gradient (lighter at the top), darker interior bottom; alpha 1 = glass
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, opts.top || 'rgba(150,175,198,1)');
  gr.addColorStop(0.55, opts.mid || 'rgba(78,96,116,1)');
  gr.addColorStop(1, opts.bot || 'rgba(38,46,58,1)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  // diagonal reflection streak
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = 'rgba(255,255,255,0.10)';
  g.beginPath(); g.moveTo(x + w * 0.15, y); g.lineTo(x + w * 0.35, y); g.lineTo(x + w * 0.05, y + h); g.lineTo(x - w * 0.15, y + h); g.fill();
  g.restore();
  void r;
}

function reveal(g, x, y, w, h) {
  // the opening is recessed: the top and the left edge of the glass sit in shadow
  const t = g.createLinearGradient(0, y, 0, y + h * 0.12);
  t.addColorStop(0, 'rgba(0,0,0,0.45)'); t.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = t; g.fillRect(x, y, w, h * 0.12);
  const l = g.createLinearGradient(x, 0, x + w * 0.08, 0);
  l.addColorStop(0, 'rgba(0,0,0,0.35)'); l.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = l; g.fillRect(x, y, w * 0.08, h);
}

function tile(g, i, j, paint) {
  g.save();
  g.translate(i * T + PAD, j * T + PAD);
  paint(T - 2 * PAD);
  g.restore();
}

// alpha is painted by drawing the glass mask into a second canvas and combining at the end
export function buildAtlas() {
  const mk = () => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(ATLAS_SIZE, ATLAS_H) : Object.assign(document.createElement('canvas'), { width: ATLAS_SIZE, height: ATLAS_H }));
  const c = mk(), m = mk();
  const g = c.getContext('2d'), gm = m.getContext('2d');
  g.fillStyle = '#7a7a78'; g.fillRect(0, 0, ATLAS_SIZE, ATLAS_H);
  gm.fillStyle = '#000'; gm.fillRect(0, 0, ATLAS_SIZE, ATLAS_H);
  const R = rng(7);
  const ALU = ['#3c3f43', '#4a4d51', '#c9c7c0', '#5b5148'];
  const mask = (i, j, x, y, w, h) => { gm.fillStyle = '#fff'; gm.fillRect(i * T + PAD + x, j * T + PAD + y, w, h); };

  // ---- row 0: sliding sash windows ----
  for (let i = 0; i < 4; i++) tile(g, i, 0, (s) => {
    const fr = ALU[i % 4], b = s * 0.06;
    g.fillStyle = fr; g.fillRect(0, 0, s, s);                                     // outer frame
    const gx = b, gy = b, gw = s - 2 * b, gh = s - 2 * b;
    glass(g, gx, gy, gw, gh);
    // behind the glass
    if (i === 0) { g.fillStyle = 'rgba(240,236,226,0.78)'; for (let k = 0; k < 9; k++) g.fillRect(gx + k * gw / 9, gy, gw / 9 - 3, gh * 0.92); }   // lace curtain
    if (i === 1) { g.fillStyle = 'rgba(20,24,30,0.55)'; g.fillRect(gx, gy + gh * 0.45, gw, gh * 0.55); g.fillStyle = 'rgba(255,214,150,0.35)'; g.fillRect(gx + gw * 0.62, gy + gh * 0.18, gw * 0.12, gh * 0.12); }   // dark room, lamp
    if (i === 2) { g.fillStyle = 'rgba(214,214,206,0.85)'; for (let k = 0; k < 14; k++) g.fillRect(gx, gy + k * gh / 14, gw, gh / 14 - 4); }   // venetian blinds
    if (i === 3) { g.fillStyle = 'rgba(180,96,80,0.8)'; g.fillRect(gx, gy, gw * 0.26, gh); g.fillRect(gx + gw * 0.74, gy, gw * 0.26, gh); g.fillStyle = '#4f8a3a'; g.beginPath(); g.arc(gx + gw * 0.5, gy + gh * 0.86, gw * 0.1, 0, 7); g.fill(); }
    reveal(g, gx, gy, gw, gh);
    mask(i, 0, gx, gy, gw, gh);
    // two sliding panels: a centre meeting rail and the inner sash edges
    g.fillStyle = fr; g.fillRect(s / 2 - b * 0.45, 0, b * 0.9, s);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(s / 2 + b * 0.45, gy, 3, gh);
    // sill
    g.fillStyle = '#d8d5cc'; g.fillRect(-PAD, s - b * 0.7, s + 2 * PAD, b * 0.7);
  });

  // ---- row 1: frosted and balcony doors ----
  for (let i = 0; i < 2; i++) tile(g, i, 1, (s) => {
    const fr = ALU[(i + 1) % 4], b = s * 0.08;
    g.fillStyle = fr; g.fillRect(0, 0, s, s);
    g.fillStyle = i ? '#b9c1c6' : '#cfd3d2'; g.fillRect(b, b, s - 2 * b, s - 2 * b);   // frosted
    g.fillStyle = 'rgba(255,255,255,0.18)'; for (let k = 0; k < 6; k++) g.fillRect(b, b + k * (s - 2 * b) / 6, s - 2 * b, 2);
    if (i) { g.strokeStyle = fr; g.lineWidth = 5; for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(b, b + k * (s - 2 * b) / 5); g.lineTo(s - b, b + k * (s - 2 * b) / 5); g.stroke(); } }   // security grille
    reveal(g, b, b, s - 2 * b, s - 2 * b);
    mask(i, 1, b, b, s - 2 * b, (s - 2 * b) * 0.4);
  });
  for (let i = 2; i < 4; i++) tile(g, i, 1, (s) => {
    const fr = ALU[i % 4], b = s * 0.05;
    g.fillStyle = fr; g.fillRect(0, 0, s, s);
    glass(g, b, b, s - 2 * b, s - 2 * b, 0, { mid: 'rgba(70,86,104,1)' });
    reveal(g, b, b, s - 2 * b, s - 2 * b);
    mask(i, 1, b, b, s - 2 * b, s - 2 * b);
    g.fillStyle = fr; g.fillRect(s / 2 - b * 0.4, 0, b * 0.8, s);
    // aluminium railing across the lower 45%
    const ry = s * 0.55;
    g.fillStyle = i === 2 ? '#e4e2dc' : '#585c60'; g.fillRect(0, ry, s, s * 0.05);
    for (let k = 0; k <= 12; k++) g.fillRect(k * s / 12 - 2, ry, 4, s - ry);
    if (i === 3) {                                                                      // laundry
      const cols = ['#e86f6f', '#f2f2ee', '#6fa8dc', '#f2c14e'];
      for (let k = 0; k < 4; k++) { g.fillStyle = cols[k]; g.fillRect(s * 0.12 + k * s * 0.19, s * 0.3, s * 0.15, s * (0.18 + 0.08 * (k & 1))); }
    }
  });

  // ---- row 2: tower glass ----
  for (let i = 0; i < 4; i++) tile(g, i, 2, (s) => {
    const tint = [['#9fb6c8', '#4d6375', '#1f2a35'], ['#8ea4b5', '#3d5060', '#1a222b'], ['#b9c3c8', '#68747d', '#2e353b'], ['#c8b28e', '#7a6146', '#2f261c']][i];
    glass(g, 0, 0, s, s, 0, { top: tint[0], mid: tint[1], bot: tint[2] });
    mask(i, 2, 0, 0, s, s);
    g.fillStyle = i === 2 ? '#d9d2c4' : '#2a3038';
    const mull = i === 1 ? 4 : 2;
    for (let k = 0; k <= mull; k++) g.fillRect(k * s / mull - (i === 1 ? 7 : 3), 0, i === 1 ? 14 : 6, s);
    g.fillRect(0, s - (i === 2 ? 40 : 10), s, i === 2 ? 40 : 10);                     // spandrel / transom
    if (i === 2) { g.fillRect(0, 0, s, 30); g.fillRect(0, 0, 30, s); g.fillRect(s - 30, 0, 30, s); }
    for (let k = 0; k < 5; k++) if (R() < 0.5) { g.fillStyle = 'rgba(230,226,214,0.6)'; g.fillRect(k * s / 5 + 4, 8, s / 5 - 8, s * (0.2 + R() * 0.5)); }   // blinds at random heights
  });

  // ---- row 3: roofs and walls ----
  tile(g, 0, 3, (s) => {                                                            // kawara: interlocking clay tiles
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    const rows = 8, cols = 6;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const x = k * s / cols, y = r * s / rows, v = 0.9 + 0.2 * R();
      const gr = g.createLinearGradient(x, 0, x + s / cols, 0);
      gr.addColorStop(0, `rgb(${70 * v},${70 * v},${70 * v})`); gr.addColorStop(0.5, `rgb(${150 * v},${150 * v},${150 * v})`); gr.addColorStop(1, `rgb(${95 * v},${95 * v},${95 * v})`);
      g.fillStyle = gr; g.fillRect(x, y, s / cols, s / rows - 5);
      g.fillStyle = 'rgb(55,55,55)'; g.fillRect(x, y + s / rows - 5, s / cols, 5);
    }
  });
  tile(g, 1, 3, (s) => {                                                            // galvalume standing seams
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, s, s);
    for (let k = 0; k < 8; k++) { const x = k * s / 8; g.fillStyle = '#c4c4c4'; g.fillRect(x, 0, 5, s); g.fillStyle = '#6e6e6e'; g.fillRect(x + 5, 0, 4, s); }
  });
  tile(g, 2, 3, (s) => {                                                            // ALC panels: 0.6 m x 1.8 m joints
    g.fillStyle = '#9c9c9c'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#7c7c7c'; for (let k = 0; k < 4; k++) g.fillRect(0, k * s / 4, s, 3); g.fillRect(0, 0, 3, s);
  });
  tile(g, 3, 3, (s) => {                                                            // ceramic siding boards
    for (let k = 0; k < 10; k++) { const v = 140 + 20 * R(); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, k * s / 10, s, s / 10); g.fillStyle = 'rgb(105,105,105)'; g.fillRect(0, k * s / 10 + s / 10 - 4, s, 4); }
  });

  // ---- row 4: flat roof surfaces (grey ~0.55, multiplied by the membrane colour in the shader) ----
  const grey = (v) => `rgb(${v},${v},${v})`;
  tile(g, 0, 4, (s) => {                                                            // urethane membrane
    g.fillStyle = grey(140); g.fillRect(0, 0, s, s);
    g.fillStyle = grey(118); for (let k = 1; k < 4; k++) { g.fillRect(k * s / 4 - 2, 0, 4, s); }
    for (let k = 0; k < 40; k++) { g.fillStyle = grey(125 + R() * 30); g.fillRect(R() * s, R() * s, 6, 6); }
  });
  tile(g, 1, 4, (s) => {                                                            // asphalt sheet, tar patches
    g.fillStyle = grey(120); g.fillRect(0, 0, s, s);
    for (let k = 0; k < 900; k++) { g.fillStyle = grey(100 + R() * 45); g.fillRect(R() * s, R() * s, 3, 3); }
    g.fillStyle = grey(70); for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(R() * s, R() * s, 18 + R() * 30, 8 + R() * 14, R() * 3, 0, 7); g.fill(); }
    g.fillStyle = grey(95); for (let k = 1; k < 3; k++) g.fillRect(0, k * s / 3 - 2, s, 3);
  });
  tile(g, 2, 4, (s) => {                                                            // concrete pavers, 0.6 m grid
    // round R: low-contrast joints (the old 4 px dark gaps read as a swimming-pool grid under cyan membranes)
    g.fillStyle = grey(134); g.fillRect(0, 0, s, s);
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) { g.fillStyle = grey(140 + R() * 7); g.fillRect(i * s / 6 + 1, j * s / 6 + 1, s / 6 - 2, s / 6 - 2); }
  });
  tile(g, 3, 4, (s) => {                                                            // membrane with rust stains under the clutter
    g.fillStyle = grey(138); g.fillRect(0, 0, s, s);
    g.fillStyle = grey(116); for (let k = 1; k < 4; k++) g.fillRect(0, k * s / 4 - 2, s, 4);
    for (let k = 0; k < 6; k++) { const x = R() * s; g.fillStyle = 'rgba(90,80,70,0.18)'; g.fillRect(x, 0, 3 + R() * 4, s); }   // faint weathering lines, no blotches that repeat as a grid
  });

  // ---- row 5: shopfronts (full colour; v = 0 at the pavement) ----
  tile(g, 0, 5, (s) => {                                                            // lit shelves with goods
    g.fillStyle = '#f4ead6'; g.fillRect(0, 0, s, s);
    for (let r = 0; r < 4; r++) {
      g.fillStyle = '#c9c2b4'; g.fillRect(0, s * (0.2 + r * 0.2), s, 5);
      for (let k = 0; k < 14; k++) { g.fillStyle = ['#e2574c', '#f2c14e', '#4f9de0', '#5bbf6a', '#f08a3c', '#ffffff'][(k + r) % 6]; g.fillRect(4 + k * s / 14, s * (0.2 + r * 0.2) - 16 - R() * 10, s / 14 - 5, 16 + R() * 8); }
    }
    g.fillStyle = 'rgba(40,46,56,0.9)'; g.fillRect(0, s * 0.92, s, s * 0.08);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(s * 0.1, 0, s * 0.08, s);
    mask(0, 5, 0, 0, s, s);
  });
  tile(g, 1, 5, (s) => {                                                            // noren over a dark entrance
    g.fillStyle = '#2a2622'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#f2d7a0'; g.fillRect(s * 0.62, s * 0.15, s * 0.3, s * 0.7);       // warm lit side window
    g.fillStyle = '#1f3a5f'; for (let k = 0; k < 4; k++) g.fillRect(s * 0.08 + k * s * 0.12, s * 0.08, s * 0.1, s * 0.34);
    g.fillStyle = '#f4f1ea'; g.font = `${s * 0.12}px serif`; g.fillText('\u3086', s * 0.14, s * 0.3);
    mask(1, 5, s * 0.62, s * 0.15, s * 0.3, s * 0.7);
  });
  tile(g, 2, 5, (s) => {                                                            // roller shutter
    for (let k = 0; k < 24; k++) { g.fillStyle = grey(150 + (k & 1) * 20); g.fillRect(0, k * s / 24, s, s / 24); }
    g.fillStyle = '#e8e4da'; g.fillRect(s * 0.62, s * 0.4, s * 0.18, s * 0.14);       // a sticker
    g.fillStyle = grey(70); g.fillRect(0, s * 0.95, s, s * 0.05);
  });
  tile(g, 3, 5, (s) => {                                                            // vending pair
    g.fillStyle = '#3a3e45'; g.fillRect(0, 0, s, s);
    for (let k = 0; k < 2; k++) {
      const x = s * (0.08 + k * 0.46), w = s * 0.4;
      g.fillStyle = k ? '#d8342c' : '#2a62b8'; g.fillRect(x, s * 0.05, w, s * 0.9);
      g.fillStyle = '#eef3f6'; g.fillRect(x + w * 0.08, s * 0.12, w * 0.84, s * 0.42);
      for (let r = 0; r < 3; r++) for (let q = 0; q < 5; q++) { g.fillStyle = ['#e2574c', '#f2c14e', '#4f9de0', '#5bbf6a', '#f08a3c'][(q + r) % 5]; g.fillRect(x + w * 0.12 + q * w * 0.16, s * (0.16 + r * 0.13), w * 0.1, s * 0.08); }
      g.fillStyle = '#1b1d22'; g.fillRect(x + w * 0.15, s * 0.72, w * 0.7, s * 0.08);
    }
    mask(3, 5, 0, 0, s, s * 0.6);
  });

  // ---- row 6: tategaki glyph columns (ink in the mask; the shader picks board and ink colours) ----
  for (let i = 0; i < 4; i++) tile(g, i, 6, (s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    const ink = (x, y, w, h) => mask(i, 6, x, y, w, h);
    for (let k = 0; k < 4; k++) {
      const cy = k * s / 4, ch = s / 4, m = 0.12;                 // cell; strokes live in [m, 1-m]^2
      const tw = s * 0.055, th = ch * 0.075;                       // stroke widths (the cell is drawn 4:1 squashed)
      // radical p drawn into the sub-box (bx, by, bw, bh) of the cell, all in cell fractions
      const rad = (p, bx, by, bw, bh) => {
        const X = (f) => s * (m + (bx + f * bw) * (1 - 2 * m)), Y = (f) => cy + ch * (m + (by + f * bh) * (1 - 2 * m));
        const H = (y, a = 0, b = 1) => ink(X(a), Y(y) - th / 2, X(b) - X(a), th);
        const V = (x, a = 0, b = 1) => ink(X(x) - tw / 2, Y(a), tw, Y(b) - Y(a));
        if (p === 0) { H(0.05); H(0.5); H(0.95); V(0.5); }                                   // 王
        else if (p === 1) { V(0.05); V(0.95); H(0.05); H(0.95); H(0.5, 0.05, 0.95); }       // 日
        else if (p === 2) { H(0.3); V(0.5); V(0.2, 0.5, 1); V(0.8, 0.5, 1); }               // 木-ish
        else if (p === 3) { V(0.05); V(0.95); H(0.05); H(0.95); }                           // 口
        else if (p === 4) { H(0.2, 0.2, 0.8); H(0.55); V(0.35, 0.55, 1); V(0.65, 0.55, 1); } // 六
        else if (p === 5) { V(0.15); V(0.5); V(0.85); }                                     // 川
        else if (p === 6) { H(0.1, 0, 0.7); V(0.35, 0.1, 1); H(0.6, 0.4, 1); V(0.8, 0.3, 0.95); }   // katakana-ish
        else if (p === 7) { H(0.5); V(0.5, 0, 0.45); ink(X(0.1), Y(0.7), tw * 1.3, th * 2.2); ink(X(0.85), Y(0.7), tw * 1.3, th * 2.2); }   // 小
        else if (p === 8) { H(0.1); H(0.9); V(0.5, 0.1, 0.9); H(0.5, 0.2, 0.8); }          // 工/土
        else { V(0.1); H(0.1, 0.1, 1); H(0.5, 0.1, 0.8); H(0.9, 0.1, 1); }                  // ヨ/己-ish
      };
      const kind = R();
      if (kind < 0.35) rad(Math.floor(R() * 10), 0, 0, 1, 1);                                // one radical (kana-like)
      else if (kind < 0.75) { rad(Math.floor(R() * 10), 0, 0, 0.42, 1); rad(Math.floor(R() * 10), 0.52, 0, 0.48, 1); }   // left + right
      else { rad(Math.floor(R() * 10), 0, 0, 1, 0.42); rad(Math.floor(R() * 10), 0, 0.52, 1, 0.48); }                    // top + bottom
    }
  });

  // ---- row 7: mid-band roof strips (round R): one 30 m x 16 m row of four houses seen from above, x across the
  // tile, z down it (north at the top). rgb = roof albedo, alpha = how much it replaces the row's vertex roof colour.
  // Sun from the south-west: baked shadows fall to the north-east (right and up).
  const RW = ['#8c4533', '#4d6180', '#4f5259', '#4d735c', '#6e5038', '#34507a', '#9a3c31', '#5e6670'];
  const MEM = ['#4f8a6e', '#3f8c84', '#8d918c', '#4a6f9a', '#6a8f5a', '#b8b4a8'];
  const shadeHex = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
  const amask = (i, x, y, w, h, a) => { gm.fillStyle = grey(Math.round(a * 255)); gm.fillRect(i * T + PAD + x, 7 * T + PAD + y, w, h); };
  for (let i = 0; i < 4; i++) tile(g, i, 7, (s) => {
    const villa = i >= 2, mz = s / 16;                   // px per metre along z (16 m)
    // house widths: 6.5..8.5 m, summing to 30 m
    const ws = [], wr = []; let sum = 0;
    for (let k = 0; k < 4; k++) { const w = 6.5 + R() * 2; ws.push(w); sum += w; }
    let x = 0;
    for (let k = 0; k < 4; k++) { const w = ws[k] * s / sum; wr.push([Math.round(x), Math.round(x + w)]); x += w; }
    // the strip's base: a dark lane gap all round (rows of houses stand back from the edge of the mass)
    g.fillStyle = '#3c3d40'; g.fillRect(-PAD, -PAD, s + 2 * PAD, s + 2 * PAD); amask(i, -PAD, -PAD, s + 2 * PAD, s + 2 * PAD, 0.9);
    for (let k = 0; k < 4; k++) {
      const [x0, x1] = wr[k], w = x1 - x0, y0 = Math.round(mz * (0.4 + R() * 0.8)), y1 = s - Math.round(mz * (0.4 + R() * 0.8));
      const mpx = w / (ws[k]);                             // px per metre along x for this house
      if (!villa && !(i === 1 && (k === 1 || k === 3))) {
        // jutaku: low gable, ridge along x; the south slope (lower half) takes the sun
        const c = RW[Math.floor(R() * RW.length)], ry = Math.round((y0 + y1) / 2 + (R() - 0.5) * mz * 2);
        g.fillStyle = shadeHex(c, 0.74); g.fillRect(x0 + 1, y0, w - 2, ry - y0);               // north slope, in shade
        g.fillStyle = shadeHex(c, 1.08); g.fillRect(x0 + 1, ry, w - 2, y1 - ry);               // south slope, lit
        g.fillStyle = 'rgba(0,0,0,0.10)'; for (let yy = y0 + 4; yy < y1; yy += 6) g.fillRect(x0 + 1, yy, w - 2, 2);   // tile courses
        g.fillStyle = shadeHex(c, 1.3); g.fillRect(x0 + 1, ry - 2, w - 2, 3);                  // ridge cap
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + 1, y1 - 3, w - 2, 3);                // eave line (south)
        amask(i, x0 + 1, y0, w - 2, y1 - y0, 0.82);
      } else {
        // flat roof: membrane with a light parapet, a stair hut, a water tank and AC units, shadows to the NE
        const c = villa ? MEM[Math.floor(R() * MEM.length)] : ['#8d918c', '#7d8186', '#a7a59c'][Math.floor(R() * 3)];
        g.fillStyle = shadeHex(c, 1.0); g.fillRect(x0 + 1, y0, w - 2, y1 - y0);
        g.fillStyle = 'rgba(0,0,0,0.08)'; for (let yy = y0 + 10; yy < y1; yy += 22) g.fillRect(x0 + 1, yy, w - 2, 2);   // membrane seams
        g.fillStyle = '#d9d6ce'; g.fillRect(x0 + 1, y0, w - 2, 3); g.fillRect(x0 + 1, y1 - 3, w - 2, 3); g.fillRect(x0 + 1, y0, 2, y1 - y0); g.fillRect(x1 - 3, y0, 2, y1 - y0);   // parapet coping
        const sh = (bx, by, bw, bh, len) => {                // shadow to the NE: right and up
          g.fillStyle = 'rgba(16,18,24,0.7)';
          g.beginPath(); g.moveTo(bx + bw, by + bh); g.lineTo(bx + bw + len * 0.6, by + bh - len); g.lineTo(bx + bw + len * 0.6, by - len); g.lineTo(bx + len * 0.6, by - len); g.lineTo(bx, by); g.lineTo(bx + bw, by); g.closePath(); g.fill();
        };
        // stair hut 3.2 x 4.6 m, on the south or north half
        const hw = Math.round(3.2 * mpx), hh = Math.round(4.6 * mz), hx = x0 + Math.round(mpx * (0.7 + R() * (ws[k] - 4.9))), hy = R() < 0.5 ? y0 + Math.round(mz * 2.5) : y1 - hh - Math.round(mz * 2.5);
        sh(hx, hy, hw, hh, mz * 2.6);
        g.fillStyle = '#f2efe8'; g.fillRect(hx, hy, hw, hh);
        g.fillStyle = '#b7b2a6'; g.fillRect(hx, hy, hw, Math.round(hh * 0.3));                // its roof slab, north edge darker
        g.fillStyle = '#f0ede6'; g.fillRect(hx, hy + hh - 3, hw, 3);
        // water tank: a round tank (Korean villas: stainless or blue / yellow fibreglass)
        const tr = Math.round(1.3 * mz), tx = x0 + (hx - x0 > w / 2 ? Math.round(w * 0.28) : Math.round(w * 0.7)), ty = hy < s / 2 ? y1 - Math.round(mz * 3.5) : y0 + Math.round(mz * 3.5);
        g.fillStyle = 'rgba(20,24,30,0.42)'; g.beginPath(); g.ellipse(tx + tr * 0.7, ty - tr * 0.9, tr * 0.6, tr, 0, 0, 7); g.fill();
        g.fillStyle = ['#cfd3d6', '#3d7fa8', '#d9c27a'][Math.floor(R() * 3)]; g.beginPath(); g.ellipse(tx, ty, tr * 0.6, tr, 0, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(tx - tr * 0.15, ty + tr * 0.2, tr * 0.25, tr * 0.4, 0, 0, 7); g.fill();
        // two AC units
        for (let q = 0; q < 2; q++) {
          const ax = x0 + Math.round(w * (0.2 + 0.5 * R())), ay = y0 + Math.round((y1 - y0) * (0.2 + 0.6 * R())), aw = Math.round(0.9 * mpx), ah = Math.round(0.6 * mz);
          sh(ax, ay, aw, ah, mz * 0.6);
          g.fillStyle = '#ecebe6'; g.fillRect(ax, ay, aw, ah);
        }
        amask(i, x0 + 1, y0, w - 2, y1 - y0, villa ? 0.85 : 0.75);
        amask(i, hx - 2, hy - Math.round(mz * 2.7), hw + Math.round(mz * 1.7) + 4, hh + Math.round(mz * 2.7) + 2, 1);   // hut + shadow: fully baked
        amask(i, tx - tr - 2, ty - tr * 2 - 2, tr * 2.4 + 4, tr * 3 + 4, 1);
      }
      g.fillStyle = 'rgba(15,16,18,0.65)'; g.fillRect(x1 - 1, 0, 2, s); amask(i, x1 - 1, 0, 2, s, 1);   // party line
    }
  });

  // combine: rgb from c, alpha from the glass mask
  const img = g.getImageData(0, 0, ATLAS_SIZE, ATLAS_H), al = gm.getImageData(0, 0, ATLAS_SIZE, ATLAS_H).data, d = img.data;
  for (let p = 3; p < d.length; p += 4) d[p] = al[p - 3];
  return img;
}

// aniso: desktops only (round N: on the phone preset anisotropic filtering was most of the atlas's fill cost)
// Boot (round P): the texture starts as a 1x1 neutral texel and the atlas is painted in a worker
// (OffscreenCanvas), off the main thread; fillAtlas uploads it when it arrives (61 ms saved at boot).
export function atlasTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([140, 146, 152, 90]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return tex;
}
export function fillAtlas(gl, tex, data, aniso = true) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ATLAS_SIZE, ATLAS_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const an = gl.getExtension('EXT_texture_filter_anisotropic');
  if (an && aniso) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
}
export function uploadAtlas(gl, aniso = true) {
  const img = buildAtlas();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ATLAS_SIZE, ATLAS_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const an = gl.getExtension('EXT_texture_filter_anisotropic');
  if (an && aniso) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return tex;
}
