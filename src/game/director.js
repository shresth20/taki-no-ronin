import gsap from 'gsap';
import * as THREE from 'three';
import { G, ui, getUI } from '../core/state.js';
import { input } from '../core/input.js';
import { groundAt as heightAt } from '../world/nav.js';
import { ZONES } from '../world/zones/index.js';
import { TYPES } from './enemy.js';
import { COLORS } from './player.js';
import { rand, rrange, angleDiff } from '../core/util.js';

/* The director owns the flow of the journey and every cinematic:
   title -> intro (meditation, kata) -> training -> departure -> the road through six zones.
   On the road it stages what the journey module triggers: zone reveals, ambushes, boss entrances, the finisher,
   defeat and the last victory. GSAP timelines run on the game's own clock so they pause, step and slow with it.  */
gsap.ticker.remove(gsap.updateRoot);

const KATA = { x: -1.6, z: -6.4, yaw: 0.85 };

export function createDirector(game) {
  let tl = null; // current cinematic timeline
  let waveBusy = false;
  let slowCalls = 0, toastId = 0, capId = 0, cardId = 0;
  let training = null;
  let skipFn = null, lastSkip = -1e9;
  const rig = () => G.rig;
  const P = () => G.player;
  const J = () => G.journey;
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
  /** hand control back to the player on the road */
  const toExplore = (snap = false) => {
    const p = P();
    skipFn = null;
    rig().cine.on = false;
    if (snap) rig().snapBehind();
    p.setCine(false);
    p.cineY = false;
    p.iframes = Math.max(p.iframes > 50 ? 0 : p.iframes, 0.4);
    input.clear();
    ui({ phase: 'explore', letterbox: false, canSkip: false, boss: null, prompt: null, objective: ZONES[J().zone].objective });
  };
  const calm = () => {
    gsap.to(G, { mood: 0, duration: 3, overwrite: 'auto' });
    G.audio.setMode('peace');
    G.audio.duck(false);
  };

  const D = {
    get wave() { return J().active ? J().active.wave : 0; },
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
      if (getUI().map) { ui({ map: false, paused: false }); return; }
      ui({ paused: force === true ? true : !getUI().paused });
      if (getUI().paused && document.pointerLockElement) document.exitPointerLock?.();
    },
    toggleMap(force) {
      const ph = getUI().phase;
      if (ph !== 'explore' && ph !== 'combat' && ph !== 'training') return;
      const open = force ?? !getUI().map;
      ui({ map: open, paused: open });
    },
    /** is this the blow that should become the finisher? (the last enemy of a boss encounter) */
    isLastEnemy(e) {
      const a = J().active;
      if (!a || !a.enc.finisher || getUI().phase !== 'combat' || !J().isLastWave()) return false;
      return !G.enemies.some((o) => o !== e && o.alive);
    },

    /* ---------- title ---------- */
    startTitle() {
      kill();
      const p = P(), m = G.world.meditation;
      J().abort();
      G.combat.clear();
      G.physics.clearDebris();
      G.vfx.clear();
      G.mood = 0;
      G.timeScale = 1;
      G.enemyTime = 1;
      Object.assign(G.post, { flash: 0, desat: 0, aberration: 0, invert: 0, vignette: 0.42, speed: 0 });
      p.hpMax = 100;
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
      G.audio.duck(false);
      ui({ phase: 'title', letterbox: false, canSkip: false, subtitle: null, caption: null, prompt: null, toast: null, hp: p.hp, hpMax: p.hpMax, ki: 0, combo: 0, boss: null, wave: 0, stats: null, paused: false, map: false, zoneCard: null, hasSave: J().hasSave() });
      // slow drifting vista
      tl = gsap.timeline({ repeat: -1, yoyo: true });
      shot(tl, 0, 28, [8.2, 2.3, 23], [8.8, 3.5, 12.5], [0, 13.5, -46], [0.5, 11, -44], 44, 40);
    },
    /** New journey from the falls, or `cont` to pick up at the last spirit lamp */
    begin(cont = false) {
      G.audio.start();
      G.audio.sfx.gong();
      if (cont && J().hasSave()) { J().reset(true); this.resume(); return; }
      J().clearSave();
      J().reset(false);
      this.startIntro();
    },
    /** stand the player at their checkpoint and hand over control */
    resume(msg = null) {
      kill();
      const p = P(), c = J().checkpoint();
      J().abort();
      G.combat.clear();
      G.physics.clearDebris();
      G.vfx.clear();
      G.world.streamer.loadNow(c.zone);
      G.world.streamer.update(c.x, c.z, 1e9, true);
      G.timeScale = 1;
      G.enemyTime = 1;
      G.mood = 0;
      Object.assign(G.post, { flash: 0, desat: 0, aberration: 0, invert: 0, vignette: 0.42, speed: 0 });
      p.hpMax = J().state.hpMax;
      p.hp = p.hpMax;
      p.ki = Math.max(p.ki, 30);
      p.iframes = 1;
      p.char.dissolve = 0;
      p.char.roll = 0;
      p.cineY = false;
      p.state = 'cine';
      p.place(c.x, c.z, c.yaw);
      p.char.setSheathed(false);
      p.char.locoMode = 'armed';
      p.char.stop();
      calm();
      ui({ hp: p.hp, hpMax: p.hpMax, zone: c.zone, subtitle: null, caption: null, stats: null });
      toExplore(true);
      this.zoneCard(c.zone);
      if (msg) this.toast(msg, 'cyan');
    },

    /* ---------- intro: dawn at the falls, meditation, kata ---------- */
    startIntro() {
      kill();
      const p = P(), m = G.world.meditation;
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
      skipFn = () => this.startDeparture();
      p.cineY = false;
      if (getUI().phase !== 'training') {
        if (Math.hypot(p.pos.x - KATA.x, p.pos.z - KATA.z) > 3) p.place(KATA.x, KATA.z, KATA.yaw);
        p.char.setSheathed(false);
        p.char.locoMode = 'armed';
        p.char.stop();
      }
      const post = G.world.post.userData;
      p.yaw = Math.atan2(post.x - p.pos.x, post.z - p.pos.z);
      rig().snapBehind();
      rig().cine.on = false;
      p.setCine(false);
      input.clear();
      training = { step: 0, count: 0, hold: 0, done: false, t: 0 };
      ui({ phase: 'training', letterbox: false, canSkip: true, subtitle: null, caption: null, objective: 'Warm up at the straw post' });
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
          gsap.delayedCall(1.3, () => getUI().phase === 'training' && this.startDeparture());
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

    /* ---------- departure: the birds go quiet, smoke beyond the gorge ---------- */
    startDeparture() {
      kill();
      const p = P();
      training = null;
      skipFn = () => { kill(); this.endDeparture(); };
      ui({ phase: 'ambush', letterbox: true, canSkip: true, prompt: null });
      p.setCine(true);
      p.char.stop();
      p.char.roll = 0;
      p.airY = 0;
      p.hop = 0;
      const px = p.pos.x, pz = p.pos.z, py = p.pos.y;
      const south = Math.atan2(-15 - px, 34 - pz), fx = Math.sin(south), fz = Math.cos(south);
      tl = gsap.timeline();
      tl.call(() => { G.world.birds.scatter(px - 8, pz + 10); G.audio.sfx.birds(); }, null, 0.15);
      tl.to(p, { yaw: p.yaw + angleDiff(p.yaw, south), duration: 1.2, ease: 'power2.inOut' }, 0.6);
      shot(tl, 0, 3.2, [px - fx * 3.0 + fz * 1.7, py + 1.7, pz - fz * 3.0 - fx * 1.7], [px - fx * 2.4 + fz * 1.2, py + 1.55, pz - fz * 2.4 - fx * 1.2], [px + fx * 8, py + 2.6, pz + fz * 8], [px + fx * 12, py + 4.5, pz + fz * 12], 40, 36);
      tl.call(() => this.subtitle('…The birds have gone quiet. Smoke, beyond the gorge.', 3.0), null, 0.6);
      // the way out: over the torii and down the trail
      shot(tl, 3.2, 4.4, [-22, 9.5, 20], [-19.5, 12, 30], [-15, 2, 40], [-9, 2, 74], 44, 40);
      tl.call(() => { this.caption('旅立ち', 'The road to Onikage Castle', 3.4); G.audio.sfx.gong(); }, null, 3.7);
      tl.call(() => this.subtitle('Hanamura lies downriver. The Black Fang will not have gone there to pray.', 3.4), null, 4.4);
      tl.call(() => this.endDeparture(), null, 7.8);
    },
    endDeparture() {
      kill();
      const p = P();
      training = null;
      if (p.cineY || p.char.clipName === 'seiza') { p.cineY = false; p.place(KATA.x, KATA.z, KATA.yaw); }
      J().markTrained();
      p.char.locoMode = 'armed';
      p.char.setSheathed(false);
      toExplore(true);
      this.toast('Follow the gorge path south', 'gold');
    },

    /* ---------- on the road ---------- */
    zoneCard(zi) {
      const z = ZONES[zi], id = ++cardId;
      ui({ zoneCard: { kanji: z.kanji, name: z.name, sub: z.sub, id }, objective: z.objective });
      gsap.delayedCall(4.6, () => getUI().zoneCard?.id === id && ui({ zoneCard: null }));
    },
    onZoneEnter(zi, first) {
      const z = ZONES[zi];
      this.zoneCard(zi);
      if (!first || !z.reveal || getUI().phase !== 'explore') return;
      // first sight of a new land: the camera lifts away for a moment to show it
      kill();
      const p = P(), r = z.reveal;
      p.setCine(true);
      p.char.stop();
      ui({ phase: 'ambush', letterbox: true, canSkip: true });
      skipFn = () => { kill(); toExplore(); };
      tl = gsap.timeline();
      shot(tl, 0, r.dur || 4.2, r.cam, r.to, r.look, r.lookTo, r.fov || 44, (r.fov || 44) - 4);
      tl.call(() => toExplore(), null, (r.dur || 4.2) + 0.05);
    },

    /* ---------- encounters ---------- */
    startEncounter(enc) {
      kill();
      const p = P();
      const a = J().begin(enc);
      waveBusy = true;
      const first = J().nextWave() || [];
      for (const e of first) { e.char.update(0.016); e.char.anim.snap(); }
      G.audio.setMode('battle');
      gsap.to(G, { mood: 1, duration: enc.intro ? 4 : 2, ease: 'sine.inOut', overwrite: 'auto' });
      const go = () => this.startCombat(enc, first);
      if (!enc.intro) { go(); return; }
      ui({ phase: 'ambush', letterbox: true, canSkip: true, prompt: null, zoneCard: null });
      skipFn = () => { kill(); go(); };
      p.setCine(true);
      p.char.stop();
      p.char.roll = 0;
      p.airY = 0;
      p.hop = 0;
      G.timeScale = 1;
      const px = p.pos.x, pz = p.pos.z, py = p.pos.y;
      const lead = first[0], bx = lead.pos.x, bz = lead.pos.z, by = lead.pos.y;
      let cx = 0, cz = 0;
      for (const e of first) { cx += e.pos.x / first.length; cz += e.pos.z / first.length; }
      const to = Math.atan2(cx - px, cz - pz), fx = Math.sin(to), fz = Math.cos(to);
      tl = gsap.timeline();
      tl.to(p, { yaw: p.yaw + angleDiff(p.yaw, to), duration: 0.9, ease: 'power2.inOut' }, 0.2);
      if (enc.intro === 'boss') {
        // the boss walks out: held low in front of him, then the two of them in one frame
        const dirx = Math.sin(lead.yaw), dirz = Math.cos(lead.yaw), sc = lead.char.scale;
        for (const e of first) e.cineSpeed = 1.2;
        shot(tl, 0, 3.6, [bx + dirx * 8 - dirz * 1.6, by + 0.7, bz + dirz * 8 + dirx * 1.6], [bx + dirx * 6.8 - dirz * 0.6, by + 1.0 * sc, bz + dirz * 6.8 + dirx * 0.6], [bx + dirx * 2, by + 1.7 * sc, bz + dirz * 2], [bx + dirx * 4.2, by + 1.85 * sc, bz + dirz * 4.2], 34, 30);
        tl.call(() => { this.caption(enc.caption[0], enc.caption[1], 3.2); G.audio.sfx.gong(); G.rig.shake(0.35); }, null, 0.8);
        if (enc.line) tl.call(() => this.subtitle(enc.line, 3.2), null, 1.5);
        tl.call(() => { for (const e of first) e.cineSpeed = 0; }, null, 3.4);
        shot(tl, 3.6, 1.9, [px - fx * 3.4 + fz * 2.0, py + 1.5, pz - fz * 3.4 - fx * 2.0], [px - fx * 2.8 + fz * 1.5, py + 1.4, pz - fz * 2.8 - fx * 1.5], [px + fx * 4, py + 1.3, pz + fz * 4], [cx, by + 1.4, cz], 38, 34);
        tl.call(() => { p.char.locoMode = 'armed'; p.char.setSheathed(false); G.audio.sfx.whoosh(); }, null, 3.7);
        tl.call(go, null, 5.5);
      } else {
        // ambush: over the shoulder, then low among them as they step out
        shot(tl, 0, 2.0, [px - fx * 3.2 + fz * 1.6, py + 1.75, pz - fz * 3.2 - fx * 1.6], [px - fx * 2.6 + fz * 1.2, py + 1.6, pz - fz * 2.6 - fx * 1.2], [px + fx * 8, py + 1.8, pz + fz * 8], [cx, by + 1.5, cz], 40, 36);
        const sx = cx - fx * 5.5 + fz * 2.4, sz = cz - fz * 5.5 - fx * 2.4;
        shot(tl, 2.0, 2.4, [sx, heightAt(sx, sz) + 0.8, sz], [sx + fx * 0.9, heightAt(sx, sz) + 1.0, sz + fz * 0.9], [cx, by + 1.6, cz], [cx - fx, by + 1.4, cz - fz], 38, 34);
        tl.call(() => { for (const e of first) e.cineSpeed = 1.4; }, null, 2.1);
        tl.call(() => { if (enc.caption) this.caption(enc.caption[0], enc.caption[1], 2.4); G.audio.sfx.gong(); G.rig.shake(0.3); }, null, 2.5);
        tl.call(() => { for (const e of first) e.cineSpeed = 0; p.char.locoMode = 'armed'; p.char.setSheathed(false); }, null, 4.0);
        tl.call(go, null, 4.5);
      }
    },
    startCombat(enc, enemies = G.enemies) {
      kill();
      const p = P();
      skipFn = null;
      G.audio.setMode('battle');
      for (const e of enemies) { e.cineSpeed = 0; e.activate(); }
      waveBusy = false;
      p.char.locoMode = 'armed';
      p.char.setSheathed(false);
      p.setCine(false);
      rig().cine.on = false;
      input.clear();
      const boss = enemies.find((e) => e.type.boss);
      ui({ phase: 'combat', letterbox: false, canSkip: false, prompt: null, subtitle: null, wave: 1, waves: enc.waves.length, enemiesLeft: enemies.length, enemiesTotal: enemies.length, hp: p.hp, boss: boss ? { name: boss.type.name, hp: boss.hp, hpMax: boss.hpMax } : null, zoneCard: null });
      if (!enc.intro) this.toast(enc.label, 'red');
    },
    onEnemyDeath() {
      const left = G.enemies.filter((e) => e.alive).length;
      ui({ enemiesLeft: left });
      if (left > 0) { this.slowmo(0.4, 0.16); return; }
      if (getUI().phase !== 'combat' || waveBusy || !J().active) return;
      waveBusy = true;
      this.slowmo(0.3, 0.5);
      if (!J().isLastWave()) gsap.delayedCall(1.5, () => getUI().phase === 'combat' && this.nextWave());
      else gsap.delayedCall(1.3, () => getUI().phase === 'combat' && this.encounterWon());
    },
    nextWave() {
      const p = P(), a = J().active;
      const spawned = J().nextWave();
      if (!spawned) { this.encounterWon(); return; }
      const w = a.enc.waves[a.wave];
      p.heal(18);
      ui({ wave: a.wave + 1, enemiesLeft: spawned.length, enemiesTotal: spawned.length });
      G.audio.sfx.wave();
      for (const e of spawned) e.activate();
      this.toast(w.label || 'Another wave', 'red');
      waveBusy = false;
    },
    /** the last enemy of an encounter is down */
    encounterWon() {
      const enc = J().active?.enc;
      if (!enc) return;
      if (enc.final) { this.victory(); return; }
      J().clear();
      const p = P();
      p.heal(30);
      p.iframes = 0.5;
      calm();
      toExplore();
      this.toast(enc.done || 'The way is clear', 'gold');
      G.audio.sfx.ui();
    },
    /** the lord's second wind */
    bossEnrage(e) {
      this.slowmo(0.2, 0.7);
      this.caption('修羅', 'Wrath', 2.2);
      G.audio.sfx.gong();
      G.rig.shake(0.7);
      G.post.flash = 0.5;
      G.vfx.ring(e.pos, 0.5, 7, '#ff5a3a', 0.7);
      G.vfx.embers(e.pos, 40, [3.2, 1.0, 0.4], 1.4);
      e.stagger(0.9);
      const P_ = P(), dx = P_.pos.x - e.pos.x, dz = P_.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
      if (d < 5) P_.vel.set((dx / d) * 9, 0, (dz / d) * 9);
    },

    /* ---------- finisher: one flash, a held breath, the blade returns to its scabbard ---------- */
    startFinisher(e) {
      if (getUI().phase !== 'combat') return;
      kill();
      const p = P();
      const final = !!J().active?.enc.final;
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
      if (final) tl.call(() => this.victory(), null, 4.9);
      else tl.call(() => {
        // back on the road: draw again and walk on
        p.iframes = 0.6;
        p.char.setSheathed(false);
        p.char.locoMode = 'armed';
        p.char.stop();
        p.trail.uniforms.uA.value.set(COLORS.trailA);
        G.audio.duck(false);
        ui({ phase: 'combat' });
        this.encounterWon();
      }, null, 4.7);
    },

    /* ---------- victory: the lord is dead, dawn comes up behind the keep ---------- */
    victory() {
      if (getUI().phase === 'victory') return;
      kill();
      const p = P(), S = J().state;
      const enc = J().clear();
      const time = S.time, s = p.stats;
      const dmg = S.damage;
      const rank = S.deaths === 0 && dmg < 120 && time < 1500 ? 'S' : S.deaths <= 1 && dmg < 260 ? 'A' : S.deaths <= 4 ? 'B' : 'C';
      ui({ phase: 'victory', letterbox: true, canSkip: false, boss: null, prompt: null, toast: null });
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
      const A = enc?.arena || { x: px, z: pz };
      tl = gsap.timeline();
      tl.to(G, { mood: 2, duration: 6, ease: 'sine.inOut' }, 0);
      tl.to(G.post, { desat: 0, vignette: 0.42, duration: 1 }, 0);
      // face the keep
      tl.to(p, { yaw: p.yaw + angleDiff(p.yaw, Math.PI), duration: 2.2, ease: 'sine.inOut' }, 0.6);
      shot(tl, 0, 5.2, [px - 2.4, py + 0.8, pz + 3.0], [px + 1.8, py + 1.15, pz + 3.3], [px, py + 1.3, pz], [px, py + 1.35, pz - 1], 33, 31);
      tl.call(() => { this.caption('勝利', 'The Black Fang is broken', 5); G.audio.sfx.gong(); }, null, 1.6);
      // rise over the arena to the keep against the dawn
      shot(tl, 5.2, 10, [px + 2.2, py + 2.0, pz + 7], [A.x + 10, py + 16, A.z + 34], [px, py + 1.4, pz - 2], [A.x, py + 22, A.z - 36], 36, 46);
      tl.call(() => this.subtitle('Downriver, Hanamura will see the smoke clear.', 4.5), null, 6.2);
      tl.call(() => ui({ stats: { time, rank, ...s, damage: dmg, deaths: S.deaths } }), null, 8.4);
      tl.call(() => J().clearSave(), null, 8.5);
    },
    onPlayerDeath() {
      kill();
      ui({ boss: null, letterbox: false });
      J().addDeath();
      G.audio.duck(true);
      this.slowmo(0.25, 1.4);
      gsap.to(G.post, { desat: 0.9, vignette: 0.7, duration: 1.2 });
      gsap.delayedCall(1.5, () => ui({ phase: 'defeat' }));
    },
    /** rise again at the last spirit lamp */
    retry() {
      gsap.to(G.post, { desat: 0, vignette: 0.42, duration: 0.5 });
      this.resume('You rise where the road was last remembered');
    },
    restart() {
      ui({ paused: false, map: false });
      this.startTitle();
    },
    /** developer jump: stand at a zone's entry with everything before it cleared */
    debugJump(zi) {
      const z = ZONES[zi];
      if (!z) return;
      kill();
      G.audio.start();
      J().abort();
      G.combat.clear();
      J().unlockThrough(zi);
      const cp = z.checkpoints[0];
      J().setCheckpoint(cp.id, true);
      this.resume();
      const p = P();
      p.place(z.entry.x, z.entry.z, z.entry.yaw);
      rig().snapBehind();
    },
  };
  return D;
}
export { TYPES };
