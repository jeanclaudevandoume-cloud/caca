// GL helpers and pure matrix maths. No DOM. Matrices write into preallocated arrays: the frame loop allocates
// nothing.
export const hyp2 = (a, b) => Math.sqrt(a * a + b * b);
export const hyp3 = (a, b, c) => Math.sqrt(a * a + b * b + c * c);

const M_PROJ = new Float32Array(16), M_VIEW = new Float32Array(16), M_VP = new Float32Array(16), M_INV = new Float32Array(16);
const INV64 = new Float64Array(16);
// vertical field of view: 60° in portrait; 46° in landscape, where 60° meant a 104° fish-eye across a wide phone
// (the arrival home came out small and the far ring paid for chunks at the screen edges). view.js frames with it.
export const vfovFor = (aspect) => (aspect > 1.2 ? 46 : 60) * Math.PI / 180;
export function persp(fovy, aspect, n, f) {
  const t = 1 / Math.tan(fovy / 2), o = M_PROJ;
  o.fill(0); o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f);
  return o;
}
export function lookDir(e, f) {
  let sx = -f[2], sz = f[0]; const sl = hyp2(sx, sz) || 1; sx /= sl; sz /= sl;   // side = f x up
  const ux = -sz * f[1], uy = sz * f[0] - sx * f[2], uz = sx * f[1];               // up = side x f
  const o = M_VIEW;
  o[0] = sx; o[1] = ux; o[2] = -f[0]; o[3] = 0; o[4] = 0; o[5] = uy; o[6] = -f[1]; o[7] = 0; o[8] = sz; o[9] = uz; o[10] = -f[2]; o[11] = 0;
  o[12] = -(sx * e[0] + sz * e[2]); o[13] = -(ux * e[0] + uy * e[1] + uz * e[2]); o[14] = f[0] * e[0] + f[1] * e[1] + f[2] * e[2]; o[15] = 1;
  return o;
}
export function mul(a, b, o = M_VP) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
export function invert(m) {
  const inv = INV64;
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = 1 / (m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12]);
  const o = M_INV;
  for (let i = 0; i < 16; i++) o[i] = inv[i] * det;
  return o;
}
const PLANES = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
const PLANE_IDX = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1]];
export function planes(m) {
  for (let k = 0; k < 5; k++) {
    const i = PLANE_IDX[k][0], s = PLANE_IDX[k][1];
    const a = m[3] + s * m[i], b = m[7] + s * m[4 + i], c = m[11] + s * m[8 + i], d = m[15] + s * m[12 + i];
    const l = hyp3(a, b, c), p = PLANES[k];
    p[0] = a / l; p[1] = b / l; p[2] = c / l; p[3] = d / l;
  }
  return PLANES;
}
export function inFrustum(pl, x, y, z, r) {
  for (let i = 0; i < 5; i++) { const p = pl[i]; if (p[0] * x + p[1] * y + p[2] * z + p[3] <= -r) return false; }
  return true;
}
export function mulv(m, v, o = [0, 0, 0, 0]) { for (let r = 0; r < 4; r++) o[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]; return o; }

// Shader programs and mesh buffers on one GL context. `fail` reports a compile/link error on screen.
export function createGfx(gl, fail) {
  function prog(vs, fs) {
    const p = gl.createProgram();
    for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(t);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && gl.isContextLost()) throw new Error('context lost');   // the reload handles it
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { fail('Shader compile failed: ' + gl.getShaderInfoLog(s)); throw new Error(gl.getShaderInfoLog(s)); }
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { fail('Shader link failed: ' + gl.getProgramInfoLog(p)); throw new Error(gl.getProgramInfoLog(p)); }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }
  function upload(m) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, m.vb, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.SHORT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.UNSIGNED_BYTE, false, 16, 6);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.BYTE, true, 16, 8);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, false, 16, 11);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, 16, 12);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.ib, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, n: m.ib.length - (m.so || 0), so: (m.so || 0) * m.ib.BYTES_PER_ELEMENT, nso: m.so || 0, ns: m.ns, ymax: m.ymax, it: m.ib.BYTES_PER_ELEMENT === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT, bytes: m.vb.byteLength + m.ib.byteLength };
  }
  function release(g) { if (!g) return; gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.vbo); gl.deleteBuffer(g.ibo); }
  return { prog, upload, release };
}
