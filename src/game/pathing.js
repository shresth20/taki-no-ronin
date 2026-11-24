import { G } from '../core/state.js';
import { walkAt, zoneAt, zoneSolids, listBlockers, ZONES } from '../world/nav.js';

/* Enemies find their way round water, walls and rails the way a person would: across a bridge from its end, round
   the end of a wall, instead of pressing into the bank opposite the player. A flow field toward the player is kept
   over the walkable ground near the fight (nav.walkAt, less everything solid), refreshed a few times a second.
   steer() leaves a body to walk straight wherever the straight way is open, and only then points it along the field. */
const CELL = 0.5, HALF = 36, N = Math.round((HALF * 2) / CELL), BODY = 0.42;
const open = new Uint8Array(N * N), queue = new Int32Array(N * N);
let cx = NaN, cz = NaN, x0 = 0, z0 = 0, wards = -1, gen = 0;
// one field per goal: 'player' (every enemy shares it), or any other point asked for
const fields = new Map();
const solidsCache = new Map(); // a zone's solids never change (closed gates and wards are blockers, in walkAt)

function distSolid(f, x, z) {
  if (f.r !== undefined) return Math.hypot(x - f.x, z - f.z) - f.r;
  const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0), dx = x - f.x, dz = z - f.z;
  const qx = Math.abs(dx * c - dz * s) - f.w / 2, qz = Math.abs(dx * s + dz * c) - f.d / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}
const solidsOf = (zi) => { if (!solidsCache.has(zi)) solidsCache.set(zi, zoneSolids(ZONES[zi])); return solidsCache.get(zi); };

/** which cells a body can stand in, around (x, z) */
function build(x, z) {
  cx = x; cz = z; x0 = x - HALF; z0 = z - HALF;
  const zs = new Set();
  for (const [ox, oz] of [[0, 0], [-HALF, -HALF], [HALF, -HALF], [-HALF, HALF], [HALF, HALF]]) zs.add(zoneAt(x + ox, z + oz));
  const solids = [...zs].flatMap(solidsOf).filter((f) => Math.abs(f.x - x) < HALF + 8 && Math.abs(f.z - z) < HALF + 8);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) open[j * N + i] = walkAt(x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL) < -0.1 ? 1 : 0;
  // stamp each solid out of it, a body's radius wide
  for (const f of solids) {
    const reach = (f.r ?? Math.hypot(f.w, f.d) / 2) + BODY;
    const i0 = Math.max(0, Math.floor((f.x - reach - x0) / CELL)), i1 = Math.min(N - 1, Math.floor((f.x + reach - x0) / CELL));
    const j0 = Math.max(0, Math.floor((f.z - reach - z0) / CELL)), j1 = Math.min(N - 1, Math.floor((f.z + reach - z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (open[j * N + i] && distSolid(f, x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL) < BODY) open[j * N + i] = 0;
  }
  wards = listBlockers().length;
}
const cellOf = (x, z) => {
  const i = Math.floor((x - x0) / CELL), j = Math.floor((z - z0) / CELL);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};
/** the nearest open cell to (x, z), within a couple of metres */
function nearestOpen(x, z) {
  const c = cellOf(x, z);
  if (c < 0) return -1;
  if (open[c]) return c;
  const ci = c % N, cj = (c / N) | 0;
  for (let r = 1; r <= 5; r++) for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) {
    if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
    const i = ci + a, j = cj + b;
    if (i >= 0 && j >= 0 && i < N && j < N && open[j * N + i]) return j * N + i;
  }
  return -1;
}
/** steps from every open cell to the goal's (8-connected breadth-first) */
function flow(dist, px, pz) {
  dist.fill(-1);
  const goal = nearestOpen(px, pz);
  if (goal < 0) return;
  let head = 0, tail = 0;
  dist[goal] = 0;
  queue[tail++] = goal;
  while (head < tail) {
    const c = queue[head++], i = c % N, j = (c / N) | 0, d = dist[c] + 1;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      if (!a && !b) continue;
      const ii = i + a, jj = j + b;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const n = jj * N + ii;
      if (!open[n] || dist[n] >= 0) continue;
      // no cutting a corner between two blocked cells
      if (a && b && (!open[j * N + ii] || !open[jj * N + i])) continue;
      dist[n] = d;
      queue[tail++] = n;
    }
  }
}
function field(key, gx, gz) {
  const P = G.player, A = G.arena, ax = A ? A.x : P.pos.x, az = A ? A.z : P.pos.z;
  if (!(cx === cx) || Math.hypot(ax - cx, az - cz) > (A ? 0.5 : 12) || listBlockers().length !== wards) { build(ax, az); gen++; }
  let f = fields.get(key);
  if (!f) fields.set(key, (f = { dist: new Int32Array(N * N), at: -1e9, gen: -1, gx: NaN, gz: NaN }));
  if (f.gen !== gen || G.time - f.at > 0.25 || Math.hypot(gx - f.gx, gz - f.gz) > 1) { flow(f.dist, gx, gz); f.at = G.time; f.gen = gen; f.gx = gx; f.gz = gz; }
  return f.dist;
}
/** is the straight way from (x, z) to (tx, tz) all open ground? */
function clear(x, z, tx, tz) {
  const d = Math.hypot(tx - x, tz - z), n = Math.ceil(d / (CELL * 0.8));
  for (let k = 1; k <= n; k++) {
    const c = cellOf(x + ((tx - x) * k) / n, z + ((tz - z) * k) / n);
    if (c < 0) return true; // beyond the field: nothing to say
    if (!open[c]) return false;
  }
  return true;
}
const out = { x: 0, z: 0 };
/** a direction to walk from (x, z) toward (tx, tz), or null when walking straight is fine. The way round is found to
    the player (where every enemy is headed, whatever spot beside them it wants), or to (tx, tz) itself with `toPoint` */
export function steer(x, z, tx, tz, toPoint = false) {
  if (!G.player) return null;
  const dist = toPoint ? field('point', tx, tz) : field('player', G.player.pos.x, G.player.pos.z);
  if (clear(x, z, tx, tz)) return null;
  let c = nearestOpen(x, z);
  if (c < 0 || dist[c] < 0) return null;
  // walk the field down a few cells and aim at where it leads, so the path reads as a line rather than a staircase
  let k = 0;
  while (k++ < 4 && dist[c] > 0) {
    const i = c % N, j = (c / N) | 0;
    let best = c;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const ii = i + a, jj = j + b;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const n = jj * N + ii;
      if (dist[n] >= 0 && dist[n] < dist[best] && (!(a && b) || (open[j * N + ii] && open[jj * N + i]))) best = n;
    }
    if (best === c) break;
    c = best;
  }
  const gx = x0 + ((c % N) + 0.5) * CELL - x, gz = z0 + (((c / N) | 0) + 0.5) * CELL - z, l = Math.hypot(gx, gz);
  if (l < 1e-3) return null;
  out.x = gx / l; out.z = gz / l;
  return out;
}
