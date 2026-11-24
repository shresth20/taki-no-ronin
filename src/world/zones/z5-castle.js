import { circle, box, path, deck, stairs, river, pond, light } from './shapes.js';

/* ZONE 05 — Onikage-jō, the villain's castle.
   Gate, water garden, inner court, the great stair, and the lord's arena under the keep. Strictly symmetrical on its axis. */
const AX = 372;
const ARENA = { x: AX, z: -197, r: 19.2 };
const W = (pts, o = {}) => ({ type: 'wall', kind: 'castle', h: 4.6, pts, ...o });
const ring = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
  ring.push({ type: 'brazier', x: ARENA.x + Math.sin(a) * 18.5, z: ARENA.z + Math.cos(a) * 18.5, big: true });
}
// octagonal wall round the arena: open to the stair (south, between oct[7] and oct[0]) and closed by the keep's base (north)
const oct = [];
for (let i = 0; i < 8; i++) {
  const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
  oct.push([+(ARENA.x + Math.sin(a) * 22.5).toFixed(2), +(ARENA.z + Math.cos(a) * 22.5).toFixed(2)]);
}

export default {
  id: 'castle',
  index: 5,
  name: 'Onikage Castle',
  kanji: '鬼影城',
  sub: 'Seat of the Black Fang',
  rect: { x0: 302, x1: 440, z0: -260, z1: -60 },
  entry: { x: AX, z: -64, yaw: Math.PI },
  exit: { x: AX, z: -197 },
  ground: { edge: 'drop', slope: 2.4, shoulder: 2.5, floor: 1.6, base: 1.6, noise: 1.4, palette: 'castle' },
  boundary: 'castlewall',
  objective: 'Climb to the keep and end Lord Onikage',
  route: [[AX, -60], [AX, -82.5], [AX, -100.5], [AX, -117.5], [AX, -142], [AX, -158.5], [AX, -178.5], [AX, -197]],
  landmark: { x: AX, z: -232, icon: 'castle' },
  reveal: { cam: [AX + 3, 28.5, -46], to: [AX, 39, -60], look: [AX, 30, -110], lookTo: [AX, 52, -226], fov: 46, dur: 5.4 },

  pads: [
    box(AX, -92, 84, 66, 24, 0), // approach and garden terrace
    box(AX, -142, 74, 44, 26, 0), // inner terrace
    circle(ARENA.x, ARENA.z, 31, 33), // the summit
    box(AX, -234, 60, 36, 33, 0), // under the keep
  ],
  walk: [
    path([[AX, -60, 23.2], [AX, -70, 23.6], [AX, -82.5, 24]], 6, { surface: 'paved' }),
    box(AX, -100.5, 52, 38, 24, 0, { id: 'garden', surface: 'gravel' }),
    deck([[AX, -96.4, 24], [AX, -101, 24.75], [AX, -105.6, 24]], 3.8, 'stone', { id: 'garden-bridge', span: 4.6 }),
    deck([[357.5, -98.6, 24], [357.2, -103.2, 24.7], [357, -107.8, 24]], 3, 'red', { id: 'moon-bridge' }),
    stairs([[AX, -117.5, 24], [AX, -124.5, 26]], 8, { id: 'inner-steps' }),
    box(AX, -142.1, 46, 33.8, 26, 0, { id: 'inner-court', surface: 'paved' }),
    stairs([[AX, -158.5, 26], [AX, -178.5, 33]], 9, { id: 'great-stair' }),
    circle(ARENA.x, ARENA.z, 19.6, 33, { id: 'arena', surface: 'arena' }),
  ],
  water: [
    river([[402, -95.5], [390, -97.5], [AX, -101], [357.2, -103.2], [342, -104.5]], 4.2, 23.55, { id: 'garden-stream', depth: 0.5, bank: 0.9, calm: true }),
    pond(388.5, -97.5, 6.4, 23.55, { id: 'koi-pond', depth: 0.6, bank: 1.0 }),
  ],
  terrain: [{ op: 'ridge', pts: [[318, -250], [372, -262], [426, -250]], h: 30, w: 16 }],

  structures: [
    // outer garden walls
    W([[368.4, -80.5], [344.5, -80.5], [344.5, -120.6], [367.6, -120.6]]),
    W([[375.6, -80.5], [399.5, -80.5], [399.5, -120.6], [376.4, -120.6]]),
    // inner court walls
    W([[367.6, -120.6], [347.6, -120.6], [347.6, -160.6], [367.2, -160.6]], { h: 5 }),
    W([[376.4, -120.6], [396.4, -120.6], [396.4, -160.6], [376.8, -160.6]], { h: 5 }),
    // stair flanks and the arena ring
    W([[367.2, -160.6], [367.2, -177.4], oct[7]], { h: 4.2, kind: 'ishigaki' }),
    W([[376.8, -160.6], [376.8, -177.4], oct[0]], { h: 4.2, kind: 'ishigaki' }),
    W([oct[0], oct[1], oct[2], oct[3]], { h: 5 }),
    W([oct[4], oct[5], oct[6], oct[7]], { h: 5 }),
    { type: 'gate', id: 'c-outer', style: 'castle', x: AX, z: -80.5, rot: 0, w: 7, open: true },
    { type: 'gate', id: 'c-inner', style: 'castle', x: AX, z: -120.6, rot: 0, w: 8, open: false },
    { type: 'gate', id: 'c-stair', style: 'castle', x: AX, z: -160.6, rot: 0, w: 9.2, open: false },
    { type: 'tower', kind: 'yagura', x: 344.5, z: -80.5 },
    { type: 'tower', kind: 'yagura', x: 399.5, z: -80.5 },
    { type: 'tower', kind: 'yagura', x: 347.6, z: -160.6, tall: true },
    { type: 'tower', kind: 'yagura', x: 396.4, z: -160.6, tall: true },
    { type: 'keep', x: AX, z: -234, rot: 0, s: 1 },
    { type: 'tower', kind: 'yagura', x: 345, z: -224, tall: true },
    { type: 'tower', kind: 'yagura', x: 399, z: -224, tall: true },
    // approach
    { type: 'banner', x: AX - 5.4, z: -66, color: '#a51d22', h: 7, mon: 'oni' },
    { type: 'banner', x: AX + 5.4, z: -66, color: '#a51d22', h: 7, mon: 'oni' },
    { type: 'banner', x: AX - 5.4, z: -75, color: '#c9a34a', h: 7, mon: 'oni' },
    { type: 'banner', x: AX + 5.4, z: -75, color: '#c9a34a', h: 7, mon: 'oni' },
    { type: 'torch', x: AX - 4.6, z: -78.4 }, { type: 'torch', x: AX + 4.6, z: -78.4 },
    // water garden
    { type: 'pavilion', x: 353.5, z: -88.6, rot: 0.6 },
    { type: 'garden', x: 388, z: -112, r: 4.6 },
    { type: 'garden', x: 352.5, z: -113.2, r: 3.6 },
    // great lanterns in pairs at each end of the garden bridge, a step off its parapets, turned to the way across
    { type: 'lantern', x: AX - 3.4, z: -95.4, rot: Math.PI / 2, kind: 'stone', big: true },
    { type: 'lantern', x: AX + 3.4, z: -95.4, rot: -Math.PI / 2, kind: 'stone', big: true },
    { type: 'lantern', x: AX - 3.4, z: -106.6, rot: Math.PI / 2, kind: 'stone', big: true },
    { type: 'lantern', x: AX + 3.4, z: -106.6, rot: -Math.PI / 2, kind: 'stone', big: true },
    // snow-viewing lanterns stand at the water's edge, looking over it: two on the koi pond's rim, one on the stream bank
    { type: 'lantern', x: 383.48, z: -93.06, rot: 2.29, kind: 'yukimi' },
    { type: 'lantern', x: 393.08, z: -102.4, rot: -0.75, kind: 'yukimi' },
    { type: 'lantern', x: 361.4, z: -100.1, rot: 0, kind: 'yukimi' },
    { type: 'rocks', x: 383.4, z: -102.6, n: 3, s: 0.9 },
    { type: 'rocks', x: 393.6, z: -92.4, n: 3, s: 1.0 },
    { type: 'rocks', x: 349.6, z: -100.8, n: 2, s: 0.8 },
    { type: 'torch', x: AX - 5.2, z: -117.6 }, { type: 'torch', x: AX + 5.2, z: -117.6 },
    // inner court: barracks either side, banners down the axis
    { type: 'barracks', x: 354.4, z: -134, rot: Math.PI / 2 },
    { type: 'barracks', x: 354.4, z: -150.4, rot: Math.PI / 2 },
    { type: 'barracks', x: 389.6, z: -134, rot: -Math.PI / 2 },
    { type: 'barracks', x: 389.6, z: -150.4, rot: -Math.PI / 2 },
    { type: 'rack', x: 361.6, z: -127.2, rot: 0 },
    { type: 'rack', x: 382.4, z: -127.2, rot: 0 },
    { type: 'brazier', x: 363, z: -156.4 }, { type: 'brazier', x: 381, z: -156.4 },
    { type: 'banner', x: 362.4, z: -142, color: '#a51d22', h: 7.5, mon: 'oni' },
    { type: 'banner', x: 381.6, z: -142, color: '#a51d22', h: 7.5, mon: 'oni' },
    { type: 'banner', x: 365.4, z: -164, color: '#c9a34a', h: 7.5, mon: 'oni' },
    { type: 'banner', x: 378.6, z: -164, color: '#c9a34a', h: 7.5, mon: 'oni' },
    { type: 'banner', x: 365.4, z: -172, color: '#a51d22', h: 7.5, mon: 'oni' },
    { type: 'banner', x: 378.6, z: -172, color: '#a51d22', h: 7.5, mon: 'oni' },
    // the arena
    { type: 'emblem', x: ARENA.x, z: ARENA.z, r: 9.5 },
    ...ring,
    { type: 'banner', x: 355.6, z: -211.6, color: '#a51d22', h: 9, mon: 'oni' },
    { type: 'banner', x: 388.4, z: -211.6, color: '#a51d22', h: 9, mon: 'oni' },
    { type: 'banner', x: 352, z: -190, color: '#c9a34a', h: 9, mon: 'oni' },
    { type: 'banner', x: 392, z: -190, color: '#c9a34a', h: 9, mon: 'oni' },
    { type: 'checkpoint', x: 366.8, z: -85.6, rot: 0.6 },
    { type: 'checkpoint', x: 366.4, z: -128.6, rot: 0.6 },
    { type: 'checkpoint', x: 366.2, z: -180.6, rot: 0.6 },
    { type: 'pickup', id: 'c-pavilion', kind: 'life', x: 356.4, z: -91.4 },
    { type: 'embers', x: ARENA.x, z: ARENA.z, r: 22 },
  ],
  trees: [
    ['pine', 350, -86, 1.3], ['momiji', 362, -86, 1.05], ['pine', 394, -86, 1.4], ['momiji', 383, -86.4, 1.0], ['momiji', 395, -110, 1.2],
    ['pine', 348.5, -108.5, 1.2], ['momiji', 362.5, -113.5, 0.95], ['sakura', 381, -113.4, 1.0], ['pine', 338, -74, 1.6], ['pine', 406, -74, 1.6],
    ['momiji', 352, -128, 0.9], ['momiji', 392, -128, 0.9],
  ],

  checkpoints: [
    { id: 'castle-gate', x: 369, z: -86, yaw: Math.PI, label: 'Castle gate' },
    { id: 'castle-court', x: 369, z: -129.6, yaw: Math.PI, label: 'Inner court' },
    { id: 'castle-summit', x: 369, z: -181.4, yaw: Math.PI, label: 'Below the keep' },
  ],
  encounters: [
    {
      id: 'c-garden', label: 'The water garden', trigger: { x: AX, z: -88, r: 5.5 }, arena: { x: AX, z: -100.5, r: 32 }, intro: 'ambush', caption: ['近衛', 'The household guard'],
      waves: [
        { max: 2, list: [['elite', 366, -109], ['elite', 378, -109], ['spear', 360, -93], ['spear', 384, -106]] },
        { max: 3, label: 'Guard the lord!', list: [['elite', 364, -112], ['elite', 380, -112], ['elite', 372, -110], ['spear', 357, -110]] },
      ],
      locks: ['c-outer'], opens: ['c-inner'], checkpoint: 'castle-court', done: 'The inner gate opens.',
    },
    {
      id: 'c-court', label: 'The inner court', trigger: { x: AX, z: -131, r: 5.5 }, arena: { x: AX, z: -142, r: 29 },
      waves: [
        { max: 2, list: [['spear', 364, -150], ['spear', 380, -150], ['elite', 366, -142], ['elite', 378, -142]] },
        { max: 3, label: 'From the barracks', list: [['elite', 360, -134], ['elite', 384, -134], ['elite', 372, -153], ['spear', 362, -150]] },
        { max: 3, label: 'The last of the guard', list: [['elite', 364, -146], ['elite', 380, -146], ['elite', 372, -154], ['spear', 360, -138], ['spear', 384, -138]] },
      ],
      locks: ['c-inner'], opens: ['c-stair'], checkpoint: 'castle-summit', done: 'Nothing stands between you and the keep.',
    },
    {
      id: 'c-lord', label: 'Onikage', trigger: { x: AX, z: -187.5, r: 6 }, arena: ARENA, intro: 'boss', boss: 'lord', finisher: true, final: true, locks: ['c-stair'],
      caption: ['鬼影', 'Onikage · Lord of the Black Fang'], line: 'You climbed all this way to die at the top. Come, then.',
      waves: [{ max: 1, list: [['lord', AX, -210]] }],
    },
  ],
  camera: [
    { x: AX, z: -70, r: 10, yaw: 0, dist: 13, pitch: 0.66 },
    { x: AX, z: -100, r: 20, yaw: 0, dist: 14, pitch: 0.88 },
    { x: AX, z: -121, r: 5, yaw: 0, dist: 13, pitch: 0.7 },
    { x: AX, z: -142, r: 17, yaw: 0, dist: 14, pitch: 0.88 },
    { x: AX, z: -168, r: 9, yaw: 0, dist: 13, pitch: 0.5 },
    { x: ARENA.x, z: ARENA.z, r: 18, yaw: 0, dist: 14.6, pitch: 0.84 },
  ],
  lighting: light({
    sun: [38, -30], sunColor: '#9fb4ff', sunI: 1.9,
    skyTop: '#121836', skyHorizon: '#8a4a5e', cloudLit: '#c98a8a', cloudShade: '#2a2444', coverage: 0.56,
    hemiSky: '#9aa6e6', hemiGround: '#6a5560', hemiI: 1.45,
    fog: '#3d2f4c', fogD: 0.0072, wind: 1.5, sat: 1.12, contrast: 1.06, tint: '#f0eaff', shafts: 0.0, bloom: 1.0, glow: 1.6,
  }),
  audio: { falls: 0, river: 0.15, wind: 0.22, birds: 0, fire: 0.8 },
};
