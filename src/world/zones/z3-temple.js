import { circle, box, path, deck, stairs, river, light } from './shapes.js';

/* ZONE 03 — Unkai-ji, the temple above the sea of clouds.
   A long stone stair climbs a mountain spur to a walled plateau. The red bridge to the fortress leaves from its east gate. */
const AX = 222; // the temple axis runs due north
const COURT = { x: AX, z: 6, r: 17 };
const stairLanterns = [];
for (const [z0, z1, [za, ya], [zb, yb]] of [[86, 66, [88, 3.8], [65, 12.5]], [50, 31, [51, 12.5], [29.5, 21.5]]]) {
  for (let i = 0; i < 4; i++) {
    const z = z0 + ((z1 - z0) * (i + 0.5)) / 4, line = ya + ((yb - ya) * (z - za)) / (zb - za);
    // each stands on a masonry pier bonded to the outside of the flight's cheek wall (outer face 4.3 off the axis),
    // capped level with the wall's coping and founded on the falling ground of the shoulder; window to the stair
    for (const s of [-1, 1]) stairLanterns.push({ type: 'lantern', x: AX + s * 5.0, z, rot: -s * Math.PI / 2, kind: 'stone', y: line + 1.06, pier: 1.44 });
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
    // the way out to the sky bridge runs onto the gorge's rim: a gentle verge, so the rock stands at the path's own height
    path([[245, 6, 21.5], [256, 7, 21.5], [266.5, 8, 21.6]], 5, { surface: 'paved', edge: { mode: 'drop', slope: 0.45, shoulder: 1.6 } }),
    deck([[266, 8, 21.6], [275, 8, 22.7], [284, 8, 23.1], [293, 8, 22.8], [302.5, 8, 22]], 4.2, 'red', { id: 'sky-bridge', long: true }),
  ],
  water: [
    // the gorge river: born at the foot of the great fall under the northern massif, it runs south under the sky bridge
    river([[288.5, -72], [285, -44], [283, 0], [285, 40], [284, 80], [283, 102]], 8, 1.56, { id: 'gorge-river', depth: 0.9, bank: 3 }),
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
    // the massif at the head of the gorge, over which the great fall pours (it stands on the floor: see nav.js `over`)
    { op: 'ridge', over: true, pts: [[244, -94], [266, -84], [288, -77], [306, -84], [318, -100]], h: 46, w: 11 },
    // the gorge itself: sheer rock either side of the river from the fall to the sky bridge, opening out to the south.
    // [x, z, floor width west, east, wall top west, east] listed downstream; the floor is dry rock beside the river.
    // Each floor edge sits where the plateau's own edge is (the path's end on the west, the fortress pad on the east), so
    // the wall the crags clad is the wall the ground actually makes
    {
      op: 'gorge', bed: [2.4, 2.0], run: 2.6, shelf: 3, jag: 3.6,
      pts: [[288.5, -72, 4.6, 4.6, 27, 27], [286.5, -56, 7, 7, 24, 24], [284.5, -36, 22.5, 13, 21.2, 21.6], [283.5, -14, 17, 14.5, 21.3, 21.7],
        [283, 8, 16.5, 14.6, 21.4, 21.8], [284, 30, 17, 14.2, 21.4, 21.8], [284.5, 48, 15, 14, 17, 18], [284, 64, 11, 11, 7, 7], [283.5, 78, 8, 8, 0, 0]],
    },
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
    // a pair on the verge of the way out to the sky bridge (the path is 5 wide and runs along z 7 here)
    { type: 'lantern', x: 256, z: 3.4, rot: 0, kind: 'stone' },
    { type: 'lantern', x: 256, z: 10.6, rot: Math.PI, kind: 'stone' },
    { type: 'banner', x: AX - 9.5, z: -24.6, color: '#e9dcb4', h: 5.2, mon: 'lotus' },
    { type: 'banner', x: AX + 9.5, z: -24.6, color: '#e9dcb4', h: 5.2, mon: 'lotus' },
    { type: 'fall', x: 259.3, z: -36.4, rot: Math.PI / 2, w: 3.4, top: 21.25, bottom: 1.5 },
    { type: 'fall', x: 184.7, z: -36.4, rot: -Math.PI / 2, w: 3.4, top: 21.25, bottom: 1.5 },
    { type: 'checkpoint', x: 217.9, z: 96.6, rot: Math.PI / 2 }, // on the verge of the approach, at the foot of the stair
    { type: 'checkpoint', x: 214.2, z: 24.6, rot: 0.5 },
    { type: 'jizo', x: 229.6, z: 62.5, rot: -1.2, n: 4 },
    { type: 'rocks', x: 212.4, z: 54.4, n: 2, s: 1.1 },
    { type: 'pickup', id: 't-landing', kind: 'ki', x: 229.4, z: 54.6 },
    // the great fall at the head of the gorge: the river pours off the northern massif into the sea of clouds
    { type: 'fall', x: 288.5, z: -79, rot: 0, w: 7, top: 40.4, bottom: 0.9 },
    { type: 'rocks', x: 281.5, z: 22, n: 3, s: 1.5, stone: true },
    { type: 'rocks', x: 286.5, z: -10, n: 3, s: 1.3, stone: true },
    { type: 'rocks', x: 284, z: -50, n: 2, s: 1.7, stone: true },
    { type: 'clouds', x: AX, z: -6, r: 120, y: 9, zMax: 36 }, // the cloud sea lies north, east and west: never across the approach
  ],
  trees: [
    ['momiji', 203, 26, 1.25], ['momiji', 242, 30.5, 1.2], ['momiji', 197.4, -17.6, 1.35], ['momiji', 244.5, -17.5, 1.1], ['maple', 190.5, 6, 1.3],
    ['momiji', 191, -8, 1.1], ['momiji', 252.5, 20, 1.2], ['maple', 252, -6, 1.1], ['momiji', 209.8, 58, 1.0], ['momiji', 234.2, 58, 1.05],
    ['pine', 190.5, 22, 1.5], ['pine', 253, 30, 1.4], ['momiji', 214.5, 93, 1.2], ['momiji', 229.5, 92, 1.15], ['pine', 188, -26, 1.6],
    ['momiji', 208, -44, 1.3], ['momiji', 240, -46, 1.3], ['pine', 256, -40, 1.5],
    // the gorge's west rim, and the massif's shoulders above the great fall
    ['pine', 262.5, -6, 1.7], ['momiji', 261, 16, 1.25], ['pine', 261.5, 28, 1.5], ['momiji', 263, 38, 1.2], ['pine', 259.5, -26, 1.5],
    ['pine', 297, -83, 1.9], ['pine', 270, -84, 1.6], ['pine', 300, -88, 1.5],
  ],

  checkpoints: [
    { id: 'temple-foot', x: 219.8, z: 95.2, yaw: Math.PI, label: 'Foot of the stair' },
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
    { x: 256, z: 7, r: 8, yaw: -0.9, dist: 12.5, pitch: 0.66 },
    // on the sky bridge the view opens: the great fall and the massif to the north, the stronghold ahead
    { x: 284, z: 8, r: 17, yaw: -0.78, dist: 13.5, pitch: 0.46 },
  ],
  lighting: light({
    sun: [30, -48], sunColor: '#ffd9a0', sunI: 2.8,
    skyTop: '#4c86c8', skyHorizon: '#f6dcae', cloudLit: '#fff3d8', cloudShade: '#c0a6b0', coverage: 0.6,
    hemiSky: '#e2e4ff', hemiGround: '#a8906c', hemiI: 1.2,
    fog: '#ecd9b6', fogD: 0.0048, wind: 1.3, sat: 1.12, contrast: 1.05, tint: '#fff6e4', shafts: 0.8, bloom: 0.65, glow: 0.7,
  }),
  audio: { falls: 0.35, river: 0.2, wind: 0.2, birds: 0.3, fire: 0 },
};
