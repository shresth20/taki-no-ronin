import * as THREE from 'three';
import { fbm, ridged, smoothstep, lerp, clamp, saturate, vnoise } from '../core/util.js';

/* World layout (metres, +Y up, north = -Z)
   - Waterfall cliff along the north, curving round like an amphitheatre
   - Plunge pool at (0,-36), river running south past the meadow
   - Meadow / arena centred at (-12, 6)                                  */
export const WATER_Y = 0;
export const SIZE = 260;
export const HALF = SIZE / 2;
export const ARENA = { x: -12, z: 6, r: 19 };
export const PLAY = { x: -9, z: 5, r: 25.5 }; // soft player boundary
export const POOL = { x: 0, z: -36, r: 15 };
export const FALLS = { x: 0, width: 13, top: 35.4, zLip: 0, zBase: 0 }; // z values filled in below
export const TRAIN_SPOT = { x: -2.5, z: -5.5 };

const RIVER_CTRL = [[0, -36], [1.5, -25], [6, -13], [9.5, 2], [8, 16], [3, 30], [-1, 46], [1, 66], [5, 92], [6, 150]];
export const RIVER = [];
{
  const curve = new THREE.CatmullRomCurve3(RIVER_CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const n = 280;
  const pts = curve.getSpacedPoints(n);
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    RIVER.push({ x: pts[i].x, z: pts[i].z, dx: dx / l, dz: dz / l });
  }
}
const PATH_CTRL = [[-17, 36], [-15, 24], [-11, 12], [-6, 2], [-2.5, -5]];
/** the meadow path (torii to training ground) and the width it is worn to: lanterns line it (props.js) */
export const MEADOW_PATH = PATH_CTRL, MEADOW_PATH_W = 2.9;
// the gorge trail added for the journey south (vegetation keeps clear of it; the ground itself is shaped in world/nav.js)
const TRAIL_CTRL = [[-15.8, 29.5], [-15, 39], [-12, 49], [-9.6, 60], [-8.4, 70], [-7.4, 80], [-4.6, 86], [-2.9, 95], [-2.2, 104], [-1.7, 111], [-1.4, 118], [16.2, 119.2], [17.6, 126], [18.6, 134]];

export function riverNearest(x, z) {
  let best = 1e9, bi = 0;
  for (let i = 0; i < RIVER.length; i++) {
    const p = RIVER[i];
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < best) { best = d; bi = i; }
  }
  return { d: Math.sqrt(best), i: bi };
}
export const riverHalfWidth = (z) => 5.6 + 1.3 * Math.sin(z * 0.07 + 1.0);
export const cliffZ = (x) => -47 + 0.0062 * x * x + (fbm(x * 0.05, 3.7, 3) - 0.5) * 6;

FALLS.zLip = cliffZ(FALLS.x) - 4.2; // where the water leaves the plateau
FALLS.zBase = cliffZ(FALLS.x) - 0.6; // where it meets the pool

function distToPath(x, z, ctrl = PATH_CTRL) {
  let best = 1e9;
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [ax, az] = ctrl[i], [bx, bz] = ctrl[i + 1];
    const vx = bx - ax, vz = bz - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) best = d;
  }
  return best;
}

function rawHeight(x, z, rd) {
  let h = 1.0 + (fbm(x * 0.035 + 10, z * 0.035 + 20, 4) - 0.5) * 1.8;
  h += (fbm(x * 0.15, z * 0.15, 2) - 0.5) * 0.22;
  const ac = Math.hypot(x - ARENA.x, z - ARENA.z);
  const arena = 1 - smoothstep(ARENA.r - 1, ARENA.r + 11, ac);
  h = lerp(h, 0.85 + (fbm(x * 0.09, z * 0.09, 2) - 0.5) * 0.35, arena * 0.9);
  // valley walls
  const r = Math.hypot(x + 6, z);
  const valley = smoothstep(7, 28, rd);
  h += smoothstep(38, 100, r) * 28 * valley + smoothstep(33, 72, r) * fbm(x * 0.03 + 50, z * 0.03, 4) * 9 * valley;
  // river channel
  const hw = riverHalfWidth(z);
  const bank = smoothstep(hw + 3.2, hw - 0.6, rd);
  const bed = -0.38 - 0.22 * smoothstep(hw, 0, rd) + (fbm(x * 0.45, z * 0.45, 2) - 0.5) * 0.16;
  h = lerp(h, bed, bank);
  // plunge pool
  const pd = Math.hypot(x - POOL.x, z - POOL.z);
  const pool = smoothstep(POOL.r + 3, POOL.r - 2.5, pd);
  h = lerp(h, -0.45 - 2.6 * smoothstep(13, 3, pd), pool);
  // cliff plateau
  const cz = cliffZ(x);
  const c = smoothstep(cz - 4, cz - 10, z);
  h = lerp(h, 36 + (fbm(x * 0.04, z * 0.04, 3) - 0.5) * 5, c);
  return h;
}

/* ---------- precomputed grids (1 m) ---------- */
const N = SIZE + 1;
const H = new Float32Array(N * N);
const RD = new Float32Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = i - HALF, z = j - HALF;
    const rd = riverNearest(x, z).d;
    RD[j * N + i] = rd;
    H[j * N + i] = rawHeight(x, z, rd);
  }
}
function sample(grid, x, z) {
  const fx = clamp(x + HALF, 0, SIZE - 0.001), fz = clamp(z + HALF, 0, SIZE - 0.001);
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const a = grid[iz * N + ix], b = grid[iz * N + ix + 1], c = grid[(iz + 1) * N + ix], d = grid[(iz + 1) * N + ix + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}
/** the valley exactly as it was first built (zone 00's own heightfield) */
export const legacyHeightAt = (x, z) => sample(H, x, z);
/** final ground height. The navigation module swaps in the stitched six-zone world (see world/nav.js). */
export let heightAt = legacyHeightAt;
/** the ground as it lay before later cuts through it (the gorge). The valley's planting was laid out on this and must not move */
export let plantingHeightAt = legacyHeightAt;
export function setHeightProvider(fn, planting = fn) { heightAt = fn; plantingHeightAt = planting; }
export const riverDistAt = (x, z) => sample(RD, x, z);
export const waterDepthAt = (x, z) => WATER_Y - heightAt(x, z);
export function slopeAt(x, z, hf = heightAt) {
  const e = 0.8;
  const dx = hf(x + e, z) - hf(x - e, z), dz = hf(x, z + e) - hf(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}
export const inArena = (x, z, pad = 0) => Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + pad;
export const legacyPathDist = (x, z) => distToPath(x, z);
export const trailDist = (x, z) => Math.min(distToPath(x, z, TRAIL_CTRL) - 1.2, Math.hypot(x + 15.5, z - 55.5) - 3.5);
export const pathDist = (x, z) => Math.min(distToPath(x, z), distToPath(x, z, TRAIL_CTRL) - 1.2, Math.hypot(x + 15.5, z - 55.5) - 3.5);

/* ---------- terrain mesh ---------- */
export function buildTerrainGeometry() {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SIZE, SIZE);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), t = new THREE.Color();
  const grassA = new THREE.Color('#76b040'), grassB = new THREE.Color('#3f8c44'), gold = new THREE.Color('#bfb24a');
  const forest = new THREE.Color('#3c7a3c'), sand = new THREE.Color('#cdbd8c'), wet = new THREE.Color('#8d8866');
  const bed = new THREE.Color('#7fa08a'), deep = new THREE.Color('#2f6a70'), rock = new THREE.Color('#6d8983');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n1 = fbm(x * 0.06 + 3, z * 0.06 + 7, 3), n2 = fbm(x * 0.021 + 30, z * 0.021 + 11, 3);
    c.copy(grassA).lerp(grassB, smoothstep(0.35, 0.7, n1));
    c.lerp(gold, smoothstep(0.56, 0.72, n2) * 0.75);
    const ac = Math.hypot(x - ARENA.x, z - ARENA.z);
    c.lerp(forest, smoothstep(ARENA.r + 2, ARENA.r + 14, ac) * 0.75);
    // the paths are painted per pixel by the worn-ground shader (world/paths.js), not into these vertex colours
    c.lerp(sand, 1 - smoothstep(0.18, 0.55, y + (n1 - 0.5) * 0.25));
    c.lerp(wet, 1 - smoothstep(-0.02, 0.14, y));
    if (y < 0) c.copy(bed).lerp(deep, smoothstep(-0.3, -2.2, y)).multiplyScalar(0.92 + n1 * 0.2);
    const slope = 1 - nrm.getY(i);
    c.lerp(t.copy(rock).multiplyScalar(0.8 + n1 * 0.4), smoothstep(0.22, 0.42, slope));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/* ---------- water data texture: R height, G/B flow, A foam source ---------- */
export const WATER_RECT = { x0: -62, x1: 62, z0: -58, z1: 150 };
export function buildWaterDataTexture(rocks = []) {
  const W = 256, Hh = 512;
  const data = new Uint16Array(W * Hh * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  const { x0, x1, z0, z1 } = WATER_RECT;
  for (let j = 0; j < Hh; j++) {
    for (let i = 0; i < W; i++) {
      const x = lerp(x0, x1, (i + 0.5) / W), z = lerp(z0, z1, (j + 0.5) / Hh);
      let h = heightAt(x, z);
      for (const r of rocks) {
        const d = Math.hypot(x - r.x, z - r.z);
        if (d < r.r * 1.15) h = Math.max(h, (1 - d / (r.r * 1.15)) * r.r * 0.9);
      }
      const near = riverNearest(x, z);
      const p = RIVER[near.i];
      const hw = riverHalfWidth(z);
      let speed = 0.55 + 0.75 * smoothstep(hw, 0, near.d);
      let fx = p.dx * speed, fz = p.dz * speed;
      // plunge pool: push outward from the falls, then drain toward the river
      const pdx = x - FALLS.x, pdz = z - (FALLS.zBase + 1.2);
      const pd = Math.hypot(pdx, pdz);
      const inPool = smoothstep(POOL.r + 4, POOL.r - 4, Math.hypot(x - POOL.x, z - POOL.z));
      const ox = (pdx / (pd + 0.01)) * 0.55, oz = (pdz / (pd + 0.01)) * 0.55;
      const k = inPool * smoothstep(22, 4, pd);
      fx = lerp(fx, ox, k);
      fz = lerp(fz, oz, k);
      const foam = saturate(1.25 - pd / 7.5) * smoothstep(FALLS.width * 0.75, FALLS.width * 0.35, Math.abs(pdx));
      const o = (j * W + i) * 4;
      data[o] = toHalf(h);
      data[o + 1] = toHalf(fx);
      data[o + 2] = toHalf(fz);
      data[o + 3] = toHalf(foam);
    }
  }
  const tex = new THREE.DataTexture(data, W, Hh, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/* ---------- cliff face (separate craggy mesh in front of the plateau) ---------- */
export function cliffDisplace(u, v) {
  // u along the wall, v height. returns outward (toward +z) offset
  const warp = fbm(u * 0.03, v * 0.02, 2) * 2.2;
  const columns = ridged(u * 0.11 + warp, v * 0.028, 3); // vertical buttresses and fractures
  const st = (((v / 6.5 + fbm(u * 0.035, 1.3, 2) * 1.6) % 1) + 1) % 1; // strata: each band steps out at its foot
  const ledge = smoothstep(0.0, 0.1, st) * (1 - st);
  let d = (fbm(u * 0.07, v * 0.1, 4) - 0.5) * 5 + (columns - 0.35) * 5.5 + ledge * 2.6;
  d += (1 - smoothstep(0, 12, v)) * 3.2; // wider foot
  const notch = 1 - smoothstep(FALLS.width * 0.42, FALLS.width * 0.8, Math.abs(u - FALLS.x));
  d = lerp(d, -1.6 + (fbm(u * 0.3, v * 0.2, 2) - 0.5) * 1.2, notch * 0.9); // channel worn by the water
  return d;
}
export function buildCliffGeometry() {
  const U0 = -92, U1 = 92, V0 = -3.5, V1 = 38.5, nu = 230, nv = 56;
  const geo = new THREE.PlaneGeometry(1, 1, nu, nv);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const disp = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const u = lerp(U0, U1, pos.getX(i) + 0.5), v = lerp(V0, V1, pos.getY(i) + 0.5);
    const d = cliffDisplace(u, v);
    disp[i] = d;
    let z = cliffZ(u) - 1.2 + d;
    const lip = smoothstep(33.5, 38.5, v);
    z -= lip * lip * 8; // round the top back onto the plateau
    // the river has cut a notch into the rim; shoulders of rock stand either side of it
    const au = Math.abs(u - FALLS.x);
    const cut = (1 - smoothstep(FALLS.width * 0.46, FALLS.width * 0.62, au)) * 2.6 * smoothstep(26, 36, v);
    const horn = Math.exp(-Math.pow((au - FALLS.width * 0.78) / 2.6, 2)) * 3.2 * smoothstep(24, 36, v);
    pos.setXYZ(i, u, v - lip * 1.2 - cut + horn, z + horn * 0.5);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const rockA = new THREE.Color('#7b9ea4'), rockB = new THREE.Color('#4a7482'), rockC = new THREE.Color('#b9cbb9'), dark = new THREE.Color('#27485a');
  const moss = new THREE.Color('#5f9c3c'), mossB = new THREE.Color('#b3bf46'), wetc = new THREE.Color('#2c5663');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const n = fbm(x * 0.07, y * 0.11, 3), n2 = fbm(x * 0.2 + 9, y * 0.2, 2);
    c.copy(rockA).lerp(rockB, smoothstep(0.35, 0.7, n)).lerp(rockC, smoothstep(0.6, 0.8, n2) * 0.55);
    c.lerp(dark, smoothstep(0.5, -3.0, disp[i]) * 0.75); // recesses fall into shadow
    const up = nrm.getY(i);
    c.lerp(moss, smoothstep(0.3, 0.62, up + (n2 - 0.5) * 0.4) * 0.92);
    c.lerp(mossB, smoothstep(0.55, 0.8, up) * smoothstep(0.45, 0.65, n) * 0.7);
    c.lerp(moss, smoothstep(32, 37, y) * 0.85);
    const wetK = (1 - smoothstep(FALLS.width * 0.5, FALLS.width * 0.95, Math.abs(x - FALLS.x))) * 0.7 + (1 - smoothstep(0.2, 2.2, y)) * 0.6;
    c.lerp(wetc, saturate(wetK));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const flat = geo.toNonIndexed(); // faceted planes read as hand-cut rock under toon light
  flat.computeVertexNormals();
  return flat;
}

/* ---------- coarse trimesh of the play area for Rapier debris ---------- */
export function buildCollisionGrid(step = 2, range = 44) {
  const cx = PLAY.x, cz = PLAY.z;
  const n = Math.floor((range * 2) / step) + 1;
  const verts = new Float32Array(n * n * 3);
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = cx - range + i * step, z = cz - range + j * step;
      verts.set([x, Math.max(heightAt(x, z), WATER_Y - 0.35), z], (j * n + i) * 3);
    }
  }
  let o = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.set([a, c, b, b, c, d], o);
      o += 6;
    }
  }
  return { verts, idx };
}
export { vnoise };
