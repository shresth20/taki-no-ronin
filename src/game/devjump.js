import { G } from '../core/state.js';
import { clamp } from '../core/util.js';
import { ZONES, CHECKPOINTS, ENCOUNTERS, GATES } from '../world/zones/index.js';
import { walkAt, zoneAt, zoneSolids } from '../world/nav.js';

/* Tester teleport (?dev=1). Pick any point on the journey map and stand there with the road behind it already walked.
   planJump() works out what that means: the nearest spot you can stand on, which fights count as won, which fight
   (if any) you land in, and which spirit lamp remembers you. The map calls it on hover to preview the jump, and the
   director's devTeleport() applies it.

   Progress is measured along the zones' own routes: zone index first, then metres along that zone's road. A fight is
   behind you once you are past its arena, or past a gate it opens. Clicking inside an arena at or past its trigger
   puts you at the trigger so the fight plays as designed; `skipHere` counts that fight as won instead.            */

const ROUTES = ZONES.map((z) => {
  let at = 0;
  return z.route.slice(1).map((b, i) => {
    const a = z.route[i], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const seg = { ax: a[0], az: a[1], dx, dz, len, at };
    at += len;
    return seg;
  });
});

/** how far along the journey (x, z) lies, measured on zone `zi`'s road, and which way that road runs there */
export function along(zi, x, z) {
  let best = Infinity, t = 0, yaw = 0;
  for (const s of ROUTES[zi]) {
    const k = s.len ? clamp(((x - s.ax) * s.dx + (z - s.az) * s.dz) / (s.len * s.len), 0, 1) : 0;
    const d = Math.hypot(x - s.ax - s.dx * k, z - s.az - s.dz * k);
    if (d < best) { best = d; t = s.at + s.len * k; yaw = Math.atan2(s.dx, s.dz); }
  }
  return { p: zi * 1e5 + t, yaw };
}

/* ---------- where can the ronin actually stand? ---------- */
const SOLIDS = [];
const solidsOf = (zi) => SOLIDS[zi] || (SOLIDS[zi] = zoneSolids(ZONES[zi]));
const MARGIN = 0.55;
function insideSolid(f, x, z) {
  const dx = x - f.x, dz = z - f.z;
  if (f.r !== undefined) return dx * dx + dz * dz < (f.r + MARGIN) ** 2;
  const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0);
  return Math.abs(dx * c - dz * s) < f.w / 2 + MARGIN && Math.abs(dx * s + dz * c) < f.d / 2 + MARGIN;
}
function standable(x, z) {
  if (walkAt(x, z) > -0.35) return false; // off the walkable area, on its edge, or against a closed gate
  for (const f of solidsOf(zoneAt(x, z))) if (insideSolid(f, x, z)) return false;
  for (const c of G.world?.colliders || []) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + MARGIN) ** 2) return false;
  return true;
}
/** the nearest standable point to (x, z), searched in rings out to `reach` metres; null if there is none */
export function standAt(x, z, reach = 40) {
  if (standable(x, z)) return { x, z };
  for (let r = 0.75; r <= reach; r += 0.75) {
    const n = Math.max(8, Math.ceil((Math.PI * 2 * r) / 0.75));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (standable(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

const gateP = Object.fromEntries(GATES.map((g) => [g.id, along(g.zone, g.x, g.z).p]));
const trigP = Object.fromEntries(ENCOUNTERS.map((e) => [e.id, along(e.zone, e.trigger.x, e.trigger.z).p]));
const arenaP = Object.fromEntries(ENCOUNTERS.map((e) => [e.id, along(e.zone, e.arena.x, e.arena.z).p]));
const cpP = Object.fromEntries(CHECKPOINTS.map((c) => [c.id, along(c.zone, c.x, c.z).p]));

/**
 * Work out a jump to the map point (x, z).
 * @returns null when there is no ground within reach, else
 *   { x, z, yaw, zone, clicked: {x, z}, snapped (metres moved to find ground), clear: [encounter ids won],
 *     fight: encounter you land in or null, wonHere: fights at this spot counted as won by `skipHere`,
 *     checkpoint: id, skipped: count of fights won along the way }
 */
export function planJump(x, z, { skipHere = false } = {}) {
  const spot = standAt(x, z);
  if (!spot) return null;
  const zone = zoneAt(spot.x, spot.z);
  const here = along(zone, spot.x, spot.z);
  const clear = [];
  const candidates = [];
  for (const e of ENCOUNTERS) {
    if (e.zone < zone) { clear.push(e.id); continue; }
    if (e.zone > zone) continue;
    // beyond a gate this fight opens: it must have been won to stand here
    if ((e.opens || []).some((id) => gateP[id] <= here.p)) { clear.push(e.id); continue; }
    const d = Math.hypot(spot.x - e.arena.x, spot.z - e.arena.z);
    if (d < e.arena.r) {
      // inside its ring: at or past its trigger you are in the fight, short of it the fight is still ahead
      if (here.p >= trigP[e.id] - e.trigger.r) candidates.push({ e, k: d / e.arena.r });
      continue;
    }
    if (arenaP[e.id] < here.p) clear.push(e.id);
  }
  // two rings can overlap: the one whose centre is closest (relative to its size) is the fight you are in
  candidates.sort((a, b) => a.k - b.k);
  let fight = null;
  const wonHere = [];
  for (const { e } of candidates) {
    if (skipHere) { clear.push(e.id); wonHere.push(e); }
    else if (!fight) fight = e;
    else if (arenaP[e.id] < arenaP[fight.id]) clear.push(e.id); // an overlapping ring further back down the road
  }
  // a fight starts from its trigger, facing into the arena
  let stand = { ...spot, yaw: here.yaw };
  if (fight) {
    const t = standAt(fight.trigger.x, fight.trigger.z, 6) || spot;
    const into = Math.hypot(fight.arena.x - t.x, fight.arena.z - t.z) > 1 ? Math.atan2(fight.arena.x - t.x, fight.arena.z - t.z) : along(zone, t.x, t.z).yaw;
    stand = { ...t, yaw: into };
  }
  // respawn at the last lamp before here that is not past a fight still to be fought
  const standP = along(zone, stand.x, stand.z).p;
  const won = new Set(clear);
  const nextFight = Math.min(...ENCOUNTERS.filter((e) => !won.has(e.id)).map((e) => trigP[e.id]));
  let checkpoint = CHECKPOINTS[0].id;
  for (const c of CHECKPOINTS) if (cpP[c.id] <= standP + 0.5 && cpP[c.id] <= nextFight) checkpoint = c.id;
  return {
    x: stand.x, z: stand.z, yaw: stand.yaw, zone,
    clicked: { x, z }, snapped: Math.hypot(spot.x - x, spot.z - z),
    clear, fight, wonHere, checkpoint,
    skipped: clear.length,
  };
}
