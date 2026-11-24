import * as THREE from 'three';
import { BIND, DIM } from './rig.js';
import { DEG, clamp, lerp, saturate, easeInOut, easeOutCubic, easeInCubic } from '../core/util.js';

/* Pose-driven animation.
   A Pose stores a handful of intuitive targets (hips, spine, head, sword hand + blade direction,
   feet). Arms and legs are solved with analytic two-bone IK every frame, so sword arcs are authored
   as hand paths rather than joint angles. Clips are short keyframe lists of pose specs; locomotion
   is fully procedural. The live pose is spring-smoothed toward the target, which gives free blending. */

const V = () => new THREE.Vector3();
const Qn = () => new THREE.Quaternion();
const ID = new THREE.Quaternion();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _x = V(), _y = V(), _z = V(), _e = new THREE.Euler();
const R_SHOULDER = new THREE.Vector3(-0.19, 0.17, 0); // chest space

export class Pose {
  constructor() {
    this.hipsPos = new THREE.Vector3(0, DIM.hipsY, 0);
    this.hipsQ = Qn();
    this.spineQ = Qn();
    this.headQ = Qn();
    this.rHand = new THREE.Vector3(-0.06, -0.2, 0.26);
    this.swordQ = Qn();
    this.lHand = new THREE.Vector3(0.24, -0.4, 0.08);
    this.grip = 1;
    this.lFoot = new THREE.Vector3(0.11, 0, 0);
    this.rFoot = new THREE.Vector3(-0.11, 0, 0);
    this.lYaw = 0;
    this.rYaw = 0;
    this.brow = 0;
    this.lid = 1;
  }
  copy(p) {
    this.hipsPos.copy(p.hipsPos); this.hipsQ.copy(p.hipsQ); this.spineQ.copy(p.spineQ); this.headQ.copy(p.headQ);
    this.rHand.copy(p.rHand); this.swordQ.copy(p.swordQ); this.lHand.copy(p.lHand); this.grip = p.grip;
    this.lFoot.copy(p.lFoot); this.rFoot.copy(p.rFoot); this.lYaw = p.lYaw; this.rYaw = p.rYaw; this.brow = p.brow; this.lid = p.lid;
    return this;
  }
  /** blend toward another pose. `arc` swings the sword hand around the shoulder instead of cutting the chord */
  lerpTo(p, a, arc = false) {
    this.hipsPos.lerp(p.hipsPos, a); this.hipsQ.slerp(p.hipsQ, a); this.spineQ.slerp(p.spineQ, a); this.headQ.slerp(p.headQ, a);
    if (arc) arcLerp(this.rHand, p.rHand, a);
    else this.rHand.lerp(p.rHand, a);
    this.swordQ.slerp(p.swordQ, a); this.lHand.lerp(p.lHand, a); this.grip = lerp(this.grip, p.grip, a);
    this.lFoot.lerp(p.lFoot, a); this.rFoot.lerp(p.rFoot, a); this.lYaw = lerp(this.lYaw, p.lYaw, a); this.rYaw = lerp(this.rYaw, p.rYaw, a);
    this.brow = lerp(this.brow, p.brow, a); this.lid = lerp(this.lid, p.lid, a);
    return this;
  }
}
const _a = V(), _b = V();
function arcLerp(cur, target, a) {
  _a.subVectors(cur, R_SHOULDER);
  _b.subVectors(target, R_SHOULDER);
  const la = _a.length(), lb = _b.length();
  if (la < 1e-4 || lb < 1e-4) return cur.lerp(target, a);
  _a.divideScalar(la).lerp(_b.divideScalar(lb), a);
  if (_a.lengthSq() < 1e-4) return cur.lerp(target, a);
  _a.normalize().multiplyScalar(lerp(la, lb, a));
  return cur.copy(R_SHOULDER).add(_a);
}

/** blade (+Y of the weapon) and cutting-edge (+Z) directions -> quaternion */
export function swordQuat(bl, ed, out = Qn()) {
  _y.set(bl[0], bl[1], bl[2]).normalize();
  _z.set(ed[0], ed[1], ed[2]);
  _z.addScaledVector(_y, -_z.dot(_y));
  if (_z.lengthSq() < 1e-5) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}
const eulerQ = (p, y, r, out = Qn()) => out.setFromEuler(_e.set(p * DEG, y * DEG, r * DEG, 'YXZ'));

/* spec: { hp:[x,y,z], hr:[pitch,yaw,roll], sp:[..], hd:[..], rh:[x,y,z], bl:[..], ed:[..], lh:'g'|[x,y,z],
           lf:[x,y,z,yaw?], rf:[..], fs:'g'|'h' (feet in ground or hips space), brow, lid }                 */
export function makePose(spec, base) {
  const p = new Pose();
  if (base) p.copy(base);
  if (spec.hp) p.hipsPos.set(...spec.hp);
  if (spec.hr) eulerQ(spec.hr[0], spec.hr[1], spec.hr[2], p.hipsQ);
  if (spec.sp) eulerQ(spec.sp[0], spec.sp[1], spec.sp[2], p.spineQ);
  if (spec.hd) eulerQ(spec.hd[0], spec.hd[1], spec.hd[2], p.headQ);
  if (spec.rh) p.rHand.set(...spec.rh);
  if (spec.bl) swordQuat(spec.bl, spec.ed || [0, 0, 1], p.swordQ);
  if (spec.lh === 'g') p.grip = 1;
  else if (spec.lh) { p.grip = 0; p.lHand.set(...spec.lh); }
  const hipsSpace = spec.fs === 'h';
  for (const k of ['lf', 'rf']) {
    if (!spec[k]) continue;
    const t = k === 'lf' ? p.lFoot : p.rFoot;
    t.set(spec[k][0], spec[k][1], spec[k][2]);
    if (hipsSpace) t.applyQuaternion(p.hipsQ).add(p.hipsPos).y -= DIM.ankle;
    if (k === 'lf') p.lYaw = (spec[k][3] || 0) * DEG;
    else p.rYaw = (spec[k][3] || 0) * DEG;
  }
  if (spec.brow != null) p.brow = spec.brow;
  if (spec.lid != null) p.lid = spec.lid;
  return p;
}

const EASE = { lin: (t) => t, io: easeInOut, out: easeOutCubic, in: easeInCubic };
/** compile a clip definition into poses */
export function makeClip(def, base) {
  let prev = base;
  const keys = def.keys.map((k) => {
    const pose = makePose(k, prev);
    prev = pose;
    return { t: k.t, pose, ease: EASE[k.e || 'io'], arc: !!k.arc };
  });
  return { ...def, keys, dur: def.dur ?? keys[keys.length - 1].t };
}
export function sampleClip(clip, t, out) {
  const ks = clip.keys;
  if (clip.loop) t = ((t % clip.dur) + clip.dur) % clip.dur;
  if (t <= ks[0].t) return out.copy(ks[0].pose);
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i].t) {
      const a = ks[i - 1], b = ks[i];
      const u = b.ease(saturate((t - a.t) / Math.max(1e-4, b.t - a.t)));
      return out.copy(a.pose).lerpTo(b.pose, u, b.arc);
    }
  }
  return out.copy(ks[ks.length - 1].pose);
}

/* ---------- two-bone IK ---------- */
const _d = V(), _perp = V(), _E = V(), _n = V(), _qa = Qn(), _qb = Qn(), _qi = Qn();
function solveLimb(S, T, a, b, pole, parentQ, boneA, boneB, flip, outQB) {
  _d.subVectors(T, S);
  let L = _d.length();
  const maxL = (a + b) * 0.998, minL = Math.abs(a - b) + 0.03;
  L = clamp(L, minL, maxL);
  _d.normalize();
  const cosA = clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _perp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_perp.lengthSq() < 1e-5) _perp.set(_d.y, _d.z, _d.x).addScaledVector(_d, -(_d.x * _d.y + _d.y * _d.z + _d.z * _d.x));
  _perp.normalize();
  _E.copy(S).addScaledVector(_d, a * cosA).addScaledVector(_perp, a * sinA);
  _n.crossVectors(_d, _perp).multiplyScalar(flip); // bend-plane normal = bone X axis
  // upper bone: -Y along S->E
  _y.subVectors(S, _E).normalize();
  _z.crossVectors(_n, _y);
  _qa.setFromRotationMatrix(_m.makeBasis(_n, _y, _z));
  // lower bone: -Y along E->T (use the clamped length so the chain never over-stretches)
  _y.copy(S).addScaledVector(_d, L).sub(_E).normalize().negate();
  _z.crossVectors(_n, _y);
  _qb.setFromRotationMatrix(_m.makeBasis(_n, _y, _z));
  boneA.quaternion.copy(_qi.copy(parentQ).invert()).multiply(_qa);
  boneB.quaternion.copy(_qi.copy(_qa).invert()).multiply(_qb);
  outQB.copy(_qb);
}

const OFF = {
  spine: BIND.spine.clone().sub(BIND.hips),
  chest: BIND.chest.clone().sub(BIND.spine),
  lSh: BIND.lUpper.clone().sub(BIND.chest),
  rSh: BIND.rUpper.clone().sub(BIND.chest),
  lHip: BIND.lThigh.clone().sub(BIND.hips),
  rHip: BIND.rThigh.clone().sub(BIND.hips),
};
const POLE_R = new THREE.Vector3(-0.55, -0.45, -0.7).normalize(), POLE_L = new THREE.Vector3(0.55, -0.45, -0.7).normalize(), POLE_KNEE = new THREE.Vector3(0, 0.15, 1).normalize();

export class Animator {
  constructor(rig) {
    this.rig = rig;
    this.b = rig.bones;
    this.cur = new Pose();
    this.target = new Pose();
    this.tmp = new Pose();
    this.stiff = 18;
    this.arc = false;
    this.poleR = POLE_R.clone();
    this.poleL = POLE_L.clone();
    this.gripOffset = -0.135; // where the off hand sits along the weapon, relative to the main hand
    // scratch
    this.Qs = Qn(); this.Qc = Qn(); this.pS = V(); this.pC = V(); this.S = V(); this.T = V(); this.Tl = V(); this.pole = V();
    this.Qsw = Qn(); this.Qf = Qn(); this.q = Qn(); this.v = V();
  }
  snap() {
    this.cur.copy(this.target);
  }
  update(dt) {
    const a = 1 - Math.exp(-this.stiff * dt);
    this.cur.lerpTo(this.target, a, this.arc);
    this.apply(this.cur);
  }
  apply(P) {
    const b = this.b, { Qs, Qc, pS, pC, S, T, Tl, pole, Qsw, Qf, q, v } = this;
    b.hips.position.copy(P.hipsPos);
    b.hips.quaternion.copy(P.hipsQ);
    b.spine.quaternion.copy(ID).slerp(P.spineQ, 0.5);
    b.chest.quaternion.copy(b.spine.quaternion);
    b.neck.quaternion.copy(ID).slerp(P.headQ, 0.35);
    b.head.quaternion.copy(ID).slerp(P.headQ, 0.65);
    Qs.copy(P.hipsQ).multiply(b.spine.quaternion);
    Qc.copy(Qs).multiply(b.chest.quaternion);
    pS.copy(OFF.spine).applyQuaternion(P.hipsQ).add(P.hipsPos);
    pC.copy(OFF.chest).applyQuaternion(Qs).add(pS);

    // right arm carries the sword
    S.copy(OFF.rSh).applyQuaternion(Qc).add(pC);
    T.copy(P.rHand).applyQuaternion(Qc).add(pC);
    Qsw.copy(Qc).multiply(P.swordQ);
    pole.copy(this.poleR).applyQuaternion(Qc);
    solveLimb(S, T, DIM.upper, DIM.fore, pole, Qc, b.rUpper, b.rFore, 1, Qf);
    b.rHand.quaternion.copy(q.copy(Qf).invert()).multiply(Qsw);

    // left arm: grips the hilt below the right hand, or moves freely
    v.set(0, 1, 0).applyQuaternion(Qsw);
    Tl.copy(T).addScaledVector(v, this.gripOffset);
    v.copy(P.lHand).applyQuaternion(Qc).add(pC);
    Tl.lerp(v, 1 - saturate(P.grip));
    S.copy(OFF.lSh).applyQuaternion(Qc).add(pC);
    pole.copy(this.poleL).applyQuaternion(Qc);
    solveLimb(S, Tl, DIM.upper, DIM.fore, pole, Qc, b.lUpper, b.lFore, 1, Qf);
    b.lHand.quaternion.copy(q.copy(Qf).invert()).multiply(Qsw);
    b.lHand.quaternion.slerp(ID, 1 - saturate(P.grip));

    // legs
    for (let i = 0; i < 2; i++) {
      const left = i === 0;
      const foot = left ? P.lFoot : P.rFoot, yaw = left ? P.lYaw : P.rYaw;
      S.copy(left ? OFF.lHip : OFF.rHip).applyQuaternion(P.hipsQ).add(P.hipsPos);
      T.set(foot.x, foot.y + DIM.ankle, foot.z);
      // knees point where the hips face, splayed out a little
      pole.copy(POLE_KNEE);
      pole.x += left ? 0.25 : -0.25;
      pole.applyQuaternion(P.hipsQ);
      pole.y = Math.max(pole.y, -0.2);
      solveLimb(S, T, DIM.thigh, DIM.shin, pole, P.hipsQ, left ? b.lThigh : b.rThigh, left ? b.lShin : b.rShin, -1, Qf);
      const fb = left ? b.lFoot : b.rFoot;
      // feet stay level with the ground, toes dip as the foot lifts
      v.set(0, 0, 1).applyQuaternion(P.hipsQ);
      const hy = Math.atan2(v.x, v.z);
      q.setFromEuler(_e.set(Math.min(0.9, foot.y * 2.2), hy * 0.6 + yaw, 0, 'YXZ'));
      fb.quaternion.copy(Qf).invert().multiply(q);
    }

    // face
    const br = P.brow;
    if (b.browL) {
      b.browL.rotation.z = br * 0.45;
      b.browR.rotation.z = -br * 0.45;
      b.browL.position.y = b.browR.position.y = BIND.browL.y - BIND.head.y - br * 0.007;
      const ly = clamp(P.lid, 0.08, 1.15);
      b.lidL.scale.set(1, ly, 1);
      b.lidR.scale.set(1, ly, 1);
    }
  }
}
export { AXIS_Y, eulerQ };
