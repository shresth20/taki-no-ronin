import * as THREE from 'three';
import { G, ui } from '../core/state.js';
import { input } from '../core/input.js';
import { Character } from '../chars/character.js';
import { groundAt as heightAt, waterDepthAt, constrain as navConstrain } from '../world/nav.js';
import { damp, dampAngle, angleDiff, clamp, saturate, easeInOut, easeOutCubic, DEG, rand, rrange } from '../core/util.js';

const LIGHTS = ['light1', 'light2', 'light3', 'light4'];
const RUN = 6.3, ROLL_T = 0.5, ROLL_DIST = 4.7, GRAV = -27;
const _b = {}, _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
export const COLORS = { trailA: '#9fdcff', trailB: '#ffffff', slashA: '#7fd4ff', slashB: '#ffffff', spA: '#ffd36b', spB: '#fff6d8' };

export class Player {
  constructor(scene) {
    this.char = new Character('ronin', scene);
    this.pos = this.char.pos;
    this.yaw = Math.PI;
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.airY = 0; // height above the ground while jumping
    this.hop = 0;
    this.grounded = true;
    this.hpMax = 100;
    this.hp = 100;
    this.ki = 0;
    this.state = 'cine';
    this.stateT = 0;
    this.comboI = 0;
    this.comboUntil = -9;
    this.lastHeavy = -9;
    this.hitSet = new Set();
    this.iframes = 0;
    this.blocking = false;
    this.blockStart = -9;
    this.parryUntil = -9;
    this.rollEnd = -9;
    this.perfectAt = -9;
    this.target = null;
    this.radius = 0.4;
    this.speed = 0;
    this.cineMode = true;
    this.body = G.physics.createCharacter(0.36, 1.7);
    this.trail = G.vfx.trail(COLORS.trailA, COLORS.trailB, 0.17);
    this.stats = { hits: 0, maxCombo: 0, damage: 0, parries: 0, perfect: 0, kills: 0 };
    this.lastPhase = 0;
    this.rippleT = 0;
    this.kiShown = -1;
    this.aimYaw = this.yaw;
    this.spMarks = [];
  }
  get alive() {
    return this.hp > 0;
  }
  place(x, z, yaw) {
    this.pos.set(x, heightAt(x, z), z);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.airY = 0;
    this.vy = 0;
    this.char.yaw = yaw;
    G.physics.teleport(this.body, this.pos);
    this.char.resetCloth();
  }
  setCine(v) {
    this.cineMode = v;
    if (v) {
      this.state = 'cine';
      this.blocking = false;
      this.trail.on = false;
      this.vel.set(0, 0, 0);
    } else if (this.state === 'cine') this.setState('idle');
  }
  setState(s) {
    if (this.state === 'roll' && s !== 'roll') this.char.roll = 0;
    if (s !== 'attack') { this.hop = 0; if (s !== 'plunge' && s !== 'special') this.trail.on = false; }
    this.state = s;
    this.stateT = 0;
  }
  addKi(v) {
    this.ki = clamp(this.ki + v, 0, 100);
  }
  heal(v) {
    this.hp = Math.min(this.hpMax, this.hp + v);
    ui({ hp: this.hp });
  }

  /* ---------- targeting ---------- */
  pickTarget(hx, hz, maxDist = 7.5) {
    let best = null, bs = 1e9;
    const useHint = Math.hypot(hx, hz) > 0.2;
    const ay = useHint ? Math.atan2(hx, hz) : this.yaw;
    for (const e of G.enemies) {
      if (!e.alive || !e.active) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > maxDist) continue;
      const a = Math.abs(angleDiff(ay, Math.atan2(dx, dz)));
      if (d > 2.6 && a > 1.75) continue;
      const s = d + a * 2.4 - (e === this.target ? 0.8 : 0);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
  nearestEnemy(maxDist = 10) {
    let best = null, bd = maxDist;
    for (const e of G.enemies) {
      if (!e.alive || !e.active) continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /* ---------- actions ---------- */
  startAttack(name, wishX = 0, wishZ = 0) {
    const c = this.char;
    this.setState('attack');
    this.attack = name;
    this.hitSet.clear();
    this.hitOn = false;
    this.hitDone = false;
    this.slamDone = false;
    this.blocking = false;
    const t = this.cineMode ? null : this.pickTarget(wishX, wishZ);
    if (t) {
      this.target = t;
      this.aimYaw = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    } else if (Math.hypot(wishX, wishZ) > 0.2) this.aimYaw = Math.atan2(wishX, wishZ);
    else this.aimYaw = this.yaw;
    c.play(name);
    const clip = c.clip;
    if (t) t.reactToSwing(clip);
    let lunge = clip.lunge ?? 0;
    if (t && name !== 'dash') lunge = clamp(Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) - 1.3, 0, lunge * 1.5);
    else if (!t) lunge *= 0.6;
    this.lungeSpeed = lunge / Math.max(0.05, (clip.hit?.[1] ?? 0.2) - 0.02);
    const li = LIGHTS.indexOf(name);
    if (li >= 0) this.comboI = li + 1;
    if (name === 'heavy1') this.lastHeavy = G.time;
  }
  startRoll(dx, dz) {
    this.setState('roll');
    const l = Math.hypot(dx, dz);
    if (l > 0.1) this.yaw = Math.atan2(dx, dz);
    this.rollDir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    this.char.play('roll');
    this.blocking = false;
    this.trail.on = false;
    this.iframes = 0.4;
    this.perfectUsed = false;
    this.comboI = 0;
    G.audio.sfx.roll();
    this.groundFx(1);
  }
  startSpecial() {
    this.setState('special');
    this.spPhase = 0;
    this.blocking = false;
    this.iframes = 2;
    const t = this.pickTarget(0, 0, 12);
    if (t) this.yaw = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    this.char.play('spCharge');
    this.trail.uniforms.uA.value.set(COLORS.spA);
    G.audio.sfx.charge();
    G.director.tween(G, { enemyTime: 0.06 }, 0.25);
    G.director.tween(G.post, { desat: 0.85, vignette: 0.62 }, 0.3);
    G.rig.kick(-6, -1.2);
  }
  groundFx(scale = 1, pos = this.pos) {
    const depth = waterDepthAt(pos.x, pos.z);
    if (depth > 0.03) {
      G.vfx.splash(pos, Math.round(10 * scale), scale);
      G.audio.sfx.splash();
    } else G.vfx.dust(pos, Math.round(5 * scale), scale);
  }

  /** called by combat when an enemy attack connects. returns 'parry' | 'block' | 'hit' | 'dodge' | 'miss' */
  receiveHit(enemy, clip, dmg) {
    if (this.state === 'dead' || this.state === 'cine' || this.state === 'special' || !this.alive) return 'miss';
    if (this.iframes > 0) {
      if (this.state === 'roll' && !this.perfectUsed) {
        this.perfectUsed = true;
        this.perfectAt = G.time;
        this.stats.perfect++;
        this.addKi(14);
        G.combat.perfectDodge(this);
      }
      return 'dodge';
    }
    const toE = Math.atan2(enemy.pos.x - this.pos.x, enemy.pos.z - this.pos.z);
    const facing = Math.abs(angleDiff(this.yaw, toE)) < 1.95;
    const dx = this.pos.x - enemy.pos.x, dz = this.pos.z - enemy.pos.z, l = Math.hypot(dx, dz) || 1;
    if (this.blocking && this.state === 'idle' && facing && !clip.unblockable) {
      if (G.time - this.blockStart < 0.26) {
        this.setState('parry');
        this.char.play('parry');
        this.parryUntil = G.time + 1.1;
        this.iframes = 0.45;
        this.stats.parries++;
        this.addKi(20);
        this.yaw = toE;
        return 'parry';
      }
      this.hp = Math.max(1, this.hp - dmg * 0.1);
      this.vel.x += (dx / l) * 3.5;
      this.vel.z += (dz / l) * 3.5;
      this.addKi(3);
      ui({ hp: this.hp });
      return 'block';
    }
    this.hp = Math.max(0, this.hp - dmg);
    this.stats.damage += dmg;
    G.journey?.addDamage(dmg);
    this.comboI = 0;
    this.trail.on = false;
    this.hop = 0;
    ui({ hp: this.hp, hurtAt: G.real });
    this.vel.set((dx / l) * (clip.unblockable ? 9 : 5.5), 0, (dz / l) * (clip.unblockable ? 9 : 5.5));
    this.iframes = 0.75;
    this.blocking = false;
    if (this.hp <= 0) {
      this.setState('dead');
      this.char.play('dead');
      G.director.onPlayerDeath();
    } else {
      this.setState('hit');
      this.char.play('hit');
    }
    return 'hit';
  }

  /* ---------- per-frame ---------- */
  update(dt) {
    const c = this.char;
    if (dt <= 0) return;
    this.stateT += dt;
    this.iframes -= dt;
    const ctl = !this.cineMode && input.enabled;
    const ix = ctl ? input.move.x : 0, iy = ctl ? input.move.y : 0;
    G.rig.moveBasis(_b, ix, iy); // camera-relative, but held steady while a direction is held so a turning camera never bends the path
    let wx = _b.rx * ix + _b.fx * iy, wz = _b.rz * ix + _b.fz * iy;
    const mag = Math.min(1, Math.hypot(wx, wz));
    if (mag > 1e-3) { const wl = Math.hypot(wx, wz); wx /= wl; wz /= wl; }
    const depth = waterDepthAt(this.pos.x, this.pos.z);
    const wade = 1 - 0.28 * saturate(depth / 0.6);
    let locoSpeed = 0;
    // gravity applies in every state, so a blow taken mid-air still brings the player down
    let landed = false;
    if (this.airY > 0 || this.vy > 0) {
      this.vy += (this.state === 'plunge' ? GRAV * 2.2 : GRAV) * dt;
      this.airY += this.vy * dt;
      if (this.airY <= 0) { this.airY = 0; this.vy = 0; this.grounded = true; landed = true; }
    }

    switch (this.state) {
      case 'idle': {
        const wasBlocking = this.blocking;
        this.blocking = ctl && input.held.block;
        if (this.blocking && !wasBlocking) {
          this.blockStart = G.time;
          c.play('block');
        } else if (!this.blocking && wasBlocking) c.stop();
        else if (!this.blocking && c.clip) c.stop();
        const sp = (this.blocking ? 2.3 : RUN) * mag * wade;
        this.vel.x = damp(this.vel.x, wx * sp, 13, dt);
        this.vel.z = damp(this.vel.z, wz * sp, 13, dt);
        const lock = this.blocking ? this.nearestEnemy(8) : null;
        if (lock) this.yaw = dampAngle(this.yaw, Math.atan2(lock.pos.x - this.pos.x, lock.pos.z - this.pos.z), 12, dt);
        else if (mag > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(wx, wz), 15, dt);
        locoSpeed = Math.hypot(this.vel.x, this.vel.z);
        if (ctl) {
          if (input.consume('dodge')) this.startRoll(mag > 0.2 ? wx : -Math.sin(this.yaw), mag > 0.2 ? wz : -Math.cos(this.yaw));
          else if (input.consume('special')) {
            if (this.ki >= 100) this.startSpecial();
            else G.director.toast('Ki not ready', 'dim');
          } else if (input.consume('jump')) {
            this.vy = 9.8;
            this.grounded = false;
            this.setState('air');
            c.play('jumpUp');
            G.audio.sfx.jump();
            this.groundFx(0.7);
          } else if (input.consume('attack')) {
            if (G.time < this.parryUntil) { this.parryUntil = -9; this.startAttack('counter', wx * mag, wz * mag); }
            else if (G.time - this.rollEnd < 0.3) this.startAttack('dash', wx * mag, wz * mag);
            else this.startAttack(G.time < this.comboUntil && this.comboI < 4 ? LIGHTS[this.comboI] : 'light1', wx * mag, wz * mag);
          } else if (input.consume('heavy')) this.startAttack(G.time - this.lastHeavy < 1.4 || (G.time < this.comboUntil && this.comboI >= 2) ? 'heavy2' : 'heavy1', wx * mag, wz * mag);
        }
        break;
      }
      case 'attack': {
        const clip = c.clip, t = c.clipT, hit = clip.hit;
        this.yaw = dampAngle(this.yaw, this.aimYaw, t < hit[0] ? 22 : 4, dt);
        if (this.target?.alive && t < hit[0]) this.aimYaw = Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
        const moving = t > 0.02 && t < hit[1];
        let ls = moving ? this.lungeSpeed : 0;
        if (moving && this.target?.alive && this.attack !== 'dash' && Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z) < 1.25) ls = 0;
        this.vel.x = damp(this.vel.x, Math.sin(this.yaw) * ls, 30, dt);
        this.vel.z = damp(this.vel.z, Math.cos(this.yaw) * ls, 30, dt);
        if (clip.hop) {
          const u = saturate((t - 0.14) / (hit[0] + 0.06 - 0.14));
          this.hop = Math.sin(Math.PI * u) * clip.hop;
        }
        if (!this.hitOn && t >= hit[0] - 0.03) {
          this.hitOn = true;
          this.trail.on = true;
          const sp = this.attack === 'counter';
          if (clip.slash) G.vfx.slash(this.pos, this.yaw, clip.slash, clip.reach, sp ? COLORS.spA : COLORS.slashA, sp ? COLORS.spB : COLORS.slashB, clip.heavy ? 0.3 : 0.24);
          G.audio.sfx.whoosh(!!clip.heavy);
          if (clip.heavy) G.rig.kick(3, 0.3);
          if (this.attack === 'dash') { G.rig.kick(7, 0); G.post.speed = 0.8; }
        }
        if (this.hitOn && !this.hitDone) {
          if (t >= hit[0]) this.checkHits(clip);
          if (clip.slam && !this.slamDone && t >= hit[0] + (hit[1] - hit[0]) * 0.75) {
            this.slamDone = true;
            _v.set(this.pos.x + Math.sin(this.yaw) * 1.3, this.pos.y, this.pos.z + Math.cos(this.yaw) * 1.3);
            G.combat.slam(_v, clip.slam, this);
            if (clip.slam >= 2) this.checkHits(clip, 3.1);
          }
          if (t > hit[1] + 0.05) { this.hitDone = true; this.trail.on = false; }
        }
        if (ctl && t >= clip.cancel) {
          if (input.consume('dodge', 0.3)) { this.hop = 0; this.startRoll(mag > 0.2 ? wx : Math.sin(this.yaw), mag > 0.2 ? wz : Math.cos(this.yaw)); break; }
          if (input.consume('attack', 0.3)) {
            const next = LIGHTS.indexOf(this.attack) >= 0 && this.comboI < 4 ? LIGHTS[this.comboI] : 'light1';
            this.hop = 0;
            this.startAttack(next, wx * mag, wz * mag);
            break;
          }
          if (input.consume('heavy', 0.3)) { this.hop = 0; this.startAttack(this.attack === 'heavy1' || this.comboI >= 2 ? 'heavy2' : 'heavy1', wx * mag, wz * mag); break; }
          if (t >= clip.cancel + 0.07 && mag > 0.6) { this.endAttack(); break; }
        }
        if (t >= clip.dur) this.endAttack();
        break;
      }
      case 'roll': {
        const u = saturate(this.stateT / ROLL_T);
        const sp = (ROLL_DIST / ROLL_T) * 1.5 * (1 - u * 0.85) * wade;
        this.vel.x = this.rollDir.x * sp;
        this.vel.z = this.rollDir.z * sp;
        c.roll = Math.PI * 2 * easeInOut(u);
        if (this.stateT >= ROLL_T) {
          c.roll = 0;
          this.rollEnd = G.time;
          this.setState('idle');
          c.stop();
          if (ctl && input.consume('attack', 0.35)) this.startAttack('dash', wx * mag, wz * mag);
        }
        break;
      }
      case 'air':
      case 'plunge': {
        const plunge = this.state === 'plunge';
        const sp = plunge ? 5 : 5.2 * mag;
        if (plunge) { this.vel.x = damp(this.vel.x, Math.sin(this.yaw) * sp, 8, dt); this.vel.z = damp(this.vel.z, Math.cos(this.yaw) * sp, 8, dt); }
        else { this.vel.x = damp(this.vel.x, wx * sp, 4, dt); this.vel.z = damp(this.vel.z, wz * sp, 4, dt); if (mag > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(wx, wz), 8, dt); }
        if (!plunge && this.vy < 0 && c.clipName === 'jumpUp') c.play('jumpFall');
        if (!plunge && ctl && input.consume('attack') && this.airY > 0.5) {
          this.setState('plunge');
          const t = this.pickTarget(wx * mag, wz * mag, 6);
          if (t) { this.target = t; this.yaw = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z); }
          this.vy = Math.min(this.vy, -6);
          c.play('airPlunge');
          this.trail.on = true;
          G.audio.sfx.whoosh(true);
        }
        if (landed) {
          if (plunge) {
            this.startAttack('airSlam');
            this.lungeSpeed = 0;
          } else {
            this.setState('idle');
            c.stop();
            this.groundFx(0.9);
            G.audio.sfx.land();
          }
        }
        break;
      }
      case 'hit':
      case 'parry': {
        this.vel.x = damp(this.vel.x, 0, 7, dt);
        this.vel.z = damp(this.vel.z, 0, 7, dt);
        // a parry can be answered at once: attack during the slow-motion beat becomes the counter
        if (this.state === 'parry' && ctl && this.stateT > 0.03 && input.consume('attack', 0.6)) {
          this.parryUntil = -9;
          this.startAttack('counter', wx * mag, wz * mag);
          break;
        }
        if (this.stateT >= (this.state === 'hit' ? 0.4 : 0.26)) { this.setState('idle'); c.stop(); }
        break;
      }
      case 'special':
        this.updateSpecial(dt);
        break;
      case 'dead':
        this.vel.x = damp(this.vel.x, 0, 5, dt);
        this.vel.z = damp(this.vel.z, 0, 5, dt);
        break;
      default: // cine: the director owns position and clips
        this.vel.x = damp(this.vel.x, 0, 10, dt);
        this.vel.z = damp(this.vel.z, 0, 10, dt);
        locoSpeed = this.cineSpeed ?? 0;
    }

    // move with obstacle sliding, then keep inside the valley floor
    const px = this.pos.x, pz = this.pos.z;
    if (this.state !== 'cine' || this.cineMove) G.physics.moveCharacter(this.body, this.pos, this.vel.x * dt, this.vel.z * dt);
    if (!this.cineMode) this.constrain(px, pz);
    const gy = heightAt(this.pos.x, this.pos.z);
    if (this.state !== 'cine' || !this.cineY) this.pos.y = gy + this.airY + this.hop;
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // animation inputs
    c.yaw = this.yaw;
    const L = c.loco;
    L.speed = locoSpeed;
    if (locoSpeed > 0.2) {
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      const vx = this.vel.x / (this.speed || 1), vz = this.vel.z / (this.speed || 1);
      L.mx = damp(L.mx, this.cineMode ? 0 : vx * cy - vz * sy, 12, dt);
      L.mz = damp(L.mz, this.cineMode ? 1 : vx * sy + vz * cy, 12, dt);
    }
    c.update(dt);
    this.trail.update(c.base, c.tip, G.time);

    // footsteps, ripples, ki aura
    if (locoSpeed > 1 && this.airY === 0) {
      const ph = Math.floor(L.phase / Math.PI);
      if (ph !== this.lastPhase) {
        this.lastPhase = ph;
        G.audio.sfx.step(depth > 0.04);
        if (depth > 0.04) G.vfx.splash(this.pos, 4, 0.5);
        else if (locoSpeed > 4.5) G.vfx.dust(this.pos, 1, 0.5);
      }
    }
    if (depth > 0.04 && this.airY < 0.2) {
      this.rippleT -= dt * (0.3 + this.speed * 0.4);
      if (this.rippleT < 0) { this.rippleT = 0.3; if (this.pos.z < 150) G.world.water.addRipple(this.pos.x, this.pos.z, 0.5 + this.speed * 0.08); }
    }
    if (this.ki >= 100 && rand() < dt * 9) G.vfx.embers(this.pos, 1, [3.0, 2.2, 0.8], 0.5);
    const k = Math.round(this.ki);
    if (k !== this.kiShown) { this.kiShown = k; ui({ ki: k }); }
  }

  endAttack() {
    this.hop = 0;
    this.trail.on = false;
    this.comboUntil = G.time + 0.5;
    if (this.attack === 'light4' || this.attack === 'heavy2' || this.attack === 'counter' || this.attack === 'dash' || this.attack === 'airSlam') this.comboI = 0;
    this.char.stop();
    this.setState(this.cineMode ? 'cine' : 'idle');
  }

  checkHits(clip, radiusOverride = 0) {
    const half = (clip.arcDeg ?? 90) * 0.5 * DEG;
    for (const e of G.enemies) {
      if (!e.alive || !e.active || this.hitSet.has(e)) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      const reach = radiusOverride || clip.reach;
      if (d - e.radius > reach || Math.abs(e.pos.y - this.pos.y) > 2.2) continue;
      if (!radiusOverride && d > 1.0 && Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz))) > half) continue;
      this.hitSet.add(e);
      G.combat.playerHit(e, clip, this);
    }
    // the training post
    const post = G.world.post;
    if (post && !this.hitSet.has(post)) {
      const u = post.userData, dx = u.x - this.pos.x, dz = u.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d - 0.3 <= (radiusOverride || clip.reach) && (radiusOverride || d < 1.0 || Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz))) < half)) {
        this.hitSet.add(post);
        G.combat.postHit(post, clip, this);
      }
    }
  }

  updateSpecial(dt) {
    const c = this.char, t = this.stateT;
    this.vel.set(0, 0, 0);
    if (this.spPhase === 0) {
      if (rand() < dt * 40) G.vfx.embers(this.pos, 2, [3.0, 2.3, 0.9], 0.8);
      if (t >= 0.46) {
        // flash step: travel up to 9 m in short hops so obstacles and bounds still apply
        this.spPhase = 1;
        const from = _v.copy(this.pos);
        const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw);
        for (let i = 0; i < 9; i++) {
          const px = this.pos.x, pz = this.pos.z;
          G.physics.moveCharacter(this.body, this.pos, dx, dz);
          this.constrain(px, pz);
        }
        this.pos.y = heightAt(this.pos.x, this.pos.z);
        const to = this.pos;
        this.spMarks = [];
        for (const e of G.enemies) {
          if (!e.alive || !e.active) continue;
          // distance from the enemy to the path segment
          const ax = to.x - from.x, az = to.z - from.z, l2 = ax * ax + az * az || 1;
          const k = clamp(((e.pos.x - from.x) * ax + (e.pos.z - from.z) * az) / l2, 0, 1);
          if (Math.hypot(e.pos.x - (from.x + ax * k), e.pos.z - (from.z + az * k)) < 2.4 + e.radius) this.spMarks.push(e);
        }
        G.vfx.streak(from, to, [3.2, 2.6, 1.2]);
        _v2.copy(from).lerp(to, 0.5);
        _v2.y += 1.1;
        G.vfx.slashAt(_v2, this.yaw, 178, 0, from.distanceTo(to) * 0.55 + 1.5, COLORS.spA, COLORS.spB, 0.4);
        c.play('spSlash');
        c.resetCloth();
        this.trail.clear();
        G.physics.teleport(this.body, this.pos);
        G.audio.sfx.flash();
        G.rig.shake(0.7);
        G.rig.kick(10, 0);
        G.post.flash = 0.75;
        G.post.speed = 1;
        G.enemyTime = 0;
        this.groundFx(1.4);
      }
    } else if (this.spPhase === 1) {
      if (t >= 1.02) {
        this.spPhase = 2;
        G.combat.specialRelease(this.spMarks, this);
        G.director.tween(G, { enemyTime: 1 }, 0.25);
        G.director.tween(G.post, { desat: 0, vignette: 0.42 }, 0.4);
      }
    } else if (t >= 1.4) {
      this.ki = 0;
      this.iframes = 0.3;
      this.trail.uniforms.uA.value.set(COLORS.trailA);
      c.stop();
      this.setState(this.cineMode ? 'cine' : 'idle');
    }
  }

  /** stay on walkable ground (paths, courts, bridges), sliding along its edges and any closed gate */
  constrain(px, pz) {
    navConstrain(this.pos, px, pz);
  }
}
export { rrange, easeOutCubic };
