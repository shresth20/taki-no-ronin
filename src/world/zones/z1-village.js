import { circle, path, deck, river, light, face } from './shapes.js';

/* ZONE 01 — Hanamura, a farming village on the river below the falls.
   Organic street plan: one main street from the north gate to the plaza, a riverside lane past the mill,
   a back alley over the shrine knoll, and a dike path out into the paddies. All of them rejoin the main route. */
const PLAZA = { x: 60, z: 206, r: 13.2 };
const H = (kind, x, z, tx, tz, o = {}) => ({ type: 'house', kind, x, z, rot: face(x, z, tx, tz), ...o });

export default {
  id: 'village',
  index: 1,
  name: 'Hanamura',
  kanji: '花村',
  sub: 'The village below the falls',
  rect: { x0: -40, x1: 112, z0: 130, z1: 290 },
  entry: { x: 19.5, z: 138, yaw: 0.5 },
  exit: { x: 98, z: 214 },
  ground: { edge: 'flat', floor: 0, base: 1.4, noise: 0.5, palette: 'village' },
  boundary: 'fence',
  objective: 'Drive the Black Fang out of Hanamura',
  route: [[18.6, 133], [21, 142], [27.5, 151.5], [35, 164], [43, 178], [51, 192], [60, 206], [74, 208], [88, 212.4], [98, 214], [111, 213], [124.5, 212]],
  landmark: { x: 60, z: 206, icon: 'village' },
  reveal: { cam: [12, 15, 139], to: [20, 12.5, 149], look: [44, 2, 180], lookTo: [58, 2, 204], fov: 46, dur: 4.4 },

  walk: [
    path([[18.6, 133, 2.2], [21, 142, 2.0], [27.5, 151.5, 1.8]], 4.4, { surface: 'dirt' }),
    path([[27.5, 151.5, 1.8], [35, 164, 1.6], [43, 178, 1.5], [51, 192, 1.5], [57, 201, 1.5]], 5.4, { id: 'main-street', surface: 'dirt' }),
    circle(PLAZA.x, PLAZA.z, PLAZA.r, 1.5, { id: 'plaza', surface: 'paved' }),
    path([[70, 207.5, 1.5], [78, 209, 1.5], [88, 212.4, 1.6], [98, 214, 1.7]], 5.2, { id: 'east-street', surface: 'dirt' }),
    // riverside lane: past the mill and back to the plaza
    path([[39, 171, 1.55], [30, 178, 1.4], [22, 185.5, 1.25], [19, 190, 1.2]], 3.6, { id: 'mill-lane', surface: 'dirt' }),
    circle(18.6, 191, 4.6, 1.2, { id: 'mill-yard', surface: 'dirt' }),
    path([[19.5, 193, 1.2], [23, 202, 1.2], [32, 212, 1.3], [43, 216.5, 1.4], [51, 212.5, 1.5]], 3.4, { id: 'river-lane', surface: 'dirt' }),
    // back alley over the shrine knoll
    path([[47, 185, 1.5], [57, 178.5, 1.7], [69, 176.5, 2.0], [76, 177.5, 2.3]], 3.2, { id: 'back-alley', surface: 'dirt' }),
    circle(79.5, 178.5, 5.4, 2.4, { id: 'shrine-knoll', surface: 'moss' }),
    path([[82.5, 182, 2.3], [86.5, 191, 2.0], [88.5, 203, 1.7], [88.2, 211, 1.6]], 3.2, { surface: 'dirt' }),
    // dike out into the paddies (dead end with a view)
    path([[60, 217, 1.5], [60, 238, 1.35], [71, 243, 1.35]], 2.6, { id: 'dike', surface: 'dirt' }),
    circle(73.5, 244, 3.2, 1.35, { surface: 'dirt' }),
    deck([[97.5, 214, 1.7], [104, 213.6, 2.7], [111, 213.1, 3.1], [118, 212.6, 2.8], [124.5, 212.1, 2.2]], 3.8, 'red', { id: 'red-bridge' }),
  ],
  water: [
    river([[6, 149], [8, 170], [4.5, 196], [-6, 222], [-20, 250], [-30, 292]], 9.5, -1.25, { id: 'hana-river', depth: 1.0, bank: 2.6, weir: { z: 150.5, drop: 1.25 } }),
    river([[113, 128], [110.5, 160], [112, 196], [111, 214], [108, 250], [104, 292]], 7.5, -1.6, { id: 'ravine', depth: 1.2, bank: 3.2 }),
    { t: 'paddy', x: 48, z: 240, w: 14, d: 11, rot: 0, y: 1.1 },
    { t: 'paddy', x: 70, z: 230, w: 12, d: 10, rot: 0, y: 1.1 },
    { t: 'paddy', x: 89, z: 236, w: 14, d: 16, rot: 0.06, y: 1.1 },
    { t: 'paddy', x: 50, z: 257, w: 18, d: 10, rot: -0.04, y: 1.05 },
    { t: 'paddy', x: 74, z: 258, w: 16, d: 11, rot: 0.03, y: 1.05 },
    { t: 'paddy', x: 33, z: 236, w: 12, d: 14, rot: 0.1, y: 1.05 },
  ],

  structures: [
    { type: 'gate', id: 'v-north', style: 'village', x: 27.5, z: 151.5, rot: face(27.5, 151.5, 35, 164), w: 5.4, open: true },
    { type: 'gate', id: 'v-east', style: 'village', x: 95.5, z: 213.6, rot: face(88, 212.4, 98, 214), w: 5.2, open: false },
    // main street
    H('farm', 19.5, 160, 28, 157),
    H('town', 43.5, 157.5, 36, 164, { lantern: true }),
    H('farm', 26.5, 169, 35, 164),
    H('shop', 51.5, 172.5, 43, 178, { noren: '#2f5d8a', lantern: true }),
    H('town', 39.5, 191, 47, 185.5),
    H('inn', 67.5, 186, PLAZA.x, PLAZA.z, { lantern: true, noren: '#8a2f2f' }),
    // plaza ring
    H('town', 40.5, 203.5, PLAZA.x, PLAZA.z),
    H('farm', 79.5, 220.5, 76, 210, { lantern: true }),
    H('shop', 77, 199.5, 76, 208.5, { noren: '#3a6b4a' }),
    H('farm', 47.5, 226, 55, 214),
    // lanes
    { type: 'mill', x: 14.4, z: 184.6, rot: -0.2 },
    H('store', 29.5, 195, 23.5, 199),
    H('farm', 62, 168.5, 62, 177),
    H('store', 93, 199, 88.5, 203),
    H('farm', 100.5, 189, 92, 192),
    H('farm', 74.5, 163.5, 72, 172),
    H('farm', 33.5, 224.5, 38, 215),
    // plaza dressing (kept to the rim so the middle stays open for fighting)
    { type: 'stall', x: 61.4, z: 191.2, rot: face(61.4, 191.2, PLAZA.x, PLAZA.z), color: '#b5392c' },
    { type: 'stall', x: 70.2, z: 195.4, rot: face(70.2, 195.4, PLAZA.x, PLAZA.z), color: '#2f5d8a' },
    { type: 'stall', x: 70.6, z: 217.2, rot: face(70.6, 217.2, PLAZA.x, PLAZA.z), color: '#c98a2b' },
    { type: 'well', x: 53.2, z: 199.6 },
    { type: 'crates', x: 66.5, z: 218.6, n: 5 },
    { type: 'barrels', x: 49.3, z: 201.5, n: 3 },
    { type: 'cart', x: 46.8, z: 207.5, rot: 0.6 },
    { type: 'baskets', x: 64.8, z: 193.4, n: 4 },
    { type: 'lantern', x: 55.4, z: 195.6, kind: 'post' },
    { type: 'lantern', x: 71.6, z: 203.2, kind: 'post' },
    { type: 'lantern', x: 55.2, z: 217.4, kind: 'post' },
    { type: 'lantern', x: 31.5, z: 155, kind: 'post' },
    { type: 'lantern', x: 40.5, z: 168, kind: 'post' },
    { type: 'lantern', x: 48.6, z: 181.5, kind: 'post' },
    { type: 'lantern', x: 84, z: 208.6, kind: 'post' },
    { type: 'lantern', x: 93.2, z: 216.6, kind: 'stone' },
    { type: 'crates', x: 33.5, z: 171.4, n: 3 },
    { type: 'barrels', x: 46.5, z: 174.5, n: 2 },
    { type: 'woodpile', x: 24.2, z: 163.4, rot: 0.9 },
    { type: 'haystack', x: 44.5, z: 221.5 },
    { type: 'haystack', x: 82.5, z: 226.5 },
    { type: 'scarecrow', x: 75.2, z: 245.6, rot: -2.2 },
    { type: 'shrine', x: 82.2, z: 176.2, rot: face(82.2, 176.2, 78, 179), s: 1.0 },
    { type: 'jizo', x: 80.2, z: 182.6, rot: 2.9, n: 2 },
    { type: 'lantern', x: 76.2, z: 174.6, kind: 'stone' },
    { type: 'pickup', id: 'v-knoll', kind: 'ki', x: 79.2, z: 178.6 },
    { type: 'pickup', id: 'v-dike', kind: 'life', x: 73.6, z: 244 },
    { type: 'checkpoint', x: 31.2, z: 160.2, rot: 2.2 },
    { type: 'checkpoint', x: 68.6, z: 211.6, rot: -1.2 },
    { type: 'smoke', x: 67.5, z: 186, h: 9 },
    { type: 'smoke', x: 43.5, z: 157.5, h: 8 },
  ],
  trees: [
    ['momiji', 24, 148, 1.15], ['momiji', 33.5, 147.5, 1.1], ['maple', 47.5, 163.5, 1.0], ['momiji', 33, 186, 1.0], ['green', 16, 170, 1.2],
    ['momiji', 76, 172.5, 1.25], ['maple', 85.5, 180.5, 1.0], ['momiji', 55.5, 185, 0.95], ['sakura', 73, 191, 1.0], ['momiji', 37, 212.5, 1.05],
    ['maple', 84.5, 195.5, 1.0], ['momiji', 91.5, 206.5, 1.0], ['green', 28, 205, 1.1], ['momiji', 55, 222.5, 0.9], ['maple', 100.5, 208, 1.1],
    ['momiji', 99.5, 220, 1.05], ['green', 12, 176, 1.1], ['momiji', 66, 222.8, 0.9],
  ],

  checkpoints: [
    { id: 'village-gate', x: 30.2, z: 158.6, yaw: 0.6, label: 'Hanamura gate' },
    { id: 'village-plaza', x: 67, z: 210, yaw: 1.4, label: 'Hanamura plaza' },
  ],
  encounters: [
    {
      id: 'v-street', label: 'Raiders in the street', trigger: { x: 40, z: 173, r: 5.5 }, arena: { x: 43, z: 178, r: 11.5 },
      waves: [{ max: 1, list: [['bandit', 47.5, 186], ['bandit', 44.5, 182]] }],
    },
    {
      id: 'v-plaza', label: 'Hanamura plaza', trigger: { x: PLAZA.x, z: PLAZA.z, r: 7.5 }, arena: { x: PLAZA.x, z: PLAZA.z, r: PLAZA.r + 0.3 }, intro: 'ambush',
      caption: ['黒牙', 'The Black Fang'],
      waves: [
        { max: 1, list: [['bandit', 66, 197], ['bandit', 70.5, 208], ['bandit', 55, 215.5]] },
        { max: 2, label: 'More of them', list: [['spear', 68.5, 199], ['bandit', 51, 199], ['spear', 62, 216.5], ['bandit', 70, 212]] },
      ],
      opens: ['v-east'], checkpoint: 'village-plaza', done: 'Hanamura is free. The east gate stands open.',
    },
  ],
  camera: [
    { x: 22, z: 143, r: 8, yaw: -1.95, dist: 12, pitch: 0.82 },
    { x: 40, z: 172, r: 14, yaw: -1.25, dist: 12, pitch: 0.84 },
    { x: PLAZA.x, z: PLAZA.z, r: 14, yaw: -1.3, dist: 13.2, pitch: 0.86 },
    { x: 22, z: 192, r: 10, yaw: -1.5, dist: 11.5, pitch: 0.84 },
    { x: 78, z: 180, r: 10, yaw: -1.15, dist: 11.5, pitch: 0.84 },
    { x: 66, z: 240, r: 10, yaw: -1.0, dist: 12, pitch: 0.8 },
    { x: 92, z: 213, r: 10, yaw: -1.35, dist: 12, pitch: 0.82 },
    { x: 111, z: 213, r: 10, yaw: -1.45, dist: 13, pitch: 0.8 },
  ],
  lighting: light({
    sun: [44, -38], sunColor: '#ffe6bd', sunI: 2.7,
    skyTop: '#3d8fd6', skyHorizon: '#f0e6c8', cloudLit: '#fff8ea', cloudShade: '#b9c4d6', coverage: 0.4,
    hemiSky: '#d6e6ff', hemiGround: '#a89a78', hemiI: 1.2,
    fog: '#e6dcc2', fogD: 0.0042, wind: 1.0, sat: 1.1, contrast: 1.05, tint: '#fffaf0', shafts: 0.4, bloom: 0.55, glow: 0.5,
  }),
  audio: { falls: 0, river: 0.8, wind: 0.08, birds: 0.8, fire: 0 },
};
