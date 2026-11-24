import * as THREE from 'three';
import { buildCharacter } from './rig.js';
import { Animator, Pose, sampleClip } from './animator.js';
import { PLAYER_CLIPS, ENEMY_CLIPS, locoPlayer, locoEnemy, locoCalm } from './poses.js';
import { getToonRamp, clamp, saturate } from '../core/util.js';
import { groundAt as heightAt, bodyGroundAt } from '../world/nav.js';
import { ENV } from '../world/env.js';

/* ---------- verlet ribbons: scarf tails, headband, ponytail ---------- */
const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3(), _ax = new THREE.Vector3(), _d = new THREE.Vector3(), _w = new THREE.Vector3();
class Ribbon {
  constructor(node, local, { n = 8, seg = 0.1, width = 0.07, taper = 0.4, color = 0xcc2233, cross = false, gravity = -7, drag = 0.93, lift = 0, size = 1 }) {
    this.node = node;
    this.local = local;
    this.n = n;
    this.seg = seg * size;
    this.width = width * size;
    this.size = size; // grows the cloth and its keep-out radii with an enlarged wearer
    this.taper = taper;
    this.cross = cross;
    this.gravity = gravity;
    this.drag = drag;
    this.lift = lift;
    this.p = [];
    this.prev = [];
    for (let i = 0; i < n; i++) {
      this.p.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }
    const strips = cross ? 2 : 1;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(n * 2 * strips * 3), 3);
    this.nrmAttr = new THREE.BufferAttribute(new Float32Array(n * 2 * strips * 3), 3);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.nrmAttr);
    const idx = [];
    for (let s = 0; s < strips; s++) for (let i = 0; i < n - 1; i++) { const a = s * n * 2 + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshToonMaterial({ color, side: THREE.DoubleSide, gradientMap: getToonRamp('char') }));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.init = false;
  }
  reset() {
    this.init = false;
  }
  update(dt, body, wind, head, back) {
    const { p, prev, n, seg } = this;
    this.node.updateWorldMatrix(false, false);
    _ax.setFromMatrixColumn(this.node.matrixWorld, 0).normalize();
    p[0].copy(this.local).applyMatrix4(this.node.matrixWorld);
    if (!this.init) {
      _n.setFromMatrixColumn(this.node.matrixWorld, 2).normalize(); // hang down and slightly behind
      for (let i = 1; i < n; i++) { p[i].copy(p[0]).addScaledVector(_n, -i * seg * 0.45); p[i].y -= i * seg * 0.88; prev[i].copy(p[i]); }
      this.init = true;
    }
    if (dt > 0) {
      const h = Math.min(dt, 1 / 30);
      for (let i = 1; i < n; i++) {
        _d.subVectors(p[i], prev[i]).multiplyScalar(this.drag);
        prev[i].copy(p[i]);
        const flutter = Math.sin(performance.now() * 0.006 + i * 0.9 + this.seg * 40) * 2.2 * wind.z;
        p[i].add(_d);
        // a little world wind, plus a steady pull behind the wearer so cloth never drapes over the face
        p[i].x += (wind.x * wind.z * 0.7 - back.x * 2.6 + _ax.x * flutter) * h * h;
        p[i].y += (this.gravity + this.lift * Math.min(wind.z, 2.2)) * h * h;
        p[i].z += (wind.y * wind.z * 0.7 - back.z * 2.6 + _ax.z * flutter) * h * h;
      }
      for (let k = 0; k < 3; k++) {
        for (let i = 1; i < n; i++) {
          _d.subVectors(p[i], p[i - 1]);
          const l = _d.length() || 1e-4;
          p[i].copy(p[i - 1]).addScaledVector(_d, seg / l);
          // keep out of the torso and above the ground
          _d.subVectors(p[i], body);
          _d.y *= 0.55;
          const bl = _d.length(), bR = 0.2 * this.size, hR = 0.17 * this.size;
          if (bl < bR) { _d.y /= 0.55; p[i].addScaledVector(_d.normalize(), bR - bl); }
          _d.subVectors(p[i], head);
          const hl = _d.length();
          if (hl < hR && i > 1) p[i].addScaledVector(_d.normalize(), hR - hl);
          const gy = heightAt(p[i].x, p[i].z) + 0.03;
          if (p[i].y < gy) p[i].y = gy;
        }
      }
    }
    // rebuild the strip(s)
    const pa = this.posAttr.array, na = this.nrmAttr.array;
    for (let i = 0; i < n; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
      _t.subVectors(b, a).normalize();
      _s.copy(_ax).addScaledVector(_t, -_ax.dot(_t));
      if (_s.lengthSq() < 1e-4) _s.set(1, 0, 0);
      _s.normalize();
      _n.crossVectors(_s, _t);
      const w = this.width * (1 - (i / (n - 1)) * (1 - this.taper)) * 0.5;
      let o = i * 6;
      pa[o] = p[i].x - _s.x * w; pa[o + 1] = p[i].y - _s.y * w; pa[o + 2] = p[i].z - _s.z * w;
      pa[o + 3] = p[i].x + _s.x * w; pa[o + 4] = p[i].y + _s.y * w; pa[o + 5] = p[i].z + _s.z * w;
      na[o] = na[o + 3] = _n.x; na[o + 1] = na[o + 4] = _n.y; na[o + 2] = na[o + 5] = _n.z;
      if (this.cross) {
        o += n * 6;
        pa[o] = p[i].x - _n.x * w; pa[o + 1] = p[i].y - _n.y * w; pa[o + 2] = p[i].z - _n.z * w;
        pa[o + 3] = p[i].x + _n.x * w; pa[o + 4] = p[i].y + _n.y * w; pa[o + 5] = p[i].z + _n.z * w;
        na[o] = na[o + 3] = _s.x; na[o + 1] = na[o + 4] = _s.y; na[o + 2] = na[o + 5] = _s.z;
      }
    }
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
  }
}

const _upper = new Pose();
const _fw = new THREE.Vector3();
let SEED = 1;

/** A character = rig + animator + cloth. Gameplay code drives pos/yaw and picks clips. */
export class Character {
  constructor(kind, scene, grow = 1) {
    this.kind = kind;
    this.isPlayer = kind === 'ronin';
    this.rig = buildCharacter(kind, grow);
    this.anim = new Animator(this.rig);
    this.root = this.rig.root;
    this.pos = this.root.position;
    this.yaw = 0;
    this.scale = this.rig.scale;
    this.clips = this.isPlayer ? PLAYER_CLIPS : ENEMY_CLIPS;
    this.clip = null;
    this.clipName = null;
    this.clipT = 0;
    this.clipSpeed = 1;
    this.locoMode = this.isPlayer ? 'armed' : 'enemy';
    const spear = this.rig.variant.weapon === 'spear';
    this.loco = { speed: 0, mx: 0, mz: 1, phase: 0, t: 0, seed: SEED++ * 1.7, spear };
    this.tip = new THREE.Vector3();
    this.base = new THREE.Vector3();
    this.chest = new THREE.Vector3();
    this.head = new THREE.Vector3();
    this.headC = new THREE.Vector3();
    this.roll = 0; // full-body tumble angle (rad) about the body centre
    this.lean = 0; // sideways lie (death)
    this.flash = 0;
    this.dissolve = 0;
    // feet on the ground: gameplay sets footY (the height of the ground the root stands on) and footIK (1 standing or
    // walking, 0 in the air); each foot then finds the ground under itself (a tread, a stone, a slope)
    this.footY = null;
    this.footIK = 0;
    this.ikW = 0;
    // a foot carrying weight keeps the ground it landed on until it lifts again (a planted foot doesn't drop a tread
    // because the body has moved on over it)
    this.plant = [{ on: false, g: 0, x: 0, z: 0 }, { on: false, g: 0, x: 0, z: 0 }];
    if (spear) this.anim.gripOffset = 0.5;
    scene.add(this.root);

    // cloth
    const b = this.rig.bones, P = this.rig.palette;
    this.ribbons = [];
    const add = (node, local, o) => {
      const r = new Ribbon(node, local, { ...o, size: grow });
      scene.add(r.mesh);
      this.ribbons.push(r);
    };
    if (this.isPlayer) {
      add(b.head, new THREE.Vector3(0, 0.2, -0.085), { n: 9, seg: 0.075, width: 0.085, taper: 0.25, color: P.hair, cross: true, gravity: -9, lift: 1.0 }); // ponytail
      add(b.head, new THREE.Vector3(-0.03, 0.13, -0.125), { n: 9, seg: 0.085, width: 0.05, taper: 0.7, color: P.scarf, gravity: -5, lift: 1.3, drag: 0.95 }); // headband tails
      add(b.head, new THREE.Vector3(0.03, 0.13, -0.125), { n: 8, seg: 0.08, width: 0.05, taper: 0.7, color: P.scarf, gravity: -5, lift: 1.4, drag: 0.95 });
      add(b.chest, new THREE.Vector3(-0.06, 0.22, -0.11), { n: 9, seg: 0.095, width: 0.11, taper: 0.45, color: P.scarf, gravity: -6, lift: 1.5, drag: 0.94 }); // scarf
    } else if (kind === 'captain' || kind === 'lord') {
      add(b.chest, new THREE.Vector3(-0.1, 0.2, -0.13), { n: 9, seg: 0.13, width: 0.24, taper: 0.7, color: P.haori, gravity: -7, lift: 1.4 });
      add(b.chest, new THREE.Vector3(0.1, 0.2, -0.13), { n: 9, seg: 0.13, width: 0.24, taper: 0.7, color: P.haori, gravity: -7, lift: 1.4 });
    } else if (kind === 'bandit' || kind === 'elite' || kind === 'monk') {
      add(b.chest, new THREE.Vector3(0.04, 0.22, -0.11), { n: 7, seg: 0.1, width: 0.11, taper: 0.5, color: P.scarf, gravity: -6, lift: 1.4 });
    }
    this.rig.bones.head.scale.setScalar(this.isPlayer ? 1.16 : 1.08);
    this.wind = new THREE.Vector3(0.92, 0.38, 1);
    this.setSheathed(false);
  }
  setSheathed(v) {
    this.sheathed = v;
    this.rig.weapon.visible = !v;
    if (this.rig.sheathed) this.rig.sheathed.visible = v;
  }
  play(name, { speed = 1, restart = true, t = 0 } = {}) {
    if (!restart && this.clipName === name) return;
    this.clip = this.clips[name];
    this.clipName = name;
    this.clipT = t;
    this.clipSpeed = speed;
  }
  stop() {
    this.clip = null;
    this.clipName = null;
  }
  get clipDone() {
    return !this.clip || this.clipT >= this.clip.dur;
  }
  setVisible(v) {
    this.root.visible = v;
    for (const r of this.ribbons) r.mesh.visible = v;
  }
  /** advance animation + cloth. dt is scaled game time */
  update(dt) {
    const L = this.loco, A = this.anim;
    L.t += dt;
    const stride = 0.16 + clamp(L.speed / 6.4, 0, 1) * 0.4;
    L.phase += (L.speed * dt * Math.PI * 2) / (4 * stride);
    const c = this.clip;
    if (c) this.clipT += dt * this.clipSpeed;
    if (c && !c.upper) {
      sampleClip(c, this.clipT, A.target);
      A.stiff = c.stiff ?? 20;
      A.arc = true;
    } else {
      if (this.locoMode === 'calm') locoCalm(A.target, L);
      else if (this.locoMode === 'enemy') locoEnemy(A.target, L);
      else locoPlayer(A.target, L);
      A.stiff = this.locoMode === 'calm' ? 9 : 16;
      A.arc = false;
      if (c && c.upper) {
        sampleClip(c, this.clipT, _upper);
        const T = A.target;
        T.rHand.copy(_upper.rHand); T.swordQ.copy(_upper.swordQ); T.lHand.copy(_upper.lHand); T.grip = _upper.grip;
        T.spineQ.copy(_upper.spineQ); T.headQ.copy(_upper.headQ);
        T.hipsPos.y = Math.min(T.hipsPos.y, _upper.hipsPos.y + 0.02);
        A.stiff = c.stiff ?? 24;
      }
    }
    this.footContact(dt);
    A.update(dt);
    this.applyTransform();
    this.updateCloth(dt);
    const u = this.rig.material.userData.u;
    u.uFlash.value = this.flash;
    u.uDissolve.value = this.dissolve;
    this.flash = Math.max(0, this.flash - dt * 7);
  }
  /** foot IK: lift or lower each foot onto the ground under it, and bring the hips down when one foot has to reach
      lower than the root (a foot on the next tread down, or off the edge of a stone) */
  footContact(dt) {
    const ik = this.anim.ik, A = this.anim.cur;
    const want = this.footY !== null && this.roll === 0 && this.lean === 0 ? this.footIK : 0;
    this.ikW = want > this.ikW ? Math.min(want, this.ikW + dt * 6) : Math.max(want, this.ikW - dt * 10);
    let l = 0, r = 0, lean = 0;
    if (this.ikW > 0) {
      const k = this.scale, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), base = this.footY, px = this.pos.x, pz = this.pos.z;
      const at = (f, P) => {
        const x = px + (f.x * cy + f.z * sy) * k, z = pz + (-f.x * sy + f.z * cy) * k;
        // planted: keep the ground it landed on, unless it has slid well off it (knocked back, turned on the spot)
        if (f.y < 0.02) {
          if (!P.on || Math.hypot(x - P.x, z - P.z) > 0.3) { P.on = true; P.g = heightAt(x, z); P.x = x; P.z = z; }
        } else P.on = false;
        const g = P.on ? P.g : heightAt(x, z);
        return clamp(g - base, -0.5, 0.5) / k;
      };
      l = at(A.lFoot, this.plant[0]) * this.ikW;
      r = at(A.rFoot, this.plant[1]) * this.ikW;
      // lean into a climb, sit back a little going down: the slope of the ground ahead, as much as the body is moving
      const fx = Math.sin(this.yaw) * 0.6, fz = Math.cos(this.yaw) * 0.6;
      const slope = (bodyGroundAt(px + fx, pz + fz) - bodyGroundAt(px - fx, pz - fz)) / 1.2;
      lean = clamp(slope, -0.7, 0.9) * (slope > 0 ? 0.3 : 0.18) * saturate(this.loco.speed / 3) * this.ikW;
    } else this.plant[0].on = this.plant[1].on = false;
    // ease, quicker going up than settling down, so a foot never lags into a step it is climbing
    const ease = (cur, to, up, down) => cur + (to - cur) * (1 - Math.exp(-dt * (to > cur ? up : down)));
    ik.l = ease(ik.l, l, 30, 18);
    ik.r = ease(ik.r, r, 30, 18);
    ik.hips = Math.max(0, -Math.min(ik.l, ik.r, 0));
    ik.lean = ease(ik.lean, lean, 6, 6);
  }
  applyTransform() {
    const { root, pivot, bones, weapon } = this.rig;
    root.rotation.y = this.yaw;
    // tumble about a point at hip height so rolls spin in place
    const cH = 0.5 * this.scale;
    pivot.rotation.set(this.roll, 0, this.lean);
    pivot.position.set(cH * Math.sin(this.lean), cH * (1 - Math.cos(this.roll)) + cH * (1 - Math.cos(this.lean)), -cH * Math.sin(this.roll));
    root.updateMatrixWorld(true);
    const ud = weapon.userData;
    this.tip.copy(ud.tip).applyMatrix4(weapon.matrixWorld);
    this.base.copy(ud.base).applyMatrix4(weapon.matrixWorld);
    this.chest.setFromMatrixPosition(bones.chest.matrixWorld);
    this.head.setFromMatrixPosition(bones.head.matrixWorld);
    this.headC.set(0, 0.09, 0).applyMatrix4(bones.head.matrixWorld);
  }
  updateCloth(dt) {
    _w.set(0.92, 0.38, ENV.wind);
    _fw.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    for (const r of this.ribbons) r.update(dt, this.chest, _w, this.headC, _fw);
  }
  resetCloth() {
    for (const r of this.ribbons) r.reset();
  }
  dispose(scene) {
    scene.remove(this.root);
    for (const r of this.ribbons) {
      scene.remove(r.mesh);
      r.mesh.geometry.dispose();
    }
  }
}
