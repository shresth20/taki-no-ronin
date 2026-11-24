import { G, QUALITY, ui, getUI } from '../core/state.js';
import { input, bindInput } from '../core/input.js';
import { createPhysics } from '../core/physics.js';
import { createAudio } from '../core/audio.js';
import { createWorld } from '../world/index.js';
import { ENV } from '../world/env.js';
import { heightAt, ARENA } from '../world/terrain.js';
import { Character } from '../chars/character.js';
import { createVfx } from '../vfx/vfx.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { createCombat } from './combat.js';
import { createDirector } from './director.js';
import { damp } from '../core/util.js';

const ORDER = ['low', 'medium', 'high'];

/* The Game owns the simulation. React only hosts the canvas, the post effects and the HUD. */
export class Game {
  constructor() {
    this.ready = false;
    this.autoQuality = true;
  }

  async init(three) {
    if (this.started) return;
    this.started = true;
    const { gl, scene, camera } = three;
    this.three = three;
    G.gl = gl;
    G.scene = scene;
    G.camera = camera;
    const q = new URLSearchParams(location.search);
    let quality = getUI().isTouch || Math.min(window.innerWidth, window.innerHeight) < 520 ? 'medium' : 'high';
    try { quality = localStorage.getItem('tnr-quality') || quality; } catch { /* storage is optional */ }
    if (q.get('quality')) quality = q.get('quality');
    if (!QUALITY[quality]) quality = 'medium';
    G.quality = QUALITY[quality];
    ui({ quality });
    camera.layers.enable(1);

    const world = (G.world = createWorld(G.quality));
    scene.add(world.group);
    scene.fog = world.fog;
    G.physics = await createPhysics(world.colliders);
    ui({ physics: G.physics.name });
    G.vfx = createVfx(scene);
    G.audio = createAudio();
    G.rig = new CameraRig(camera);
    G.combat = createCombat(scene);
    G.player = new Player(scene);
    G.director = createDirector(this);
    G.input = input;
    this.unbind = bindInput(gl.domElement);
    this.setQuality(quality, true);

    if (q.get('mood')) G.mood = Number(q.get('mood'));
    if (q.get('view') === 'pose') this.poseViewer(q, scene, camera);
    else {
      G.director.startTitle();
      const start = q.get('start');
      if (start === 'training') G.director.startTraining();
      else if (start === 'ambush') G.director.startAmbush();
      else if (start === 'combat') G.director.startCombat();
      else if (start === 'intro') G.director.startIntro();
    }
    if (q.get('cam')) this.debugCam = { pos: q.get('cam').split(',').map(Number), look: (q.get('look') || '0,9,-40').split(',').map(Number) };
    this.ready = true;
  }

  setQuality(name, silent = false) {
    if (!QUALITY[name]) return;
    G.quality = QUALITY[name];
    G.world.applyQuality(G.quality);
    this.three.setDpr(Math.min(window.devicePixelRatio || 1, G.quality.dpr));
    this.three.gl.shadowMap.enabled = G.quality.shadow > 0;
    if (this.composer) this.composer.multisampling = G.quality.msaa;
    ui({ quality: name });
    if (!silent) {
      this.autoQuality = false;
      try { localStorage.setItem('tnr-quality', name); } catch { /* storage is optional */ }
    }
  }
  /** drei's PerformanceMonitor reports sustained frame-rate drops: step the quality down once per report */
  onPerf(dir) {
    if (!this.autoQuality || G.test || dir > 0) return;
    const i = ORDER.indexOf(getUI().quality);
    if (i > 0) {
      this.setQuality(ORDER[i - 1], true);
      G.director?.toast('Graphics eased for a smoother frame rate', 'dim');
    }
  }

  update(rdt) {
    if (!this.ready) return;
    rdt = Math.min(rdt, 0.05);
    const cam = G.camera, P = G.player, st = getUI();
    if (st.paused) rdt = 0;
    G.rdt = rdt;
    G.real += rdt;
    G.director.update();
    let dt = rdt * G.timeScale;
    if (G.hitstop > 0) {
      G.hitstop -= rdt;
      dt = 0;
    }
    G.dt = dt;
    G.time += dt;

    if (this.viewers) {
      for (const c of this.viewers) c.update(dt);
      G.world.update(dt, cam, null);
    } else {
      if (dt > 0) {
        G.combat.update(dt, rdt);
        P.update(dt);
        const edt = dt * G.enemyTime;
        for (let i = G.enemies.length - 1; i >= 0; i--) {
          const e = G.enemies[i];
          e.update(edt);
          if (e.remove) {
            e.dispose();
            G.enemies.splice(i, 1);
          }
        }
        G.physics.step(dt);
      }
      G.vfx.update(dt, rdt, cam);
      for (const e of G.enemies) e.updateBar(rdt, cam);
      // boss bar in the HUD
      if (st.boss) {
        const b = G.enemies.find((e) => e.kind === 'captain');
        const hp = b ? Math.max(0, b.hp) : 0;
        if (Math.abs(hp - st.boss.hp) > 0.5) ui({ boss: { ...st.boss, hp } });
      }
      // impact treatments fade on real time so hit-stop does not hold them
      const p = G.post;
      p.flash = damp(p.flash, 0, 9, rdt);
      p.aberration = damp(p.aberration, 0, 6, rdt);
      p.speed = damp(p.speed, 0, 3.2, rdt);
      const lock = st.phase === 'combat' ? (P.target?.alive ? P.target : P.nearestEnemy(9)) : null;
      G.rig.update(rdt, P, lock);
      if (this.debugCam) {
        cam.position.set(...this.debugCam.pos);
        cam.lookAt(...this.debugCam.look);
      }
      G.world.update(dt, cam, P.pos);
      G.audio.update(rdt, P.pos);
    }
    if (!this.skipRender) G.world.water.renderReflection(G.gl, G.scene, cam);
    this.applyPost();
  }

  applyPost() {
    const g = this.grade;
    if (!g) return;
    g.set('uSat', ENV.sat);
    g.set('uContrast', ENV.contrast);
    g.uniforms.get('uTint').value.copy(ENV.tint);
    g.set('uFlash', G.post.flash);
    g.set('uDesat', G.post.desat);
    g.set('uAberration', G.post.aberration);
    g.set('uInvert', G.post.invert);
    g.set('uVignette', G.post.vignette);
    g.set('uSpeed', G.post.speed);
    if (this.bloom) this.bloom.intensity = G.quality.bloom ? ENV.bloom : 0;
  }

  /* dev: ?view=pose&kind=ronin&clip=light1&n=6 -> a strip of one clip sampled at n times */
  poseViewer(q, scene, camera) {
    const kind = q.get('kind') || 'ronin', clip = q.get('clip'), n = Number(q.get('n') || 6);
    this.viewers = [];
    G.player.char.setVisible(false);
    const ang = (Number(q.get('ang') || 0) * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const c = new Character(kind, scene);
      const x = ARENA.x + (i - (n - 1) / 2) * Number(q.get('gap') || 1.5), z = ARENA.z;
      c.pos.set(x, heightAt(x, z), z);
      c.yaw = ang;
      if (clip && clip !== 'loco') {
        c.play(clip);
        c.clipT = (c.clip.dur * i) / (n - 1 || 1);
        if (q.get('ct')) c.clipT = Number(q.get('ct'));
        c.clipSpeed = 0;
      } else {
        c.loco.phase = (i / n) * Math.PI * 2;
        if (q.get('calm')) c.locoMode = 'calm';
      }
      if (q.get('sheath')) c.setSheathed(true);
      c.loco.speed = Number(q.get('speed') || 0);
      const ph = c.loco.phase;
      c.update(0.0001);
      c.loco.phase = ph;
      c.anim.snap();
      c.update(0.0001);
      // hold this pose; only the cloth keeps simulating
      c.update = (dt) => { c.applyTransform(); c.updateCloth(dt); };
      this.viewers.push(c);
    }
    const d = Number(q.get('d') || 6);
    const y0 = heightAt(ARENA.x, ARENA.z);
    camera.position.set(ARENA.x + Number(q.get('cx') || 0), y0 + Number(q.get('cy') || 1.3), ARENA.z + d);
    camera.fov = Number(q.get('fov') || 30);
    camera.updateProjectionMatrix();
    camera.lookAt(ARENA.x, y0 + Number(q.get('ly') || 1.0), ARENA.z);
    ui({ phase: 'debug' });
  }
}
