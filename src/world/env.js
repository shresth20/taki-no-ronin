import * as THREE from 'three';
import { G } from '../core/state.js';
import { lerp, sharedUniforms } from '../core/util.js';

/* Three moods the valley moves through: calm morning -> storm of battle -> golden victory */
const dir = (elevDeg, azimDeg) => {
  const e = (elevDeg * Math.PI) / 180, a = (azimDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
};
const C = (h) => new THREE.Color(h);
const PRESETS = [
  {
    sunDir: dir(40, 38), sunColor: C('#fff0cf'), sunI: 2.6,
    skyTop: C('#2f86d8'), skyHorizon: C('#d3ecec'), cloudLit: C('#ffffff'), cloudShade: C('#a9c6e0'), coverage: 0.46,
    hemiSky: C('#cfe8ff'), hemiGround: C('#8fb07a'), hemiI: 1.25,
    fog: C('#cfe6e2'), fogD: 0.0038, wind: 1.0, sat: 1.12, contrast: 1.04, tint: C('#ffffff'), shafts: 0.55, bloom: 0.55,
  },
  {
    sunDir: dir(32, 56), sunColor: C('#ffc494'), sunI: 3.0,
    skyTop: C('#33497a'), skyHorizon: C('#f2ac7c'), cloudLit: C('#ffd0a6'), cloudShade: C('#56557a'), coverage: 0.66,
    hemiSky: C('#bccaf2'), hemiGround: C('#9a8c80'), hemiI: 1.5,
    fog: C('#d4b4a4'), fogD: 0.007, wind: 2.4, sat: 1.14, contrast: 1.07, tint: C('#fff5ec'), shafts: 0.9, bloom: 0.7,
  },
  {
    sunDir: dir(15, 48), sunColor: C('#ffd08a'), sunI: 3.0,
    skyTop: C('#4f7fc6'), skyHorizon: C('#ffdca6'), cloudLit: C('#fff0cf'), cloudShade: C('#c98f8f'), coverage: 0.4,
    hemiSky: C('#ffe2c0'), hemiGround: C('#a89068'), hemiI: 1.1,
    fog: C('#f3d5a8'), fogD: 0.0058, wind: 0.8, sat: 1.18, contrast: 1.06, tint: C('#fff4dc'), shafts: 1.0, bloom: 0.8,
  },
];

/** live, blended values — everything that depends on mood reads from here */
export const ENV = {
  sunDir: new THREE.Vector3(), sunColor: new THREE.Color(), sunI: 1,
  skyTop: new THREE.Color(), skyHorizon: new THREE.Color(), cloudLit: new THREE.Color(), cloudShade: new THREE.Color(), coverage: 0.5,
  hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiI: 1,
  fog: new THREE.Color(), fogD: 0.005, wind: 1, sat: 1, contrast: 1, tint: new THREE.Color(), shafts: 0.5, bloom: 0.5,
};

/** uniforms shared by the custom shaders (sky, water, waterfall, particles) */
export const envUniforms = {
  uTime: sharedUniforms.uTime,
  uSunDir: { value: ENV.sunDir },
  uSunColor: { value: ENV.sunColor },
  uSkyTop: { value: ENV.skyTop },
  uSkyHorizon: { value: ENV.skyHorizon },
  uCloudLit: { value: ENV.cloudLit },
  uCloudShade: { value: ENV.cloudShade },
  uCoverage: { value: 0.5 },
  uFogColor: { value: ENV.fog },
  uFogDensity: { value: 0.005 },
  uWindK: { value: 1 },
  uNoise: sharedUniforms.uNoise,
};

export const GLSL_FOG = `
uniform vec3 uFogColor; uniform float uFogDensity;
vec3 applyFog(vec3 col, vec3 wpos){
  float d = distance(cameraPosition, wpos);
  float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  return mix(col, uFogColor, clamp(f, 0.0, 1.0));
}
`;

const KEYS_C = ['sunColor', 'skyTop', 'skyHorizon', 'cloudLit', 'cloudShade', 'hemiSky', 'hemiGround', 'fog', 'tint'];
const KEYS_N = ['sunI', 'coverage', 'hemiI', 'fogD', 'wind', 'sat', 'contrast', 'shafts', 'bloom'];
export function updateEnv() {
  const m = Math.min(1.9999, Math.max(0, G.mood));
  const i = Math.floor(m), t = m - i;
  const a = PRESETS[i], b = PRESETS[i + 1];
  for (const k of KEYS_C) ENV[k].copy(a[k]).lerp(b[k], t);
  for (const k of KEYS_N) ENV[k] = lerp(a[k], b[k], t);
  ENV.sunDir.copy(a.sunDir).lerp(b.sunDir, t).normalize();
  envUniforms.uCoverage.value = ENV.coverage;
  envUniforms.uFogDensity.value = ENV.fogD;
  envUniforms.uWindK.value = ENV.wind;
  sharedUniforms.uWind.value.set(0.92, 0.38, ENV.wind, 0);
}
updateEnv();
