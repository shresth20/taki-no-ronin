import { create } from 'zustand';

/** React-facing UI state. The simulation itself lives in the mutable `G` object below. */
export const useUI = create((set) => ({
  phase: 'loading', // loading | title | intro | training | explore | ambush | combat | finisher | victory | defeat
  paused: false,
  hp: 100,
  hpMax: 100,
  ki: 0,
  combo: 0,
  comboAt: 0,
  enemiesLeft: 0,
  enemiesTotal: 0,
  wave: 0,
  boss: null, // { name, hp, hpMax }
  subtitle: null,
  caption: null, // { kanji, text, id }
  prompt: null, // { title, text, done, total }
  toast: null, // { text, tone, id }
  letterbox: false,
  canSkip: false,
  hurtAt: 0,
  quality: 'high',
  sound: true,
  camView: (() => { try { return localStorage.getItem('tnr-camview') || 'mid'; } catch { return 'mid'; } })(), // high | mid | eye
  isTouch: false,
  locked: false,
  stats: null,
  physics: '',
  zone: 0, // index of the zone the player is in
  zoneCard: null, // { kanji, name, sub, id } shown on entering a zone
  objective: '',
  map: false, // overview map open
  progress: { zones: [true, false, false, false, false, false], cleared: [], checkpoint: 'falls', pickups: [] },
  hasSave: false,
  debug: false,
  set,
}));
export const ui = (patch) => useUI.setState(patch);
export const getUI = () => useUI.getState();

/** Mutable game context shared by the imperative modules (no React re-renders). */
export const G = {
  time: 0, // scaled game time
  real: 0, // unscaled time
  dt: 0,
  rdt: 0,
  timeScale: 1,
  enemyTime: 1,
  hitstop: 0,
  mood: 0, // 0 calm morning, 1 storm of battle, 2 golden victory
  quality: null,
  camera: null,
  scene: null,
  gl: null,
  player: null,
  enemies: [],
  world: null,
  vfx: null,
  physics: null,
  audio: null,
  director: null,
  rig: null, // camera rig
  input: null,
  post: { flash: 0, desat: 0, aberration: 0, invert: 0, vignette: 0.42, speed: 0 },
  test: typeof location !== 'undefined' && /[?&]test/.test(location.search),
  // tester tools (?dev=1): the journey map becomes a teleporter, and it opens from the title too
  dev: typeof location !== 'undefined' && (() => { const v = new URLSearchParams(location.search).get('dev'); return v !== null && v !== '0' && v !== 'false'; })(),
};

export const QUALITY = {
  high: { dpr: 2, shadow: 2048, reflect: 640, grass: 68000, petals: 700, bloom: true, msaa: 4, terrainStep: 1, plantK: 1 },
  medium: { dpr: 1.5, shadow: 1024, reflect: 384, reflectEvery: 2, grass: 38000, petals: 450, bloom: true, msaa: 0, terrainStep: 1, plantK: 0.7 },
  low: { dpr: 1, shadow: 0, reflect: 0, grass: 16000, petals: 220, bloom: false, msaa: 0, terrainStep: 2, plantK: 0.4 },
};

if (typeof window !== 'undefined') { window.__G = G; window.__ui = getUI; }
