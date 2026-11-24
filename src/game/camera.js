import * as THREE from 'three';
import { G } from '../core/state.js';
import { input } from '../core/input.js';
import { damp, dampAngle, clamp, angleDiff, vnoise, sharedUniforms } from '../core/util.js';
import { groundAt, waterLevelAt, cameraAt } from '../world/nav.js';

/* Elevated three-quarter camera.
   The angle is authored, not steered: every zone file lists camera regions (yaw, distance, pitch) and the rig eases
   between the ones around the player, so the view turns to face the way ahead, lifts in arenas and drops low on the
   temple stair to show what waits at the top. The same rig hands over to GSAP-driven cinematics and blends back.
   It also tells the shaders where the player is on screen so anything standing in front of them can thin out.     */
const _cam = { yaw: 0, dist: 12, pitch: 0.82 };
const _v = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0; // camera sits at +Z of the player when yaw = 0 (looking north)
    this.pitch = 0.5;
    this.dist = 8.6;
    this.moveYaw = 0; // basis for camera-relative movement (latched while a direction is held)
    this.stickA = 0;
    this.stickHeld = false;
    this.distKick = 0;
    this.fovKick = 0;
    this.trauma = 0;
    this.target = new THREE.Vector3();
    this.lead = new THREE.Vector3();
    this.cine = { on: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 45, roll: 0 };
    this.blend = 0; // 1 = fully cinematic, eases back to 0 for a smooth hand-over
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = 46;
    this.wide = 0; // extra pull-back while an encounter is running
    this._p = new THREE.Vector3();
    this._l = new THREE.Vector3();
    this.init = false;
  }
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  kick(fov = 5, dist = 0) {
    this.fovKick = Math.max(this.fovKick, fov * 0.7);
    this.distKick += dist;
  }
  /** unit vectors on the ground plane for the current view */
  basis(out, yaw = this.yaw) {
    out.fx = -Math.sin(yaw);
    out.fz = -Math.cos(yaw);
    out.rx = Math.cos(yaw);
    out.rz = -Math.sin(yaw);
    return out;
  }
  /** movement basis: follows the camera, but holds still while a stick direction is held so a turning camera cannot bend the walk */
  moveBasis(out, ix, iy) {
    const m = Math.hypot(ix, iy);
    if (m < 0.2) { this.stickHeld = false; this.moveYaw = this.yaw; }
    else {
      const a = Math.atan2(ix, iy);
      if (!this.stickHeld || Math.abs(angleDiff(this.stickA, a)) > 0.6) { this.stickHeld = true; this.stickA = a; this.moveYaw = this.yaw; }
    }
    return this.basis(out, this.moveYaw);
  }
  /** jump the rig straight to its authored framing for the player's position (after cuts and respawns) */
  snapBehind() {
    this.init = false;
  }
  update(rdt, player, lockTarget) {
    const cam = this.camera;
    const aspect = cam.aspect || 1.7;
    const baseFov = aspect < 1 ? clamp(46 / Math.pow(aspect, 0.72), 46, 78) : 46;
    input.look.dx = input.look.dy = 0;

    if (player) {
      const p = player.pos;
      cameraAt(p.x, p.z, _cam);
      const A = G.arena;
      this.wide = damp(this.wide, A ? 1 : 0, 1.6, rdt);
      const wantDist = _cam.dist + this.wide * 1.0, wantPitch = _cam.pitch + this.wide * 0.04;
      this._l.set(p.x, p.y + 1.25, p.z);
      // look a little ahead of travel, and lean toward the fight
      _v.set(player.vel.x, 0, player.vel.z).multiplyScalar(0.3);
      if (lockTarget) _v.set((lockTarget.pos.x - p.x) * 0.22, 0, (lockTarget.pos.z - p.z) * 0.22);
      if (A) { _v.x += (A.x - p.x) * 0.2; _v.z += (A.z - p.z) * 0.2; }
      if (_v.lengthSq() > 9) _v.setLength(3);
      this.lead.lerp(_v, 1 - Math.exp(-2.2 * rdt));
      this._l.add(this.lead);
      if (!this.init) {
        this.target.copy(this._l);
        this.yaw = this.moveYaw = _cam.yaw;
        this.pitch = wantPitch;
        this.dist = wantDist;
        this.lead.set(0, 0, 0);
        this.init = true;
      }
      this.yaw = dampAngle(this.yaw, _cam.yaw, 1.5, rdt);
      this.pitch = damp(this.pitch, wantPitch, 1.6, rdt);
      this.dist = damp(this.dist, wantDist, 1.6, rdt);
      this.target.x = damp(this.target.x, this._l.x, 7, rdt);
      this.target.z = damp(this.target.z, this._l.z, 7, rdt);
      this.target.y = damp(this.target.y, this._l.y, 3.5, rdt);
    }
    this.distKick = damp(this.distKick, 0, 5, rdt);
    this.fovKick = damp(this.fovKick, 0, 4, rdt);
    const dist = (this.dist + this.distKick) * (aspect < 1 ? 1.1 : 1);
    const cp = Math.cos(this.pitch);
    this._p.set(this.target.x + Math.sin(this.yaw) * cp * dist, this.target.y + Math.sin(this.pitch) * dist, this.target.z + Math.cos(this.yaw) * cp * dist);
    const floor = Math.max(groundAt(this._p.x, this._p.z), waterLevelAt(this._p.x, this._p.z)) + 1.2;
    if (this._p.y < floor) this._p.y = floor;
    this._l.copy(this.target);

    // blend with cinematic values
    const c = this.cine;
    this.blend = c.on ? 1 : damp(this.blend, 0, 2.6, rdt);
    if (this.blend < 0.002) this.blend = 0;
    const b = this.blend * this.blend * (3 - 2 * this.blend);
    this.pos.copy(this._p).lerp(c.pos, b);
    this.look.copy(this._l).lerp(c.look, b);
    this.fov = baseFov + this.fovKick + (c.fov * (aspect < 1 ? 1.35 : 1) - baseFov) * b;

    // shake
    this.trauma = Math.max(0, this.trauma - rdt * 1.9);
    const s = this.trauma * this.trauma, t = G.real * 31;
    cam.position.copy(this.pos);
    cam.position.x += (vnoise(t, 1.3) - 0.5) * s * 0.75;
    cam.position.y += (vnoise(t, 7.7) - 0.5) * s * 0.75;
    cam.position.z += (vnoise(t, 13.1) - 0.5) * s * 0.75;
    cam.lookAt(this.look);
    cam.rotateZ((vnoise(t, 21.9) - 0.5) * s * 0.07 + c.roll * b);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    // where the player is on screen: lets walls, roofs and foliage in front of them thin out
    const occ = sharedUniforms.uOcc.value;
    if (player && b < 0.5 && !G.noOcc) {
      cam.updateMatrixWorld();
      _v.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
      const d = _v.distanceTo(cam.position);
      _v.project(cam);
      occ.set(_v.x, _v.y, d, 0.3 * (1 - b * 2));
    } else occ.w = 0;
    if (G.gl) G.gl.getDrawingBufferSize(sharedUniforms.uRes.value);
  }
}
