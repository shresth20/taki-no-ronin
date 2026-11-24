import * as THREE from 'three';
import { MAT, Parts, addRoof, roofGeo, kasaGeo, boxG, cylG, coneG, sphG, torusG, clothQuad } from './core.js';
import { HOUSE, GATE, local, rockCluster, wallSegments } from '../zones/footprints.js';
import { mulberry32 } from '../../core/util.js';
import { cloudSea } from '../cloudsea.js';

/* Structure builders: one small function per structure type named in the zone files.
   Each adds coloured parts to the zone's shared part lists; nothing here knows where it will be placed in the world
   beyond the anchor it is given, so the same kit serves every zone.                                              */
export const K = {
  wood: '#6b4a35', woodD: '#3b2b25', woodL: '#8d6b49', plaster: '#e7dcc4', paper: '#f5e7c4', stone: '#98a39b', stoneD: '#77837d', stoneL: '#b6bcb1',
  tile: '#44606a', tileD: '#33474f', thatch: '#b3955b', red: '#c93a2b', redD: '#8e261f', gold: '#dcb352', iron: '#2a2c33', rope: '#b99c63', straw: '#d4b96f',
  moss: '#5d8a3e', black: '#22232b', bronze: '#4f6a5a', cloth: '#d9cfb4',
};
const hash = (x, z, i = 0) => { const v = Math.sin(x * 12.9898 + z * 78.233 + i * 37.719) * 43758.5453; return v - Math.floor(v); };
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const GLOW = '#ffd08a', GLOW_RED = '#ff7a3a';

/* ---------- small shared pieces ---------- */
/** A chōchin's paper body: a barrel of paper on bamboo hoops, radius r round its middle and drawn in to end·r at the
    rims. aUv carries (height 0–1, hoop number) for the lantern-paper shader (MAT.lamp). */
const _chochin = new Map();
function chochinGeo(r, h, end = 0.7, hoops = 11) {
  const key = `${r},${h},${end},${hoops}`;
  if (_chochin.has(key)) return _chochin.get(key);
  const pts = [];
  for (let j = 0; j <= 16; j++) { const v = j / 16; pts.push(new THREE.Vector2(r * (end + (1 - end) * Math.pow(Math.sin(Math.PI * v), 0.6)), (v - 0.5) * h)); }
  const g = new THREE.LatheGeometry(pts, 16), uv = g.attributes.uv, a = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) { a[i * 2] = uv.getY(i); a[i * 2 + 1] = uv.getY(i) * hoops; }
  g.setAttribute('aUv', new THREE.BufferAttribute(a, 2));
  _chochin.set(key, g);
  return g;
}
/** A paper lantern (chōchin): cream paper (or vermilion, for GLOW_RED) on bamboo hoops between lacquered rims, lit
    from inside: plain paper by day, glowing at dusk and night (MAT.lamp). `hang`: metres of cord from the top rim up
    to whatever it hangs from (0 for a lantern that stands). */
function paperLantern(c, x, y, z, s = 1, col = GLOW, hang = 0) {
  const P = c.P.at(x, y, z);
  P.add(chochinGeo(0.21 * s, 0.42 * s), 0, 0, 0, col === GLOW_RED ? '#d9573a' : K.paper, MAT.lamp);
  P.cyl(0.11 * s, 0.155 * s, 0.05 * s, 0, 0.235 * s, 0, K.black, MAT.metal, { n: 16 }).cyl(0.155 * s, 0.11 * s, 0.05 * s, 0, -0.235 * s, 0, K.black, MAT.metal, { n: 16 });
  P.cyl(0.045 * s, 0.06 * s, 0.03 * s, 0, 0.275 * s, 0, K.black, MAT.metal, { n: 10 }); // the ring it hangs by
  if (hang > 0) P.cyl(0.012, 0.012, hang + 0.04, 0, 0.29 * s + hang / 2, 0, K.black, 0, { n: 4 });
  c.lights.push({ x, y, z, i: 0.9 });
}
/** A square timber from local point a to b ([x, y, z]), run `over` metres on past each end so it seats into what it
    meets. Braces built this way always reach their posts, whatever the posts' lean.                                 */
function strut(P, a, b, t, col, over = 0) {
  const s = span(a, b);
  P.box(t, s.L + over * 2, t, s.x, s.y, s.z, col, 0, s.o);
}
/** a round limb from a (radius r0) to b (radius r1) */
function limb(P, a, b, r0, r1, col) {
  const s = span(a, b);
  P.add(cylG(r1, r0, s.L, 10), s.x, s.y, s.z, col, 0, s.o);
}
/** the centre, length and rotation that lay a part's local +Y axis from point a to point b */
function span(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2, L, o: { rx: Math.acos(dy / L), ry: Math.atan2(dx, dz) } };
}
/** How something with a round base of radius r sits on uneven ground at (x, z): `bed` is the level it stands at,
    tucked at most `tuck` into the uphill side, and `lo` the lowest ground under its rim, which a footing has to reach
    so that no edge of the base hangs in the air on the downhill side. */
export function seat(Y, x, z, r, tuck = 0.16) {
  let lo = Y(x, z), hi = lo;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 6.283;
    for (const f of [0.55, 1]) { const h = Y(x + Math.sin(a) * r * f, z + Math.cos(a) * r * f); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  }
  return { bed: Math.max(lo, hi - tuck), lo, hi };
}
/** the lowest and highest ground under a rectangle w × d centred at local (lx, lz) of a structure at (s.x, s.z, s.rot) */
function rangeUnder(c, s, lx, lz, w, d) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) { const [x, z] = local(s, lx + (i / 6 - 0.5) * w, lz + (j / 6 - 0.5) * d), g = c.Y(x, z); lo = Math.min(lo, g); hi = Math.max(hi, g); }
  return [lo, hi];
}
const lowUnder = (c, s, lx, lz, w, d) => rangeUnder(c, s, lx, lz, w, d)[0];
/** A battered masonry base (ishigaki): wTop × dTop at the top, flaring by bx / bz each side at the foot along the
    concave "fan" profile castle walls are laid to (upright at the top, spreading toward the ground). y = 0 at the foot. */
const _batter = new Map();
function batterGeo(wTop, dTop, bx, bz, H, n = 8) {
  const key = `${wTop},${dTop},${bx},${bz},${H},${n}`;
  if (_batter.has(key)) return _batter.get(key);
  const pos = [], idx = [], hx = (u) => wTop / 2 + bx * (1 - u) * (1 - u), hz = (u) => dTop / 2 + bz * (1 - u) * (1 - u);
  // four faces, each a strip of n rows, corners (sx, sz) walked counter-clockwise seen from above
  const C = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (let f = 0; f < 4; f++) {
    const [ax, az] = C[f], [bx2, bz2] = C[(f + 1) % 4], base = pos.length / 3;
    for (let j = 0; j <= n; j++) { const u = j / n; pos.push(ax * hx(u), u * H, az * hz(u), bx2 * hx(u), u * H, bz2 * hz(u)); }
    for (let j = 0; j < n; j++) { const a = base + j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  _batter.set(key, g);
  return g;
}
/** the interlocked corner stones of a battered base (sangi-zumi): long and short blocks alternating course by course,
    each leaning with the batter at its height so it lies on the face rather than standing out of it */
function cornerStones(P, wTop, dTop, bx, bz, H, y0, col, hc = 0.7) {
  const hx = (u) => wTop / 2 + bx * (1 - u) * (1 - u), hz = (u) => dTop / 2 + bz * (1 - u) * (1 - u);
  const n = Math.floor(H / hc), L = hc * 2.6, S = hc * 1.35;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, y = y0 + u * H, ax = Math.atan((2 * bx * (1 - u)) / H), az = Math.atan((2 * bz * (1 - u)) / H);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const lx = (i + (sx * sz > 0 ? 0 : 1)) % 2 === 0, w = lx ? L : S, d = lx ? S : L;
      P.box(w, (H / n) - 0.05, d, sx * (hx(u) - w / 2 + 0.06), y, sz * (hz(u) - d / 2 + 0.06), col, MAT.plain, { rz: sx * ax, rx: -sz * az });
    }
  }
}
/** A barred window (renji-mado) on a wall face: lit shoji behind a row of square bars in a heavy frame with a sill.
    (x, y, z) is its centre on the wall's surface; ry turns it to face local +Z (0), -Z (π), +X (π/2) or -X (-π/2). */
function barWindow(P, x, y, z, w, h, ry, frame = K.woodD, nb = 5, glow = '#ffcf99') {
  const cr = Math.cos(ry), sr = Math.sin(ry), at = (dx, dz) => [x + dx * cr + dz * sr, z - dx * sr + dz * cr];
  const put = (bw, bh, bd, dx, dy, dz, col, mat = 0, o = {}) => { const [px, pz] = at(dx, dz); P.box(bw, bh, bd, px, y + dy, pz, col, mat, { ...o, ry }); };
  put(w, h, 0.04, 0, 0, 0, glow, MAT.paper, { uvS: 0.3 });
  for (let i = 0; i < nb; i++) put(0.07, h, 0.06, -w / 2 + (w * (i + 0.5)) / nb, 0, 0.05, frame);
  put(w + 0.26, 0.13, 0.14, 0, h / 2 + 0.065, 0.06, frame);
  put(w + 0.34, 0.12, 0.2, 0, -h / 2 - 0.06, 0.08, frame);
  for (const s of [-1, 1]) put(0.12, h, 0.14, s * (w / 2 + 0.06), 0, 0.06, frame);
}
function stoneLantern(c, s, y0) {
  // a lantern given a `rot` (zone files place them with beside()) turns a window square to the path it lights
  const k = s.big ? 1.5 : 1, st = s.mossy ? '#8a9a84' : K.stone, sd = s.mossy ? '#6d7f6c' : K.stoneD, rot = s.rot ?? hash(s.x, s.z) * 6.28;
  // on a slope the base stands on a cut-stone footing set into the ground, its top level with the uphill side, so no
  // corner of the base hangs over the falling ground (a lantern given `y` stands on something built: a wall top)
  let y = y0;
  if (s.pier) {
    // a masonry pier built against a wall (the zone gives its top as y and its width as pier), its cap a slab like
    // the wall's coping, its foot below the lowest ground under it
    const pw = s.pier, lo = lowUnder(c, { x: s.x, z: s.z, rot }, 0, 0, pw, pw), F = c.P.at(s.x, y, s.z, rot), h = y - 0.16 - (lo - 0.4);
    F.box(pw, h, pw, 0, -0.16 - h / 2, 0, K.stoneD, MAT.stone, { grad: [0.78, 1.02] }).box(pw + 0.14, 0.17, pw + 0.14, 0, -0.085, 0, K.stone);
  } else if (s.y === undefined) {
    // the ground under a square platform turned with the lantern (a stair's shoulder climbs with the flight, so the
    // relief is mostly along it); the platform's top is level, tucked a little into the uphill side
    const [lo, hi] = rangeUnder(c, { x: s.x, z: s.z, rot }, 0, 0, 1.3 * k, 1.3 * k);
    y = Math.max(lo, hi - 0.2);
    const rise = y - lo, F = c.P.at(s.x, y, s.z, rot, 1);
    if (rise > 0.3) {
      // two dressed slabs, the lower one broader: a stepped plinth built up off the falling ground
      F.box(1.2 * k, 0.3, 1.2 * k, 0, -0.19, 0, shade(sd, 0.96), MAT.plain).box(1.5 * k, rise - 0.04, 1.5 * k, 0, -0.34 - (rise - 0.04) / 2 + 0.01, 0, shade(sd, 0.86), MAT.plain);
    } else if (rise > 0.05) F.box(1.2 * k, rise + 0.3, 1.2 * k, 0, -0.04 - (rise + 0.3) / 2, 0, shade(sd, 0.93), MAT.plain);
  }
  lanternBody(c.P.at(s.x, y - 0.05, s.z, rot, k), st, sd, s.mossy);
  c.lights.push({ x: s.x, y: y - 0.05 + FIREBOX_Y * k, z: s.z, i: s.big ? 1.2 : 0.8 });
}
/** a square frustum (half-widths a at the top, b at the foot, height h), its faces square to the axes and flat */
const _sq = new Map();
function sqG(a, b, h) {
  const key = `${a},${b},${h}`;
  if (!_sq.has(key)) { const g = new THREE.CylinderGeometry(a * Math.SQRT2, b * Math.SQRT2, h, 4, 1).toNonIndexed(); g.rotateY(Math.PI / 4); g.computeVertexNormals(); _sq.set(key, g); }
  return _sq.get(key);
}
/** the height of a stone lantern's flame above its foot */
export const FIREBOX_Y = 1.525;
/** A carved square stone lantern (kaku-dōrō), its foot at the parts list's anchor and its papered windows facing local
    ±Z (the path, when it stands beside one). Footing and chamfered plinth; a round shaft with a carved band; a platform
    flaring out of it; a firebox of four corner posts on a sill under a lintel, paper windows set back between the
    posts front and back, a sun cut through one side and a crescent moon through the other; a roof with upturned
    corners; the jewel finial in its lotus cup. The paper is lantern paper (MAT.lampWin): plain by day, lit at night.  */
export function lanternBody(P, st = K.stone, sd = K.stoneD, mossy = false) {
  const sl = shade(st, 1.08);
  P.box(0.66, 0.14, 0.66, 0, 0.07, 0, sd, MAT.plain).add(sqG(0.2, 0.27, 0.12), 0, 0.2, 0, st, MAT.plain);
  P.cyl(0.15, 0.17, 0.04, 0, 0.28, 0, sd, MAT.plain, { n: 16 });
  P.cyl(0.115, 0.135, 0.86, 0, 0.72, 0, st, MAT.plain, { n: 14, grad: [0.86, 1.02] });
  P.cyl(0.142, 0.142, 0.05, 0, 0.74, 0, sd, MAT.plain, { n: 14 });
  for (const dy of [-0.05, 0.05]) P.cyl(0.13, 0.13, 0.016, 0, 0.74 + dy, 0, sd, MAT.plain, { n: 14 });
  P.add(sqG(0.25, 0.13, 0.14), 0, 1.2, 0, sd, MAT.plain).box(0.52, 0.07, 0.52, 0, 1.305, 0, st, MAT.plain);
  // firebox: the posts run 5 mm into the sill and lintel, the windows 5 mm into the posts
  P.box(0.42, 0.05, 0.42, 0, 1.365, 0, st, MAT.plain).box(0.42, 0.05, 0.42, 0, 1.685, 0, st, MAT.plain);
  for (const x of [-1, 1]) for (const z of [-1, 1]) P.box(0.075, 0.28, 0.075, x * 0.1725, 1.525, z * 0.1725, st, MAT.plain);
  for (const z of [-1, 1]) P.box(0.28, 0.28, 0.012, 0, 1.525, z * 0.15, K.paper, MAT.lampWin);
  for (const x of [-1, 1]) {
    P.box(0.03, 0.28, 0.28, x * 0.165, 1.525, 0, st, MAT.plain);
    P.cyl(0.068, 0.068, 0.012, x * 0.183, 1.525, 0, K.paper, MAT.lampWin, { n: 18, rz: Math.PI / 2 });
    P.add(torusG(0.072, 0.012, 5, 18), x * 0.184, 1.525, 0, sd, MAT.plain, { ry: Math.PI / 2 });
    if (x < 0) P.cyl(0.058, 0.058, 0.014, x * 0.186, 1.538, 0.034, st, MAT.plain, { n: 18, rz: Math.PI / 2 }); // leaves the moon a crescent
  }
  P.add(kasaGeo({ n: 4, r: 0.52, th: 0.06, h: 0.2, lift: 0.07, crown: 0.09 }), 0, 1.71, 0, sd, MAT.plain, { uv: 'xz', ry: Math.PI / 4 });
  for (const x of [-1, 1]) for (const z of [-1, 1]) P.add(sphG(0.032, 7, 5), x * 0.35, 1.835, z * 0.35, sd, MAT.plain);
  P.cyl(0.1, 0.07, 0.06, 0, 2.0, 0, st, MAT.plain, { n: 12 }).add(sphG(0.085, 12, 8), 0, 2.1, 0, sl, MAT.plain).add(coneG(0.05, 0.1, 10), 0, 2.2, 0, sl, MAT.plain);
  if (mossy) P.add(sphG(0.26, 7, 5), 0.04, 1.9, 0.02, K.moss, 0, { sy: 0.32 });
}
function post(P, x, z, h, r = 0.09, col = K.woodD) { P.box(r * 2, h, r * 2, x, h / 2, z, col); }

/* ---------- houses ---------- */
function house(s, c) {
  // on a slope the house is set into the hill (by at most 0.45 on its uphill side) and its stone footing is carried
  // down to below the lowest ground under it, so the downhill side stands on a terrace wall instead of on air
  const h = HOUSE[s.kind], [gl, gh] = rangeUnder(c, s, 0, 0, h.w + 0.5, h.d + 0.5), y = Math.max(c.Y(s.x, s.z), gh - 0.45), P = c.P.at(s.x, y, s.z, s.rot);
  const t = 0.9 + hash(s.x, s.z) * 0.18, y0 = 0.42, wh = h.h, zf = h.d / 2;
  const wall = h.kura ? '#f0ebdf' : shade(K.plaster, t), wood = shade(K.woodD, 0.9 + hash(s.x, s.z, 2) * 0.3);
  const fb = Math.min(-0.08, gl - y - 0.3);
  P.box(h.w + 0.5, 0.42 - fb, h.d + 0.5, 0, (0.42 + fb) / 2, 0, K.stoneD, MAT.stone);
  P.box(h.w, wh, h.d, 0, y0 + wh / 2, 0, wall, MAT.plaster, { grad: [0.8, 1.04] });
  if (h.kura) {
    P.box(h.w + 0.08, 1.3, h.d + 0.08, 0, y0 + 0.65, 0, '#3a3f48', MAT.stone); // namako lower wall
    P.box(0.9, 0.7, 0.1, 0, y0 + wh - 0.9, zf + 0.03, K.black).box(1.3, 1.9, 0.12, 0, y0 + 0.95, zf + 0.04, K.woodD, MAT.plank, { uv: 'h' });
    addRoof(P, { w: h.w + 1.3, d: h.d + 1.5, h: 1.9, ridge: h.w + 1.3, lift: 0.16 }, 0, y0 + wh, 0, shade(K.tileD, t), { wall });
  } else {
    P.box(h.w + 0.07, 0.95, h.d + 0.07, 0, y0 + 0.475, 0, wood, MAT.plank, { uv: 'h' });
    P.box(h.w + 0.14, 0.24, h.d + 0.14, 0, y0 + wh - 0.12, 0, wood);
    const nx = Math.round(h.w / 2.3);
    for (let i = 0; i <= nx; i++) for (const zz of [-1, 1]) P.box(0.2, wh, 0.2, -h.w / 2 + (h.w * i) / nx, y0 + wh / 2, zz * (zf + 0.02), wood);
    for (const xx of [-1, 1]) P.box(0.2, wh, 0.2, xx * (h.w / 2 + 0.02), y0 + wh / 2, 0, wood);
    // sliding door and paper windows on the front, one window on each side wall
    const dx = (hash(s.x, s.z, 4) - 0.5) * h.w * 0.25;
    P.box(1.9, 2.05, 0.1, dx, y0 + 1.02, zf + 0.05, K.paper, MAT.paper);
    P.box(2.1, 0.14, 0.14, dx, y0 + 2.1, zf + 0.06, wood);
    for (const sgn of [-1, 1]) {
      const wx = dx + sgn * (h.w * 0.31);
      if (Math.abs(wx) < h.w / 2 - 0.9) P.box(1.5, 0.95, 0.08, wx, y0 + 1.75, zf + 0.04, K.paper, MAT.paper);
      P.box(0.08, 0.9, 1.5, sgn * (h.w / 2 + 0.04), y0 + 1.75, 0.4, K.paper, MAT.paper, { uv: 'zy' });
    }
    // veranda and eave posts
    P.box(h.w * 0.92, 0.16, 1.3, 0, y0 + 0.02, zf + 0.68, K.wood, MAT.plank, { uv: 'xz' });
    for (let i = 0; i < 4; i++) {
      // each eave post carries on down under the veranda as a short post on a flat stone, wherever the ground is
      const px = -h.w * 0.44 + (h.w * 0.88 * i) / 3, [wx, wz] = local({ x: s.x, z: s.z, rot: s.rot }, px, zf + 1.25), g = c.Y(wx, wz) - y;
      P.box(0.14, wh - 0.1, 0.14, px, y0 + (wh - 0.1) / 2, zf + 1.25, wood);
      if (g < y0 - 0.16) P.box(0.14, y0 - 0.06 - g, 0.14, px, (y0 - 0.06 + g) / 2, zf + 1.25, wood).box(0.34, 0.16, 0.34, px, g + 0.03, zf + 1.25, K.stoneD);
    }
    if (h.roof === 'thatch') {
      addRoof(P, { w: h.w + 2.4, d: h.d + 3.0, h: 3.1, ridge: h.w * 0.5, lift: 0.1, curve: 1.2 }, 0, y0 + wh - 0.05, 0.2, shade(K.thatch, t), { mat: MAT.thatch, wall });
    } else if (h.upper) {
      addRoof(P, { w: h.w + 2.2, d: h.d + 3.0, h: 1.5, ridge: h.w * 0.78, lift: 0.3, curve: 1.3 }, 0, y0 + wh - 0.05, 0.2, shade(K.tile, t), { wall, ridgeCap: false });
      const uw = h.w * 0.66, ud = h.d * 0.62, uy = y0 + wh + 0.5;
      P.box(uw, 2.5, ud, 0, uy + 1.25, 0, wall, MAT.plaster, { grad: [0.86, 1.04] }).box(uw + 0.1, 0.2, ud + 0.1, 0, uy + 2.4, 0, wood);
      for (let i = 0; i < 4; i++) P.box(1.2, 1.0, 0.08, -uw * 0.36 + (uw * 0.72 * i) / 3, uy + 1.4, ud / 2 + 0.04, K.paper, MAT.paper);
      P.box(uw + 0.8, 0.1, 0.9, 0, uy + 0.55, ud / 2 + 0.4, K.wood, MAT.plank, { uv: 'xz' }).box(uw + 0.8, 0.08, 0.08, 0, uy + 1.15, ud / 2 + 0.82, wood);
      addRoof(P, { w: uw + 2.2, d: ud + 2.4, h: 2.2, ridge: uw * 0.6, lift: 0.36 }, 0, uy + 2.5, 0, shade(K.tile, t), { wall });
    } else {
      addRoof(P, { w: h.w + 2.0, d: h.d + 2.9, h: 2.35, ridge: h.w * 0.62, lift: 0.34 }, 0, y0 + wh - 0.05, 0.2, shade(K.tile, t), { wall });
    }
  }
  if (s.lantern) { const [lx, lz] = local(s, h.w * 0.36, zf + 1.3); paperLantern(c, lx, y + y0 + wh - 0.75, lz, 1.1, s.kind === 'inn' ? GLOW_RED : GLOW, 0.46); }
  // no lantern: a soft glow spills from the paper door (the same off-centre door drawn above)
  else if (!h.kura) { const [lx, lz] = local(s, (hash(s.x, s.z, 4) - 0.5) * h.w * 0.25, zf + 0.6); c.lights.push({ x: lx, y: y + y0 + 1.1, z: lz, i: 0.5 }); }
  if (s.noren) {
    const dx = (hash(s.x, s.z, 4) - 0.5) * h.w * 0.25;
    const [ox, oz] = local(s, dx - 1.0, zf + 0.16), cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    for (let i = 0; i < 3; i++) clothQuad(c.cloth, ox + cr * 0.67 * i, y + y0 + 2.05, oz - sr * 0.67 * i, cr, -sr, 0.64, 0.8, s.noren, { fixed: 'top', seg: 3, emblem: i === 1 ? 3 : 0, phase: hash(s.x, s.z, i) });
  }
}
function mill(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot), mb = Math.min(-0.25, lowUnder(c, s, 0, 0, 7, 6) - y - 0.3);
  P.box(7, 0.65 - mb, 6, 0, (0.65 + mb) / 2, 0, K.stoneD, MAT.stone).box(6.4, 3.0, 5.4, 0, 2.1, 0, shade(K.wood, 0.95), MAT.plank, { uv: 'h', grad: [0.8, 1.05] });
  P.box(1.5, 1.9, 0.1, 1.2, 1.6, 2.75, K.woodD, MAT.plank, { uv: 'h' }).box(1.3, 0.8, 0.08, -1.4, 2.4, 2.74, K.paper, MAT.paper);
  addRoof(P, { w: 8.4, d: 7.6, h: 2.8, ridge: 3.4, lift: 0.1, curve: 1.2 }, 0, 3.55, 0, K.thatch, { mat: MAT.thatch });
  // axle out of the west wall, through the wheel (x -5.68 to -4.82, paddle tips at radius 2.8) to a bearing frame
  // standing clear of it on the far side, so nothing the wheel sweeps through
  P.cyl(0.18, 0.18, 3.15, -4.575, 1.75, 0.3, K.woodD, 0, { rz: Math.PI / 2 });
  P.box(0.3, 2.25, 0.3, -6.0, 0.6, -0.2, K.woodD).box(0.3, 2.25, 0.3, -6.0, 0.6, 0.8, K.woodD).box(0.34, 0.26, 1.34, -6.0, 1.66, 0.3, K.woodD);
  // the flume comes in from upstream on a trestle and spills onto the wheel's crown (the crown turns toward +z),
  // its underside everywhere above the paddle tips (1.75 + 2.8 = 4.55)
  P.box(0.7, 0.1, 4.6, -5.25, 4.72, -2.0, K.wood, MAT.plank, { uv: 'zx', rx: 0.03 });
  for (const sx of [-1, 1]) P.box(0.06, 0.3, 4.6, -5.25 + sx * 0.33, 4.87, -2.0, K.wood, MAT.plank, { uv: 'zy', rx: 0.03 });
  for (const sx of [-1, 1]) P.box(0.2, 5.5, 0.2, -5.25 + sx * 0.28, 2.0, -3.9, K.woodD);
  P.box(0.8, 0.16, 0.2, -5.25, 4.66, -3.9, K.woodD);
  const wheel = new Parts(), R = 2.5;
  wheel.add(torusG(R, 0.09, 5, 20), 0, 0, 0, K.woodD, 0, { ry: Math.PI / 2 }).add(torusG(R, 0.09, 5, 20), 0.7, 0, 0, K.woodD, 0, { ry: Math.PI / 2 });
  wheel.add(torusG(R * 0.45, 0.07, 5, 14), 0.35, 0, 0, K.woodD, 0, { ry: Math.PI / 2 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    wheel.box(0.86, 0.06, 0.6, 0.35, Math.cos(a) * R, Math.sin(a) * R, K.wood, MAT.plank, { rx: a + Math.PI / 2, uv: 'xz' });
    if (i % 2 === 0) wheel.box(0.1, R * 2, 0.1, 0.35, 0, 0, K.wood, 0, { rx: a });
  }
  const [wx, wz] = local(s, -5.6, 0.3);
  c.spin.push({ parts: wheel.list, x: wx, y: y + 1.75, z: wz, rot: s.rot, speed: 0.55 });
}
function hall(s, c, grand) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot), w = s.w, d = s.d;
  const py = grand ? 2.1 : 0.9, wh = grand ? 5.2 : 3.4, porch = grand ? 5.6 : 2.2;
  P.box(w + 3, py + 1.4, d + 2 + porch, 0, py / 2 - 0.7, porch / 2, K.stone, MAT.stone, { grad: [0.78, 1.02] });
  P.box(w, wh, d, 0, py + wh / 2, 0, K.plaster, MAT.plaster, { grad: [0.84, 1.05] });
  P.box(w + 0.1, 1.1, d + 0.1, 0, py + 0.55, 0, K.woodD, MAT.plank, { uv: 'h' });
  const n = Math.round(w / 3.6);
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + (w * i) / n;
    P.cyl(0.26, 0.3, wh, x, py + wh / 2, d / 2 + 0.05, K.red, 0, { n: 10 });
    if (grand) P.cyl(0.26, 0.3, wh, x, py + wh / 2, d / 2 + porch - 1.2, K.red, 0, { n: 10 }).box(0.7, 0.3, 0.7, x, py + wh - 0.15, d / 2 + porch - 1.2, K.gold);
    if (i < n) P.box(w / n - 0.8, wh * 0.62, 0.12, x + w / n / 2, py + wh * 0.4, d / 2 + 0.03, K.paper, MAT.paper);
  }
  P.box(w + 0.6, 0.5, 0.5, 0, py + wh - 0.25, d / 2 + (grand ? porch - 1.2 : 0.1), K.redD).box(w + 0.4, 0.4, d + 0.4, 0, py + wh - 0.2, 0, K.woodD);
  if (grand) {
    addRoof(P, { w: w + 8, d: d + porch + 7, h: 2.6, ridge: w * 0.82, lift: 1.0, curve: 1.3, segU: 12 }, 0, py + wh, porch / 2 - 0.6, K.tile, { ridgeCap: false });
    P.box(w * 0.74, 2.2, d * 0.56, 0, py + wh + 2.9, 0, K.plaster, MAT.plaster).box(w * 0.74 + 0.2, 0.4, d * 0.56 + 0.2, 0, py + wh + 3.8, 0, K.redD);
    addRoof(P, { w: w + 2.5, d: d + 3, h: 5.2, ridge: w * 0.5, lift: 1.1, curve: 1.7, segU: 12, segV: 7 }, 0, py + wh + 4.0, 0, K.tileD);
    for (const sx of [-1, 1]) P.add(coneG(0.34, 1.3, 5), sx * (w * 0.25 + 0.3), py + wh + 10.0, 0, K.gold, MAT.metal, { rz: sx * -0.5 });
    // offering box and bell rope on the porch
    P.box(2.2, 0.9, 1.1, 0, py + 0.45, d / 2 + 1.6, K.woodD, MAT.plank, { uv: 'h' }).cyl(0.05, 0.05, 3.2, 0, py + 3.4, d / 2 + 1.2, K.rope);
    const [lx, lz] = local(s, 0, d / 2 + 2.5); // out on the porch, wherever the hall faces
    c.lights.push({ x: lx, y: y + py + 2.4, z: lz, i: 1.4 });
  } else {
    addRoof(P, { w: w + 3.4, d: d + 3.8, h: 3.3, ridge: w * 0.6, lift: 0.6, curve: 1.6 }, 0, py + wh, 0, K.tile);
  }
}
function barracks(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot), w = 13, d = 8.4, wh = 3.3;
  P.box(w + 0.5, 0.6, d + 0.5, 0, 0.2, 0, K.stoneD, MAT.stone).box(w, wh, d, 0, 0.5 + wh / 2, 0, '#e9e2d2', MAT.plaster, { grad: [0.8, 1.04] });
  P.box(w + 0.08, 1.4, d + 0.08, 0, 1.2, 0, K.black, MAT.plank, { uv: 'h' });
  for (let i = 0; i < 4; i++) P.box(1.5, 1.0, 0.1, -w * 0.36 + (w * 0.72 * i) / 3, 2.7, d / 2 + 0.04, K.paper, MAT.paper);
  P.box(2.0, 2.2, 0.12, 0, 1.6, d / 2 + 0.06, K.woodD, MAT.plank, { uv: 'h' });
  addRoof(P, { w: w + 2, d: d + 2.6, h: 2.6, ridge: w * 0.7, lift: 0.4 }, 0, 0.5 + wh, 0, K.tileD);
  const [lx, lz] = local(s, 2.4, d / 2 + 0.9);
  paperLantern(c, lx, y + 2.9, lz, 1.2, GLOW_RED, 0.6);
}
function hut(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.box(4.6, 2.6, 3.6, 0, 1.3, 0, K.wood, MAT.plank, { uv: 'h', grad: [0.8, 1.05] }).box(1.2, 1.9, 0.1, 0.8, 0.95, 1.82, K.black);
  addRoof(P, { w: 6, d: 5, h: 1.6, ridge: 6, lift: 0.1 }, 0, 2.6, 0, K.tileD, { wall: K.wood });
}
function pavilion(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  // a low stone plinth and a board floor 0.2 up: one easy step (footprints.js floors() gives feet this height)
  P.box(5, 0.3, 5, 0, 0, 0, K.stone, MAT.stone).box(4.6, 0.08, 4.6, 0, 0.16, 0, K.wood, MAT.plank, { uv: 'xz' });
  for (const [x, z] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) P.cyl(0.14, 0.16, 3.2, x, 1.8, z, K.redD, 0, { n: 8 });
  P.box(4.3, 0.2, 0.2, 0, 3.3, 1.9, K.woodD).box(4.3, 0.2, 0.2, 0, 3.3, -1.9, K.woodD).box(0.2, 0.2, 4.3, 1.9, 3.3, 0, K.woodD).box(0.2, 0.2, 4.3, -1.9, 3.3, 0, K.woodD);
  addRoof(P, { w: 7, d: 7, h: 2.6, ridge: 0, lift: 0.7, curve: 1.7 }, 0, 3.4, 0, K.tile, { ridgeCap: false });
  P.add(sphG(0.22), 0, 6.1, 0, K.gold, MAT.metal);
  paperLantern(c, s.x, y + 2.7, s.z, 1.1, GLOW, 0.4);
}
function pagoda(s, c) {
  const y = c.Y(s.x, s.z), k = s.s || 1, P = c.P.at(s.x, y, s.z, s.rot || 0, k), pb = Math.min(-0.3, (lowUnder(c, s, 0, 0, 9.4 * k, 9.4 * k) - y - 0.3) / k);
  P.box(9.4, 0.9 - pb, 9.4, 0, (0.9 + pb) / 2, 0, K.stone, MAT.stone);
  let yy = 0.9, w = 6.4;
  for (let i = 0; i < (s.tiers || 5); i++) {
    const hh = i === 0 ? 3.4 : 2.1;
    P.box(w, hh, w, 0, yy + hh / 2, 0, K.plaster, MAT.plaster, { grad: [0.85, 1.03] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.cyl(0.2, 0.22, hh, sx * w / 2, yy + hh / 2, sz * w / 2, K.red, 0, { n: 8 });
    P.box(w + 0.3, 0.3, w + 0.3, 0, yy + hh - 0.15, 0, K.redD).box(w * 0.4, hh * 0.6, w + 0.06, 0, yy + hh * 0.42, 0, K.woodD, MAT.plank, { uv: 'h' }).box(w + 0.06, hh * 0.6, w * 0.4, 0, yy + hh * 0.42, 0, K.woodD, MAT.plank, { uv: 'h' });
    yy += hh;
    addRoof(P, { w: w + 4.4, d: w + 4.4, h: 1.5, ridge: 0, lift: 0.85, curve: 1.5 }, 0, yy, 0, i % 2 ? K.tileD : K.tile, { ridgeCap: false });
    yy += 0.75;
    w *= 0.84;
  }
  P.cyl(0.12, 0.2, 4.6, 0, yy + 2.6, 0, K.gold, MAT.metal);
  for (let i = 0; i < 6; i++) P.add(torusG(0.42 - i * 0.045, 0.06, 5, 10), 0, yy + 1.6 + i * 0.5, 0, K.gold, MAT.metal, { rx: Math.PI / 2 });
  P.add(sphG(0.22), 0, yy + 5.0, 0, K.gold, MAT.metal);
}
/* Solids of revolution for the statue. LEAF is a pointed leaf, widest just below half height: flattened, it makes the
   lotus petals, the flame tongues and the mandorla. TORSO runs from the hips up through the chest to rounded shoulders. */
const LEAF = [[0, 0], [0.28, 0.08], [0.44, 0.26], [0.48, 0.48], [0.4, 0.7], [0.22, 0.88], [0.1, 0.97], [0, 1.04]];
const TORSO = [[0, 0], [0.86, 0.02], [0.9, 0.35], [0.85, 0.78], [0.92, 1.2], [0.95, 1.45], [0.84, 1.68], [0.55, 1.85], [0.3, 1.93], [0, 1.95]];
let _leaf = null, _torso = null;
const lathe = (pts, n) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), n);
const leafG = () => (_leaf ??= lathe(LEAF, 10));
const torsoG = () => (_torso ??= lathe(TORSO, 16));
function statue(s, c) {
  // a seated Buddha on a lotus throne, hands in the meditation mudra, a flame-edged mandorla behind. Faces local +z.
  const y = c.Y(s.x, s.z), k = s.s || 1, P = c.P.at(s.x, y, s.z, s.rot, k), st = '#8e9a94', sd = '#75827c', bronze = '#6f7c78';
  // plinth: two octagonal steps
  P.cyl(2.7, 3.0, 0.8, 0, 0.4, 0, sd, MAT.stone, { n: 8 }).cyl(2.25, 2.4, 0.3, 0, 0.95, 0, sd, MAT.stone, { n: 8 });
  // lotus throne: a waisted drum with a skirt of petals turned down over the step, then the seed-pod seat cupped by
  // two staggered rows of upturned petals (a petal's +z faces out once turned by ry; a positive rx tips it outward)
  P.cyl(1.5, 1.7, 0.35, 0, 1.275, 0, sd, MAT.plain, { n: 16 });
  for (let i = 0; i < 16; i++) { const a = ((i + 0.5) / 16) * 6.283; P.add(leafG(), Math.sin(a) * 1.72, 1.44, Math.cos(a) * 1.72, sd, 0, { ry: a, rx: Math.PI - 1.0, s: 0.75, sz: 0.2 }); }
  P.cyl(1.95, 1.55, 0.6, 0, 1.75, 0, st, MAT.plain, { n: 20 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * 6.283, b = a + Math.PI / 14;
    P.add(leafG(), Math.sin(b) * 1.6, 1.45, Math.cos(b) * 1.6, sd, 0, { ry: b, rx: 1.0, s: 0.62, sz: 0.22 });
    P.add(leafG(), Math.sin(a) * 1.5, 1.5, Math.cos(a) * 1.5, st, 0, { ry: a, rx: 0.75, sx: 0.95, sy: 0.85, sz: 0.22 });
  }
  const y0 = 2.05, ty = y0 + 0.32, hy = ty + 2.5, hz = -0.02, HR = 0.62; // seat top, hips, head centre
  // legs crossed in the lotus posture under the robe: knees out to the seat's edge, both soles turned up on the thighs
  P.add(sphG(1, 16, 10), 0, y0 + 0.3, 0.15, st, 0, { sx: 1.8, sy: 0.42, sz: 1.05 });
  for (const sx of [-1, 1]) {
    P.add(sphG(0.46, 10, 8), sx * 1.42, y0 + 0.3, 0.5, st, 0, { sy: 0.7 });
    P.add(sphG(0.4, 8, 6), sx * 0.62, y0 + 0.66, 0.62, sd, 0, { sx: 1.05, sy: 0.26, sz: 0.55, ry: sx * 0.5 });
  }
  // torso (wider than deep) and neck; arms hang from round shoulders, rest along the thighs and meet in the lap
  P.add(torsoG(), 0, ty, -0.15, st, 0, { sx: 1.1, sz: 0.72 });
  P.cyl(0.26, 0.3, 0.42, 0, ty + 2.0, -0.12, st, 0, { n: 10 });
  for (const sx of [-1, 1]) {
    const sh = [sx * 0.95, ty + 1.48, -0.12], el = [sx * 1.2, y0 + 0.7, 0.18], wr = [sx * 0.4, y0 + 0.74, 0.72];
    P.add(sphG(0.36, 10, 8), ...sh, st).add(sphG(0.28, 8, 6), ...el, st);
    limb(P, sh, el, 0.33, 0.28, st);
    limb(P, el, wr, 0.27, 0.18, st);
  }
  // hands in dhyāna mudrā: one palm on the other, thumb tips touching in an arch
  P.add(sphG(0.3, 10, 8), 0, y0 + 0.74, 0.74, st, 0, { sx: 1.35, sy: 0.3, sz: 0.75 });
  P.add(torusG(0.11, 0.045, 5, 8, Math.PI), 0, y0 + 0.8, 0.78, st);
  // head: closed downcast eyes under arched brows, nose, a small smile, the ūrṇā, long earlobes
  P.add(sphG(HR, 16, 12), 0, hy, hz, st, 0, { sy: 1.12, sz: 0.95 });
  for (const sx of [-1, 1]) {
    P.add(torusG(0.12, 0.02, 4, 8, Math.PI), sx * 0.21, hy, hz + 0.545, sd, 0, { rz: Math.PI, sy: 0.45, ry: sx * 0.4 });
    P.add(torusG(0.2, 0.022, 4, 10, Math.PI), sx * 0.22, hy + 0.14, hz + 0.52, st, 0, { sy: 0.35, ry: sx * 0.45 });
    P.add(sphG(0.15, 8, 6), sx * 0.63, hy - 0.12, hz - 0.02, st, 0, { sx: 0.45, sy: 2.0, sz: 0.8 });
  }
  P.add(sphG(0.085, 6, 5), 0, hy - 0.1, hz + 0.6, st, 0, { sy: 1.7, sz: 1.1 });
  P.add(torusG(0.075, 0.016, 4, 6, Math.PI), 0, hy - 0.3, hz + 0.525, sd, 0, { rz: Math.PI, sy: 0.5 });
  P.add(sphG(0.045, 6, 5), 0, hy + 0.22, hz + 0.565, K.gold, MAT.metal);
  // tight snail-shell curls over the scalp (the face and the ears left bare), and over the crown's topknot
  const curl = sphG(0.075, 5, 4);
  for (const [e, n] of [[0.12, 18], [0.36, 17], [0.6, 15], [0.84, 12], [1.08, 9], [1.32, 4]]) for (let i = 0; i < n; i++) {
    const az = ((i + e * 3) / n) * 6.283;
    if ((e < 0.5 && Math.cos(az) > 0.45) || (e < 0.3 && Math.abs(Math.sin(az)) > 0.8)) continue;
    P.add(curl, Math.cos(e) * Math.sin(az) * HR, hy + Math.sin(e) * HR * 1.12, hz + Math.cos(e) * Math.cos(az) * HR * 0.95, sd);
  }
  P.add(sphG(0.36, 10, 8), 0, hy + 0.62, hz - 0.06, sd, 0, { sy: 0.85 });
  for (const [e, n] of [[0.1, 10], [0.7, 5]]) for (let i = 0; i < n; i++) {
    const az = ((i + e) / n) * 6.283;
    P.add(curl, Math.cos(e) * Math.sin(az) * 0.36, hy + 0.62 + Math.sin(e) * 0.31, hz - 0.06 + Math.cos(e) * Math.cos(az) * 0.36, sd);
  }
  // mandorla: a bronze leaf rimmed in gold, rooted in the seat behind the figure, gold rings for the head and body
  // halos, flame tongues licking up round its edge
  const my = y0 - 0.1, mz = -1.0, MX = 3.55, MY = 4.05;
  // three layers: bronze faces front and back, the gold layer between them shows only as the rim
  P.add(leafG(), 0, my - 0.08, mz - 0.04, K.gold, MAT.metal, { sx: MX + 0.2, sy: MY + 0.2, sz: 0.1 });
  P.add(leafG(), 0, my, mz, bronze, MAT.metal, { sx: MX, sy: MY, sz: 0.1 }).add(leafG(), 0, my, mz - 0.09, shade(bronze, 0.85), MAT.metal, { sx: MX, sy: MY, sz: 0.1 });
  P.add(torusG(0.92, 0.055, 5, 28), 0, hy + 0.05, -0.92, K.gold, MAT.metal).add(torusG(0.7, 0.035, 5, 24), 0, hy + 0.05, -0.92, K.gold, MAT.metal);
  P.add(torusG(1.0, 0.05, 5, 32), 0, ty + 0.95, -0.92, K.gold, MAT.metal, { sx: 1.45, sy: 1.15 });
  for (let j = 2; j < LEAF.length; j++) for (const sx of j === LEAF.length - 1 ? [0] : [-1, 1]) {
    const [r, h] = LEAF[j], [r0, h0] = LEAF[j - 1], [r1, h1] = LEAF[Math.min(LEAF.length - 1, j + 1)];
    // outward normal of the rim here, bent upward so the flames rise
    let nx = sx * (h1 - h0) * MY, ny = -(r1 - r0) * MX;
    if (!sx) { nx = 0; ny = 1; }
    const l = Math.hypot(nx, ny + 0.8 * Math.hypot(nx, ny)), dx = nx / l, dy = (ny + 0.8 * Math.hypot(nx, ny)) / l;
    P.add(leafG(), sx * r * MX - dx * 0.12, my + h * MY - dy * 0.12, mz - 0.04, K.gold, MAT.metal, { rz: Math.atan2(-dx, dy), s: 0.42, sz: 0.1 });
  }
  // moss creeping over a shoulder and onto the lower step (each patch kept within the surface it grows on)
  P.add(sphG(0.3, 6, 5), -0.85, ty + 1.8, -0.2, K.moss, 0, { sy: 0.2 }).add(sphG(0.32, 6, 5), 1.44, 0.8, -1.92, K.moss, 0, { sy: 0.12 });
}
function belltower(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.box(5, 1.0, 5, 0, 0.3, 0, K.stone, MAT.stone);
  // the four pillars splay out toward their feet (a positive rz tips a post's top toward -x, a positive rx toward +z)
  for (const [x, z] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) P.cyl(0.2, 0.26, 4.2, x, 2.9, z, K.woodD, 0, { n: 8, rz: x * 0.03, rx: -z * 0.03 });
  P.box(4, 0.3, 0.3, 0, 4.7, 1.6, K.woodD).box(4, 0.3, 0.3, 0, 4.7, -1.6, K.woodD).box(0.3, 0.3, 4, 1.6, 4.7, 0, K.woodD).box(0.3, 0.3, 4, -1.6, 4.7, 0, K.woodD);
  addRoof(P, { w: 7, d: 7, h: 2.6, ridge: 2.2, lift: 0.7 }, 0, 4.9, 0, K.tile);
  P.cyl(0.72, 0.9, 1.6, 0, 3.4, 0, K.bronze, MAT.metal, { n: 12 }).add(sphG(0.72, 10, 6), 0, 4.2, 0, K.bronze, MAT.metal, { sy: 0.6 }).cyl(0.92, 0.94, 0.14, 0, 2.62, 0, shade(K.bronze, 0.8), MAT.metal, { n: 12 });
  // the striker log hangs on two ropes, its head just off the bell's waist (radius 0.83 at this height): one rope
  // from the tie beam over it, one from the rafters under the eave
  P.cyl(0.14, 0.14, 2.4, 2.08, 3.2, 0, K.wood, 0, { rz: Math.PI / 2 });
  P.cyl(0.02, 0.02, 1.26, 1.6, 3.95, 0, K.rope, 0, { n: 4 }).cyl(0.02, 0.02, 2.06, 2.75, 4.33, 0, K.rope, 0, { n: 4 });
}
/** a gable end: the wall from a side wall's top (y = 0) up to the underside of the roof, |z| <= half, extruded along +z */
function gableGeo(roofY, half, depth) {
  const sh = new THREE.Shape(), n = 6;
  sh.moveTo(-half, 0);
  sh.lineTo(half, 0);
  for (let i = 0; i <= n; i++) { const z = half - (2 * half * i) / n; sh.lineTo(z, Math.max(0, roofY(z) - 0.02)); }
  return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
}
const SHRINE_ROOF = { w: 1.6, d: 1.7, h: 0.75, ridge: 1.6, lift: 0.06, curve: 1.25, segU: 3, segV: 4 };
const shrineRoofY = (z) => SHRINE_ROOF.h * Math.pow(Math.max(0, 1 - Math.abs(z) / (SHRINE_ROOF.d / 2)), SHRINE_ROOF.curve);
let _shrineGable = null;
function shrine(s, c) {
  // a hokora: a small wooden sanctuary on a stone base under a gabled roof crowned with ridge logs (katsuogi) and
  // crossed finials (chigi), a shimenawa rope with paper shide across its front and an offering box at its foot.
  // Faces local +z.
  const y = c.Y(s.x, s.z), k = s.s || 1, P = c.P.at(s.x, y, s.z, s.rot, k), st = s.mossy ? '#84957f' : K.stone;
  const roofC = s.mossy ? '#4d6a52' : K.tileD, trim = K.woodD, R = SHRINE_ROOF, ry0 = 1.65;
  P.box(1.9, 0.5, 1.7, 0, 0.2, 0, st, MAT.stone).box(1.3, 0.2, 1.1, 0, 0.55, 0, K.stoneD);
  // the sanctuary: plank walls framed by corner posts and a head beam, lattice double doors under a gold lintel
  P.box(1.0, 1.0, 0.8, 0, 1.15, 0, K.wood, MAT.plank, { uv: 'h' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(0.09, 1.0, 0.09, sx * 0.5, 1.15, sz * 0.4, trim);
  P.box(1.08, 0.08, 0.88, 0, 1.6, 0, trim);
  P.box(0.56, 0.74, 0.05, 0, 1.06, 0.42, K.woodD).box(0.02, 0.74, 0.06, 0, 1.06, 0.425, K.black);
  for (const h of [0.82, 1.06, 1.3]) P.box(0.56, 0.025, 0.03, 0, h, 0.445, K.wood);
  for (const dx of [-0.19, -0.09, 0.09, 0.19]) P.box(0.025, 0.74, 0.03, dx, 1.06, 0.445, K.wood);
  P.box(0.64, 0.05, 0.05, 0, 1.45, 0.45, K.gold, MAT.metal);
  // roof: the gable walls close the space over the side walls (not out at the eaves' ends), so the roof overhangs
  // them; bargeboards along its edges run on up past the ridge as the chigi
  const r = roofGeo(R);
  P.add(r.slopes, 0, ry0, 0, roofC, MAT.tile).add(r.under, 0, ry0, 0, trim, MAT.plank);
  _shrineGable ??= gableGeo(shrineRoofY, 0.4, 0.05);
  for (const sx of [-1, 1]) P.add(_shrineGable, sx * 0.5 - 0.025, ry0, 0, K.wood, MAT.plank, { ry: Math.PI / 2, uv: 'h' });
  const bx = R.w / 2 + 0.02, edgeY = (z) => ry0 + shrineRoofY(z) + R.lift * (Math.abs(z) / (R.d / 2)) ** 2 + 0.03;
  const board = (a, b) => { const q = span(a, b); P.box(0.05, q.L + 0.04, 0.1, q.x, q.y, q.z, trim, 0, q.o); };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const zs = [0.85, 0.5, 0.22, 0].map((z) => z * sz);
    for (let i = 0; i < 3; i++) board([sx * bx, edgeY(zs[i]), zs[i]], [sx * bx, edgeY(zs[i + 1]), zs[i + 1]]);
    const rise = (edgeY(0) - edgeY(0.22)) / 0.22;
    board([sx * bx, edgeY(0), 0], [sx * bx, edgeY(0) + 0.32 * rise, -sz * 0.32]);
  }
  P.box(R.w + 0.1, 0.07, 0.12, 0, ry0 + R.h + 0.02, 0, shade(roofC, 0.7));
  for (const x of [-0.42, 0, 0.42]) {
    P.cyl(0.045, 0.045, 0.34, x, ry0 + R.h + 0.095, 0, trim, 0, { rx: Math.PI / 2, n: 8 });
    if (!s.mossy) for (const sz of [-1, 1]) P.cyl(0.048, 0.048, 0.03, x, ry0 + R.h + 0.095, sz * 0.17, K.gold, MAT.metal, { rx: Math.PI / 2, n: 8 });
  }
  // the shimenawa: strung between the front posts and sagging under the eave, three zigzag shide hanging from it
  const sag = 0.15, half = 0.5, Rr = (half * half + sag * sag) / (2 * sag), arc = 2 * Math.asin(half / Rr), yb = 1.46, rz = 0.475;
  P.add(torusG(Rr, 0.04, 5, 16, arc), 0, yb + Rr, rz, K.rope, 0, { rz: -Math.PI / 2 - arc / 2 });
  for (const dx of [-0.25, 0, 0.25]) {
    const ropeY = yb + Rr - Math.sqrt(Rr * Rr - dx * dx);
    for (let j = 0; j < 3; j++) P.box(0.06, 0.075, 0.008, dx + (j % 2 ? 0.025 : 0), ropeY - 0.07 - j * 0.07, rz + 0.01, '#f1ede2');
  }
  // the offering box stands on the base in front of the step (the forest shrines are long abandoned)
  if (!s.mossy) {
    P.box(0.6, 0.3, 0.26, 0, 0.6, 0.7, K.woodD, MAT.plank, { uv: 'h' });
    for (const dz of [-0.06, 0, 0.06]) P.box(0.56, 0.03, 0.03, 0, 0.765, 0.7 + dz, K.wood);
  }
}
function jizo(s, c) {
  const y = c.Y(s.x, s.z), n = s.n || 3, P = c.P.at(s.x, y, s.z, s.rot);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.62, k = 0.85 + hash(s.x, s.z, i) * 0.4;
    P.cyl(0.14 * k, 0.2 * k, 0.6 * k, x, 0.3 * k, 0, '#8d9990', 0, { n: 7 }).add(sphG(0.17 * k, 7, 6), x, 0.74 * k, 0, '#97a39a').box(0.3 * k, 0.16 * k, 0.05, x, 0.52 * k, 0.16 * k, K.red);
    if (i % 2 === 0) P.add(coneG(0.22 * k, 0.12 * k, 8), x, 0.92 * k, 0, K.red);
  }
}
function lantern(s, c) {
  const y = s.y ?? c.Y(s.x, s.z);
  if (s.kind === 'post') {
    // a street lamp: the post stands on the verge and its arm reaches out of its front (local +Z) over the way it
    // lights, so `rot` is simply the direction it faces (beside() turns it toward the path)
    const rot = s.rot ?? hash(s.x, s.z) * 6.28;
    const P = c.P.at(s.x, y, s.z, rot);
    P.box(0.16, 2.9, 0.16, 0, 1.45, 0, K.woodD).box(0.1, 0.1, 0.9, 0, 2.75, 0.36, K.woodD).box(0.4, 0.06, 0.4, 0, 2.95, 0, K.woodD);
    strut(P, [0, 2.32, 0.06], [0, 2.72, 0.44], 0.06, K.woodD, 0.03); // knee brace under the arm
    const [lx, lz] = local({ x: s.x, z: s.z, rot }, 0, 0.7);
    paperLantern(c, lx, y + 2.35, lz, 1.0, GLOW, 0.1);
  } else if (s.kind === 'yukimi') {
    // three splayed legs, each standing on the ground under its own foot: on a pond's sloping rim the downhill legs
    // run longer (down into the water if that is where they stand), and the lamp stays level
    const rot = s.rot ?? hash(s.x, s.z) * 6.28, feet = [];
    for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.283, [fx, fz] = local({ x: s.x, z: s.z, rot }, Math.sin(a) * 0.46, Math.cos(a) * 0.46); feet.push([a, c.Y(fx, fz)]); }
    const yl = s.y ?? Math.max(...feet.map((f) => f[1])) - 0.04, P = c.P.at(s.x, yl, s.z, rot);
    for (const [a, g] of feet) strut(P, [Math.sin(a) * 0.46, g - yl - 0.08, Math.cos(a) * 0.46], [Math.sin(a) * 0.22, 0.58, Math.cos(a) * 0.22], 0.14, K.stoneD, 0.02);
    // a six-sided firebox on a broad ring, papered between six posts, under the wide umbrella roof that catches the
    // snow (yukimi: snow-viewing); the roof's corners turn up, and a jewel sits on its crown
    P.cyl(0.32, 0.28, 0.08, 0, 0.6, 0, K.stone, MAT.plain, { n: 6 });
    P.cyl(0.19, 0.19, 0.23, 0, 0.75, 0, K.paper, MAT.lampWin, { n: 6 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; P.box(0.06, 0.23, 0.06, Math.sin(a) * 0.2, 0.75, Math.cos(a) * 0.2, K.stone, MAT.plain, { ry: a }); }
    P.cyl(0.26, 0.26, 0.05, 0, 0.885, 0, K.stone, MAT.plain, { n: 6 });
    P.add(kasaGeo({ n: 6, r: 0.74, th: 0.06, h: 0.24, lift: 0.1, crown: 0.09 }), 0, 0.91, 0, K.stoneD, MAT.plain, { uv: 'xz' });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; P.add(sphG(0.034, 7, 5), Math.sin(a) * 0.705, 1.065, Math.cos(a) * 0.705, K.stoneD, MAT.plain); }
    P.cyl(0.085, 0.06, 0.05, 0, 1.235, 0, K.stone, MAT.plain, { n: 12 }).add(sphG(0.07, 10, 8), 0, 1.31, 0, shade(K.stone, 1.08), MAT.plain).add(coneG(0.04, 0.08, 10), 0, 1.39, 0, shade(K.stone, 1.08), MAT.plain);
    c.lights.push({ x: s.x, y: yl + 0.75, z: s.z, i: 0.6 });
  } else stoneLantern(c, s, y);
}
function torii(s, c) {
  const y = c.Y(s.x, s.z), k = s.s || 1, P = c.P.at(s.x, y - 0.1, s.z, s.rot, k), cap = '#35303a';
  // pillars lean in at the top (the feet splay out to x = ±2.58, where the black base collars sit)
  for (const sx of [-1, 1]) P.cyl(0.25, 0.3, 5.3, sx * 2.5, 2.65, 0, K.red, 0, { n: 12, rz: sx * 0.035 }).cyl(0.4, 0.44, 0.5, sx * 2.58, 0.25, 0, K.black, 0, { n: 12 });
  P.box(6.6, 0.34, 0.34, 0, 4.05, 0, K.red).box(7.2, 0.4, 0.5, 0, 5.35, 0, K.red).box(4.2, 0.3, 0.72, 0, 5.7, 0, cap);
  for (const sx of [-1, 1]) P.box(2.3, 0.3, 0.72, sx * 3.1, 5.82, 0, cap, 0, { rz: sx * 0.11 });
  P.box(0.3, 1.0, 0.24, 0, 4.7, 0, K.red).box(0.9, 0.62, 0.1, 0, 4.72, 0.16, '#e9dcb4');
}
function gate(s, c) {
  const g = GATE[s.style], y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot), w = s.w, off = w / 2 + g.post[0] / 2, H = g.h;
  const masonry = s.style !== 'village' && s.style !== 'temple';
  // pillars stand on stones and masonry piers are founded below the lowest ground under them, so on a slope neither
  // hangs over the falling ground
  const soseki = (lx, lz, r) => { const b = Math.min(-0.2, lowUnder(c, s, lx, lz, r * 2, r * 2) - y - 0.25); P.cyl(r, r * 1.1, 0.14 - b, lx, (0.14 + b) / 2, lz, K.stoneD, MAT.plain, { n: 8 }); };
  for (const sx of [-1, 1]) {
    if (masonry) {
      const b = Math.min(-0.2, lowUnder(c, s, sx * off, 0, g.post[0], g.post[1]) - y - 0.3), t = H * 0.62 - 0.2;
      P.box(g.post[0], t - b, g.post[1], sx * off, (t + b) / 2, 0, K.stone, MAT.stone, { grad: [0.78, 1.02] });
    } else {
      P.cyl(g.post[0] * 0.3, g.post[0] * 0.34, H * 0.8, sx * off, H * 0.4, 0, s.style === 'temple' ? K.red : K.woodD, 0, { n: 10 });
      soseki(sx * off, 0, g.post[0] * 0.48);
    }
  }
  const top = masonry ? H * 0.62 - 0.2 : H * 0.72, span = w + g.post[0] * 2;
  if (s.style === 'village') {
    P.box(span + 1.2, 0.36, 0.4, 0, top, 0, K.woodD).box(span + 0.4, 0.26, 0.3, 0, top - 0.7, 0, K.woodD);
    addRoof(P, { w: span + 2, d: 2.6, h: 1.0, ridge: span + 2, lift: 0.14, segU: 4 }, 0, top + 0.2, 0, K.tile, { wall: K.woodD });
  } else if (s.style === 'temple') {
    P.box(span + 1.6, 0.5, 2.6, 0, top + 0.1, 0, K.redD).box(span + 0.6, 1.2, 2.0, 0, top + 0.9, 0, K.plaster, MAT.plaster);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { P.cyl(0.24, 0.28, top, sx * (off + 0.2), top / 2, sz * 1.2, K.red, 0, { n: 10 }); soseki(sx * (off + 0.2), sz * 1.2, 0.4); }
    addRoof(P, { w: span + 5.6, d: 6.6, h: 2.6, ridge: span * 0.7, lift: 0.8 }, 0, top + 1.5, 0, K.tile);
  } else {
    // the gatehouse over the passage: a timber-framed box on the great beam. A castle's is plastered over a boarded
    // skirt; a stronghold's is planked between its posts and rails. Barred windows look out both ways.
    const castle = s.style === 'castle', th = s.style === 'fort' ? 2.4 : 3.0, D = g.post[1] - 0.2, f = D / 2, y0 = top + 0.6;
    const frame = castle ? '#2a2522' : shade(K.woodD, 0.72), body = castle ? '#f0ebe0' : K.woodD;
    P.box(span + 0.8, 0.6, g.post[1] + 0.4, 0, top + 0.3, 0, K.woodD);
    P.box(span + 0.2, th, D, 0, y0 + th / 2, 0, body, castle ? MAT.plaster : MAT.plank, { uv: 'h', grad: [0.85, 1.04] });
    if (castle) P.box(span + 0.3, th * 0.36, D + 0.1, 0, y0 + th * 0.18, 0, '#3a302c', MAT.plank, { uv: 'yx' }).box(span + 0.4, 0.16, D + 0.2, 0, y0 + th * 0.36, 0, frame);
    const nw = Math.max(3, Math.round(span / 2.2));
    for (const sz of [-1, 1]) {
      for (let i = 0; i <= nw; i++) P.box(0.24, th, 0.12, -span / 2 + 0.1 + ((span - 0.2) * i) / nw, y0 + th / 2, sz * (f + 0.04), frame);
      if (!castle) P.box(span + 0.3, 0.18, 0.1, 0, y0 + th * 0.28, sz * (f + 0.06), frame);
      P.box(span + 0.36, 0.2, 0.12, 0, y0 + th - 0.12, sz * (f + 0.06), frame);
      for (let i = 0; i < nw; i++) barWindow(P, -span / 2 + (span * (i + 0.5)) / nw, y0 + th * 0.6, sz * (f + 0.02), 0.9, 0.62, sz > 0 ? 0 : Math.PI, frame, 5, K.paper);
    }
    for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) barWindow(P, sx * (span / 2 + 0.1), y0 + th * 0.6, (k - 0.5) * D * 0.5, 0.7, 0.62, sx * Math.PI / 2, frame, 4, K.paper);
    const rh = s.style === 'fort' ? 2.2 : 3.0;
    addRoof(P, { w: span + 3.4, d: g.post[1] + 3, h: rh, ridge: span * 0.72, lift: 0.4 }, 0, y0 + th, 0, K.tileD, castle ? { soffit: '#b3ac9e' } : {});
    if (s.style !== 'fort') for (const sx of [-1, 1]) {
      // shachi on the ridge ends, as on the keep
      const rx = sx * (span * 0.36 + 0.15), ry = y0 + th + rh + 0.65;
      P.add(sphG(0.3, 8, 6), rx, ry, 0, K.gold, MAT.metal, { sx: 0.75, sz: 0.62, rz: sx * 0.35 }).add(coneG(0.24, 0.9, 6), rx - sx * 0.16, ry + 0.55, 0, K.gold, MAT.metal, { rz: sx * 0.5 });
    }
  }
  // the two leaves are separate meshes so they can swing
  const leaf = new Parts(), lw = w / 2, lh = Math.min(top - 0.4, s.style === 'village' ? 3.0 : 4.2);
  const lc = s.style === 'temple' ? K.redD : s.style === 'village' ? K.wood : '#30262a';
  leaf.box(lw - 0.04, lh, 0.18, lw / 2, lh / 2, 0, lc, MAT.plank, { uv: 'h', grad: [0.8, 1.04] });
  leaf.box(lw - 0.04, 0.14, 0.22, lw / 2, lh * 0.25, 0, K.iron).box(lw - 0.04, 0.14, 0.22, lw / 2, lh * 0.75, 0, K.iron);
  if (masonry) for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) leaf.add(sphG(0.06, 5, 4), lw * (0.2 + i * 0.3), lh * (0.14 + j * 0.24), 0.11, K.gold, MAT.metal);
  c.gates.push({ id: s.id, x: s.x, y, z: s.z, rot: s.rot, w, parts: leaf.list, open: !!s.open, lw });
}
function wall(s, c) {
  const segs = wallSegments(s), h = s.h || 5, kind = s.kind;
  for (const g of segs) {
    const y = Math.min(c.Y(g.ax, g.az), c.Y(g.bx, g.bz), c.Y(g.x, g.z)) - 0.5;
    const top = Math.max(c.Y(g.ax, g.az), c.Y(g.bx, g.bz)) + h, P = c.P.at(g.x, 0, g.z, g.rot), L = g.len + (kind === 'ishigaki' ? 1.6 : 1.2);
    if (kind === 'ishigaki') {
      P.box(L, top - y, 1.7, 0, (top + y) / 2, 0, '#8d968f', MAT.stone, { grad: [0.72, 1.02] }).box(L + 0.1, 0.3, 1.9, 0, top + 0.1, 0, K.stoneD);
      continue;
    }
    const sh = (top - y) * (kind === 'fort' ? 0.5 : 0.42), uh = top - y - sh, uy = y + sh + uh / 2, castle = kind === 'castle';
    P.box(L, sh, 1.3, 0, y + sh / 2, 0, K.stone, MAT.stone, { grad: [0.74, 1.02] }).box(L + 0.06, 0.18, 1.42, 0, y + sh - 0.05, 0, K.stoneD, MAT.stone);
    P.box(L - 0.2, uh, 0.9, 0, uy, 0, castle ? '#efeadf' : '#4a3a33', castle ? MAT.plaster : MAT.plank, { uv: 'h', grad: [0.86, 1.03] });
    if (!castle) {
      // a stronghold's plank wall hangs on posts and rails, proud of the boards on both faces
      const fr = '#2f2420', np = Math.max(1, Math.round(g.len / 2.4));
      for (const sz of [-1, 1]) {
        for (let i = 0; i <= np; i++) P.box(0.22, uh, 0.1, -g.len / 2 + (g.len * i) / np, uy, sz * 0.49, fr);
        P.box(L - 0.1, 0.16, 0.08, 0, y + sh + uh * 0.3, sz * 0.5, fr);
      }
    }
    // loopholes (sama) for bow and gun: a castle alternates triangles and squares, a stronghold cuts plain squares
    const nl = Math.floor(g.len / (castle ? 1.8 : 3.2));
    for (let i = 0; i < nl; i++) {
      const lx = -g.len / 2 + (g.len * (i + 0.5)) / nl;
      if (castle && i % 2 === 0) P.add(cylG(0.24, 0.24, 0.95, 3), lx, top - 1.0, 0, K.black, 0, { rx: -Math.PI / 2 });
      else P.box(castle ? 0.32 : 0.3, castle ? 0.32 : 0.55, 0.95, lx, top - (castle ? 1.05 : 1.1), 0, K.black);
    }
    addRoof(P, { w: L + 0.5, d: 2.0, h: 0.7, ridge: L + 0.5, lift: 0.04, segU: 2, segV: 2, th: 0.16 }, 0, top, 0, K.tileD, { wall: K.woodD, ridgeCap: false, soffit: castle ? '#ddd8cc' : undefined });
    P.box(L + 0.5, 0.2, 0.3, 0, top + 0.7 + 0.16 + 0.06, 0, '#2c383e');
  }
}
function tower(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot || 0);
  if (s.kind === 'watch') {
    // four legs splayed wider at the foot than at the platform (k: lean per metre; a positive rz tips a post's top
    // toward -x, a positive rx toward +z), tied on every face by girts and X-braces nailed to the outside of the legs
    const k = 0.04, rAt = (h) => 1.2 - (h - 3.5) * k;
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.box(0.24, 7, 0.24, x * 1.2, 3.5, z * 1.2, K.woodD, 0, { rz: x * k, rx: -z * k });
    for (const side of [-1, 1]) for (const alongX of [true, false]) {
      // a point on this face at height h, u = -1..1 from one leg's centre line to the other's
      const p = (u, h) => { const r = rAt(h), o = side * (r + 0.12); return alongX ? [u * r, h, o] : [o, h, u * r]; };
      for (const h of [3.2, 6.25]) strut(P, p(-1, h), p(1, h), 0.14, K.woodD, 0.12);
      for (const [h0, h1] of [[0.35, 3.2], [3.2, 6.25]]) { strut(P, p(-1, h0), p(1, h1), 0.1, K.woodD, 0.05); strut(P, p(1, h0), p(-1, h1), 0.1, K.woodD, 0.05); }
    }
    // platform and parapet; the +x parapet leaves a gap where the ladder comes up
    P.box(3.4, 0.2, 3.4, 0, 6.6, 0, K.wood, MAT.plank, { uv: 'xz' }).box(3.3, 0.9, 0.1, 0, 7.15, 1.6, K.woodD, MAT.plank, { uv: 'h' }).box(3.3, 0.9, 0.1, 0, 7.15, -1.6, K.woodD, MAT.plank, { uv: 'h' }).box(0.1, 0.9, 3.3, -1.6, 7.15, 0, K.woodD, MAT.plank, { uv: 'h' });
    P.box(0.1, 0.9, 1.8, 1.6, 7.15, -0.75, K.woodD, MAT.plank, { uv: 'h' }).box(0.1, 0.9, 0.7, 1.6, 7.15, 1.3, K.woodD, MAT.plank, { uv: 'h' });
    for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) P.box(0.16, 2.2, 0.16, x, 7.8, z, K.woodD);
    addRoof(P, { w: 5, d: 5, h: 1.5, ridge: 0, lift: 0.4 }, 0, 8.9, 0, K.tileD, { ridgeCap: false });
    // the ladder: its feet on the ground, its stiles resting on the platform's edge and running on up through the gap
    const lz = 0.55, lean = 0.19, lx = (h) => 1.73 + (6.6 - h) * lean;
    for (const sz of [-1, 1]) strut(P, [lx(0), 0, lz + sz * 0.22], [lx(7.55), 7.55, lz + sz * 0.22], 0.07, K.wood);
    for (let h = 0.32; h < 7.3; h += 0.32) P.box(0.05, 0.05, 0.5, lx(h), h, lz, K.wood);
    paperLantern(c, s.x, y + 8.2, s.z, 1.0, GLOW_RED, 0.43);
    return;
  }
  // a corner turret (yagura) on a battered stone base: 6.6 square at the foot, 5.9 at the top, with long-and-short
  // corner stones. Plastered walls over a boarded skirt, posts at the corners, barred windows, plastered eaves.
  const bh = 6.2, body = s.tall ? 4.2 : 3.4, plaster = '#efeadf', beam = '#2a2522', eaves = '#b3ac9e', skirt = '#3a302c';
  const lo = lowUnder(c, s, 0, 0, 6.6, 6.6), foot = Math.min(-1, lo - y - 0.3);
  P.add(batterGeo(5.9, 5.9, 0.35, 0.35, bh - foot, 7), 0, foot, 0, K.stone, MAT.stone, { grad: [0.72, 1.02] });
  cornerStones(P, 5.9, 5.9, 0.35, 0.35, bh - foot, foot, shade(K.stone, 1.12), 0.62);
  P.box(6.1, 0.24, 6.1, 0, bh - 0.02, 0, K.stoneD, MAT.stone);
  const storey = (w, y0, h, nwin, sides) => {
    P.box(w, h, w, 0, y0 + h / 2, 0, plaster, MAT.plaster, { grad: [0.86, 1.03] });
    P.box(w + 0.1, h * 0.34, w + 0.1, 0, y0 + h * 0.17, 0, skirt, MAT.plank, { uv: 'yx', grad: [0.85, 1.05] }).box(w + 0.2, 0.16, w + 0.2, 0, y0 + h * 0.34, 0, beam);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(0.24, h, 0.24, sx * (w / 2 + 0.04), y0 + h / 2, sz * (w / 2 + 0.04), beam);
    const wy = y0 + h * 0.62, f = w / 2 + 0.02;
    for (let k = 0; k < nwin; k++) {
      const o = nwin === 1 ? 0 : (k - (nwin - 1) / 2) * (w * 0.46);
      for (const sz of [-1, 1]) barWindow(P, o, wy, sz * f, 0.95, 0.75, sz > 0 ? 0 : Math.PI, beam, 5, K.paper);
      if (sides) for (const sx of [-1, 1]) barWindow(P, sx * f, wy, o, 0.95, 0.75, sx * Math.PI / 2, beam, 5, K.paper);
    }
  };
  storey(5.6, bh, body, 2, true);
  let ry = bh + body;
  if (s.tall) {
    addRoof(P, { w: 8, d: 8, h: 1.3, ridge: 5, lift: 0.38, curve: 1.3 }, 0, ry, 0, K.tileD, { ridgeCap: false, soffit: eaves });
    storey(4, ry + 0.6, 2.6, 1, false);
    ry += 3.2;
    addRoof(P, { w: 6.4, d: 6.4, h: 2.4, ridge: 2.2, lift: 0.42 }, 0, ry, 0, K.tileD, { soffit: eaves });
  } else addRoof(P, { w: 8, d: 8, h: 2.5, ridge: 2.8, lift: 0.42 }, 0, ry, 0, K.tileD, { soffit: eaves });
  c.lights.push({ x: s.x, y: y + bh + 2, z: s.z, i: 0.5 });
}
function keep(s, c) {
  // a tenshu raised the way the black castles were: five storeys on a battered stone base, each storey clad in black
  // lapped boards (shitami-bari) to the line of its windows with white plaster above, a beam between the two, and a
  // heavy tiled roof whose plastered eaves throw the storey above into relief. The lower roofs carry triangular gables
  // (chidori-hafu) with gilt pendants; golden shachi stand at the ends of the top ridge.
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot || 0, s.s || 1);
  const boards = '#2b2d36', plaster = '#ece6d8', beam = '#1c1d24', eaves = '#aaa395', trim = K.gold;
  // the base: 11 m of fitted stone, flaring from 23.8 × 20.2 at the top to the 32 × 27 of its footing
  const BW = 23.8, BD = 20.2, BX = 4.1, BZ = 3.4, BH = 11;
  P.add(batterGeo(BW, BD, BX, BZ, BH, 10), 0, -1, 0, '#8a938d', MAT.stone, { grad: [0.72, 1.02] });
  cornerStones(P, BW, BD, BX, BZ, BH, -1, '#a3aba4', 0.73);
  P.box(BW + 0.3, 0.3, BD + 0.3, 0, 10.0, 0, '#7d8680', MAT.stone);
  let yy = 10.15;
  const tiers = [[25, 20, 4.6], [20, 16, 4.0], [15.5, 12.5, 3.8], [11.5, 9.5, 3.6], [8, 7, 3.8]];
  tiers.forEach(([w, d, h], i) => {
    const last = i === tiers.length - 1, drop = i === 0 ? 0 : 1.3, hb = h * 0.6;
    // plaster core (run down into the roof below), boards over its lower part, the beam where they meet
    P.box(w, h + drop, d, 0, yy + (h - drop) / 2, 0, plaster, MAT.plaster, { grad: [0.9, 1.04] });
    P.box(w + 0.12, hb + drop, d + 0.12, 0, yy + (hb - drop) / 2, 0, boards, MAT.plank, { uv: 'yx', grad: [0.82, 1.06] });
    P.box(w + 0.26, 0.2, d + 0.26, 0, yy + hb, 0, beam);
    // corner posts proud of the boards, and a post between every pair of windows on the plaster
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(0.28, h, 0.28, sx * (w / 2 + 0.06), yy + h / 2, sz * (d / 2 + 0.06), beam);
    // barred windows in the boarded band, their heads just under the beam
    const wy = yy + hb - 0.78, nw = Math.max(2, Math.round(w / 3.4)), nd = Math.max(2, Math.round(d / 3.6)), ww = last ? 1.3 : 1.1;
    for (let k = 0; k < nw; k++) for (const sz of [-1, 1]) barWindow(P, -w / 2 + (w * (k + 0.5)) / nw, wy, sz * (d / 2 + 0.06), ww, 1.0, sz > 0 ? 0 : Math.PI, beam, 5, '#ffb38a');
    for (let k = 0; k < nd; k++) for (const sx of [-1, 1]) barWindow(P, sx * (w / 2 + 0.06), wy, -d / 2 + (d * (k + 0.5)) / nd, ww, 1.0, sx * Math.PI / 2, beam, 5, '#ffb38a');
    // the plastered band above the beam is broken by its posts, one over each window pier
    for (let k = 1; k < nw; k++) for (const sz of [-1, 1]) P.box(0.2, h - hb - 0.1, 0.1, -w / 2 + (w * k) / nw, yy + (hb + h) / 2, sz * (d / 2 + 0.04), beam);
    for (let k = 1; k < nd; k++) for (const sx of [-1, 1]) P.box(0.1, h - hb - 0.1, 0.2, sx * (w / 2 + 0.04), yy + (hb + h) / 2, -d / 2 + (d * k) / nd, beam);
    yy += h;
    // the roof: deep eaves, plastered white beneath, corners lifting only gently
    const rh = last ? 4.0 : 2.1, ov = last ? 2.3 : 2.2;
    addRoof(P, { w: w + ov * 2, d: d + ov * 2, h: rh, ridge: last ? w * 0.7 : w * 0.74, lift: last ? 0.75 : 0.55, curve: last ? 1.6 : 1.25, segU: 12, segV: 6 }, 0, yy, 0, K.tileD, { wall: plaster, soffit: eaves, ridgeCap: last });
    if (i < 3) {
      // triangular gables on the slope: front and back on the lower roofs, on the ends of the third
      const along = i === 2 ? 'x' : 'z', half = along === 'z' ? d / 2 : w / 2, gw = (along === 'z' ? w : d) * (i === 2 ? 0.42 : 0.34);
      for (const sg of [-1, 1]) chidori(P, along, sg, half + ov - 0.45, yy + 0.32, gw, i === 0 ? 2.6 : 2.2, plaster, eaves, trim);
      if (i === 0) for (const sg of [-1, 1]) chidori(P, 'x', sg, w / 2 + ov - 0.45, yy + 0.32, d * 0.3, 2.2, plaster, eaves, trim);
    }
    if (last) {
      // shachi: a gilt carp on each end of the ridge, head down on the tiles and tail flung up
      for (const sx of [-1, 1]) {
        const rx = sx * (w * 0.35 + 0.15), ry = yy + rh + 0.55;
        P.add(sphG(0.42, 8, 6), rx, ry + 0.1, 0, trim, MAT.metal, { sx: 0.75, sy: 1.0, sz: 0.62, rz: sx * 0.35 });
        P.add(coneG(0.34, 1.25, 6), rx - sx * 0.22, ry + 0.85, 0, trim, MAT.metal, { rz: sx * 0.5 });
        P.add(coneG(0.26, 0.7, 4), rx - sx * 0.62, ry + 1.42, 0, trim, MAT.metal, { rz: sx * 1.5, sz: 0.35 });
      }
    }
    yy += last ? 0 : 1.0;
  });
  const [lx, lz] = local(s, 0, 13 * (s.s || 1)); // before the keep's front, wherever it faces
  c.lights.push({ x: lx, y: y + 13, z: lz, i: 1.6, far: true });
}
/** A chidori-hafu: a small gabled roof sitting on a big roof's slope, its triangular face looking out over the eaves
    from `out` metres off the centre along `along` ('x' or 'z') on side sg. The face is set back under a verge, framed by
    the roof's thick bargeboards, with a gilt pendant (gegyo) hanging under its apex. */
function chidori(P, along, sg, out, y, gw, gh, face, soffit, trim) {
  const depth = 5.2, cx = along === 'x' ? sg * (out - depth / 2) : 0, cz = along === 'z' ? sg * (out - depth / 2) : 0;
  // roofGeo's gable ends lie on its local ±x: turn local x onto the outward axis
  const ry = along === 'x' ? 0 : Math.PI / 2;
  addRoof(P, { w: depth, d: gw, h: gh, ridge: depth, lift: 0.08, curve: 1.15, segU: 4, segV: 4, gin: 0.5 }, cx, y, cz, K.tileD, { wall: face, soffit, ry });
  // the pendant under the apex, on the face (0.5 in from the verge)
  const fo = out - 0.5 + 0.06, px = along === 'x' ? sg * fo : 0, pz = along === 'z' ? sg * fo : 0, o = along === 'x' ? { ry: Math.PI / 2 } : {};
  P.box(0.5, 0.5, 0.08, px, y + gh - 0.15, pz, trim, MAT.metal, o).box(0.18, 0.32, 0.1, px, y + gh - 0.5, pz, trim, MAT.metal, o);
}

/* ---------- props ---------- */
function stall(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  // posts run up into the sloped awning (its underside is at 2.18 over the front posts, 2.63 over the back ones)
  for (const [x, z] of [[-1.5, -0.85], [1.5, -0.85], [-1.5, 0.85], [1.5, 0.85]]) P.box(0.12, z > 0 ? 2.2 : 2.65, 0.12, x, z > 0 ? 1.1 : 1.325, z, K.woodD);
  P.box(3.2, 0.12, 1.4, 0, 0.95, 0.3, K.wood, MAT.plank, { uv: 'zx' }).box(3.2, 0.9, 0.08, 0, 0.45, 0.95, K.wood, MAT.plank, { uv: 'h' });
  P.box(3.7, 0.07, 2.6, 0, 2.4, 0.15, s.color, MAT.plain, { rx: 0.26 }).box(3.7, 0.3, 0.05, 0, 2.02, 1.4, shade(s.color, 0.8));
  const goods = ['#d9702c', '#c9b23c', '#7fa23c', '#b3392e', '#e6dcc0'];
  for (let i = 0; i < 6; i++) P.add(sphG(0.14, 6, 5), -1.2 + (i % 3) * 0.5 + hash(s.x, s.z, i) * 0.2, 1.12, 0.1 + Math.floor(i / 3) * 0.45, goods[Math.floor(hash(s.x, s.z, i + 7) * goods.length)]);
  P.box(0.7, 0.3, 0.5, 1.1, 1.16, 0.3, K.straw);
}
function well(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, 0.4);
  // the dark water sits 3 cm above the drum's closed top (0.9), inside its stone rim; below it, it never showed
  P.cyl(1.0, 1.05, 0.9, 0, 0.45, 0, K.stone, MAT.stone, { n: 10 }).cyl(0.78, 0.78, 0.04, 0, 0.91, 0, '#1b2a33', 0, { n: 10 });
  post(P, -1.0, 0, 2.5); post(P, 1.0, 0, 2.5);
  P.box(2.5, 0.14, 0.14, 0, 2.5, 0, K.woodD).cyl(0.12, 0.12, 0.5, 0, 2.3, 0, K.wood, 0, { rz: Math.PI / 2 }).cyl(0.02, 0.02, 1.2, 0, 1.7, 0, K.rope).cyl(0.16, 0.13, 0.26, 0, 1.05, 0, K.wood);
  addRoof(P, { w: 3, d: 2, h: 0.7, ridge: 3, lift: 0.06, segU: 2, segV: 2 }, 0, 2.6, 0, K.thatch, { mat: MAT.thatch, wall: K.woodD, ridgeCap: false });
}
function crates(s, c) {
  const y = c.Y(s.x, s.z), n = s.n || 3, P = c.P.at(s.x, y, s.z, hash(s.x, s.z) * 3);
  for (let i = 0; i < n; i++) {
    const k = 0.6 + hash(s.x, s.z, i) * 0.35, a = (i / n) * 6.283, d = i === 0 ? 0 : 0.75;
    const up = i >= 3 ? 0.7 : 0;
    P.box(k, k, k, Math.cos(a) * d * (up ? 0.3 : 1), k / 2 + up, Math.sin(a) * d * (up ? 0.3 : 1), shade(K.woodL, 0.85 + hash(s.x, s.z, i + 3) * 0.3), MAT.plank, { uv: 'h', ry: hash(s.x, s.z, i + 5) });
  }
}
function barrels(s, c) {
  const y = c.Y(s.x, s.z), n = s.n || 2, P = c.P.at(s.x, y, s.z);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + 0.5, d = n === 1 ? 0 : 0.55;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    P.cyl(0.36, 0.33, 0.95, x, 0.475, z, K.woodL, MAT.plank, { n: 10, uv: 'h' }).cyl(0.375, 0.375, 0.07, x, 0.25, z, K.iron, 0, { n: 10 }).cyl(0.375, 0.375, 0.07, x, 0.72, z, K.iron, 0, { n: 10 });
  }
}
function baskets(s, c) {
  const y = c.Y(s.x, s.z), n = s.n || 3, P = c.P.at(s.x, y, s.z);
  const fill = ['#d9702c', '#7fa23c', '#c9b23c', '#b3392e'];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283, x = Math.cos(a) * 0.5, z = Math.sin(a) * 0.5;
    P.cyl(0.3, 0.22, 0.36, x, 0.18, z, K.straw, 0, { n: 8 }).add(sphG(0.27, 7, 4), x, 0.32, z, fill[i % 4], 0, { sy: 0.45 });
  }
}
function cart(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.box(1.5, 0.12, 2.4, 0, 0.75, 0, K.wood, MAT.plank, { uv: 'zx' }).box(1.5, 0.4, 0.08, 0, 0.98, 1.2, K.wood).box(0.08, 0.4, 2.4, 0.75, 0.98, 0, K.wood).box(0.08, 0.4, 2.4, -0.75, 0.98, 0, K.wood);
  for (const sx of [-1, 1]) P.add(torusG(0.62, 0.07, 5, 14), sx * 0.9, 0.66, -0.2, K.woodD, 0, { ry: Math.PI / 2 }).box(0.06, 1.2, 0.08, sx * 0.9, 0.66, -0.2, K.woodD).box(0.06, 0.08, 1.2, sx * 0.9, 0.66, -0.2, K.woodD).box(0.08, 0.08, 1.9, sx * 0.6, 0.62, 2.0, K.woodD, 0, { rx: 0.18 });
  // the axle the wheels turn on, carried under the bed
  P.cyl(0.05, 0.05, 1.96, 0, 0.66, -0.2, K.woodD, 0, { n: 6, rz: Math.PI / 2 }).box(1.5, 0.08, 0.14, 0, 0.67, -0.2, K.woodD);
  P.add(sphG(0.6, 7, 5), 0, 1.0, -0.2, K.straw, 0, { sy: 0.55, sz: 1.5 });
}
function woodpile(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6 - r; i++) P.cyl(0.16, 0.16, 1.0, -1.0 + i * 0.36 + r * 0.18, 0.16 + r * 0.29, 0, shade(K.woodL, 0.8 + hash(i, r) * 0.4), 0, { n: 6, rx: Math.PI / 2 });
}
function haystack(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z);
  P.add(coneG(1.3, 2.2, 9), 0, 1.1, 0, K.straw, MAT.thatch, { uv: 'xy' }).cyl(1.25, 1.3, 0.5, 0, 0.25, 0, shade(K.straw, 0.85), MAT.thatch, { n: 9 }).box(0.1, 0.5, 0.1, 0, 2.4, 0, K.woodD);
}
function scarecrow(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.box(0.1, 2.0, 0.1, 0, 1.0, 0, K.woodD).box(1.7, 0.08, 0.08, 0, 1.5, 0, K.woodD).box(0.7, 0.8, 0.14, 0, 1.25, 0, '#5a6f8a').add(sphG(0.2, 7, 6), 0, 1.92, 0, K.cloth).add(coneG(0.42, 0.2, 9), 0, 2.12, 0, K.straw);
}
function signpost(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.box(0.14, 1.9, 0.14, 0, 0.95, 0, K.woodD).box(1.2, 0.42, 0.07, 0.35, 1.6, 0.06, K.woodL, MAT.plank, { uv: 'yx' }).box(0.7, 0.1, 0.01, 0.35, 1.6, 0.1, K.black);
}
function rack(s, c) {
  // a spear stand: the butts stand in a footboard out front (+z) and the shafts lean back against the top rail
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  post(P, -1.2, 0, 1.7); post(P, 1.2, 0, 1.7);
  P.box(2.6, 0.1, 0.1, 0, 1.55, 0, K.woodD).box(2.6, 0.1, 0.1, 0, 0.5, 0, K.woodD);
  for (const sx of [-1, 1]) P.box(0.12, 0.1, 0.62, sx * 1.2, 0.05, 0.22, K.woodD); // feet under the posts
  P.box(2.52, 0.1, 0.16, 0, 0.05, 0.36, K.woodD); // footboard across the feet
  // every part of a spear sits on the one line from its butt, tipped back so the shaft just touches the rail's
  // front face (z 0.05) at the rail's height; a positive rx would tip it forward, so the lean is negative
  const L = 2.4, r = 0.025, by = 0.1, bz = 0.36, lean = Math.atan2(bz - (0.05 + r), 1.55 - by);
  const on = (d) => [by + Math.cos(lean) * d, bz - Math.sin(lean) * d], o = { rx: -lean };
  for (let i = 0; i < 5; i++) {
    const x = -0.9 + i * 0.45;
    let [py, pz] = on(L / 2);
    P.cyl(r, r, L, x, py, pz, K.woodL, 0, o);
    [py, pz] = on(L + 0.02);
    P.cyl(0.034, 0.034, 0.08, x, py, pz, K.iron, MAT.metal, { ...o, n: 6 }); // the blade's socket
    [py, pz] = on(L + 0.21);
    P.add(coneG(0.05, 0.3, 4), x, py, pz, '#c9d2d6', MAT.metal, o);
  }
}
function barricade(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.cyl(0.12, 0.12, 3.2, 0, 0.75, 0, K.woodD, 0, { n: 6, rz: Math.PI / 2 });
  for (let i = 0; i < 6; i++) for (const sg of [-1, 1]) P.add(coneG(0.09, 1.9, 5), -1.25 + i * 0.5, 0.75, sg * 0.2, K.woodL, 0, { rx: sg * 0.75 });
}
/** an indexed grid surface over f(a, b) -> [x, y, z], a and b running 0..1; `flip` reverses which side faces out */
function sheetGeo(f, na, nb, flip) {
  const pos = [], idx = [];
  for (let j = 0; j <= nb; j++) for (let i = 0; i <= na; i++) pos.push(...f(i / na, j / nb));
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) {
    const a = j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1;
    if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/* The camp tent: canvas thrown over a ridge pole between two uprights and pegged out along both hems. It hangs like
   cloth, not a prism: the ridge dips between the poles, each slope bellies in, the hem lifts between its pegs.
   Sewn in panels of slightly different tone with a dark hem band; the +x end is the doorway, its flaps rolled back. */
const TENT = { L: 4.4, D: 2.0, H: 2.45, sag: 0.1, lift: 0.1, belly: 0.08, pegs: 5, band: 0.935, open: 0.3, panels: 5 };
// a point on the canvas: side ±1 (which slope), u 0..1 along the ridge (-x to +x), t 0..1 from the ridge down to the hem
function tentPt(side, u, t) {
  const T = TENT, ridge = T.H - T.sag * Math.sin(Math.PI * u), hem = 0.04 + T.lift * Math.abs(Math.sin(Math.PI * u * (T.pegs - 1)));
  const b = T.belly * Math.sin(Math.PI * t) * (0.55 + 0.45 * Math.sin(Math.PI * u));
  return [(u - 0.5) * T.L, ridge + (hem - ridge) * t - b, side * (T.D * t - b * 0.6)];
}
let _tent = null;
function tentPieces() {
  if (_tent) return _tent;
  const T = TENT, out = [];
  // every sheet is drawn twice: canvas outside, the dim inside of the tent within
  const sheet = (f, na, nb, flipOut, kind, tone = 1) => out.push({ g: sheetGeo(f, na, nb, flipOut), kind, tone }, { g: sheetGeo(f, na, nb, !flipOut), kind: 'inner' });
  for (const side of [-1, 1]) for (let p = 0; p < T.panels; p++) {
    const u0 = p / T.panels, u1 = (p + 1) / T.panels, f = (t0, t1) => (a, b) => tentPt(side, u0 + (u1 - u0) * a, t0 + (t1 - t0) * b);
    sheet(f(0, T.band), 5, 7, side < 0, 'canvas', p % 2 ? 0.94 : 1);
    sheet(f(T.band, 1), 5, 1, side < 0, 'band');
  }
  // the ends: the back closed, the front only the two strips either side of the doorway
  const end = (u, w0, w1, t0, t1) => (a, b) => { const t = t0 + (t1 - t0) * b, q = tentPt(1, u, t); return [q[0], q[1], q[2] * (2 * (w0 + (w1 - w0) * a) - 1)]; };
  for (const [u, spans] of [[0, [[0, 1]]], [1, [[0, T.open], [1 - T.open, 1]]]]) for (const [w0, w1] of spans) {
    sheet(end(u, w0, w1, 0, T.band), 3, 7, u === 1, 'canvas', 0.9);
    sheet(end(u, w0, w1, T.band, 1), 3, 1, u === 1, 'band');
  }
  return (_tent = out);
}
function tent(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot), col = hash(s.x, s.z) > 0.5 ? '#c9bea2' : '#b7ad92', T = TENT;
  for (const q of tentPieces()) {
    const color = q.kind === 'inner' ? shade(col, 0.42) : q.kind === 'band' ? '#2c3145' : shade(col, q.tone);
    P.add(q.g, 0, 0, 0, color, MAT.plain, q.kind === 'canvas' ? { grad: [0.8, 1.03] } : undefined);
  }
  // a seam tape down the ridge, a ground sheet inside
  for (let i = 0; i < 8; i++) strut(P, tentPt(1, i / 8, 0).map((v, k) => v + (k === 1 ? 0.025 : 0)), tentPt(1, (i + 1) / 8, 0).map((v, k) => v + (k === 1 ? 0.025 : 0)), 0.07, shade(col, 0.78), 0.01);
  P.box(T.L - 0.3, 0.03, T.D * 2 - 0.6, 0, 0.015, 0, shade(col, 0.3));
  // the doorway's two flaps, rolled up and tied back against the front strips
  const front = (w, t) => { const q = tentPt(1, 1, t); return [q[0] + 0.07, q[1], q[2] * (2 * w - 1)]; };
  for (const w of [T.open, 1 - T.open]) limb(P, front(w, 0.06), front(w, 0.97), 0.055, 0.085, shade(col, 0.86));
  // uprights at both ends, standing through the canvas at the ridge
  for (const [x, h] of [[T.L / 2 + 0.02, T.H + 0.22], [-T.L / 2 - 0.06, T.H + 0.18]]) P.cyl(0.045, 0.05, h, x, h / 2, 0, K.woodD, 0, { n: 6 }).add(sphG(0.06, 6, 4), x, h + 0.02, 0, K.woodD);
  // guy ropes from each upright and from every hem loop, out to pegs in the ground
  const peg = (x, z) => P.box(0.05, 0.3, 0.05, x, 0.08, z, K.woodD);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = sx * (T.L / 2 + 1.45), pz = sz * 0.8;
    strut(P, [sx * (T.L / 2 + 0.04), T.H + 0.12, 0], [px, 0.2, pz], 0.022, K.rope);
    peg(px, pz);
  }
  for (const side of [-1, 1]) for (let k = 0; k < T.pegs; k++) {
    const h = tentPt(side, k / (T.pegs - 1), 1), pz = side * (T.D + 0.32);
    strut(P, [h[0], h[1] + 0.02, h[2]], [h[0], 0.2, pz], 0.018, K.rope);
    peg(h[0], pz);
  }
}
function fire(c, x, y, z, size, light = 1.2) {
  // one tall flame with smaller tongues around it, spread in both x and z so the cluster reads from any side
  c.sprites.push({ x, y, z, size, kind: 'flame' },
    { x: x + size * 0.13, y: y - size * 0.03, z: z + size * 0.05, size: size * 0.7, kind: 'flame' },
    { x: x - size * 0.12, y: y - size * 0.03, z: z - size * 0.07, size: size * 0.62, kind: 'flame' },
    { x: x + size * 0.02, y: y - size * 0.02, z: z - size * 0.13, size: size * 0.55, kind: 'flame' },
    { x, y: y + size * 0.4, z, size: 0.16, kind: 'ember' }, { x, y: y + size * 0.2, z, size: 0.12, kind: 'ember' });
  c.lights.push({ x, y: y + size * 0.6, z, i: light, fire: true });
}
function brazier(s, c) {
  const y = c.Y(s.x, s.z), k = s.big ? 1.4 : 1, P = c.P.at(s.x, y, s.z, 0, k);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.283; P.box(0.08, 1.2, 0.08, Math.sin(a) * 0.3, 0.55, Math.cos(a) * 0.3, K.iron, 0, { rz: Math.sin(a) * 0.3, rx: -Math.cos(a) * 0.3 }); }
  P.cyl(0.5, 0.3, 0.36, 0, 1.2, 0, K.iron, MAT.metal, { n: 8 });
  c.glow.at(s.x, y, s.z, 0, k).cyl(0.42, 0.3, 0.1, 0, 1.36, 0, '#ff8a3a', 0, { n: 8 });
  fire(c, s.x, y + 1.3 * k, s.z, 1.3 * k, s.big ? 1.8 : 1.3);
}
function torch(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z);
  P.box(0.1, 2.2, 0.1, 0, 1.1, 0, K.woodD).cyl(0.14, 0.08, 0.3, 0, 2.3, 0, K.iron, MAT.metal, { n: 6 });
  fire(c, s.x, y + 2.35, s.z, 0.8, 1.0);
}
const MON = { fang: 1, oni: 2, lotus: 3 };
function banner(s, c) {
  const y = c.Y(s.x, s.z), h = s.h || 6, P = c.P.at(s.x, y, s.z);
  P.cyl(0.05, 0.07, h + 0.5, 0, (h + 0.5) / 2, 0, K.woodD, 0, { n: 6 }).cyl(0.03, 0.03, 1.3, 0.6, h + 0.3, 0, K.woodD, 0, { rz: Math.PI / 2, n: 5 });
  const a = hash(s.x, s.z) * 0.8 - 0.4;
  clothQuad(c.cloth, s.x + 0.06, y + h + 0.25, s.z, Math.cos(a), Math.sin(a), 1.15, h * 0.72, s.color, { emblem: MON[s.mon] || 0, fixed: 'side', seg: 7, phase: hash(s.x, s.z, 3) });
}
function drum(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, 0.8);
  P.box(1.6, 0.2, 1.2, 0, 0.1, 0, K.woodD).box(0.16, 1.2, 0.16, -0.6, 0.7, 0, K.woodD).box(0.16, 1.2, 0.16, 0.6, 0.7, 0, K.woodD);
  P.cyl(0.8, 0.8, 1.1, 0, 1.6, 0, '#7a2a22', 0, { n: 14, rx: Math.PI / 2 }).cyl(0.74, 0.74, 1.14, 0, 1.6, 0, K.paper, 0, { n: 14, rx: Math.PI / 2 });
}
function curtain(s, c) {
  const y = c.Y(s.x, s.z), w = s.w, P = c.P.at(s.x, y, s.z, s.rot), n = Math.round(w / 4);
  for (let i = 0; i <= n; i++) P.box(0.1, 2.6, 0.1, -w / 2 + (w * i) / n, 1.3, 0, K.woodD);
  const cr = Math.cos(s.rot), sr = Math.sin(s.rot), [ox, oz] = local(s, -w / 2, 0.06);
  for (let i = 0; i < n; i++) clothQuad(c.cloth, ox + cr * (w / n) * i, y + 2.5, oz - sr * (w / n) * i, cr, -sr, w / n - 0.06, 2.1, i % 2 ? '#efe6d2' : '#1b1b22', { fixed: 'top', seg: 4, emblem: i % 2 ? 1 : 0, phase: i * 0.37 });
}
function censer(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z);
  P.cyl(0.9, 1.0, 0.4, 0, 0.2, 0, K.stone, MAT.stone, { n: 8 });
  for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.283; P.box(0.14, 0.5, 0.14, Math.sin(a) * 0.5, 0.6, Math.cos(a) * 0.5, K.bronze, MAT.metal); }
  // bowl, ash bed and rim each have their own top: the bowl stops at 1.42, the ash rises 2 cm above it, and a lip ring
  // stands 8 cm proud of the ash so the bed reads as sunk inside. (The ash used to share the bowl's top face, and
  // the two faces fought over the same pixels and flickered.)
  P.cyl(0.771, 0.55, 0.62, 0, 1.11, 0, K.bronze, MAT.metal, { n: 10 }).cyl(0.7, 0.7, 0.04, 0, 1.42, 0, '#c9c2b0', 0, { n: 10 });
  P.add(torusG(0.76, 0.05, 5, 20), 0, 1.47, 0, K.bronze, MAT.metal, { rx: Math.PI / 2 });
  c.sprites.push({ x: s.x, y: y + 1.6, z: s.z, size: 0.9, kind: 'smoke' }, { x: s.x + 0.2, y: y + 1.6, z: s.z, size: 0.7, kind: 'smoke' });
}
function fallen(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot), n = s.low ? 2 : 3;
  for (let i = 0; i < n; i++) P.cyl(0.07, 0.09, s.len * (0.8 + hash(s.x, s.z, i) * 0.3), (i - 1) * 0.22, 0.2 + i * 0.16, (hash(s.x, s.z, i + 4) - 0.5) * 0.8, shade('#8fb04a', 0.75 + hash(s.x, s.z, i + 2) * 0.35), 0, { n: 6, rx: Math.PI / 2 + (hash(s.x, s.z, i + 6) - 0.5) * 0.12, ry: (hash(s.x, s.z, i + 8) - 0.5) * 0.3 });
}
function checkpoint(s, c) {
  // a wayside spirit lamp where the journey is remembered: a carved six-sided stone lantern (kasuga-dōrō).
  // Every stone is seated on the one below and overlaps it by a few millimetres, so nothing hangs in the air.
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot), st = K.stone, sd = K.stoneD, HEX = { n: 6 };
  // the footing is set into the ground, deeper on the downhill side of a slope so no edge ever lifts clear
  let sink = 0.12;
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; sink = Math.max(sink, y - c.Y(s.x + Math.sin(a) * 0.5, s.z + Math.cos(a) * 0.5) + 0.12); }
  // base (kiso): footing, a lotus skirt with carved petals, a seat ring for the shaft
  P.cyl(0.46, 0.5, 0.12 + sink, 0, (0.12 - sink) / 2, 0, sd, MAT.plain, { n: 6, grad: [0.72, 1] });
  P.cyl(0.3, 0.44, 0.1, 0, 0.16, 0, st, MAT.plain, HEX);
  for (let i = 0; i < 6; i++) { const a = ((i + 0.5) / 6) * 6.283; P.add(sphG(0.09, 7, 4), Math.sin(a) * 0.32, 0.165, Math.cos(a) * 0.32, shade(st, 1.05), MAT.plain, { ry: a, rx: 0.7, sx: 1.2, sy: 0.38, sz: 0.7 }); }
  P.cyl(0.19, 0.21, 0.05, 0, 0.225, 0, sd, MAT.plain, { n: 12 });
  // shaft (sao): tapering, a carved collar at mid-height, a shimenawa rope with two paper shide near the top
  P.cyl(0.125, 0.15, 0.92, 0, 0.69, 0, st, MAT.plain, { n: 10, grad: [0.84, 1.02] });
  P.cyl(0.16, 0.16, 0.05, 0, 0.7, 0, sd, MAT.plain, { n: 10 });
  for (const dy of [-0.055, 0.055]) P.cyl(0.149, 0.149, 0.018, 0, 0.7 + dy, 0, sd, MAT.plain, { n: 10 });
  P.add(torusG(0.146, 0.022, 5, 14), 0, 0.98, 0, K.rope, 0, { rx: Math.PI / 2 });
  for (const a of [-0.45, 0.45]) {
    const px = Math.sin(a) * 0.16, pz = Math.cos(a) * 0.16, tx = Math.cos(a) * 0.02, tz = -Math.sin(a) * 0.02;
    P.box(0.05, 0.062, 0.008, px, 0.934, pz, '#f1ede2', 0, { ry: a }).box(0.05, 0.062, 0.008, px + tx, 0.878, pz + tz, '#f1ede2', 0, { ry: a });
  }
  // platform (chūdai): flares out of the shaft like an upturned lotus, topped by a flat slab
  P.cyl(0.34, 0.15, 0.11, 0, 1.165, 0, sd, MAT.plain, HEX).cyl(0.35, 0.35, 0.08, 0, 1.25, 0, st, MAT.plain, HEX);
  // firebox (hibukuro): sill, six corner posts, lintel; open on every face so the flame shows from any side.
  // The posts run 2 cm into the sill and the lintel, and their outer faces are flush with the corners.
  P.cyl(0.27, 0.27, 0.08, 0, 1.32, 0, st, MAT.plain, HEX).cyl(0.27, 0.27, 0.075, 0, 1.7575, 0, st, MAT.plain, HEX);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; P.box(0.07, 0.4, 0.07, Math.sin(a) * 0.235, 1.54, Math.cos(a) * 0.235, st, MAT.plain, { ry: a }); }
  P.cyl(0.085, 0.06, 0.03, 0, 1.37, 0, shade(sd, 0.7), MAT.plain, { n: 10 });   // the oil dish the flame burns on
  // cap (kasa): one carved block with curled-up corners (warabite), resting on the lintel
  P.add(kasaGeo({ n: 6, r: 0.58, th: 0.07, h: 0.24, lift: 0.07, crown: 0.1 }), 0, 1.79, 0, sd, MAT.plain, { uv: 'xz' });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; P.add(sphG(0.034, 7, 5), Math.sin(a) * 0.55, 1.925, Math.cos(a) * 0.55, sd, MAT.plain, { ry: a, sy: 1.1, sz: 1.35 }); }
  // finial: a lotus cup holding the sacred jewel (hōju)
  P.cyl(0.115, 0.08, 0.07, 0, 2.13, 0, st, MAT.plain, { n: 12 }).add(sphG(0.1, 12, 8), 0, 2.24, 0, st, MAT.plain).add(coneG(0.06, 0.12, 10), 0, 2.35, 0, st, MAT.plain);
  c.marks.push({ x: s.x, y: y + 1.385, z: s.z });   // the flame's seat: on the oil dish, inside the firebox (window 1.36 to 1.72)
}
function garden(s, c) {
  // raked gravel lies in the ground, not on it: the bed and its ridges stand at most 5 cm proud
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z);
  P.cyl(s.r, s.r, 0.05, 0, 0, 0, '#d9d4c4', 0, { n: 20 });
  for (let i = 1; i < 4; i++) P.add(torusG((s.r * i) / 4, 0.022, 4, 24), 0, 0.03, 0, '#bfb9a6', 0, { rx: Math.PI / 2 });
  c.rocks.push({ x: s.x, y: y - 0.2, z: s.z, sx: 0.9, sy: 0.9, sz: 0.7, a: 1 }, { x: s.x + s.r * 0.45, y: y - 0.15, z: s.z - s.r * 0.3, sx: 0.5, sy: 0.4, sz: 0.5, a: 2 });
}
function emblem(s, c) {
  // the arena floor: concentric rings and the clan mark inlaid flush with the paving, each ring a few millimetres
  // proud of the one round it so they never fight, the whole inlay at most 6 cm up
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z);
  P.cyl(s.r, s.r, 0.03, 0, 0, 0, '#2a2c34', 0, { n: 40 }).cyl(s.r * 0.9, s.r * 0.9, 0.042, 0, 0, 0, '#8e1c22', 0, { n: 40 }).cyl(s.r * 0.78, s.r * 0.78, 0.054, 0, 0, 0, '#23242b', 0, { n: 40 });
  P.cyl(s.r * 0.42, s.r * 0.42, 0.066, 0, 0, 0, K.gold, MAT.metal, { n: 32 }).cyl(s.r * 0.36, s.r * 0.36, 0.078, 0, 0, 0, '#8e1c22', 0, { n: 32 });
  for (const sx of [-1, 1]) P.add(coneG(s.r * 0.11, s.r * 0.5, 3), sx * s.r * 0.17, 0.012, s.r * 0.03, '#23242b', 0, { rx: Math.PI / 2, sz: 0.045 });
  for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.283; P.box(0.22, 0.064, s.r * 0.3, Math.sin(a) * s.r * 0.6, 0, Math.cos(a) * s.r * 0.6, K.gold, MAT.metal, { ry: a }); }
}
const smoke = (s, c) => { const y = c.Y(s.x, s.z) + s.h; for (let i = 0; i < 3; i++) c.sprites.push({ x: s.x, y, z: s.z, size: 1.3, kind: 'smoke' }); };
function embers(s, c) {
  const rnd = mulberry32(Math.floor(s.x * 7 + s.z));
  for (let i = 0; i < 26; i++) { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * s.r; c.sprites.push({ x: s.x + Math.cos(a) * d, y: c.Y(s.x, s.z) + rnd() * 2, z: s.z + Math.sin(a) * d, size: 0.13, kind: 'ember' }); }
}
function clouds(s, c) {
  // a sea of cloud lying in the valleys round the plateau: a soft layer (world/cloudsea.js) with heads of cloud standing
  // up out of it, never over ground you can walk on
  (c.meshes ??= []).push(cloudSea(s, c.T)); // (the physics audit builds with a bare context)
  const rnd = mulberry32(99);
  for (let i = 0, t = 0; i < 40 && t < 900; t++) {
    const a = rnd() * 6.283, d = 24 + rnd() * s.r, x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
    if (c.W(x, z) < 16 || c.T(x, z) > s.y - 6 || (s.zMax !== undefined && z > s.zMax - 8)) continue;
    c.sprites.push({ x, y: s.y + 1.5 + rnd() * 3, z, size: 9 + rnd() * 10, kind: 'cloud', aspect: 1.7 });
    i++;
  }
}
function rocks(s, c) {
  // `stone`: grey river stone (the cut-stone material) rather than the zone's boulder tones
  for (const r of rockCluster(s)) c.rocks.push({ x: r.x, y: c.Y(r.x, r.z) - r.r * r.sy * 0.3, z: r.z, sx: r.r, sy: r.r * r.sy, sz: r.r * 0.9, a: r.a, crag: !!s.stone });
}
/** A dressed-stone bank wall where a bridge comes ashore. It runs along the bank (local X) with its face to the water
    (+Z at rot 0) and its top at road level, stepping down at the far end into the bank. `seat` is the notch the bridge
    rests in: a low bed carrying the deck's sill beam, and the back wall behind it that the deck's end butts against.
    seat: { x (along the wall), w, y (bed top), d (depth back from the face) }; water: the surface level at its face */
function abutment(s, c) {
  const P = c.P.at(s.x, 0, s.z, s.rot), half = s.len / 2, top = s.top, base = s.base ?? -1.4, d = s.d ?? 2.2, st = s.seat;
  const body = (x0, x1, z0, z1, y1) => P.box(x1 - x0, y1 - base, z1 - z0, (x0 + x1) / 2, (base + y1) / 2, (z0 + z1) / 2, '#8d968f', MAT.stone, { grad: [0.66, 1.02] });
  // coping: a course of long slabs, each its own tone, a hair proud of the face
  let n = 0;
  const coping = (x0, x1, z0, z1, y1) => {
    const k = Math.max(1, Math.round((x1 - x0) / 1.15)), l = (x1 - x0) / k;
    for (let i = 0; i < k; i++) P.box(l - 0.035, 0.2, z1 - z0, x0 + l * (i + 0.5), y1 - 0.1, (z0 + z1) / 2, shade('#a6aca2', 0.88 + hash(s.x, s.z, n++) * 0.18));
  };
  // a long wall steps down at its far end; a short footing (s.step === false, or no room) stays level
  const s0 = st.x - st.w / 2, s1 = st.x + st.w / 2, step = s.step === false ? half : Math.max(s1, half - 1.6), cd = Math.min(0.75, d * 0.6);
  if (s0 > -half + 0.05) { body(-half, s0, -d, 0, top - 0.2); coping(-half, s0, -cd, 0.05, top); }
  if (step > s1 + 0.05) { body(s1, step, -d, 0, top - 0.2); coping(s1, step, -cd, 0.05, top); }
  if (half > step + 0.05) { body(step, half, -d, 0, top - 0.8); coping(step, half, -cd, 0.05, top - 0.6); }
  body(s0, s1, -st.d, 0, st.y - 0.2); coping(s0, s1, -st.d, 0.05, st.y);
  body(s0, s1, -d, -st.d, top - 0.2); coping(s0, s1, -d + Math.min(0.5, (d - st.d) / 2), -st.d + 0.05, top);
  // a footing course just proud of the face at the waterline
  const wl = s.water ?? 0;
  P.box(s.len, 0.5, 0.3, 0, wl + 0.05, 0.1, shade('#7f8983', 0.95), MAT.stone, { grad: [0.6, 0.9] });
  // the bridge's sill beam across the seat
  P.box(st.w - 0.1, 0.24, 0.36, st.x, st.y + 0.12, -st.d / 2, K.woodD);
}

export const BUILD = {
  house, mill, hall: (s, c) => hall(s, c, false), temple: (s, c) => hall(s, c, true), barracks, hut, pavilion, pagoda, statue, belltower, shrine, jizo, lantern, torii, gate, wall, tower, keep,
  stall, well, crates, barrels, baskets, cart, woodpile, haystack, scarecrow, signpost, rack, barricade, tent, brazier, torch, banner, drum, curtain, censer, fallen, checkpoint, garden, emblem,
  smoke, embers, clouds, rocks, abutment,
};

/* ---------- bridges and stairs are built from the walk shapes themselves ---------- */
const DECK = {
  wood: { deck: '#7a5a40', rail: K.woodD, post: K.woodD, cap: null, railH: 1.0 },
  board: { deck: '#7d6045', rail: K.woodD, post: K.woodD, cap: null, railH: 0.95 },
  red: { deck: '#5a4034', rail: K.red, post: K.red, cap: K.gold, railH: 1.15 },
  stone: { deck: '#a3aaa2', rail: '#8f9891', post: '#7e8881', cap: null, railH: 0.7 },
};
export function bridge(shape, c) {
  const st = DECK[shape.deck], pts = shape.pts, w = shape.w + 0.5, P = c.P.at(0, 0, 0), join = shape.join || {};
  const mid = pts[Math.floor(pts.length / 2)];
  // resample to ~1.1 m steps with a smooth arch through the control heights
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z, y]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
  const n = Math.max(4, Math.round(curve.getLength() / 1.1)), S = curve.getSpacedPoints(n);
  for (let i = 0; i < n; i++) {
    const a = S[i], b = S[i + 1], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
    P.center(shape.long ? mx : mid[0], shape.long ? mz : mid[1]);
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), ry = Math.atan2(dx, dz), rx = -Math.atan2(b.y - a.y, len);
    const stone = shape.deck === 'stone';
    P.box(w, stone ? 0.5 : 0.16, len + 0.04, mx, my - (stone ? 0.26 : 0.09), mz, st.deck, stone ? MAT.stone : MAT.plank, { ry, rx, uv: 'zx' });
    if (!stone) for (const sx of [-1, 1]) P.box(0.2, 0.26, len + 0.04, mx + Math.cos(ry) * sx * (w / 2 - 0.2), my - 0.28, mz - Math.sin(ry) * sx * (w / 2 - 0.2), st.post, 0, { ry, rx });
    for (const sx of [-1, 1]) {
      const ox = Math.cos(ry) * sx * (w / 2 - 0.08), oz = -Math.sin(ry) * sx * (w / 2 - 0.08);
      if (stone) { P.box(0.34, st.railH, len + 0.04, mx + ox, my + st.railH / 2 - 0.05, mz + oz, st.rail, MAT.stone, { ry, rx }); continue; }
      P.box(0.1, 0.1, len + 0.04, mx + ox, my + st.railH, mz + oz, st.rail, 0, { ry, rx }).box(0.07, 0.07, len + 0.04, mx + ox, my + st.railH * 0.5, mz + oz, st.rail, 0, { ry, rx });
      if (i % 2 === 0 && i > 0) {
        const main = i % 6 === 0;
        P.box(main ? 0.2 : 0.11, st.railH + (main ? 0.3 : 0.05), main ? 0.2 : 0.11, a.x + ox, a.y + (st.railH + 0.2) / 2 - 0.1, a.z + oz, st.post, 0, { ry });
        if (main && st.cap) P.add(sphG(0.14, 6, 5), a.x + ox, a.y + st.railH + 0.36, a.z + oz, st.cap, MAT.metal, { sy: 1.3 }).box(0.24, 0.1, 0.24, a.x + ox, a.y + st.railH + 0.18, a.z + oz, K.black, 0, { ry });
      }
    }
    // piles down to the bed / gorge floor (a landing a deck runs onto stands on its own; `piles: false` is a clear span
    // carried bank to bank on its abutments)
    const every = shape.long ? 8 : shape.deck === 'board' ? 3 : 5;
    if (!stone && shape.piles !== false && i % every === Math.floor(every / 2) && !(join.start && i === 0) && !(join.end && i === n - 1)) {
      const gy = c.T(mx, mz) - 0.6, hgt = my - gy;
      if (hgt > 0.5) for (const sx of [-1, 1]) {
        const ox = Math.cos(ry) * sx * (w / 2 - 0.3), oz = -Math.sin(ry) * sx * (w / 2 - 0.3), sp = shape.long ? sx * 0.12 : 0;
        P.box(shape.long ? 0.5 : 0.22, hgt, shape.long ? 0.5 : 0.22, mx + ox * (1 + (shape.long ? 0.5 : 0)), gy + hgt / 2, mz + oz * (1 + (shape.long ? 0.5 : 0)), shape.long ? K.redD : st.post, 0, { ry, rz: sp });
        if (shape.long) for (let k = 1; k < hgt / 5; k++) P.box(w + 1.6, 0.3, 0.3, mx, my - k * 5, mz, K.redD, 0, { ry });
      }
      // a tall wooden bent gets a cap beam under the deck and a cross brace, so it reads as built out over the drop
      if (!shape.long && (shape.deck === 'wood' || shape.deck === 'board') && hgt > 2.4) {
        const span = w - 0.6, top = my - 0.42, low = my - Math.min(hgt * 0.6, 1.6), dy = top - low, L = Math.hypot(span, dy), ang = Math.atan2(dy, span);
        P.box(w - 0.1, 0.2, 0.26, mx, my - 0.33, mz, st.post, 0, { ry });
        for (const s of [-1, 1]) P.box(L, 0.1, 0.1, mx, (top + low) / 2, mz, st.post, 0, { ry, rz: s * ang });
      }
    }
  }
  // end posts where the deck comes ashore; an end that runs onto a landing takes the landing's corner posts instead
  if (shape.deck === 'stone') { stoneArch(shape, S, c, P, st, w); return; }
  for (const [k, joined] of [[0, join.start], [n, join.end]]) {
    if (joined) continue;
    const p = S[k], q = S[k === 0 ? 1 : n - 1], ry = k === 0 ? Math.atan2(q.x - p.x, q.z - p.z) : Math.atan2(p.x - q.x, p.z - q.z);
    P.center(shape.long ? p.x : mid[0], shape.long ? p.z : mid[1]);
    for (const sx of [-1, 1]) newel(P, st, p.x + Math.cos(ry) * sx * (w / 2 - 0.08), p.y, p.z - Math.sin(ry) * sx * (w / 2 - 0.08), ry);
  }
}
/** A stone bridge stands on a solid arch: a ring of voussoirs springing from the stream bed and meeting the underside of
    the deck at its crown, and spandrel masonry filling from the ring (or the bank) up to the deck. Nothing of it rises
    above the deck but the parapets. `shape.span`: the opening's width at the bed (default: two thirds of the bridge). */
function stoneArch(shape, S, c, P, st, w) {
  const n = S.length - 1, A = S[0], B = S[n], L = Math.hypot(B.x - A.x, B.z - A.z), ux = (B.x - A.x) / L, uz = (B.z - A.z) / L, ry = Math.atan2(ux, uz);
  const M = n % 2 ? S[(n - 1) / 2].clone().lerp(S[(n + 1) / 2], 0.5) : S[n / 2];
  const ring = 0.3, under = M.y - 0.51, crown = under - ring, bed = c.T(M.x, M.z), h = crown - bed;
  if (h < 0.15) return;
  const span = shape.span ?? L * 0.66, R = (span * span) / 4 / (2 * h) + h / 2, cy = crown - R, a0 = Math.asin(Math.min(1, span / 2 / R));
  P.center(M.x, M.z);
  const N = Math.max(5, Math.round((2 * a0 * R) / 0.42)), arc = (2 * a0 * (R + ring / 2)) / N;
  for (let i = 0; i < N; i++) {
    const a = -a0 + ((i + 0.5) * 2 * a0) / N, r = R + ring / 2, along = r * Math.sin(a);
    P.box(w - 0.1, ring, arc + 0.03, M.x + ux * along, cy + r * Math.cos(a), M.z + uz * along, shade(st.post, 0.94 + (i % 2) * 0.1), MAT.stone, { ry, rx: a });
  }
  const Ro = R + ring;
  for (let i = 0; i < n; i++) {
    const p = S[i], q = S[i + 1], mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, my = (p.y + q.y) / 2, along = (mx - M.x) * ux + (mz - M.z) * uz;
    const top = my - 0.49, foot = Math.abs(along) < span / 2 ? cy + Math.sqrt(Math.max(0, Ro * Ro - along * along)) - 0.06 : c.T(mx, mz) - 0.3;
    if (top - foot > 0.03) P.box(w - 0.12, top - foot, Math.hypot(q.x - p.x, q.z - p.z) + 0.04, mx, (top + foot) / 2, mz, shade(st.deck, 0.9), MAT.stone, { ry });
  }
}
/** a deck's end or corner post: stouter and taller than the rail posts, and capped */
function newel(P, st, x, y, z, ry) {
  const h = st.railH + 0.42;
  P.box(0.24, h, 0.24, x, y - 0.25 + h / 2, z, st.post, 0, { ry });
  if (st.cap) P.add(sphG(0.14, 6, 5), x, y + st.railH + 0.36, z, st.cap, MAT.metal, { sy: 1.3 }).box(0.28, 0.1, 0.28, x, y + st.railH + 0.18, z, K.black, 0, { ry });
  else P.box(0.3, 0.06, 0.3, x, y + st.railH + 0.17, z, st.post, 0, { ry }).add(coneG(0.21, 0.16, 4), x, y + st.railH + 0.28, z, st.post, 0, { ry: ry + Math.PI / 4 });
}

/** A square platform where one deck turns into another: the walk shape is a two-point deck with `square` and `landing`.
    It is framed, set on four braced piles, and railed along `landing.rails` (its outer sides: 'left' | 'right' | 'start' |
    'end', looking from the first point to the second). The other sides stay open for the decks that run onto it; those
    decks are marked `join` so they leave their end posts to the landing's corners. `landing.lamp` ('right-end' ...) names
    the corner whose post rises into a lantern pole. */
export function landing(shape, c) {
  const st = DECK[shape.deck], L = shape.landing, [a, b] = shape.pts, y = a[2];
  const dx = b[0] - a[0], dz = b[1] - a[1], ry = Math.atan2(dx, dz), cs = Math.cos(ry), sn = Math.sin(ry);
  const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2, hw = (shape.w + 0.5) / 2, hd = (Math.hypot(dx, dz) + 0.5) / 2;
  const world = (lx, lz) => [cx + lx * cs + lz * sn, cz - lx * sn + lz * cs];
  const P = c.P.at(cx, 0, cz, ry);
  // the deck, framed all round, with a threshold strip over each seam where a deck runs on
  P.box(hw * 2, 0.16, hd * 2, 0, y - 0.09, 0, st.deck, MAT.plank, { uv: 'zx' });
  for (const s of [-1, 1]) P.box(0.2, 0.26, hd * 2, s * (hw - 0.1), y - 0.28, 0, st.post).box(hw * 2, 0.26, 0.2, 0, y - 0.28, s * (hd - 0.1), st.post);
  const side = { right: [-1, 'x'], left: [1, 'x'], start: [-1, 'z'], end: [1, 'z'] };
  for (const k in side) {
    if (L.rails.includes(k)) continue;
    const [s, ax] = side[k];
    if (ax === 'x') P.box(0.2, 0.05, hd * 2 - 0.1, s * (hw - 0.1), y + 0.005, 0, st.post);
    else P.box(hw * 2 - 0.1, 0.05, 0.2, 0, y + 0.005, s * (hd - 0.1), st.post);
  }
  // piles at the corners, a cap beam across each pair and a cross brace on every face
  const px = hw - 0.3, pz = hd - 0.3, beam = y - 0.42, foot = {};
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = c.T(...world(sx * px, sz * pz)) - 0.6, h = y - 0.28 - g;
    foot[sx + ',' + sz] = g;
    P.box(0.26, h, 0.26, sx * px, g + h / 2, sz * pz, st.post);
  }
  for (const s of [-1, 1]) P.box(hw * 2 - 0.1, 0.2, 0.26, 0, y - 0.33, s * pz, st.post);
  const brace = (span, g0, g1, put) => {
    const low = beam - Math.min((beam - Math.max(g0, g1)) * 0.6, 1.6), dy = beam - low, len = Math.hypot(span, dy), ang = Math.atan2(dy, span);
    if (beam - Math.max(g0, g1) > 1.2) for (const s of [-1, 1]) put(len, (beam + low) / 2, s * ang);
  };
  for (const s of [-1, 1]) {
    brace(px * 2, foot[-1 + ',' + s], foot[1 + ',' + s], (len, my, ang) => P.box(len, 0.1, 0.1, 0, my, s * pz, st.post, 0, { rz: ang }));
    brace(pz * 2, foot[s + ',-1'], foot[s + ',1'], (len, my, ang) => P.box(0.1, 0.1, len, s * px, my, 0, st.post, 0, { rx: ang }));
  }
  // rails on the outer sides, a post midway along each, and a post at every corner
  const rx = hw - 0.08, rz = hd - 0.08;
  for (const k of L.rails) {
    const [s, ax] = side[k];
    if (ax === 'x') P.box(0.1, 0.1, hd * 2, s * rx, y + st.railH, 0, st.rail).box(0.07, 0.07, hd * 2, s * rx, y + st.railH * 0.5, 0, st.rail).box(0.11, st.railH + 0.05, 0.11, s * rx, y + (st.railH + 0.2) / 2 - 0.1, 0, st.post);
    else P.box(hw * 2, 0.1, 0.1, 0, y + st.railH, s * rz, st.rail).box(hw * 2, 0.07, 0.07, 0, y + st.railH * 0.5, s * rz, st.rail).box(0.11, st.railH + 0.05, 0.11, 0, y + (st.railH + 0.2) / 2 - 0.1, s * rz, st.post);
  }
  let lamp = null;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const name = (sx < 0 ? 'right' : 'left') + '-' + (sz < 0 ? 'start' : 'end');
    if (L.lamp !== name) { newel(P, st, sx * rx, y, sz * rz, 0); continue; }
    // the lamp post: the corner post carried on up, an arm reaching in over the deck, a paper lantern hung from it
    const ux = -sx * Math.SQRT1_2, uz = -sz * Math.SQRT1_2, ay = Math.atan2(-uz, ux);
    P.box(0.22, 3.05, 0.22, sx * rx, y - 0.25 + 1.525, sz * rz, st.post).box(0.3, 0.06, 0.3, sx * rx, y + 2.83, sz * rz, st.post);
    P.box(0.95, 0.1, 0.1, sx * rx + ux * 0.4, y + 2.62, sz * rz + uz * 0.4, st.post, 0, { ry: ay }).box(0.5, 0.07, 0.07, sx * rx + ux * 0.2, y + 2.4, sz * rz + uz * 0.2, st.post, 0, { ry: ay, rz: 0.75 });
    lamp = world(sx * rx + ux * 0.78, sz * rz + uz * 0.78);
    P.box(0.025, 0.2, 0.025, sx * rx + ux * 0.78, y + 2.5, sz * rz + uz * 0.78, K.black);
  }
  if (lamp) paperLantern(c, lamp[0], y + 2.2, lamp[1], 1.0); // last: it re-anchors the parts list
}
/** chiselled rock lining a gorge's walls (see the 'gorge' terrain op in world/nav.js): ledges of stone stacked up each face,
    long side along the wall like strata. Notches where a path cuts through are left bare, and nothing reaches a path or deck. */
export function crags(shape, c) {
  const P = shape.pts, rnd = mulberry32(Math.floor(P[0][0] * 31 + P[0][1] * 17) + 4242);
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], vx = b[0] - a[0], vz = b[1] - a[1], len = Math.hypot(vx, vz), ux = vx / len, uz = vz / len;
    const steps = Math.max(1, Math.round(len / 1.5));
    for (let j = 0; j < steps; j++) {
      for (const side of [1, -1]) {
        const t = (j + 0.2 + rnd() * 0.6) / steps, k = side > 0 ? 2 : 3, half = a[k] + (b[k] - a[k]) * t;
        if (side > 0 ? !(a[4] || b[4]) : !(a[5] || b[5])) continue; // an open side
        const nx = -uz * side, nz = ux * side; // outward, into this wall (side 1 = right bank)
        const fx = a[0] + vx * t + nx * half, fz = a[1] + vz * t + nz * half, foot = c.T(fx, fz);
        // no wall here (a path's notch, or the gorge fading out at its ends)
        const top = c.T(fx + nx * 4.5, fz + nz * 4.5);
        if (top - foot < 2.6) continue;
        // upright blocks, staggered course by course like columnar stone
        for (let ry = Math.max(foot, 0) + (rnd() - 0.5) * 0.8; ry < top - 1.2; ry += 2.1 + rnd() * 0.7) {
          if (rnd() < 0.1) continue;
          let d = 0;
          while (d < 6 && c.T(fx + nx * d, fz + nz * d) < ry) d += 0.25; // the face at this height
          const sx = 1.1 + rnd() * 0.9, sy = 1.5 + rnd() * 1.3, sz = 0.9 + rnd() * 0.5;
          let px = fx + nx * (d + sz * 0.3), pz = fz + nz * (d + sz * 0.3);
          // keep the stone's reach clear of anything walkable (with room for a deck's rails in a gorge; a cut's faces
          // stand right beside a plain path): push it back into the wall, and leave it out where its ends along the
          // wall would still reach (a deck crossing the wall, a notch)
          const cut = shape.op === 'cut', clear = c.W(px, pz) - sz * (cut ? 1.1 : 1.4) - (cut ? 0.15 : 0.5);
          if (clear < 0) { px -= nx * clear; pz -= nz * clear; }
          const ex = ux * sx * 1.25, ez = uz * sx * 1.25, endGap = cut ? 0.35 : 0.9;
          if (c.W(px + ex, pz + ez) < endGap || c.W(px - ex, pz - ez) < endGap) continue;
          c.rocks.push({ x: px, y: Math.max(ry, foot) - sy * 0.15, z: pz, sx, sy, sz, a: Math.atan2(-uz, ux) + (rnd() - 0.5) * 0.6, crag: true });
        }
      }
    }
  }
}
export function stairway(shape, c) {
  const P = c.P.at(0, 0, 0), w = shape.w + 0.7;
  for (let i = 0; i < shape.pts.length - 1; i++) {
    const [ax, az, ay] = shape.pts[i], [bx, bz, by] = shape.pts[i + 1];
    const dx = bx - ax, dz = bz - az, run = Math.hypot(dx, dz), rise = by - ay, ry = Math.atan2(dx, dz);
    P.center((ax + bx) / 2, (az + bz) / 2);
    const n = Math.max(2, Math.round(Math.abs(rise) / 0.24)), tread = run / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, top = ay + (rise * (k + (rise > 0 ? 1 : 0))) / n;
      P.box(w, 0.9, tread + 0.03, ax + dx * t, top - 0.45, az + dz * t, k % 2 ? '#a6ada4' : '#9aa29a', MAT.stone, { ry });
    }
    // stone cheek walls following the slope
    const slope = Math.atan2(rise, run), len = Math.hypot(run, rise);
    for (const sx of [-1, 1]) {
      const ox = Math.cos(ry) * sx * (w / 2 + 0.22), oz = -Math.sin(ry) * sx * (w / 2 + 0.22);
      P.box(0.46, 1.5, len + 0.3, (ax + bx) / 2 + ox, (ay + by) / 2 + 0.1, (az + bz) / 2 + oz, K.stoneD, MAT.stone, { ry, rx: -slope });
      P.box(0.6, 0.16, len + 0.3, (ax + bx) / 2 + ox, (ay + by) / 2 + 0.9, (az + bz) / 2 + oz, K.stone, 0, { ry, rx: -slope });
    }
  }
}
export { hash, shade };
