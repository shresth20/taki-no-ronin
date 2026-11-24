import * as THREE from 'three';
import { G } from '../core/state.js';
import { envUniforms } from '../world/env.js';
import { getGlintTexture, getPetalTexture, getNoiseTexture, clamp, rand, rrange, DEG } from '../core/util.js';
import { groundAt as heightAt, waterLevelAt } from '../world/nav.js';

/* Combat VFX: sword trails, slash crescents, a pooled particle system (sparks, dust, droplets,
   petals, embers), shockwave rings, glint flashes and floating enemy health bars.              */

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V();

/* ---------- sword trail: a ribbon swept between hilt and tip ---------- */
const TRAIL_N = 14, TRAIL_SUB = 3;
export class Trail {
  constructor(scene, colorA, colorB, life = 0.17) {
    this.life = life;
    this.samples = []; // { base, tip, t, a }
    this.on = false;
    const n = (TRAIL_N - 1) * TRAIL_SUB + 1;
    this.count = n;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.uv = new THREE.BufferAttribute(new Float32Array(n * 2 * 2), 2);
    this.al = new THREE.BufferAttribute(new Float32Array(n * 2), 1);
    g.setAttribute('position', this.pos);
    g.setAttribute('uv', this.uv);
    g.setAttribute('aAlpha', this.al);
    const idx = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx);
    this.uniforms = { uA: { value: new THREE.Color(colorA) }, uB: { value: new THREE.Color(colorB) }, uGain: { value: 1 } };
    this.mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: 'attribute float aAlpha; varying vec2 vUv; varying float vA; void main(){ vUv = uv; vA = aAlpha; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          precision highp float; uniform vec3 uA, uB; uniform float uGain; varying vec2 vUv; varying float vA;
          void main(){
            float v = vUv.y;                      // 0 hilt .. 1 tip
            float body = smoothstep(0.0, 0.5, v);
            float edge = smoothstep(0.72, 1.0, v);
            vec3 col = mix(uA, uB, edge) * (1.0 + edge * 2.2) * uGain;
            float a = vA * (body * 0.5 + edge * 0.5) * smoothstep(1.0, 0.75, vUv.x);
            gl_FragColor = vec4(col, a);
          }`,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.layers.set(1);
    scene.add(this.mesh);
  }
  clear() {
    this.samples.length = 0;
  }
  update(base, tip, time) {
    const S = this.samples;
    if (this.on || S.length) {
      S.unshift({ base: base.clone(), tip: tip.clone(), t: time, a: this.on ? 1 : 0 });
      if (S.length > TRAIL_N) S.pop();
    }
    while (S.length && time - S[S.length - 1].t > this.life) S.pop();
    const pa = this.pos.array, ua = this.uv.array, aa = this.al.array;
    const n = this.count;
    if (S.length < 2) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const segs = S.length - 1;
    for (let i = 0; i < n; i++) {
      const f = Math.min(segs - 1e-4, (i / (n - 1)) * segs);
      const k = Math.floor(f), u = f - k;
      const s0 = S[Math.max(0, k - 1)], s1 = S[k], s2 = S[k + 1], s3 = S[Math.min(segs, k + 2)];
      catmull(_a, s0.base, s1.base, s2.base, s3.base, u);
      catmull(_b, s0.tip, s1.tip, s2.tip, s3.tip, u);
      const age = (time - (s1.t + (s2.t - s1.t) * u)) / this.life;
      const al = (s1.a + (s2.a - s1.a) * u) * clamp(1 - age, 0, 1);
      pa.set([_a.x, _a.y, _a.z, _b.x, _b.y, _b.z], i * 6);
      ua.set([i / (n - 1), 0, i / (n - 1), 1], i * 4);
      aa[i * 2] = aa[i * 2 + 1] = al;
    }
    this.pos.needsUpdate = this.uv.needsUpdate = this.al.needsUpdate = true;
  }
}
function catmull(out, p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  out.x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  out.y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  out.z = 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  return out;
}

/* ---------- particles ---------- */
const MAXP = 420;
class Particles {
  constructor(scene, additive) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4); // w, h, shape, rot
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4);
    for (const a of [this.aPos, this.aVel, this.aSize, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aVel', this.aVel);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aCol', this.aCol);
    g.instanceCount = 0;
    this.geo = g;
    this.list = [];
    this.mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uPetal: { value: getPetalTexture() } },
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: /* glsl */ `
          attribute vec3 aPos, aVel; attribute vec4 aSize, aCol;
          varying vec2 vUv; varying vec4 vCol; varying float vShape;
          void main(){
            vUv = uv; vCol = aCol; vShape = aSize.z;
            vec4 mv = viewMatrix * vec4(aPos, 1.0);
            vec2 q = position.xy;
            if (aSize.z > 0.5 && aSize.z < 1.5) {            // streak: stretch along view-space velocity
              vec2 dir = (viewMatrix * vec4(aVel, 0.0)).xy;
              float l = length(dir);
              dir = l > 1e-4 ? dir / l : vec2(0.0, 1.0);
              vec2 side = vec2(-dir.y, dir.x);
              mv.xy += side * q.x * aSize.x + dir * q.y * aSize.y;
            } else {
              float c = cos(aSize.w), s = sin(aSize.w);
              mv.xy += mat2(c, -s, s, c) * (q * aSize.xy);
            }
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          precision highp float; uniform sampler2D uPetal;
          varying vec2 vUv; varying vec4 vCol; varying float vShape;
          void main(){
            vec2 p = vUv * 2.0 - 1.0;
            float a;
            vec3 col = vCol.rgb;
            if (vShape < 0.5) a = smoothstep(1.0, 0.1, length(p));                              // soft blob
            else if (vShape < 1.5) a = (1.0 - abs(p.x)) * smoothstep(1.0, 0.2, abs(p.y));         // streak
            else if (vShape < 2.5) { vec4 t = texture2D(uPetal, vUv); a = step(0.4, t.a); col *= t.rgb; }  // petal
            else a = step(length(p), 0.9);                                                        // hard dot
            a *= vCol.a;
            if (a < 0.01) discard;
            gl_FragColor = vec4(col, a);
          }`,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 22 : 21;
    this.mesh.layers.set(1);
    scene.add(this.mesh);
  }
  /** shape: 0 soft, 1 streak, 2 petal, 3 dot */
  emit(p) {
    if (this.list.length >= MAXP) this.list.shift();
    this.list.push(p);
  }
  update(dt) {
    const L = this.list;
    let n = 0;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) { L.splice(i, 1); continue; }
      p.vy += p.g * dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vz *= dr; if (p.dragY) p.vy *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.ground) {
        const gy = Math.max(heightAt(p.x, p.z), waterLevelAt(p.x, p.z)) + 0.02;
        if (p.y < gy) { p.y = gy; p.vy *= -0.25; p.vx *= 0.5; p.vz *= 0.5; }
      }
      p.rot += p.spin * dt;
    }
    for (const p of L) {
      const k = p.age / p.life;
      const s = p.s0 + (p.s1 - p.s0) * k;
      this.aPos.array.set([p.x, p.y, p.z], n * 3);
      this.aVel.array.set([p.vx, p.vy, p.vz], n * 3);
      this.aSize.array.set([p.w * s, p.h * s, p.shape, p.rot], n * 4);
      const fade = p.fadeIn ? Math.min(1, k / p.fadeIn) * (1 - k) : 1 - k * k;
      this.aCol.array.set([p.r, p.g2, p.b, p.a * fade], n * 4);
      n++;
    }
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = this.aVel.needsUpdate = this.aSize.needsUpdate = this.aCol.needsUpdate = true;
  }
}
const mk = (o) => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, dragY: false, ground: false, age: 0, life: 0.5, w: 0.1, h: 0.1, s0: 1, s1: 1, shape: 0, rot: 0, spin: 0, r: 1, g2: 1, b: 1, a: 1, fadeIn: 0, ...o });

/* ---------- slash crescents ---------- */
function crescentGeometry() {
  const seg = 28, span = 150 * DEG;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, a = -span / 2 + u * span;
    // arc sweeps from the character's right (-X) across the front (+Z) to the left (+X)
    const ca = Math.sin(a), sa = Math.cos(a);
    const taper = Math.pow(Math.sin(Math.PI * u), 0.6);
    const rIn = 1 - 0.34 * taper;
    pos.push(ca * rIn, 0, sa * rIn, ca, 0, sa);
    uv.push(u, 0, u, 1);
    if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
class Slashes {
  constructor(scene) {
    this.pool = [];
    const geo = crescentGeometry();
    for (let i = 0; i < 14; i++) {
      const uniforms = { uT: { value: 0 }, uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uNoise: { value: getNoiseTexture() }, uSeed: { value: rand() } };
      const m = new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({
          uniforms,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: /* glsl */ `
            precision highp float; uniform float uT, uSeed; uniform vec3 uA, uB; uniform sampler2D uNoise; varying vec2 vUv;
            void main(){
              float u = vUv.x, v = vUv.y;
              float head = uT * 1.9;                                  // the cut travels along the arc
              float sweep = smoothstep(head - 1.0, head - 0.15, u) * smoothstep(head + 0.02, head - 0.02, u);
              float n = texture2D(uNoise, vec2(u * 1.3 + uSeed, v * 0.35 + uSeed)).g;
              float rim = smoothstep(0.55, 1.0, v);
              float body = smoothstep(0.0, 0.6, v + (n - 0.5) * 0.5);
              float fade = 1.0 - smoothstep(0.45, 1.0, uT);
              float a = sweep * (body * 0.55 + rim * 0.6) * fade;
              a *= smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u);
              vec3 col = mix(uA, uB, rim) * (1.0 + rim * 2.0);
              if (a < 0.01) discard;
              gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
            }`,
        })
      );
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 23;
      m.layers.set(1);
      scene.add(m);
      this.pool.push({ m, uniforms, t: 1, life: 0.25 });
    }
    this.i = 0;
  }
  spawn(pos, yaw, roll, tilt, scale, colA, colB, life = 0.24) {
    const s = this.pool[this.i];
    this.i = (this.i + 1) % this.pool.length;
    s.m.position.copy(pos);
    s.m.rotation.set(tilt, yaw, roll, 'YXZ');
    s.m.scale.setScalar(scale);
    s.uniforms.uA.value.set(colA);
    s.uniforms.uB.value.set(colB);
    s.uniforms.uSeed.value = rand();
    s.t = 0;
    s.life = life;
    s.m.visible = true;
    s.grow = scale;
  }
  update(dt) {
    for (const s of this.pool) {
      if (!s.m.visible) continue;
      s.t += dt / s.life;
      s.uniforms.uT.value = s.t;
      s.m.scale.setScalar(s.grow * (1 + s.t * 0.12));
      if (s.t >= 1) s.m.visible = false;
    }
  }
}

/* ---------- rings (ground shockwaves) + glints (camera-facing flashes) ---------- */
class Rings {
  constructor(scene) {
    this.pool = [];
    const g = new THREE.RingGeometry(0.72, 1, 48, 1);
    g.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const u = { uT: { value: 0 }, uC: { value: new THREE.Color() } };
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
        uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'precision highp float; uniform float uT; uniform vec3 uC; varying vec3 vP; void main(){ float r = (length(vP.xz) - 0.72) / 0.28; float a = smoothstep(0.0, 0.5, r) * smoothstep(1.0, 0.8, r) * (1.0 - uT) * (1.0 - uT); gl_FragColor = vec4(uC * (1.0 + r), a); }',
      }));
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 19;
      m.layers.set(1);
      scene.add(m);
      this.pool.push({ m, u, t: 1, life: 0.4, r0: 0.3, r1: 3 });
    }
    this.i = 0;
  }
  spawn(pos, r0, r1, color, life = 0.45) {
    const s = this.pool[this.i];
    this.i = (this.i + 1) % this.pool.length;
    s.m.position.set(pos.x, Math.max(heightAt(pos.x, pos.z), waterLevelAt(pos.x, pos.z)) + 0.06, pos.z);
    s.u.uC.value.set(color);
    Object.assign(s, { t: 0, life, r0, r1 });
    s.m.visible = true;
  }
  update(dt) {
    for (const s of this.pool) {
      if (!s.m.visible) continue;
      s.t += dt / s.life;
      const k = 1 - Math.pow(1 - Math.min(1, s.t), 3);
      s.m.scale.setScalar(s.r0 + (s.r1 - s.r0) * k);
      s.u.uT.value = Math.min(1, s.t);
      if (s.t >= 1) s.m.visible = false;
    }
  }
}
class Glints {
  constructor(scene) {
    this.pool = [];
    const g = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: getGlintTexture(), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 30;
      m.layers.set(1);
      scene.add(m);
      this.pool.push({ m, t: 1, life: 0.2, size: 1, follow: null, spin: 0 });
    }
    this.i = 0;
  }
  spawn(pos, size, color, life = 0.18, follow = null) {
    const s = this.pool[this.i];
    this.i = (this.i + 1) % this.pool.length;
    s.m.position.copy(pos);
    s.m.material.color.set(color);
    Object.assign(s, { t: 0, life, size, follow, spin: rrange(-1, 1) });
    s.m.visible = true;
  }
  update(dt, camera) {
    for (const s of this.pool) {
      if (!s.m.visible) continue;
      s.t += dt / s.life;
      if (s.follow) s.m.position.copy(s.follow);
      const k = Math.sin(Math.min(1, s.t) * Math.PI);
      s.m.quaternion.copy(camera.quaternion);
      s.m.rotateZ(s.spin * s.t * 1.5 + 0.4);
      s.m.scale.setScalar(s.size * (0.35 + k));
      s.m.material.opacity = k;
      if (s.t >= 1) s.m.visible = false;
    }
  }
}

/* ---------- floating health bars ---------- */
class Bars {
  constructor(scene) {
    this.scene = scene;
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.translate(0.5, 0, 0);
  }
  create() {
    const g = new THREE.Group();
    const mat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, depthWrite: false });
    const bg = new THREE.Mesh(this.geo, mat(0x0c0a10, 0.72));
    const lag = new THREE.Mesh(this.geo, mat(0xfff1c9, 0.95));
    const fill = new THREE.Mesh(this.geo, mat(0xe2343a, 1));
    bg.scale.set(0.84, 0.085, 1); bg.position.x = -0.42;
    lag.scale.set(0.8, 0.05, 1); lag.position.set(-0.4, 0, 0.001);
    fill.scale.set(0.8, 0.05, 1); fill.position.set(-0.4, 0, 0.002);
    g.add(bg, lag, fill);
    g.renderOrder = 40;
    g.traverse((o) => { o.renderOrder = 40; o.layers.set(1); o.frustumCulled = false; });
    g.visible = false;
    this.scene.add(g);
    return { g, fill, lag, shown: 0, v: 1, lagV: 1 };
  }
}

export function createVfx(scene) {
  const add = new Particles(scene, true), nor = new Particles(scene, false);
  const slashes = new Slashes(scene), rings = new Rings(scene), glints = new Glints(scene), bars = new Bars(scene);
  const trails = [];
  const vfx = {
    add, nor,
    trail(colorA, colorB, life) {
      const t = new Trail(scene, colorA, colorB, life);
      trails.push(t);
      return t;
    },
    removeTrail(t) {
      scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      const i = trails.indexOf(t);
      if (i >= 0) trails.splice(i, 1);
    },
    bar: () => bars.create(),
    removeBar(b) { scene.remove(b.g); },
    /** crescent for a clip's `slash` spec, centred on a character */
    slash(pos, yaw, spec, reach, colA, colB, life) {
      _a.set(pos.x, pos.y + (spec.y ?? 1.2), pos.z);
      slashes.spawn(_a, yaw, (spec.roll ?? 0) * DEG, (spec.tilt ?? 0) * DEG, reach * (spec.scale ?? 1) * 0.92, colA, colB, life);
    },
    slashAt(pos, yaw, rollDeg, tiltDeg, scale, colA, colB, life) {
      slashes.spawn(pos, yaw, rollDeg * DEG, tiltDeg * DEG, scale, colA, colB, life);
    },
    sparks(pos, dir, n = 12, color = [3.0, 2.2, 1.0], speed = 9) {
      for (let i = 0; i < n; i++) {
        _b.set(rrange(-1, 1), rrange(-0.4, 1), rrange(-1, 1)).normalize().multiplyScalar(0.75);
        if (dir) _b.add(dir);
        _b.normalize().multiplyScalar(speed * rrange(0.35, 1));
        add.emit(mk({ x: pos.x, y: pos.y, z: pos.z, vx: _b.x, vy: _b.y, vz: _b.z, g: -18, drag: 2.2, life: rrange(0.18, 0.42), w: 0.03, h: rrange(0.25, 0.6), shape: 1, r: color[0], g2: color[1], b: color[2], ground: true }));
      }
    },
    dust(pos, n = 6, scale = 1, color = [0.86, 0.8, 0.66]) {
      for (let i = 0; i < n; i++) {
        const a = rand() * 6.283, sp = rrange(0.6, 2.2) * scale;
        nor.emit(mk({ x: pos.x + Math.cos(a) * 0.15, y: pos.y + 0.12, z: pos.z + Math.sin(a) * 0.15, vx: Math.cos(a) * sp, vy: rrange(0.3, 1.1), vz: Math.sin(a) * sp, drag: 2.6, dragY: true, life: rrange(0.5, 0.95), w: 0.5 * scale, h: 0.5 * scale, s0: 0.5, s1: 1.9, shape: 0, r: color[0], g2: color[1], b: color[2], a: 0.42, fadeIn: 0.15 }));
      }
    },
    splash(pos, n = 10, scale = 1) {
      const WATER_Y = Math.max(waterLevelAt(pos.x, pos.z), heightAt(pos.x, pos.z) - 0.3);
      for (let i = 0; i < n; i++) {
        const a = rand() * 6.283, sp = rrange(0.6, 2.6) * scale;
        nor.emit(mk({ x: pos.x, y: WATER_Y + 0.05, z: pos.z, vx: Math.cos(a) * sp, vy: rrange(2.2, 5.5) * scale, vz: Math.sin(a) * sp, g: -15, life: rrange(0.35, 0.7), w: 0.035, h: rrange(0.12, 0.28), shape: 1, r: 0.9, g2: 1, b: 1, a: 0.9 }));
      }
      nor.emit(mk({ x: pos.x, y: WATER_Y + 0.25, z: pos.z, vy: 1.2 * scale, life: 0.4, w: 0.7 * scale, h: 0.9 * scale, s0: 0.5, s1: 1.6, shape: 0, a: 0.5, fadeIn: 0.2 }));
      G.world?.water.addRipple(pos.x, pos.z, 0.9 * scale);
    },
    petals(pos, n = 14, color = [1.0, 0.25, 0.32], speed = 4) {
      for (let i = 0; i < n; i++) {
        _b.set(rrange(-1, 1), rrange(-0.2, 1.2), rrange(-1, 1)).normalize().multiplyScalar(speed * rrange(0.3, 1));
        nor.emit(mk({ x: pos.x, y: pos.y, z: pos.z, vx: _b.x, vy: _b.y, vz: _b.z, g: -3.2, drag: 2.4, dragY: true, life: rrange(0.9, 1.9), w: rrange(0.07, 0.13), h: rrange(0.07, 0.13), shape: 2, rot: rand() * 6.28, spin: rrange(-7, 7), r: color[0], g2: color[1], b: color[2] }));
      }
    },
    embers(pos, n = 8, color = [1.2, 2.2, 3.0], radius = 0.6) {
      for (let i = 0; i < n; i++) {
        const a = rand() * 6.283, r = rand() * radius;
        add.emit(mk({ x: pos.x + Math.cos(a) * r, y: pos.y + rrange(0, 0.5), z: pos.z + Math.sin(a) * r, vy: rrange(1.2, 3.2), life: rrange(0.45, 0.9), w: 0.045, h: rrange(0.16, 0.4), shape: 1, r: color[0], g2: color[1], b: color[2] }));
      }
    },
    burst(pos, color = [3, 3, 3], size = 1.4, life = 0.16) {
      add.emit(mk({ x: pos.x, y: pos.y, z: pos.z, life, w: size, h: size, s0: 0.4, s1: 1.5, shape: 0, r: color[0], g2: color[1], b: color[2], a: 0.9 }));
    },
    ring: (pos, r0, r1, color, life) => rings.spawn(pos, r0, r1, color, life),
    glint: (pos, size, color, life, follow) => glints.spawn(pos, size, color, life, follow),
    /** leading streak for flash steps: a line of bright streaks between two points */
    streak(from, to, color = [1.5, 2.6, 3.2]) {
      _c.subVectors(to, from);
      const len = _c.length();
      _c.normalize();
      for (let i = 0; i < 26; i++) {
        const k = rand();
        _d.copy(from).addScaledVector(_c, len * k);
        add.emit(mk({ x: _d.x + rrange(-0.25, 0.25), y: _d.y + rrange(0.3, 1.7), z: _d.z + rrange(-0.25, 0.25), vx: _c.x * 3, vy: 0, vz: _c.z * 3, life: rrange(0.2, 0.5), w: 0.05, h: rrange(1.2, 3.4), shape: 1, r: color[0], g2: color[1], b: color[2] }));
      }
    },
    update(dt, rdt, camera) {
      add.update(dt);
      nor.update(dt);
      slashes.update(dt);
      rings.update(dt);
      glints.update(rdt, camera);
    },
    clear() {
      add.list.length = 0;
      nor.list.length = 0;
      for (const t of trails) t.clear();
    },
  };
  return vfx;
}
export { envUniforms };
