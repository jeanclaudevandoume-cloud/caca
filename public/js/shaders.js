// GLSL. The ground shader mirrors town.js (hash3, riverZ, cellKind, zoneLevel, kindAt,
// plot layout, roofIdx, ROOF palette) by hand. Change one, change the other.

const COMMON = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uSkyCol, uGndCol, uFogCol, uSkyTop, uSkyHor;
uniform float uFogD, uNight, uTime;
uniform vec3 uCam;
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
  bool tall = aMat >= 7.5;
  int mat = int(aMat + 0.5) & 7;
  float d = length(p.xz - uCam.xz);
  // tall buildings hand over to the skyline per chunk (same chunk grid as main.js), so every
  // vertex of a building makes the same decision and no slivers appear
  vec2 cc = floor((p.xz + 24.0) / 192.0) * 192.0 + 72.0;
  float dc = length(cc - uCam.xz);
  if (uLod.z < 0.5) {
    if (tall) { if (dc > uLod.x) { gl_Position = vec4(0.0, 0.0, -2.0, 0.0); return; } }
    else p.y *= 1.0 - smoothstep(uLod.x, uLod.y, d);
  } else if (dc <= uLod.x) { gl_Position = vec4(0.0, 0.0, -2.0, 0.0); return; }
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
  if (vMat == 1 || vMat == 5) {
    float glass = float(vMat == 5);
    float u = vUV.x / 8.0, v = vUV.y / 4.0;
    float sp = mix(2.6, 1.7, glass);
    vec2 g = vec2(u / sp, v);
    vec2 f = fract(g);
    vec2 w = fwidth(g);
    float k = clamp(1.6 - max(w.x, w.y) * 3.0, 0.0, 1.0);               // fade pattern at distance: no moire
    float mx = mix(0.22, 0.08, glass), my0 = mix(0.32, 0.12, glass), my1 = mix(0.82, 0.92, glass);
    float win = smoothstep(mx - w.x, mx + w.x, f.x) * (1.0 - smoothstep(1.0 - mx - w.x, 1.0 - mx + w.x, f.x))
              * smoothstep(my0 - w.y, my0 + w.y, f.y) * (1.0 - smoothstep(my1 - w.y, my1 + w.y, f.y));
    float avgWin = mix(0.33, 0.7, glass);
    win = mix(avgWin, win, k) * step(0.3, v);
    // day: windows reflect the sky; night: some are lit warm
    vec3 refl = mix(vec3(0.18, 0.26, 0.36), uSkyHor, 0.35 + 0.35 * (1.0 - abs(dir.y)));
    refl += uSunCol * pow(max(dot(reflect(dir, n), uSunDir), 0.0), 40.0) * 0.8 * glass;
    uint cell = ih(uint(int(floor(g.x)) + 4096) * 7919u + uint(int(floor(g.y))) * 104729u + uint(vCol.a * 255.0) * 2654435761u + uint(floor(vW.x * 0.5)) * 31u);
    float lit = float((cell & 255u) < 80u);
    // far away the pattern is filtered: keep the average dim so towers read as dark masses with sparkle
    lit = mix(0.16, lit, k);
    vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), float((cell >> 8u & 7u) == 0u));
    vec3 wc = mix(refl * (0.55 + 0.45 * (1.0 - uNight)), warm * 1.25, lit * uNight);
    vec3 body = mix(col, col * 0.92 + refl * 0.08, glass);
    col = mix(body, wc, win * (0.85 + 0.15 * glass));
    if (glass > 0.5) col = mix(col, col * 0.75 + refl * 0.25, 1.0 - win);
  } else if (vMat == 2) {
    col += base * 0.18 * sun;                                             // leaves glow a bit in the sun
  } else if (vMat == 4) {
    col = base * (0.65 + 1.4 * uNight);
  } else if (vMat == 3) {
    col += uSunCol * pow(max(dot(reflect(dir, n), uSunDir), 0.0), 24.0) * 0.35;
  } else if (vMat == 6) {
    col = mix(base, uSkyHor, 0.35) + uSunCol * pow(max(dot(reflect(dir, n), uSunDir), 0.0), 60.0);
  }
  col *= 1.0 - 0.6 * uNight * (1.0 - float(vMat == 4));
  o = vec4(fogMix(col, dir, dist), 1.0);
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
${COMMON}
uniform mat4 uInvVP;
uniform vec4 uTown;   // x townD2, y maxD2, z seaX, w seaBx
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
int riverZ(int bx) { int t = imod(bx + 12, 48); int tri = t < 24 ? t - 12 : 36 - t; return 9 + fdiv(tri, 2); }
bool isRiver(int bx, int bz) { int a = riverZ(bx), b = riverZ(bx + 1); return (bz >= a - 1 && bz <= a + 1) || (bz >= b - 1 && bz <= b + 1); }
bool lakeAt(int bx, int bz) {
  if (bx * bx + bz * bz <= 400) return false;
  int cx = fdiv(bx, 9), cz = fdiv(bz, 9);
  uint hl = hash3(cx, cz, 9);
  if (hl % 100u >= 35u) return false;
  int lx = cx * 9 + 2 + int((hl >> 8u) % 5u), lz = cz * 9 + 2 + int((hl >> 12u) % 5u);
  if (bx == lx && bz == lz) return true;
  if (((hl >> 16u) & 1u) == 1u && bx == lx + 1 && bz == lz) return true;
  if (((hl >> 17u) & 1u) == 1u && bx == lx && bz == lz + 1) return true;
  return false;
}
// K: 0 HOMES 1 PLAZA 2 PARK 3 LAKE 4 RIVER 5 AVENUE 6 COUNTRY 7 HIGHWAY 8 PORT 9 SEA
int cellKind(int bx, int bz) {
  if (bx == 0 && bz == 0) return 1;
  if (isRiver(bx, bz)) return 4;
  if (imod(bx, 10) == 0 || imod(bz, 10) == 0) return 5;
  int d2 = bx * bx + bz * bz;
  if (d2 > 16 && hash3(bx, bz, 3) % 100u < 5u) return 2;
  if (lakeAt(bx, bz)) return 3;
  return 0;
}
int kindAt(int bx, int bz) {
  int seaBx = int(uTown.w);
  if (bx >= seaBx) return 9;
  if (bx >= seaBx - 3 && bz >= -9 && bz <= -1) return 8;
  int k = cellKind(bx, bz);
  if (float(bx * bx + bz * bz) <= uTown.x || k == 4) return k;
  if (bx == 0 || bz == 0) return 7;
  return 6;
}
int zoneLevel(int bx, int bz) {
  int j = int(hash3(bx, bz, 11) % 32u);
  int d2 = bx * bx + bz * bz;
  if (d2 < 36 + j) return 3;
  if (d2 < 144 + 3 * j) return 2;
  if (d2 < 400 + 6 * j) return 1;
  int hx = fdiv(bx + 16, 32) * 32, hz = fdiv(bz + 16, 32) * 32;
  uint hh = hash3(hx, hz, 5);
  if (hh % 4u != 0u) {
    int dx = bx - hx - (int((hh >> 4u) % 7u) - 3), dz = bz - hz - (int((hh >> 8u) % 7u) - 3);
    int dh2 = dx * dx + dz * dz;
    if (dh2 < 4 + (j >> 3)) return 3;
    if (dh2 < 20 + (j >> 1)) return 2;
    if (dh2 < 64 + j) return 1;
  }
  return 0;
}
const vec3 ROOF[8] = vec3[8](vec3(0.847,0.337,0.231), vec3(0.165,0.616,0.561), vec3(0.239,0.353,0.596), vec3(0.761,0.188,0.31),
  vec3(0.235,0.553,0.31), vec3(0.482,0.294,0.58), vec3(0.29,0.306,0.353), vec3(0.878,0.627,0.188));
bool isWater(int k) { return k == 3 || k == 4 || k == 9; }

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

// Box-filtered coverage of [-h, h] by a pixel of width w centred at x.
vec2 cover(vec2 x, vec2 h, float w) { return max(min(x + w * 0.5, h) - max(x - w * 0.5, -h), 0.0) / w; }

// Colour inside a block at local position l (-20..20). w = world size of a pixel.
vec3 blockCol(int k, int bx, int bz, vec2 l, vec2 p, float t, float hd, float w, vec3 grass) {
  vec2 al = abs(l);
  bool edge = al.x > 18.0 || al.y > 18.0;   // sidewalk ring
  vec3 walk = vec3(0.78, 0.77, 0.74);
  if (k == 0) {
    int zone = zoneLevel(bx, bz);
    vec3 lot = zone == 0 ? grass : (zone == 1 ? mix(grass, vec3(0.75, 0.72, 0.66), 0.55) : vec3(0.72, 0.71, 0.69));
    float bd2 = float(bx * bx + bz * bz);
    if (bd2 <= uTown.y && hd > uFar.x * 0.95) {
      // painted roofs far away (the meshes have sunk into the ground by now)
      int col = int(clamp(floor((l.x + 20.0) / 10.0), 0.0, 3.0));
      int row = zone == 2 ? int(clamp(floor((l.y + 20.0) / 10.0), 0.0, 3.0)) : (l.y < 0.0 ? 0 : 1);
      int slot = row * 4 + col;
      vec2 c0 = vec2(-15.0 + float(col) * 10.0, zone == 2 ? -15.0 + float(row) * 10.0 : -10.0 + float(row) * 20.0);
      vec2 hs = zone == 0 ? vec2(3.7, 4.7) : (zone == 1 ? vec2(4.7, 6.7) : (zone == 2 ? vec2(4.3) : vec2(4.6, 8.5)));
      float face = (zone == 2 ? (row < 2 ? -1.0 : 1.0) : (row == 0 ? -1.0 : 1.0));
      if (zone == 0) c0.y -= face * (10.0 - 3.0 - hs.y);
      if (zone == 1) c0.y -= face * (10.0 - 1.5 - hs.y);
      vec2 cv = cover(l - c0, hs, max(w, 0.8));
      float inside = cv.x * cv.y;
      uint rh = hash3(bx, bz, slot * 7 + 100);
      uint rb = hash3(fdiv(bx, 5), fdiv(bz, 5), 101), rv = rh % 10u;
      uint ri = (rv < 6u ? rb : rv < 9u ? rb >> 4u : rb >> 8u) % 8u;
      vec3 roof = zone <= 1 ? ROOF[ri] : vec3(0.55, 0.57, 0.6) * (0.9 + 0.2 * float(rh & 7u) / 7.0);
      if (uNight > 0.3) {
        // lit windows seen from far above: a warm speck per home, dimmer when filtered
        float on = float((rh >> 5u) % 3u == 0u);
        vec2 wc = cover(l - c0, vec2(1.2), max(w, 0.8));
        roof = mix(roof * 0.6, vec3(1.0, 0.72, 0.4) * 2.2, on * uNight * wc.x * wc.y / max(inside, 0.05));
      }
      float fadeIn = smoothstep(uFar.x, uFar.y, hd);
      // soft shadow beside each home sells the height from above
      vec2 sv = cover(l - c0 + uFar.w * vec2(0.6, 0.4), hs + 0.8, max(w, 0.8));
      lot = mix(lot, lot * 0.68, max(sv.x * sv.y - inside, 0.0) * fadeIn);
      lot = mix(lot, roof, inside * fadeIn);
    } else if (zone == 0 && w < 0.6) {
      float py = mod(l.x + 20.0, 10.0);
      lot = mix(lot, lot * 0.86, step(abs(py - 10.0 * step(5.0, py)), 0.15));
    }
    return edge ? mix(walk, lot, smoothstep(0.5, 3.0, w)) : lot;
  }
  if (k == 2) {
    float path = 1.0 - step(1.6, min(al.x, al.y));
    float ring = step(abs(length(l) - 11.0), 1.2);
    vec3 c = mix(grass * 1.05, vec3(0.86, 0.79, 0.62), max(path, ring) * (1.0 - smoothstep(1.0, 4.0, w)));
    return edge ? walk : c;
  }
  if (k == 5) {
    bool ax = imod(bx, 10) == 0, az = imod(bz, 10) == 0;
    if (ax && az) return asphalt(p, t);
    float a = abs(ax ? l.x : l.y), b = ax ? l.y : l.x;
    vec3 c;
    if (a < 3.6) c = grass * 0.95;
    else if (a < 4.1) c = walk;
    else if (a < 18.0) {
      c = asphalt(p, t);
      float lane = abs(fract((a - 4.1) / 3.475) - 0.5);
      c = mix(c, vec3(0.93), step(0.47, lane) * step(0.5, fract(b / 5.0)) * (1.0 - smoothstep(0.3, 1.2, w)));
    } else c = walk;
    return c;
  }
  if (k == 1) {
    float r = length(l);
    vec3 c = mix(vec3(0.9, 0.86, 0.8), vec3(0.82, 0.74, 0.66), step(0.5, fract(r / 4.0)) * (1.0 - smoothstep(0.5, 2.0, w)));
    return mix(c, vec3(0.95, 0.55, 0.45), step(abs(r - 17.0), 0.6));
  }
  if (k == 8) {
    float lines = step(abs(fract((l.y + 20.0) / 6.8) - 0.5), 0.02) * (1.0 - smoothstep(0.3, 1.5, w));
    return mix(vec3(0.64, 0.64, 0.62), vec3(0.95, 0.82, 0.3), lines * 0.6);
  }
  if (k == 7) {
    float a = bx == 0 ? al.x : al.y;
    return a < 0.4 && w < 1.0 ? vec3(0.92, 0.85, 0.5) : a < 9.0 ? asphalt(p, t) : grass;
  }
  // countryside: woods and a patchwork of fields
  uint hw = hash3(fdiv(bx, 3), fdiv(bz, 3), 41) % 5u;
  if (hw < 2u) return grass * vec3(0.62, 0.78, 0.6) * (0.85 + 0.3 * vnoise(p * 0.08));
  uint hf = hash3(bx, bz, 43);
  vec3 crops[5] = vec3[5](vec3(0.75, 0.82, 0.36), vec3(0.88, 0.78, 0.4), vec3(0.5, 0.72, 0.3), vec3(0.62, 0.78, 0.42), vec3(0.8, 0.66, 0.42));
  vec3 c = crops[hf % 5u];
  float rows = (hf & 32u) != 0u ? l.x : l.y;
  return c * (0.93 + 0.07 * step(0.5, fract(rows / 2.5)) * (1.0 - smoothstep(0.4, 1.2, w)));
}

bool countryish(int k) { return k == 6 || k == 8 || isWater(k); }

// Ground colour at world xz. Returns rgb; a > 0 marks water (for the lighting below).
vec4 groundBase(vec2 p, vec3 dir, float t, float hd, float w) {
  // sea and coast
  float seaX = uTown.z;
  float portMask = smoothstep(-700.0, -500.0, p.y) * (1.0 - smoothstep(20.0, 220.0, p.y));
  float shore = seaX + (sin(p.y * 0.0021) * 90.0 + sin(p.y * 0.0071 + 1.3) * 35.0 + 40.0) * (1.0 - portMask);
  if (p.x > shore) {
    vec3 deep = mix(vec3(0.07, 0.36, 0.56), vec3(0.03, 0.2, 0.38), smoothstep(0.0, 1500.0, p.x - shore));
    vec3 c = water(p, dir, t, deep);
    c = mix(vec3(0.85, 0.95, 1.0), c, clamp(smoothstep(0.0, 6.0, p.x - shore) + portMask + smoothstep(1.0, 4.0, w), 0.0, 1.0));
    return vec4(c, 1.0);
  }
  if (p.x > shore - 30.0 && portMask < 0.5) return vec4(mix(vec3(0.93, 0.85, 0.66), vec3(0.85, 0.78, 0.6), vnoise(p * 0.2)), 0.0);

  int bx = int(floor((p.x + 24.0) / 48.0)), bz = int(floor((p.y + 24.0) / 48.0));
  vec2 l = p - vec2(bx, bz) * 48.0;          // -24..24
  vec2 al = abs(l);
  int k = kindAt(bx, bz);
  if (k == 9) k = 6;
  vec3 grass = vec3(0.42, 0.7, 0.3);
  if (uFar.z > 0.5) grass *= 0.9 + 0.2 * vnoise(p * 0.05);
  vec3 wcol = vec3(0.1, 0.42, 0.55);
  if (k == 3 || k == 4) return vec4(water(p, dir, t, wcol), 1.0);

  bool inBlock = al.x < 20.0 && al.y < 20.0;
  // far away: blend block and street by how much of the pixel each covers (no shimmer)
  if (w > 2.5) {
    vec2 cv = mix(cover(l, vec2(20.0), w), vec2(40.0 / 48.0), smoothstep(10.0, 48.0, w));
    float cb = cv.x * cv.y;
    vec3 bc = blockCol(k, bx, bz, clamp(l, -19.9, 19.9), p, t, hd, w, grass);
    vec3 rc = countryish(k) && !(k == 8) ? grass * vec3(1.0, 0.98, 0.85) : (k == 8 ? vec3(0.62, 0.62, 0.6) : asphalt(p, t));
    return vec4(mix(rc, bc, cb), 0.0);
  }
  if (inBlock) return vec4(blockCol(k, bx, bz, l, p, t, hd, w, grass), 0.0);

  // road strip or intersection: look at the neighbouring blocks
  int sx = l.x >= 20.0 ? 1 : (l.x <= -20.0 ? -1 : 0);
  int sz = l.y >= 20.0 ? 1 : (l.y <= -20.0 ? -1 : 0);
  int k2 = kindAt(bx + sx, bz + sz);
  int kx = sx != 0 ? kindAt(bx + sx, bz) : k;
  int kz = sz != 0 ? kindAt(bx, bz + sz) : k;
  int nn = int(sx != 0) + int(sz != 0);
  int nw = int(isWater(k)) + int(isWater(kx)) + int(isWater(kz)) + int(isWater(k2));
  if ((nn == 1 && isWater(k) && isWater(k2)) || (nn == 2 && nw >= 3)) return vec4(water(p, dir, t, wcol), 1.0);
  bool hwy = (k == 7 || kx == 7 || kz == 7 || k2 == 7);
  if (countryish(k) && countryish(kx) && countryish(kz) && countryish(k2) && !hwy) {
    if (k == 8 && kx == 8 && kz == 8 && k2 == 8) return vec4(0.62, 0.62, 0.6, 0.0);
    return vec4(grass * vec3(1.0, 0.98, 0.85), 0.0);
  }
  vec3 c = asphalt(p, t);
  if (nn == 1 && w < 1.2) {
    // centre dashes and crosswalks
    float across = sx != 0 ? l.x - 24.0 * float(sx) : l.y - 24.0 * float(sz);
    float along = sx != 0 ? l.y : l.x;
    float fade = 1.0 - smoothstep(0.4, 1.2, w);
    float dash = step(abs(across), 0.12) * step(0.5, fract(along / 6.0)) * step(abs(along), 14.0);
    float zebra = step(14.5, abs(along)) * step(abs(along), 19.5) * step(0.5, fract(across / 1.2));
    c = mix(c, vec3(0.95, 0.88, 0.55), dash * fade);
    c = mix(c, vec3(0.92), zebra * fade);
  }
  return vec4(c, 0.0);
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
  if (dir.y > -0.0005) { o = vec4(sky(dir), 1.0); return; }
  float hd = length(p.xz - uCam.xz);
  vec4 g = groundBase(p.xz, dir, t, hd, min(w, 400.0));
  vec3 col = g.rgb;
  if (g.a < 0.5) {
    float cloud = uFar.z > 0.5 ? 0.82 + 0.18 * smoothstep(0.3, 0.7, vnoise(p.xz * 0.0018 + vec2(uTime * 0.006, 0.0))) : 1.0;
    col *= uGndCol * 0.6 + uSkyCol * 0.55 + uSunCol * max(uSunDir.y, 0.0) * 0.95 * cloud;
    if (uNight > 0.2) {
      // pools of warm street light at block corners
      vec2 c = abs(mod(p.xz + 24.0, 48.0) - 24.0) - 19.3;
      float lamp = exp(-dot(c, c) * 0.02) * uNight * (1.0 - smoothstep(600.0, 1800.0, t));
      col *= 1.0 - 0.55 * uNight;
      col += vec3(1.0, 0.7, 0.4) * lamp * 0.55;
    }
  } else col *= 1.0 - 0.6 * uNight;
  vec3 fd = dir;
  o = vec4(fogMix(col, fd, t), 1.0);
  // blend into the sky near the horizon
  o.rgb = mix(o.rgb, sky(vec3(dir.x, 0.0005, dir.z)), smoothstep(-0.02, -0.0005, dir.y));
}`;
