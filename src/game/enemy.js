import * as THREE from 'three';
import { G } from '../core/state.js';
import { Character } from '../chars/character.js';
import { Footing } from './footing.js';
import { steer } from './pathing.js';
import { groundAt as heightAt, waterDepthAt, constrain as navConstrain } from '../world/nav.js';
import { damp, dampAngle, angleDiff, clamp, saturate, DEG, rand, rrange, rpick } from '../core/util.js';

/* `grow` makes each level's boss bigger than the last (on top of the rig's own scale: monk 1.4, captain 1.6, lord 1.8).
   Radius, approach range, circling ring, attack reach and slam size grow with it, so a bigger boss hits where its blade lands. */
export const TYPES = {
  bandit: { hp: 64, dmg: 11, speed: 4.6, radius: 0.42, block: 0.22, hop: 0.13, attacks: ['over', 'side'], range: 1.95, cd: [1.5, 3.0], ring: 4.3, name: 'Bandit' },
  spear: { hp: 58, dmg: 13, speed: 4.3, radius: 0.42, block: 0.14, hop: 0.2, attacks: ['thrust', 'thrust', 'sweep'], range: 2.85, cd: [1.9, 3.4], ring: 5.0, name: 'Spearman' },
  elite: { hp: 104, dmg: 14, speed: 4.8, radius: 0.44, block: 0.34, hop: 0.12, attacks: ['over', 'side', 'double', 'over'], range: 2.05, cd: [1.1, 2.3], ring: 4.0, name: 'Black Fang Guard' },
  monk: { hp: 290, dmg: 15, speed: 4.3, radius: 0.52, block: 0.3, hop: 0.08, attacks: ['thrust', 'sweep', 'thrust', 'sweep'], range: 3.2, cd: [0.9, 1.7], ring: 4.8, grow: 1.15, poise: true, boss: true, name: 'Jakugan, the Fallen Abbot' },
  captain: { hp: 340, dmg: 16, speed: 4.1, radius: 0.56, block: 0.42, hop: 0, attacks: ['double', 'slam', 'over', 'double'], range: 2.35, cd: [0.9, 1.8], ring: 3.9, grow: 1.33, poise: true, boss: true, name: 'Kurogane, Captain of the Black Fang' },
  lord: { hp: 560, dmg: 19, speed: 4.4, radius: 0.6, block: 0.46, hop: 0, attacks: ['double', 'slam', 'over', 'double', 'slam'], range: 2.6, cd: [0.8, 1.5], ring: 4.1, grow: 1.34, poise: true, boss: true, enrage: 0.5, name: 'Onikage, Lord of the Black Fang' },
};
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Enemy {
  constructor(kind, scene, x, z) {
    this.kind = kind;
    this.type = TYPES[kind];
    this.scene = scene;
    this.grow = this.type.grow ?? 1;
    this.char = new Character(kind, scene, this.grow);
    this.pos = this.char.pos;
    this.footing = new Footing(); // how the body rides the ground: steps, stairs, slopes
    this.pos.set(x, this.footing.reset(x, z), z);
    this.yaw = 0;
    this.radius = this.type.radius * this.grow;
    this.range = this.type.range * this.grow;
    this.hpMax = this.type.hp;
    this.hp = this.hpMax;
    this.alive = true;
    this.active = false; // AI enabled
    this.state = 'cine';
    this.stateT = 0;
    this.cooldown = rrange(0.6, 2.2);
    this.hasToken = false;
    this.knock = new THREE.Vector3();
    this.sep = new THREE.Vector3();
    this.slotA = rand() * 6.283;
    this.strafe = rand() < 0.5 ? 1 : -1;
    this.ringR = this.type.ring * this.grow + rrange(-0.4, 0.6);
    this.poiseHits = 0;
    this.hop = 0;
    this.cineSpeed = 0;
    this.body = G.physics.createCharacter(this.radius * 0.85, 1.7);
    G.physics.teleport(this.body, this.pos);
    this.trail = G.vfx.trail(this.type.boss ? '#ff6a3a' : '#ff9a6a', '#fff0d8', 0.14);
    this.bar = this.type.boss ? null : G.vfx.bar();
    this.rage = 1; // attack tempo multiplier (the lord's second wind)
    this.barT = 0;
    this.lastPhase = 0;
    this.goal = new THREE.Vector3(x, 0, z);
    this.removeT = 0;
  }
  setState(s) {
    this.state = s;
    this.stateT = 0;
  }
  activate() {
    this.active = true;
    if (this.state === 'cine') this.setState('enter');
  }
  releaseToken() {
    if (this.hasToken) {
      this.hasToken = false;
      G.combat.releaseToken(this);
    }
  }
  face(target, k, dt) {
    this.yaw = dampAngle(this.yaw, Math.atan2(target.x - this.pos.x, target.z - this.pos.z), k, dt);
  }

  /** player is starting a swing at us: maybe guard or hop away */
  reactToSwing(clip) {
    if (!this.active || !this.alive) return;
    if (this.state !== 'circle' && this.state !== 'approach' && this.state !== 'recover') return;
    const r = rand();
    if (r < this.type.block) {
      this.setState('block');
      this.char.play('block');
      this.releaseToken();
    } else if (r < this.type.block + this.type.hop && !clip.heavy) {
      this.setState('hop');
      this.char.play('hop');
      this.releaseToken();
      const p = G.player.pos, dx = this.pos.x - p.x, dz = this.pos.z - p.z, l = Math.hypot(dx, dz) || 1;
      this.knock.set((dx / l) * 9, 0, (dz / l) * 9);
      G.vfx.dust(this.pos, 3, 0.7);
    }
  }

  /** returns 'hit' | 'blocked' | 'break' | 'dodge' | 'dead' */
  takeHit(dmg, fromX, fromZ, clip, opts = {}) {
    if (!this.alive) return 'dodge';
    if (this.state === 'hop' && this.stateT < 0.26) return 'dodge';
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, l = Math.hypot(dx, dz) || 1;
    const facing = Math.abs(angleDiff(this.yaw, Math.atan2(-dx, -dz))) < 1.7;
    let result = 'hit';
    if (this.state === 'block' && facing && !opts.pierce) {
      if (!clip.heavy) {
        this.hp = Math.max(1, this.hp - dmg * 0.14);
        this.knock.set((dx / l) * 2.6, 0, (dz / l) * 2.6);
        this.stateT = Math.min(this.stateT, 0.25);
        this.barT = 3;
        return 'blocked';
      }
      result = 'break';
    }
    if (this.state === 'stagger') dmg *= 1.35;
    this.hp -= dmg;
    this.barT = 4;
    this.char.flash = 1;
    const kn = (clip.knock ? 9.5 : 4.2) * (this.type.poise ? 0.45 : 1) * (opts.knock ?? 1);
    this.knock.set((dx / l) * kn, 0, (dz / l) * kn);
    if (this.type.enrage && !this.enraged && this.hp > 0 && this.hp < this.hpMax * this.type.enrage) {
      this.enraged = true;
      this.rage = 0.62;
      G.director.bossEnrage?.(this);
    }
    if (this.hp <= 0) {
      if (opts.spare) { this.hp = 1; }
      else { this.die(dx / l, dz / l); return 'dead'; }
    }
    if (result === 'break') {
      this.stagger(1.25);
      return 'break';
    }
    if (this.type.poise && !clip.heavy && this.state !== 'stagger' && this.state !== 'hit') {
      // heavy armour shrugs off light cuts until its poise breaks
      if (++this.poiseHits < 4) return 'hit';
      this.poiseHits = 0;
    }
    if (this.state !== 'stagger') {
      this.interrupt();
      this.setState('hit');
      this.char.play('hit');
    }
    return 'hit';
  }
  interrupt() {
    this.releaseToken();
    this.trail.on = false;
    this.hop = 0;
    this.telegraphed = false;
  }
  stagger(t = 1.2) {
    this.interrupt();
    this.setState('stagger');
    this.staggerT = t;
    this.char.play('stagger');
    this.poiseHits = 0;
  }
  die(nx = 0, nz = 1) {
    this.alive = false;
    this.interrupt();
    this.setState('dead');
    this.char.play('dead');
    this.yaw = Math.atan2(-nx, -nz); // fall away from the blow
    this.knock.set(nx * 7, 0, nz * 7);
    if (this.bar) this.bar.g.visible = false;
    G.audio.sfx.death();
    // the weapon spins away as a physics body
    const w = this.char.rig.weapon;
    w.updateWorldMatrix(true, false);
    const drop = w.clone(true);
    drop.traverse((m) => { if (m.isMesh && m.material.side === THREE.BackSide) m.visible = false; });
    w.matrixWorld.decompose(drop.position, drop.quaternion, drop.scale);
    drop.userData.baseScale = drop.scale.x;
    this.scene.add(drop);
    w.visible = false;
    _v.set(nx * 4 + rrange(-2, 2), rrange(4, 7), nz * 4 + rrange(-2, 2));
    _v2.set(rrange(-9, 9), rrange(-4, 4), rrange(-9, 9));
    G.physics.spawnDebris(drop, drop.position, _v, _v2, { box: this.char.rig.variant.weapon === 'spear' ? [0.03, 0.9, 0.03] : [0.03, 0.42, 0.03] }, 7);
    G.combat.onEnemyDeath(this);
  }

  update(dt) {
    if (dt <= 0) return;
    const c = this.char, T = this.type, P = G.player;
    this.stateT += dt;
    this.cooldown -= dt;
    const px = P.pos.x - this.pos.x, pz = P.pos.z - this.pos.z, pd = Math.hypot(px, pz) || 1e-3;
    let vx = 0, vz = 0, locoSpeed = 0, lmx = 0, lmz = 1;
    const moveTo = (tx, tz, speed, stop = 0.3) => {
      const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
      if (d < stop) return d;
      const s = Math.min(speed, d * 4);
      // round water, walls and rails rather than into them, when the straight way is shut (game/pathing.js)
      const w = this.active ? steer(this.pos.x, this.pos.z, tx, tz) : null;
      vx = (w ? w.x : dx / d) * s;
      vz = (w ? w.z : dz / d) * s;
      return d;
    };

    switch (this.state) {
      case 'cine': // posed for the camera; the director may walk us forward
        if (this.cineSpeed) { vx = Math.sin(this.yaw) * this.cineSpeed; vz = Math.cos(this.yaw) * this.cineSpeed; }
        break;
      case 'enter': {
        // run out of the trees toward a place on the ring around the player
        const gx = P.pos.x + Math.sin(this.slotA) * (this.ringR + 1.5), gz = P.pos.z + Math.cos(this.slotA) * (this.ringR + 1.5);
        const d = moveTo(gx, gz, T.speed * 1.15, 1.2);
        this.yaw = dampAngle(this.yaw, Math.atan2(vx || px, vz || pz), 8, dt);
        if (d < 1.4 || pd < this.ringR + 1 || this.stateT > 7) this.setState('circle');
        break;
      }
      case 'circle': {
        this.slotA += this.strafe * 0.22 * dt;
        if (rand() < dt * 0.12) this.strafe *= -1;
        const gx = P.pos.x + Math.sin(this.slotA) * this.ringR, gz = P.pos.z + Math.cos(this.slotA) * this.ringR;
        moveTo(gx, gz, pd > this.ringR + 3 ? T.speed : 2.4, 0.25);
        this.face(P.pos, 7, dt);
        if (this.active && P.alive && !P.cineMode && this.cooldown <= 0 && pd < 9 && G.combat.requestToken(this)) {
          this.hasToken = true;
          this.setState('approach');
        }
        break;
      }
      case 'approach': {
        const d = moveTo(P.pos.x, P.pos.z, T.speed, this.range * 0.9);
        this.face(P.pos, 9, dt);
        if (d <= this.range * 1.05) this.startAttack(rpick(T.attacks));
        else if (this.stateT > 2.6 || !P.alive || P.cineMode) { this.releaseToken(); this.cooldown = 0.8; this.setState('circle'); }
        break;
      }
      case 'attack': {
        const clip = c.clip, t = c.clipT, hit = this.secondHit ? clip.hit2 : clip.hit;
        if (t < hit[0] - 0.14) this.face(P.pos, 6, dt);
        // weapon glint as the windup peaks: gold = can be parried, red = must be dodged
        if (!this.telegraphed && t >= clip.tell) {
          this.telegraphed = true;
          G.vfx.glint(c.tip, clip.unblockable ? 2.2 : 1.3, clip.unblockable ? 0xff2a1a : 0xffe7a8, clip.unblockable ? 0.5 : 0.32, c.tip);
          G.audio.sfx.glint(!!clip.unblockable);
        }
        if (t > hit[0] - 0.1 && t < hit[0] + 0.05) {
          const ls = (clip.lunge ?? 1) / 0.15 * saturate((pd - this.range * 0.55) / 1.2 + 0.25);
          vx = Math.sin(this.yaw) * ls;
          vz = Math.cos(this.yaw) * ls;
        }
        if (clip.hop) this.hop = Math.sin(Math.PI * saturate((t - 0.3) / (hit[0] + 0.06 - 0.3))) * clip.hop;
        if (!this.swingOn && t >= hit[0] - 0.04) {
          this.swingOn = true;
          this.hitDone = false;
          this.trail.on = true;
          const sl = this.secondHit ? clip.slash2 : clip.slash;
          if (sl) G.vfx.slash(this.pos, this.yaw, sl, clip.reach * this.grow, clip.unblockable ? '#ff3a22' : '#ff8a4a', '#fff0d0', 0.26);
          G.audio.sfx.whoosh(!!this.type.boss);
        }
        if (this.swingOn && !this.hitDone && t >= hit[0]) {
          const ang = Math.abs(angleDiff(this.yaw, Math.atan2(px, pz)));
          if (pd - P.radius <= clip.reach * this.grow && (pd < 1.0 || ang < (clip.arcDeg * 0.5) * DEG) && P.airY < 1.4) {
            this.hitDone = true;
            G.combat.enemyHit(this, clip);
          }
          if (clip.slam && t >= hit[0] + 0.04 && !this.slammed) {
            this.slammed = true;
            _v.set(this.pos.x + Math.sin(this.yaw) * 1.6 * this.grow, this.pos.y, this.pos.z + Math.cos(this.yaw) * 1.6 * this.grow);
            G.combat.slam(_v, 2, this);
          }
        }
        if (t > hit[1] + 0.04 && this.swingOn) {
          this.trail.on = false;
          if (clip.hit2 && !this.secondHit) { this.secondHit = true; this.swingOn = false; this.face(P.pos, 60, dt); }
        }
        if (t >= clip.dur) {
          this.trail.on = false;
          this.hop = 0;
          c.stop();
          this.setState('recover');
          this.recoverT = rrange(0.25, 0.55);
        }
        break;
      }
      case 'recover':
        this.face(P.pos, 4, dt);
        if (this.stateT >= this.recoverT) { this.releaseToken(); this.cooldown = rrange(T.cd[0], T.cd[1]) * this.rage; this.setState('circle'); }
        break;
      case 'block':
        this.face(P.pos, 10, dt);
        if (this.stateT > 0.75) { c.stop(); this.cooldown = Math.min(this.cooldown, 0.5); this.setState('circle'); }
        break;
      case 'hop':
        this.face(P.pos, 8, dt);
        if (this.stateT > 0.42) { c.stop(); this.setState('circle'); }
        break;
      case 'hit':
        if (this.stateT > 0.42) { c.stop(); this.cooldown = Math.max(this.cooldown, 0.5); this.setState('circle'); }
        break;
      case 'stagger':
        if (this.stateT > this.staggerT) { c.stop(); this.cooldown = 0.6; this.setState('circle'); }
        break;
      case 'dead': {
        const t = this.stateT;
        if (t > 0.75) c.dissolve = saturate((t - 0.75) / 1.0);
        if (t > 0.75 && c.rig.outline.visible) { c.rig.outline.visible = false; G.vfx.petals(c.chest, 18, [0.9, 0.16, 0.22], 3); }
        if (t > 1.85) this.remove = true;
        break;
      }
    }

    // integrate: steering + knockback + separation
    this.knock.x = damp(this.knock.x, 0, 7, dt);
    this.knock.z = damp(this.knock.z, 0, 7, dt);
    const mx = vx + this.knock.x + this.sep.x, mz = vz + this.knock.z + this.sep.z;
    const ox = this.pos.x, oz = this.pos.z;
    G.physics.moveCharacter(this.body, this.pos, mx * dt, mz * dt);
    if (this.active || this.state === 'dead') {
      // stay inside the encounter's arena and on walkable ground
      const A = G.arena;
      if (A) {
        const dx = this.pos.x - A.x, dz = this.pos.z - A.z, d = Math.hypot(dx, dz);
        if (d > A.r - 0.5) { this.pos.x = A.x + (dx / d) * (A.r - 0.5); this.pos.z = A.z + (dz / d) * (A.r - 0.5); }
      }
      navConstrain(this.pos, ox, oz);
    }
    const gy = this.footing.update(this.pos.x, this.pos.z, dt, Math.hypot(this.pos.x - ox, this.pos.z - oz));
    this.pos.y = gy + this.hop;
    c.footY = gy;
    c.footIK = this.state === 'dead' ? 0 : 1;

    // animation
    locoSpeed = this.state === 'attack' || this.state === 'dead' || this.state === 'hit' || this.state === 'stagger' ? 0 : Math.hypot(vx, vz);
    c.yaw = this.yaw;
    const L = c.loco;
    L.speed = damp(L.speed, locoSpeed, 10, dt);
    if (locoSpeed > 0.2) {
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      lmx = (vx * cy - vz * sy) / locoSpeed;
      lmz = (vx * sy + vz * cy) / locoSpeed;
      L.mx = damp(L.mx, lmx, 10, dt);
      L.mz = damp(L.mz, lmz, 10, dt);
    }
    c.update(dt);
    this.trail.update(c.base, c.tip, G.time);
    if (locoSpeed > 2.5) {
      const ph = Math.floor(L.phase / Math.PI);
      if (ph !== this.lastPhase) {
        this.lastPhase = ph;
        if (waterDepthAt(this.pos.x, this.pos.z) > 0.04) { G.vfx.splash(this.pos, 3, 0.45); }
      }
    }
  }

  /** bar is positioned in real time so it stays readable through hit-stop */
  updateBar(rdt, camera) {
    const b = this.bar;
    if (!b) return;
    this.barT -= rdt;
    const show = this.alive && this.barT > 0 && this.hp < this.hpMax;
    b.g.visible = show;
    if (!show) return;
    b.g.position.copy(this.char.head);
    b.g.position.y += 0.52;
    b.g.quaternion.copy(camera.quaternion);
    const s = clamp(camera.position.distanceTo(this.pos) * 0.12, 0.7, 1.6);
    b.g.scale.setScalar(s);
    const v = clamp(this.hp / this.hpMax, 0, 1);
    b.v = v;
    b.lagV = b.lagV > v ? Math.max(v, b.lagV - rdt * 0.5) : v;
    b.fill.scale.x = 0.8 * v;
    b.lag.scale.x = 0.8 * b.lagV;
  }

  startAttack(name) {
    this.setState('attack');
    this.char.play(name);
    this.swingOn = false;
    this.hitDone = false;
    this.telegraphed = false;
    this.secondHit = false;
    this.slammed = false;
  }

  dispose() {
    this.char.dispose(this.scene);
    G.vfx.removeTrail(this.trail);
    if (this.bar) G.vfx.removeBar(this.bar);
    G.physics.removeCharacter(this.body);
  }
}
