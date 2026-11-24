import { makePose, makeClip, swordQuat, eulerQ } from './animator.js';
import { lerp, saturate, DEG } from '../core/util.js';

/* All hand positions are in CHEST space: +X = the character's left, +Y up the spine, +Z forward.
   Right shoulder sits at (-0.19, 0.17, 0); arm reach is about 0.54.
   Clip fields:  hit:[t0,t1] active window · cancel: earliest combo/dodge cancel · lunge: forward travel
                 stiff: pose spring stiffness while the clip plays                                        */

/* ---------- player ---------- */
const GUARD = {
  hp: [0, 0.9, 0], hr: [3, -12, 0], sp: [5, 6, 0], hd: [-3, 6, 0],
  rh: [-0.07, -0.2, 0.25], bl: [0.1, 0.45, 0.88], ed: [0, -0.9, 0.45], lh: 'g',
  lf: [0.13, 0, 0.22, 8], rf: [-0.15, 0, -0.24, -32], brow: 0.7, lid: 0.92,
};
export const P_GUARD = makePose(GUARD);

const P = (def) => makeClip(def, P_GUARD);
export const PLAYER_CLIPS = {
  // 1: diagonal cut, upper right to lower left
  light1: P({ dur: 0.4, hit: [0.1, 0.21], cancel: 0.24, lunge: 0.9, stiff: 34, dmg: 10, arcDeg: 85, reach: 2.25, slash: { roll: -42, yaw: 8, y: 1.25 },
    keys: [
      { t: 0.09, e: 'out', hp: [0, 0.92, -0.03], hr: [0, -32, 0], sp: [-4, -24, 0], rh: [-0.26, 0.38, -0.02], bl: [-0.25, 0.75, -0.6], ed: [0.3, 0.5, 0.8], lh: 'g', lf: [0.13, 0, 0.2, 8], rf: [-0.16, 0, -0.28, -35], brow: 1 },
      { t: 0.16, e: 'lin', arc: 1, hp: [0, 0.88, 0.1], hr: [4, 6, 0], sp: [8, 10, 0], rh: [-0.02, 0.0, 0.46], bl: [0.35, 0.3, 0.89], ed: [0.5, -0.8, 0.3], rf: [-0.14, 0.03, 0.2, 0], lf: [0.14, 0, -0.1, 20] },
      { t: 0.22, e: 'out', arc: 1, hr: [6, 30, 0], sp: [10, 28, 0], rh: [0.06, -0.26, 0.3], bl: [0.75, -0.5, 0.43], ed: [0.5, -0.6, -0.6], rf: [-0.14, 0, 0.3, 0], lf: [0.14, 0, -0.2, 25] },
      { t: 0.4, hr: [5, 26, 0], sp: [8, 22, 0], rh: [0.05, -0.27, 0.28], bl: [0.72, -0.52, 0.4], ed: [0.5, -0.6, -0.6] },
    ] }),
  // 2: horizontal return cut, left to right
  light2: P({ dur: 0.38, hit: [0.09, 0.2], cancel: 0.23, lunge: 0.8, stiff: 34, dmg: 10, arcDeg: 95, reach: 2.3, slash: { roll: 172, yaw: -6, y: 1.2 },
    keys: [
      { t: 0.08, e: 'out', hp: [0, 0.88, 0], hr: [3, 34, 0], sp: [4, 30, 0], rh: [0.12, -0.12, 0.25], bl: [0.85, 0.15, -0.5], ed: [0, 0, 1], lh: [0.3, -0.26, -0.02], lf: [0.15, 0, 0.1, 15], rf: [-0.16, 0, -0.2, -30] },
      { t: 0.15, e: 'lin', arc: 1, hr: [4, -5, 0], sp: [6, -6, 0], rh: [-0.1, -0.08, 0.44], bl: [0.05, 0.05, 1], ed: [-1, 0, 0], lf: [0.15, 0.03, 0.24, 5] },
      { t: 0.21, e: 'out', arc: 1, hr: [4, -34, 0], sp: [6, -30, 0], rh: [-0.42, -0.05, 0.18], bl: [-0.9, 0.1, 0.42], ed: [-0.4, 0, -0.9], lf: [0.15, 0, 0.32, 0] },
      { t: 0.38, hr: [4, -38, 0], sp: [6, -32, 0], rh: [-0.44, -0.06, 0.08], bl: [-0.86, 0.1, -0.5], ed: [0, 0, -1] },
    ] }),
  // 3: rising cut, lower right to upper left
  light3: P({ dur: 0.4, hit: [0.1, 0.21], cancel: 0.25, lunge: 0.9, stiff: 34, dmg: 12, arcDeg: 85, reach: 2.3, slash: { roll: 128, yaw: 4, y: 1.25 },
    keys: [
      { t: 0.08, e: 'out', hp: [0, 0.83, 0], hr: [8, -28, 0], sp: [10, -24, 0], rh: [-0.3, -0.34, 0.1], bl: [-0.55, -0.6, -0.58], ed: [0.5, 0.6, 0.6], lh: 'g', lf: [0.14, 0, 0.26, 5], rf: [-0.17, 0, -0.26, -35] },
      { t: 0.15, e: 'lin', arc: 1, hp: [0, 0.9, 0.08], hr: [0, 5, 0], sp: [0, 8, 0], rh: [0.0, 0.02, 0.46], bl: [0.2, 0.25, 0.95], ed: [0.6, 0.75, -0.2] },
      { t: 0.21, e: 'out', arc: 1, hp: [0, 0.96, 0.1], hr: [-4, 28, 0], sp: [-8, 26, 0], rh: [0.12, 0.42, 0.2], bl: [0.5, 0.8, -0.3], ed: [0.3, 0.2, -0.9], rf: [-0.14, 0, 0.1, -10] },
      { t: 0.4, hr: [-3, 24, 0], sp: [-6, 22, 0], rh: [0.12, 0.4, 0.16], bl: [0.5, 0.78, -0.4], ed: [0.3, 0.2, -0.9] },
    ] }),
  // 4: two-handed overhead finisher
  light4: P({ dur: 0.56, hit: [0.19, 0.3], cancel: 0.38, lunge: 1.4, stiff: 36, dmg: 18, arcDeg: 60, reach: 2.5, knock: 1, slam: 1, slash: { roll: -90, yaw: 0, y: 1.35 },
    keys: [
      { t: 0.14, e: 'out', hp: [0, 1.0, 0], hr: [-6, 0, 0], sp: [-14, 0, 0], hd: [-6, 0, 0], rh: [0.0, 0.48, -0.08], bl: [0, 0.35, -0.94], ed: [0, 0.94, 0.35], lh: 'g', lf: [0.11, 0.07, 0.1], rf: [-0.11, 0.1, -0.05] },
      { t: 0.22, e: 'lin', arc: 1, hp: [0, 0.92, 0.08], sp: [10, 0, 0], rh: [0, 0.05, 0.48], bl: [0, 0.3, 0.95], ed: [0, -0.95, 0.3], lf: [0.15, 0.02, 0.3], rf: [-0.15, 0.04, -0.2, -25] },
      { t: 0.28, e: 'out', arc: 1, hp: [0, 0.78, 0.16], hr: [16, 0, 0], sp: [22, 0, 0], hd: [-14, 0, 0], rh: [0, -0.3, 0.38], bl: [0, -0.45, 0.89], ed: [0, -0.89, -0.45], lf: [0.16, 0, 0.36], rf: [-0.16, 0, -0.3, -30] },
      { t: 0.56, hp: [0, 0.8, 0.14], hr: [14, 0, 0], sp: [18, 0, 0] },
    ] }),
  // heavy 1: coiled wide sweep, right to left, breaks guards
  heavy1: P({ dur: 0.74, hit: [0.33, 0.47], cancel: 0.52, lunge: 1.5, stiff: 30, dmg: 28, arcDeg: 140, reach: 2.8, heavy: 1, knock: 1, slash: { roll: 4, yaw: 0, y: 1.15, scale: 1.45 },
    keys: [
      { t: 0.28, e: 'out', hp: [0, 0.8, -0.06], hr: [6, -50, 0], sp: [8, -40, 0], hd: [0, 50, 0], rh: [-0.36, -0.12, -0.12], bl: [-0.5, 0.1, -0.86], ed: [-0.8, 0, 0.5], lh: [0.2, -0.1, 0.3], lf: [0.14, 0, 0.3, 5], rf: [-0.2, 0, -0.3, -50], brow: 1 },
      { t: 0.37, e: 'lin', arc: 1, hp: [0, 0.84, 0.12], hr: [6, 0, 0], sp: [8, 10, 0], hd: [0, 0, 0], rh: [-0.2, -0.1, 0.42], bl: [-0.35, 0, 0.94], ed: [1, 0, 0.35], lh: [0.3, -0.2, 0] },
      { t: 0.45, e: 'out', arc: 1, hr: [6, 48, 0], sp: [8, 40, 0], hd: [0, -40, 0], rh: [0.14, -0.1, 0.34], bl: [0.9, 0, 0.44], ed: [0.44, 0, -0.9], rf: [-0.12, 0, 0.38, 0], lf: [0.18, 0, -0.24, 30] },
      { t: 0.52, hr: [6, 58, 0], sp: [8, 44, 0], rh: [0.16, -0.1, 0.26], bl: [0.82, 0.05, -0.58], ed: [0, 0, -1] },
      { t: 0.74, hr: [5, 50, 0], sp: [7, 38, 0] },
    ] }),
  // heavy 2: leaping overhead slam with a shockwave
  heavy2: P({ dur: 0.86, hit: [0.4, 0.52], cancel: 0.62, lunge: 2.2, stiff: 30, dmg: 34, arcDeg: 70, reach: 2.9, heavy: 1, knock: 1, slam: 2, hop: 0.9, slash: { roll: -90, yaw: 0, y: 1.5, scale: 1.5 },
    keys: [
      { t: 0.14, e: 'out', hp: [0, 0.76, 0], hr: [10, 0, 0], sp: [10, 0, 0], rh: [-0.1, -0.3, 0.2], bl: [0.1, -0.5, 0.85], ed: [0, -0.85, -0.5], lh: 'g', lf: [0.13, 0, 0.1], rf: [-0.13, 0, -0.1] },
      { t: 0.34, e: 'out', hp: [0, 1.02, 0], hr: [-10, 0, 0], sp: [-20, 0, 0], hd: [-4, 0, 0], rh: [0.0, 0.5, -0.1], bl: [0, 0.25, -0.97], ed: [0, 0.97, 0.25], lf: [0.11, 0.2, 0.2], rf: [-0.11, 0.26, -0.12] },
      { t: 0.42, e: 'lin', arc: 1, hp: [0, 0.92, 0.1], sp: [12, 0, 0], rh: [0, 0.05, 0.48], bl: [0, 0.3, 0.95], ed: [0, -0.95, 0.3], lf: [0.16, 0.05, 0.34], rf: [-0.15, 0.08, -0.2] },
      { t: 0.48, e: 'out', arc: 1, hp: [0, 0.7, 0.2], hr: [20, 0, 0], sp: [26, 0, 0], hd: [-18, 0, 0], rh: [0, -0.3, 0.38], bl: [0, -0.52, 0.85], ed: [0, -0.85, -0.52], lf: [0.18, 0, 0.42], rf: [-0.18, 0, -0.34, -30] },
      { t: 0.86, hp: [0, 0.74, 0.16], hr: [16, 0, 0], sp: [20, 0, 0] },
    ] }),
  // dash attack: iai-style draw cut through the target
  dash: P({ dur: 0.46, hit: [0.07, 0.24], cancel: 0.3, lunge: 4.6, stiff: 38, dmg: 16, arcDeg: 110, reach: 2.4, slash: { roll: 176, yaw: 0, y: 1.1, scale: 1.25 },
    keys: [
      { t: 0.06, e: 'out', hp: [0, 0.76, 0.08], hr: [12, 26, 0], sp: [14, 22, 0], hd: [-12, -40, 0], rh: [0.12, -0.3, 0.16], bl: [0.3, -0.2, -0.93], ed: [0.9, 0, 0.3], lh: [0.2, -0.36, 0.08], lf: [0.12, 0, -0.34, 20], rf: [-0.14, 0, 0.4, 0], brow: 1 },
      { t: 0.14, e: 'lin', arc: 1, hr: [10, -20, 0], sp: [12, -25, 0], hd: [-8, 20, 0], rh: [-0.3, -0.04, 0.38], bl: [-0.6, 0.1, 0.8], ed: [-0.8, 0, -0.6] },
      { t: 0.2, e: 'out', arc: 1, hr: [8, -40, 0], sp: [10, -30, 0], rh: [-0.44, 0.05, 0.05], bl: [-0.95, 0.15, -0.3], ed: [0.2, 0, -1] },
      { t: 0.46, hp: [0, 0.8, 0.06], hr: [8, -36, 0], sp: [8, -26, 0] },
    ] }),
  // counter after a parry: explosive rising cut
  counter: P({ dur: 0.5, hit: [0.07, 0.2], cancel: 0.3, lunge: 1.6, stiff: 40, dmg: 36, arcDeg: 110, reach: 2.7, knock: 1, heavy: 1, slash: { roll: 118, yaw: 0, y: 1.3, scale: 1.5 },
    keys: [
      { t: 0.05, e: 'out', hp: [0, 0.78, 0], hr: [10, -30, 0], sp: [12, -26, 0], rh: [-0.3, -0.34, 0.1], bl: [-0.55, -0.6, -0.58], ed: [0.5, 0.6, 0.6], lh: 'g', lf: [0.14, 0, 0.3, 5], rf: [-0.17, 0, -0.3, -35], brow: 1 },
      { t: 0.12, e: 'lin', arc: 1, hp: [0, 0.92, 0.1], hr: [0, 5, 0], sp: [0, 8, 0], rh: [0.0, 0.04, 0.46], bl: [0.2, 0.25, 0.95], ed: [0.6, 0.75, -0.2] },
      { t: 0.18, e: 'out', arc: 1, hp: [0, 1.0, 0.12], hr: [-6, 32, 0], sp: [-10, 30, 0], rh: [0.12, 0.44, 0.18], bl: [0.5, 0.8, -0.3], ed: [0.3, 0.2, -0.9], rf: [-0.14, 0, 0.14, -10] },
      { t: 0.5, hr: [-4, 26, 0], sp: [-8, 24, 0] },
    ] }),
  // plunging attack while airborne (held until landing), then the landing slam
  airPlunge: P({ dur: 0.2, loop: false, stiff: 30,
    keys: [{ t: 0.12, e: 'out', hp: [0, 0.92, 0], hr: [14, 0, 0], sp: [-8, 0, 0], hd: [10, 0, 0], rh: [0.0, 0.46, 0.02], bl: [0, 0.5, -0.86], ed: [0, 0.86, 0.5], lh: 'g', fs: 'h', lf: [0.11, -0.5, 0.2], rf: [-0.11, -0.62, -0.22], brow: 1 }] }),
  airSlam: P({ dur: 0.5, hit: [0.0, 0.1], cancel: 0.32, stiff: 40, dmg: 24, arcDeg: 180, reach: 2.9, knock: 1, slam: 2, heavy: 1, slash: { roll: -90, yaw: 0, y: 1.3, scale: 1.4 },
    keys: [
      { t: 0.06, e: 'out', arc: 1, hp: [0, 0.66, 0.16], hr: [22, 0, 0], sp: [26, 0, 0], hd: [-18, 0, 0], rh: [0, -0.3, 0.38], bl: [0, -0.55, 0.83], ed: [0, -0.83, -0.55], lh: 'g', lf: [0.18, 0, 0.4], rf: [-0.18, 0, -0.34, -30] },
      { t: 0.5, hp: [0, 0.74, 0.12], hr: [16, 0, 0], sp: [18, 0, 0] },
    ] }),
  jumpUp: P({ dur: 0.3, stiff: 22, keys: [{ t: 0.1, e: 'out', hp: [0, 0.94, 0], hr: [6, 0, 0], sp: [4, 0, 0], rh: [-0.3, -0.26, -0.06], bl: [-0.2, -0.3, -0.93], ed: [0, -0.9, 0.3], lh: [0.3, -0.16, 0.1], fs: 'h', lf: [0.1, -0.52, 0.16], rf: [-0.1, -0.64, -0.12] }] }),
  jumpFall: P({ dur: 0.3, stiff: 16, keys: [{ t: 0.1, e: 'out', hp: [0, 0.94, 0], hr: [-4, 0, 0], sp: [6, 0, 0], rh: [-0.34, -0.1, -0.02], bl: [-0.3, 0.5, -0.8], ed: [0, -0.8, -0.5], lh: [0.34, -0.02, 0.06], fs: 'h', lf: [0.11, -0.74, 0.1], rf: [-0.11, -0.66, -0.08] }] }),
  // guard: blade across the body, left palm bracing the spine of the sword
  block: P({ dur: 0.2, upper: true, stiff: 30, keys: [{ t: 0.08, e: 'out', hp: [0, 0.86, -0.02], hr: [2, -8, 0], sp: [6, 4, 0], hd: [-2, 4, 0], rh: [-0.14, 0.02, 0.36], bl: [0.85, 0.5, 0.15], ed: [-0.1, 0.3, 0.95], lh: [0.2, 0.2, 0.4], brow: 1 }] }),
  parry: P({ dur: 0.3, stiff: 44, keys: [
    { t: 0.06, e: 'out', hp: [0, 0.88, 0.04], hr: [2, -24, 0], sp: [4, -22, 0], rh: [-0.34, 0.18, 0.3], bl: [-0.3, 0.9, 0.3], ed: [-0.9, -0.2, 0.3], lh: [0.24, -0.1, 0.24], brow: 1 },
    { t: 0.3, hr: [2, -16, 0], sp: [4, -14, 0], rh: [-0.3, 0.12, 0.3] },
  ] }),
  hit: P({ dur: 0.36, stiff: 26, keys: [
    { t: 0.07, e: 'out', hp: [0, 0.88, -0.14], hr: [-10, 12, 0], sp: [-18, -10, 6], hd: [14, -20, 0], rh: [-0.3, -0.2, 0.12], bl: [-0.3, 0.6, 0.7], ed: [0, -0.7, 0.6], lh: [0.32, -0.1, 0.16], lf: [0.16, 0, 0.1, 10], rf: [-0.18, 0, -0.32, -30], brow: -0.6, lid: 0.5 },
    { t: 0.36, hp: [0, 0.9, -0.06], hr: [-2, 4, 0], sp: [-4, 0, 0], hd: [2, 0, 0], brow: 0.7, lid: 0.9 },
  ] }),
  roll: P({ dur: 0.5, stiff: 26, keys: [{ t: 0.08, e: 'out', hp: [0, 0.5, 0], hr: [38, 0, 0], sp: [52, 0, 0], hd: [30, 0, 0], rh: [-0.2, -0.24, 0.26], bl: [-0.55, -0.25, -0.8], ed: [0, -0.9, 0.3], lh: [0.2, -0.24, 0.26], fs: 'h', lf: [0.11, -0.34, 0.22], rf: [-0.11, -0.36, 0.18] }] }),
  dead: P({ dur: 1.0, stiff: 8, keys: [{ t: 0.3, e: 'out', hp: [0, 0.3, -0.2], hr: [-80, 10, 0], sp: [-10, 0, 0], hd: [-10, 30, 0], rh: [-0.4, -0.1, 0.1], bl: [-0.9, 0, 0.3], ed: [0, 1, 0], lh: [0.42, -0.05, 0.1], fs: 'h', lf: [0.16, -0.78, 0.1], rf: [-0.14, -0.7, 0.2], lid: 0.08, brow: 0 }] }),
  // special: sheathed crouch -> flash step -> held follow-through -> slow sheathe
  spCharge: P({ dur: 0.4, stiff: 22, keys: [{ t: 0.2, e: 'out', hp: [0, 0.72, 0.04], hr: [14, 28, 0], sp: [16, 22, 0], hd: [-16, -44, 0], rh: [0.13, -0.3, 0.15], bl: [0.3, -0.22, -0.93], ed: [0.9, 0, 0.3], lh: [0.2, -0.38, 0.06], lf: [0.13, 0, -0.38, 25], rf: [-0.14, 0, 0.42, 0], brow: 1, lid: 0.7 }] }),
  spSlash: P({ dur: 0.9, stiff: 46, keys: [
    { t: 0.05, e: 'out', arc: 1, hp: [0, 0.74, 0.1], hr: [10, -30, 0], sp: [12, -32, 0], hd: [-6, 30, 0], rh: [-0.42, 0.1, 0.16], bl: [-0.93, 0.2, 0.3], ed: [-0.3, 0, -0.95], lh: [0.24, -0.34, 0.02], lf: [0.14, 0, -0.4, 25], rf: [-0.14, 0, 0.44, 0], brow: 1 },
    { t: 0.9, hr: [10, -34, 0], sp: [12, -34, 0], rh: [-0.44, 0.12, 0.1], bl: [-0.95, 0.22, 0.2], ed: [-0.2, 0, -1] },
  ] }),
  // chiburi + noto: flick the blade clean, return it to the scabbard
  sheathe: P({ dur: 2.3, stiff: 14, keys: [
    { t: 0.0, hp: [0, 0.94, 0], hr: [0, -10, 0], sp: [2, -6, 0], hd: [0, 0, 0], rh: [-0.2, -0.1, 0.34], bl: [-0.2, 0.3, 0.93], ed: [0, -0.93, 0.3], lh: [0.2, -0.4, 0.08], lf: [0.12, 0, 0.1, 5], rf: [-0.13, 0, -0.1, -20], brow: 0.5 },
    { t: 0.28, e: 'in', arc: 1, rh: [-0.36, -0.26, 0.2], bl: [-0.5, -0.72, 0.48], ed: [-0.7, -0.2, -0.7], hr: [0, -18, 0], sp: [2, -14, 0] },
    { t: 0.8, hr: [0, -18, 0], rh: [-0.36, -0.27, 0.2] },
    { t: 1.35, e: 'io', arc: 1, hp: [0, 0.95, 0], hr: [0, 14, 0], sp: [3, 12, 0], hd: [6, -10, 0], rh: [0.02, -0.14, 0.34], bl: [0.42, -0.3, -0.86], ed: [0.8, 0.3, 0.3], lh: [0.19, -0.37, 0.08], brow: 0.2, lid: 0.5 },
    { t: 1.95, e: 'io', rh: [0.15, -0.27, 0.2], bl: [0.3, -0.33, -0.9], ed: [0.8, 0.3, 0.3], lid: 0.12 },
    { t: 2.3, rh: [0.16, -0.3, 0.14], hd: [8, -6, 0], lid: 0.08, brow: 0 },
  ] }),
  // drawing the sword from the hip into the guard
  draw: P({ dur: 0.75, stiff: 22, keys: [
    { t: 0.0, hp: [0, 0.95, 0], hr: [0, 12, 0], sp: [4, 10, 0], rh: [0.15, -0.28, 0.16], bl: [0.3, -0.33, -0.9], ed: [0.8, 0.3, 0.3], lh: [0.19, -0.37, 0.08], lf: [0.12, 0, 0.06], rf: [-0.12, 0, -0.06, -15], brow: 0.6, lid: 0.9 },
    { t: 0.22, e: 'in', hp: [0, 0.86, 0.02], hr: [6, 22, 0], sp: [8, 18, 0], rh: [0.13, -0.3, 0.15] },
    { t: 0.36, e: 'lin', arc: 1, hr: [4, -16, 0], sp: [6, -20, 0], rh: [-0.3, 0.06, 0.38], bl: [-0.6, 0.3, 0.74], ed: [-0.7, 0, -0.7], rf: [-0.15, 0, -0.26, -32], lf: [0.13, 0, 0.24, 8] },
    { t: 0.75, e: 'io', ...GUARD },
  ] }),
  calm: P({ dur: 0.3, stiff: 8, keys: [{ t: 0.1, hp: [0, 0.975, 0], hr: [0, 0, 0], sp: [1, 0, 0], hd: [0, 0, 0], rh: [-0.24, -0.5, 0.03], bl: [0.05, -0.3, 0.95], ed: [0, -0.95, -0.3], lh: [0.19, -0.37, 0.09], lf: [0.11, 0, 0.02, 6], rf: [-0.11, 0, -0.02, -10], brow: 0.15, lid: 1 }] }),
  seiza: P({ dur: 0.3, stiff: 6, keys: [{ t: 0.1, hp: [0, 0.3, 0], hr: [0, 0, 0], sp: [2, 0, 0], hd: [10, 0, 0], rh: [-0.12, -0.32, 0.2], bl: [0.05, -0.3, 0.95], ed: [0, -0.95, -0.3], lh: [0.12, -0.32, 0.2], fs: 'h', lf: [0.1, -0.22, -0.03], rf: [-0.1, -0.22, -0.03], brow: 0, lid: 0.08 }] }),
  rise: P({ dur: 1.2, stiff: 9, keys: [
    { t: 0.0, hp: [0, 0.3, 0], hr: [0, 0, 0], sp: [2, 0, 0], hd: [0, 0, 0], rh: [-0.12, -0.32, 0.2], lh: [0.12, -0.32, 0.2], fs: 'h', lf: [0.1, -0.22, -0.03], rf: [-0.1, -0.22, -0.03], lid: 0.9, brow: 0.4 },
    { t: 0.55, e: 'io', hp: [0, 0.6, 0.06], hr: [14, 0, 0], sp: [10, 0, 0], rh: [-0.2, -0.4, 0.16], lh: [0.19, -0.37, 0.09], fs: 'g', lf: [0.12, 0, 0.26], rf: [-0.12, 0, -0.2] },
    { t: 1.2, e: 'io', hp: [0, 0.975, 0], hr: [0, 0, 0], sp: [1, 0, 0], rh: [-0.24, -0.5, 0.03], lf: [0.11, 0, 0.02, 6], rf: [-0.11, 0, -0.02, -10] },
  ] }),
};

const _q = { v: 0 };
/** procedural player locomotion. s: { speed, mx, mz (local move dir), phase, t, armed } */
export function locoPlayer(out, s) {
  const run = saturate(s.speed / 6.4), mv = saturate(s.speed / 0.9);
  const ph = s.phase, breathe = Math.sin(s.t * 1.7) * 0.006;
  const stride = lerp(0.16, 0.56, run) * mv, lift = (0.05 + run * 0.17) * mv;
  out.copy(P_GUARD);
  out.hipsPos.set(0, lerp(0.9, 0.86, run) + breathe + Math.cos(ph * 2) * 0.022 * run, lerp(0, 0.05, run));
  eulerQ(lerp(3, 15, run) * (0.4 + 0.6 * Math.max(0, s.mz)) - s.mz * 0, lerp(-12, 0, mv) + Math.sin(ph) * 7 * run, -s.mx * run * 9, out.hipsQ);
  eulerQ(lerp(5, 9, run), lerp(6, 0, mv) - Math.sin(ph) * 9 * run, 0, out.spineQ);
  eulerQ(lerp(-3, -10, run), lerp(6, 0, mv), 0, out.headQ);
  for (let i = 0; i < 2; i++) {
    const left = i === 0, c = ph + (left ? 0 : Math.PI);
    const sw = Math.cos(c), up = Math.max(0, -Math.sin(c));
    const f = left ? out.lFoot : out.rFoot;
    const ix = left ? 0.13 : -0.15, iz = left ? 0.22 : -0.24; // guard stance
    const sx = left ? 0.11 : -0.11;
    f.set(lerp(ix, sx + s.mx * stride * sw, mv), lift * up, lerp(iz, s.mz * stride * sw + 0.02, mv));
    if (left) out.lYaw = lerp(8, 0, mv) * DEG;
    else out.rYaw = lerp(-32, 0, mv) * DEG;
  }
  // arms: guard when still, sword trailing low behind when running
  out.rHand.set(lerp(-0.07, -0.33, run), lerp(-0.2, -0.36, run), lerp(0.25, -0.04 + Math.cos(ph) * 0.05, run));
  swordQuat([lerp(0.1, -0.2, run), lerp(0.45, -0.2, run), lerp(0.88, -0.96, run)], [0, lerp(-0.9, -0.95, run), lerp(0.45, 0.2, run)], out.swordQ);
  out.grip = 1 - saturate(run * 2.2);
  out.lHand.set(0.27, -0.4 + Math.abs(Math.cos(ph)) * 0.04, 0.02 + Math.cos(ph) * 0.2 * run);
  out.brow = 0.7;
  out.lid = 0.92;
  return out;
}
/** unarmed walk for cinematics (sword sheathed) */
export function locoCalm(out, s) {
  const mv = saturate(s.speed / 0.6), ph = s.phase;
  const stride = 0.3 * mv, lift = 0.07 * mv;
  out.hipsPos.set(0, 0.975 + Math.sin(s.t * 1.5) * 0.005 + Math.cos(ph * 2) * 0.012 * mv, 0);
  eulerQ(1 + mv * 2, Math.sin(ph) * 5 * mv, 0, out.hipsQ);
  eulerQ(1, -Math.sin(ph) * 6 * mv, 0, out.spineQ);
  eulerQ(0, 0, 0, out.headQ);
  for (let i = 0; i < 2; i++) {
    const left = i === 0, c = ph + (left ? 0 : Math.PI);
    (left ? out.lFoot : out.rFoot).set(left ? 0.1 : -0.1, lift * Math.max(0, -Math.sin(c)), stride * Math.cos(c) * mv + (mv < 0.5 ? (left ? 0.02 : -0.02) : 0));
  }
  out.lYaw = 6 * DEG * (1 - mv);
  out.rYaw = -10 * DEG * (1 - mv);
  out.rHand.set(-0.25, -0.5, 0.03 - Math.cos(ph) * 0.12 * mv);
  swordQuat([0.05, -0.3, 0.95], [0, -0.95, -0.3], out.swordQ);
  out.grip = 0;
  out.lHand.set(0.19, -0.37, 0.09);
  out.brow = 0.15;
  out.lid = 1;
  return out;
}

/* ---------- enemies ---------- */
const E_GUARD = {
  hp: [0, 0.9, 0], hr: [2, -28, 0], sp: [3, -6, 0], hd: [0, 32, 0],
  rh: [-0.2, 0.1, 0.16], bl: [-0.08, 0.97, 0.2], ed: [0.3, 0, 0.95], lh: 'g',
  lf: [0.14, 0, 0.26, 10], rf: [-0.16, 0, -0.26, -40],
};
export const E_GUARD_POSE = makePose(E_GUARD);
const E = (def) => makeClip(def, E_GUARD_POSE);
const S_GUARD = {
  hp: [0, 0.86, 0], hr: [4, -34, 0], sp: [6, -4, 0], hd: [-2, 36, 0],
  rh: [-0.24, -0.22, -0.02], bl: [0.42, 0.2, 0.9], ed: [0, -1, 0.2], lh: 'g',
  lf: [0.14, 0, 0.3, 10], rf: [-0.17, 0, -0.3, -45],
};
export const S_GUARD_POSE = makePose(S_GUARD);
const S = (def) => makeClip(def, S_GUARD_POSE);

export const ENEMY_CLIPS = {
  // overhead cut. tell = moment the windup is fully raised (weapon glints)
  over: E({ dur: 1.0, tell: 0.14, hit: [0.5, 0.6], lunge: 1.5, stiff: 26, dmg: 1, arcDeg: 60, reach: 2.35, slash: { roll: -90, yaw: 0, y: 1.35 },
    keys: [
      { t: 0.3, e: 'out', hp: [0, 0.97, -0.05], hr: [-6, -8, 0], sp: [-12, -6, 0], hd: [2, 10, 0], rh: [-0.04, 0.46, -0.06], bl: [-0.1, 0.5, -0.86], ed: [0, 0.86, 0.5], lh: 'g', lf: [0.13, 0, 0.2, 5], rf: [-0.15, 0, -0.24, -30] },
      { t: 0.46, hp: [0, 0.99, -0.06], sp: [-14, -6, 0] },
      { t: 0.52, e: 'lin', arc: 1, hp: [0, 0.9, 0.08], sp: [8, 4, 0], rh: [0, 0.05, 0.47], bl: [0.05, 0.3, 0.95], ed: [0, -0.95, 0.3], rf: [-0.14, 0.04, 0.16, 0], lf: [0.14, 0, -0.06, 20] },
      { t: 0.58, e: 'out', arc: 1, hp: [0, 0.8, 0.14], hr: [14, 4, 0], sp: [20, 8, 0], hd: [-12, 0, 0], rh: [0.02, -0.3, 0.38], bl: [0.1, -0.45, 0.89], ed: [0, -0.89, -0.45], rf: [-0.14, 0, 0.34, 0], lf: [0.15, 0, -0.24, 25] },
      { t: 1.0, hp: [0, 0.84, 0.1], hr: [10, 2, 0], sp: [14, 6, 0] },
    ] }),
  // side cut, left to right, shorter telegraph
  side: E({ dur: 0.92, tell: 0.1, hit: [0.42, 0.53], lunge: 1.3, stiff: 28, dmg: 1, arcDeg: 100, reach: 2.4, slash: { roll: 176, yaw: 0, y: 1.2 },
    keys: [
      { t: 0.26, e: 'out', hp: [0, 0.86, -0.02], hr: [4, 36, 0], sp: [6, 30, 0], hd: [0, -50, 0], rh: [0.14, -0.06, 0.2], bl: [0.8, 0.3, -0.5], ed: [0, 0, 1], lh: 'g', lf: [0.15, 0, 0.14, 15], rf: [-0.16, 0, -0.22, -30] },
      { t: 0.4, hr: [4, 40, 0], sp: [6, 32, 0] },
      { t: 0.46, e: 'lin', arc: 1, hr: [4, -5, 0], sp: [6, -6, 0], hd: [0, 0, 0], rh: [-0.1, -0.08, 0.44], bl: [0.05, 0.05, 1], ed: [-1, 0, 0], lh: [0.3, -0.24, 0], lf: [0.15, 0.03, 0.26, 5] },
      { t: 0.52, e: 'out', arc: 1, hr: [4, -34, 0], sp: [6, -30, 0], rh: [-0.42, -0.05, 0.18], bl: [-0.9, 0.1, 0.42], ed: [-0.4, 0, -0.9], lf: [0.15, 0, 0.34, 0] },
      { t: 0.92, hr: [4, -36, 0], sp: [6, -30, 0], rh: [-0.42, -0.06, 0.1], bl: [-0.88, 0.1, -0.46], ed: [0, 0, -1] },
    ] }),
  // spear thrust: long reach, narrow arc
  thrust: S({ dur: 1.05, tell: 0.16, hit: [0.54, 0.66], lunge: 2.1, stiff: 28, dmg: 1, arcDeg: 24, reach: 3.3, thrust: 1,
    keys: [
      { t: 0.34, e: 'out', hp: [0, 0.8, -0.1], hr: [6, -52, 0], sp: [8, -14, 0], hd: [-4, 60, 0], rh: [-0.3, -0.16, -0.16], bl: [0.55, 0.28, 0.83], ed: [0, -1, 0.3], lh: 'g', lf: [0.14, 0, 0.3, 10], rf: [-0.18, 0, -0.36, -50] },
      { t: 0.5, hp: [0, 0.79, -0.12], hr: [6, -56, 0] },
      { t: 0.6, e: 'out', hp: [0, 0.8, 0.2], hr: [10, -10, 0], sp: [12, -4, 0], hd: [-8, 12, 0], rh: [-0.14, -0.06, 0.44], bl: [0.12, 0.42, 0.9], ed: [0, -1, 0.45], lf: [0.15, 0, 0.56, 0], rf: [-0.17, 0, -0.4, -40] },
      { t: 1.05, hp: [0, 0.82, 0.14], hr: [8, -16, 0] },
    ] }),
  // spear sweep
  sweep: S({ dur: 1.0, tell: 0.12, hit: [0.46, 0.6], lunge: 1.0, stiff: 26, dmg: 1, arcDeg: 130, reach: 3.0, slash: { roll: 176, yaw: 0, y: 1.0, scale: 1.4 },
    keys: [
      { t: 0.3, e: 'out', hp: [0, 0.82, 0], hr: [4, 40, 0], sp: [6, 30, 0], hd: [0, -56, 0], rh: [0.06, -0.14, 0.12], bl: [0.94, 0.12, -0.34], ed: [0, -1, 0], lh: 'g', lf: [0.16, 0, 0.1, 15], rf: [-0.17, 0, -0.24, -30] },
      { t: 0.44, hr: [4, 44, 0] },
      { t: 0.52, e: 'lin', arc: 1, hr: [4, -4, 0], sp: [6, -6, 0], hd: [0, 0, 0], rh: [-0.16, -0.14, 0.36], bl: [0.1, 0.2, 1], ed: [0, -1, 0.2] },
      { t: 0.6, e: 'out', arc: 1, hr: [4, -50, 0], sp: [6, -30, 0], rh: [-0.36, -0.14, 0.1], bl: [-0.86, 0.12, 0.5], ed: [0, -1, 0] },
      { t: 1.0, hr: [4, -46, 0] },
    ] }),
  // captain: unblockable leaping slam (red glint)
  slam: E({ dur: 1.5, tell: 0.2, hit: [0.8, 0.92], lunge: 2.6, stiff: 22, dmg: 1.7, arcDeg: 180, reach: 3.2, unblockable: 1, slam: 2, hop: 1.1, slash: { roll: -90, yaw: 0, y: 1.6, scale: 1.7 },
    keys: [
      { t: 0.26, e: 'out', hp: [0, 0.74, 0], hr: [12, 0, 0], sp: [12, 0, 0], hd: [-8, 0, 0], rh: [-0.12, -0.3, 0.18], bl: [0.1, -0.5, 0.85], ed: [0, -0.85, -0.5], lh: 'g', lf: [0.16, 0, 0.14], rf: [-0.16, 0, -0.14] },
      { t: 0.7, e: 'out', hp: [0, 1.02, 0], hr: [-12, 0, 0], sp: [-22, 0, 0], hd: [0, 0, 0], rh: [0.0, 0.5, -0.1], bl: [0, 0.25, -0.97], ed: [0, 0.97, 0.25], lf: [0.12, 0.2, 0.2], rf: [-0.12, 0.26, -0.12] },
      { t: 0.82, e: 'lin', arc: 1, hp: [0, 0.92, 0.1], sp: [12, 0, 0], rh: [0, 0.05, 0.48], bl: [0, 0.3, 0.95], ed: [0, -0.95, 0.3], lf: [0.18, 0.05, 0.34], rf: [-0.17, 0.08, -0.2] },
      { t: 0.9, e: 'out', arc: 1, hp: [0, 0.68, 0.2], hr: [22, 0, 0], sp: [26, 0, 0], hd: [-18, 0, 0], rh: [0, -0.3, 0.38], bl: [0, -0.55, 0.83], ed: [0, -0.83, -0.55], lf: [0.2, 0, 0.44], rf: [-0.2, 0, -0.36, -30] },
      { t: 1.5, hp: [0, 0.74, 0.14], hr: [16, 0, 0], sp: [20, 0, 0] },
    ] }),
  // captain: two fast horizontal cuts
  double: E({ dur: 1.35, tell: 0.1, hit: [0.4, 0.5], hit2: [0.74, 0.84], lunge: 1.4, stiff: 28, dmg: 1, arcDeg: 110, reach: 2.9, slash: { roll: 4, yaw: 0, y: 1.3, scale: 1.4 }, slash2: { roll: 176, yaw: 0, y: 1.2, scale: 1.4 },
    keys: [
      { t: 0.26, e: 'out', hp: [0, 0.84, -0.04], hr: [5, -46, 0], sp: [7, -36, 0], hd: [0, 50, 0], rh: [-0.36, -0.1, -0.1], bl: [-0.5, 0.1, -0.86], ed: [-0.8, 0, 0.5], lh: [0.2, -0.1, 0.3], lf: [0.14, 0, 0.3, 5], rf: [-0.2, 0, -0.3, -50] },
      { t: 0.38, hr: [5, -50, 0] },
      { t: 0.44, e: 'lin', arc: 1, hr: [5, 0, 0], sp: [7, 8, 0], hd: [0, 0, 0], rh: [-0.2, -0.1, 0.42], bl: [-0.35, 0, 0.94], ed: [1, 0, 0.35] },
      { t: 0.5, e: 'out', arc: 1, hr: [5, 44, 0], sp: [7, 36, 0], rh: [0.14, -0.1, 0.34], bl: [0.9, 0, 0.44], ed: [0.44, 0, -0.9], rf: [-0.12, 0, 0.36, 0], lf: [0.18, 0, -0.2, 30] },
      { t: 0.7, hr: [5, 48, 0], sp: [7, 38, 0], rh: [0.14, -0.1, 0.24], bl: [0.85, 0.1, -0.5], ed: [0, 0, 1] },
      { t: 0.78, e: 'lin', arc: 1, hr: [5, -4, 0], sp: [7, -6, 0], rh: [-0.1, -0.08, 0.44], bl: [0.05, 0.05, 1], ed: [-1, 0, 0], lf: [0.16, 0.03, 0.2, 5] },
      { t: 0.84, e: 'out', arc: 1, hr: [5, -36, 0], sp: [7, -30, 0], rh: [-0.42, -0.05, 0.18], bl: [-0.9, 0.1, 0.42], ed: [-0.4, 0, -0.9], lf: [0.16, 0, 0.36, 0] },
      { t: 1.35, hr: [5, -36, 0] },
    ] }),
  block: E({ dur: 0.2, upper: true, stiff: 30, keys: [{ t: 0.08, e: 'out', hp: [0, 0.86, -0.02], hr: [2, -8, 0], sp: [6, 4, 0], hd: [-2, 4, 0], rh: [-0.14, 0.04, 0.36], bl: [0.85, 0.5, 0.15], ed: [-0.1, 0.3, 0.95], lh: [0.2, 0.22, 0.4] }] }),
  hit: E({ dur: 0.4, stiff: 26, keys: [
    { t: 0.07, e: 'out', hp: [0, 0.86, -0.16], hr: [-12, 14, 0], sp: [-20, -12, 8], hd: [16, -22, 0], rh: [-0.32, -0.16, 0.1], bl: [-0.4, 0.5, 0.7], ed: [0, -0.7, 0.6], lh: [0.34, -0.06, 0.14], lf: [0.17, 0, 0.1, 10], rf: [-0.19, 0, -0.34, -30] },
    { t: 0.4, hp: [0, 0.9, -0.06], hr: [-2, -10, 0], sp: [-4, 0, 0], hd: [2, 10, 0] },
  ] }),
  // staggered open (guard broken / parried): reeling with the weapon flung wide
  stagger: E({ dur: 0.5, stiff: 18, keys: [{ t: 0.12, e: 'out', hp: [0, 0.82, -0.12], hr: [-14, -30, 0], sp: [-22, -24, 6], hd: [20, 30, 0], rh: [-0.46, 0.16, -0.02], bl: [-0.7, 0.5, -0.5], ed: [0, 0, 1], lh: [0.4, 0.0, 0.14], lf: [0.18, 0, 0.16, 10], rf: [-0.2, 0, -0.36, -30] }] }),
  dead: E({ dur: 1.0, stiff: 9, keys: [{ t: 0.3, e: 'out', hp: [0, 0.26, -0.3], hr: [-84, 14, 0], sp: [-8, 0, 0], hd: [-12, 30, 0], rh: [-0.42, -0.06, 0.1], bl: [-0.9, 0, 0.3], ed: [0, 1, 0], lh: [0.44, -0.02, 0.1], fs: 'h', lf: [0.17, -0.78, 0.1], rf: [-0.15, -0.7, 0.22] }] }),
  hop: E({ dur: 0.4, stiff: 24, keys: [{ t: 0.08, e: 'out', hp: [0, 0.8, 0], hr: [10, -20, 0], sp: [8, -6, 0], rh: [-0.22, 0.0, 0.2], bl: [0.2, 0.7, 0.68], ed: [0, -0.7, 0.7], lh: 'g', fs: 'h', lf: [0.13, -0.56, 0.1], rf: [-0.13, -0.6, -0.1] }] }),
};

/** procedural enemy locomotion: guard stance that shuffles in any direction. s: {speed,mx,mz,phase,t,spear} */
export function locoEnemy(out, s) {
  const base = s.spear ? S_GUARD_POSE : E_GUARD_POSE;
  out.copy(base);
  const run = saturate(s.speed / 5.5), mv = saturate(s.speed / 0.7), ph = s.phase;
  const stride = lerp(0.14, 0.5, run) * mv, lift = (0.05 + run * 0.14) * mv;
  out.hipsPos.y += Math.sin(s.t * 1.9 + s.seed) * 0.008 + Math.cos(ph * 2) * 0.02 * run - run * 0.03;
  out.hipsPos.z = run * 0.05;
  _q.v = run;
  eulerQ(lerp(base === S_GUARD_POSE ? 4 : 2, 13, run), lerp(base === S_GUARD_POSE ? -34 : -28, -8, run) + Math.sin(ph) * 6 * run, -s.mx * run * 6, out.hipsQ);
  for (let i = 0; i < 2; i++) {
    const left = i === 0, c = ph + (left ? 0 : Math.PI);
    const sw = Math.cos(c), up = Math.max(0, -Math.sin(c));
    const f = left ? out.lFoot : out.rFoot;
    const bx = f.x, bz = f.z;
    f.set(lerp(bx, (left ? 0.12 : -0.12) + s.mx * stride * sw, mv * 0.85), lift * up, lerp(bz, s.mz * stride * sw, mv * 0.85) + bz * 0.25 * (1 - run) * mv);
  }
  return out;
}
