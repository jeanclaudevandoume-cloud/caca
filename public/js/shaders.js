// GLSL. Per-block facts (kind, zone, inhabited, avenues, roof colours) come to the ground
// shader in a data texture built by town.js (buildGround). What the shader still mirrors by
// hand: hash3 (per-slot roof pick), riverZ/isRiver, bayHalf/bayAt/portLane (outside the
// texture), plot layout and the ROOF palette. Change one, change the other.

const COMMON = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uSkyCol, uGndCol, uFogCol, uSkyTop, uSkyHor;
uniform float uFogD, uNight, uTime;
uniform vec3 uCam;
// ACES filmic fit: rich mid-tones, highlights roll off instead of clipping to neon
vec3 tone(vec3 x) {
  x *= 1.05;
  x = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return clamp(mix(vec3(dot(x, vec3(0.3, 0.59, 0.11))), x, 1.18), 0.0, 1.0);   // keep it vibrant after the curve
}
vec3 fogMix(vec3 col, vec3 dir, float dist) {
  float f = 1.0 - exp(-pow(dist / uFogD, 1.6));
  float s = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  vec3 fc = uFogCol + uSunCol * s * 0.25 * (1.0 - uNight);
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
uniform vec3 uOrigin, uCam;
uniform vec4 uLod;   // x fade start, y fade end, z mode (0 chunk, 1 skyline), w scale (0 = 1)
uniform float uTime;
out vec3 vW; out vec3 vN; out vec2 vUV; out vec4 vCol; flat out int vMat;
void main() {
  vec3 p = aPos / 64.0 * (uLod.w > 0.0 ? uLod.w : 1.0) + uOrigin;
  int mi = int(aMat + 0.5);
  bool tall = (mi & 8) != 0;
  int mat = mi & 7;
  float d = length(p - uCam);
  // tall buildings hand over to the skyline per chunk (same chunk grid as main.js), so every
  // vertex of a building makes the same decision and no slivers appear
  vec2 cc = floor((p.xz + 24.0) / 192.0) * 192.0 + 72.0;
  float dc = length(vec3(cc.x, 0.0, cc.y) - uCam);
  if (uLod.z < 0.5) {
    if (tall) { if (dc > uLod.x) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; } }
    else p.y *= 1.0 - smoothstep(uLod.x, uLod.y, d);
  } else if (dc <= uLod.x) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  if (mat == 2 && p.y > 2.0) p.xz += sin(uTime * 1.3 + p.x * 0.11 + p.z * 0.07) * 0.06 * (p.y - 2.0) / 6.0;
  vW = p; vN = aN; vUV = aUV; vCol = aCol; vMat = mat;
  gl_Position = uVP * vec4(p, 1.0);
}`;

export const GEO_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
in vec3 vW; in vec3 vN; in vec2 vUV; in vec4 vCol; flat in int vMat;
out vec4 o;
uint ih(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
void main() {
  vec3 n = normalize(vN);
  vec3 base = vCol.rgb;
  vec3 V = vW - uCam; float dist = length(V); vec3 dir = V / dist;
  float sun = max(dot(n, uSunDir), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 amb = mix(uGndCol, uSkyCol, hemi);
  // contact + canyon occlusion: walls darken toward the street, tall city walls more so
  float wall = 1.0 - abs(n.y);
  float ao = mix(1.0, mix(0.62, 1.0, smoothstep(0.0, 4.0 + 10.0 * float(vMat == 5), vW.y)), wall);
  vec3 col = base * (amb * ao + uSunCol * sun * mix(1.0, 0.85, wall));
  vec3 emis = vec3(0.0);
  uint seedAll = uint(vCol.a * 255.0 + 0.5);
  if (vMat == 1 || vMat == 5) {
    float glass = float(vMat == 5);
    float u = vUV.x / 8.0, v = vUV.y / 4.0;
    float sp = mix(2.6, 1.7, glass);
    vec2 g = vec2(u / sp, v);
    vec2 f = fract(g);
    vec2 w = fwidth(g);
    float k = clamp(1.4 - max(w.x, w.y) * 1.7, 0.0, 1.0);               // fade detail at distance: no moire
    uint style = glass > 0.5 ? 0u : (seedAll & 3u);
    uint seed = seedAll >> 2;
    // wall surface detail (residential): lap siding, brick courses, plinth, floor bands
    if (glass < 0.5) {
      float kd = clamp(1.2 - fwidth(vW.y) * 6.0, 0.0, 1.0);
      if (style == 1u) col *= 1.0 - 0.08 * smoothstep(0.86, 0.96, fract(vW.y / 0.24)) * kd;
      if (style == 2u) {
        float row = floor(vW.y / 0.3);
        float mort = max(1.0 - smoothstep(0.0, 0.1, fract(vW.y / 0.3)), 1.0 - smoothstep(0.0, 0.06, fract(u / 0.6 + row * 0.5)));
        col = mix(col, col * 0.75 + vec3(0.16, 0.15, 0.14), mort * 0.5 * kd);
        col *= 0.94 + 0.12 * fract(sin(row * 12.9 + floor(u / 0.6 + row * 0.5) * 78.2) * 437.5) * kd;
      }
      col *= mix(0.7, 1.0, smoothstep(0.42, 0.48, vW.y));                // darker plinth
      col *= 1.0 - 0.1 * smoothstep(0.93, 0.99, f.y) * k;                 // floor line / eave shadow
    }
    // window opening in the cell (cell units): glass rect, frame band, mullions, sill
    vec2 fw = vec2(0.07 / sp, 0.07 / 3.2);
    float mx = mix(0.25, 0.06, glass), my0 = mix(0.3, 0.1, glass), my1 = mix(0.8, 0.94, glass);
    #define RECT(lo, hi) (smoothstep(lo.x - w.x, lo.x + w.x, f.x) * (1.0 - smoothstep(hi.x - w.x, hi.x + w.x, f.x)) * smoothstep(lo.y - w.y, lo.y + w.y, f.y) * (1.0 - smoothstep(hi.y - w.y, hi.y + w.y, f.y)))
    vec2 glo = vec2(mx, my0), ghi = vec2(1.0 - mx, my1);
    float frame = RECT((glo - fw), (ghi + fw));
    float pane = RECT(glo, ghi);
    float fy = clamp((f.y - my0) / (my1 - my0), 0.0, 1.0);
    // cross mullion (residential only): 5 cm bars at the centre and at 62% height
    float mull = glass > 0.5 ? 0.0 : max(1.0 - smoothstep(0.025 / sp, 0.025 / sp + w.x, abs(f.x - 0.5)),
                                          1.0 - smoothstep(0.025 / 3.2, 0.025 / 3.2 + w.y, abs(f.y - mix(my0, my1, 0.62))));
    float sill = glass > 0.5 ? 0.0 : RECT(vec2(mx - 0.05 / sp, my0 - 0.08 / 3.2 - fw.y), vec2(1.0 - mx + 0.05 / sp, my0 - fw.y));
    float avgWin = mix(0.33, 0.75, glass);
    pane = mix(avgWin, pane, k) * step(0.3, v);
    frame = frame * k * step(0.3, v);
    // glass: dark at the bottom, sky at the top, sun glint; some curtains; lintel shadow
    vec3 refl = mix(vec3(0.15, 0.2, 0.25), mix(vec3(0.49, 0.59, 0.69), uSkyHor, 0.4), fy);
    refl = mix(refl, uSkyHor * 0.8, glass * 0.3 * (1.0 - abs(dir.y)));
    refl += uSunCol * pow(max(dot(reflect(dir, n), uSunDir), 0.0), 40.0) * mix(0.4, 0.8, glass);
    uint face = uint(dot(step(0.5, abs(n)), vec3(1.0, 2.0, 3.0)) + 3.0 * step(0.0, n.x + n.z));
    uint cell = ih(uint(int(floor(g.x)) + 4096) * 7919u + uint(int(floor(g.y)) + 64) * 104729u + seed * 2654435761u + face * 40503u);
    if (glass < 0.5 && (cell >> 12u) % 5u == 0u) refl = mix(refl, vec3(0.91, 0.86, 0.78) * 0.8 * (amb + uSunCol * 0.3), step(fy, 0.55) * k);
    refl *= mix(1.0, 0.6, smoothstep(0.86, 0.9, fy) * k);
    float share = 30.0 + float(ih(seed * 31u + 7u) % 120u);           // 12%..59% of windows lit
    float lit = mix(share / 256.0, float(float(cell & 255u) < share), k);
    vec3 warm = mix(vec3(1.0, 0.7, 0.38), vec3(0.8, 0.88, 1.0), float((cell >> 8u & 7u) == 0u) * k);
    vec3 body = mix(col, col * 0.85 + refl * 0.1, glass);
    vec3 frameC = mix(vec3(0.95, 0.93, 0.9), vec3(0.75, 0.78, 0.8), glass) * (amb * 0.9 + uSunCol * max(dot(n, uSunDir), 0.0) * 0.8);
    col = mix(body, frameC, max(frame - pane, sill * k));
    vec3 paneC = mix(refl * (0.55 + 0.45 * (1.0 - uNight)), frameC, mull * k);
    col = mix(col, paneC, pane * (0.9 + 0.1 * glass));
    if (glass > 0.5) col = mix(col, col * 0.75 + refl * 0.25, 1.0 - pane);
    // far away the windows merge, so the glow stays a little brighter and whiter to stay readable
    emis = mix(vec3(1.0, 0.78, 0.45), warm, k) * lit * pane * (1.0 - mull * k) * smoothstep(0.05, 0.6, uNight) * mix(0.7, 1.05, k) * mix(1.0, 1.25 - 0.45 * fy, k);
  } else if (vMat == 7) {
    // roof tiles: courses along the slope, darker eaves, faded with distance
    float kt = clamp(1.2 - fwidth(vW.y) * 5.0, 0.0, 1.0);
    col *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.25, fract(vW.y / 0.28))) * kt;
    col *= 0.92 + 0.08 * fract(sin(dot(floor(vW.xz * 1.6), vec2(12.9, 78.2))) * 437.5) * kt;
  } else if (vMat == 2) {
    col += base * 0.18 * sun;                                             // leaves glow a bit in the sun
  } else if (vMat == 4) {
    // pale lamps and lanterns look like frosted glass by day; coloured lights (pin, signs) keep their colour
    float pale = smoothstep(0.7, 0.8, dot(base, vec3(0.3, 0.5, 0.2)));
    col = mix(base, vec3(0.92, 0.93, 0.95), (1.0 - uNight) * pale) * mix(1.0, 0.65, pale);
    emis = base * vec3(1.0, 0.85, 0.6) * 1.4 * uNight;
  } else if (vMat == 3) {
    col += uSunCol * pow(max(dot(reflect(dir, n), uSunDir), 0.0), 24.0) * 0.35;
  } else if (vMat == 6) {
    col = mix(base, uSkyHor, 0.35) + uSunCol * pow(max(dot(reflect(dir, n), uSunDir), 0.0), 60.0);
  }
  // warm rim on edges turned toward a low sun keeps shapes readable at sunset
  float rim = pow(1.0 - abs(dot(n, dir)), 3.0) * max(dot(n, uSunDir) + 0.2, 0.0) * (1.0 - uSunDir.y) * (1.0 - uNight) * float(vMat != 5);
  col += uSunCol * rim * 0.22;
  col = col * (1.0 - 0.5 * uNight) + emis;
  o = vec4(tone(fogMix(col, dir, dist)), 1.0);
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
uniform vec4 uTown;   // x townD2, y ground texture extent, z seaX, w seaBx
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
const int RIV[48] = int[48](0,1,2,2,3,4,4,5,5,6,6,6,6,6,6,6,5,5,4,4,3,2,2,1,0,-1,-2,-2,-3,-4,-4,-5,-5,-6,-6,-6,-6,-6,-6,-6,-5,-5,-4,-4,-3,-2,-2,-1);
int riverZ(int bx) { return 9 + RIV[imod(bx, 48)]; }
bool isRiver(int bx, int bz) { int a = riverZ(bx), b = riverZ(bx + 1); return (bz >= a - 1 && bz <= a + 1) || (bz >= b - 1 && bz <= b + 1); }
int bayHalf(int bx) { return min(3 + fdiv((bx - 24) * 3, 4), 18); }
bool bayAt(int bx, int bz) { return bx >= 24 && bz >= 2 - bayHalf(bx) && bz <= 2 + bayHalf(bx); }
bool portAt(int bx, int bz) { if (bx < 25 || bx > 40) return false; int e = 1 - bayHalf(bx) - bz; return e >= 0 && e <= 2; }

// K: 0 HOMES 1 PLAZA 2 PARK 3 LAKE 4 RIVER 5 AVENUE 6 COUNTRY 7 HIGHWAY 8 PORT 9 SEA
uvec4 cellAt(int bx, int bz) {
  int e = int(uTown.y);
  if (abs(bx) <= e && abs(bz) <= e) return texelFetch(uGround, ivec2(bx + e, bz + e), 0);
  uint k = bx >= int(uTown.w) || bayAt(bx, bz) ? 9u : portAt(bx, bz) ? 8u : isRiver(bx, bz) ? 4u : (bx == 0 || bz == 0) ? 7u : 6u;
  return uvec4(k, 0u, 0u, 0u);
}
bool isWater(uint k) { return k == 3u || k == 4u || k == 9u; }
bool countryish(uint k) { return k == 6u || k == 8u || isWater(k); }

const vec3 ROOF[8] = vec3[8](vec3(0.706,0.325,0.227), vec3(0.294,0.337,0.388), vec3(0.227,0.243,0.271), vec3(0.369,0.478,0.282),
  vec3(0.247,0.549,0.518), vec3(0.604,0.235,0.192), vec3(0.478,0.337,0.22), vec3(0.184,0.302,0.478));

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
  vec3 c = mix(deep, uSkyHor * 0.95, 0.15 + 0.6 * fres);
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
const vec3 RIVERC = vec3(0.1, 0.42, 0.55);

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
  if (port || e > 0.0 || u > 50.0) return vec4(water(p, dir, t, vec3(0.08, 0.38, 0.55)), 1.0);
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
    vec3 lot = zone == 0 ? grass : (zone == 1 ? mix(grass, vec3(0.75, 0.72, 0.66), 0.55) : vec3(0.72, 0.71, 0.69));
    if ((c.g & 4u) != 0u && t > uFar.x * 0.95) {
      // painted roofs far away (the meshes have sunk into the ground by now)
      int col = int(clamp(floor((l.x + 20.0) / 10.0), 0.0, 3.0));
      int row = zone == 2 ? int(clamp(floor((l.y + 20.0) / 10.0), 0.0, 3.0)) : (l.y < 0.0 ? 0 : 1);
      int slot = row * 4 + col;
      vec2 c0 = vec2(-15.0 + float(col) * 10.0, zone == 2 ? -15.0 + float(row) * 10.0 : -10.0 + float(row) * 20.0);
      vec2 hs = zone == 0 ? vec2(3.7, 4.7) : (zone == 1 ? vec2(4.7, 6.7) : (zone == 2 ? vec2(4.3) : vec2(4.3, 7.0)));
      float face = (zone == 2 ? (row < 2 ? -1.0 : 1.0) : (row == 0 ? -1.0 : 1.0));
      if (zone == 0) c0.y -= face * (10.0 - 3.0 - hs.y);
      if (zone == 1) c0.y -= face * (10.0 - 1.5 - hs.y);
      vec2 cv = cover(l - c0, hs, max(w, 0.8));
      float inside = cv.x * cv.y;
      uint rh = hash3(bx, bz, slot * 7 + 100), rv = rh % 100u;
      uint ri = rv < 45u ? (c.b & 7u) : rv < 80u ? ((c.b >> 3u) & 7u) : ((rh >> 8u) % 8u);
      vec3 roof = zone <= 1 ? ROOF[ri] : vec3(0.6, 0.62, 0.65) * (0.92 + 0.03 * float(ri));
      float fadeIn = smoothstep(uFar.x, uFar.y, t);
      // soft shadow beside each home sells the height from above
      vec2 sv = cover(l - c0 + uFar.w * vec2(0.6, 0.4), hs + 0.8, max(w, 0.8));
      lot = mix(lot, lot * 0.68, max(sv.x * sv.y - inside, 0.0) * fadeIn);
      lot = mix(lot, roof, inside * fadeIn);
      if (uNight > 0.3) {
        // lit windows seen from far above: a warm speck on some homes
        float on = float(rv < 40u);
        vec2 wc = cover(l - c0, vec2(1.6), max(w, 0.8));
        lot += vec3(1.0, 0.7, 0.38) * 3.0 * on * uNight * wc.x * wc.y * fadeIn;
      }
    } else if (zone <= 1 && w < 1.5 && (c.g & 4u) != 0u) {
      // near the camera: a garden path to each front door and contact shadow around each home
      int col = int(clamp(floor((l.x + 20.0) / 10.0), 0.0, 3.0)), row = l.y < 0.0 ? 0 : 1;
      int slot = row * 4 + col;
      uint h = hash3(bx * 16 + slot, bz, 21);
      float fx = -15.0 + float(col) * 10.0, face = row == 0 ? -1.0 : 1.0;
      float front = face * 20.0, set = zone == 0 ? 3.0 : 1.5;
      float hw = zone == 0 ? (6.5 + float((h >> 1u) % 5u) * 0.5) * 0.5 : 4.7;
      float hd = zone == 0 ? 8.0 + float((h >> 4u) % 7u) * 0.5 : 12.0 + float((h >> 4u) % 7u) * 0.5;
      float zf = front - face * set, zb = zf - face * hd;            // house front and back wall z
      vec2 c0 = vec2(fx, (zf + zb) * 0.5);
      vec2 q = abs(l - c0) - vec2(hw, hd * 0.5);
      float dd = length(max(q, 0.0));
      lot *= 1.0 - 0.32 * exp(-dd * 1.2) * step(0.0, max(q.x, q.y));
      if (zone == 0) {
        float dx = fx + ((h & 8u) != 0u ? 1.5 : -1.5);
        float along = (l.y - zf) * face;                             // 0 at the wall, 3 at the sidewalk
        float path = step(abs(l.x - dx), 0.55) * step(0.0, along) * step(along, set);
        lot = mix(lot, vec3(0.79, 0.76, 0.71), path * (1.0 - smoothstep(0.6, 1.5, w)));
      }
    }
    return edge ? mix(WALK, lot, smoothstep(0.5, 3.0, w)) : lot;
  }
  if (k == 2u) {
    float path = 1.0 - step(1.6, min(al.x, al.y));
    float ring = step(abs(length(l) - 11.0), 1.2);
    // canopy texture so parks read from far away too
    vec3 g = grass * (1.05 - 0.25 * smoothstep(0.45, 0.75, vnoise(p * 0.12)));
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
  vec3 crops[5] = vec3[5](vec3(0.75, 0.82, 0.36), vec3(0.88, 0.78, 0.4), vec3(0.5, 0.72, 0.3), vec3(0.62, 0.78, 0.42), vec3(0.8, 0.66, 0.42));
  vec3 cc = crops[hf % 5u];
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
  if (uFar.z > 0.5) grass *= 0.9 + 0.2 * vnoise(p * 0.05);
  if (k == 9u) return bx >= int(uTown.w) ? vec4(water(p, dir, t, vec3(0.08, 0.38, 0.55)), 1.0) : bayCol(p, dir, t, w, grass);
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
    float dash = step(abs(across), 0.12) * step(0.5, fract(along / 6.0)) * step(abs(along), 14.0);
    float zebra = step(14.5, abs(along)) * step(abs(along), 19.5) * step(0.5, fract(across / 1.2));
    cc = mix(cc, vec3(0.95, 0.88, 0.55), dash * fade);
    cc = mix(cc, vec3(0.92), zebra * fade);
  }
  return vec4(cc, 0.0);
}

vec3 sky(vec3 dir) {
  float h = max(dir.y, 0.0);
  vec3 c = mix(uSkyHor, uSkyTop, pow(h, 0.55));
  float s = max(dot(dir, uSunDir), 0.0);
  c += uSunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25) * (1.0 - uNight * 0.6);
  if (uFar.z > 0.5 && dir.y > 0.02) {
    vec2 cp = dir.xz / dir.y * 0.9 + vec2(uTime * 0.004, 0.0);
    float cl = vnoise(cp * 1.4) * 0.65 + vnoise(cp * 3.1) * 0.35;
    cl = smoothstep(0.55, 0.85, cl) * smoothstep(0.02, 0.25, dir.y);
    vec3 cc = mix(vec3(1.0), uSunCol * 0.9 + uSkyHor * 0.3, 0.35) * (1.0 - uNight * 0.85);
    c = mix(c, cc, cl * 0.75);
  }
  if (uNight > 0.5 && dir.y > 0.0) {
    vec2 sp = dir.xz / (dir.y + 0.3) * 260.0;
    uint hs = h2(ivec2(floor(sp)));
    float st = float((hs & 1023u) < 4u) * (1.0 - length(fract(sp) - 0.5) * 2.0);
    c += vec3(st) * (uNight - 0.5) * 2.0;
  }
  return c;
}

void main() {
  vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0); vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 p0 = a.xyz / a.w, p1 = b.xyz / b.w;
  vec3 dir = normalize(p1 - p0);
  float t = dir.y < -0.0005 ? -uCam.y / dir.y : 1e5;
  vec3 p = uCam + dir * t;
  float w = max(length(dFdx(p.xz)), length(dFdy(p.xz)));
  if (dir.y > -0.0005) { o = vec4(tone(sky(dir)), 1.0); return; }
  vec4 g = groundBase(p.xz, dir, t, min(w, 400.0));
  vec3 col = g.rgb;
  if (g.a != 1.0) {
    float cloud = uFar.z > 0.5 ? 0.82 + 0.18 * smoothstep(0.3, 0.7, vnoise(p.xz * 0.0018 + vec2(uTime * 0.006, 0.0))) : 1.0;
    col *= uGndCol * 0.6 + uSkyCol * 0.55 + uSunCol * max(uSunDir.y, 0.0) * 0.95 * cloud;
    if (uNight > 0.2) {
      col *= 1.0 - 0.55 * uNight;
      if (g.a == 0.0) {
        // pools of street light: each intersection cell holds its two corner lamps; cell edges fall
        // in the middle of blocks where the light is ~0, so there are no seams
        vec2 cc = floor(p.xz / 48.0) * 48.0 + 24.0;
        uint lh = h2(ivec2(cc));
        vec2 d1 = p.xz - (cc - 4.7), d2 = p.xz - (cc + 4.7);
        float lamp = (exp(-dot(d1, d1) * 0.016) + exp(-dot(d2, d2) * 0.016)) * uNight * (1.0 - smoothstep(900.0, 2600.0, t));
        vec3 lc = mix(vec3(1.0, 0.7, 0.4), vec3(0.95, 0.9, 0.8), float(lh & 1u));
        // from altitude the pools merge into a soft street glow instead of a polka-dot grid
        float pool = mix(1.0 - exp(-lamp * (0.5 + 0.3 * float((lh >> 1u) & 3u) / 3.0)), 0.12 * uNight, smoothstep(1.5, 6.0, w));
        col += lc * 0.75 * pool;
      }
    }
  } else col *= 1.0 - 0.6 * uNight;
  o = vec4(fogMix(col, dir, t), 1.0);
  // blend into the sky right at the horizon (only those pixels pay for the sky)
  if (dir.y > -0.02) o.rgb = mix(o.rgb, sky(vec3(dir.x, 0.0005, dir.z)), smoothstep(-0.02, -0.0005, dir.y));
  o.rgb = tone(o.rgb);
}`;
