import * as THREE from 'three';
import { envUniforms, GLSL_FOG } from './env.js';
import { fbm, smoothstep } from '../core/util.js';

/* The sea of clouds: a soft layer lying in the valleys below a plateau, seen from above as drifting cumulus tops.
   One mesh over the area given, its vertices lifted into gentle swells and faded out wherever the ground rises to
   meet the layer, so the cloud thins against the gorge walls instead of cutting them with a hard line. Camera-facing
   puffs (the zone's cloud sprites) sit on top of it for volume.                                                   */
export function cloudSea(s, T) {
  const step = 1.6, n = Math.ceil((2 * s.r) / step), x0 = s.x - s.r, z0 = s.z - s.r;
  const pos = [], ak = [], idx = [];
  // the highest ground within a couple of metres: the layer starts thinning before it reaches a wall
  const high = (x, z) => Math.max(T(x, z), T(x + 4.5, z), T(x - 4.5, z), T(x, z + 4.5), T(x, z - 4.5), T(x + 3.2, z + 3.2), T(x - 3.2, z - 3.2), T(x + 3.2, z - 3.2), T(x - 3.2, z + 3.2));
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = x0 + i * step, z = z0 + j * step, d = Math.hypot(x - s.x, z - s.z) / s.r;
    // full where the ground lies well below the layer, gone where it comes within a couple of metres of it
    let k = smoothstep(s.y - 2, s.y - 8, high(x, z)) * (1 - smoothstep(0.78, 1, d));
    if (s.zMax !== undefined) k *= 1 - smoothstep(s.zMax - 14, s.zMax, z);
    const swell = (fbm(x * 0.045 + 2, z * 0.045 + 9, 3) - 0.5) * 5;
    // where it thins out the layer sinks, so what is left of it meets the rock below the cloud, never through it
    pos.push(x, s.y + swell * k - 4 * (1 - k), z);
    ak.push(k);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aK', new THREE.Float32BufferAttribute(ak, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals(); // the swells take the light: broad lit crowns and shaded troughs
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...envUniforms },
    vertexShader: /* glsl */ `
      attribute float aK; varying vec3 vW; varying vec3 vN; varying float vK;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normal; vK = aK; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uNoise; uniform float uTime; uniform vec3 uSunDir, uSunColor, uCloudLit, uCloudShade, uSkyHorizon;
      varying vec3 vW; varying vec3 vN; varying float vK;
      ${GLSL_FOG}
      float field(vec2 p){
        float n = texture2D(uNoise, p).r * 0.5;
        n += texture2D(uNoise, p * 2.3 + uTime * vec2(0.0016, -0.001)).g * 0.32;
        n += texture2D(uNoise, p * 5.7 - uTime * 0.0024).a * 0.18;
        return n;
      }
      void main(){
        vec2 p = vW.xz * 0.026 + uTime * vec2(0.0032, 0.0014);
        float n = field(p);
        // the swells lit from the sun's side, and the smaller heads of the field on top of them: cel steps on both
        float n2 = field(p + uSunDir.xz * 0.05);
        float lit = clamp(dot(normalize(vN), uSunDir) * 1.5 + (n - n2) * 8.0 - 0.1, 0.0, 1.0);
        vec3 shade = mix(uCloudShade, uCloudLit, 0.15);
        vec3 col = mix(shade, mix(uCloudLit, uSkyHorizon, 0.3), smoothstep(0.34, 0.44, lit));
        col = mix(col, uCloudLit, smoothstep(0.58, 0.68, lit));
        col = mix(col, uCloudLit * 1.1, smoothstep(0.84, 0.92, lit) * 0.5);
        col *= mix(vec3(1.0), uSunColor, 0.2);
        // the layer: heads of cloud with soft gaps between them, fraying out at its edges
        float e = n + (vK - 1.0) * 0.45;
        float body = smoothstep(0.31, 0.42, e);
        float a = vK * body * (0.8 + 0.2 * smoothstep(0.42, 0.6, e));
        a *= smoothstep(5.0, 24.0, distance(cameraPosition, vW));
        gl_FragColor = vec4(applyFog(col, vW), a);
      }`,
  });
  mat.userData.own = true;
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 6;
  m.layers.set(1);
  m.name = 'cloud-sea';
  return m;
}
