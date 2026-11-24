import gsap from 'gsap';
import * as THREE from 'three';
import { G, ui, getUI } from '../core/state.js';
import { input } from '../core/input.js';
import { heightAt, ARENA, TRAIN_SPOT } from '../world/terrain.js';
import { COLORS } from './player.js';
import { rand, rrange, angleDiff } from '../core/util.js';

/* The director owns the flow of the slice and every cinematic:
   title -> intro (meditation, kata) -> training -> ambush -> three waves -> finisher -> victory.
   GSAP timelines run on the game's own clock so they pause, step and slow down with it.          */
gsap.ticker.remove(gsap.updateRoot);

const KATA = { x: -1.6, z: -6.4, yaw: 0.85 };
const WAVES = [
  { max: 1, list: [] }, // wave 1 is staged by the ambush cinematic
  { max: 2, label: 'Second wave', list: [['bandit', -21, 30], ['spear', -12, 33], ['bandit', -34, -4], ['spear', -30, 16]] },
  { max: 2, label: 'The captain', boss: true, list: [['captain', -33, 5], ['bandit', -31, 11], ['bandit', -31, -1]] },
];

export function createDirector(game) {
  let tl = null; // current cinematic timeline
  let wave = 0, waveBusy = false, startReal = 0;
  let slowCalls = 0, toastId = 0, capId = 0;
  let training = null;
  let skipFn = null, lastSkip = -1e9;
  const rig = () => G.rig;
  const P = () => G.player;
  const kill = () => {
    if (tl) tl.kill();
    tl = null;
  };
  const shot = (t, at, dur, from, to, lookFrom, lookTo, fov = 42, fovTo = fov, ease = 'sine.inOut') => {
    const c = rig().cine;
    t.call(() => { c.on = true; c.pos.set(...from); c.look.set(...lookFrom); c.fov = fov; c.roll = 0; rig().blend = 1; }, null, at);
    t.to(c.pos, { x: to[0], y: to[1], z: to[2], duration: dur, ease }, at);
    t.to(c.look, { x: lookTo[0], y: lookTo[1], z: lookTo[2], duration: dur, ease }, at);
    if (fovTo !== fov) t.to(c, { fov: fovTo, duration: dur, ease }, at);
  };

  const D = {
    get wave() { return wave; },
    tween: (obj, vars, dur, ease = 'power2.out') => gsap.to(obj, { ...vars, duration: dur, ease, overwrite: 'auto' }),
    toast(text, tone = 'gold') { ui({ toast: { text, tone, id: ++toastId } }); },
    caption(kanji, text, dur = 3.6) {
      const id = ++capId;
      ui({ caption: { kanji, text, id } });
      gsap.delayedCall(dur, () => getUI().caption?.id === id && ui({ caption: null }));
    },
    subtitle(text, dur = 3.5) {
      ui({ subtitle: text });
      gsap.delayedCall(dur, () => getUI().subtitle === text && ui({ subtitle: null }));
    },
    slowmo(scale, dur) {
      slowCalls++;
      const id = slowCalls;
      gsap.to(G, { timeScale: scale, duration: 0.06, overwrite: 'auto' });
      gsap.delayedCall(dur, () => id === slowCalls && gsap.to(G, { timeScale: 1, duration: 0.2, overwrite: 'auto' }));
    },
    update() {
      gsap.updateRoot(G.real);
      if (training && getUI().phase === 'training') this.updateTraining();
    },
    skip() {
      // ignore a second trigger from the same press (key repeat, or a click and a key together)
      const now = performance.now();
      if (now - lastSkip < 700) return;
      if (skipFn && getUI().canSkip) { lastSkip = now; const f = skipFn; skipFn = null; f(); }
    },
    togglePause(force) {
      const ph = getUI().phase;
      if (ph === 'title' || ph === 'loading' || ph === 'victory' || ph === 'defeat') return;
      ui({ paused: force === true ? true : !getUI().paused });
      if (getUI().paused && document.pointerLockElement) document.exitPointerLock?.();
    },
    isLastEnemy(e) {
      if (wave !== WAVES.length - 1 || getUI().phase !== 'combat') return false;
      return !G.enemies.some((o) => o !== e && o.alive);
    },

    /* ---------- title ---------- */
    startTitle() {
      kill();
      const p = P(), m = G.world.meditation;
      G.combat.clear();
      G.physics.clearDebris();
      G.vfx.clear();
      G.mood = 0;
      G.timeScale = 1;
      G.enemyTime = 1;
      Object.assign(G.post, { flash: 0, desat: 0, aberration: 0, invert: 0, vignette: 0.42, speed: 0 });
      wave = 0;
      p.hp = p.hpMax;
      p.ki = 0;
      p.stats = { hits: 0, maxCombo: 0, damage: 0, parries: 0, perfect: 0, kills: 0 };
      p.setCine(true);
      p.char.locoMode = 'calm';
      p.char.setSheathed(true);
      p.char.roll = 0;
      p.char.dissolve = 0;
      p.place(m.x, m.z, Math.PI);
      p.cineY = true;
      p.pos.y = m.y;
      p.char.play('seiza');
      G.world.birds.reset();
      G.audio.setMode('peace');
      ui({ phase: 'title', letterbox: false, canSkip: false, subtitle: null, caption: null, prompt: null, toast: null, hp: p.hp, ki: 0, combo: 0, boss: null, wave: 0, stats: null, paused: false });
      // slow drifting vista
      tl = gsap.timeline({ repeat: -1, yoyo: true });
      shot(tl, 0, 28, [8.2, 2.3, 23], [8.8, 3.5, 12.5], [0, 13.5, -46], [0.5, 11, -44], 44, 40);
    },
    begin() {
      G.audio.start();
      G.audio.sfx.gong();
      this.startIntro();
    },

    /* ---------- intro: dawn at the falls, meditation, kata ---------- */
    startIntro() {
      kill();
      const p = P(), m = G.world.meditation;
      startReal = G.real;
      ui({ phase: 'intro', letterbox: true, canSkip: true });
      skipFn = () => this.startTraining();
      tl = gsap.timeline();
      shot(tl, 0, 6.4, [26, 15, 27], [13, 7, 11], [0, 16, -46], [2, 9, -40], 46, 42);
      tl.call(() => this.caption('白滝', 'Shirataki Falls · first light', 4.2), null, 1.1);
      shot(tl, 6.4, 5.2, [m.x + 3.3, m.y + 0.5, m.z + 2.6], [m.x + 1.9, m.y + 0.8, m.z + 3.5], [m.x, m.y + 0.6, m.z], [m.x, m.y + 0.72, m.z], 34, 31);
      tl.call(() => this.subtitle('Each dawn, the blade before the water.', 3.8), null, 6.9);
      tl.call(() => p.char.play('rise'), null, 9.7);
      // cut: standing on the bank, the falls behind him
      const kx = KATA.x, kz = KATA.z, ky = heightAt(kx, kz);
      tl.call(() => {
        p.cineY = false;
        p.place(kx, kz, KATA.yaw);
        p.char.play('calm');
        p.char.anim.snap();
      }, null, 11.4);
      shot(tl, 11.4, 5.4, [kx + 3.6, ky + 1.05, kz + 3.4], [kx + 2.2, ky + 1.25, kz + 4.6], [kx, ky + 1.2, kz], [kx, ky + 1.15, kz], 36, 33);
      tl.call(() => { p.char.play('draw'); G.audio.sfx.sheath(); }, null, 11.7);
      tl.call(() => { p.char.setSheathed(false); p.char.locoMode = 'armed'; }, null, 11.94);
      tl.call(() => this.subtitle('One cut. Then another. Until the cut is all there is.', 3.6), null, 12.3);
      tl.call(() => p.startAttack('light1'), null, 12.7);
      tl.call(() => p.startAttack('light2'), null, 13.15);
      tl.call(() => p.startAttack('light3'), null, 13.6);
      tl.call(() => p.startAttack('heavy1'), null, 14.25);
      tl.call(() => this.startTraining(), null, 16.6);
    },

    /* ---------- training: a short playable warm-up that teaches the controls ---------- */
    startTraining() {
      kill();
      const p = P();
      skipFn = () => this.startAmbush();
      p.cineY = false;
      if (getUI().phase !== 'training') {
        if (Math.hypot(p.pos.x - KATA.x, p.pos.z - KATA.z) > 3) p.place(KATA.x, KATA.z, KATA.yaw);
        p.char.setSheathed(false);
        p.char.locoMode = 'armed';
        p.char.stop();
      }
      const post = G.world.post.userData;
      p.yaw = Math.atan2(post.x - p.pos.x, post.z - p.pos.z);
      rig().snapBehind(p.yaw + Math.PI);
      rig().cine.on = false;
      p.setCine(false);
      input.clear();
      training = { step: 0, count: 0, hold: 0, done: false, t: 0 };
      ui({ phase: 'training', letterbox: false, canSkip: true, subtitle: null, caption: null });
      this.showPrompt();
    },
    showPrompt() {
      const steps = [
        ['Light combo', 'Strike the straw post three times', 3],
        ['Heavy strike', 'Land a heavy attack on the post', 1],
        ['Evade', 'Dodge roll once', 1],
        ['Guard', 'Hold block for a moment. Tap it just before a blow lands to parry', 1],
      ];
      const s = steps[training.step];
      ui({ prompt: s ? { title: s[0], text: s[1], done: training.count, total: s[2], step: training.step, steps: steps.length } : null });
      training.need = s ? s[2] : 0;
    },
    trainingEvent(type) {
      if (!training || training.done || getUI().phase !== 'training') return;
      const want = ['light', 'heavy', 'roll', 'block'][training.step];
      if (type !== want) return;
      training.count++;
      if (training.count >= training.need) {
        training.step++;
        training.count = 0;
        G.audio.sfx.ui();
        if (training.step >= 4) {
          training.done = true;
          ui({ prompt: null, canSkip: false });
          this.toast('Ready', 'gold');
          gsap.delayedCall(1.3, () => getUI().phase === 'training' && this.startAmbush());
          return;
        }
      }
      this.showPrompt();
    },
    updateTraining() {
      const p = P();
      training.t += G.rdt;
      if (training.done) return;
      if (training.step === 2 && p.state === 'roll' && p.stateT < 0.05) this.trainingEvent('roll');
      if (training.step === 3) {
        training.hold = p.blocking ? training.hold + G.rdt : 0;
        if (training.hold > 0.5) this.trainingEvent('block');
      }
    },

    /* ---------- ambush ---------- */
    startAmbush() {
      kill();
      const p = P();
      training = null;
      skipFn = () => this.startCombat();
      ui({ phase: 'ambush', letterbox: true, canSkip: true, prompt: null });
      p.setCine(true);
      p.char.stop();
      p.char.roll = 0;
      p.airY = 0;
      p.hop = 0;
      G.timeScale = 1;
      // stage the first wave inside the western tree line
      G.combat.clear();
      const spots = [[-31.5, 9], [-33, 4], [-31.5, -1]];
      const px = p.pos.x, pz = p.pos.z;
      for (const [x, z] of spots) {
        const e = G.combat.spawn('bandit', x, z, Math.atan2(px - x, pz - z));
        e.char.update(0.016);
        e.char.anim.snap();
      }
      const toWest = Math.atan2(-31 - px, 4 - pz);
      const py = p.pos.y;
      const fx = Math.sin(toWest), fz = Math.cos(toWest);
      tl = gsap.timeline();
      tl.call(() => { G.world.birds.scatter(-34, 4); G.audio.sfx.birds(); }, null, 0.15);
      tl.to(G, { mood: 1, duration: 6.5, ease: 'sine.inOut' }, 0.3);
      tl.to(p, { yaw: p.yaw + angleDiff(p.yaw, toWest), duration: 1.1, ease: 'power2.inOut' }, 0.7);
      shot(tl, 0, 2.6, [px - fx * 3.2 + fz * 1.6, py + 1.75, pz - fz * 3.2 - fx * 1.6], [px - fx * 2.6 + fz * 1.2, py + 1.6, pz - fz * 2.6 - fx * 1.2], [px + fx * 10, py + 2.2, pz + fz * 10], [-30, 2.6, 4], 40, 36);
      tl.call(() => this.subtitle('…The birds have gone quiet.', 2.0), null, 0.5);
      // the tree line: they step out
      shot(tl, 2.6, 3.0, [-24.2, heightAt(-24.2, 9.5) + 0.75, 9.5], [-23.2, heightAt(-23.2, 6.5) + 0.95, 6.5], [-31, 2.0, 4.5], [-30, 1.7, 4], 38, 34);
      tl.call(() => { for (const e of G.enemies) e.cineSpeed = 1.5; G.audio.setMode('battle'); }, null, 2.7);
      tl.call(() => { this.caption('奇襲', 'AMBUSH', 2.6); G.audio.sfx.gong(); G.rig.shake(0.3); }, null, 3.4);
      tl.call(() => { for (const e of G.enemies) e.cineSpeed = 0; }, null, 5.4);
      // the samurai sets his guard
      shot(tl, 5.6, 1.9, [px + fx * 2.6 + fz * 1.1, py + 0.75, pz + fz * 2.6 - fx * 1.1], [px + fx * 2.1 + fz * 0.7, py + 0.95, pz + fz * 2.1 - fx * 0.7], [px, py + 1.3, pz], [px, py + 1.35, pz], 32, 29);
      tl.call(() => { p.char.locoMode = 'armed'; p.char.setSheathed(false); this.subtitle('Come.', 1.5); G.audio.sfx.whoosh(); }, null, 5.7);
      tl.call(() => this.startCombat(), null, 7.5);
    },

    /* ---------- combat ---------- */
    startCombat(retry = false) {
      kill();
      const p = P();
      skipFn = null;
      G.mood = Math.max(G.mood, 0.01);
      gsap.to(G, { mood: 1, duration: 2, overwrite: 'auto' });
      G.audio.setMode('battle');
      if (!G.enemies.length) {
        // skipped the cinematic or retrying: bring wave one out of the trees at a run
        for (const [x, z] of [[-31.5, 9], [-33, 4], [-31.5, -1]]) G.combat.spawn('bandit', x, z, Math.PI / 2);
      }
      for (const e of G.enemies) { e.cineSpeed = 0; e.activate(); }
      wave = 0;
      waveBusy = false;
      G.combat.max = WAVES[0].max;
      if (retry) startReal = G.real;
      p.char.locoMode = 'armed';
      p.char.setSheathed(false);
      p.setCine(false);
      const e0 = G.enemies[0];
      p.yaw = Math.atan2(e0.pos.x - p.pos.x, e0.pos.z - p.pos.z);
      rig().snapBehind(p.yaw + Math.PI);
      rig().cine.on = false;
      input.clear();
      ui({ phase: 'combat', letterbox: false, canSkip: false, prompt: null, subtitle: null, wave: 1, enemiesLeft: G.enemies.length, enemiesTotal: G.enemies.length, hp: p.hp, boss: null });
      this.toast('Defeat the ambushers', 'gold');
    },
    onEnemyDeath() {
      const left = G.enemies.filter((e) => e.alive).length;
      ui({ enemiesLeft: left });
      if (left > 0) { this.slowmo(0.4, 0.16); return; }
      if (getUI().phase !== 'combat' || waveBusy) return;
      if (wave < WAVES.length - 1) {
        waveBusy = true;
        this.slowmo(0.3, 0.5);
        gsap.delayedCall(1.7, () => getUI().phase === 'combat' && this.nextWave());
      } else {
        // the last enemy fell without the finisher (e.g. to a shockwave)
        gsap.delayedCall(1.2, () => getUI().phase === 'combat' && this.victory());
      }
    },
    nextWave() {
      wave++;
      const w = WAVES[wave], p = P();
      G.combat.max = w.max;
      p.heal(28);
      const spawned = w.list.map(([k, x, z]) => G.combat.spawn(k, x, z, Math.atan2(p.pos.x - x, p.pos.z - z)));
      ui({ wave: wave + 1, enemiesLeft: spawned.length, enemiesTotal: spawned.length });
      G.audio.sfx.wave();
      if (!w.boss) {
        for (const e of spawned) e.activate();
        this.toast(w.label, 'red');
        waveBusy = false;
        return;
      }
      // the captain walks out: a short held shot, then back to the fight
      const boss = spawned[0];
      ui({ phase: 'ambush', letterbox: true, canSkip: false });
      p.setCine(true);
      p.char.stop();
      p.char.roll = 0;
      p.airY = 0;
      p.hop = 0;
      for (const e of spawned) { e.cineSpeed = 1.3; e.char.update(0.016); e.char.anim.snap(); }
      const bx = boss.pos.x, bz = boss.pos.z, by = boss.pos.y;
      const dirx = Math.sin(boss.yaw), dirz = Math.cos(boss.yaw);
      kill();
      tl = gsap.timeline();
      shot(tl, 0, 3.4, [bx + dirx * 7.5 - dirz * 1.4, by + 0.7, bz + dirz * 7.5 + dirx * 1.4], [bx + dirx * 6.5 - dirz * 0.6, by + 1.0, bz + dirz * 6.5 + dirx * 0.6], [bx + dirx * 2, by + 1.7, bz + dirz * 2], [bx + dirx * 4, by + 1.9, bz + dirz * 4], 34, 30);
      tl.call(() => { this.caption('黒鉄', 'Kurogane · Captain of the Black Fang', 2.8); G.audio.sfx.gong(); G.rig.shake(0.35); }, null, 0.7);
      tl.to(p, { yaw: p.yaw + angleDiff(p.yaw, Math.atan2(bx - p.pos.x, bz - p.pos.z)), duration: 0.8 }, 0.2);
      tl.call(() => {
        for (const e of spawned) { e.cineSpeed = 0; e.activate(); }
        p.setCine(false);
        rig().snapBehind(p.yaw + Math.PI);
        rig().cine.on = false;
        input.clear();
        waveBusy = false;
        ui({ phase: 'combat', letterbox: false, boss: { name: boss.type.name, hp: boss.hp, hpMax: boss.hpMax } });
      }, null, 3.5);
    },

    /* ---------- finisher: one flash, a held breath, the blade returns to its scabbard ---------- */
    startFinisher(e) {
      if (getUI().phase !== 'combat') return;
      kill();
      const p = P();
      ui({ phase: 'finisher', letterbox: true, canSkip: false, toast: null });
      p.setCine(true);
      p.char.roll = 0;
      p.airY = 0;
      p.hop = 0;
      p.iframes = 99;
      e.stagger(60);
      e.knock.set(0, 0, 0);
      G.hitstop = 0;
      // line the two up
      let dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const d0 = Math.hypot(dx, dz) || 1;
      dx /= d0; dz /= d0;
      const sx = e.pos.x - dx * 3.3, sz = e.pos.z - dz * 3.3;
      const ex = e.pos.x + dx * 3.4, ez = e.pos.z + dz * 3.4;
      const yaw = Math.atan2(dx, dz);
      const mx = e.pos.x, mz = e.pos.z, my = e.pos.y;
      const nx = dz, nz = -dx; // side vector for the camera
      G.timeScale = 0.12;
      G.enemyTime = 0.15;
      G.audio.duck(true);
      G.post.aberration = 1.4;
      tl = gsap.timeline();
      tl.to(G, { timeScale: 1, duration: 0.5, ease: 'power2.in' }, 0.25);
      tl.to(G.post, { desat: 0.75, vignette: 0.68, duration: 0.4 }, 0);
      tl.call(() => {
        p.place(sx, sz, yaw);
        p.char.play('spCharge');
        p.char.anim.snap();
        p.trail.uniforms.uA.value.set(COLORS.spA);
        G.audio.sfx.charge();
        G.enemyTime = 0;
      }, null, 0.25);
      shot(tl, 0.25, 0.75, [sx + nx * 2.4 - dx * 1.6, my + 0.8, sz + nz * 2.4 - dz * 1.6], [sx + nx * 2.0 - dx * 1.2, my + 0.95, sz + nz * 2.0 - dz * 1.2], [sx + dx * 1.2, my + 1.15, sz + dz * 1.2], [mx, my + 1.25, mz], 34, 30, 'power2.out');
      // the flash step
      tl.call(() => {
        const from = new THREE.Vector3(sx, my, sz), to = new THREE.Vector3(ex, heightAt(ex, ez), ez);
        p.place(ex, ez, yaw);
        p.char.play('spSlash');
        p.trail.clear();
        G.vfx.streak(from, to, [3.4, 2.8, 1.3]);
        G.vfx.slashAt(new THREE.Vector3(mx, my + 1.15, mz), yaw, 178, 0, 4.4, COLORS.spA, COLORS.spB, 0.5);
        G.vfx.glint(e.char.chest.clone(), 4.5, 0xfff2c0, 0.35);
        G.audio.sfx.flash();
        G.rig.shake(0.8);
        G.post.invert = 1;
        G.post.flash = 0.4;
        G.post.speed = 1;
      }, null, 1.02);
      tl.to(G.post, { invert: 0, duration: 0.01 }, 1.1);
      // wide profile: both figures held still
      shot(tl, 1.02, 3.3, [mx + dx * 1.7 + nx * 8.4, my + 1.0, mz + dz * 1.7 + nz * 8.4], [mx + dx * 1.7 + nx * 7.4, my + 1.2, mz + dz * 1.7 + nz * 7.4], [mx + dx * 1.7, my + 1.15, mz + dz * 1.7], [mx + dx * 1.7, my + 1.15, mz + dz * 1.7], 36, 33, 'sine.out');
      tl.call(() => { p.char.play('sheathe', { t: 0.9 }); G.audio.sfx.sheath(); }, null, 1.9);
      tl.call(() => {
        // the click of the guard meeting the scabbard: only now does the cut arrive
        p.char.setSheathed(true);
        p.char.locoMode = 'calm';
        G.audio.sfx.click();
        G.audio.sfx.hit(true);
        const c = e.char.chest.clone();
        for (let i = 0; i < 7; i++) G.vfx.slashAt(c, rand() * 6.283, rrange(-80, 80), rrange(-30, 30), rrange(1.6, 2.6), COLORS.spA, COLORS.spB, rrange(0.25, 0.45));
        G.vfx.sparks(c, null, 40, [3.4, 2.8, 1.2], 14);
        G.vfx.petals(c, 46, [1.0, 0.2, 0.28], 7);
        G.vfx.burst(c, [3.4, 3.2, 2.6], 3.4, 0.2);
        G.rig.shake(0.9);
        G.post.flash = 0.7;
        G.enemyTime = 1;
        e.state = 'hit';
        e.takeHit(9999, p.pos.x, p.pos.z, { heavy: 1, knock: 1 }, { pierce: true });
        ui({ boss: null });
      }, null, 3.28);
      tl.to(G.post, { desat: 0, vignette: 0.42, duration: 1.0 }, 3.3);
      tl.call(() => this.victory(), null, 4.9);
    },

    /* ---------- victory ---------- */
    victory() {
      if (getUI().phase === 'victory') return;
      kill();
      const p = P();
      const time = G.real - startReal;
      const s = p.stats;
      const rank = s.damage < 20 && time < 170 ? 'S' : s.damage < 55 ? 'A' : s.damage < 110 ? 'B' : 'C';
      ui({ phase: 'victory', letterbox: true, canSkip: false, boss: null, prompt: null });
      p.setCine(true);
      p.iframes = 99;
      p.char.stop();
      p.char.locoMode = 'calm';
      if (!p.char.sheathed) { p.char.play('sheathe'); gsap.delayedCall(2.2, () => { p.char.setSheathed(true); G.audio.sfx.click(); }); }
      p.trail.uniforms.uA.value.set(COLORS.trailA);
      G.audio.duck(false);
      G.audio.setMode('victory');
      G.timeScale = 1;
      G.enemyTime = 1;
      const px = p.pos.x, pz = p.pos.z, py = p.pos.y;
      tl = gsap.timeline();
      tl.to(G, { mood: 2, duration: 5, ease: 'sine.inOut' }, 0);
      tl.to(G.post, { desat: 0, vignette: 0.42, duration: 1 }, 0);
      // face the falls
      tl.to(p, { yaw: p.yaw + angleDiff(p.yaw, Math.PI), duration: 2.2, ease: 'sine.inOut' }, 0.6);
      shot(tl, 0, 5.2, [px - 2.4, py + 0.8, pz + 3.0], [px + 1.8, py + 1.15, pz + 3.3], [px, py + 1.3, pz], [px, py + 1.35, pz - 1], 33, 31);
      tl.call(() => { this.caption('勝利', 'VICTORY', 5); G.audio.sfx.gong(); }, null, 1.6);
      shot(tl, 5.2, 9, [px + 2.2, py + 2.0, pz + 6], [px + 7, py + 11, pz + 21], [px, py + 1.4, pz - 2], [0, 13, -44], 36, 44);
      tl.call(() => ui({ stats: { time, rank, ...s } }), null, 6.4);
    },
    onPlayerDeath() {
      kill();
      ui({ boss: null, letterbox: false });
      G.audio.duck(true);
      this.slowmo(0.25, 1.4);
      gsap.to(G.post, { desat: 0.9, vignette: 0.7, duration: 1.2 });
      gsap.delayedCall(1.5, () => ui({ phase: 'defeat' }));
    },
    retry() {
      const p = P();
      G.combat.clear();
      G.physics.clearDebris();
      G.vfx.clear();
      p.hp = p.hpMax;
      p.ki = 30;
      p.iframes = 1;
      p.char.dissolve = 0;
      p.place(ARENA.x + 2, ARENA.z, -Math.PI / 2);
      p.state = 'cine';
      G.timeScale = 1;
      G.audio.duck(false);
      gsap.to(G.post, { desat: 0, vignette: 0.42, duration: 0.5 });
      p.stats = { hits: 0, maxCombo: 0, damage: 0, parries: 0, perfect: 0, kills: 0 };
      this.startCombat(true);
    },
    restart() {
      this.startTitle();
    },
  };
  return D;
}
export { TRAIN_SPOT };
