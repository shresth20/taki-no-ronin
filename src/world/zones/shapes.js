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
/** A spot on the verge of a path, for lanterns and the like, so they line the way instead of standing in it.
    pts: the path's points ([x, z, ...]), w: its walkable width. `at`: metres along the path from its first point
    (negative: back from its last). `side`: +1 = right of the direction of travel, -1 = left. `gap`: how far past the
    path's edge the thing's centre stands. `ahead` slides it on along the path's last (or first) direction past its end.
    Returns { x, z, rot }, turned to face the path's centre line.                                                     */
export function beside(pts, w, at, side, gap, ahead = 0) {
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); total += l; }
  let d = at < 0 ? total + at : at, i = 0;
  while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
  const a = pts[i], b = pts[i + 1], ux = (b[0] - a[0]) / seg[i], uz = (b[1] - a[1]) / seg[i];
  const rx = -uz * side, rz = ux * side, o = w / 2 + gap; // (rx, rz): out to the chosen side
  const x = a[0] + ux * (d + ahead) + rx * o, z = a[1] + uz * (d + ahead) + rz * o;
  return { x: +x.toFixed(2), z: +z.toFixed(2), rot: +Math.atan2(-rx, -rz).toFixed(3) };
}
const DEG = Math.PI / 180;
/** light preset: angles in degrees, azimuth measured from +Z toward +X */
export const light = (o) => ({ ...o, sun: [o.sun[0] * DEG, o.sun[1] * DEG] });
