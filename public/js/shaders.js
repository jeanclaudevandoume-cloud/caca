// GLSL. Per-block facts (kind, zone, inhabited, avenues, roof colours) come to the ground
// shader in a data texture built by layout.js (buildGround). What the shader still mirrors by
// hand: hash3 (per-slot roof pick), riverZ/isRiver, bayHalf/bayAt/portLane (outside the
// texture), plot layout and the ROOF palette. Change one, change the other.

const COMMON = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uSkyCol, uGndCol, uFogCol, uSkyTop, uSkyHor;
uniform float uFogD, uNight, uTime, uLowQ;
uniform vec3 uCam;
// ACES filmic fit: rich mid-tones, highlights roll off instead of clipping to neon
vec3 tone(vec3 x) {
  x = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return clamp(mix(vec3(dot(x, vec3(0.3, 0.59, 0.11))), x, 1.08), 0.0, 1.0);   // keep it vibrant after the curve
}
vec3 fogMix(vec3 col, vec3 dir, float dist) {
  float f = 1.0 - exp(-pow(dist / (uFogD * 1.4), 1.6));
  float s = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  vec3 fc = uFogCol + uSunCol * s * 0.25 * (1.0 - uNight);
  // aerial perspective (round L): from a few hundred metres on, colours lose saturation and drift toward the
  // haze, so near homes, the roofscape and the towers separate into planes instead of one flat sheet
  float a = (1.0 - exp(-dist / 1500.0)) * 0.42 * (1.0 - 0.7 * uNight);
  col = mix(col, mix(vec3(dot(col, vec3(0.3, 0.55, 0.15))), fc, 0.6), a);
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
`;

export const GEO_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec3 aN;
layout(location=3) in float aMat;
layout(location=4) in vec4 aCol;
uniform mat4 uVP;
uniform vec3 uOrigin, uCam, uLodCam;   // uLodCam: where LOD distances are measured from (= uCam; poptest.cjs holds it one step back)
uniform vec4 uLod;   // x fade start, y fade end, z mode (0 chunk, 1 skyline), w scale (0 = 1)
uniform float uTime;
out vec3 vW; out vec3 vN; out vec2 vUV; out vec4 vCol; flat out int vMat;
void main() {
  vec3 p = aPos / 64.0 * (uLod.w > 0.0 ? uLod.w : 1.0) + uOrigin;
  int mi = int(aMat + 0.5);
  bool tall = (mi & 8) != 0;
  int mat = mi & 7;
  float d = length(p - uLodCam);
  // tall buildings hand over to the skyline per chunk (same chunk grid as main.js), so every
  // vertex of a building makes the same decision and no slivers appear
  vec2 cc = floor((p.xz + 24.0) / 192.0) * 192.0 + 72.0;
  float dc = length(vec3(cc.x, 0.0, cc.y) - uLodCam);
  // homes sink / mid-band masses grow by their BLOCK's distance, not the vertex's: a 30 m mass scaled per vertex
  // had a sloping roof inside the fade band (round R)
  vec2 bk = floor((p.xz + 24.0) / 48.0) * 48.0;
  d = length(vec3(bk.x, 0.0, bk.y) - uLodCam);
  if (uLod.z < 0.5) {
    if (tall) { if (dc > uLod.x) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; } }
    else p.y *= 1.0 - smoothstep(uLod.x, uLod.y, d);
  } else if (dc <= uLod.x) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  else if (!tall) p.y *= smoothstep(uLod.x, uLod.y, d);     // mid-band massing grows in as the homes shrink
  if (mat == 2 && p.y > 2.0) p.xz += sin(uTime * 1.3 + p.x * 0.11 + p.z * 0.07) * 0.06 * (p.y - 2.0) / 6.0;
  vW = p; vN = aN; vUV = aUV; vCol = aCol; vMat = mat;
  gl_Position = uVP * vec4(p, 1.0);
}`;

export const GEO_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${COMMON}
in vec3 vW; in vec3 vN; in vec2 vUV; in vec4 vCol; flat in int vMat;
out vec4 o;
uint ih(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
// Window layout shared by the phone and the full material path, so switching presets never changes windows:
// one window type per house (ordered rows), rarely a blank cell.
void winLayout(uint seed, uint cell, float glass, uint style, vec2 g, vec3 n, out uint wt, out float has, out float mx, out float my0, out float my1) {
  mx = mix(0.25, 0.06, glass); my0 = mix(0.3, 0.1, glass); my1 = mix(0.8, 0.94, glass); has = 1.0; wt = 0u;
  if (glass < 0.5 && style != 3u) {
    int ix = int(floor(g.x)), fl = int(floor(g.y));
    bool sideWall = abs(n.x) > 0.5;                       // homes face the +-z streets: x-facing walls are side walls
    if (sideWall) { wt = 2u; has = float(((cell >> 16u) & 3u) == 0u); }                   // mostly blank, a small window
    else if (fl <= 0) { wt = ((ix + int(seed)) & 1) == 0 ? 0u : 2u; }                       // ground: wide sliding + small
    else { wt = (ix + int(seed >> 2u)) % 3 == 0 ? 3u : 0u; has = float(((cell >> 16u) & 7u) != 0u); }   // upper: balcony doors + sashes
    if (wt <= 1u) { mx = 0.16; my0 = 0.36; my1 = 0.78; }        // horizontal sliding sash
    else if (wt == 2u) { mx = 0.36; my0 = 0.56; my1 = 0.82; }   // small (frosted) window
    else { mx = 0.14; my0 = 0.04; my1 = 0.80; }                 // full-height balcony door
  }
}
// Facade atlas (atlas.js): 4x4 tiles, row 0 sliding sashes, row 1 frosted (0-1) and balcony doors (2-3).
// The whole window opening (frame, reveal, glass, curtains, sill) comes from one mipmapped fetch, so far
// windows average out instead of shimmering, and the phone gets the same windows as the desktop.
uniform sampler2D uAtlas;
vec4 winTex(uint wt, uint cell, vec2 uvw, vec2 gx, vec2 gy, bool plain) {
  vec2 t = wt == 2u ? vec2(float((cell >> 6u) & 1u), 1.0) : wt == 3u ? vec2(2.0 + float((cell >> 7u) & 1u), 1.0) : vec2(float((cell >> 4u) & 3u), 0.0);
  const float P = 6.0 / 256.0;
  vec2 uv = (t + P + clamp(vec2(uvw.x, 1.0 - uvw.y), 0.0, 1.0) * (1.0 - 2.0 * P)) * vec2(0.25, 0.125);   // 4 x 8 tiles
  return plain ? texture(uAtlas, uv) : textureGrad(uAtlas, uv, gx, gy);
}
// paint the window opening [r0, r1] (cell units) of a residential cell from the atlas
void atlasWindow(inout vec3 col, inout vec3 emis, vec2 f, vec2 g, vec2 r0, vec2 r1, float has, uint wt, uint cell, vec3 n, vec3 amb, vec3 key, vec3 refl, float lit, vec3 warm) {
  vec2 w = fwidth(g);
  // rain streaks: grime washed down from each sill, fading over a storey (round M)
  float sx = smoothstep(r0.x - w.x, r0.x + 0.1, f.x) * (1.0 - smoothstep(r1.x - 0.1, r1.x + w.x, f.x));
  if (f.y < r0.y) {
    float streak = sx * (1.0 - smoothstep(0.0, r0.y + 0.3, r0.y - f.y)) * has * (0.55 + 0.45 * fract(sin(floor(f.x * 9.0) * 12.9 + float(cell & 63u)) * 437.5));
    col *= 1.0 - 0.16 * streak * (1.0 - uNight);
  }
  vec2 inr = smoothstep(r0 - w, r0 + w, f) * (1.0 - smoothstep(r1 - w, r1 + w, f));
  float inW = inr.x * inr.y * has;
  if (inW <= 0.0) { emis = vec3(0.0); return; }        // wall between windows: no fetch (round N: most of the atlas cost)
  vec2 sz = r1 - r0;
#ifdef LOWQ
  vec4 at = winTex(wt, cell, (f - r0) / sz, vec2(0.0), vec2(0.0), true);   // phone: plain lookup, hardware derivatives
#else
  vec2 sc = (1.0 - 2.0 * 6.0 / 256.0) * vec2(0.25, 0.125) / sz;
  vec4 at = winTex(wt, cell, (f - r0) / sz, dFdx(g) * sc * vec2(1.0, -1.0), dFdy(g) * sc * vec2(1.0, -1.0), false);
#endif
  vec3 lightW = amb * 0.95 + key * max(dot(n, uSunDir), 0.0) * 0.85;
  vec3 wc = at.rgb * lightW;
  wc = mix(wc, wc * 0.55 + refl * 0.55, at.a * 0.4 * (1.0 - uNight));      // the sky in the glass
  wc *= mix(1.0, 0.35, at.a * uNight);                                        // dark glass at night
  col = mix(col, wc, inW);
  // lit rooms: mostly warm, many cool-white fluorescent (very Tokyo), a few deep orange; brighter under the ceiling,
  // and the curtain/blind pattern of the atlas tints the light so lit windows are not flat stickers
  uint tc = (cell >> 20u) % 20u;
  vec3 lc = tc < 11u ? warm : tc < 18u ? vec3(0.8, 0.9, 1.05) : vec3(1.0, 0.5, 0.26);
  float gy = clamp((f.y - r0.y) / max(r1.y - r0.y, 1e-3), 0.0, 1.0);
  emis = lc * (0.65 + 0.55 * gy) * mix(vec3(1.0), at.rgb * 1.5, 0.45) * lit * at.a * inW * smoothstep(0.05, 0.6, uNight) * 1.4;
}
void main() {
  vec3 n = normalize(vN);
  vec3 base = vCol.rgb;
  vec3 V = vW - uCam; float dist = length(V); vec3 dir = V / dist;
  float sun = max(dot(n, uSunDir), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 amb = mix(uGndCol, uSkyCol, hemi) * vec3(0.96, 0.98, 1.03);          // shade stays neutral (no navy walls)
  amb += uGndCol * 0.45 * (1.0 - abs(n.y)) * (1.0 - step(0.0, dot(n, uSunDir)));   // warm bounce from the street on shaded walls
  float sunset = clamp(1.0 - uSunDir.y * 2.2, 0.0, 1.0) * (1.0 - uNight);
  vec3 key = uSunCol * mix(vec3(1.0), vec3(1.25, 0.95, 0.7), sunset);        // low sun is warm
  // contact + canyon occlusion: walls darken toward the street, tall city walls more so
  float wall = 1.0 - abs(n.y);
  uint sa = uint(vCol.a * 255.0 + 0.5);
  bool city = vMat == 5 || (vMat == 1 && (sa & 3u) == 3u);
  // canyon shade: city walls darken strongly toward the street (no building-on-building shadows otherwise)
  // homes: a contact ramp (0.5 at the ground over the first 1.2 m, a softer one to 3.5 m)
  float ao = mix(1.0, city ? mix(0.45, 1.0, smoothstep(0.0, 30.0, vW.y)) : mix(0.5, 1.0, smoothstep(0.0, 1.2, vW.y)) * mix(0.84, 1.0, smoothstep(1.2, 3.5, vW.y)), wall);
  // homes stand 0.4-1.2 m apart and face the +-z streets: their x-facing side walls sit in a slot the sun and
  // most of the sky can't reach below the neighbour's eaves (round L: those walls used to read fully sunlit)
  float gap = (!city && vMat == 1 && abs(n.x) > 0.5) ? mix(0.62, 1.0, smoothstep(4.0, 8.0, vW.y)) : 1.0;   // softened: corner houses face an open street there
  ao *= gap;
  float avert = mix(1.0, city ? 0.8 : 0.58, wall * step(dot(n, uSunDir), 0.0));             // faces turned from the sun
  float jitter = (vMat == 5 ? 0.62 : city ? 0.85 : 0.74) + (vMat == 5 ? 0.42 : city ? 0.15 : 0.26) * float((sa * 2654435761u) >> 24u) / 255.0;   // towers: dark to light glass   // neighbours separate
  vec3 col = base * jitter * (amb * ao * avert + key * sun * sqrt(ao) * gap);   // occlusion darkens the sunlit side too
  vec3 emis = vec3(0.0);
  uint seedAll = uint(vCol.a * 255.0 + 0.5);
  if (vMat == 1 || vMat == 5) {
    float glass = float(vMat == 5);
    float u = vUV.x / 8.0, v = vUV.y / 4.0;
    float sp = mix(2.6, 1.7, glass);
    vec2 g = vec2(u / sp, v);
    vec2 f = fract(g);
    vec2 w = fwidth(g);
    float k = clamp(mix(1.4, 1.1, uLowQ) - max(w.x, w.y) * mix(1.7, 4.0, uLowQ), 0.0, 1.0);   // fade detail at distance: no moire (earlier on low: no MSAA)
    uint style = glass > 0.5 ? 0u : (seedAll & 3u);
    uint seed = seedAll >> 2;
    float my0Panel = 0.3;
#ifdef LOWQ
    if (k < 0.05) {
      // phone, far walls: the window pattern has faded to its average anyway, so skip all per-window work
      vec3 refl0 = mix(mix(vec3(0.3, 0.36, 0.42), vec3(0.18, 0.22, 0.27), glass), uSkyHor, mix(0.35, 0.15, glass)) * (0.55 + 0.45 * (1.0 - uNight));
      // tower families (homes.js towerMass, facade = seed & 3): light concrete and warm stone keep their wall colour
      // (little glass), bronze glass is tinted; arithmetic selects only, no new branch on the phone shader
      float solid = max(smoothstep(0.32, 0.6, dot(base, vec3(0.3, 0.55, 0.15))), float((seed & 3u) == 2u)) * glass;
      refl0 *= mix(vec3(1.0), vec3(1.12, 0.86, 0.6), float((seed & 3u) == 3u) * glass);
      col = mix(col * mix(1.0, 0.45, glass * uNight) * (1.0 + 0.22 * solid), refl0 * jitter * mix(0.85, 1.15, glass * smoothstep(0.0, 160.0, vW.y)), mix(0.22, 0.75, glass) * (1.0 - 0.62 * solid) * step(0.3, v));
      // floors still read at a kilometre: anti-aliased spandrel lines every floor, a plant band every 8 floors
      float fy = vW.y / 3.2, fwy = fwidth(fy);
      float spand = (1.0 - smoothstep(0.22 - fwy, 0.22 + fwy, fract(fy))) * clamp(1.6 - fwy * 2.2, 0.0, 1.0);
      float plant = smoothstep(0.85 - fwy * 0.125, 0.85 + fwy * 0.125, fract(fy / 8.0));   // top floor of every 8: plant band
      col *= 1.0 - (0.22 * spand + 0.25 * plant * step(20.0, vW.y)) * mix(0.5, 1.0, glass) * (1.0 - uNight);
      float share0 = (18.0 + float(ih(seed * 31u + 7u) % 82u)) * 1.9;
      // lit floors read from across town at dusk: a hashed band per floor and per 3-window group (arithmetic only)
      float bandOn = float(float(ih(uint(int(floor(fy)) + 64) * 7919u + uint(int(floor(g.x / 3.0)) + 4096) * 104729u + seed * 31u) & 255u) < share0 * 1.0);
      float lit0 = mix(share0 / 512.0, bandOn * 0.75, clamp(1.4 - fwy * 1.6, 0.0, 1.0));
      emis = mix(vec3(1.0, 0.76, 0.42), vec3(0.85, 0.9, 1.0), float((seed & 3u) == 1u)) * lit0 * mix(0.35, 0.9, glass) * smoothstep(0.05, 0.6, uNight) * (1.0 - spand * 0.7);
    } else {
      // phone, near walls: one hash, hard-edged frame and pane (MSAA is off on the low preset), no mullions/sills/reveals
      uint face = uint(dot(step(0.5, abs(n)), vec3(1.0, 2.0, 3.0)) + 3.0 * step(0.0, n.x + n.z));
      uint cell = ih(uint(int(floor(g.x)) + 4096) * 7919u + uint(int(floor(g.y)) + 64) * 104729u + seed * 2654435761u + face * 40503u);   // same hash as the high path
      float mx, my0, my1, has; uint wt;
      winLayout(seed, cell, glass, style, g, n, wt, has, mx, my0, my1);
      if (glass < 0.5) col *= mix(0.7, 1.0, smoothstep(0.42, 0.48, vW.y)) * (1.0 - 0.06 * step(0.94, fract(vW.y / 0.45)) * k);   // plinth + cheap panel courses
      vec2 e = vec2(0.07 / sp, 0.022);
      if (glass < 0.5) {
        // homes: the whole window is one atlas fetch (no procedural frame/pane work on the phone)
        float share = (18.0 + float(ih(seed * 31u + 7u) % 82u)) * 1.9;
        float lit = mix(share / 512.0, float(float(cell & 255u) < share), k);
        vec3 refl = mix(vec3(0.3, 0.38, 0.46), uSkyHor, 0.4);
        if (step(0.3, v) > 0.0) atlasWindow(col, emis, f, g, vec2(mx, my0) - e, vec2(1.0 - mx, my1) + e, has, wt, cell, n, amb * ao, key, refl, lit, vec3(1.0, 0.75, 0.42));
      } else {
      float frame = step(mx - e.x, f.x) * step(f.x, 1.0 - mx + e.x) * step(my0 - e.y, f.y) * step(f.y, my1 + e.y) * has * step(0.3, v);
      float pane = step(mx, f.x) * step(f.x, 1.0 - mx) * step(my0, f.y) * step(f.y, my1) * has * step(0.3, v);
      pane = mix(mix(0.22, 0.75, glass), pane, k); frame *= k;
      float fy = clamp((f.y - my0) / (my1 - my0), 0.0, 1.0);
      vec3 refl = mix(vec3(0.15, 0.2, 0.25), mix(vec3(0.49, 0.59, 0.69), uSkyHor, 0.4), mix(0.5, fy, k)) * (1.0 - 0.4 * step(0.88, fy) * k);   // recess shadow
      vec3 sash = glass > 0.5 ? vec3(0.75, 0.78, 0.8) : ((seed & 7u) < 5u ? vec3(0.42, 0.43, 0.44) : vec3(0.86, 0.85, 0.82));
      col = mix(col * mix(1.0, 0.45, glass * uNight), sash * (amb * 0.9 + uSunCol * max(dot(n, uSunDir), 0.0) * 0.8), max(frame - pane, 0.0));
      vec3 sashC = sash * 0.72 * (amb * 0.9 + uSunCol * max(dot(n, uSunDir), 0.0) * 0.8);
      float mullC = (glass < 0.5 && wt <= 1u) ? step(abs(f.x - 0.5), 0.025 / sp) * k : 0.0;   // centre mullion on sliding sashes
      col = mix(col, mix(refl * (0.55 + 0.45 * (1.0 - uNight)), sashC, mullC), pane);
      col *= 1.0 - 0.35 * step(my1 + e.y, f.y) * step(f.y, my1 + 0.07) * has * k * step(0.3, v);   // lintel shadow
      float share = (18.0 + float(ih(seed * 31u + 7u) % 82u)) * 1.9;
      float lit = mix(share / 512.0, float(float(cell & 255u) < share), k);
      emis = vec3(1.0, 0.75, 0.42) * lit * pane * smoothstep(0.05, 0.6, uNight) * 1.5;
      }
#else

    // tower facade type: 0 ribbon glass, 1 vertical fins, 2 stone grid, 3 warm bronze
    uint facade = glass > 0.5 ? (seed & 3u) : 9u;
    // wall surface detail (residential): siding joints, brick courses, plinth, floor bands
    if (glass < 0.5) {
      float kd = clamp(1.2 - fwidth(vW.y) * 6.0, 0.0, 1.0);
      if (style == 1u) col *= 1.0 - 0.10 * step(fract(u / 0.91), 0.035) * clamp(1.2 - fwidth(u) * 6.0, 0.0, 1.0);   // ceramic siding joints
      if (style == 2u) {
        float row = floor(vW.y / 0.3);
        float mort = max(1.0 - smoothstep(0.0, 0.1, fract(vW.y / 0.3)), 1.0 - smoothstep(0.0, 0.06, fract(u / 0.6 + row * 0.5)));
        col = mix(col, col * 0.75 + vec3(0.16, 0.15, 0.14), mort * 0.5 * kd);
        col *= 0.94 + 0.12 * fract(sin(row * 12.9 + floor(u / 0.6 + row * 0.5) * 78.2) * 437.5) * kd;
      }
      if (style == 3u) col *= mix(1.0, 0.88, (1.0 - smoothstep(my0Panel - 0.02, my0Panel, f.y)) * k);   // spandrel panels
      col *= mix(0.7, 1.0, smoothstep(0.42, 0.48, vW.y));                // darker plinth
      col *= 1.0 - 0.1 * smoothstep(0.93, 0.99, f.y) * k;                 // floor line / eave shadow
    }
    if (glass < 0.5 && style != 3u && fwidth(vW.y) < 0.14) {
      // built material on every preset: ALC panel joints (0.45 m courses, 1.8 m panels), corner shade, faded with distance
      float kj = clamp(1.3 - fwidth(vW.y) * 9.0, 0.0, 1.0);
      float jy = 1.0 - smoothstep(0.0, 0.03 + fwidth(vW.y), abs(fract(vW.y / 0.45) - 0.5) * 0.45 - 0.2);
      float jx = 1.0 - smoothstep(0.0, 0.03 + fwidth(u), abs(fract(u / 1.8) - 0.5) * 1.8 - 0.86);
      col *= 1.0 - 0.07 * max(jy, jx) * kj;
      col *= mix(0.84, 1.0, smoothstep(0.0, 0.3, vUV.x / 8.0));          // corner shade at the wall's start edge
    }
    // window opening in the cell (cell units): glass rect, frame band, mullions, sill
    vec2 fw = vec2(0.07 / sp, 0.07 / 3.2);
    uint face = uint(dot(step(0.5, abs(n)), vec3(1.0, 2.0, 3.0)) + 3.0 * step(0.0, n.x + n.z));
    uint cell = ih(uint(int(floor(g.x)) + 4096) * 7919u + uint(int(floor(g.y)) + 64) * 104729u + seed * 2654435761u + face * 40503u);
    float mx, my0, my1, has; uint wt;
    winLayout(seed, cell, glass, style, g, n, wt, has, mx, my0, my1);
    if (facade == 1u) { mx = 0.16; my0 = 0.02; my1 = 0.98; }            // fins: tall slots between dark mullions
    if (facade == 2u) { mx = 0.22; my0 = 0.25; my1 = 0.8; }             // stone grid: punched windows
    #define RECT(lo, hi) (smoothstep(lo.x - w.x, lo.x + w.x, f.x) * (1.0 - smoothstep(hi.x - w.x, hi.x + w.x, f.x)) * smoothstep(lo.y - w.y, lo.y + w.y, f.y) * (1.0 - smoothstep(hi.y - w.y, hi.y + w.y, f.y)))
    vec2 glo = vec2(mx, my0), ghi = vec2(1.0 - mx, my1);
    float frame = RECT((glo - fw), (ghi + fw)) * has;
    float pane = RECT(glo, ghi) * has;
    float shutter = glass < 0.5 && style != 3u ? RECT(vec2(mx - fw.x, my1 + fw.y), vec2(1.0 - mx + fw.x, my1 + fw.y + 0.22 / 3.2)) * has * float(wt <= 1u) : 0.0;
    float fy = mix(0.5, clamp((f.y - my0) / (my1 - my0), 0.0, 1.0), k);   // per-floor gradient fades out with the pattern (no stripes far away)
    // a single vertical mullion (sliding sash) — no cross bars; sills only on brick
    float mull = glass > 0.5 || wt == 2u ? 0.0 : 1.0 - smoothstep(0.025 / sp, 0.025 / sp + w.x, abs(f.x - 0.5));
    float sill = glass > 0.5 || style != 2u ? 0.0 : RECT(vec2(mx - 0.05 / sp, my0 - 0.08 / 3.2 - fw.y), vec2(1.0 - mx + 0.05 / sp, my0 - fw.y)) * has;
    float avgWin = mix(0.22, 0.75, glass);
    pane = mix(avgWin, pane, k) * step(0.3, v);
    frame = frame * k * step(0.3, v);
    // glass: dark at the bottom, sky at the top, sun glint; some curtains; lintel shadow
    vec3 refl = mix(vec3(0.15, 0.2, 0.25), mix(vec3(0.49, 0.59, 0.69), uSkyHor, 0.4), fy);
    if (facade == 3u) refl *= vec3(1.05, 0.85, 0.62);                    // bronze glass
    if (facade == 1u) refl *= 0.7;
    refl = mix(refl, uSkyHor * 0.8, glass * 0.3 * (1.0 - abs(dir.y)));
    refl += uSunCol * pow(max(dot(reflect(dir, n), uSunDir), 0.0), 40.0) * mix(0.4, 0.8, glass);
    if (glass < 0.5 && wt == 2u) refl = mix(refl, vec3(0.75, 0.77, 0.78) * (amb + uSunCol * 0.4), 0.8);   // frosted
    // fake reveal: the top and one side of each pane sit in shadow
    refl *= 1.0 - 0.45 * k * max(smoothstep(0.84, 0.9, fy), (1.0 - smoothstep(0.0, 0.14, (f.x - mx) / (1.0 - 2.0 * mx))) * step(0.0, dot(n, uSunDir)));
    if (glass < 0.5 && (cell >> 12u) % 8u == 0u) refl = mix(refl, vec3(0.91, 0.86, 0.78) * 0.8 * (amb + uSunCol * 0.3), step(fy, 0.55) * k);
    refl *= mix(1.0, 0.6, smoothstep(0.86, 0.9, fy) * k);
    float share = (18.0 + float(ih(seed * 31u + 7u) % 82u)) * 1.9;            // 13%..74% of windows lit (evening: people are home)
    float towerGlow = glass > 0.5 ? (0.4 + 0.6 * float(ih(seed * 77u + 3u) & 255u) / 255.0) * 0.9 : 1.0;
    // floor bands stay visible further than single windows, so far towers read striped, not flat
    float kf = clamp(1.8 - fwidth(v) * 1.2, 0.0, 1.0);
    float band = float(float(ih(uint(int(floor(v)) + 64) * 7919u + seed * 31u) & 255u) < share * 1.3) * 0.75 + 0.1;
    float lit = mix(mix(share / 512.0, band * share / 200.0, kf), float(float(cell & 255u) < share), k);
    vec3 warm = mix(vec3(1.0, 0.7, 0.38), vec3(0.8, 0.88, 1.0), float((cell >> 8u & 7u) == 0u) * k);
    vec3 body = mix(col, col * 0.85 + refl * 0.1, glass) * mix(1.0, 0.45, glass * uNight);   // glass towers are dark at night
    if (facade == 1u) body = mix(body, vec3(0.17, 0.2, 0.25) * (amb + key * 0.4), 0.8);   // dark fins
    if (facade == 2u) body = vec3(0.85, 0.8, 0.7) * (amb * ao + key * max(dot(n, uSunDir), 0.0) * 0.85);   // stone
    // aluminium sashes: dark on most houses, light on the rest
    vec3 sash = glass > 0.5 ? vec3(0.75, 0.78, 0.8) : ((seed & 7u) < 5u ? vec3(0.42, 0.43, 0.44) : vec3(0.86, 0.85, 0.82));
    vec3 frameC = sash * (amb * 0.9 + uSunCol * max(dot(n, uSunDir), 0.0) * 0.8);
    col = mix(body, frameC, max(frame - pane, sill * k));
    col = mix(col, frameC * 0.8, shutter * k);
    vec3 paneC = mix(refl * (0.55 + 0.45 * (1.0 - uNight)), frameC, mull * k);
    col = mix(col, paneC, pane * (0.9 + 0.1 * glass));
    if (glass > 0.5) col = mix(col, col * 0.75 + refl * 0.25, 1.0 - pane);
    if (glass > 0.5) col *= 1.0 - 0.35 * step(fract((v + float((seed >> 3) % 8u) + 3.0) / 8.0), 0.125) * clamp(1.4 - fwidth(v) * 0.6, 0.0, 1.0);   // mechanical floor every 8 storeys, offset per tower (no city-wide line)
    // far away the windows merge, so the glow stays a little brighter and whiter to stay readable
    emis = mix(vec3(1.0, 0.78, 0.45), warm, k) * lit * pane * (1.0 - mull * k) * smoothstep(0.05, 0.6, uNight) * mix(1.0 * towerGlow, 1.05, k) * mix(1.0, 1.25 - 0.45 * fy, k);
    if (glass < 0.5 && facade == 9u && k > 0.05 && step(0.3, v) > 0.0) atlasWindow(col, emis, f, g, glo - fw, ghi + fw, has, wt, cell, n, amb * ao, key, refl, lit, warm);
#endif
#ifdef LOWQ
    }
#endif
  } else if (vMat == 0 && vN.y > 0.9 && (sa == 250u || sa == 246u)) {
    // mid-band roofs (round R): one 30 m mass per row of homes reads as four houses from one atlas fetch (row 7:
    // per-house roofs, party lines, ridges, stair huts / tanks with baked shadows). u = 2 * tile + x fraction, v = z.
    float u = vUV.x / 8.0, t = floor(u * 0.5);
    vec2 lq = vec2(clamp(u - 2.0 * t, 0.0, 1.0), vUV.y / 4.0);
    const float P = 6.0 / 256.0;
    vec2 uv = (vec2(t, 7.0) + P + lq * (1.0 - 2.0 * P)) * vec2(0.25, 0.125);
    // the band is seen at a grazing angle (16 m of depth in a few pixels): the mip level follows the x footprint
    // and a sixth of the z one (a cheap 6:1 anisotropy), so the four houses keep their own colours
    vec2 sc = (1.0 - 2.0 * P) * vec2(0.25, 0.125 / 6.0);
    vec4 rt = textureGrad(uAtlas, uv, dFdx(lq) * sc, dFdy(lq) * sc);
    col = mix(col, rt.rgb * (dot(col, vec3(0.333)) / max(dot(base, vec3(0.333)), 0.02)), rt.a);
  } else if (vMat == 7 && (uint(vCol.a * 255.0 + 0.5) & 3u) == 3u) {
    // flat roofs (round M): membrane / asphalt / pavers / stained membrane from atlas row 4, 4 m a tile
    uint t = (uint(vCol.a * 255.0 + 0.5) >> 2u) & 3u;
    vec2 q = vW.xz / 4.0;
    const float P = 6.0 / 256.0;
    vec2 uv = (vec2(float(t), 4.0) + P + fract(q) * (1.0 - 2.0 * P)) * vec2(0.25, 0.125);
    vec2 sc = (1.0 - 2.0 * P) * vec2(0.25, 0.125);
    vec2 fq = fwidth(q);
    // far roofs: the tile has averaged out, skip the fetch (its mean x 1.75 ~ 0.96)
    col *= max(fq.x, fq.y) < 0.2 ? textureGrad(uAtlas, uv, dFdx(q) * sc, dFdy(q) * sc).rgb * 1.75 : vec3(0.96);
  } else if (vMat == 7) {
    // roof tiles: courses along the slope, darker eaves, faded with distance
    float kt = clamp(1.2 - fwidth(vW.y) * 5.0, 0.0, 1.0);
    if ((uint(vCol.a * 255.0 + 0.5) & 2u) != 0u) col *= 1.0 - 0.2 * step(0.88, fract(dot(vW.xz, vec2(1.0, 0.0)) / 0.45)) * kt;   // metal: standing seams
    else col *= 1.0 - 0.15 * (1.0 - smoothstep(0.0, 0.25, fract(vW.y / 0.16))) * kt;                                  // tile courses
    col *= 0.92 + 0.08 * fract(sin(dot(floor(vW.xz * 1.6), vec2(12.9, 78.2))) * 437.5) * kt;
  } else if (vMat == 2) {
    col += base * 0.18 * sun;                                             // leaves glow a bit in the sun
  } else if (vMat == 4 && uint(vCol.a * 255.0 + 0.5) == 255u) {
    // shopfronts (round M): atlas row 5; u carries the tile (k..k+1), v the height (0..1)
    float u = vUV.x / 8.0, v = vUV.y / 4.0;
    const float P = 6.0 / 256.0;
    vec2 uv = (vec2(floor(u), 5.0) + P + vec2(fract(u), 1.0 - clamp(v, 0.0, 1.0)) * (1.0 - 2.0 * P)) * vec2(0.25, 0.125);
    vec4 sf = textureGrad(uAtlas, uv, dFdx(vec2(u, -v)) * (1.0 - 2.0 * P) * vec2(0.25, 0.125), dFdy(vec2(u, -v)) * (1.0 - 2.0 * P) * vec2(0.25, 0.125));
    col = sf.rgb * (amb * 0.8 + 0.35 + key * max(dot(n, uSunDir), 0.0) * 0.4);   // interiors are lit from inside
    emis = sf.rgb * sf.a * (0.25 + 1.7 * uNight);
  } else if (vMat == 4) {
    // pale lamps and lanterns look like frosted glass by day; coloured lights (pin, signs) keep their colour
    float sat = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
    float pale = smoothstep(0.7, 0.8, dot(base, vec3(0.3, 0.5, 0.2))) * (1.0 - smoothstep(0.25, 0.4, sat));
    uint sa4 = uint(vCol.a * 255.0 + 0.5);
    if (sa4 == 253u || sa4 == 254u) {                  // kanban (round Q): a tategaki glyph column from atlas row 6
      float u = vUV.x / 8.0, v = vUV.y / 4.0;
      const float P = 6.0 / 256.0;
      vec2 sc = (1.0 - 2.0 * P) * vec2(0.25, 0.125);
      vec2 uv = (vec2(mod(floor(u), 4.0), 6.0) + P + vec2(fract(u), 1.0 - fract(v)) * (1.0 - 2.0 * P)) * vec2(0.25, 0.125);
      float ink = textureGrad(uAtlas, uv, dFdx(vec2(u, -v)) * sc, dFdy(vec2(u, -v)) * sc).a;
      bool rev = sa4 == 253u;                          // pale board with coloured ink, or coloured board with white ink
      vec3 board = rev ? vec3(0.95, 0.94, 0.9) : base, inkC = rev ? base * 0.75 : vec3(1.0);
      base = mix(board, inkC, ink * 0.9);
      sat = rev ? 0.35 : sat;                          // a pale board still reads as a sign, not a lamp
      pale = 0.0;
    }
      col = mix(base, vec3(0.92, 0.93, 0.95), (1.0 - uNight) * pale) * mix(1.0, 0.65, pale) * mix(1.0, 0.8, sat);
    emis = mix(base * vec3(1.0, 0.85, 0.6) * 1.4, base * base * 1.8, smoothstep(0.2, 0.5, sat)) * uNight;   // saturated signs burn like neon
  } else if (vMat == 3) {
    col += uSunCol * pow(max(dot(reflect(dir, n), uSunDir), 0.0), 24.0) * 0.35;
  } else if (vMat == 6) {
    col = mix(base, uSkyHor, 0.35) + uSunCol * pow(max(dot(reflect(dir, n), uSunDir), 0.0), 60.0);
  }
  // warm rim on edges turned toward a low sun keeps shapes readable at sunset
#ifdef LOWQ
  float rim = 0.0;
#else
  float rim = pow(1.0 - abs(dot(n, dir)), 3.0) * max(dot(n, uSunDir) + 0.2, 0.0) * (1.0 - uSunDir.y) * (1.0 - uNight) * float(vMat != 5);
#endif
  col += uSunCol * rim * 0.22;
  col += uSkyHor * base * 0.35 * uNight * smoothstep(0.5, 0.95, n.y);   // roofs catch the glow of the dusk sky
  col = col * (1.0 - 0.5 * uNight) + emis;
  o = vec4(tone(fogMix(col, dir, dist * mix(1.0, mix(0.6, 0.35, uLowQ), smoothstep(40.0, 200.0, vW.y)))), 1.0);   // tall towers keep contrast
}`;

export const SHADOW_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=3) in float aMat;
uniform mat4 uVP;
uniform vec3 uOrigin, uCam, uShadowDir;
out float vD;
void main() {
  vec3 p = aPos / 64.0 + uOrigin;
  p.xz -= uShadowDir.xz * (p.y / uShadowDir.y);
  p.y = 0.04;
  vD = length(p.xz - uCam.xz);
  gl_Position = uVP * vec4(p, 1.0);
}`;

export const SHADOW_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform vec3 uShadowCol;
uniform float uShadowFar;
in float vD;
out vec4 o;
void main() { o = vec4(mix(uShadowCol, vec3(1.0), smoothstep(uShadowFar * 0.6, uShadowFar, vD)), 1.0); }`;

// Upsample of the half-resolution ground/sky pass (low quality): fills only depth == 1 pixels.
export const COPY_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vNdc;
out vec4 o;
void main() { o = texture(uTex, vNdc * 0.5 + 0.5); }`;

export const FULL_VS = /* glsl */ `#version 300 es
precision highp float;
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 1.0, 1.0);
}`;


export const FULL_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
${COMMON}
uniform mat4 uInvVP;
uniform usampler2D uGround;   // per-block data from town.buildGround
uniform vec4 uTown;   // x townD2, y ground texture size, z seaX, w seaBx
uniform vec2 uGroundO;   // the block at texel (0, 0) of the ground window
uniform float uPx, uClouds;
uniform vec4 uFar;    // x roof fade start, y roof fade end, z quality (0 low, 1 high), w shadow len
in vec2 vNdc;
out vec4 o;

uint hash3(int a, int b, int c) {
  uint h = (uint(a) * 0x27d4eb2du) ^ (uint(b) * 0x165667b1u) ^ (uint(c) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return h ^ (h >> 16u);
}
int fdiv(int a, int b) { return a >= 0 ? a / b : -((-a + b - 1) / b); }
int imod(int a, int b) { return a - b * fdiv(a, b); }
// round(6 sin) reproduces town.js RIV exactly (no value within 0.08 of a .5 tie), without a const array
// (dynamically indexed const arrays are fragile on some mobile drivers)
int riverZ(int bx) { return 9 + int(floor(6.0 * sin(6.2831853 * float(imod(bx, 48)) / 48.0) + 0.5)); }
bool isRiver(int bx, int bz) { int a = riverZ(bx), b = riverZ(bx + 1); return (bz >= a - 1 && bz <= a + 1) || (bz >= b - 1 && bz <= b + 1); }
int bayHalf(int bx) { return min(3 + fdiv((bx - 24) * 3, 4), 18); }
bool bayAt(int bx, int bz) { return bx >= 24 && bz >= 2 - bayHalf(bx) && bz <= 2 + bayHalf(bx); }
bool portAt(int bx, int bz) { if (bx < 25 || bx > 40) return false; int e = 1 - bayHalf(bx) - bz; return e >= 0 && e <= 2; }

// K: 0 HOMES 1 PLAZA 2 PARK 3 LAKE 4 RIVER 5 AVENUE 6 COUNTRY 7 HIGHWAY 8 PORT 9 SEA
uvec4 cellAt(int bx, int bz) {
  ivec2 q = ivec2(bx, bz) - ivec2(uGroundO);
  int S = int(uTown.y);
  if (q.x >= 0 && q.y >= 0 && q.x < S && q.y < S) return texelFetch(uGround, q, 0);
  uint k = bx >= int(uTown.w) || bayAt(bx, bz) ? 9u : portAt(bx, bz) ? 8u : isRiver(bx, bz) ? 4u : (bx == 0 || bz == 0) ? 7u : 6u;
  return uvec4(k, 0u, 0u, 0u);
}
bool isWater(uint k) { return k == 3u || k == 4u || k == 9u; }
bool countryish(uint k) { return k == 6u || k == 8u || isWater(k); }

uniform vec3 uRoof[8];   // set from recipe.js ROOF (no hand-copied palette)

uint h2(ivec2 p) { uint h = uint(p.x) * 0x8da6b343u ^ uint(p.y) * 0xd8163841u; h ^= h >> 13u; h *= 0x5bd1e995u; return h ^ (h >> 15u); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = float(h2(c) & 1023u), b = float(h2(c + ivec2(1, 0)) & 1023u), d = float(h2(c + ivec2(0, 1)) & 1023u), e = float(h2(c + ivec2(1, 1)) & 1023u);
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y) / 1023.0;
}

vec3 water(vec2 p, vec3 dir, float t, vec3 deep) {
  float w = 0.0;
  if (uFar.z > 0.5 && t < 1500.0) w = (sin(p.x * 0.21 + uTime * 0.9 + sin(p.y * 0.13)) + sin(p.y * 0.17 - uTime * 0.7)) * 0.5;
  vec3 n = normalize(vec3(w * 0.05, 1.0, w * 0.04));
  float fres = pow(1.0 - max(-dir.y, 0.0), 4.0);
  vec3 c = mix(deep, uSkyHor * 0.95, 0.08 + 0.5 * fres);
  vec3 r = reflect(dir, n);
  c += uSunCol * pow(max(dot(r, uSunDir), 0.0), 220.0) * 1.6 * (1.0 - uNight * 0.7);
  return c;
}
vec3 asphalt(vec2 q, float t) {
  return vec3(0.33, 0.35, 0.39) + (uFar.z > 0.5 && t < 300.0 ? (vnoise(q * 1.7) - 0.5) * 0.03 : 0.0);
}
// Distance from the river's smooth centreline (the block-wise river is a staircase; the water
// inside it is drawn as a smooth band, the rest of the river blocks become embankment parks).
float riverDist(vec2 p) {
  return abs(p.y - (9.0 + 6.0 * sin(6.2831853 * (p.x / 48.0 + 0.5) / 48.0)) * 48.0);
}
vec2 cover(vec2 x, vec2 h, float w) { return max(min(x + w * 0.5, h) - max(x - w * 0.5, -h), 0.0) / w; }

const vec3 WALK = vec3(0.64, 0.63, 0.60);
const vec3 RIVERC = vec3(0.07, 0.24, 0.30);

// River block or river crossing: smooth water band with stone edges and grassy banks.
float bayE(vec2 p) {
  float u = p.x / 48.0;
  return u < 23.5 ? -1e9 : ((min(3.0 + (u - 24.0) * 0.75, 18.0) - 0.45) - abs(p.y / 48.0 - 2.0)) * 48.0;
}
vec4 riverCol(vec2 p, vec3 dir, float t, float w, vec3 grass) {
  float rd = min(riverDist(p), 44.0 - bayE(p));
  if (rd < 44.0) return vec4(water(p, dir, t, RIVERC), 1.0);
  if (rd < 47.0) return vec4(0.74, 0.72, 0.68, 0.0);
  float path = step(abs(rd - 54.0), 1.4) * (1.0 - smoothstep(0.5, 2.5, w));
  return vec4(mix(grass * 1.04, vec3(0.86, 0.79, 0.62), path), 0.0);
}

// Bay: smooth shoreline inside the stepped bay blocks (straight quay walls along the port).
vec4 bayCol(vec2 p, vec3 dir, float t, float w, vec3 grass) {
  float u = p.x / 48.0;
  bool port = u > 24.5 && u < 40.5 && p.y < 96.0;
  float e = port ? 1.0 : max(bayE(p), 44.0 - riverDist(p));     // metres inside the water line
  if (port || e > 0.0 || u > 50.0) return vec4(water(p, dir, t, vec3(0.06, 0.24, 0.32)), 1.0);
  if (e > -3.0) return vec4(0.74, 0.72, 0.68, 0.0);
  float path = step(abs(e + 9.0), 1.4) * (1.0 - smoothstep(0.5, 2.5, w));
  return vec4(mix(grass * 1.04, vec3(0.86, 0.79, 0.62), path), 0.0);
}

// Colour inside a block at local position l (-20..20). w = world size of a pixel.
vec3 blockCol(uvec4 c, int bx, int bz, vec2 l, vec2 p, float t, float w, vec3 grass) {
  uint k = c.r;
  vec2 al = abs(l);
  bool edge = al.x > 18.0 || al.y > 18.0;   // sidewalk ring
  if (k == 0u) {
    int zone = int(c.g & 3u);
    // Tokyo/Seoul lots are paved: concrete + gravel, green only in planting strips
    vec3 lot = zone == 0 ? vec3(0.40, 0.40, 0.39) : (zone == 1 ? vec3(0.46, 0.46, 0.45) : vec3(0.72, 0.71, 0.69));
    lot *= mix(vec3(1.0), vec3(float((c.b * 37u) & 15u) / 15.0 * 0.1 + 0.95), float(zone >= 2));
    if (zone <= 1) edge = al.x > 19.4 || al.y > 19.4;                         // narrow kerb, no wide sidewalk
    if ((c.g & 4u) != 0u && t > uFar.x * 0.95) {
      // painted roofs far away (the meshes have sunk into the ground by now)
      bool laneB = (c.g & 32u) != 0u;                  // lane-split block: 2 x 5 plots fronting the roji
      int col = laneB ? int(clamp(floor((l.x + 20.0) / 8.0), 0.0, 4.0)) : int(clamp(floor((l.x + 20.0) / 10.0), 0.0, 3.0));
      int row = zone == 2 ? int(clamp(floor((l.y + 20.0) / 10.0), 0.0, 3.0)) : (l.y < 0.0 ? 0 : 1);
      int slot = laneB ? row * 5 + col : row * 4 + col;
      vec2 c0 = laneB ? vec2(-16.0 + float(col) * 8.0, row == 0 ? -11.0 : 11.0)
                      : vec2(-15.0 + float(col) * 10.0, zone == 2 ? -15.0 + float(row) * 10.0 : -10.0 + float(row) * 20.0);
      vec2 hs = zone == 0 ? vec2(laneB ? 3.3 : 4.2, 6.0) : (zone == 1 ? vec2(laneB ? 3.6 : 4.7, 6.7) : (zone == 2 ? vec2(4.3) : vec2(4.3, 7.0)));
      float face = laneB ? (row == 0 ? 1.0 : -1.0) : (zone == 2 ? (row < 2 ? -1.0 : 1.0) : (row == 0 ? -1.0 : 1.0));
      float hd0 = laneB ? 9.0 : 10.0;
      if (zone == 0) c0.y -= face * (hd0 - 0.8 - hs.y);
      if (zone == 1) c0.y -= face * (hd0 - 1.5 - hs.y);
      vec2 cv = cover(l - c0, hs, max(w, 0.8));
      float inside = cv.x * cv.y;
      uint rh = hash3(bx, bz, slot * 7 + 100), rv = rh % 100u;
      uint ri = rv < 45u ? (c.b & 7u) : rv < 80u ? ((c.b >> 3u) & 7u) : ((rh >> 8u) % 8u);
      vec3 roof = zone == 0 ? uRoof[ri] : zone == 1 ? (rv < 60u ? vec3(0.31, 0.54, 0.43) : rv < 75u ? vec3(0.37, 0.53, 0.66) : vec3(0.55, 0.56, 0.58))
                : vec3(0.6, 0.62, 0.65) * (0.92 + 0.03 * float(ri));
      float fadeIn = smoothstep(uFar.x, uFar.y, t);
      vec2 sv = cover(l - c0 + uFar.w * vec2(0.6, 0.4), hs + 0.8, max(w, 0.8));
      lot = mix(lot, lot * 0.68, max(sv.x * sv.y - inside, 0.0) * fadeIn);
      lot = mix(lot, roof, inside * fadeIn);
      if ((c.g & 32u) != 0u && abs(l.y) < 2.0) lot = mix(lot, vec3(0.64, 0.63, 0.60), 1.0 - inside);   // roji, far
      if (uNight > 0.3) {
        float on = float(rv < 40u);
        vec2 wc = cover(l - c0, vec2(1.6), max(w, 0.8));
        lot += vec3(1.0, 0.7, 0.38) * 3.0 * on * uNight * wc.x * wc.y * fadeIn;
      }
    } else if (zone <= 1 && w < 1.5 && (c.g & 4u) != 0u) {
      // near the camera: the lot plan of each home (mirrors town.js homeRect / recipe.js recipe)
      bool laneB = (c.g & 32u) != 0u;                  // lane-split block (town.js laneBlock): plots front the roji
      int col = laneB ? int(clamp(floor((l.x + 20.0) / 8.0), 0.0, 4.0)) : int(clamp(floor((l.x + 20.0) / 10.0), 0.0, 3.0)), row = l.y < 0.0 ? 0 : 1;
      int slot = laneB ? row * 5 + col : row * 4 + col;
      uint h = hash3(bx * 16 + slot, bz, 21);
      float pw = laneB ? 8.0 : 10.0;
      float fx = laneB ? -16.0 + float(col) * 8.0 : -15.0 + float(col) * 10.0, face = laneB ? (row == 0 ? 1.0 : -1.0) : (row == 0 ? -1.0 : 1.0);
      float front = laneB ? -face * 2.0 : face * 20.0, set = zone == 0 ? 0.8 : 1.5;
      float hw = zone == 0 ? (laneB ? 6.4 + float((h >> 1u) % 4u) * 0.2 : 8.0 + float((h >> 1u) % 4u) * 0.3) * 0.5 : (laneB ? 3.6 : 4.7);
      float hd = zone == 0 ? 11.0 + float((h >> 4u) % 4u) * 0.75 : 12.0 + float((h >> 4u) % 7u) * 0.5;
      float side = (h & 8u) != 0u ? 1.0 : -1.0;
      float cx = zone == 0 ? fx + side * (pw * 0.5 - 0.4 - hw) : fx;
      float zf = front - face * set, zb = zf - face * hd;            // house front and back wall z
      vec2 c0 = vec2(cx, (zf + zb) * 0.5);
      vec2 q = abs(l - c0) - vec2(hw, hd * 0.5);
      float outside = step(0.0, max(q.x, q.y));
      if (zone == 0) {
        float along = (l.y - zf) * face;                                  // > 0 between the house and the street
        float back = laneB ? step(abs(l.y), 2.0) * 0.0 + step(17.5, abs(l.y)) : ((abs(l.y) > 17.5) ? 1.0 : 0.0);   // rear 2 m of the plot: dark gravel
        lot = along > 0.0 ? vec3(0.60, 0.59, 0.56) : mix(vec3(0.52, 0.51, 0.48), vec3(0.30, 0.29, 0.28), back) * (0.96 + 0.06 * vnoise(p * 3.0));
        lot *= 1.0 - 0.10 * max(step(0.96, fract(l.x / 1.8)), step(0.96, fract(l.y / 1.8))) * (1.0 - smoothstep(0.3, 0.9, w));   // expansion joints
        // planting strip along the open side line, and joints in the concrete forecourt
        float gx = abs(l.x - (fx - side * pw * 0.5));
        lot = mix(lot, vec3(0.27, 0.36, 0.20) * (0.8 + 0.3 * vnoise(p * 1.7)), step(gx, 1.2) * step(along, 0.0) * (1.0 - smoothstep(0.6, 1.5, w)));
        if (along > 0.0) lot *= 1.0 - 0.06 * step(0.95, fract(l.x / 0.6)) * (1.0 - smoothstep(0.3, 0.9, w));
      }
      if ((c.g & 32u) != 0u && abs(l.y) < 2.0) {
        // roji: a narrow paved lane between the two rows, with white edge lines and a centre gutter
        lot = vec3(0.64, 0.63, 0.60) * (0.97 + 0.05 * vnoise(p * 2.0));
        lot = mix(lot, vec3(0.9), step(abs(abs(l.y) - 1.75), 0.06) * (1.0 - smoothstep(0.5, 1.2, w)));
        lot *= 1.0 - 0.18 * step(abs(l.y), 0.12) * (1.0 - smoothstep(0.5, 1.2, w));
      }
      float dd = length(max(q, 0.0));
      lot *= 1.0 - 0.5 * exp(-dd * 1.1) * outside;                          // contact shade around the walls
      float castNear = uFar.z < 0.0 ? smoothstep(-uFar.z * 0.6, -uFar.z, t) : 1.0;   // where cast shadows exist, skip the painted ones
      if (uFar.z < 0.5 && w < 1.4 && castNear > 0.0) {
        // low preset (no shadow pass): the house shadow projected along the sun, scaled by its height
        float fl = zone == 0 ? 2.0 + float(h & 1u) : 4.5;
        vec2 off = -uSunDir.xz / max(uSunDir.y, 0.3) * (fl * 3.2 + 1.2);
        float sh = 0.0;
        for (int i = 1; i <= 4; i++) {
          vec2 qs = abs(l - c0 - off * (float(i) * 0.25)) - vec2(hw, hd * 0.5);
          sh = max(sh, 1.0 - smoothstep(-0.2, 0.4, max(qs.x, qs.y)));
        }
        lot *= 1.0 - 0.62 * sh * outside * (1.0 - uNight) * (1.0 - smoothstep(0.9, 1.4, w)) * castNear;
      }
    }
    return edge ? mix(int(c.g & 3u) <= 1 ? vec3(0.56, 0.54, 0.51) : WALK, lot, smoothstep(0.5, 3.0, w)) : lot;
  }
  if (k == 2u) {
    float path = 1.0 - step(1.6, min(al.x, al.y));
    float ring = step(abs(length(l) - 11.0), 1.2);
    // canopy texture so parks read from far away too
    vec3 g = vec3(0.28, 0.47, 0.20) * (1.05 - 0.25 * smoothstep(0.45, 0.75, vnoise(p * 0.12)));
    vec3 c = mix(g, vec3(0.86, 0.79, 0.62), max(path, ring) * (1.0 - smoothstep(1.0, 4.0, w)));
    return edge ? WALK : c;
  }
  if (k == 5u) {
    bool ax = (c.g & 8u) != 0u, az = (c.g & 16u) != 0u;
    if (ax && az) return asphalt(p, t);
    float a = abs(ax ? l.x : l.y), b = ax ? l.y : l.x;
    vec3 cc;
    if (a < 3.6) cc = grass * 0.95;
    else if (a < 4.1) cc = WALK;
    else if (a < 18.0) {
      cc = asphalt(p, t);
      float lane = abs(fract((a - 4.1) / 3.475) - 0.5);
      cc = mix(cc, vec3(0.93), step(0.47, lane) * step(0.5, fract(b / 5.0)) * (1.0 - smoothstep(0.3, 1.2, w)));
    } else cc = WALK;
    // from far away the boulevard reads as a green-lined street, not a hard grey bar
    return mix(cc, mix(grass, vec3(0.5, 0.52, 0.52), 0.55), smoothstep(6.0, 20.0, w));
  }
  if (k == 1u) {
    float r = length(l);
    vec3 cc = mix(vec3(0.9, 0.86, 0.8), vec3(0.82, 0.74, 0.66), step(0.5, fract(r / 4.0)) * (1.0 - smoothstep(0.5, 2.0, w)));
    return mix(cc, vec3(0.95, 0.55, 0.45), step(abs(r - 17.0), 0.6));
  }
  if (k == 8u) {
    float lines = step(abs(fract((l.y + 20.0) / 6.8) - 0.5), 0.02) * (1.0 - smoothstep(0.3, 1.5, w));
    return mix(vec3(0.64, 0.64, 0.62), vec3(0.95, 0.82, 0.3), lines * 0.6);
  }
  if (k == 7u) {
    float a = bx == 0 ? al.x : al.y;
    return a < 0.4 && w < 1.0 ? vec3(0.92, 0.85, 0.5) : a < 9.0 ? asphalt(p, t) : grass;
  }
  // countryside: woods and a patchwork of fields
  uint hw = hash3(fdiv(bx, 3), fdiv(bz, 3), 41) % 5u;
  if (hw < 2u) return grass * vec3(0.62, 0.78, 0.6) * (0.85 + 0.3 * vnoise(p * 0.08));
  uint hf = hash3(bx, bz, 43);
  uint ci = hf % 5u;
  vec3 cc = ci == 0u ? vec3(0.75, 0.82, 0.36) : ci == 1u ? vec3(0.88, 0.78, 0.4) : ci == 2u ? vec3(0.5, 0.72, 0.3) : ci == 3u ? vec3(0.62, 0.78, 0.42) : vec3(0.8, 0.66, 0.42);
  float rows = (hf & 32u) != 0u ? l.x : l.y;
  return cc * (0.93 + 0.07 * step(0.5, fract(rows / 2.5)) * (1.0 - smoothstep(0.4, 1.2, w)));
}

// Ground colour at world xz. a: 0 town ground (lamps), 1 water, 2 no street lights.
vec4 groundBase(vec2 p, vec3 dir, float t, float w) {
  // open sea beyond the outskirts, with a wavy beach
  float shore = uTown.z + 40.0 + sin(p.y * 0.0021) * 90.0 + sin(p.y * 0.0071 + 1.3) * 35.0;
  if (p.x > shore) {
    vec3 deep = mix(vec3(0.07, 0.36, 0.56), vec3(0.03, 0.2, 0.38), smoothstep(0.0, 1500.0, p.x - shore));
    vec3 c = mix(vec3(0.85, 0.95, 1.0), water(p, dir, t, deep), clamp(smoothstep(0.0, 6.0, p.x - shore) + smoothstep(1.0, 4.0, w), 0.0, 1.0));
    return vec4(c, 1.0);
  }
  if (p.x > shore - 30.0) return vec4(mix(vec3(0.93, 0.85, 0.66), vec3(0.85, 0.78, 0.6), vnoise(p * 0.2)), 2.0);

  int bx = int(floor((p.x + 24.0) / 48.0)), bz = int(floor((p.y + 24.0) / 48.0));
  vec2 l = p - vec2(bx, bz) * 48.0;          // -24..24
  vec2 al = abs(l);
  uvec4 c = cellAt(bx, bz);
  uint k = c.r;
  vec3 grass = vec3(0.33, 0.55, 0.24);
  if (uFar.z > 0.5) grass = mix(grass, vec3(0.37, 0.49, 0.23), vnoise(p * 0.033)) * (0.92 + 0.16 * vnoise(p * 0.11));
  // district tint (10x10 blocks) so the far field isn't one flat colour
  uint dh = hash3(fdiv(bx, 10), fdiv(bz, 10), 57);
  vec3 tint = mix(vec3(1.06, 1.0, 0.9), vec3(0.94, 0.98, 1.06), float(dh & 255u) / 255.0);
  grass *= tint;
  if (k == 9u) return bx >= int(uTown.w) ? vec4(water(p, dir, t, vec3(0.06, 0.24, 0.32)), 1.0) : bayCol(p, dir, t, w, grass);
  if (k == 3u) return vec4(water(p, dir, t, RIVERC), 1.0);
  if (k == 4u) return riverCol(p, dir, t, w, grass);
  float lampOk = countryish(k) ? 2.0 : 0.0;

  // far away: blend block and street by how much of the pixel each covers (no shimmer)
  if (w > 2.5) {
    vec2 cv = mix(cover(l, vec2(20.0), w), vec2(40.0 / 48.0), smoothstep(10.0, 48.0, w));
    vec3 bc = blockCol(c, bx, bz, clamp(l, -19.9, 19.9), p, t, w, grass);
    vec3 rc = k == 8u ? vec3(0.62, 0.62, 0.6) : countryish(k) ? grass * vec3(1.0, 0.98, 0.85) : asphalt(p, t);
    return vec4(mix(rc, bc, cv.x * cv.y), lampOk);
  }
  if (al.x < 20.0 && al.y < 20.0) return vec4(blockCol(c, bx, bz, l, p, t, w, grass), lampOk);

  // road strip or intersection: look at the neighbouring blocks
  int sx = l.x >= 20.0 ? 1 : (l.x <= -20.0 ? -1 : 0);
  int sz = l.y >= 20.0 ? 1 : (l.y <= -20.0 ? -1 : 0);
  uint k2 = cellAt(bx + sx, bz + sz).r;
  uint kx = sx != 0 ? cellAt(bx + sx, bz).r : k;
  uint kz = sz != 0 ? cellAt(bx, bz + sz).r : k;
  int nn = int(sx != 0) + int(sz != 0);
  int nw = int(isWater(k)) + int(isWater(kx)) + int(isWater(kz)) + int(isWater(k2));
  if ((nn == 1 && isWater(k) && isWater(k2)) || (nn == 2 && nw >= 3)) {
    if (k == 9u || k2 == 9u || kx == 9u || kz == 9u) return bayCol(p, dir, t, w, grass);
    if (k == 4u || k2 == 4u || kx == 4u || kz == 4u) return riverCol(p, dir, t, w, grass);
    return vec4(water(p, dir, t, RIVERC), 1.0);
  }
  // along the bay shore the street gives way to a promenade that follows the smooth shoreline
  if ((k == 9u || kx == 9u || kz == 9u || k2 == 9u) && p.x < uTown.z - 200.0 && bayE(p) > -60.0) return bayCol(p, dir, t, w, grass);
  bool hwy = (k == 7u || kx == 7u || kz == 7u || k2 == 7u);
  if (countryish(k) && countryish(kx) && countryish(kz) && countryish(k2) && !hwy) {
    if (k == 8u && kx == 8u && kz == 8u && k2 == 8u) return vec4(0.62, 0.62, 0.6, 2.0);
    return vec4(grass * vec3(1.0, 0.98, 0.85), 2.0);
  }
  vec3 cc = asphalt(p, t);
  if (nn == 1 && w < 1.2) {
    // centre dashes and crosswalks
    float across = sx != 0 ? l.x - 24.0 * float(sx) : l.y - 24.0 * float(sz);
    float along = sx != 0 ? l.y : l.x;
    float fade = 1.0 - smoothstep(0.4, 1.2, w);
    uvec4 cn = cellAt(bx + sx, bz + sz);
    bool resid = (k == 0u || k == 2u) && (k2 == 0u || k2 == 2u) && (c.g & 3u) <= 1u && (cn.g & 3u) <= 1u;   // homes or a pocket park: still a lane
    if (resid) {
      // Tokyo residential lane: white edge lines 0.5 m from the kerb, a stop bar before the junction, no centre line
      float edgeL = step(abs(abs(across) - 3.45), 0.075);
      float stopBar = step(abs(abs(along) - 15.2), 0.22) * step(abs(across), 3.5);
      cc = mix(cc * 0.92, vec3(0.9), max(edgeL, stopBar) * fade);
    } else {
      float dash = step(abs(across), 0.12) * step(0.5, fract(along / 6.0)) * step(abs(along), 14.0);
      float zebra = step(14.5, abs(along)) * step(abs(along), 19.5) * step(0.5, fract(across / 1.2));
      cc = mix(cc, vec3(0.95, 0.88, 0.55), dash * fade);
      cc = mix(cc, vec3(0.92), zebra * fade);
    }
  }
  return vec4(cc, 0.0);
}

vec3 sky(vec3 dir) {
  float h = max(dir.y, 0.0);
  vec3 c = mix(uSkyHor, uSkyTop, pow(h, 0.55));
  float s = max(dot(dir, uSunDir), 0.0);
  c += uSunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25) * (1.0 - uNight * 0.6);
  if (uClouds > 0.5 && dir.y > 0.02) {
    vec2 cp = dir.xz / dir.y * 0.9 + vec2(uTime * 0.004, 0.0);
    float cl = vnoise(cp * 1.4) * 0.65 + vnoise(cp * 3.1) * 0.35;
    cl = smoothstep(0.55, 0.85, cl) * smoothstep(0.02, 0.25, dir.y);
    vec3 cc = mix(vec3(1.0), uSunCol * 0.9 + uSkyHor * 0.3, 0.35) * (1.0 - uNight * 0.85);
    cc = mix(cc, uSkyHor * vec3(1.05, 0.8, 0.85) + vec3(0.04, 0.02, 0.06), smoothstep(0.4, 0.75, uNight) * (1.0 - smoothstep(0.85, 1.0, uNight)));   // dusk: clouds lit pink from below
    c = mix(c, cc, cl * 0.75);
  }
  if (uNight > 0.5 && dir.y > 0.0) {
    vec2 sp = dir.xz / (dir.y + 0.3) * 260.0;
    uint hs = h2(ivec2(floor(sp)));
    float st = float((hs & 1023u) < 4u) * (1.0 - length(fract(sp) - 0.5) * 2.0);
    c += vec3(st) * smoothstep(0.82, 1.0, uNight);
  }
  return c;
}

void main() {
  vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0); vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 p0 = a.xyz / a.w, p1 = b.xyz / b.w;
  vec3 dir = normalize(p1 - p0);
  float t = dir.y < -0.0005 ? -uCam.y / dir.y : 1e5;
  vec3 p = uCam + dir * t;
  float w = max(length(dFdx(p.xz)), length(dFdy(p.xz))) * uPx;   // uPx = 0.5 in the half-res pass: keep full-res footprints (road markings)
  if (dir.y > -0.0005) { o = vec4(tone(sky(dir)), 1.0); return; }
  vec4 g = groundBase(p.xz, dir, t, min(w, 400.0));
  vec3 col = g.rgb;
  if (g.a != 1.0) {
    float cloud = uFar.z > 0.5 ? 0.82 + 0.18 * smoothstep(0.3, 0.7, vnoise(p.xz * 0.0018 + vec2(uTime * 0.006, 0.0))) : 1.0;
    col *= uGndCol * 0.6 + uSkyCol * 0.55 + uSunCol * max(uSunDir.y, 0.0) * 0.95 * cloud;
    if (uNight > 0.2) {
      col *= (1.0 - 0.6 * uNight) * mix(vec3(1.0), vec3(0.8, 0.85, 1.08), uNight);   // cool dusk asphalt
      if (g.a == 0.0) {
        // pools of street light: each intersection cell holds its two corner lamps; cell edges fall
        // in the middle of blocks where the light is ~0, so there are no seams. The asphalt is damp: each pool
        // is stretched toward the camera like a reflection, and one lamp in three is a shop's neon spill
        vec2 cc = floor(p.xz / 48.0) * 48.0 + 24.0;
        uint lh = h2(ivec2(cc));
        vec2 vd = normalize(dir.xz + vec2(1e-5)), vs = vec2(-vd.y, vd.x);
        vec2 d1 = p.xz - (cc - 4.7), d2 = p.xz - (cc + 4.7);
        float st = mix(0.75, 0.3, smoothstep(40.0, 140.0, t));   // the reflection streak only shows at grazing angles
        d1 = vec2(dot(d1, vs), dot(d1, vd) * st); d2 = vec2(dot(d2, vs), dot(d2, vd) * st);
        float far = 1.0 - smoothstep(900.0, 2600.0, t);
        float l1 = exp(-dot(d1, d1) * 0.06) * uNight * far, l2 = exp(-dot(d2, d2) * 0.06) * uNight * far;
        vec3 lc = mix(vec3(1.0, 0.68, 0.38), vec3(0.95, 0.9, 0.8), float(lh & 1u));
        uint nh = (lh >> 4u) % 6u;
        vec3 neon = nh == 0u ? vec3(1.0, 0.25, 0.55) : nh == 1u ? vec3(0.2, 0.75, 1.0) : nh == 2u ? vec3(0.75, 0.35, 1.0) : lc;
        float gain = 0.55 + 0.35 * float((lh >> 1u) & 3u) / 3.0;
        // from altitude the pools merge into a soft street glow instead of a polka-dot grid
        float sm = smoothstep(1.5, 6.0, w);
        vec3 glow = lc * mix(min(l1 * gain, 0.7), 0.08 * uNight, sm) + neon * mix(min(l2 * gain, 0.7), 0.05 * uNight, sm);
        col += glow * 0.8;
      }
    }
  } else col *= 1.0 - 0.6 * uNight;
  o = vec4(fogMix(col, dir, t), 1.0);
  // blend into the sky right at the horizon (only those pixels pay for the sky)
  if (dir.y > -0.02) o.rgb = mix(o.rgb, sky(vec3(dir.x, 0.0005, dir.z)), smoothstep(-0.02, -0.0005, dir.y));
  o.rgb = tone(o.rgb);
}`;
