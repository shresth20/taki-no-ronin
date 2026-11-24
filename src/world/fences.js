import * as THREE from 'three';
import { terrainAt } from './nav.js';
import { Parts, mergeKit, kitMaterial, MAT, sphG } from './kit/core.js';
import { K, hash } from './kit/build.js';

/* Edge fences, built the way a carpenter would build them.

   The walk area's edge is traced as continuous lines (the iso-line of the nav grid's distance field, OFF metres
   outside the walk), the lines are straightened, and each straight run gets a post at every corner and at even
   spacing in between. Rails run from post to post with their ends inside the posts, so a corner is one post with
   two rails meeting in it: never two pieces crossing in an X, never a rail poking out past the last post. Every bay
   follows the ground between its own two posts (rails and boards are sheared, not tilted, so boards stay plumb), and
   a bay that would cross a hump or a dip gets an extra post. Bits of edge too short to read as a fence are left
   open, and a run stops with a post where something solid, a bridge, a bank or a steep slope interrupts it.

   Styles that are a wall rather than posts and rails (palisade, castle wall) lay their pieces end to end along the
   same straightened lines, fitted to each straight so the courses meet at the corners.                            */

const OFF = 0.42; // how far outside the walk edge the fence line stands

/** The iso-line W = t of a nav grid as polylines [{ pts: [[x, z]...], closed }] (marching squares; a saddle cell is
    split by the mean of its corners). */
export function contours(g, t) {
  const { nx, nz, W, x0, z0 } = g;
  const val = (i, j) => W[j * nx + i] - t;
  const H = (i, j) => (j * nx + i) * 2, V = (i, j) => (j * nx + i) * 2 + 1;
  const pos = new Map(), adj = new Map();
  const point = (id) => {
    let p = pos.get(id);
    if (p) return p;
    const k = id >> 1, i = k % nx, j = (k - i) / nx, a = val(i, j), b = id & 1 ? val(i, j + 1) : val(i + 1, j), f = a / (a - b);
    p = id & 1 ? [x0 + i, z0 + j + f] : [x0 + i + f, z0 + j];
    pos.set(id, p);
    return p;
  };
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = val(i, j), b = val(i + 1, j), c = val(i, j + 1), d = val(i + 1, j + 1);
    const sa = a > 0, sb = b > 0, sc = c > 0, sd = d > 0, e = [];
    if (sa !== sb) e.push(0);
    if (sb !== sd) e.push(1);
    if (sc !== sd) e.push(2);
    if (sa !== sc) e.push(3);
    if (!e.length) continue;
    const id = [H(i, j), V(i + 1, j), H(i, j + 1), V(i, j)];
    if (e.length === 2) link(id[e[0]], id[e[1]]);
    else if ((a + b + c + d) / 4 > 0 === sa) { link(id[0], id[1]); link(id[2], id[3]); }
    else { link(id[0], id[3]); link(id[1], id[2]); }
  }
  // chain the pieces: lines that leave the grid first (they start at an end), then the closed loops
  const seen = new Set(), out = [];
  const walk = (start) => {
    const ids = [start];
    seen.add(start);
    let cur = start;
    for (;;) {
      const next = adj.get(cur).find((n) => !seen.has(n));
      if (next === undefined) break;
      ids.push(next);
      seen.add(next);
      cur = next;
    }
    out.push({ pts: ids.map(point), closed: ids.length > 2 && adj.get(cur).includes(start) });
  };
  for (const [id, n] of adj) if (n.length === 1 && !seen.has(id)) walk(id);
  for (const id of adj.keys()) if (!seen.has(id)) walk(id);
  return out;
}

/* ---------- line work ---------- */
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** points no more than `step` apart along a line (a closed line is not repeated at its end) */
function densify(line, step) {
  const src = line.closed ? [...line.pts, line.pts[0]] : line.pts, out = [];
  for (let k = 0; k < src.length - 1; k++) {
    const [ax, az] = src[k], [bx, bz] = src[k + 1], n = Math.max(1, Math.ceil(dist(src[k], src[k + 1]) / step));
    for (let s = 0; s < n; s++) out.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
  }
  if (!line.closed) out.push(src[src.length - 1]);
  return out;
}
/** the stretches of a line where `keep` holds (a closed line kept all round stays closed) */
function split(P, closed, keep) {
  const ok = P.map(([x, z]) => keep(x, z));
  if (closed && ok.every(Boolean)) return [{ pts: P, closed: true }];
  const s0 = closed ? ok.indexOf(false) : 0, runs = [];
  let cur = [];
  for (let k = 0; k < P.length; k++) {
    const q = (s0 + k) % P.length;
    if (ok[q]) cur.push(P[q]);
    else { if (cur.length > 1) runs.push({ pts: cur, closed: false }); cur = []; }
  }
  if (cur.length > 1) runs.push({ pts: cur, closed: false });
  return runs;
}
/** Douglas–Peucker: the fewest points that keep the line within `tol` */
function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
  keep[0] = keep[pts.length - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop(), [ax, az] = pts[a], vx = pts[b][0] - ax, vz = pts[b][1] - az, L = Math.hypot(vx, vz);
    let best = -1, bd = tol;
    for (let k = a + 1; k < b; k++) {
      const d = L < 1e-6 ? dist(pts[a], pts[k]) : Math.abs((pts[k][0] - ax) * vz - (pts[k][1] - az) * vx) / L;
      if (d > bd) { bd = d; best = k; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, k) => keep[k]);
}
function simplifyLoop(pts, tol) {
  let far = 0;
  for (let k = 1; k < pts.length; k++) if (dist(pts[0], pts[k]) > dist(pts[0], pts[far])) far = k;
  const a = simplify(pts.slice(0, far + 1), tol), b = simplify([...pts.slice(far), pts[0]], tol);
  return [...a, ...b.slice(1, -1)];
}
/** fold away edges shorter than `minE` (two posts a hand apart read as clutter): an inner pair becomes its midpoint,
    a run's end stays where it is */
function tidy(v, closed, minE) {
  for (let changed = true; changed && v.length > (closed ? 3 : 2);) {
    changed = false;
    const n = v.length, m = closed ? n : n - 1;
    for (let k = 0; k < m; k++) {
      const a = v[k], b = v[(k + 1) % n];
      if (dist(a, b) >= minE) continue;
      const aEnd = !closed && k === 0, bEnd = !closed && k + 1 === n - 1;
      if (aEnd && bEnd) return v;
      if (aEnd) v.splice(k + 1, 1);
      else if (bEnd) v.splice(k, 1);
      else { v[k] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; v.splice((k + 1) % n, 1); }
      changed = true;
      break;
    }
  }
  return v;
}
const lineLen = (v, closed) => { let s = 0; for (let k = 0; k < v.length - (closed ? 0 : 1); k++) s += dist(v[k], v[(k + 1) % v.length]); return s; };
/** post positions: every corner, and evenly between so no bay is (much) longer than `span` */
function stations(v, closed, span) {
  const out = [], n = v.length, m = closed ? n : n - 1;
  for (let k = 0; k < m; k++) {
    const a = v[k], b = v[(k + 1) % n], c = Math.max(1, Math.ceil(dist(a, b) / span - 0.12));
    for (let s = 0; s < c; s++) out.push([a[0] + ((b[0] - a[0]) * s) / c, a[1] + ((b[1] - a[1]) * s) / c]);
  }
  if (!closed) out.push(v[n - 1]);
  return out;
}
// a post stands on the lowest ground under its foot, so no side of it lifts clear on a slope
const ground = (x, z) => Math.min(terrainAt(x, z), terrainAt(x + 0.11, z), terrainAt(x - 0.11, z), terrainAt(x, z + 0.11), terrainAt(x, z - 0.11));
/** an extra post in the middle of any bay whose ground bulges or sags away from the straight line between its posts */
function settle(P, closed) {
  for (let pass = 0; pass < 2; pass++) {
    const out = [], n = P.length, m = closed ? n : n - 1;
    for (let k = 0; k < n; k++) {
      out.push(P[k]);
      if (k >= m) continue;
      const a = P[k], b = P[(k + 1) % n];
      if (dist([a.x, a.z], [b.x, b.z]) < 1.1) continue;
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, y = ground(x, z);
      if (Math.abs(y - (a.y + b.y) / 2) > 0.2) out.push({ x, z, y });
    }
    P = out;
  }
  return P;
}

/* ---------- the kits: a post, a bay (the rails, built 1 m long and stretched post to post) and what fills it ---------- */
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const _geo = {};
const piece = (key, make) => {
  if (_geo[key]) return _geo[key];
  const P = new Parts();
  make(P);
  const g = mergeKit(P.list);
  g.userData.shared = true; // kept across zones, like the other boundary pieces
  return (_geo[key] = g);
};
const RAIL = Math.PI / 2;
const KITS = {
  // the gorge trail: split-log posts, two round rails let into them
  rail: {
    span: 2.3, round: true,
    post: () => piece('rail-post', (P) => P.cyl(0.066, 0.078, 1.4, 0, 0.33, 0, K.woodD, 0, { n: 7, grad: [0.6, 1.05] }).cyl(0.046, 0.066, 0.05, 0, 1.055, 0, K.woodD, 0, { n: 7 })),
    bay: () => piece('rail-bay', (P) => P.cyl(0.046, 0.046, 1, 0, 0.88, 0, K.wood, 0, { rz: RAIL, n: 6 }).cyl(0.04, 0.04, 1, 0, 0.5, 0, K.wood, 0, { rz: RAIL, n: 6 })),
  },
  // the village: squared posts with a cap, two rails, and boards nailed to the rails on the street side
  fence: {
    span: 1.9,
    post: () => piece('fence-post', (P) => P.box(0.13, 1.47, 0.13, 0, 0.385, 0, K.woodD, 0, { grad: [0.62, 1.05] }).box(0.17, 0.045, 0.17, 0, 1.13, 0, shade(K.woodD, 0.82))),
    bay: () => piece('fence-bay', (P) => P.box(1, 0.08, 0.055, 0, 0.5, 0, K.woodL).box(1, 0.08, 0.055, 0, 0.9, 0, K.woodL)),
    fill: { geo: () => piece('fence-board', (P) => P.box(0.085, 0.88, 0.03, 0, 0.44, 0, K.wood)), gap: 0.2, inset: 0.1, lift: 0.1, off: 0.044, vary: 0.18 },
  },
  // the temple: a stone tamagaki, posts with a ball finial, a capping rail and a plinth, balusters between
  balustrade: {
    span: 2.1,
    post: () => piece('bal-post', (P) => P.box(0.3, 1.33, 0.3, 0, 0.365, 0, K.stoneD, MAT.plain).add(sphG(0.16, 8, 6), 0, 1.12, 0, K.stoneL)),
    bay: () => piece('bal-bay', (P) => P.box(1, 0.16, 0.26, 0, 0.92, 0, K.stone).box(1, 0.32, 0.22, 0, 0.08, 0, K.stone)),
    fill: { geo: () => piece('bal-post-small', (P) => P.box(0.12, 0.64, 0.12, 0, 0.32, 0, K.stoneL)), gap: 0.62, inset: 0.3, lift: 0.22, off: 0, vary: 0.1 },
  },
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const trs = (x, y, z, yaw, sx = 1, sy = 1) => new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, yaw), _s.set(sx, sy, 1));
/** a bay from post a to post b: local x runs from one post's foot to the other's, y stays plumb, z across the line */
function shear(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, h = Math.hypot(dx, dz);
  return new THREE.Matrix4().set(dx, 0, -dz / h, (a.x + b.x) / 2, dy, 1, 0, (a.y + b.y) / 2, dz, 0, dx / h, (a.z + b.z) / 2, 0, 0, 0, 1);
}
const _c = new THREE.Color();
function instanced(geo, items, name) {
  const im = new THREE.InstancedMesh(geo, kitMaterial(), items.length);
  items.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, _c.setRGB(it.k, it.k, it.k)); });
  im.castShadow = im.receiveShadow = true;
  im.name = name;
  im.computeBoundingSphere();
  return im;
}

function postAndRail(kit, runs, grad, name) {
  const posts = [], bays = [], fill = [];
  for (const run of runs) {
    const P = settle(stations(run.v, run.closed, kit.span).map(([x, z]) => ({ x, z, y: ground(x, z) })), run.closed);
    const n = P.length, m = run.closed ? n : n - 1;
    for (let k = 0; k < n; k++) {
      const p = P[k], a = P[run.closed ? (k + n - 1) % n : Math.max(0, k - 1)], b = P[run.closed ? (k + 1) % n : Math.min(n - 1, k + 1)];
      // a squared post squares itself to the line (the bisector, at a corner); a log is turned any old way
      const yaw = kit.round ? hash(p.x, p.z, 3) * 6.283 : Math.atan2(-(b.z - a.z), b.x - a.x);
      posts.push({ m: trs(p.x, p.y, p.z, yaw, 1, kit.round ? 0.96 + hash(p.z, p.x, 4) * 0.08 : 1), k: 0.88 + hash(p.x, p.z) * 0.2 });
    }
    for (let k = 0; k < m; k++) {
      const a = P[k], b = P[(k + 1) % n];
      bays.push({ m: shear(a, b), k: 0.9 + hash(a.x + b.x, a.z + b.z, 2) * 0.16 });
      const f = kit.fill;
      if (!f) continue;
      const dx = b.x - a.x, dz = b.z - a.z, h = Math.hypot(dx, dz), use = h - f.inset * 2;
      if (use < f.gap * 0.5) continue;
      // boards go on the walk's side of the rails
      const [gx, gz] = grad((a.x + b.x) / 2, (a.z + b.z) / 2), s = (-dz * gx + dx * gz) / h > 0 ? -1 : 1, ox = (-dz / h) * s * f.off, oz = (dx / h) * s * f.off;
      const nb = Math.max(1, Math.round(use / f.gap)), yaw = Math.atan2(-dz, dx);
      for (let i = 0; i < nb; i++) {
        const t = (f.inset + ((i + 0.5) * use) / nb) / h, x = a.x + dx * t, z = a.z + dz * t;
        fill.push({ m: trs(x + ox, a.y + (b.y - a.y) * t + f.lift, z + oz, yaw), k: 1 - f.vary / 2 + hash(x, z, 6) * f.vary });
      }
    }
  }
  return [instanced(kit.post(), posts, name + '-posts'), instanced(kit.bay(), bays, name + '-rails'), fill.length && instanced(kit.fill.geo(), fill, name + '-fill')].filter(Boolean);
}

/** wall-like styles: `boundaryPiece` pieces (1.3 m long) laid end to end, fitted to each straight */
function laid(style, runs, grad, boundaryPiece, name) {
  const L = 1.3, pal = style === 'palisade', sets = [[], [], []];
  for (const run of runs) {
    const v = run.v, n = v.length, m = run.closed ? n : n - 1;
    for (let k = 0; k < m; k++) {
      const a = v[k], b = v[(k + 1) % n], len = dist(a, b), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
      // a wall's courses run on past a corner into the next straight so the corner is closed; at the open end of a
      // run they stop square. Palisade stakes need no lap: the next straight's first stake stands right there.
      const e0 = pal || (!run.closed && k === 0) ? 0 : 0.3, e1 = pal || (!run.closed && k === m - 1) ? 0 : 0.3;
      const cnt = pal ? Math.max(1, Math.round(len / L)) : Math.max(1, Math.ceil(len / 2.6));
      for (let i = 0; i < cnt; i++) {
        const s0 = (len * i) / cnt - (i === 0 ? e0 : 0), s1 = (len * (i + 1)) / cnt + (i === cnt - 1 ? e1 : 0), sm = (s0 + s1) / 2;
        const cx = a[0] + ux * sm, cz = a[1] + uz * sm;
        const y = Math.min(terrainAt(a[0] + ux * s0, a[1] + uz * s0), terrainAt(cx, cz), terrainAt(a[0] + ux * s1, a[1] + uz * s1)) - 0.06;
        const [gx, gz] = grad(cx, cz);
        let yaw = Math.atan2(-uz, ux);
        if (Math.sin(yaw) * gx + Math.cos(yaw) * gz > 0) yaw += Math.PI; // the piece's inner (+z) face looks onto the walk
        if (pal) yaw += (hash(cz, cx, 7) - 0.5) * 0.08; // each stake section set a little off square
        const sx = Math.max(0.7, (s1 - s0) / L), variant = pal ? Math.min(2, Math.floor(hash(cx * 1.7, cz * 2.3, 5) * 3)) : 0;
        sets[variant].push({ m: trs(cx, y, cz, yaw, sx), k: 0.88 + hash(cx, cz) * 0.22 });
      }
    }
  }
  return sets.map((list, v) => list.length && instanced(boundaryPiece(style, v), list, name + (pal ? '-' + v : ''))).filter(Boolean);
}

/** the straightened runs of fence along a zone's walk edge (and the outward normal field they were made with) */
export function fenceRuns(grid, W, open) {
  const grad = (x, z) => {
    const gx = W(x + 0.4, z) - W(x - 0.4, z), gz = W(x, z + 0.4) - W(x, z - 0.4), l = Math.hypot(gx, gz) || 1;
    return [gx / l, gz / l];
  };
  const keep = (x, z) => { const [gx, gz] = grad(x, z); return open(x - gx * OFF, z - gz * OFF, gx, gz); };
  const runs = [], short = [];
  for (const line of contours(grid, OFF)) {
    for (const r of split(densify(line, 0.5), line.closed, keep)) {
      const v = tidy(r.closed ? simplifyLoop(r.pts, 0.2) : simplify(r.pts, 0.2), r.closed, 0.85);
      (lineLen(v, r.closed) >= 1.5 ? runs : short).push({ v, closed: r.closed && v.length > 2 });
    }
  }
  return { runs, short, grad };
}

/**
 * Fence a zone's walk edge.
 * W(x, z): the zone's distance to the walk edge (bilinear, negative inside); open(x, z, gx, gz): may the walk edge at
 * (x, z), whose outward normal is (gx, gz), be fenced; boundaryPiece(style, variant): the wall styles' pieces.
 */
export function fenceLines(zone, style, { grid, W, open, boundaryPiece }) {
  const { runs, grad } = fenceRuns(grid, W, open);
  if (!runs.length) return null;
  const name = 'boundary-' + zone.id, kit = KITS[style];
  const meshes = kit ? postAndRail(kit, runs, grad, name) : laid(style, runs, grad, boundaryPiece, name);
  const grp = new THREE.Group();
  grp.name = name;
  grp.add(...meshes);
  return grp;
}
