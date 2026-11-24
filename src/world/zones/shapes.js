/* Tiny constructors so zone files read like a level sheet.
   Coordinates are world metres: +X east, +Z south, Y up. `rot` is a yaw in radians; an object's front faces +Z at rot 0. */
export const circle = (x, z, r, y, o = {}) => ({ t: 'circle', x, z, r, y, ...o });
export const box = (x, z, w, d, y, rot = 0, o = {}) => ({ t: 'box', x, z, w, d, y, rot, ...o });
/** pts: [x, z, y] per vertex. w = full walkable width. */
export const path = (pts, w, o = {}) => ({ t: 'path', pts, w, ...o });
export const deck = (pts, w, kind = 'wood', o = {}) => ({ t: 'path', pts, w, deck: kind, ...o });
export const stairs = (pts, w, o = {}) => ({ t: 'path', pts, w, stairs: true, ...o });
/** water: a channel following pts [x, z]; y = surface level */
export const river = (pts, w, y, o = {}) => ({ t: 'river', pts, w, y, depth: 1.1, bank: 2.2, ...o });
export const pond = (x, z, r, y, o = {}) => ({ t: 'pond', x, z, r, y, depth: 0.8, bank: 1.4, ...o });
/** yaw that faces from (x,z) toward (tx,tz) */
export const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
const DEG = Math.PI / 180;
/** light preset: angles in degrees, azimuth measured from +Z toward +X */
export const light = (o) => ({ ...o, sun: [o.sun[0] * DEG, o.sun[1] * DEG] });
