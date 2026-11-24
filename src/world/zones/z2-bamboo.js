import { circle, path, deck, river, light } from './shapes.js';

/* ZONE 02 — Sasayaki no Mori, the whispering bamboo forest.
   Narrow winding trails open into clearings. A hidden trail leaves the main path at the fork,
   passes a forgotten jizo grove and rejoins at the second clearing. */
const C1 = { x: 166, z: 180, r: 10.6 }, C2 = { x: 212, z: 140, r: 11.2 }, GROVE = { x: 233, z: 164, r: 6.4 };

export default {
  id: 'bamboo',
  index: 2,
  name: 'Sasayaki Forest',
  kanji: '囁きの森',
  sub: 'The whispering bamboo',
  rect: { x0: 112, x1: 302, z0: 100, z1: 290 },
  entry: { x: 126, z: 212, yaw: 1.5 },
  exit: { x: 222, z: 101 },
  ground: { edge: 'bank', bankH: 1.5, floor: 0, base: 3.4, noise: 1.0, palette: 'forest' },
  boundary: 'bamboo',
  objective: 'Find the way through the bamboo to the mountain stair',
  route: [[124, 212], [134, 208.5], [143, 202], [150.2, 194.4], [157.5, 186.6], [166, 180], [175, 175], [184, 170.5], [192, 166], [199.5, 158.5], [205, 150.5], [212, 140], [215.5, 131], [220, 118.4], [221, 112], [222, 100]],
  landmark: { x: 190, z: 150, icon: 'bamboo' },
  reveal: { cam: [119.5, 4.4, 215.6], to: [127.5, 3.9, 211.4], look: [140, 4.2, 204], lookTo: [152, 4.6, 192], fov: 50, dur: 4.2 },

  walk: [
    path([[124, 212.1, 2.2], [134, 208.5, 2.2], [143, 202, 2.25], [147.4, 197.6, 2.3]], 3.6, { surface: 'dirt' }),
    deck([[147, 198, 2.3], [150.2, 194.4, 2.75], [153.4, 190.8, 2.4]], 2.8, 'wood', { id: 'foot-bridge' }),
    path([[153, 191.2, 2.4], [157.5, 186.6, 2.45]], 3.4, { surface: 'dirt' }),
    circle(C1.x, C1.z, C1.r, 2.5, { id: 'clearing-1', surface: 'leaf' }),
    path([[175, 175, 2.6], [184, 170.5, 2.8], [192, 166, 2.9], [199.5, 158.5, 3.0], [205, 150.5, 3.1]], 3.2, { id: 'forest-path', surface: 'dirt' }),
    circle(C2.x, C2.z, C2.r, 3.2, { id: 'clearing-2', surface: 'leaf' }),
    path([[215.5, 131, 3.2], [218.6, 124, 3.2], [220, 118.4, 3.2]], 3.4, { surface: 'dirt' }),
    deck([[220, 119, 3.2], [220.9, 112, 3.9], [221.7, 105, 3.4]], 3.2, 'red', { id: 'stream-bridge' }),
    path([[221.6, 105.6, 3.4], [222, 100, 3.5]], 3.6, { surface: 'dirt' }),
    // the hidden trail
    path([[192, 166, 2.9], [201, 171.5, 3.0], [211, 175.5, 3.0], [221, 172.5, 3.1], [228, 167.5, 3.2]], 2.2, { id: 'hidden-trail', surface: 'leaf', hidden: true }),
    circle(GROVE.x, GROVE.z, GROVE.r, 3.2, { id: 'jizo-grove', surface: 'moss', hidden: true }),
    path([[235.5, 158.5, 3.2], [236.2, 151, 3.2], [231.5, 144.5, 3.2], [222.5, 141, 3.2]], 2.2, { surface: 'leaf', hidden: true }),
  ],
  water: [
    river([[283, 98], [277, 106.5], [262, 111], [240, 109.5], [221, 111.5], [201, 114], [181, 128], [162, 150], [151, 172], [150.2, 194.4], [146, 220], [140, 252], [136, 292]], 5.2, 1.55, { id: 'sasa-stream', depth: 0.7, bank: 1.8 }),
  ],

  structures: [
    { type: 'lantern', x: 127.5, z: 208.4, kind: 'stone', mossy: true },
    { type: 'lantern', x: 145, z: 203.4, kind: 'stone', mossy: true },
    { type: 'lantern', x: 156.2, z: 184.4, kind: 'stone', mossy: true },
    { type: 'lantern', x: 178.4, z: 176.6, kind: 'stone', mossy: true },
    { type: 'lantern', x: 194.6, z: 162.4, kind: 'stone', mossy: true },
    { type: 'lantern', x: 203.2, z: 149, kind: 'stone', mossy: true },
    { type: 'lantern', x: 216.2, z: 122.6, kind: 'stone', mossy: true },
    { type: 'lantern', x: 224.2, z: 103.2, kind: 'stone' },
    { type: 'fallen', x: 158.4, z: 170.6, rot: 0.5, len: 7 },
    { type: 'fallen', x: 172.5, z: 189.6, rot: -1.0, len: 8 },
    { type: 'fallen', x: 188, z: 173.6, rot: 1.3, len: 6 },
    { type: 'fallen', x: 202.6, z: 130.4, rot: 0.9, len: 7.5 },
    { type: 'fallen', x: 222.6, z: 149.6, rot: 2.0, len: 6 },
    { type: 'fallen', x: 197.2, z: 169.9, rot: 2.5, len: 5.5, low: true }, // half hides the trail mouth
    { type: 'jizo', x: 236.4, z: 166.8, rot: -1.9, n: 5 },
    { type: 'shrine', x: 237.2, z: 161.4, rot: -1.5, s: 0.9, mossy: true },
    { type: 'lantern', x: 230.2, z: 169.4, kind: 'stone', mossy: true },
    { type: 'pickup', id: 'b-grove', kind: 'life', x: 233, z: 164 },
    { type: 'shrine', x: 221.8, z: 136.6, rot: -1.9, s: 0.85, mossy: true },
    { type: 'torii', x: 221.9, z: 101.6, rot: 0, s: 0.8 },
    { type: 'checkpoint', x: 128.4, z: 214.4, rot: -0.6 },
    { type: 'checkpoint', x: 216.8, z: 129.2, rot: 1.4 },
    { type: 'rocks', x: 160.6, z: 191.2, n: 3, s: 1.2 },
    { type: 'rocks', x: 174.5, z: 172, n: 2, s: 1.0 },
    { type: 'rocks', x: 199.6, z: 135.4, n: 3, s: 1.3 },
    { type: 'rocks', x: 223.4, z: 133.2, n: 2, s: 0.9 },
    { type: 'rocks', x: 228.5, z: 160.2, n: 3, s: 1.0 },
    { type: 'rocks', x: 138, z: 211.6, n: 2, s: 0.9 },
    { type: 'shafts', x: C1.x, z: C1.z, r: 9 },
    { type: 'shafts', x: C2.x, z: C2.z, r: 9 },
    { type: 'shafts', x: GROVE.x, z: GROVE.z, r: 5 },
  ],
  trees: [['momiji', 239, 158.5, 1.1], ['momiji', 157.5, 176, 0.9], ['maple', 222, 149.6, 0.9], ['momiji', 226.5, 99.5, 1.2], ['momiji', 217, 97.6, 1.1]],

  checkpoints: [
    { id: 'bamboo-edge', x: 129.5, z: 212, yaw: 1.4, label: 'Edge of the bamboo' },
    { id: 'bamboo-deep', x: 216.4, z: 131, yaw: 0.2, label: 'Deep bamboo' },
  ],
  encounters: [
    {
      id: 'b-ambush', label: 'Ambush in the bamboo', trigger: { x: C1.x, z: C1.z, r: 5.2 }, arena: { x: C1.x, z: C1.z, r: C1.r + 0.2 }, intro: 'ambush',
      caption: ['奇襲', 'Ambush'],
      waves: [
        { max: 2, list: [['bandit', 173, 176], ['bandit', 160.5, 174.5], ['bandit', 170.5, 187.5]] },
        { max: 2, label: 'From the stalks', list: [['spear', 158.5, 182], ['spear', 172.5, 173.5], ['bandit', 164, 189]] },
      ],
    },
    {
      id: 'b-clearing', label: 'The second clearing', trigger: { x: C2.x, z: C2.z, r: 6 }, arena: { x: C2.x, z: C2.z, r: C2.r + 0.2 },
      waves: [
        { max: 2, list: [['spear', 216, 133.5], ['bandit', 205.5, 136], ['spear', 219.5, 144]] },
        { max: 2, label: 'They keep coming', list: [['elite', 212, 131.5], ['bandit', 204.5, 144.5], ['bandit', 219.6, 138.5]] },
      ],
      checkpoint: 'bamboo-deep', done: 'The forest falls quiet again.',
    },
  ],
  gates: [],
  camera: [
    { x: 134, z: 208, r: 12, yaw: -1.4, dist: 11.5, pitch: 0.84 },
    { x: C1.x, z: C1.z, r: 12, yaw: -1.2, dist: 12.8, pitch: 0.88 },
    { x: 192, z: 166, r: 10, yaw: -0.95, dist: 11.5, pitch: 0.86 },
    { x: GROVE.x, z: GROVE.z, r: 9, yaw: -0.9, dist: 10.5, pitch: 0.84 },
    { x: C2.x, z: C2.z, r: 12, yaw: -0.6, dist: 12.8, pitch: 0.88 },
    { x: 220.5, z: 114, r: 10, yaw: -0.2, dist: 12, pitch: 0.8 },
  ],
  lighting: light({
    sun: [52, -30], sunColor: '#f3ffd6', sunI: 2.2,
    skyTop: '#5aa2c8', skyHorizon: '#dcefd6', cloudLit: '#ffffff', cloudShade: '#a8c4b6', coverage: 0.58,
    hemiSky: '#cfeed6', hemiGround: '#6f8f5a', hemiI: 1.25,
    fog: '#b9d8bd', fogD: 0.011, wind: 1.2, sat: 1.08, contrast: 1.04, tint: '#f6fff2', shafts: 1.0, bloom: 0.6, glow: 0.6,
  }),
  audio: { falls: 0, river: 0.5, wind: 0.14, birds: 0.5, fire: 0 },
};
