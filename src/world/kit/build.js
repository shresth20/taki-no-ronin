import * as THREE from 'three';
import { MAT, Parts, addRoof, roofGeo, boxG, cylG, coneG, sphG, torusG, clothQuad } from './core.js';
import { HOUSE, GATE, local, rockCluster, wallSegments } from '../zones/footprints.js';
import { mulberry32 } from '../../core/util.js';

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
function paperLantern(c, x, y, z, s = 1, col = GLOW) {
  c.glow.at(x, y, z).cyl(0.2 * s, 0.2 * s, 0.42 * s, 0, 0, 0, col, 0, { n: 8 });
  c.P.at(x, y, z).cyl(0.14 * s, 0.21 * s, 0.07 * s, 0, 0.24 * s, 0, K.black).cyl(0.21 * s, 0.14 * s, 0.07 * s, 0, -0.24 * s, 0, K.black);
  c.lights.push({ x, y, z, i: 0.9 });
}
function stoneLantern(c, s, y) {
  const k = s.big ? 1.5 : 1, st = s.mossy ? '#8a9a84' : K.stone, sd = s.mossy ? '#6d7f6c' : K.stoneD;
  const P = c.P.at(s.x, y - 0.05, s.z, hash(s.x, s.z) * 6.28, k);
  P.cyl(0.42, 0.5, 0.22, 0, 0.11, 0, sd, MAT.plain, { n: 6 }).cyl(0.14, 0.17, 0.95, 0, 0.68, 0, st, MAT.plain, { n: 6 }).cyl(0.36, 0.2, 0.16, 0, 1.22, 0, sd, MAT.plain, { n: 6 });
  P.box(0.44, 0.42, 0.44, 0, 1.5, 0, st).add(coneG(0.62, 0.38, 6), 0, 1.9, 0, sd).add(sphG(0.1), 0, 2.14, 0, st);
  if (s.mossy) P.add(sphG(0.3, 6, 4), 0.1, 1.98, 0.05, K.moss, 0, { sy: 0.35 });
  c.glow.at(s.x, y - 0.05, s.z, 0, k).box(0.3, 0.26, 0.46, 0, 1.5, 0, GLOW).box(0.46, 0.26, 0.3, 0, 1.5, 0, GLOW);
  c.lights.push({ x: s.x, y: y + 1.5 * k, z: s.z, i: s.big ? 1.2 : 0.8 });
}
function post(P, x, z, h, r = 0.09, col = K.woodD) { P.box(r * 2, h, r * 2, x, h / 2, z, col); }

/* ---------- houses ---------- */
function house(s, c) {
  const h = HOUSE[s.kind], y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  const t = 0.9 + hash(s.x, s.z) * 0.18, y0 = 0.42, wh = h.h, zf = h.d / 2;
  const wall = h.kura ? '#f0ebdf' : shade(K.plaster, t), wood = shade(K.woodD, 0.9 + hash(s.x, s.z, 2) * 0.3);
  P.box(h.w + 0.5, 0.5, h.d + 0.5, 0, 0.17, 0, K.stoneD, MAT.stone);
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
    for (let i = 0; i < 4; i++) P.box(0.14, wh - 0.1, 0.14, -h.w * 0.44 + (h.w * 0.88 * i) / 3, y0 + (wh - 0.1) / 2, zf + 1.25, wood);
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
  if (s.lantern) { const [lx, lz] = local(s, h.w * 0.36, zf + 1.3); paperLantern(c, lx, y + y0 + wh - 0.75, lz, 1.1, s.kind === 'inn' ? GLOW_RED : GLOW); }
  else if (!h.kura) { const [lx, lz] = local(s, 0, zf + 0.6); c.lights.push({ x: lx, y: y + 1.6, z: lz, i: 0.5 }); }
  if (s.noren) {
    const dx = (hash(s.x, s.z, 4) - 0.5) * h.w * 0.25;
    const [ox, oz] = local(s, dx - 1.0, zf + 0.16), cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    for (let i = 0; i < 3; i++) clothQuad(c.cloth, ox + cr * 0.67 * i, y + y0 + 2.05, oz - sr * 0.67 * i, cr, -sr, 0.64, 0.8, s.noren, { fixed: 'top', seg: 3, emblem: i === 1 ? 3 : 0, phase: hash(s.x, s.z, i) });
  }
}
function mill(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.box(7, 0.9, 6, 0, 0.2, 0, K.stoneD, MAT.stone).box(6.4, 3.0, 5.4, 0, 2.1, 0, shade(K.wood, 0.95), MAT.plank, { uv: 'h', grad: [0.8, 1.05] });
  P.box(1.5, 1.9, 0.1, 1.2, 1.6, 2.75, K.woodD, MAT.plank, { uv: 'h' }).box(1.3, 0.8, 0.08, -1.4, 2.4, 2.74, K.paper, MAT.paper);
  addRoof(P, { w: 8.4, d: 7.6, h: 2.8, ridge: 3.4, lift: 0.1, curve: 1.2 }, 0, 3.55, 0, K.thatch, { mat: MAT.thatch });
  // axle out of the west wall, wheel turning in the channel
  P.cyl(0.18, 0.18, 2.6, -4.3, 1.75, 0.3, K.woodD, 0, { rz: Math.PI / 2 });
  P.box(0.3, 2.2, 0.3, -5.5, 0.6, 1.5, K.woodD).box(0.3, 2.2, 0.3, -5.5, 0.6, -0.9, K.woodD);
  P.box(2.6, 0.12, 0.7, -4.4, 3.5, 0.3, K.wood, MAT.plank, { uv: 'xz', rz: -0.12 }); // flume
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
    c.lights.push({ x: s.x, y: y + py + 2.4, z: s.z + d / 2 + 2.5, i: 1.4 });
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
  paperLantern(c, lx, y + 2.9, lz, 1.2, GLOW_RED);
}
function hut(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.box(4.6, 2.6, 3.6, 0, 1.3, 0, K.wood, MAT.plank, { uv: 'h', grad: [0.8, 1.05] }).box(1.2, 1.9, 0.1, 0.8, 0.95, 1.82, K.black);
  addRoof(P, { w: 6, d: 5, h: 1.6, ridge: 6, lift: 0.1 }, 0, 2.6, 0, K.tileD, { wall: K.wood });
}
function pavilion(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.box(5, 0.4, 5, 0, 0.1, 0, K.stone, MAT.stone).box(4.6, 0.12, 4.6, 0, 0.42, 0, K.wood, MAT.plank, { uv: 'xz' });
  for (const [x, z] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) P.cyl(0.14, 0.16, 2.9, x, 1.9, z, K.redD, 0, { n: 8 });
  P.box(4.3, 0.2, 0.2, 0, 3.3, 1.9, K.woodD).box(4.3, 0.2, 0.2, 0, 3.3, -1.9, K.woodD).box(0.2, 0.2, 4.3, 1.9, 3.3, 0, K.woodD).box(0.2, 0.2, 4.3, -1.9, 3.3, 0, K.woodD);
  addRoof(P, { w: 7, d: 7, h: 2.6, ridge: 0, lift: 0.7, curve: 1.7 }, 0, 3.4, 0, K.tile, { ridgeCap: false });
  P.add(sphG(0.22), 0, 6.1, 0, K.gold, MAT.metal);
  paperLantern(c, s.x, y + 2.7, s.z, 1.1);
}
function pagoda(s, c) {
  const y = c.Y(s.x, s.z), k = s.s || 1, P = c.P.at(s.x, y, s.z, s.rot || 0, k);
  P.box(9.4, 1.2, 9.4, 0, 0.3, 0, K.stone, MAT.stone);
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
function statue(s, c) {
  const y = c.Y(s.x, s.z), k = s.s || 1, P = c.P.at(s.x, y, s.z, s.rot, k), st = '#8e9a94', sd = '#75827c';
  P.cyl(2.7, 3.0, 0.8, 0, 0.4, 0, sd, MAT.stone, { n: 8 }).cyl(2.1, 2.5, 0.6, 0, 1.1, 0, st, MAT.plain, { n: 12 });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; P.add(sphG(0.62, 6, 5), Math.sin(a) * 2.05, 1.5, Math.cos(a) * 2.05, st, 0, { sy: 0.7, sx: 0.8, ry: a }); }
  P.add(sphG(1.6, 10, 8), 0, 2.0, 0.15, st, 0, { sy: 0.42, sx: 1.25 }); // crossed legs
  P.add(sphG(1.15, 10, 8), 0, 3.25, -0.1, st, 0, { sy: 1.25 }); // torso
  P.add(sphG(0.5, 8, 6), -1.05, 3.35, 0.2, st, 0, { sy: 1.5 }).add(sphG(0.5, 8, 6), 1.05, 3.35, 0.2, st, 0, { sy: 1.5 }); // arms
  P.add(sphG(0.42, 8, 6), 0, 2.55, 0.95, st, 0, { sx: 1.5, sy: 0.6 }); // hands in the lap
  P.add(sphG(0.72, 10, 8), 0, 5.05, 0, st).add(sphG(0.3, 8, 6), 0, 5.75, -0.05, sd).add(sphG(0.14, 6, 5), -0.74, 4.95, 0, sd, 0, { sy: 2.2 }).add(sphG(0.14, 6, 5), 0.74, 4.95, 0, sd, 0, { sy: 2.2 });
  P.add(torusG(1.5, 0.12, 6, 20), 0, 5.0, -0.5, K.gold, MAT.metal).add(cylG(1.42, 1.42, 0.06, 20), 0, 5.0, -0.52, '#6f7c78', 0, { rx: Math.PI / 2 });
  P.add(sphG(0.9, 6, 5), -0.5, 3.9, -0.1, K.moss, 0, { sy: 0.2, sx: 1.2 });
}
function belltower(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.box(5, 1.0, 5, 0, 0.3, 0, K.stone, MAT.stone);
  for (const [x, z] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) P.cyl(0.2, 0.26, 4.2, x * 1, 2.9, z, K.woodD, 0, { n: 8, rz: -x * 0.03, rx: z * 0.03 });
  P.box(4, 0.3, 0.3, 0, 4.7, 1.6, K.woodD).box(4, 0.3, 0.3, 0, 4.7, -1.6, K.woodD).box(0.3, 0.3, 4, 1.6, 4.7, 0, K.woodD).box(0.3, 0.3, 4, -1.6, 4.7, 0, K.woodD);
  addRoof(P, { w: 7, d: 7, h: 2.6, ridge: 2.2, lift: 0.7 }, 0, 4.9, 0, K.tile);
  P.cyl(0.72, 0.9, 1.6, 0, 3.4, 0, K.bronze, MAT.metal, { n: 12 }).add(sphG(0.72, 10, 6), 0, 4.2, 0, K.bronze, MAT.metal, { sy: 0.6 }).cyl(0.92, 0.94, 0.14, 0, 2.62, 0, shade(K.bronze, 0.8), MAT.metal, { n: 12 });
  P.cyl(0.14, 0.14, 2.6, 1.7, 3.2, 0, K.wood, 0, { rz: Math.PI / 2 });
}
function shrine(s, c) {
  const y = c.Y(s.x, s.z), k = s.s || 1, P = c.P.at(s.x, y, s.z, s.rot, k), st = s.mossy ? '#84957f' : K.stone;
  P.box(1.9, 0.5, 1.7, 0, 0.2, 0, st, MAT.stone).box(1.3, 0.2, 1.1, 0, 0.55, 0, K.stoneD);
  P.box(1.0, 1.0, 0.8, 0, 1.15, 0, K.wood, MAT.plank, { uv: 'h' }).box(0.5, 0.7, 0.06, 0, 1.1, 0.42, K.woodD).box(0.62, 0.06, 0.06, 0, 1.5, 0.44, K.gold);
  addRoof(P, { w: 1.9, d: 1.7, h: 0.75, ridge: 1.9, lift: 0.1, segU: 3, segV: 3 }, 0, 1.65, 0, s.mossy ? '#4d6a52' : K.tileD, { wall: K.wood });
  P.add(torusG(0.34, 0.045, 5, 10, Math.PI), 0, 1.72, 0.5, K.rope, 0, { rz: Math.PI });
  for (const dx of [-0.2, 0, 0.2]) P.box(0.07, 0.2, 0.01, dx, 1.5, 0.52, '#ffffff');
  if (!s.mossy) P.box(0.7, 0.4, 0.4, 0, 0.6, 1.0, K.woodD, MAT.plank, { uv: 'h' });
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
    const P = c.P.at(s.x, y, s.z, hash(s.x, s.z) * 6.28);
    P.box(0.16, 2.9, 0.16, 0, 1.45, 0, K.woodD).box(0.9, 0.1, 0.1, 0.36, 2.75, 0, K.woodD).box(0.4, 0.06, 0.4, 0, 2.95, 0, K.woodD);
    const [lx, lz] = local({ x: s.x, z: s.z, rot: hash(s.x, s.z) * 6.28 }, 0.7, 0);
    paperLantern(c, lx, y + 2.35, lz, 1.0);
  } else if (s.kind === 'yukimi') {
    const P = c.P.at(s.x, y, s.z, hash(s.x, s.z) * 6.28);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.283; P.box(0.14, 0.6, 0.14, Math.sin(a) * 0.34, 0.26, Math.cos(a) * 0.34, K.stoneD, 0, { rz: Math.sin(a) * 0.3, rx: -Math.cos(a) * 0.3 }); }
    P.cyl(0.44, 0.4, 0.12, 0, 0.6, 0, K.stone, 0, { n: 6 }).box(0.4, 0.34, 0.4, 0, 0.83, 0, K.stone).add(coneG(0.95, 0.34, 6), 0, 1.17, 0, K.stoneD).add(sphG(0.09), 0, 1.38, 0, K.stone);
    c.glow.at(s.x, y, s.z).box(0.28, 0.2, 0.42, 0, 0.83, 0, GLOW).box(0.42, 0.2, 0.28, 0, 0.83, 0, GLOW);
    c.lights.push({ x: s.x, y: y + 0.9, z: s.z, i: 0.6 });
  } else stoneLantern(c, s, y);
}
function torii(s, c) {
  const y = c.Y(s.x, s.z), k = s.s || 1, P = c.P.at(s.x, y - 0.1, s.z, s.rot, k), cap = '#35303a';
  for (const sx of [-1, 1]) P.cyl(0.25, 0.3, 5.3, sx * 2.5, 2.65, 0, K.red, 0, { n: 12, rz: sx * -0.035 }).cyl(0.4, 0.44, 0.5, sx * 2.58, 0.25, 0, K.black, 0, { n: 12 });
  P.box(6.6, 0.34, 0.34, 0, 4.05, 0, K.red).box(7.2, 0.4, 0.5, 0, 5.35, 0, K.red).box(4.2, 0.3, 0.72, 0, 5.7, 0, cap);
  for (const sx of [-1, 1]) P.box(2.3, 0.3, 0.72, sx * 3.1, 5.82, 0, cap, 0, { rz: sx * 0.11 });
  P.box(0.3, 1.0, 0.24, 0, 4.7, 0, K.red).box(0.9, 0.62, 0.1, 0, 4.72, 0.16, '#e9dcb4');
}
function gate(s, c) {
  const g = GATE[s.style], y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot), w = s.w, off = w / 2 + g.post[0] / 2, H = g.h;
  const masonry = s.style !== 'village' && s.style !== 'temple';
  for (const sx of [-1, 1]) {
    if (masonry) P.box(g.post[0], H * 0.62, g.post[1], sx * off, H * 0.31 - 0.2, 0, K.stone, MAT.stone, { grad: [0.78, 1.02] });
    else P.cyl(g.post[0] * 0.3, g.post[0] * 0.34, H * 0.8, sx * off, H * 0.4, 0, s.style === 'temple' ? K.red : K.woodD, 0, { n: 10 });
  }
  const top = masonry ? H * 0.62 - 0.2 : H * 0.72, span = w + g.post[0] * 2;
  if (s.style === 'village') {
    P.box(span + 1.2, 0.36, 0.4, 0, top, 0, K.woodD).box(span + 0.4, 0.26, 0.3, 0, top - 0.7, 0, K.woodD);
    addRoof(P, { w: span + 2, d: 2.6, h: 1.0, ridge: span + 2, lift: 0.14, segU: 4 }, 0, top + 0.2, 0, K.tile, { wall: K.woodD });
  } else if (s.style === 'temple') {
    P.box(span + 1.6, 0.5, 2.6, 0, top + 0.1, 0, K.redD).box(span + 0.6, 1.2, 2.0, 0, top + 0.9, 0, K.plaster, MAT.plaster);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.cyl(0.24, 0.28, top, sx * (off + 0.2), top / 2, sz * 1.2, K.red, 0, { n: 10 });
    addRoof(P, { w: span + 5.6, d: 6.6, h: 2.6, ridge: span * 0.7, lift: 0.8 }, 0, top + 1.5, 0, K.tile);
  } else {
    const dark = s.style === 'castle' ? '#f0ebe0' : K.woodD, th = s.style === 'fort' ? 2.4 : 3.0;
    P.box(span + 0.8, 0.6, g.post[1] + 0.4, 0, top + 0.3, 0, K.woodD);
    P.box(span + 0.2, th, g.post[1] - 0.2, 0, top + 0.6 + th / 2, 0, dark, s.style === 'castle' ? MAT.plaster : MAT.plank, { uv: 'h', grad: [0.85, 1.04] });
    const nw = Math.max(3, Math.round(span / 2.2));
    for (let i = 0; i < nw; i++) for (const sz of [-1, 1]) P.box(0.9, 0.6, 0.08, -span / 2 + (span * (i + 0.5)) / nw, top + 0.6 + th * 0.55, sz * (g.post[1] / 2 - 0.08), K.paper, MAT.paper);
    addRoof(P, { w: span + 3.4, d: g.post[1] + 3, h: s.style === 'fort' ? 2.2 : 3.0, ridge: span * 0.72, lift: 0.6 }, 0, top + 0.6 + th, 0, K.tileD);
    if (s.style !== 'fort') for (const sx of [-1, 1]) P.add(coneG(0.26, 1.0, 5), sx * (span * 0.36 + 0.3), top + 0.6 + th + (s.style === 'fort' ? 2.2 : 3.0) + 0.5, 0, K.gold, MAT.metal, { rz: sx * -0.5 });
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
    const sh = (top - y) * (kind === 'fort' ? 0.5 : 0.42);
    P.box(L, sh, 1.3, 0, y + sh / 2, 0, K.stone, MAT.stone, { grad: [0.74, 1.02] });
    P.box(L - 0.2, top - y - sh, 0.9, 0, y + sh + (top - y - sh) / 2, 0, kind === 'castle' ? '#efeadf' : '#4a3a33', kind === 'castle' ? MAT.plaster : MAT.plank, { uv: 'h', grad: [0.86, 1.03] });
    const nl = Math.floor(g.len / 3.2);
    for (let i = 0; i < nl; i++) P.box(0.28, 0.6, 0.95, -g.len / 2 + (g.len * (i + 0.5)) / nl, top - 1.1, 0, K.black);
    addRoof(P, { w: L + 0.5, d: 2.0, h: 0.7, ridge: L + 0.5, lift: 0.04, segU: 2, segV: 2 }, 0, top, 0, K.tileD, { wall: K.woodD, ridgeCap: false });
    P.box(L + 0.5, 0.16, 0.24, 0, top + 0.72, 0, '#2c383e');
  }
}
function tower(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot || 0);
  if (s.kind === 'watch') {
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) P.box(0.24, 7, 0.24, x, 3.5, z, K.woodD, 0, { rz: -x * 0.035, rx: z * 0.035 });
    P.box(3.4, 0.2, 3.4, 0, 6.6, 0, K.wood, MAT.plank, { uv: 'xz' }).box(3.3, 0.9, 0.1, 0, 7.15, 1.6, K.woodD, MAT.plank, { uv: 'h' }).box(3.3, 0.9, 0.1, 0, 7.15, -1.6, K.woodD, MAT.plank, { uv: 'h' }).box(0.1, 0.9, 3.3, 1.6, 7.15, 0, K.woodD, MAT.plank, { uv: 'h' }).box(0.1, 0.9, 3.3, -1.6, 7.15, 0, K.woodD, MAT.plank, { uv: 'h' });
    for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) P.box(0.16, 2.2, 0.16, x, 7.8, z, K.woodD);
    addRoof(P, { w: 5, d: 5, h: 1.5, ridge: 0, lift: 0.4 }, 0, 8.9, 0, K.tileD, { ridgeCap: false });
    for (let i = 0; i < 8; i++) P.box(0.9, 0.07, 0.07, 1.25, 0.6 + i * 0.75, 1.25, K.wood, 0, { ry: 0.78 });
    P.box(2.6, 0.12, 0.12, 0, 3.2, 1.2, K.woodD, 0, { rz: 0.9 }).box(2.6, 0.12, 0.12, 0, 3.2, -1.2, K.woodD, 0, { rz: -0.9 });
    paperLantern(c, s.x, y + 8.2, s.z, 1.0, GLOW_RED);
    return;
  }
  const bh = 6.2, body = s.tall ? 4.2 : 3.4;
  P.box(6.6, bh + 1, 6.6, 0, bh / 2 - 0.5, 0, K.stone, MAT.stone, { grad: [0.72, 1.02] });
  P.box(5.6, body, 5.6, 0, bh + body / 2, 0, '#efeadf', MAT.plaster, { grad: [0.86, 1.03] }).box(5.7, 1.1, 5.7, 0, bh + 0.55, 0, '#3a302c', MAT.plank, { uv: 'h' });
  for (const [rx, x, z] of [[0, 0, 2.82], [0, 0, -2.82]]) for (const dx of [-1.3, 1.3]) P.box(0.9, 0.7, 0.08, x + dx, bh + body * 0.66, z, K.paper, MAT.paper);
  for (const dz of [-1.3, 1.3]) for (const sx of [-1, 1]) P.box(0.08, 0.7, 0.9, sx * 2.82, bh + body * 0.66, dz, K.paper, MAT.paper, { uv: 'zy' });
  let ry = bh + body;
  if (s.tall) {
    addRoof(P, { w: 8, d: 8, h: 1.3, ridge: 5, lift: 0.5, curve: 1.3 }, 0, ry, 0, K.tileD, { ridgeCap: false });
    P.box(4, 2.6, 4, 0, ry + 1.9, 0, '#efeadf', MAT.plaster);
    for (const dz of [-1, 1]) P.box(1.4, 0.7, 0.08, 0, ry + 2.2, dz * 2.02, K.paper, MAT.paper);
    ry += 3.2;
    addRoof(P, { w: 6.4, d: 6.4, h: 2.4, ridge: 2.2, lift: 0.6 }, 0, ry, 0, K.tileD);
  } else addRoof(P, { w: 8, d: 8, h: 2.5, ridge: 2.8, lift: 0.6 }, 0, ry, 0, K.tileD);
  c.lights.push({ x: s.x, y: y + bh + 2, z: s.z, i: 0.5 });
}
function keep(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot || 0, s.s || 1), wallC = '#2b2d36', trim = K.gold;
  // battered stone base
  const base = cylG(0.72, 1, 1, 4, false);
  P.add(base, 0, 4.5, 0, '#8a938d', MAT.stone, { ry: Math.PI / 4, sx: 23, sy: 11, sz: 19.5, grad: [0.7, 1.02] });
  let yy = 10;
  const tiers = [[25, 20, 4.6], [20, 16, 4.0], [15.5, 12.5, 3.8], [11.5, 9.5, 3.6], [8, 7, 3.8]];
  tiers.forEach(([w, d, h], i) => {
    P.box(w, h, d, 0, yy + h / 2, 0, wallC, MAT.plaster, { grad: [0.8, 1.1] }).box(w + 0.2, 0.5, d + 0.2, 0, yy + h - 0.25, 0, '#ece6d8', MAT.plaster).box(w + 0.16, 1.2, d + 0.16, 0, yy + 0.6, 0, '#1c1d24', MAT.plank, { uv: 'h' });
    const nw = Math.max(2, Math.round(w / 2.6));
    for (let k = 0; k < nw; k++) for (const sz of [-1, 1]) P.box(0.9, 1.0, 0.1, -w / 2 + (w * (k + 0.5)) / nw, yy + h * 0.58, sz * (d / 2 + 0.03), '#ffb38a', MAT.paper);
    const nd = Math.max(2, Math.round(d / 2.8));
    for (let k = 0; k < nd; k++) for (const sx of [-1, 1]) P.box(0.1, 1.0, 0.9, sx * (w / 2 + 0.03), yy + h * 0.58, -d / 2 + (d * (k + 0.5)) / nd, '#ffb38a', MAT.paper, { uv: 'zy' });
    yy += h;
    const last = i === tiers.length - 1;
    const rh = last ? 4.2 : 2.0;
    addRoof(P, { w: w + 4.6, d: d + 4.6, h: rh, ridge: last ? w * 0.7 : w * 0.72, lift: last ? 1.1 : 0.9, curve: last ? 1.7 : 1.25, segU: 12, segV: 6 }, 0, yy, 0, K.tileD, { wall: wallC, ridgeCap: last });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(sphG(0.2, 6, 5), sx * (w / 2 + 2.3), yy + (last ? 1.1 : 0.9) + 0.05, sz * (d / 2 + 2.3), trim, MAT.metal);
    if (i < 2) {
      // triangular dormer gables front and back break up the long eaves
      for (const sz of [-1, 1]) {
        const gw = w * 0.36;
        const r = roofGeo({ w: gw, d: 4.2, h: 2.2, ridge: gw, lift: 0, segU: 3, segV: 3 });
        P.add(r.slopes, 0, yy + 0.1, sz * (d / 2 + 1.0), K.tileD, MAT.tile, { ry: Math.PI / 2 }).add(r.gables, 0, yy + 0.1, sz * (d / 2 + 1.0), '#ece6d8', MAT.plaster, { ry: Math.PI / 2 });
        P.add(sphG(0.24, 6, 5), 0, yy + 2.4, sz * (d / 2 + 3.0), trim, MAT.metal);
      }
    }
    if (last) for (const sx of [-1, 1]) P.add(coneG(0.4, 1.7, 5), sx * (w * 0.35 + 0.3), yy + rh + 0.9, 0, trim, MAT.metal, { rz: sx * -0.55 });
    yy += last ? 0 : 1.0;
  });
  c.lights.push({ x: s.x, y: y + 13, z: s.z + 13, i: 1.6, far: true });
}

/* ---------- props ---------- */
function stall(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  for (const [x, z] of [[-1.5, -0.85], [1.5, -0.85], [-1.5, 0.85], [1.5, 0.85]]) P.box(0.12, z > 0 ? 2.1 : 2.6, 0.12, x, z > 0 ? 1.05 : 1.3, z, K.woodD);
  P.box(3.2, 0.12, 1.4, 0, 0.95, 0.3, K.wood, MAT.plank, { uv: 'zx' }).box(3.2, 0.9, 0.08, 0, 0.45, 0.95, K.wood, MAT.plank, { uv: 'h' });
  P.box(3.7, 0.07, 2.6, 0, 2.4, 0.15, s.color, MAT.plain, { rx: 0.26 }).box(3.7, 0.3, 0.05, 0, 2.02, 1.4, shade(s.color, 0.8));
  const goods = ['#d9702c', '#c9b23c', '#7fa23c', '#b3392e', '#e6dcc0'];
  for (let i = 0; i < 6; i++) P.add(sphG(0.14, 6, 5), -1.2 + (i % 3) * 0.5 + hash(s.x, s.z, i) * 0.2, 1.12, 0.1 + Math.floor(i / 3) * 0.45, goods[Math.floor(hash(s.x, s.z, i + 7) * goods.length)]);
  P.box(0.7, 0.3, 0.5, 1.1, 1.16, 0.3, K.straw);
}
function well(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, 0.4);
  P.cyl(1.0, 1.05, 0.9, 0, 0.45, 0, K.stone, MAT.stone, { n: 10 }).cyl(0.78, 0.78, 0.06, 0, 0.82, 0, '#1b2a33', 0, { n: 10 });
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
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  post(P, -1.2, 0, 1.7); post(P, 1.2, 0, 1.7);
  P.box(2.6, 0.1, 0.1, 0, 1.55, 0, K.woodD).box(2.6, 0.1, 0.1, 0, 0.5, 0, K.woodD);
  for (let i = 0; i < 5; i++) {
    const x = -0.9 + i * 0.45;
    P.cyl(0.025, 0.025, 2.4, x, 1.25, 0.12, K.woodL, 0, { rx: 0.08 });
    P.add(coneG(0.05, 0.3, 4), x, 2.55, 0.02, '#c9d2d6', MAT.metal, { rx: 0.08 });
  }
}
function barricade(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.cyl(0.12, 0.12, 3.2, 0, 0.75, 0, K.woodD, 0, { n: 6, rz: Math.PI / 2 });
  for (let i = 0; i < 6; i++) for (const sg of [-1, 1]) P.add(coneG(0.09, 1.9, 5), -1.25 + i * 0.5, 0.75, sg * 0.2, K.woodL, 0, { rx: sg * 0.75 });
}
function tent(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot), col = hash(s.x, s.z) > 0.5 ? '#c9bea2' : '#b7ad92';
  const r = roofGeo({ w: 4.4, d: 4.0, h: 2.5, ridge: 4.4, lift: 0, curve: 1.05, segU: 2, segV: 3 });
  P.add(r.slopes, 0, 0.05, 0, col, MAT.plain).add(r.under, 0, 0.05, 0, shade(col, 0.6)).add(r.gables, 0, 0.05, 0, shade(col, 0.82));
  P.box(4.5, 0.1, 0.1, 0, 2.58, 0, K.woodD).box(0.9, 1.6, 0.06, 0, 0.8, 2.01, K.black).box(4.42, 0.5, 0.02, 0, 1.3, 1.2, '#a51d22', 0, { rx: -0.9 });
}
function fire(c, x, y, z, size, light = 1.2) {
  c.sprites.push({ x, y, z, size, kind: 'flame' }, { x, y: y + size * 0.3, z, size: size * 0.55, kind: 'flame' }, { x, y: y + size * 0.4, z, size: 0.16, kind: 'ember' }, { x, y: y + size * 0.2, z, size: 0.12, kind: 'ember' });
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
  P.cyl(0.8, 0.55, 0.7, 0, 1.15, 0, K.bronze, MAT.metal, { n: 10 }).cyl(0.7, 0.7, 0.04, 0, 1.48, 0, '#c9c2b0', 0, { n: 10 });
  c.sprites.push({ x: s.x, y: y + 1.6, z: s.z, size: 0.9, kind: 'smoke' }, { x: s.x + 0.2, y: y + 1.6, z: s.z, size: 0.7, kind: 'smoke' });
}
function fallen(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot), n = s.low ? 2 : 3;
  for (let i = 0; i < n; i++) P.cyl(0.07, 0.09, s.len * (0.8 + hash(s.x, s.z, i) * 0.3), (i - 1) * 0.22, 0.2 + i * 0.16, (hash(s.x, s.z, i + 4) - 0.5) * 0.8, shade('#8fb04a', 0.75 + hash(s.x, s.z, i + 2) * 0.35), 0, { n: 6, rx: Math.PI / 2 + (hash(s.x, s.z, i + 6) - 0.5) * 0.12, ry: (hash(s.x, s.z, i + 8) - 0.5) * 0.3 });
}
function checkpoint(s, c) {
  // a wayside spirit lamp: where the journey is remembered
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z, s.rot);
  P.cyl(0.42, 0.5, 0.3, 0, 0.15, 0, K.stoneD, MAT.stone, { n: 6 }).cyl(0.13, 0.16, 1.1, 0, 0.85, 0, K.stone, 0, { n: 6 }).cyl(0.4, 0.2, 0.14, 0, 1.46, 0, K.stoneD, 0, { n: 6 });
  P.add(coneG(0.56, 0.36, 6), 0, 2.2, 0, K.stoneD).add(torusG(0.2, 0.03, 5, 10), 0, 1.0, 0, K.rope, 0, { rx: Math.PI / 2 });
  for (let i = 0; i < 4; i++) P.box(0.05, 0.36, 0.05, Math.sin(i * 1.57) * 0.3, 1.78, Math.cos(i * 1.57) * 0.3, K.stone);
  c.marks.push({ x: s.x, y: y + 1.62, z: s.z });
}
function garden(s, c) {
  const y = c.Y(s.x, s.z), P = c.P.at(s.x, y, s.z);
  P.cyl(s.r, s.r, 0.06, 0, 0.04, 0, '#d9d4c4', 0, { n: 20 });
  for (let i = 1; i < 4; i++) P.add(torusG((s.r * i) / 4, 0.035, 4, 24), 0, 0.075, 0, '#bfb9a6', 0, { rx: Math.PI / 2 });
  c.rocks.push({ x: s.x, y: y - 0.2, z: s.z, sx: 0.9, sy: 0.9, sz: 0.7, a: 1 }, { x: s.x + s.r * 0.45, y: y - 0.15, z: s.z - s.r * 0.3, sx: 0.5, sy: 0.4, sz: 0.5, a: 2 });
}
function emblem(s, c) {
  // the arena floor: concentric rings and the clan mark, flush with the paving
  const y = c.Y(s.x, s.z) + 0.03, P = c.P.at(s.x, y, s.z);
  P.cyl(s.r, s.r, 0.04, 0, 0, 0, '#2a2c34', 0, { n: 40 }).cyl(s.r * 0.9, s.r * 0.9, 0.05, 0, 0.005, 0, '#8e1c22', 0, { n: 40 }).cyl(s.r * 0.78, s.r * 0.78, 0.06, 0, 0.01, 0, '#23242b', 0, { n: 40 });
  P.cyl(s.r * 0.42, s.r * 0.42, 0.07, 0, 0.015, 0, K.gold, MAT.metal, { n: 32 }).cyl(s.r * 0.36, s.r * 0.36, 0.08, 0, 0.02, 0, '#8e1c22', 0, { n: 32 });
  for (const sx of [-1, 1]) P.add(coneG(s.r * 0.11, s.r * 0.5, 3), sx * s.r * 0.17, 0.04, s.r * 0.03, '#23242b', 0, { rx: Math.PI / 2, sz: 0.2 });
  for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.283; P.box(0.22, 0.07, s.r * 0.3, Math.sin(a) * s.r * 0.6, 0.012, Math.cos(a) * s.r * 0.6, K.gold, MAT.metal, { ry: a }); }
}
const smoke = (s, c) => { const y = c.Y(s.x, s.z) + s.h; for (let i = 0; i < 3; i++) c.sprites.push({ x: s.x, y, z: s.z, size: 1.3, kind: 'smoke' }); };
function embers(s, c) {
  const rnd = mulberry32(Math.floor(s.x * 7 + s.z));
  for (let i = 0; i < 26; i++) { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * s.r; c.sprites.push({ x: s.x + Math.cos(a) * d, y: c.Y(s.x, s.z) + rnd() * 2, z: s.z + Math.sin(a) * d, size: 0.13, kind: 'ember' }); }
}
function clouds(s, c) {
  // a sea of cloud lying in the valleys round the plateau: never over ground you can walk on
  const rnd = mulberry32(99);
  for (let i = 0, t = 0; i < 44 && t < 900; t++) {
    const a = rnd() * 6.283, d = 30 + rnd() * s.r, x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
    if (c.W(x, z) < 20 || c.T(x, z) > s.y - 5 || (s.zMax !== undefined && z > s.zMax)) continue;
    c.sprites.push({ x, y: s.y + (rnd() - 0.5) * 6, z, size: 24 + rnd() * 20, kind: 'cloud', aspect: 1.9 });
    i++;
  }
}
function rocks(s, c) {
  for (const r of rockCluster(s)) c.rocks.push({ x: r.x, y: c.Y(r.x, r.z) - r.r * r.sy * 0.3, z: r.z, sx: r.r, sy: r.r * r.sy, sz: r.r * 0.9, a: r.a });
}

export const BUILD = {
  house, mill, hall: (s, c) => hall(s, c, false), temple: (s, c) => hall(s, c, true), barracks, hut, pavilion, pagoda, statue, belltower, shrine, jizo, lantern, torii, gate, wall, tower, keep,
  stall, well, crates, barrels, baskets, cart, woodpile, haystack, scarecrow, signpost, rack, barricade, tent, brazier, torch, banner, drum, curtain, censer, fallen, checkpoint, garden, emblem,
  smoke, embers, clouds, rocks,
};

/* ---------- bridges and stairs are built from the walk shapes themselves ---------- */
const DECK = {
  wood: { deck: '#7a5a40', rail: K.woodD, post: K.woodD, cap: null, railH: 1.0 },
  board: { deck: '#7d6045', rail: K.woodD, post: K.woodD, cap: null, railH: 0.95 },
  red: { deck: '#5a4034', rail: K.red, post: K.red, cap: K.gold, railH: 1.15 },
  stone: { deck: '#a3aaa2', rail: '#8f9891', post: '#7e8881', cap: null, railH: 0.7 },
};
export function bridge(shape, c) {
  const st = DECK[shape.deck], pts = shape.pts, w = shape.w + 0.5, P = c.P.at(0, 0, 0);
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
      if (i % 2 === 0) {
        const main = i % 6 === 0;
        P.box(main ? 0.2 : 0.11, st.railH + (main ? 0.3 : 0.05), main ? 0.2 : 0.11, a.x + ox, a.y + (st.railH + 0.2) / 2 - 0.1, a.z + oz, st.post, 0, { ry });
        if (main && st.cap) P.add(sphG(0.14, 6, 5), a.x + ox, a.y + st.railH + 0.36, a.z + oz, st.cap, MAT.metal, { sy: 1.3 }).box(0.24, 0.1, 0.24, a.x + ox, a.y + st.railH + 0.18, a.z + oz, K.black, 0, { ry });
      }
    }
    // piles down to the bed / gorge floor
    const every = shape.long ? 8 : shape.deck === 'board' ? 3 : 5;
    if (!stone && i % every === Math.floor(every / 2)) {
      const gy = c.T(mx, mz) - 0.6, hgt = my - gy;
      if (hgt > 0.5) for (const sx of [-1, 1]) {
        const ox = Math.cos(ry) * sx * (w / 2 - 0.3), oz = -Math.sin(ry) * sx * (w / 2 - 0.3), sp = shape.long ? sx * 0.12 : 0;
        P.box(shape.long ? 0.5 : 0.22, hgt, shape.long ? 0.5 : 0.22, mx + ox * (1 + (shape.long ? 0.5 : 0)), gy + hgt / 2, mz + oz * (1 + (shape.long ? 0.5 : 0)), shape.long ? K.redD : st.post, 0, { ry, rz: sp });
        if (shape.long) for (let k = 1; k < hgt / 5; k++) P.box(w + 1.6, 0.3, 0.3, mx, my - k * 5, mz, K.redD, 0, { ry });
      }
    }
    if (stone && i === Math.floor(n / 2)) P.add(torusG(shape.w * 0.5, 0.5, 6, 12, Math.PI), mx, my - 1.2, mz, st.post, MAT.stone, { ry: ry + Math.PI / 2, sz: 3.2 });
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
