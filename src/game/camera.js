import * as THREE from 'three';
import { G, getUI } from '../core/state.js';
import { input } from '../core/input.js';
import { damp, dampAngle, clamp, angleDiff, vnoise, sharedUniforms } from '../core/util.js';
import { groundAt, waterLevelAt, cameraAt } from '../world/nav.js';

/* Elevated three-quarter camera.
   The angle is authored, not steered: every zone file lists camera regions (yaw, distance, pitch) and the rig eases
   between the ones around the player, so the view turns to face the way ahead, lifts in arenas and drops low on the
   temple stair to show what waits at the top. The same rig hands over to GSAP-driven cinematics and blends back.
   The player can orbit, tilt and zoom on top of any view (trackpad swipe / pinch, mouse wheel, touch drag / pinch);
   the turn and tilt settle back to the view's own angle once they stop steering.
   It also tells the shaders where the player is on screen so anything standing in front of them can thin out.
   Settings offer two lower views as well: both sit behind the samurai and swing round after them as they run (or to
   face the foe in a fight), one halfway down (the default) and one at eye level. Those two keep out of houses and walls. */
const _cam = { yaw: 0, dist: 12, pitch: 0.82 };
const _v = new THREE.Vector3();

/** the three views offered in settings. `high` is the authored camera; the others chase from behind the player */
export const CAM_VIEWS = {
  high: { label: 'High', chase: false, lead: 1, lift: 0, fov: 0 },
  mid: { label: 'Middle', chase: true, pitch: 0.48, dist: 8.8, lead: 0.6, lift: 0.4, fov: 2, solid: true },
  eye: { label: 'Eye level', chase: true, pitch: 0.12, dist: 5.2, lead: 0.35, lift: 0.85, fov: 5, solid: true },
};

/* ---------- view blockers: the bigger buildings and walls of each streamed zone, so a low camera stops short of them */
const blockerSets = new Set();
export function addViewBlockers(solids) {
  const list = [];
  for (const c of solids) {
    // buildings (both sides 3 m and up) and walls (long and thick); stalls, carts, racks and the like stay see-past
    const lo = Math.min(c.w ?? 0, c.d ?? 0), hi = Math.max(c.w ?? 0, c.d ?? 0);
    if (c.r !== undefined || !(lo >= 3 || (lo >= 1.1 && hi >= 4))) continue;
    const rot = c.rot || 0;
    list.push({ x: c.x, z: c.z, hw: c.w / 2 + 0.3, hd: c.d / 2 + 0.3, cs: Math.cos(rot), sn: Math.sin(rot), R: Math.hypot(c.w, c.d) / 2 + 0.6, top: groundAt(c.x, c.z) + 5 });
  }
  blockerSets.add(list);
  return list;
}
export const removeViewBlockers = (list) => blockerSets.delete(list);
/** fraction along the segment (x0,y0,z0) -> (x1,y1,z1) where it first enters a blocker below its roofline (1 = clear) */
function viewBlock(x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dz = z1 - z0, len2 = dx * dx + dz * dz || 1;
  let best = 1;
  for (const list of blockerSets) for (const b of list) {
    const t = clamp(((b.x - x0) * dx + (b.z - z0) * dz) / len2, 0, 1);
    const qx = x0 + dx * t - b.x, qz = z0 + dz * t - b.z;
    if (qx * qx + qz * qz > b.R * b.R) continue;
    // into the box's own frame, then a slab test
    const ox = x0 - b.x, oz = z0 - b.z;
    const lx = ox * b.cs - oz * b.sn, lz = ox * b.sn + oz * b.cs;
    if (Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hd) continue; // starting inside: nothing sensible to do
    const ux = dx * b.cs - dz * b.sn, uz = dx * b.sn + dz * b.cs;
    let t0 = 0, t1 = best;
    if (Math.abs(ux) < 1e-9) { if (Math.abs(lx) > b.hw) continue; }
    else { const a = (-b.hw - lx) / ux, c = (b.hw - lx) / ux; t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c)); }
    if (Math.abs(uz) < 1e-9) { if (Math.abs(lz) > b.hd) continue; }
    else { const a = (-b.hd - lz) / uz, c = (b.hd - lz) / uz; t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c)); }
    if (t0 <= t1 && t0 < best && y0 + (y1 - y0) * t0 < b.top) best = t0;
  }
  return best;
}

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
    // authored framing (eased between camera regions) and the player's own offset on top of it
    this.aYaw = 0;
    this.aPitch = 0.5;
    this.aDist = 8.6;
    this.uYaw = 0;
    this.uPitch = 0;
    this.uZoom = 0; // log distance: <0 closer, >0 farther
    this.uZoomT = 0;
    this.uIdle = 99; // seconds since the player last steered the camera
    this.uBack = false; // easing back to the authored view on request
    this.view = CAM_VIEWS.high;
    this.colD = 99; // distance allowed by buildings behind the player (low views)
    this.vLift = 0; // eased look height and fov of the chosen view, so switching views glides
    this.vFov = 0;
  }
  /** ease the view back to its default: the authored angle, or straight behind the player in the low views */
  recenter() {
    this.uBack = true;
    this.uZoomT = 0;
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
    this.uYaw = this.uPitch = 0;
    this.uBack = false;
  }
  update(rdt, player, lockTarget) {
    const cam = this.camera;
    const aspect = cam.aspect || 1.7;
    const baseFov = aspect < 1 ? clamp(46 / Math.pow(aspect, 0.72), 46, 78) : 46;
    const V = CAM_VIEWS[getUI().camView] || CAM_VIEWS.high;
    if (V !== this.view) {
      // the chasing views carry the turn in the base yaw itself, then swing round behind the player
      if (V.chase) { this.aYaw += this.uYaw; this.uYaw = 0; this.uBack = true; }
      this.view = V;
    }
    const L = input.look;
    const steer = player && !this.cine.on && this.blend < 0.5 ? L : null;
    if (steer && (L.dx || L.dy || L.zoom)) {
      const turn = -L.dx * 0.0055;
      if (V.chase) this.aYaw += turn;
      else this.uYaw += turn;
      this.moveYaw += turn; // a turn the player makes keeps "up the screen" as forward, even mid-stride
      this.uPitch += L.dy * 0.0045;
      this.uZoomT = clamp(this.uZoomT + L.zoom, -0.55, 0.5);
      if (L.dx || L.dy) { this.uIdle = 0; this.uBack = false; }
    } else this.uIdle += rdt;
    L.dx = L.dy = L.zoom = 0;
    this.uYaw = Math.atan2(Math.sin(this.uYaw), Math.cos(this.uYaw));

    if (player) {
      const p = player.pos;
      cameraAt(p.x, p.z, _cam);
      const A = G.arena;
      this.wide = damp(this.wide, A ? 1 : 0, 1.6, rdt);
      const wantDist = V.chase ? V.dist + this.wide * 1.6 : _cam.dist + this.wide * 1.0;
      const wantPitch = (V.chase ? V.pitch : _cam.pitch) + this.wide * 0.04;
      this._l.set(p.x, p.y + 1.25, p.z);
      // look a little ahead of travel, and lean toward the fight
      _v.set(player.vel.x, 0, player.vel.z).multiplyScalar(0.3);
      if (lockTarget) _v.set((lockTarget.pos.x - p.x) * 0.22, 0, (lockTarget.pos.z - p.z) * 0.22);
      if (A) { _v.x += (A.x - p.x) * 0.2; _v.z += (A.z - p.z) * 0.2; }
      if (_v.lengthSq() > 9) _v.setLength(3);
      this.lead.lerp(_v.multiplyScalar(V.lead), 1 - Math.exp(-2.2 * rdt));
      this._l.add(this.lead);
      if (!this.init) {
        this.target.copy(this._l);
        this.aYaw = this.moveYaw = V.chase ? player.yaw + Math.PI : _cam.yaw;
        this.aPitch = wantPitch;
        this.aDist = wantDist;
        this.lead.set(0, 0, 0);
        this.vLift = V.lift;
        this.vFov = V.fov;
        this.colD = 99;
        this.init = true;
      }
      this.aPitch = damp(this.aPitch, wantPitch, 1.6, rdt);
      this.aDist = damp(this.aDist, wantDist, 1.6, rdt);
      const sp2 = player.vel.x * player.vel.x + player.vel.z * player.vel.z, moving = sp2 > 2.25;
      let homeYaw = 0; // how far the yaw still is from where it settles
      if (!V.chase) this.aYaw = dampAngle(this.aYaw, _cam.yaw, 1.5, rdt);
      else {
        // swing round behind: the foe in a fight, the way they run otherwise (never while they run at the camera)
        let want = null, k = 0;
        if (this.uBack) { want = player.yaw + Math.PI; k = 3.2; }
        else if (this.uIdle > 1.2 && player.state === 'idle') {
          const tx = lockTarget ? lockTarget.pos.x - p.x : 0, tz = lockTarget ? lockTarget.pos.z - p.z : 0;
          if (tx * tx + tz * tz > 6) { want = Math.atan2(-tx, -tz); k = 0.9; }
          else if (moving && !player.blocking) { want = Math.atan2(-player.vel.x, -player.vel.z); k = 1.5 * Math.min(1, Math.sqrt(sp2) / 5); }
        }
        if (want !== null && (this.uBack || Math.abs(angleDiff(this.aYaw, want)) < 2.3)) {
          this.aYaw = dampAngle(this.aYaw, want, k, rdt);
          if (this.uBack) homeYaw = Math.abs(angleDiff(this.aYaw, want));
        }
      }
      // the player's turn and tilt drift home once they let go: soon if they walk on, eventually if they stand still
      if (this.uBack || (this.uIdle > 2.2 && moving) || this.uIdle > 7) {
        const k = this.uBack ? 3.2 : 1.1;
        this.uYaw = damp(this.uYaw, 0, k, rdt);
        this.uPitch = damp(this.uPitch, 0, k, rdt);
        if (Math.abs(this.uYaw) + Math.abs(this.uPitch) + homeYaw < 0.004) { this.uYaw = this.uPitch = 0; this.uBack = false; }
      }
      this.uPitch = clamp(this.uPitch, (V.chase ? 0.04 : 0.22) - this.aPitch, 1.32 - this.aPitch);
      this.uZoom = damp(this.uZoom, this.uZoomT, 10, rdt);
      this.yaw = this.aYaw + this.uYaw;
      this.pitch = this.aPitch + this.uPitch;
      this.dist = this.aDist * Math.exp(this.uZoom);
      this.target.x = damp(this.target.x, this._l.x, 7, rdt);
      this.target.z = damp(this.target.z, this._l.z, 7, rdt);
      this.target.y = damp(this.target.y, this._l.y, 3.5, rdt);
    }
    this.distKick = damp(this.distKick, 0, 5, rdt);
    this.fovKick = damp(this.fovKick, 0, 4, rdt);
    let dist = (this.dist + this.distKick) * (aspect < 1 ? 1.1 : 1), squeeze = 0;
    const cp = Math.cos(this.pitch);
    this._p.set(this.target.x + Math.sin(this.yaw) * cp * dist, this.target.y + Math.sin(this.pitch) * dist, this.target.z + Math.cos(this.yaw) * cp * dist);
    if (V.solid && player) {
      // stop short of a building behind the player: pull in at once, ease back out
      const f = viewBlock(this.target.x, this.target.y, this.target.z, this._p.x, this._p.y, this._p.z);
      const allow = f < 1 ? Math.max(2.2, f * dist - 0.3) : dist;
      this.colD = allow < this.colD ? allow : damp(this.colD, allow, 2.5, rdt);
      if (this.colD < dist) {
        // squeezed against a wall: come in closer but rise, looking down over the shoulder instead of into the back of the head
        squeeze = 1 - this.colD / dist;
        dist = this.colD;
        const pp = this.pitch + squeeze * 0.6, cq = Math.cos(pp);
        this._p.set(this.target.x + Math.sin(this.yaw) * cq * dist, this.target.y + Math.sin(pp) * dist, this.target.z + Math.cos(this.yaw) * cq * dist);
      }
    } else this.colD = dist;
    const floor = Math.max(groundAt(this._p.x, this._p.z), waterLevelAt(this._p.x, this._p.z)) + 1.2;
    if (this._p.y < floor) this._p.y = floor;
    this._l.copy(this.target);
    this.vLift = damp(this.vLift, V.lift, 1.6, rdt);
    this.vFov = damp(this.vFov, V.fov, 1.6, rdt);
    this._l.y += this.vLift * (1 - squeeze); // the lower views look over the player's shoulder rather than at their back

    // blend with cinematic values
    const c = this.cine;
    this.blend = c.on ? 1 : damp(this.blend, 0, 2.6, rdt);
    if (this.blend < 0.002) this.blend = 0;
    const b = this.blend * this.blend * (3 - 2 * this.blend);
    this.pos.copy(this._p).lerp(c.pos, b);
    this.look.copy(this._l).lerp(c.look, b);
    this.fov = baseFov + this.vFov + this.fovKick + (c.fov * (aspect < 1 ? 1.35 : 1) - baseFov - this.vFov) * b;

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
