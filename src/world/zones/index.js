import z0 from './z0-waterfall.js';
import z1 from './z1-village.js';
import z2 from './z2-bamboo.js';
import z3 from './z3-temple.js';
import z4 from './z4-fortress.js';
import z5 from './z5-castle.js';

/* The journey, in order. Everything the engine knows about the world comes from these six files:
   walkable shapes, water, structures, encounters, gates, checkpoints, camera regions, lighting and ambience. */
export const ZONES = [z0, z1, z2, z3, z4, z5];
export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));
export const WORLD = {
  x0: Math.min(...ZONES.map((z) => z.rect.x0)), x1: Math.max(...ZONES.map((z) => z.rect.x1)),
  z0: Math.min(...ZONES.map((z) => z.rect.z0)), z1: Math.max(...ZONES.map((z) => z.rect.z1)),
};
export const CHECKPOINTS = ZONES.flatMap((z) => z.checkpoints.map((c) => ({ ...c, zone: z.index })));
export const ENCOUNTERS = ZONES.flatMap((z) => z.encounters.map((e) => ({ ...e, zone: z.index })));
export const GATES = ZONES.flatMap((z) => z.structures.filter((s) => s.type === 'gate').map((g) => ({ ...g, zone: z.index })));
