import { circle, path, deck, river, light } from './shapes.js';

/* ZONE 00 — Shirataki Falls (the original valley, kept as built).
   New here: the gorge trail south, a cliffside boardwalk, a wayside shrine and the wooden bridge to the village road. */
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
  route: [[-1.6, -6.4], [-12, 20], [-15.8, 29.5], [-15, 39], [-12, 49], [-9.6, 60], [-8.4, 70], [-7.4, 80], [-4.6, 86], [-2.9, 95], [-2.2, 104], [-1.4, 117.4], [7.4, 118.7], [16.2, 119.2], [17.6, 126], [18.6, 134]],
  landmark: { x: 0, z: -40, icon: 'falls' },

  walk: [
    circle(-9, 5, 25.5, null, { legacy: true }), // the meadow and shallows
    path([[-15.8, 29.5, 0.95], [-15, 39, 0.95], [-12, 49, 1.05], [-9.6, 60, 1.25], [-8.4, 70, 1.55], [-7.4, 80, 1.75]], 4.2, { id: 'gorge-trail', surface: 'dirt' }),
    circle(-15.5, 55.5, 4.6, 1.5, { id: 'shrine-nook', surface: 'dirt' }),
    deck([[-7.4, 79, 1.75], [-4.6, 86, 1.75], [-2.9, 95, 1.75], [-2.2, 104, 1.75], [-1.7, 111, 1.8], [-1.4, 117.4, 1.9]], 3.4, 'board', { id: 'boardwalk' }),
    deck([[-1.6, 118.2, 1.9], [3.2, 118.5, 2.75], [7.4, 118.7, 3.0], [11.6, 118.9, 2.8], [16.2, 119.2, 2.3]], 3.6, 'wood', { id: 'falls-bridge' }),
    path([[16, 119.2, 2.3], [17.6, 126, 2.3], [18.6, 134, 2.2]], 4.2, { id: 'east-ledge', surface: 'dirt' }),
  ],
  // the river is drawn by the valley's own water surface; listed here so it carves the new ground and blocks walking
  water: [river([[5.6, 96], [5.8, 112], [5.9, 124], [5.9, 130], [6, 151]], 11.6, 0, { legacy: true, wade: true, depth: 0.55, bank: 3 })],

  structures: [
    { type: 'shrine', x: -18.2, z: 55.2, rot: 1.45, s: 1.15 },
    { type: 'lantern', x: -13.2, z: 52.4, kind: 'stone' },
    { type: 'lantern', x: -13.6, z: 58.8, kind: 'stone' },
    { type: 'jizo', x: -17.2, z: 59.2, rot: 2.3, n: 3 },
    { type: 'lantern', x: -10.2, z: 72.5, kind: 'stone' },
    { type: 'signpost', x: -12.6, z: 41, rot: 1.9, text: '花村' },
    { type: 'lantern', x: -9.2, z: 79.2, kind: 'post' },
    { type: 'lantern', x: -0.1, z: 116.2, kind: 'post' },
    { type: 'lantern', x: 17.9, z: 120.6, kind: 'post' },
    { type: 'checkpoint', x: -13.4, z: 33.5, rot: 1.2 },
  ],
  trees: [
    ['momiji', -19.5, 51.5, 1.2], ['momiji', -20.5, 60.5, 1.05], ['maple', -17.5, 45, 1.0], ['momiji', -13, 66.5, 0.95],
    ['momiji', 21.5, 123, 1.0], ['maple', 22.5, 132, 1.1],
  ],

  checkpoints: [{ id: 'falls', x: -12.2, z: 32.5, yaw: 3.0, label: 'Shirataki Falls' }],
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
