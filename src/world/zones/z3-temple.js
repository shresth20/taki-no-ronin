import { circle, box, path, deck, stairs, river, light } from './shapes.js';

/* ZONE 03 — Unkai-ji, the temple above the sea of clouds.
   A long stone stair climbs a mountain spur to a walled plateau. The red bridge to the fortress leaves from its east gate. */
const AX = 222; // the temple axis runs due north
const COURT = { x: AX, z: 6, r: 17 };
const stairLanterns = [];
for (const [z0, z1, y0, y1] of [[86, 66, 3.8, 12.5], [50, 31, 12.5, 21.5]]) {
  for (let i = 0; i < 4; i++) {
    const z = z0 + ((z1 - z0) * (i + 0.5)) / 4;
    for (const s of [-1, 1]) stairLanterns.push({ type: 'lantern', x: AX + s * 4.5, z, kind: 'stone', y: y0 + ((y1 - y0) * (i + 0.5)) / 4 });
  }
}

export default {
  id: 'temple',
  index: 3,
  name: 'Unkai-ji',
  kanji: '雲海寺',
  sub: 'The temple above the clouds',
  rect: { x0: 130, x1: 302, z0: -84, z1: 100 },
  entry: { x: AX, z: 97, yaw: Math.PI },
  exit: { x: 300, z: 8 },
  ground: { edge: 'drop', slope: 3.2, shoulder: 1.4, floor: 1.6, base: 1.6, noise: 1.6, palette: 'mountain' },
  boundary: 'balustrade',
  objective: 'Climb to Unkai-ji and cross to the fortress',
  route: [[AX, 100], [AX, 88], [AX, 65], [AX, 51], [AX, 29.5], [AX, 6], [245, 6], [256, 7], [266.5, 8], [284, 8], [302.5, 8]],
  landmark: { x: AX, z: -30, icon: 'temple' },
  reveal: { cam: [AX + 3.4, 5.0, 113], to: [AX + 1.4, 5.8, 103.5], look: [AX, 9, 80], lookTo: [AX, 19, 34], fov: 48, dur: 5.0 },

  // ground that is shaped but not walkable: the plateau the halls stand on
  pads: [box(AX, -10, 74, 86, 21.5, 0), box(AX, 58, 26, 20, 12.5, 0, { edge: { mode: 'drop', slope: 1.1, shoulder: 1.5 } })],
  walk: [
    path([[AX, 100, 3.5], [AX, 88, 3.8]], 6, { surface: 'paved', edge: { mode: 'drop', slope: 0.7, shoulder: 3 } }),
    stairs([[AX, 88, 3.8], [AX, 65, 12.5]], 7, { id: 'stair-1', edge: { mode: 'drop', slope: 0.85, shoulder: 2.2 } }),
    box(AX, 58, 20, 14, 12.5, 0, { id: 'landing', surface: 'paved', edge: { mode: 'drop', slope: 1.1, shoulder: 1.5 } }),
    stairs([[AX, 51, 12.5], [AX, 29.5, 21.5]], 7, { id: 'stair-2', edge: { mode: 'drop', slope: 0.85, shoulder: 2.2 } }),
    box(AX, 6, 46, 44, 21.5, 0, { id: 'court', surface: 'paved' }),
    stairs([[AX, -16, 21.5], [AX, -22.5, 23.6]], 11, { id: 'hall-steps' }),
    box(AX, -25.4, 21, 5, 23.6, 0, { id: 'veranda', surface: 'wood' }),
    path([[245, 6, 21.5], [256, 7, 21.5], [266.5, 8, 21.6]], 5, { surface: 'paved' }),
    deck([[266, 8, 21.6], [275, 8, 22.7], [284, 8, 23.1], [293, 8, 22.8], [302.5, 8, 22]], 4.2, 'red', { id: 'sky-bridge', long: true }),
  ],
  water: [
    river([[290, -84], [285, -44], [283, 0], [285, 40], [284, 80], [283, 102]], 8, 1.56, { id: 'gorge-river', depth: 0.9, bank: 3 }),
    // a spring behind the hall feeds two rills that pour off either side of the plateau
    { t: 'pond', x: AX, z: -50, r: 3.2, y: 21.25, depth: 0.4, bank: 0.8 },
    river([[AX + 2.5, -50], [244, -46.5], [254, -40], [259.6, -36.4]], 2.4, 21.25, { depth: 0.3, bank: 0.7, calm: false }),
    river([[AX - 2.5, -50], [200, -46.5], [190, -40], [184.4, -36.4]], 2.4, 21.25, { depth: 0.3, bank: 0.7 }),
    river([[262.5, -36], [272, -30], [283, -22]], 4.4, 1.57, { depth: 0.6, bank: 2 }),
    river([[181.5, -36], [172, -24], [160, -4], [150, 28], [132, 60]], 4.4, 1.57, { depth: 0.6, bank: 2 }),
  ],
  terrain: [
    { op: 'ridge', pts: [[150, -70], [200, -76], [250, -74], [302, -66]], h: 52, w: 13 },
    { op: 'ridge', pts: [[150, -40], [158, 20], [154, 70]], h: 30, w: 11 },
  ],

  structures: [
    { type: 'torii', x: AX, z: 90.5, rot: 0, s: 1.35 },
    { type: 'torii', x: AX, z: 64, rot: 0, s: 1.15 },
    { type: 'torii', x: AX, z: 51.6, rot: 0, s: 1.15 },
    { type: 'gate', id: 't-main', style: 'temple', x: AX, z: 28.6, rot: 0, w: 7, open: true },
    { type: 'gate', id: 't-east', style: 'temple', x: 245.4, z: 6, rot: Math.PI / 2, w: 5.2, open: false },
    ...stairLanterns,
    { type: 'temple', x: AX, z: -37, rot: 0, w: 30, d: 17 },
    { type: 'pagoda', x: 197, z: -36, tiers: 5, s: 1 },
    { type: 'statue', x: 205.5, z: 6, rot: Math.PI / 2, s: 1 },
    { type: 'belltower', x: 206, z: 22.5, rot: Math.PI / 2 },
    { type: 'hall', x: 250.5, z: -20, rot: -Math.PI / 2, w: 13, d: 9 },
    { type: 'shrine', x: 240.2, z: -11.2, rot: -Math.PI / 2, s: 1.5 },
    { type: 'shrine', x: 240.2, z: 22.6, rot: -Math.PI / 2, s: 1.5 },
    { type: 'censer', x: AX - 11, z: 15.5 },
    { type: 'lantern', x: AX - 6, z: 21, kind: 'stone', big: true },
    { type: 'lantern', x: AX + 6, z: 21, kind: 'stone', big: true },
    { type: 'lantern', x: AX - 6, z: -11, kind: 'stone', big: true },
    { type: 'lantern', x: AX + 6, z: -11, kind: 'stone', big: true },
    { type: 'lantern', x: AX - 8, z: 60.5, kind: 'stone', big: true },
    { type: 'lantern', x: AX + 8, z: 60.5, kind: 'stone', big: true },
    { type: 'lantern', x: 256, z: 4, kind: 'stone' },
    { type: 'lantern', x: 256, z: 10, kind: 'stone' },
    { type: 'banner', x: AX - 9.5, z: -24.6, color: '#e9dcb4', h: 5.2, mon: 'lotus' },
    { type: 'banner', x: AX + 9.5, z: -24.6, color: '#e9dcb4', h: 5.2, mon: 'lotus' },
    { type: 'fall', x: 259.3, z: -36.4, rot: Math.PI / 2, w: 3.4, top: 21.25, bottom: 1.5 },
    { type: 'fall', x: 184.7, z: -36.4, rot: -Math.PI / 2, w: 3.4, top: 21.25, bottom: 1.5 },
    { type: 'checkpoint', x: 215.6, z: 96.2, rot: 0.4 },
    { type: 'checkpoint', x: 214.2, z: 24.6, rot: 0.5 },
    { type: 'jizo', x: 229.6, z: 62.5, rot: -1.2, n: 4 },
    { type: 'rocks', x: 212.4, z: 54.4, n: 2, s: 1.1 },
    { type: 'pickup', id: 't-landing', kind: 'ki', x: 229.4, z: 54.6 },
    { type: 'clouds', x: AX, z: -6, r: 120, y: 12, zMax: 36 }, // the cloud sea lies north, east and west: never across the approach
  ],
  trees: [
    ['momiji', 203, 26, 1.25], ['momiji', 241, 27, 1.2], ['momiji', 200, -16, 1.35], ['momiji', 244.5, -17.5, 1.1], ['maple', 190.5, 6, 1.3],
    ['momiji', 191, -8, 1.1], ['momiji', 252.5, 20, 1.2], ['maple', 252, -6, 1.1], ['momiji', 209.8, 58, 1.0], ['momiji', 234.2, 58, 1.05],
    ['pine', 190.5, 22, 1.5], ['pine', 253, 30, 1.4], ['momiji', 214.5, 93, 1.2], ['momiji', 229.5, 92, 1.15], ['pine', 188, -26, 1.6],
    ['momiji', 208, -44, 1.3], ['momiji', 240, -46, 1.3], ['pine', 256, -40, 1.5],
  ],

  checkpoints: [
    { id: 'temple-foot', x: 218.5, z: 95, yaw: Math.PI, label: 'Foot of the stair' },
    { id: 'temple-court', x: 217.5, z: 24, yaw: Math.PI, label: 'Unkai-ji court' },
  ],
  encounters: [
    {
      id: 't-landing', label: 'The landing', trigger: { x: AX, z: 60, r: 4.5 }, arena: { x: AX, z: 58, r: 7.4 },
      waves: [{ max: 2, list: [['spear', 217, 55], ['spear', 227, 55], ['bandit', 222, 53.5]] }],
    },
    {
      id: 't-abbot', label: 'Unkai-ji', trigger: { x: AX, z: 12, r: 7 }, arena: COURT, intro: 'boss', boss: 'monk', finisher: true,
      caption: ['寂眼', 'Jakugan · the Fallen Abbot'], line: 'No pilgrim passes. My lord has bought these stones.',
      waves: [{ max: 2, list: [['monk', AX, -12.5], ['spear', 213, -8], ['spear', 231, -8]] }],
      locks: ['t-main'], opens: ['t-east'], checkpoint: 'temple-court', done: 'The east gate is unbarred.',
    },
  ],
  camera: [
    { x: AX, z: 96, r: 8, yaw: 0, dist: 12, pitch: 0.7 },
    { x: AX, z: 76, r: 12, yaw: 0, dist: 12.5, pitch: 0.56 },
    { x: AX, z: 58, r: 8, yaw: 0, dist: 12.5, pitch: 0.74 },
    { x: AX, z: 40, r: 10, yaw: 0, dist: 12.5, pitch: 0.54 },
    { x: AX, z: 6, r: 20, yaw: 0, dist: 14, pitch: 0.84 },
    { x: 256, z: 7, r: 8, yaw: -0.9, dist: 12.5, pitch: 0.8 },
    { x: 284, z: 8, r: 16, yaw: -1.25, dist: 14, pitch: 0.74 },
  ],
  lighting: light({
    sun: [30, -48], sunColor: '#ffd9a0', sunI: 2.8,
    skyTop: '#4c86c8', skyHorizon: '#f6dcae', cloudLit: '#fff3d8', cloudShade: '#c0a6b0', coverage: 0.6,
    hemiSky: '#e2e4ff', hemiGround: '#a8906c', hemiI: 1.2,
    fog: '#ecd9b6', fogD: 0.0048, wind: 1.3, sat: 1.12, contrast: 1.05, tint: '#fff6e4', shafts: 0.8, bloom: 0.65, glow: 0.7,
  }),
  audio: { falls: 0.35, river: 0.2, wind: 0.2, birds: 0.3, fire: 0 },
};
