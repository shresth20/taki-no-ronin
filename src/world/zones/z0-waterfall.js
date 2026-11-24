import { circle, path, deck, river, light, beside } from './shapes.js';

/* ZONE 00 — Shirataki Falls (the original valley, kept as built).
   New here: the gorge trail south, a cliffside boardwalk, a wayside shrine and the wooden bridge to the village road. */
const TRAIL = [[-15.8, 29.5, 0.95], [-15, 39, 0.95], [-12, 49, 1.05], [-9.6, 60, 1.25], [-8.4, 70, 1.55], [-7.4, 80, 1.75]];
const SHRINE = { x: -18.2, z: 55.2, rot: 1.45 };
/** a point in the wayside shrine's own frame (its front faces +Z) */
const atShrine = (lx, lz) => ({ x: +(SHRINE.x + lx * Math.cos(SHRINE.rot) + lz * Math.sin(SHRINE.rot)).toFixed(2), z: +(SHRINE.z - lx * Math.sin(SHRINE.rot) + lz * Math.cos(SHRINE.rot)).toFixed(2), rot: SHRINE.rot });
export default {
  id: 'waterfall',
  index: 0,
  name: 'Shirataki Falls',
  kanji: '白滝',
  sub: 'Where the blade is kept honest',
  legacy: true, // terrain, water and planting come from the hand-built valley modules
  rect: { x0: -130, x1: 130, z0: -130, z1: 130 },
  entry: { x: -1.6, z: -6.4, yaw: 0.85 },
  exit: { x: 16, z: 128 },
  ground: { edge: 'rise', rise: 26, reach: 26, floor: 0, base: 30, noise: 1.2, palette: 'valley' },
  boundary: 'rail',
  objective: 'Follow the gorge path south to Hanamura',
  route: [[-1.6, -6.4], [-12, 20], [-15.8, 29.5], [-15, 39], [-12, 49], [-9.6, 60], [-8.4, 70], [-7.4, 80], [-4.6, 86], [-2.9, 95], [-2.2, 104], [-1.5, 118.3], [7.2, 118.3], [15.6, 118.4], [17.6, 126], [18.6, 134]],
  landmark: { x: 0, z: -40, icon: 'falls' },

  walk: [
    circle(-9, 5, 25.5, null, { legacy: true }), // the meadow and shallows
    path(TRAIL, 4.2, { id: 'gorge-trail', surface: 'dirt' }),
    circle(-15.5, 55.5, 4.6, 1.5, { id: 'shrine-nook', surface: 'dirt' }),
    deck([[-7.4, 79, 1.75], [-4.6, 86, 1.75], [-2.9, 95, 1.75], [-2.2, 104, 1.75], [-1.7, 111, 1.8], [-1.5, 114.2, 1.86], [-1.5, 116.25, 1.9]], 3.4, 'board', { id: 'boardwalk', join: { end: true } }),
    // where the boardwalk turns onto the bridge: a landing on braced piles, railed on its two outer sides (west against
    // the rock, south over the river) so the boardwalk's west rail and the bridge's south rail run on round the corner
    deck([[-1.5, 116.5, 1.9], [-1.5, 120.1, 1.9]], 3.4, 'board', { id: 'falls-landing', square: true, landing: { rails: ['right', 'end'], lamp: 'right-end' } }),
    deck([[0.45, 118.3, 1.9], [3.6, 118.3, 2.62], [7.2, 118.3, 2.95], [10.6, 118.3, 2.72], [13.5, 118.3, 2.32]], 3.6, 'wood', { id: 'falls-bridge', join: { start: true } }),
    path([[15.6, 118.3, 2.3], [16.9, 118.8, 2.3], [17.6, 126, 2.3], [18.6, 134, 2.2]], 4.2, { id: 'east-ledge', surface: 'dirt' }),
  ],
  // the river is drawn by the valley's own water surface; listed here so it carves the new ground and blocks walking
  water: [river([[5.6, 96], [5.8, 112], [5.9, 124], [5.9, 130], [6, 151]], 11.6, 0, { legacy: true, wade: true, depth: 0.55, bank: 3 })],
  // the gorge: the river runs on between sheer rock from the boardwalk to the village, the boardwalk hangs over the water
  // against the west wall, and the falls bridge crosses to a ledge cut into the east wall.
  // [x, z (down the river's middle), floor width out to the west wall, to the east wall, west wall top, east wall top]:
  // the floor spans from just behind the boardwalk and its landing to the far bank and the abutment's face
  terrain: [{
    op: 'gorge',
    pts: [[3, 78, 13, 6.6, 6, 5], [4, 84, 11.6, 6.9, 9, 7], [4.8, 90, 10.8, 7.3, 10, 8], [5.4, 98, 10.3, 7.5, 11, 8], [5.7, 106, 10.05, 7.3, 11, 8],
      [5.8, 114, 9.65, 6.8, 10, 7.5], [5.87, 122, 9.77, 6.73, 9, 6], [5.88, 125, 5.88, 6.62, 9, 5], [5.88, 129, 5.6, 5.92, 9, 4]],
  }, {
    // the ledge the bridge lands on is cut into the mountain: rock stands up behind the bridge foot and along the
    // uphill side of the path south, the river side stays open (same columns, along the path)
    op: 'cut', fade: 0.8,
    pts: [[13.0, 118.3, 2.45, 2.45, 0, 6], [16.9, 118.8, 2.45, 2.45, 0, 7], [17.6, 126, 2.45, 2.45, 0, 6], [18.3, 131, 2.45, 2.45, 0, 3]],
  }],

  structures: [
    // lanterns stand on the trail's verge (right = the hillside, left = the river) or flank the shrine's front, never in the way
    { type: 'shrine', ...SHRINE, s: 1.15 },
    { type: 'lantern', ...atShrine(2.0, 1.4), kind: 'stone' },
    { type: 'lantern', ...atShrine(-2.0, 1.4), kind: 'stone' },
    { type: 'jizo', x: -17.2, z: 59.2, rot: 2.3, n: 3 },
    { type: 'lantern', ...beside(TRAIL, 4.2, 43.8, 1, 1.1), kind: 'stone' },
    { type: 'signpost', x: -12.6, z: 41, rot: 1.9, text: '花村' },
    // where the trail steps onto the boardwalk: a lamp post on the hillside, its arm out over the boards' first span
    { type: 'lantern', ...beside(TRAIL, 4.2, -1.5, 1, 0.75), kind: 'post' },
    // the falls bridge comes ashore in a seat cut into a stone bank wall; a lantern on the wall lights the bridge foot
    { type: 'abutment', x: 12.55, z: 119.6, rot: -Math.PI / 2, len: 8.6, top: 2.31, seat: { x: -1.3, w: 4.4, y: 1.67, d: 0.95 } },
    { type: 'lantern', x: 13.0, z: 121.0, kind: 'post', y: 2.31, rot: 2.62 }, // its arm reaches out over the bridge foot
    // the spirit lamp stands on the river side of the trail, just past the torii
    { type: 'checkpoint', ...beside(TRAIL, 4.2, 3.2, -1, 1.1) },
  ],
  trees: [
    ['momiji', -19.5, 51.5, 1.2], ['momiji', -20.5, 60.5, 1.05], ['maple', -17.5, 45, 1.0], ['momiji', -13, 66.5, 0.95],
    ['momiji', 21.5, 123, 1.0], ['maple', 22.5, 132, 1.1],
  ],

  checkpoints: [{ id: 'falls', x: -14.2, z: 32.6, yaw: 3.0, label: 'Shirataki Falls' }],
  encounters: [],
  gates: [],
  camera: [
    { x: -9, z: 2, r: 22, yaw: 0, dist: 8.6, pitch: 0.5 },
    { x: -14.5, z: 31, r: 6, yaw: 1.0, dist: 9.8, pitch: 0.62 },
    { x: -13, z: 44, r: 8, yaw: 2.1, dist: 11, pitch: 0.74 },
    { x: -9.5, z: 62, r: 10, yaw: 2.8, dist: 11.5, pitch: 0.8 },
    { x: -5, z: 88, r: 12, yaw: 3.14, dist: 12, pitch: 0.82 },
    { x: -1.8, z: 110, r: 8, yaw: 3.3, dist: 12, pitch: 0.82 },
    { x: 7, z: 118.5, r: 8, yaw: 4.1, dist: 12.5, pitch: 0.8 },
    { x: 17.5, z: 127, r: 6, yaw: 3.9, dist: 12, pitch: 0.82 },
  ],

  lighting: light({
    sun: [40, 38], sunColor: '#fff0cf', sunI: 2.6,
    skyTop: '#2f86d8', skyHorizon: '#d3ecec', cloudLit: '#ffffff', cloudShade: '#a9c6e0', coverage: 0.46,
    hemiSky: '#cfe8ff', hemiGround: '#8fb07a', hemiI: 1.25,
    fog: '#cfe6e2', fogD: 0.0038, wind: 1.0, sat: 1.12, contrast: 1.04, tint: '#ffffff', shafts: 0.55, bloom: 0.55, glow: 0.35,
  }),
  audio: { falls: 1, river: 1, wind: 0.07, birds: 1, fire: 0 },
};
