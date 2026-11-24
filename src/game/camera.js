import * as THREE from 'three';
import { G } from '../core/state.js';
import { input } from '../core/input.js';
import { damp, dampAngle, clamp, angleDiff, vnoise } from '../core/util.js';
import { heightAt, WATER_Y } from '../world/terrain.js';

/* Third-person camera: orbit follow with soft target framing, trauma-based shake, FOV kicks,
   plus a cinematic mode whose position / look-at / fov are tweened by the director (GSAP). */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0; // camera sits at +Z of the player when yaw = 0, looking north to the falls
    this.pitch = 0.3;
    this.dist = 5.2;
    this.distKick = 0;
    this.fovKick = 0;
    this.trauma = 0;
    this.manualT = -9;
    this.target = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.cine = { on: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 45, roll: 0 };
    this.blend = 0; // 1 = fully cinematic, eases back to 0 for a smooth hand-over
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = 52;
    this._p = new THREE.Vector3();
    this._l = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this.init = false;
  }
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  kick(fov = 5, dist = 0) {
    this.fovKick = Math.max(this.fovKick, fov);
    this.distKick += dist;
  }
  /** unit vectors on the ground plane for camera-relative movement */
  basis(out) {
    out.fx = -Math.sin(this.yaw);
    out.fz = -Math.cos(this.yaw);
    out.rx = Math.cos(this.yaw);
    out.rz = -Math.sin(this.yaw);
    return out;
  }
  snapBehind(yaw) {
    this.yaw = yaw;
    this.init = false;
  }
  update(rdt, player, lockTarget) {
    const cam = this.camera;
    const aspect = cam.aspect || 1.7;
    const baseFov = aspect < 1 ? clamp(52 / Math.pow(aspect, 0.72), 52, 84) : 52;
    // manual look
    const sens = 0.0042;
    if (Math.abs(input.look.dx) + Math.abs(input.look.dy) > 0.01) {
      this.yaw -= input.look.dx * sens;
      this.pitch = clamp(this.pitch + input.look.dy * sens * 0.8, -0.12, 1.05);
      this.manualT = G.real;
    }
    input.look.dx = input.look.dy = 0;

    if (player) {
      const p = player.pos;
      this._l.set(p.x, p.y + 1.42 * (aspect < 1 ? 1.05 : 1), p.z);
      if (lockTarget) {
        // lean the framing toward the enemy we are fighting and drift round to keep them in view
        this._p.subVectors(lockTarget.pos, p);
        const d = this._p.length();
        this._l.addScaledVector(this._p, clamp(0.16, 0, 1.1 / Math.max(d, 0.01)));
        if (G.real - this.manualT > 1.3 && d > 0.6) {
          const want = Math.atan2(-this._p.x, -this._p.z);
          const off = angleDiff(this.yaw, want);
          if (Math.abs(off) > 0.5) this.yaw = dampAngle(this.yaw, want - Math.sign(off) * 0.5, 1.5, rdt);
        }
      } else if (G.real - this.manualT > 2.2 && player.speed > 2) {
        // gently settle behind the direction of travel
        const want = player.yaw + Math.PI;
        const off = angleDiff(this.yaw, want);
        if (Math.abs(off) < 2.4) this.yaw = dampAngle(this.yaw, want, 0.55, rdt);
      }
      if (!this.init) { this.target.copy(this._l); this.init = true; }
      this.target.x = damp(this.target.x, this._l.x, 10, rdt);
      this.target.z = damp(this.target.z, this._l.z, 10, rdt);
      this.target.y = damp(this.target.y, this._l.y, 5, rdt);
    }
    this.distKick = damp(this.distKick, 0, 5, rdt);
    this.fovKick = damp(this.fovKick, 0, 4, rdt);
    const dist = (this.dist + this.distKick) * (aspect < 1 ? 1.12 : 1);
    const cp = Math.cos(this.pitch);
    this._p.set(this.target.x + Math.sin(this.yaw) * cp * dist, this.target.y + Math.sin(this.pitch) * dist + 0.25, this.target.z + Math.cos(this.yaw) * cp * dist);
    const floor = Math.max(heightAt(this._p.x, this._p.z), WATER_Y) + 0.45;
    if (this._p.y < floor) this._p.y = floor;
    this._l.copy(this.target);

    // blend with cinematic values
    const c = this.cine;
    this.blend = c.on ? 1 : damp(this.blend, 0, 3.2, rdt);
    if (this.blend < 0.002) this.blend = 0;
    const b = this.blend * this.blend * (3 - 2 * this.blend);
    this.pos.copy(this._p).lerp(c.pos, b);
    this.look.copy(this._l).lerp(c.look, b);
    this.fov = baseFov + this.fovKick + (c.fov * (aspect < 1 ? 1.35 : 1) - baseFov) * b;

    // shake
    this.trauma = Math.max(0, this.trauma - rdt * 1.9);
    const s = this.trauma * this.trauma, t = G.real * 31;
    cam.position.copy(this.pos);
    cam.position.x += (vnoise(t, 1.3) - 0.5) * s * 0.55;
    cam.position.y += (vnoise(t, 7.7) - 0.5) * s * 0.55;
    cam.position.z += (vnoise(t, 13.1) - 0.5) * s * 0.55;
    cam.lookAt(this.look);
    cam.rotateZ((vnoise(t, 21.9) - 0.5) * s * 0.09 + c.roll * b);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
