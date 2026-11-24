import * as THREE from 'three';
import { envUniforms, ENV } from './env.js';
import { fbm, ridged, mulberry32 } from '../core/util.js';

/* Painted anime sky: gradient dome, sun, two-tone cumulus that drift with the wind */
export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: envUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 0.0);
        gl_Position = projectionMatrix * vec4(mv.xyz, 1.0);
        gl_Position.z = gl_Position.w; // far plane
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vDir;
      uniform vec3 uSkyTop, uSkyHorizon, uSunDir, uSunColor, uCloudLit, uCloudShade;
      uniform float uTime, uCoverage, uWindK;
      uniform sampler2D uNoise;
      float cloudField(vec2 p){
        float n = texture2D(uNoise, p).r * 0.6;
        n += texture2D(uNoise, p * 2.7 + vec2(uTime * 0.0025, 0.0)).g * 0.28;
        n += texture2D(uNoise, p * 7.3).a * 0.12;
        return n;
      }
      void main(){
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uSkyHorizon, uSkyTop, pow(smoothstep(0.0, 0.8, h), 0.55));
        col = mix(col, uSkyHorizon * 0.92, smoothstep(0.0, -0.25, d.y));
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 6.0) * 0.16 + pow(sd, 48.0) * 0.35);
        // clouds projected on a dome-ish plane
        vec2 uv = d.xz / (max(d.y, 0.0) + 0.16);
        float fade = smoothstep(0.015, 0.2, d.y);
        vec2 p = uv * 0.115 + uTime * vec2(0.0035, 0.0012) * (0.6 + uWindK * 0.5);
        float n = cloudField(p);
        float lo = 1.0 - uCoverage;
        float cov = smoothstep(lo - 0.06, lo + 0.05, n);
        float n2 = cloudField(p + uSunDir.xz * 0.03);
        float lit = clamp((n - n2) * 9.0 + 0.55, 0.0, 1.0);
        vec3 cc = mix(uCloudShade, uCloudLit, smoothstep(0.3, 0.62, lit));   // cel step
        cc = mix(cc, uCloudLit * 1.12, smoothstep(0.78, 0.92, lit) * 0.6);
        cc = mix(cc, uSkyHorizon, (1.0 - fade) * 0.6);
        float core = smoothstep(lo + 0.02, lo + 0.22, n);
        cc = mix(cc, mix(uCloudShade, cc, 0.55), core * (1.0 - smoothstep(0.3, 0.7, lit)) * 0.5);
        col = mix(col, cc, cov * fade * 0.96);
        // sun disc drawn over thin cloud
        col += uSunColor * pow(sd, 900.0) * 6.0 * (1.0 - cov * 0.8);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  mesh.scale.setScalar(800);
  mesh.name = 'sky';
  return mesh;
}

/* Layered mountain silhouettes with aerial perspective, plus one snow-capped volcano */
export function createMountains() {
  const group = new THREE.Group();
  group.name = 'mountains';
  const rnd = mulberry32(4242);
  const uniforms = { uSkyHorizon: envUniforms.uSkyHorizon, uSkyTop: envUniforms.uSkyTop, uSunColor: envUniforms.uSunColor, uSunDir: envUniforms.uSunDir };
  const makeMat = (base, haze, snow) =>
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uBase: { value: new THREE.Color(base) }, uHaze: { value: haze }, uSnow: { value: snow } },
      vertexShader: /* glsl */ `
        attribute float aK;
        varying float vY; varying float vK; varying vec3 vN; varying vec3 vP;
        void main(){ vY = position.y; vK = aK; vN = normal; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uBase, uSkyHorizon, uSkyTop, uSunColor, uSunDir; uniform float uHaze, uSnow;
        varying float vY; varying float vK; varying vec3 vN; varying vec3 vP;
        void main(){
          float lit = clamp(dot(normalize(vN), uSunDir) * 0.5 + 0.55, 0.0, 1.0);
          vec3 col = uBase * mix(0.72, 1.12, step(0.52, lit));
          float snowLine = uSnow + sin(vP.x * 0.02 + vP.z * 0.017) * 14.0 + vK * 26.0;
          col = mix(col, vec3(0.96, 0.98, 1.0) * mix(0.8, 1.05, step(0.5, lit)), step(snowLine, vY) * step(1.0, uSnow));
          col *= mix(vec3(1.0), uSunColor, 0.35);
          float mist = smoothstep(90.0, -10.0, vY) * 0.55;
          col = mix(col, uSkyHorizon, clamp(uHaze + mist, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  const ring = (radius, hMin, hMax, freq, color, haze, snow, seed) => {
    const seg = 220;
    const pos = [], nrm = [], k = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const n = ridged(Math.cos(a) * freq + seed, Math.sin(a) * freq + seed * 1.7, 4);
      const n2 = fbm(Math.cos(a) * freq * 3 + seed, Math.sin(a) * freq * 3, 3);
      const h = hMin + (hMax - hMin) * Math.pow(n, 1.6) + n2 * hMax * 0.12;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      const depth = radius * 0.16;
      // three verts per column: foot (front), ridge, back foot — gives a faceted ridge that catches the sun
      pos.push(x * 0.985, -30, z * 0.985, x + Math.cos(a) * depth * 0.2, h, z + Math.sin(a) * depth * 0.2, x + Math.cos(a) * depth, -30, z + Math.sin(a) * depth);
      const side = Math.sin(a * freq * 8 + seed) * 0.8;
      nrm.push(-Math.cos(a) + side * Math.sin(a), 0.6, -Math.sin(a) - side * Math.cos(a), -Math.cos(a) + side * Math.sin(a), 0.6, -Math.sin(a) - side * Math.cos(a), Math.cos(a), 0.4, Math.sin(a));
      const kk = rnd();
      k.push(kk, kk, kk);
      if (i < seg) {
        const o = i * 3;
        idx.push(o, o + 3, o + 1, o + 1, o + 3, o + 4, o + 1, o + 4, o + 2, o + 2, o + 4, o + 5);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(k, 1));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, makeMat(color, haze, snow));
    m.frustumCulled = false;
    group.add(m);
  };
  ring(330, 40, 150, 1.7, '#3f7f6a', 0.3, 0, 3.1);
  ring(470, 60, 230, 1.3, '#4a7f9a', 0.5, 190, 9.4);
  ring(640, 80, 330, 1.0, '#6f93bd', 0.68, 215, 17.9);

  // lone volcano to the north-east
  {
    const g = new THREE.ConeGeometry(190, 330, 40, 12, true);
    const p = g.attributes.position;
    const k = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), t = (y + 165) / 330;
      const r = Math.hypot(p.getX(i), p.getZ(i));
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const flare = Math.pow(1 - t, 2.2) * 150 + (fbm(Math.cos(a) * 3 + 5, Math.sin(a) * 3 + t * 4, 3) - 0.5) * 26 * (1 - t);
      const nr = r + flare;
      const s = r > 0.01 ? nr / r : 1;
      p.setX(i, p.getX(i) * s);
      p.setZ(i, p.getZ(i) * s);
      if (t > 0.97) p.setY(i, y - 22 + fbm(Math.cos(a) * 2, Math.sin(a) * 2, 2) * 14); // crater rim
      k[i] = fbm(Math.cos(a) * 5, Math.sin(a) * 5, 2);
    }
    g.computeVertexNormals();
    g.setAttribute('aK', new THREE.BufferAttribute(k, 1));
    const m = new THREE.Mesh(g, makeMat('#5c84b4', 0.5, 62));
    m.position.set(330, 135, -610);
    m.frustumCulled = false;
    group.add(m);
  }
  group.traverse((o) => {
    if (o.isMesh) o.renderOrder = -90;
  });
  return group;
}
export { ENV };
