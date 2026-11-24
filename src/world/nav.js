import { ZONES } from './zones/index.js';
import { footprint } from './zones/footprints.js';
import { legacyHeightAt, setHeightProvider, cliffZ, WATER_Y } from './terrain.js';
import { fbm, ridged, smoothstep, lerp, clamp } from '../core/util.js';

/* World navigation: one continuous ground for all six zones.

   Every zone file lists walkable shapes (circles, boxes, paths, decks, stairs), water and pads. From those this module derives
     terrainAt(x,z)   ground height without bridges            (meshes, planting)
     groundAt(x,z)    what feet stand on, bridges included      (characters, camera, effects)
     walkAt(x,z)      signed distance to the walkable area      (< 0 = inside)
   Each is baked once into a 1 m grid per zone, so run-time queries are a bilinear lookup.
   Zone 00 keeps its original heightfield; the new trail is blended into it and the valley fades into the new world at its south edge. */

const INFL = 64; // how far a shape influences the ground around it
let _y = 0; // height at the nearest point of the last shape tested

/* ---------- shape compilation ---------- */
function compile(s, zone, role) {
  const g = zone.ground;
  const c = { ...s, zi: zone.index, role, g, edge: { mode: g.edge, ...g, ...(s.edge || {}) } };
  if (s.t === 'paddy') { c.depth = 0.3; c.bank = 0.9; }
  if (s.t === 'circle' || s.t === 'pond') c.bb = [s.x - s.r, s.x + s.r, s.z - s.r, s.z + s.r];
  else if (s.t === 'box' || s.t === 'paddy') {
    c.cos = Math.cos(s.rot || 0); c.sin = Math.sin(s.rot || 0);
    const r = Math.hypot(s.w, s.d) / 2;
    c.bb = [s.x - r, s.x + r, s.z - r, s.z + r];
  } else {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of s.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const h = s.w / 2;
    c.bb = [x0 - h, x1 + h, z0 - h, z1 + h];
  }
  return c;
}
function sdBox(c, x, z) {
  const dx = x - c.x, dz = z - c.z;
  const qx = Math.abs(dx * c.cos - dz * c.sin) - c.w / 2, qz = Math.abs(dx * c.sin + dz * c.cos) - c.d / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}
function sdPoly(c, x, z) {
  let best = 1e18, by = 0;
  const P = c.pts;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1);
    const ex = x - a[0] - vx * t, ez = z - a[1] - vz * t, d = ex * ex + ez * ez;
    if (d < best) { best = d; by = a.length > 2 ? a[2] + (b[2] - a[2]) * t : 0; }
  }
  _y = by;
  return Math.sqrt(best);
}
/** signed distance to a walk / pad shape; leaves the shape's height at that point in _y */
function sd(c, x, z) {
  if (c.t === 'circle') { _y = c.y; return Math.hypot(x - c.x, z - c.z) - c.r; }
  if (c.t === 'box') { _y = c.y; return sdBox(c, x, z); }
  return sdPoly(c, x, z) - c.w / 2;
}
function edgeHeight(e, d) {
  switch (e.mode) {
    case 'rise': return Math.min(d, 3) * 0.3 + e.rise * smoothstep(1.2, e.reach, d);
    case 'drop': return -Math.max(0, d - e.shoulder) * e.slope;
    case 'bank': return e.bankH * smoothstep(0.5, 2.6, d) + 1.4 * smoothstep(5, 18, d);
    default: return 0;
  }
}

/* ---------- compiled world ---------- */
const SHAPES = []; // walk + pad shapes that shape the ground
const DECKS = [];
const WATER = [];
const RIDGES = [];
let LEGACY = null;
for (const z of ZONES) {
  for (const s of z.walk) {
    const c = compile(s, z, 'walk');
    if (s.legacy) LEGACY = c;
    else if (s.deck) DECKS.push(c);
    else SHAPES.push(c);
  }
  for (const s of z.pads || []) SHAPES.push(compile(s, z, 'pad'));
  for (const s of z.water || []) WATER.push(compile(s, z, 'water'));
  for (const r of z.terrain || []) if (r.op === 'ridge') RIDGES.push(compile({ t: 'ridge', ...r, w: (r.w || 12) * 6 }, z, 'ridge'));
}
const near = (c, x, z, m) => x > c.bb[0] - m && x < c.bb[1] + m && z > c.bb[2] - m && z < c.bb[3] + m;

function waterSurface(c, x, z) {
  if (c.weir && z < c.weir.z) return c.y + c.weir.drop * smoothstep(c.weir.z, c.weir.z - 0.8, z);
  return c.y;
}
/** signed distance to a water body's edge (negative inside) */
function sdWater(c, x, z) {
  if (c.t === 'pond') return Math.hypot(x - c.x, z - c.z) - c.r;
  if (c.t === 'paddy') return sdBox(c, x, z);
  return sdPoly(c, x, z) - c.w / 2;
}

const E = { t: 0, g: 0, w: 0, wd: 0, wy: -1e9, deck: false, surf: 0 };
const SURF = { grass: 0, dirt: 1, paved: 2, leaf: 3, moss: 4, gravel: 5, wood: 6, arena: 7 };
const Z0 = ZONES[0].rect;

/** evaluate everything at one point (analytic, slow: used for baking only) */
function evalPoint(x, z, zone) {
  // --- new world ground ---
  let ws = 1e-7, ys = 1e-7 * zone.ground.base, es = 0, fs = 1e-7 * zone.ground.floor, ns = 1e-7 * zone.ground.noise;
  let dWalk = 1e9, dAll = 1e9, surf = 0;
  for (const c of SHAPES) {
    if (!near(c, x, z, INFL)) continue;
    const d = sd(c, x, z), dp = Math.max(d, 0);
    if (dp > INFL) continue;
    if (c.role === 'walk' && d < dWalk) { dWalk = d; if (d < 0.6) surf = SURF[c.surface] ?? (c.stairs ? 2 : 1); }
    if (d < dAll) dAll = d;
    const q = dp + 0.35;
    const w = (1 / (q * q * q)) * smoothstep(INFL, INFL * 0.55, dp);
    ws += w; ys += w * _y; es += w * edgeHeight(c.edge, dp); fs += w * c.g.floor; ns += w * c.g.noise;
  }
  const dOut = Math.max(dAll, 0);
  let h = ys / ws + es / ws;
  const amp = (ns / ws) * smoothstep(1.2, 10, dOut);
  h += (fbm(x * 0.043 + 17.3, z * 0.043 + 5.1, 3) - 0.5) * 2 * amp + (fbm(x * 0.21, z * 0.21 + 9, 2) - 0.5) * 0.3 * smoothstep(0.4, 3, dOut);
  for (const r of RIDGES) {
    if (!near(r, x, z, 0)) continue;
    const d = sdPoly(r, x, z) / (r.w / 6);
    h += r.h * Math.exp(-d * d) * (0.72 + 0.56 * ridged(x * 0.03 + 3, z * 0.03 + 8, 3)) * smoothstep(2, 12, dOut);
  }
  const fb = fs / ws;
  const floor = fb + (fbm(x * 0.03 + 40, z * 0.03 + 60, 3) - 0.5) * 2 * Math.min(1.2, fb * 0.75);
  if (h < floor) h = floor + (h - floor) * 0.04;

  // --- zone 00: keep the original valley, blend the new shapes and the southern hand-over into it ---
  let inLegacy = false;
  if (x >= Z0.x0 && x <= Z0.x1 && z >= Z0.z0 && z <= Z0.z1) {
    const k = Math.max(smoothstep(104, 128, z), smoothstep(4.6, 0.5, dAll));
    const lh = legacyHeightAt(x, z);
    h = k >= 1 ? h : lerp(lh, h, k);
    inLegacy = true;
    if (dWalk > 0.6) surf = 0;
  }

  // --- water carves the ground ---
  let dWater = 1e9, wy = -1e9;
  for (const c of WATER) {
    if (!near(c, x, z, 8)) continue;
    const d = sdWater(c, x, z);
    const lvl = waterSurface(c, x, z);
    if (!c.legacy || z > 128) {
      const k = smoothstep(c.bank, -0.4, d);
      if (k > 0) h = lerp(h, lvl - c.depth * (0.55 + 0.45 * smoothstep(0, -c.w * 0.4 || -3, d)), k);
    }
    if (d < 0 && lvl > wy) wy = lvl;
    if (!c.wade && d < dWater) dWater = d;
  }
  if (inLegacy && z < 150 && h < WATER_Y) wy = Math.max(wy, WATER_Y);

  // --- walk mask ---
  let w = Math.max(dWalk, 0.25 - dWater);
  if (LEGACY && inLegacy) {
    const dl = Math.max(Math.hypot(x - LEGACY.x, z - LEGACY.z) - LEGACY.r, cliffZ(x) + 4 - z);
    w = Math.min(w, dl);
    w = Math.max(w, (-0.95 - h) * 1.5); // the old rule: no wading past waist depth
  }
  let g = h, deck = false;
  for (const c of DECKS) {
    if (!near(c, x, z, 1.2)) continue;
    const d = sd(c, x, z);
    if (d < w) w = d;
    if (d < 0.9) { g = Math.max(_y, h); deck = true; if (d < 0.3) surf = 6; }
  }
  E.t = h; E.g = g; E.w = w; E.wy = wy; E.deck = deck; E.surf = surf; E.wd = dWater;
  return E;
}

/* ---------- baked grids ---------- */
const GRIDS = ZONES.map((zone) => {
  const { x0, x1, z0, z1 } = zone.rect;
  const nx = x1 - x0 + 1, nz = z1 - z0 + 1;
  const T = new Float32Array(nx * nz), G = new Float32Array(nx * nz), W = new Float32Array(nx * nz), L = new Float32Array(nx * nz), S = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i, z = z0 + j, o = j * nx + i;
      if (zone.legacy && z < 24) {
        // far from anything new: the original valley, untouched
        const h = legacyHeightAt(x, z);
        T[o] = G[o] = h;
        W[o] = Math.max(Math.max(Math.hypot(x - LEGACY.x, z - LEGACY.z) - LEGACY.r, cliffZ(x) + 4 - z), (-0.95 - h) * 1.5);
        L[o] = h < WATER_Y ? WATER_Y : -1e9;
        continue;
      }
      const e = evalPoint(x, z, zone);
      T[o] = e.t; G[o] = e.g; W[o] = clamp(e.w, -30, 30); L[o] = e.deck ? -1e9 : e.wy; S[o] = e.surf;
    }
  }
  return { x0, z0, nx, nz, T, G, W, L, S };
});

let last = 0;
function zoneIndexAt(x, z) {
  let r = ZONES[last].rect;
  if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return last;
  let best = 0, bd = 1e9;
  for (let i = 0; i < ZONES.length; i++) {
    r = ZONES[i].rect;
    const d = Math.max(r.x0 - x, x - r.x1, r.z0 - z, z - r.z1);
    if (d <= 0) return (last = i);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function sample(a, g, x, z) {
  const fx = clamp(x - g.x0, 0, g.nx - 1.001), fz = clamp(z - g.z0, 0, g.nz - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, o = iz * g.nx + ix;
  return lerp(lerp(a[o], a[o + 1], tx), lerp(a[o + g.nx], a[o + g.nx + 1], tx), tz);
}
export const terrainAt = (x, z) => { const g = GRIDS[zoneIndexAt(x, z)]; return sample(g.T, g, x, z); };
export const groundAt = (x, z) => { const g = GRIDS[zoneIndexAt(x, z)]; return sample(g.G, g, x, z); };
/** water surface height above this point, or a large negative number on dry ground / bridges */
export function waterLevelAt(x, z) {
  const g = GRIDS[zoneIndexAt(x, z)];
  const ix = clamp(Math.round(x - g.x0), 0, g.nx - 1), iz = clamp(Math.round(z - g.z0), 0, g.nz - 1);
  return g.L[iz * g.nx + ix];
}
export const waterDepthAt = (x, z) => waterLevelAt(x, z) - groundAt(x, z);
export function surfaceAt(x, z) {
  const g = GRIDS[zoneIndexAt(x, z)];
  return g.S[clamp(Math.round(z - g.z0), 0, g.nz - 1) * g.nx + clamp(Math.round(x - g.x0), 0, g.nx - 1)];
}
setHeightProvider(terrainAt);

/* ---------- dynamic blockers: closed gates and encounter wards ---------- */
const blockers = new Map();
let blockerId = 1;
export function addBlocker(ax, az, bx, bz, r = 0.6) {
  blockers.set(blockerId, { ax, az, bx, bz, r });
  return blockerId++;
}
export const removeBlocker = (id) => blockers.delete(id);
export const clearBlockers = () => blockers.clear();
export const listBlockers = () => [...blockers.values()];
/** signed distance to the walkable area, including closed gates. negative = may stand here */
export function walkAt(x, z) {
  const g = GRIDS[zoneIndexAt(x, z)];
  let w = sample(g.W, g, x, z);
  for (const b of blockers.values()) {
    const vx = b.bx - b.ax, vz = b.bz - b.az;
    const t = clamp(((x - b.ax) * vx + (z - b.az) * vz) / (vx * vx + vz * vz || 1), 0, 1);
    const d = b.r - Math.hypot(x - b.ax - vx * t, z - b.az - vz * t);
    if (d > w) w = d;
  }
  return w;
}
const gridWalk = (x, z) => { const g = GRIDS[zoneIndexAt(x, z)]; return sample(g.W, g, x, z); };
/** keep `p` inside the walkable area, sliding along its edge. (px,pz) is the last good position */
export function constrain(p, px, pz, margin = 0) {
  let moved = false;
  // closed gates and wards are one-sided walls: you stay on the side you came from, however fast you were moving
  for (const b of blockers.values()) {
    const vx = b.bx - b.ax, vz = b.bz - b.az, len = Math.hypot(vx, vz) || 1, ux = vx / len, uz = vz / len;
    const t = (p.x - b.ax) * ux + (p.z - b.az) * uz;
    if (t < -b.r || t > len + b.r) continue;
    const side = (p.x - b.ax) * -uz + (p.z - b.az) * ux; // signed distance to the wall's line
    const from = (px - b.ax) * -uz + (pz - b.az) * ux;
    const t0 = (px - b.ax) * ux + (pz - b.az) * uz;
    const crossed = from * side < 0 && t0 > -b.r - 1 && t0 < len + b.r + 1;
    if (!crossed && Math.abs(side) >= b.r) continue;
    const s = from >= 0 ? 1 : -1, tc = clamp(t, 0, len);
    p.x = b.ax + ux * tc - uz * s * (b.r + 0.03);
    p.z = b.az + uz * tc + ux * s * (b.r + 0.03);
    moved = true;
  }
  let w = gridWalk(p.x, p.z) + margin;
  if (w <= 0) return moved;
  const e = 0.3;
  for (let i = 0; i < 4; i++) {
    let gx = gridWalk(p.x + e, p.z) - gridWalk(p.x - e, p.z), gz = gridWalk(p.x, p.z + e) - gridWalk(p.x, p.z - e);
    const gl = Math.hypot(gx, gz);
    if (gl < 1e-5) break;
    gx /= gl; gz /= gl;
    p.x -= gx * (w + 0.02);
    p.z -= gz * (w + 0.02);
    w = gridWalk(p.x, p.z) + margin;
    if (w <= 0) return true;
  }
  if (gridWalk(px, pz) + margin <= 0.05) { p.x = px; p.z = pz; }
  return true;
}

/* ---------- lookups driven by zone data ---------- */
export const zoneAt = zoneIndexAt;
const ANCHORS = ZONES.flatMap((z) => z.camera.map((c) => ({ ...c, zi: z.index })));
/** camera yaw / distance / pitch at a point: a smooth blend of the nearest camera regions */
export function cameraAt(x, z, out) {
  let ws = 0, sy = 0, cy = 0, dist = 0, pitch = 0;
  for (const a of ANCHORS) {
    const q = Math.hypot(x - a.x, z - a.z) / a.r;
    if (q > 6) continue;
    const q2 = q * q, w = 1 / (0.02 + q2 * q2);
    ws += w; sy += Math.sin(a.yaw) * w; cy += Math.cos(a.yaw) * w; dist += a.dist * w; pitch += a.pitch * w;
  }
  if (ws <= 0) { out.yaw = 0; out.dist = 12; out.pitch = 0.82; return out; }
  out.yaw = Math.atan2(sy, cy); out.dist = dist / ws; out.pitch = pitch / ws;
  return out;
}
/** how strongly each zone's lighting / ambience applies here (sums to 1) */
export function zoneWeights(x, z, out) {
  let sum = 0;
  for (let i = 0; i < ZONES.length; i++) {
    const r = ZONES[i].rect;
    const s = Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z);
    out[i] = smoothstep(-16, 16, s);
    sum += out[i];
  }
  if (sum < 1e-4) { out.fill(0); out[zoneIndexAt(x, z)] = 1; return out; }
  for (let i = 0; i < ZONES.length; i++) out[i] /= sum;
  return out;
}
/** distance to the nearest drawn water (for ambience) */
export function waterDist(x, z) {
  let best = 60;
  for (const c of WATER) {
    if (!near(c, x, z, 60)) continue;
    const d = Math.max(0, sdWater(c, x, z));
    if (d < best) best = d;
  }
  return best;
}
/** solid footprints of a zone's structures and trees */
export function zoneSolids(zone) {
  const out = [];
  for (const s of zone.structures) for (const f of footprint(s)) out.push(f);
  for (const t of zone.trees || []) out.push({ x: t[1], z: t[2], r: (t[0] === 'pine' ? 0.34 : 0.42) * (t[3] || 1) });
  return out;
}
/** openings where a circle (an encounter arena) cuts the walkable area: these get wards during a fight */
export function arenaOpenings(a, step = 0.05) {
  const segs = [];
  let run = null;
  const n = Math.ceil((Math.PI * 2) / step);
  const pt = (i) => [a.x + Math.sin(i * step) * a.r, a.z + Math.cos(i * step) * a.r];
  const open = (i) => { const [x, z] = pt(i); return walkAt(x, z) < -0.15; };
  let start = 0;
  while (start < n && open(start)) start++;
  if (start >= n) {
    // the whole ring is open ground: fence it with a polygon of wards
    const k = 12;
    for (let i = 0; i < k; i++) segs.push([...pt((i * n) / k), ...pt(((i + 1) * n) / k)]);
    return segs;
  }
  for (let j = 0; j <= n; j++) {
    const i = start + j;
    if (open(i)) run = run ?? i;
    else if (run !== null) {
      const len = (i - run) * step * a.r;
      const parts = Math.max(1, Math.round(len / 9));
      for (let p = 0; p < parts; p++) segs.push([...pt(run - 1 + ((i - run + 1) * p) / parts), ...pt(run - 1 + ((i - run + 1) * (p + 1)) / parts)]);
      run = null;
    }
  }
  return segs;
}

export const NAV = { GRIDS, SHAPES, DECKS, WATER, evalPoint, zoneIndexAt };
export { ZONES };
