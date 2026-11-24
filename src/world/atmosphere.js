import * as THREE from 'three';
import { envUniforms, ENV, GLSL_FOG } from './env.js';
import { mulberry32, getPetalTexture, getLeafTexture, lerp, damp } from '../core/util.js';
import { heightAt, ARENA, FALLS, POOL } from './terrain.js';
import { terrainAt } from './nav.js';

/* ---------- drifting petals / leaves: GPU-animated, wrapped in a box that follows the camera ---------- */
export function createPetals(count, { leaf = false } = {}) {
  const rnd = mulberry32(leaf ? 21 : 12);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seed[i] = rnd();
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = count;
  const uniforms = {
    ...envUniforms,
    uMap: { value: leaf ? getLeafTexture() : getPetalTexture() },
    uCenter: { value: new THREE.Vector3() },
    uDrift: { value: new THREE.Vector2() },
    uDensity: { value: 0.6 },
    uTint: { value: new THREE.Color(leaf ? '#f0a83a' : '#ffffff') },
    uSize: { value: leaf ? 0.16 : 0.11 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform vec3 uCenter; uniform vec2 uDrift; uniform float uTime, uDensity, uSize;
      varying vec2 vUv; varying float vShade; varying vec3 vW;
      void main(){
        vec3 box = vec3(60.0, 22.0, 60.0);
        vec3 p = aSeed.xyz * box;
        float sp = 0.55 + aSeed.w * 0.8;
        p.y -= uTime * sp;
        p.xz += uDrift * (0.7 + aSeed.w * 0.6);
        p.x += sin(uTime * 0.9 + aSeed.x * 31.0) * 0.7;
        p.z += cos(uTime * 0.7 + aSeed.z * 29.0) * 0.7;
        p = uCenter + mod(p - uCenter + box * 0.5, box) - box * 0.5;
        float spin = uTime * (2.0 + aSeed.w * 4.0) + aSeed.x * 40.0;
        float tw = uTime * (1.0 + aSeed.z * 2.0) + aSeed.y * 20.0;
        vec2 q = position.xy * vec2(cos(spin), 1.0);
        float c = cos(tw), s = sin(tw);
        q = mat2(c, -s, s, c) * q;
        vShade = 0.72 + 0.28 * abs(cos(spin));
        vUv = uv; vW = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        mv.xy += q * uSize * (0.7 + aSeed.y * 0.7);
        gl_Position = projectionMatrix * mv;
        if (aSeed.w > uDensity) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uMap; uniform vec3 uTint, uSunColor;
      varying vec2 vUv; varying float vShade; varying vec3 vW;
      ${GLSL_FOG}
      void main(){
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.4) discard;
        vec3 col = t.rgb * uTint * vShade * mix(vec3(1.0), uSunColor, 0.5) * 1.1;
        gl_FragColor = vec4(applyFog(col, vW), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.layers.set(1);
  mesh.name = leaf ? 'leaves' : 'petals';
  return { mesh, uniforms };
}

/* ---------- birds: a small flock that circles the valley and scatters at the ambush ---------- */
export function createBirds() {
  const N = 18;
  const rnd = mulberry32(64);
  const g = new THREE.BufferGeometry();
  // body + two wings, wingtips flap in the shader
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.32, 0.07, 0, -0.1, -0.07, 0, -0.1, 0, 0, -0.32, 0.06, 0, 0.12, 0.62, 0, -0.05, 0.06, 0, -0.14, -0.06, 0, 0.12, -0.62, 0, -0.05, -0.06, 0, -0.14], 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 0, 0, 1, 0], 1));
  g.setIndex([0, 1, 2, 1, 3, 2, 4, 5, 6, 7, 9, 8]);
  const seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) seeds[i] = rnd();
  const ig = new THREE.InstancedBufferGeometry().copy(g);
  ig.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  ig.setAttribute('aFlap', new THREE.InstancedBufferAttribute(new Float32Array(N).fill(1), 1));
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...envUniforms },
    vertexShader: /* glsl */ `
      attribute float aWing, aSeed, aFlap; uniform float uTime; varying vec3 vW;
      void main(){
        float f = sin(uTime * (10.0 + aSeed * 5.0) + aSeed * 30.0) * aFlap;
        vec3 p = position;
        p.y += aWing * f * 0.34;
        p.x *= 1.0 - aWing * abs(f) * 0.22;
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float; varying vec3 vW; ${GLSL_FOG}
      void main(){ gl_FragColor = vec4(applyFog(vec3(0.07, 0.08, 0.11), vW), 1.0); }`,
  });
  const mesh = new THREE.InstancedMesh(ig, mat, N);
  mesh.frustumCulled = false;
  mesh.name = 'birds';
  const birds = [];
  for (let i = 0; i < N; i++) {
    const perched = i < 7;
    const a = rnd() * 6.28;
    const px = ARENA.x - 14 + rnd() * 9 - (i % 2) * 6, pz = ARENA.z - 9 + rnd() * 18;
    birds.push({
      perched, state: perched ? 'perch' : 'circle',
      cx: lerp(-20, 20, rnd()), cz: lerp(-30, 20, rnd()), r: 14 + rnd() * 26, h: 16 + rnd() * 16, w: (0.16 + rnd() * 0.14) * (rnd() < 0.5 ? 1 : -1), ph: a,
      pos: new THREE.Vector3(px, heightAt(px, pz) + 0.05, pz), vel: new THREE.Vector3(), yaw: rnd() * 6.28, t: 0, scale: 0.8 + rnd() * 0.5,
    });
  }
  const dummy = new THREE.Object3D(), tmp = new THREE.Vector3();
  const flap = ig.attributes.aFlap;
  function update(dt, time) {
    birds.forEach((b, i) => {
      if (b.state === 'perch') {
        b.yaw += Math.sin(time * 0.7 + i) * dt * 0.4;
        flap.array[i] = 0.04;
        dummy.rotation.set(-0.5, b.yaw, 0);
      } else if (b.state === 'flee') {
        b.t += dt;
        b.vel.y = damp(b.vel.y, 6.5, 2, dt);
        b.pos.addScaledVector(b.vel, dt);
        b.yaw = Math.atan2(b.vel.x, b.vel.z);
        flap.array[i] = 1.4;
        dummy.rotation.set(-0.45, b.yaw, 0);
        if (b.t > 7) { b.state = 'circle'; b.h = 20 + (i % 5) * 3; b.cx = b.pos.x * 0.3; b.cz = b.pos.z * 0.3; b.r = 30 + (i % 4) * 6; b.ph = Math.atan2(b.pos.z - b.cz, b.pos.x - b.cx); }
      } else {
        b.ph += b.w * dt;
        tmp.set(b.cx + Math.cos(b.ph) * b.r, b.h + Math.sin(b.ph * 2.3 + i) * 2.5, b.cz + Math.sin(b.ph) * b.r);
        b.pos.lerp(tmp, 1 - Math.exp(-1.2 * dt));
        const tx = -Math.sin(b.ph) * Math.sign(b.w), tz = Math.cos(b.ph) * Math.sign(b.w);
        b.yaw = Math.atan2(tx, tz);
        flap.array[i] = 0.75 + 0.25 * Math.sin(time * 0.5 + i);
        dummy.rotation.set(0, b.yaw, -0.35 * Math.sign(b.w));
      }
      dummy.position.copy(b.pos);
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    flap.needsUpdate = true;
  }
  function scatter(fromX, fromZ) {
    birds.forEach((b, i) => {
      if (b.state !== 'perch') return;
      b.state = 'flee';
      b.t = -i * 0.07;
      const dx = b.pos.x - fromX, dz = b.pos.z - fromZ, l = Math.hypot(dx, dz) || 1;
      b.vel.set((dx / l) * 5 + (i % 3) - 1, 3, (dz / l) * 5 + ((i * 7) % 3) - 1);
    });
  }
  function reset() {
    birds.forEach((b) => {
      if (!b.perched) return;
      b.state = 'perch';
      const px = ARENA.x - 14 + rnd() * 9, pz = ARENA.z - 9 + rnd() * 18;
      b.pos.set(px, heightAt(px, pz) + 0.05, pz);
    });
  }
  return { mesh, update, scatter, reset };
}

/* ---------- light shafts: additive ribbons aligned with the sun, turned to face the camera ---------- */
export function createShafts() {
  const rnd = mulberry32(77);
  const spots = [[-24, -6, 4.5], [-28, 12, 5], [-17, 24, 4], [16, -8, 4.5], [18, 12, 4], [-6, -24, 6], [9, -30, 7], [-12, -30, 6], [2, 26, 4], [-33, 22, 5]];
  const group = new THREE.Group();
  group.name = 'shafts';
  const uniforms = { ...envUniforms, uIntensity: { value: 0.5 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vW;
      void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uNoise; uniform float uTime, uIntensity; uniform vec3 uSunColor;
      varying vec2 vUv; varying vec3 vW;
      void main(){
        float x = abs(vUv.x * 2.0 - 1.0);
        float streak = texture2D(uNoise, vec2(vUv.x * 0.9 + vW.x * 0.01, uTime * 0.012)).r;
        float streak2 = texture2D(uNoise, vec2(vUv.x * 2.7, uTime * 0.02 + 0.5)).g;
        float a = pow(clamp(1.0 - x, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
        a *= 0.35 + smoothstep(0.35, 0.7, streak) * 0.9 + streak2 * 0.3;
        float d = distance(cameraPosition, vW);
        a *= smoothstep(2.0, 12.0, d);
        gl_FragColor = vec4(max(uSunColor * a * uIntensity * 0.16, 0.0), 1.0);
      }`,
  });
  const shafts = spots.map(([x, z, w]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.userData = { x, z, w: w * (0.8 + rnd() * 0.5), len: 34 + rnd() * 10, k: 0.8 + rnd() * 0.5, l: 34 + rnd() * 10 };
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    m.layers.set(1);
    m.renderOrder = 9;
    group.add(m);
    return m;
  });
  const up = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3(), base = new THREE.Vector3(), fwd = new THREE.Vector3();
  function update(camera) {
    uniforms.uIntensity.value = ENV.shafts;
    up.copy(ENV.sunDir);
    for (const m of shafts) {
      const u = m.userData;
      base.set(u.x, terrainAt(u.x, u.z) - 1, u.z);
      toCam.subVectors(camera.position, base);
      side.crossVectors(up, toCam).normalize();
      fwd.crossVectors(side, up).normalize();
      // columns: side (x), up (y), fwd (z); translate to the middle of the shaft
      m.matrix.makeBasis(side.clone().multiplyScalar(u.w), up.clone().multiplyScalar(u.len), fwd);
      m.matrix.setPosition(base.x + up.x * u.len * 0.5, base.y + up.y * u.len * 0.5, base.z + up.z * u.len * 0.5);
      m.matrixWorldNeedsUpdate = true;
    }
  }
  /** move the pool of shafts to a new set of [x, z, width] spots (each zone lists its own) */
  function setSpots(list) {
    shafts.forEach((m, i) => {
      const sp = list[i];
      m.visible = !!sp;
      if (sp) { m.userData.x = sp[0]; m.userData.z = sp[1]; m.userData.w = sp[2] * m.userData.k; }
    });
  }
  return { group, update, setSpots, defaults: spots };
}

/* ---------- anime wind lines: thin ribbons with a bright dash that runs along them ---------- */
export function createWindLines() {
  const rnd = mulberry32(303);
  const group = new THREE.Group();
  group.name = 'wind';
  const uniforms = { ...envUniforms, uCenter: { value: new THREE.Vector3() } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime, uWindK; uniform vec3 uCenter;
      varying vec2 vUv; varying float vSeed;
      void main(){
        vUv = uv; vSeed = aSeed;
        vec3 p = position;
        p.y += sin(uv.x * 9.0 + uTime * 1.5 + aSeed * 20.0) * 0.35 * uv.x;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime, uWindK; varying vec2 vUv; varying float vSeed;
      void main(){
        float t = fract(uTime * (0.22 + vSeed * 0.12) * (0.6 + uWindK * 0.5) + vSeed * 5.0);
        float head = t * 1.6 - 0.3;
        float dash = smoothstep(head - 0.42, head, vUv.x) * smoothstep(head + 0.03, head, vUv.x);
        float edge = 1.0 - abs(vUv.y * 2.0 - 1.0);
        float a = dash * edge * smoothstep(0.6, 1.6, uWindK) * 0.5;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(1.0), a);
      }`,
  });
  for (let i = 0; i < 14; i++) {
    const len = 9 + rnd() * 8, segs = 24;
    const g = new THREE.PlaneGeometry(len, 0.05 + rnd() * 0.05, segs, 1);
    const p = g.attributes.position;
    const curl = (rnd() - 0.5) * 3;
    for (let k = 0; k < p.count; k++) {
      const u = p.getX(k) / len + 0.5;
      p.setZ(k, Math.sin(u * Math.PI * 1.5) * curl);
      p.setY(k, p.getY(k) + Math.sin(u * 3.0) * 0.5);
    }
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(p.count).fill(rnd()), 1));
    const m = new THREE.Mesh(g, mat);
    const x = ARENA.x + (rnd() - 0.5) * 46, z = ARENA.z + (rnd() - 0.5) * 46;
    m.position.set(x, Math.max(heightAt(x, z), 0) + 0.8 + rnd() * 3.2, z);
    m.rotation.y = -Math.atan2(0.38, 0.92) + (rnd() - 0.5) * 0.3;
    m.frustumCulled = false;
    m.layers.set(1);
    group.add(m);
  }
  return group;
}

/* a faint rainbow hanging in the spray */
export function createRainbow() {
  const g = new THREE.RingGeometry(15, 17.2, 48, 1, 0.15, Math.PI - 0.3);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uK: { value: 0.35 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      precision highp float; varying vec3 vP; uniform float uK;
      void main(){
        float r = (length(vP.xy) - 15.0) / 2.2;
        vec3 c = clamp(abs(mod(r * 4.6 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        float a = smoothstep(0.0, 0.25, r) * smoothstep(1.0, 0.75, r) * smoothstep(0.0, 6.0, vP.y);
        gl_FragColor = vec4(c * a * uK * 0.22, 1.0);
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.position.set(POOL.x + 4, 0.5, FALLS.zBase + 9);
  m.rotation.y = -0.25;
  m.layers.set(1);
  m.renderOrder = 9;
  m.name = 'rainbow';
  return m;
}
