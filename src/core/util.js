import * as THREE from 'three';

/* ---------- scalar helpers ---------- */
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (x) => clamp(x, 0, 1);
export const smoothstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const dampV = (v, target, k, dt) => v.lerp(target, 1 - Math.exp(-k * dt));
export const wrapAngle = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
export const angleDiff = (from, to) => wrapAngle(to - from);
export const dampAngle = (a, b, k, dt) => a + angleDiff(a, b) * (1 - Math.exp(-k * dt));
export const DEG = Math.PI / 180;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

/* ---------- deterministic rng ---------- */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = mulberry32(20261124);
export const rrange = (a, b, r = rand) => a + (b - a) * r();
export const rpick = (arr, r = rand) => arr[Math.floor(r() * arr.length)];

/* ---------- CPU value noise / fbm (terrain, placement) ---------- */
function hash2(ix, iy) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
export function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}
export function ridged(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1);
    s += a * v * v;
    n += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / n;
}

/* ---------- shared textures ---------- */
function periodicNoise(size, period, seed) {
  // tileable value noise lattice
  const r = mulberry32(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period, fy = (y / size) * period;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
      const x1 = (ix + 1) % period, y1 = (iy + 1) % period;
      const a = g[iy * period + ix], b = g[iy * period + x1], c = g[y1 * period + ix], d = g[y1 * period + x1];
      out[y * size + x] = lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
    }
  }
  return out;
}
function periodicFbm(size, basePeriod, oct, seed) {
  const out = new Float32Array(size * size);
  let amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    const n = periodicNoise(size, basePeriod << o, seed + o * 17);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}
function periodicWorley(size, cells, seed) {
  const r = mulberry32(seed);
  const pts = [];
  for (let i = 0; i < cells * cells; i++) pts.push([r(), r()]);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const cx = Math.floor(fx), cy = Math.floor(fy);
      let d1 = 9, d2 = 9;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const nx = cx + i, ny = cy + j;
          const p = pts[((ny + cells) % cells) * cells + ((nx + cells) % cells)];
          const dx = nx + p[0] - fx, dy = ny + p[1] - fy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
      }
      out[y * size + x] = saturate(d2 - d1); // cell edges -> 0 (caustic lines)
    }
  }
  return out;
}

let _noiseTex = null;
/** R: low fbm, G: mid fbm, B: cell-edge (caustic) pattern, A: fine noise. Tileable. */
export function getNoiseTexture() {
  if (_noiseTex) return _noiseTex;
  const S = 256;
  const r = periodicFbm(S, 4, 5, 11), g = periodicFbm(S, 8, 4, 53), b = periodicWorley(S, 7, 97), a = periodicFbm(S, 32, 2, 151);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = Math.round(saturate((r[i] - 0.5) * 1.9 + 0.5) * 255);
    data[i * 4 + 1] = Math.round(saturate((g[i] - 0.5) * 1.9 + 0.5) * 255);
    data[i * 4 + 2] = Math.round(b[i] * 255);
    data[i * 4 + 3] = Math.round(a[i] * 255);
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  _noiseTex = t;
  return t;
}

const _ramps = {};
/** Stepped light ramp for MeshToonMaterial.gradientMap */
export function getToonRamp(key = 'char') {
  if (_ramps[key]) return _ramps[key];
  const stops = key === 'char' ? [0.42, 0.42, 0.72, 1.0, 1.0] : key === 'soft' ? [0.45, 0.58, 0.74, 0.9, 1.0, 1.0] : [0.5, 0.75, 1.0];
  const data = new Uint8Array(stops.length * 4);
  stops.forEach((s, i) => {
    const v = Math.round(s * 255);
    data.set([v, v, v, 255], i * 4);
  });
  const t = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  _ramps[key] = t;
  return t;
}

function canvasTex(size, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const _tex = {};
export function getSoftTexture() {
  return (_tex.soft ??= canvasTex(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, { linear: true }));
}
export function getPetalTexture() {
  return (_tex.petal ??= canvasTex(64, (ctx, s) => {
    ctx.translate(s / 2, s / 2);
    const g = ctx.createLinearGradient(0, -s * 0.45, 0, s * 0.45);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.6, '#ffd3e2');
    g.addColorStop(1, '#ff9dbf');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.44);
    ctx.bezierCurveTo(s * 0.42, s * 0.18, s * 0.34, -s * 0.36, s * 0.06, -s * 0.4);
    ctx.lineTo(0, -s * 0.3);
    ctx.lineTo(-s * 0.06, -s * 0.4);
    ctx.bezierCurveTo(-s * 0.34, -s * 0.36, -s * 0.42, s * 0.18, 0, s * 0.44);
    ctx.fill();
  }));
}
export function getLeafTexture() {
  return (_tex.leaf ??= canvasTex(64, (ctx, s) => {
    ctx.translate(s / 2, s / 2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, s * 0.46);
    ctx.quadraticCurveTo(s * 0.3, 0, 0, -s * 0.46);
    ctx.quadraticCurveTo(-s * 0.3, 0, 0, s * 0.46);
    ctx.fill();
  }, { linear: true }));
}
/** four-point glint star used for weapon telegraphs and impact flashes */
export function getGlintTexture() {
  return (_tex.glint ??= canvasTex(128, (ctx, s) => {
    const c = s / 2;
    ctx.globalCompositeOperation = 'lighter';
    const rg = ctx.createRadialGradient(c, c, 0, c, c, c * 0.5);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, s, s);
    for (let k = 0; k < 2; k++) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate((k * Math.PI) / 2);
      const lg = ctx.createLinearGradient(-c, 0, c, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,1)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(-c, 0);
      ctx.quadraticCurveTo(0, -s * 0.035, c, 0);
      ctx.quadraticCurveTo(0, s * 0.035, -c, 0);
      ctx.fill();
      ctx.restore();
    }
  }, { linear: true }));
}

/**
 * Painterly brush texture used triplanar on rock, cliff and ground.
 * Generated procedurally; can be swapped for a hand-painted image (see assets/paint.js).
 */
export function getPaintTexture() {
  if (_tex.paint) return _tex.paint;
  _tex.paint = canvasTex(512, (ctx, s) => {
    const r = mulberry32(77);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const x = r() * s, y = r() * s, len = 30 + r() * 90, w = 5 + r() * 22;
      const ang = (r() - 0.5) * 1.1 + (r() < 0.25 ? Math.PI / 2 : 0);
      const v = Math.round(128 + (r() - 0.5) * 120);
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.12 + r() * 0.2})`;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      for (let ox = -s; ox <= s; ox += s) {
        for (let oy = -s; oy <= s; oy += s) {
          ctx.beginPath();
          ctx.moveTo(x + ox, y + oy);
          ctx.quadraticCurveTo(x + ox + Math.cos(ang) * len * 0.5 + (r() - 0.5) * 20, y + oy + Math.sin(ang) * len * 0.5, x + ox + Math.cos(ang) * len, y + oy + Math.sin(ang) * len);
          ctx.stroke();
        }
      }
    }
  }, { linear: true, repeat: true });
  _tex.paint.minFilter = THREE.LinearMipmapLinearFilter;
  return _tex.paint;
}
/** swap the procedural brush texture for a painted image (normalised so its average is mid-grey) */
export function setPaintTextureFromImage(img) {
  const t = getPaintTexture();
  t.image = img;
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; // hides the seams of a non-tiling painting
  t.needsUpdate = true;
}

/* ---------- material patch helper ---------- */
/**
 * Inject GLSL into a built-in material. All patched materials share `uTime`.
 * opts: { uniforms, vHead, vBegin (after begin_vertex), fHead, fColor (after color_fragment), fEnd (before dithering), key }
 */
export const sharedUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector4(1, 0.3, 1.0, 0) }, // dir.x, dir.z, strength, unused
  uPlayerPos: { value: new THREE.Vector3() },
  uNoise: { value: null },
  uPaint: { value: null },
};
export function patchMaterial(mat, opts) {
  const key = opts.key || Math.random().toString(36);
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWind = sharedUniforms.uWind;
    shader.uniforms.uPlayerPos = sharedUniforms.uPlayerPos;
    shader.uniforms.uNoise = sharedUniforms.uNoise;
    shader.uniforms.uPaint = sharedUniforms.uPaint;
    if (opts.uniforms) Object.assign(shader.uniforms, opts.uniforms);
    const common = 'uniform float uTime;\nuniform vec4 uWind;\nuniform vec3 uPlayerPos;\nuniform sampler2D uNoise;\nuniform sampler2D uPaint;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + common + (opts.vHead || ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (opts.vBegin || ''))
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          vWPos = wp.xyz;
          vWNrm = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + common + (opts.fHead || ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (opts.fColor || ''))
      .replace('#include <dithering_fragment>', (opts.fEnd || '') + '\n#include <dithering_fragment>');
    mat.userData.shader = shader;
  };
  return mat;
}

/** GLSL: triplanar sample of the paint texture, returns a multiplier around 1.0 */
export const GLSL_PAINT = `
float paintTri(vec3 p, vec3 n, float scale){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-4);
  const vec3 L = vec3(0.3333);
  float a = dot(texture2D(uPaint, p.zy * scale).rgb, L);
  float b = dot(texture2D(uPaint, p.xz * scale).rgb, L);
  float c = dot(texture2D(uPaint, p.xy * scale).rgb, L);
  return (a * w.x + b * w.y + c * w.z) * 2.0;
}
vec3 paintTriRGB(vec3 p, vec3 n, float scale){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-4);
  vec3 a = texture2D(uPaint, p.zy * scale).rgb;
  vec3 b = texture2D(uPaint, p.xz * scale).rgb;
  vec3 c = texture2D(uPaint, p.xy * scale).rgb;
  return (a * w.x + b * w.y + c * w.z) * 2.0;
}
`;

/* ---------- geometry helpers ---------- */
/** merge an array of {geometry, matrix?, color?} (non-skinned) into one BufferGeometry with vertex colors */
export function mergeColored(parts) {
  let vCount = 0, iCount = 0;
  for (const p of parts) {
    vCount += p.geometry.attributes.position.count;
    iCount += p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3(), c = new THREE.Color();
  for (const p of parts) {
    const g = p.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color;
    if (p.matrix) nm.getNormalMatrix(p.matrix);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (p.matrix) v.applyMatrix4(p.matrix);
      pos.set([v.x, v.y, v.z], (vo + i) * 3);
      if (N) {
        v.fromBufferAttribute(N, i);
        if (p.matrix) v.applyMatrix3(nm).normalize();
        nrm.set([v.x, v.y, v.z], (vo + i) * 3);
      }
      if (U) uv.set([U.getX(i), U.getY(i)], (vo + i) * 2);
      if (C) c.setRGB(C.getX(i), C.getY(i), C.getZ(i));
      else if (typeof p.color === 'function') p.color(c, v.fromBufferAttribute(P, i), i);
      else c.set(p.color ?? 0xffffff);
      if (C && p.color != null && typeof p.color !== 'function') c.multiply(new THREE.Color(p.color));
      col.set([c.r, c.g, c.b], (vo + i) * 3);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < P.count; i++) idx[io++] = vo + i;
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export const M4 = (px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
