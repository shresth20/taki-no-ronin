import { create } from 'zustand';

/** React-facing UI state. The simulation itself lives in the mutable `G` object below. */
export const useUI = create((set) => ({
  phase: 'loading', // loading | title | intro | training | ambush | combat | finisher | victory | defeat
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
  isTouch: false,
  locked: false,
  stats: null,
  physics: '',
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
};

export const QUALITY = {
  high: { dpr: 2, shadow: 2048, reflect: 640, grass: 68000, petals: 700, bloom: true, msaa: 4 },
  medium: { dpr: 1.5, shadow: 1024, reflect: 384, grass: 38000, petals: 450, bloom: true, msaa: 0 },
  low: { dpr: 1, shadow: 0, reflect: 0, grass: 16000, petals: 220, bloom: false, msaa: 0 },
};

if (typeof window !== 'undefined') { window.__G = G; window.__ui = getUI; }
