import * as THREE from 'three';
import { ZONES } from './zones/index.js';
import { footprint, floors } from './zones/footprints.js';
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
    if (s.square) {
      // a two-point shape with square ends (a landing): walkable right into its corners
      const [a, b] = s.pts, dx = b[0] - a[0], dz = b[1] - a[1], ry = Math.atan2(dx, dz);
      c.sq = { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, w: s.w, d: Math.hypot(dx, dz), cos: Math.cos(ry), sin: Math.sin(ry), y: a[2] };
      // the part a body can stand in: held back from each railed side (sides named as in kit/build.js landing())
      const rails = s.landing?.rails || [], k = RAIL_IN[s.deck] ?? 0.25, cut = (n) => (rails.includes(n) ? k : 0);
      const ox = (cut('right') - cut('left')) / 2, oz = (cut('start') - cut('end')) / 2;
      c.sqWalk = { ...c.sq, x: c.sq.x + ox * c.sq.cos + oz * c.sq.sin, z: c.sq.z - ox * c.sq.sin + oz * c.sq.cos, w: s.w - cut('right') - cut('left'), d: c.sq.d - cut('start') - cut('end') };
    }
    // a bridge's rails stand just outside its walkable width (kit bridge(): rail line at w/2 + 0.17, posts 0.1 inside
    // that, a stone parapet's face right on the edge): hold a body's centre back far enough that it never leans into them
    if (s.deck && !s.square) c.railIn = s.rails === false ? 0 : RAIL_IN[s.deck] ?? 0.25;
  }
  return c;
}
const RAIL_IN = { wood: 0.25, board: 0.25, red: 0.25, stone: 0.32 };
function sdBox(c, x, z) {
  const dx = x - c.x, dz = z - c.z;
  const qx = Math.abs(dx * c.cos - dz * c.sin) - c.w / 2, qz = Math.abs(dx * c.sin + dz * c.cos) - c.d / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}
let _end = false; // the last sdPoly's nearest point lies past one end of the line (in its rounded cap)
function sdPoly(c, x, z) {
  let best = 1e18, by = 0, end = false;
  const P = c.pts;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const t0 = ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1), t = clamp(t0, 0, 1);
    const ex = x - a[0] - vx * t, ez = z - a[1] - vz * t, d = ex * ex + ez * ez;
    if (d < best) { best = d; by = a.length > 2 ? a[2] + (b[2] - a[2]) * t : 0; end = (i === 0 && t0 < -0.01) || (i === P.length - 2 && t0 > 1.01); }
  }
  _y = by;
  _end = end;
  return Math.sqrt(best);
}
/** signed distance to a walk / pad shape; leaves the shape's height at that point in _y */
function sd(c, x, z) {
  if (c.t === 'circle') { _y = c.y; return Math.hypot(x - c.x, z - c.z) - c.r; }
  if (c.t === 'box') { _y = c.y; return sdBox(c, x, z); }
  if (c.sq) { _y = c.sq.y; return sdBox(c.sq, x, z); }
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
const GORGES = [];
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
  for (const r of z.terrain || []) {
    if (r.op === 'ridge') RIDGES.push(compile({ t: 'ridge', ...r, w: (r.w || 12) * 6 }, z, 'ridge'));
    else if (r.op === 'gorge' || r.op === 'cut') {
      // a cut is a dry gorge laid along a path: no water floor, and its faces rise right beside the path instead of
      // standing back from it (pts run along the path; a side whose wall top is 0 is left open)
      const g = { bed: [-0.3, -0.9], run: 2.4, shelf: 3, fall: 0.8, jag: 4, fade: 4, dry: r.op === 'cut', ...r };
      const reach = Math.max(...r.pts.map((p) => Math.max(p[4], p[5]))) / g.fall + g.run + g.shelf;
      GORGES.push(compile({ t: 'gorge', ...g, w: 2 * (Math.max(...r.pts.map((p) => Math.max(p[2], p[3]))) + reach) }, z, 'gorge'));
    }
  }
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

/* A river gorge cut through rock. pts: [x, z, floor width out to the right bank, out to the left bank, right wall top,
   left wall top] along the river, listed downstream (banks named looking downstream). The floor drops under the water from
   wall to wall, so a boardwalk laid along it stands over the river; the walls rise sheer from the floor's edge to a short
   shelf, then fall away into whatever ground is there. Paths cut notches through the walls, and nothing in the gorge
   rises into a bridge deck. */
const GZ = { lat: 0, side: 0, half: 0, topR: 0, topL: 0, out: 0 };
function gorgeNearest(c, x, z) {
  const P = c.pts;
  let best = 1e18;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], vx = b[0] - a[0], vz = b[1] - a[1], len = Math.hypot(vx, vz), ux = vx / len, uz = vz / len;
    const along = (x - a[0]) * ux + (z - a[1]) * uz, t = clamp(along / len, 0, 1);
    const side = -(x - a[0]) * uz + (z - a[1]) * ux; // > 0 on the right bank
    // past either end the gorge is cut off square (distance across it, faded along it) rather than rounded
    const out = i === 0 && along < 0 ? -along : i === P.length - 2 && along > len ? along - len : 0;
    const d2 = out > 0 ? side * side : (x - a[0] - vx * t) ** 2 + (z - a[1] - vz * t) ** 2;
    if (d2 >= best) continue;
    best = d2;
    const f = out > 0 ? (along < 0 ? 0 : 1) : t;
    const k = side > 0 ? 2 : 3;
    GZ.lat = Math.sqrt(d2); GZ.side = side; GZ.out = out;
    GZ.half = a[k] + (b[k] - a[k]) * f; GZ.topR = a[4] + (b[4] - a[4]) * f; GZ.topL = a[5] + (b[5] - a[5]) * f;
  }
  return GZ;
}
function carveGorge(c, x, z, h, dAll) {
  const g = gorgeNearest(c, x, z), k = smoothstep(c.fade, 0, g.out);
  if (k <= 0) return h;
  const d = g.lat - g.half;
  // paths keep their own ground: the floor gives way right beside them, the walls stand a little further off (the notch)
  const keepFloor = smoothstep(0.3, 1.2, dAll);
  const top0 = g.side > 0 ? g.topR : g.topL;
  let out;
  if (d < 0) {
    // the floor: shallow at the foot of the walls, deeper toward the middle (a dry cut keeps its ground)
    const bed = lerp(c.bed[0], c.bed[1], smoothstep(0, -Math.min(g.half, 4), d));
    out = c.dry ? h : lerp(h, Math.min(h, bed), k * keepFloor);
  } else if (top0 <= 0) {
    out = h; // an open side
  } else {
    const top = top0 + (fbm(x * 0.09 + 3.1, z * 0.09 + 7.7, 3) - 0.5) * c.jag;
    const run = c.run * (0.75 + fbm(x * 0.15 + 9.2, z * 0.15 + 2.6, 2) * 0.6), s = smoothstep(0, run, d);
    // a sheer face up from the foot, a shelf at the top, then a slope down into whatever land lies beyond.
    // Land already higher than the face is cut back near the foot and kept further up.
    const foot = c.dry ? h : c.bed[0];
    const face = d < run ? lerp(foot, top, Math.pow(s, 0.75)) : top - Math.max(0, d - run - c.shelf) * c.fall;
    const wall = Math.max(face, lerp(Math.min(h, face), h, s));
    out = lerp(h, wall, k * (c.dry ? keepFloor : lerp(keepFloor, smoothstep(1.2, 4, dAll), s)));
  }
  // bridges always clear the rock under them, except where a deck comes to rest on a path
  for (const dc of DECKS) {
    if (!near(dc, x, z, 2)) continue;
    const dd = sd(dc, x, z), cap = _y - 0.45 + 3 * smoothstep(0.3, 1.6, dd);
    if (dd < 1.6 && out > cap) out = lerp(out, cap, k * smoothstep(0.5, 1.2, dAll));
  }
  return out;
}

const E = { t: 0, u: 0, g: 0, w: 0, wd: 0, wy: -1e9, deck: false, surf: 0 };
const SURF = { grass: 0, dirt: 1, paved: 2, leaf: 3, moss: 4, gravel: 5, wood: 6, arena: 7 };
const Z0 = ZONES[0].rect;

/** evaluate everything at one point (analytic, slow: used for baking only) */
function evalPoint(x, z, zone) {
  // --- new world ground ---
  let ws = 1e-7, ys = 1e-7 * zone.ground.base, es = 0, fs = 1e-7 * zone.ground.floor, ns = 1e-7 * zone.ground.noise;
  let pw = 0, py = 0, pe = 0, pf = 0, pn = 0; // pads, blended in below
  let dWalk = 1e9, dAll = 1e9, surf = 0;
  for (const c of SHAPES) {
    if (!near(c, x, z, INFL)) continue;
    const d = sd(c, x, z), dp = Math.max(d, 0);
    if (dp > INFL) continue;
    if (c.role === 'walk' && d < dWalk) { dWalk = d; if (d < 0.6) surf = SURF[c.surface] ?? (c.stairs ? 2 : 1); }
    if (d < dAll) dAll = d;
    const q = dp + 0.35;
    const w = (1 / (q * q * q)) * smoothstep(INFL, INFL * 0.55, dp);
    if (c.role === 'pad') { pw += w; py += w * _y; pe += w * edgeHeight(c.edge, dp); pf += w * c.g.floor; pn += w * c.g.noise; continue; }
    ws += w; ys += w * _y; es += w * edgeHeight(c.edge, dp); fs += w * c.g.floor; ns += w * c.g.noise;
  }
  // a pad shapes the ground around the walkable area (a plateau, a terrace) but never what a walk shape lays down inside
  // it: a stair climbing out of a terrace keeps its own slope instead of being averaged toward the terrace's height
  const kp = smoothstep(0, 2.5, dWalk);
  ws += pw * kp; ys += py * kp; es += pe * kp; fs += pf * kp; ns += pn * kp;
  const dOut = Math.max(dAll, 0);
  let h = ys / ws + es / ws;
  const amp = (ns / ws) * smoothstep(1.2, 10, dOut);
  h += (fbm(x * 0.043 + 17.3, z * 0.043 + 5.1, 3) - 0.5) * 2 * amp + (fbm(x * 0.21, z * 0.21 + 9, 2) - 0.5) * 0.3 * smoothstep(0.4, 3, dOut);
  const ridgeAt = (r) => {
    const d = sdPoly(r, x, z) / (r.w / 6);
    return r.h * Math.exp(-d * d) * (0.72 + 0.56 * ridged(x * 0.03 + 3, z * 0.03 + 8, 3)) * smoothstep(2, 12, dOut);
  };
  for (const r of RIDGES) if (!r.over && near(r, x, z, 0)) h += ridgeAt(r);
  const fb = fs / ws;
  const floor = fb + (fbm(x * 0.03 + 40, z * 0.03 + 60, 3) - 0.5) * 2 * Math.min(1.2, fb * 0.75);
  if (h < floor) h = floor + (h - floor) * 0.04;
  // a ridge marked `over` stands on the floor whatever the land under it: a plateau's drop edge keeps falling for tens of
  // metres and swallows an ordinary ridge, so a massif that must show above the floor is added after the clamp
  for (const r of RIDGES) if (r.over && near(r, x, z, 0)) h += ridgeAt(r);

  // --- zone 00: keep the original valley, blend the new shapes and the southern hand-over into it ---
  let inLegacy = false;
  if (x >= Z0.x0 && x <= Z0.x1 && z >= Z0.z0 && z <= Z0.z1) {
    const k = Math.max(smoothstep(104, 128, z), smoothstep(4.6, 0.5, dAll));
    const lh = legacyHeightAt(x, z);
    h = k >= 1 ? h : lerp(lh, h, k);
    inLegacy = true;
    if (dWalk > 0.6) surf = 0;
  }
  let u = h; // the same ground without the gorges (see plantingHeightAt)
  for (const c of GORGES) if (near(c, x, z, 0)) h = carveGorge(c, x, z, h, dAll);

  // --- water carves the ground ---
  let dWater = 1e9, wy = -1e9;
  for (const c of WATER) {
    if (!near(c, x, z, 8)) continue;
    const d = sdWater(c, x, z);
    const lvl = waterSurface(c, x, z);
    if (!c.legacy || z > 128) {
      const k = smoothstep(c.bank, -0.4, d);
      if (k > 0) {
        const bed = lvl - c.depth * (0.55 + 0.45 * smoothstep(0, -c.w * 0.4 || -3, d));
        h = lerp(h, bed, k);
        u = lerp(u, bed, k);
      }
    }
    if (d < 0 && lvl > wy) wy = lvl;
    if (!c.wade && d < dWater) dWater = d;
  }
  if (inLegacy && z < 150 && h < WATER_Y) wy = Math.max(wy, WATER_Y);

  // --- nothing of the ground comes up through a deck: under its boards the ground stays inside their thickness ---
  for (const c of DECKS) {
    if (!near(c, x, z, 0.5)) continue;
    const d = sd(c, x, z) - (c.sq ? 0.25 : 0.25), y = _y;
    if (d < 0 && (c.sq || !_end) && h > y - 0.1) { h = y - 0.1; if (u > h) u = h; }
  }

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
    const d = sd(c, x, z), cap = !c.sq && _end;
    const dw = c.sqWalk ? sdBox(c.sqWalk, x, z) : d + (c.railIn || 0);
    if (dw < w) w = dw;
    // the grid keeps the ground's own height everywhere: groundAt reads the boards themselves wherever they are
    // (builtAt), so land right beside a deck never borrows the deck's height through the grid's interpolation
    if (d < 0 && !cap) deck = true;
    if (d < 0.3 && !cap) surf = 6;
  }
  E.t = h; E.u = u; E.g = g; E.w = w; E.wy = wy; E.deck = deck; E.surf = surf; E.wd = dWater;
  return E;
}

/* ---------- baked grids ---------- */
const GRIDS = ZONES.map((zone) => {
  const { x0, x1, z0, z1 } = zone.rect;
  const nx = x1 - x0 + 1, nz = z1 - z0 + 1;
  const T = new Float32Array(nx * nz), G = new Float32Array(nx * nz), W = new Float32Array(nx * nz), L = new Float32Array(nx * nz), S = new Uint8Array(nx * nz);
  const uncut = new Map(); // cells a gorge changed: their height before the cut
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
      if (e.u !== e.t) uncut.set(o, e.u);
    }
  }
  let U = T;
  if (uncut.size) { U = T.slice(); for (const [o, v] of uncut) U[o] = v; }
  return { x0, z0, nx, nz, T, U, G, W, L, S };
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
/* ---------- built surfaces: where feet rest on something made rather than on the shaped ground ----------
   Deck boards follow the same resampled curve the kit lays them along (kit/build.js bridge()), stair treads are flat
   steps exactly as stairway() cuts them, a landing is level, and a few structures have floors you step up onto.
   groundAt reads these exactly instead of the 1 m grid, so a foot meets the board or the tread it is drawn on. */
const BUILT = [];
function deckSurface(s) {
  const curve = new THREE.CatmullRomCurve3(s.pts.map(([x, z, y]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
  const n = Math.max(4, Math.round(curve.getLength() / 1.1)), S = curve.getSpacedPoints(n);
  // each board segment is a box from one spaced point to the next, its top 1 cm under the curve
  return { kind: 'deck', pts: S.map((p) => [p.x, p.z, p.y - 0.01]), half: (s.w + 0.5) / 2, S };
}
for (const z of ZONES) for (const s of z.walk) {
  if (s.legacy) continue;
  if (s.deck && s.square) {
    const [a, b] = s.pts, dx = b[0] - a[0], dz = b[1] - a[1], ry = Math.atan2(dx, dz);
    BUILT.push({ kind: 'box', x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, w: s.w + 0.5, d: Math.hypot(dx, dz) + 0.5, cos: Math.cos(ry), sin: Math.sin(ry), y: a[2] - 0.01 });
  } else if (s.deck) BUILT.push(deckSurface(s));
  else if (s.stairs) {
    for (let i = 0; i < s.pts.length - 1; i++) {
      const [ax, az, ay] = s.pts[i], [bx, bz, by] = s.pts[i + 1], rise = by - ay;
      BUILT.push({ kind: 'stair', ax, az, ay, dx: bx - ax, dz: bz - az, rise, n: Math.max(2, Math.round(Math.abs(rise) / 0.24)), half: (s.w + 0.7) / 2 });
    }
  }
}
// a structure's floor stands `top` above the ground the kit set the structure on (its anchor, unless `at` says otherwise)
const groundUnder = (x, z) => { const g = GRIDS[zoneIndexAt(x, z)]; return sample(g.T, g, x, z); };
for (const z of ZONES) for (const s of z.structures) for (const f of floors(s)) BUILT.push({ kind: 'box', ...f, cos: Math.cos(f.rot || 0), sin: Math.sin(f.rot || 0), y: f.y ?? groundUnder(...(f.at || [f.x, f.z])) + f.top });
// a coarse lookup so the common case (nothing built here) costs one map probe
const BCELL = 8, BMAP = new Map(), bkey = (i, j) => (i + 512) * 1024 + (j + 512);
for (const b of BUILT) {
  let x0, x1, z0, z1;
  if (b.kind === 'deck') {
    x0 = Math.min(...b.pts.map((p) => p[0])) - b.half; x1 = Math.max(...b.pts.map((p) => p[0])) + b.half;
    z0 = Math.min(...b.pts.map((p) => p[1])) - b.half; z1 = Math.max(...b.pts.map((p) => p[1])) + b.half;
  } else if (b.kind === 'stair') {
    x0 = Math.min(b.ax, b.ax + b.dx) - b.half; x1 = Math.max(b.ax, b.ax + b.dx) + b.half;
    z0 = Math.min(b.az, b.az + b.dz) - b.half; z1 = Math.max(b.az, b.az + b.dz) + b.half;
  } else {
    const r = Math.hypot(b.w, b.d) / 2;
    x0 = b.x - r; x1 = b.x + r; z0 = b.z - r; z1 = b.z + r;
  }
  for (let i = Math.floor(x0 / BCELL); i <= Math.floor(x1 / BCELL); i++) for (let j = Math.floor(z0 / BCELL); j <= Math.floor(z1 / BCELL); j++) {
    const k = bkey(i, j);
    if (!BMAP.has(k)) BMAP.set(k, []);
    BMAP.get(k).push(b);
  }
}
function binBuilt(b, x0, x1, z0, z1) {
  for (let i = Math.floor(x0 / BCELL); i <= Math.floor(x1 / BCELL); i++) for (let j = Math.floor(z0 / BCELL); j <= Math.floor(z1 / BCELL); j++) {
    const k = bkey(i, j);
    if (!BMAP.has(k)) BMAP.set(k, []);
    BMAP.get(k).push(b);
  }
}
/** something low enough to step up onto (a flat stone in the shallows): a height map over its footprint, NaN off it.
    { x0, z0, step, nx, nz, h } */
export function addStandable(m) {
  const b = { kind: 'map', ...m };
  BUILT.push(b);
  binBuilt(b, m.x0, m.x0 + (m.nx - 1) * m.step, m.z0, m.z0 + (m.nz - 1) * m.step);
}
/** height of the built surface under (x, z), or -Infinity where there is none. `under` is the shaped ground there:
    a deck or a floor with ground banked up over it is buried there, but stair treads are always what you stand on */
function builtAt(x, z, under = -Infinity, smooth = false) {
  const list = BMAP.get(bkey(Math.floor(x / BCELL), Math.floor(z / BCELL)));
  if (!list) return -Infinity;
  let top = -Infinity, stair = false;
  for (const b of list) {
    let y = -Infinity;
    if (b.kind === 'deck') {
      // nearest board segment, within the deck's width and not past its square-cut ends
      const P = b.pts, n = P.length - 1;
      if ((x - P[0][0]) * (P[0][0] - P[1][0]) + (z - P[0][1]) * (P[0][1] - P[1][1]) > 0.02 * Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1])) continue;
      if ((x - P[n][0]) * (P[n][0] - P[n - 1][0]) + (z - P[n][1]) * (P[n][1] - P[n - 1][1]) > 0.02 * Math.hypot(P[n][0] - P[n - 1][0], P[n][1] - P[n - 1][1])) continue;
      let best = 1e18;
      for (let i = 0; i < n; i++) {
        const a = P[i], c = P[i + 1], vx = c[0] - a[0], vz = c[1] - a[1], l2 = vx * vx + vz * vz || 1;
        const tc = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / l2, 0, 1), ex = x - a[0] - vx * tc, ez = z - a[1] - vz * tc, d2 = ex * ex + ez * ez;
        if (d2 < best && d2 <= b.half * b.half) { best = d2; y = a[2] + (c[2] - a[2]) * tc; }
      }
    } else if (b.kind === 'stair') {
      const l2 = b.dx * b.dx + b.dz * b.dz, t = ((x - b.ax) * b.dx + (z - b.az) * b.dz) / l2;
      if (t < 0 || t > 1) continue;
      if (Math.abs((x - b.ax) * b.dz - (z - b.az) * b.dx) / Math.sqrt(l2) > b.half) continue;
      if (smooth) {
        // the line a body's hips ride up or down a flight: through the middle of each tread, meeting the ground at
        // both ends (the feet still step on the treads themselves)
        y = b.ay + b.rise * t + (Math.abs(b.rise) / (2 * b.n)) * Math.min(1, t * b.n, (1 - t) * b.n);
      } else {
        const k = Math.min(b.n - 1, Math.floor(t * b.n));
        y = b.ay + (b.rise * (k + (b.rise > 0 ? 1 : 0))) / b.n;
      }
      stair = true;
    } else if (b.kind === 'map') {
      const fx = (x - b.x0) / b.step, fz = (z - b.z0) / b.step;
      if (fx < 0 || fz < 0 || fx >= b.nx - 1 || fz >= b.nz - 1) continue;
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, o = j * b.nx + i, H = b.h;
      const a = H[o], c = H[o + 1], d = H[o + b.nx], e = H[o + b.nx + 1];
      // the stone's edge: only where all four corners are on it (its rim drops to the ground anyway)
      if (a !== a || c !== c || d !== d || e !== e) continue;
      y = lerp(lerp(a, c, tx), lerp(d, e, tx), tz);
    } else if (sdBox(b, x, z) <= 0) y = b.y;
    if (y > top) top = y;
  }
  return top > -1e9 && !stair ? Math.max(top, under) : top;
}
export const terrainAt = (x, z) => { const g = GRIDS[zoneIndexAt(x, z)]; return sample(g.T, g, x, z); };
/** what feet stand on: the shaped ground, or the deck, tread or floor built over it */
export const groundAt = (x, z) => { const g = GRIDS[zoneIndexAt(x, z)], s = sample(g.G, g, x, z), b = builtAt(x, z, s); return b > -1e9 ? b : s; };
/** groundAt for where a body is carried rather than where its feet land: the same, except that a flight of stairs is
    one smooth incline instead of a row of steps (see game/footing.js) */
export const bodyGroundAt = (x, z) => { const g = GRIDS[zoneIndexAt(x, z)], s = sample(g.G, g, x, z), b = builtAt(x, z, s, true); return b > -1e9 ? b : s; };
/** terrainAt as it was before the gorges were cut (planting laid out on the old ground stays where it was) */
export const uncutTerrainAt = (x, z) => { const g = GRIDS[zoneIndexAt(x, z)]; return sample(g.U, g, x, z); };
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
setHeightProvider(terrainAt, uncutTerrainAt);

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
  // (edge: a fence runs on past a trunk a hand's breadth away rather than stopping 1.5 m short of it either side)
  for (const t of zone.trees || []) out.push({ x: t[1], z: t[2], r: (t[0] === 'pine' ? 0.34 : 0.42) * (t[3] || 1), edge: 0.3 });
  for (const g of zone.terrain || []) if (g.op === 'gorge' || g.op === 'cut') out.push(...gorgeWalls(g));
  for (const s of zone.walk) out.push(...builtSolids(s));
  return out;
}
/** the posts at a deck's ends and a landing's corners, and the cheek walls of a stair: solid where they stand beside
    walkable ground (along a deck's length the walkable width already keeps clear of its rails) */
function builtSolids(s) {
  // `h`: how far up from the ground the solid reaches (physics.js), so a hat knocked over a rail isn't stopped in the air
  const out = [], post = (x, z) => out.push({ x, z, r: 0.17, h: 1.7, post: true });
  const rail = (x, z, len, ry, t) => out.push({ x, z, w: t, d: len, rot: ry, h: 1.4, rail: true });
  if (s.deck && s.square && s.landing) {
    // kit landing(): corner posts at the framed deck's corners, 8 cm in, and rails along the railed sides
    const [a, b] = s.pts, dx = b[0] - a[0], dz = b[1] - a[1], ry = Math.atan2(dx, dz), cs = Math.cos(ry), sn = Math.sin(ry);
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2, rx = (s.w + 0.5) / 2 - 0.08, rz = (Math.hypot(dx, dz) + 0.5) / 2 - 0.08;
    const at = (lx, lz) => [cx + lx * cs + lz * sn, cz - lx * sn + lz * cs];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(...at(sx * rx, sz * rz));
    const side = { right: [-1, 'x'], left: [1, 'x'], start: [-1, 'z'], end: [1, 'z'] };
    for (const k of s.landing.rails || []) {
      const [sg, ax] = side[k];
      if (ax === 'x') rail(...at(sg * rx, 0), rz * 2, ry, 0.12);
      else rail(...at(0, sg * rz), 0.12, ry, rx * 2);
    }
  } else if (s.deck) {
    // kit bridge(): rails (a stone bridge's parapets) along both sides, and a newel each side where a wooden deck
    // comes ashore, unless that end runs onto a landing. Along the deck the walkable width already keeps a body
    // clear of the rails; these hold it off them where walkable land runs alongside, at the ends.
    const S = deckSurface(s).S, n = S.length - 1, join = s.join || {}, off = (s.w + 0.5) / 2 - 0.08, stone = s.deck === 'stone';
    if (s.rails !== false) for (let i = 0; i < n; i++) {
      const p = S[i], q = S[i + 1], ry = Math.atan2(q.x - p.x, q.z - p.z), len = Math.hypot(q.x - p.x, q.z - p.z) + 0.04;
      for (const sx of [-1, 1]) rail((p.x + q.x) / 2 + Math.cos(ry) * sx * off, (p.z + q.z) / 2 - Math.sin(ry) * sx * off, len, ry, stone ? 0.34 : 0.12);
    }
    if (!stone) for (const [k, joined] of [[0, join.start], [n, join.end]]) {
      if (joined) continue;
      const p = S[k], q = S[k === 0 ? 1 : n - 1], ry = k === 0 ? Math.atan2(q.x - p.x, q.z - p.z) : Math.atan2(p.x - q.x, p.z - q.z);
      for (const sx of [-1, 1]) post(p.x + Math.cos(ry) * sx * off, p.z - Math.sin(ry) * sx * off);
    }
  } else if (s.stairs) {
    // kit stairway(): stone cheek walls 0.46 thick, centred (w + 0.7) / 2 + 0.22 out, running 0.15 past each end; being
    // tilted with the flight, a corner of each end reaches a further ~0.25 out. Cut into short pieces so each stands at
    // the height of the flight beside it.
    const off = (s.w + 0.7) / 2 + 0.22;
    for (let i = 0; i < s.pts.length - 1; i++) {
      const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1], run = Math.hypot(bx - ax, bz - az), len = run + 0.9, ux = (bx - ax) / run, uz = (bz - az) / run;
      const ry = Math.atan2(ux, uz), k = Math.max(1, Math.ceil(len / 3)), piece = len / k;
      for (let j = 0; j < k; j++) {
        const t = -0.45 + piece * (j + 0.5);
        for (const sx of [-1, 1]) out.push({ x: ax + ux * t + uz * sx * off, z: az + uz * t - ux * sx * off, w: 0.46, d: piece + 0.02, rot: ry, h: 1.6, cheek: true });
      }
    }
  }
  return out;
}
/** a gorge's rock walls as solid blocks standing back from the foot of each face, so a chasing camera stops short of the rock
    the way it does at a house. Left out wherever a path cuts through. */
function gorgeWalls(g) {
  const out = [], P = g.pts, thick = 4.5;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], vx = b[0] - a[0], vz = b[1] - a[1], len = Math.hypot(vx, vz), ux = vx / len, uz = vz / len;
    const n = Math.max(1, Math.round(len / 4)), step = len / n;
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      for (const side of [1, -1]) {
        if (side > 0 ? !(a[4] || b[4]) : !(a[5] || b[5])) continue; // an open side
        const k = side > 0 ? 2 : 3, half = a[k] + (b[k] - a[k]) * t, nx = -uz * side, nz = ux * side;
        const fx = a[0] + vx * t + nx * half, fz = a[1] + vz * t + nz * half;
        if (terrainAt(fx + nx * 4.5, fz + nz * 4.5) - terrainAt(fx, fz) < 2.6) continue;
        if (DECKS.some((dc) => near(dc, fx, fz, 3) && sd(dc, fx, fz) < 2.5)) continue; // a bridge leaves the wall here
        out.push({ x: fx + nx * (thick / 2 + 0.25), z: fz + nz * (thick / 2 + 0.25), w: step + 0.6, d: thick, rot: Math.atan2(-uz, ux), rock: true });
      }
    }
  }
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

export const NAV = { GRIDS, SHAPES, DECKS, WATER, evalPoint, zoneIndexAt, builtAt, BUILT };
export { ZONES };
