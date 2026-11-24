import * as THREE from 'three';
import { G, ui } from '../core/state.js';
import { Enemy } from './enemy.js';
import { COLORS } from './player.js';
import { waterDepthAt } from '../world/terrain.js';
import { rand, rrange, angleDiff } from '../core/util.js';

/* Resolves hits in both directions, hands out attack tokens so enemies take turns,
   spreads them around the player, and owns the "game feel" (hit-stop, shake, sparks). */
export function createCombat(scene) {
  const tokens = new Set();
  const _p = new THREE.Vector3(), _d = new THREE.Vector3();
  let combo = 0, comboT = 0;

  const fx = (strength, pos) => {
    G.hitstop = Math.max(G.hitstop, strength.stop);
    G.rig.shake(strength.shake);
    G.post.aberration = Math.max(G.post.aberration, strength.ab ?? 0);
  };
  const addCombo = (n = 1) => {
    combo += n;
    comboT = 2.6;
    const s = G.player.stats;
    s.hits += n;
    s.maxCombo = Math.max(s.maxCombo, combo);
    ui({ combo, comboAt: G.real });
  };

  const combat = {
    max: 1,
    get combo() { return combo; },
    requestToken(e) {
      if (tokens.size >= this.max) return false;
      tokens.add(e);
      return true;
    },
    releaseToken(e) { tokens.delete(e); },
    spawn(kind, x, z, yaw = 0) {
      const e = new Enemy(kind, scene, x, z);
      e.yaw = yaw;
      e.char.yaw = yaw;
      G.enemies.push(e);
      return e;
    },
    clear() {
      for (const e of G.enemies) e.dispose();
      G.enemies.length = 0;
      tokens.clear();
      combo = 0;
      ui({ combo: 0, boss: null });
    },

    /* ---------- player -> enemy ---------- */
    playerHit(e, clip, player) {
      const dmg = clip.dmg * (1 + Math.min(combo, 30) * 0.012);
      const eff = dmg * (e.state === 'stagger' ? 1.35 : 1);
      const blocking = e.state === 'block' && !clip.heavy;
      const last = G.director.isLastEnemy(e);
      if (last && !blocking && e.hp - eff <= 0 && !(e.state === 'hop' && e.stateT < 0.26)) {
        // the final blow becomes the cinematic finisher
        e.takeHit(dmg, player.pos.x, player.pos.z, clip, { spare: true });
        this.hitFx(e, clip, 'hit');
        addCombo();
        G.director.startFinisher(e);
        return;
      }
      const res = e.takeHit(dmg, player.pos.x, player.pos.z, clip);
      if (res === 'dodge') return;
      this.hitFx(e, clip, res);
      if (res === 'blocked') return;
      addCombo();
      player.addKi(clip.heavy ? 11 : 6.5);
      if (res === 'break') G.director.toast('GUARD BREAK', 'gold');
    },
    hitFx(e, clip, res) {
      const c = e.char;
      _p.copy(c.chest);
      _d.set(e.pos.x - G.player.pos.x, 0.3, e.pos.z - G.player.pos.z).normalize();
      if (res === 'blocked') {
        _p.lerp(G.player.char.tip, 0.5);
        G.vfx.sparks(_p, _d, 10, [3.2, 2.6, 1.2], 8);
        G.vfx.glint(_p, 1.1, 0xffe9b0, 0.16);
        G.audio.sfx.clang();
        fx({ stop: 0.035, shake: 0.14 });
        e.char.flash = 0.25;
        return;
      }
      const heavy = !!clip.heavy || res === 'dead' || res === 'break';
      G.vfx.sparks(_p, _d, heavy ? 22 : 12, [2.6, 3.0, 3.4], heavy ? 13 : 9);
      G.vfx.petals(_p, heavy ? 16 : 7, [1.0, 0.2, 0.28], heavy ? 5.5 : 3.6);
      G.vfx.burst(_p, [3, 3, 3.4], heavy ? 2.0 : 1.3, 0.12);
      G.vfx.glint(_p, heavy ? 2.6 : 1.5, 0xffffff, 0.2);
      if (res === 'break') { G.audio.sfx.clang(true); G.vfx.sparks(_p, _d, 16, [3.4, 2.6, 1.0], 11); }
      G.audio.sfx.hit(heavy);
      if (waterDepthAt(e.pos.x, e.pos.z) > 0.05) G.vfx.splash(e.pos, heavy ? 12 : 5, heavy ? 1.2 : 0.7);
      fx(heavy ? { stop: res === 'dead' ? 0.15 : 0.11, shake: 0.5, ab: 0.9 } : { stop: 0.055, shake: 0.22, ab: 0.45 });
      if (heavy) G.rig.kick(4, -0.3);
    },
    postHit(post, clip, player) {
      const u = post.userData;
      const dx = u.x - player.pos.x, dz = u.z - player.pos.z, l = Math.hypot(dx, dz) || 1;
      u.dirX = dx / l;
      u.dirZ = dz / l;
      u.wobbleV += clip.heavy ? 7 : 3.6;
      _p.set(u.x, post.position.y + 1.35, u.z);
      _d.set(dx / l, 0.4, dz / l);
      G.vfx.sparks(_p, _d, clip.heavy ? 12 : 6, [2.6, 2.1, 1.1], 7);
      G.vfx.dust(_p, clip.heavy ? 5 : 2, 0.6, [0.86, 0.75, 0.45]);
      G.vfx.glint(_p, clip.heavy ? 1.8 : 1.1, 0xffffff, 0.16);
      G.audio.sfx.hit(!!clip.heavy);
      fx(clip.heavy ? { stop: 0.09, shake: 0.4, ab: 0.6 } : { stop: 0.045, shake: 0.16, ab: 0.3 });
      addCombo();
      player.addKi(clip.heavy ? 14 : 9);
      G.director.trainingEvent(clip.heavy ? 'heavy' : 'light');
    },

    /* ---------- enemy -> player ---------- */
    enemyHit(e, clip) {
      const P = G.player;
      const res = P.receiveHit(e, clip, e.type.dmg * clip.dmg);
      _p.copy(P.char.chest).lerp(e.char.tip, 0.4);
      _d.set(P.pos.x - e.pos.x, 0.3, P.pos.z - e.pos.z).normalize();
      if (res === 'parry') {
        G.vfx.sparks(_p, _d.negate(), 30, [3.6, 3.0, 1.4], 14);
        G.vfx.glint(_p, 3.4, 0xfff2c0, 0.32);
        G.vfx.burst(_p, [3.4, 3.0, 2.0], 2.4, 0.16);
        G.vfx.ring(P.pos, 0.4, 2.6, '#ffe9a8', 0.4);
        G.audio.sfx.parry();
        e.stagger(1.5);
        e.knock.set(_d.x * 5, 0, _d.z * 5);
        fx({ stop: 0.12, shake: 0.5, ab: 1 });
        G.post.flash = 0.35;
        G.director.slowmo(0.22, 0.42);
        G.director.toast('PARRY', 'gold');
      } else if (res === 'block') {
        G.vfx.sparks(_p, _d, 12, [3.2, 2.6, 1.2], 8);
        G.vfx.glint(_p, 1.3, 0xffe9b0, 0.16);
        G.audio.sfx.clang();
        fx({ stop: 0.045, shake: 0.24 });
      } else if (res === 'hit') {
        G.vfx.sparks(_p, _d, 14, [3.4, 1.2, 0.8], 10);
        G.vfx.petals(P.char.chest, 10, [1.0, 0.16, 0.2], 4.5);
        G.vfx.burst(_p, [3.4, 1.4, 1.0], 1.8, 0.14);
        G.audio.sfx.hit(true);
        G.audio.sfx.hurt();
        fx({ stop: 0.09, shake: clip.unblockable ? 0.9 : 0.6, ab: 1.2 });
        combo = 0;
        ui({ combo: 0 });
      }
      return res;
    },
    perfectDodge() {
      G.director.slowmo(0.28, 0.5);
      G.director.toast('PERFECT DODGE', 'cyan');
      G.post.aberration = 1;
      G.rig.kick(-5, 0.4);
      G.audio.sfx.parry();
    },
    /** ground impact from slams. level 2 adds a damaging shockwave when an enemy owns it */
    slam(pos, level, owner) {
      const wet = waterDepthAt(pos.x, pos.z) > 0.03;
      G.vfx.ring(pos, 0.4, level >= 2 ? 4.4 : 2.4, owner.kind ? '#ffb07a' : '#dff4ff', level >= 2 ? 0.55 : 0.4);
      if (wet) { G.vfx.splash(pos, level >= 2 ? 26 : 12, level >= 2 ? 1.8 : 1.1); G.audio.sfx.splash(); }
      else G.vfx.dust(pos, level >= 2 ? 14 : 7, level >= 2 ? 1.6 : 1.0);
      _d.set(0, 1, 0);
      G.vfx.sparks(pos, _d, level >= 2 ? 16 : 8, wet ? [2.2, 3.0, 3.2] : [2.4, 2.0, 1.4], 8);
      G.audio.sfx.land(true);
      G.rig.shake(0.3 * level);
      if (owner.kind && level >= 2 && !owner.hitDone) {
        const P = G.player;
        if (Math.hypot(P.pos.x - pos.x, P.pos.z - pos.z) < 3.0 && P.airY < 0.7) {
          owner.hitDone = true;
          this.enemyHit(owner, owner.char.clip);
        }
      }
    },
    /** the delayed cuts of the special land all at once */
    specialRelease(marks, player) {
      let n = 0;
      for (const e of marks) {
        if (!e.alive) continue;
        n++;
        _p.copy(e.char.chest);
        for (let i = 0; i < 5; i++) G.vfx.slashAt(_p, rand() * 6.283, rrange(-80, 80), rrange(-30, 30), rrange(1.4, 2.2), COLORS.spA, COLORS.spB, rrange(0.22, 0.4));
        const last = G.director.isLastEnemy(e);
        const res = e.takeHit(64, player.pos.x, player.pos.z, { heavy: 1, knock: 1 }, { pierce: true, spare: last });
        _d.set(0, 0.6, 0);
        G.vfx.sparks(_p, _d, 26, [3.4, 2.8, 1.2], 13);
        G.vfx.petals(_p, 20, [1.0, 0.2, 0.28], 6);
        G.vfx.glint(_p, 3, 0xfff0c0, 0.3);
        if (last && res !== 'dead') e.stagger(2.4);
      }
      if (n) {
        G.audio.sfx.hit(true);
        G.audio.sfx.flash();
        fx({ stop: 0.16, shake: 0.85, ab: 1.4 });
        G.post.flash = 0.55;
        addCombo(n * 3);
      } else G.audio.sfx.sheath();
    },
    onEnemyDeath(e) {
      G.player.stats.kills++;
      G.player.addKi(8);
      if (G.player.target === e) G.player.target = null;
      G.director.onEnemyDeath(e);
    },

    update(dt, rdt) {
      // combo decay
      if (combo > 0) {
        comboT -= dt;
        if (comboT <= 0) { combo = 0; ui({ combo: 0 }); }
      }
      // spread enemies round the player and keep bodies apart
      const E = G.enemies, P = G.player;
      for (const e of E) e.sep.set(0, 0, 0);
      for (let i = 0; i < E.length; i++) {
        const a = E[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < E.length; j++) {
          const b = E[j];
          if (!b.alive) continue;
          const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z, d = Math.hypot(dx, dz) || 0.01, min = a.radius + b.radius + 0.35;
          if (d < min) {
            const k = ((min - d) / min) * 3.2;
            a.sep.x += (dx / d) * k; a.sep.z += (dz / d) * k;
            b.sep.x -= (dx / d) * k; b.sep.z -= (dz / d) * k;
          }
          const da = angleDiff(a.slotA, b.slotA);
          if (Math.abs(da) < 0.9) {
            const push = (0.9 - Math.abs(da)) * 0.9 * dt * (da >= 0 ? 1 : -1);
            a.slotA -= push;
            b.slotA += push;
          }
        }
        // do not stand inside the player
        const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 0.01, min = a.radius + P.radius + 0.25;
        if (d < min && P.state !== 'roll' && P.attack !== 'dash') {
          const k = ((min - d) / min) * 4;
          a.sep.x += (dx / d) * k;
          a.sep.z += (dz / d) * k;
        }
      }
    },
  };
  return combat;
}
