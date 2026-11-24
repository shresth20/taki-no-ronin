import * as THREE from 'three';
import { G } from '../core/state.js';
import { lerp, sharedUniforms } from '../core/util.js';
import { ZONES } from './zones/index.js';

/* Lighting follows the journey. Each zone file carries its own preset (sun, sky, fog, wind, grade); the live values
   are a blend of the zones around the player, so crossing a bridge walks you from one light into the next.
   On top of that sit two moods the director controls: the storm of a fight, and the gold of the final victory.   */
const C = (h) => new THREE.Color(h);
const dirOf = ([e, a]) => new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
const KEYS_C = ['sunColor', 'skyTop', 'skyHorizon', 'cloudLit', 'cloudShade', 'hemiSky', 'hemiGround', 'fog', 'tint'];
const KEYS_N = ['sunI', 'coverage', 'hemiI', 'fogD', 'wind', 'sat', 'contrast', 'shafts', 'bloom', 'glow'];
const preset = (l) => {
  const p = { sunDir: dirOf(l.sun) };
  for (const k of KEYS_C) p[k] = C(l[k]);
  for (const k of KEYS_N) p[k] = l[k];
  return p;
};
const PRESETS = ZONES.map((z) => preset(z.lighting));
/* the fight: wind up, clouds close in, light warms and hardens */
const BATTLE = { sunColor: C('#ffc494'), skyTop: C('#33497a'), skyHorizon: C('#f2ac7c'), cloudLit: C('#ffd0a6'), cloudShade: C('#56557a'), fog: C('#d4b4a4'), coverage: 0.68, wind: 2.4, fogMul: 1.5, contrast: 0.03, bloom: 0.15 };
const GOLDEN = preset({
  sun: [(15 * Math.PI) / 180, (-48 * Math.PI) / 180], sunColor: '#ffd08a', sunI: 3.0,
  skyTop: '#4f7fc6', skyHorizon: '#ffdca6', cloudLit: '#fff0cf', cloudShade: '#c98f8f', coverage: 0.4,
  hemiSky: '#ffe2c0', hemiGround: '#a89068', hemiI: 1.2,
  fog: '#f3d5a8', fogD: 0.0058, wind: 0.8, sat: 1.18, contrast: 1.06, tint: '#fff4dc', shafts: 1.0, bloom: 0.8, glow: 0.5,
});

/** live, blended values — everything that depends on the light reads from here */
export const ENV = {
  sunDir: new THREE.Vector3(0.5, 0.6, 0.6), sunColor: new THREE.Color(), sunI: 1,
  skyTop: new THREE.Color(), skyHorizon: new THREE.Color(), cloudLit: new THREE.Color(), cloudShade: new THREE.Color(), coverage: 0.5,
  hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiI: 1,
  fog: new THREE.Color(), fogD: 0.005, wind: 1, sat: 1, contrast: 1, tint: new THREE.Color(), shafts: 0.5, bloom: 0.5, glow: 0.4,
};
/** how much each zone contributes right now (set by the world from the player's position) */
export const zoneMix = new Float32Array(ZONES.length);
zoneMix[0] = 1;

/** uniforms shared by the custom shaders (sky, water, waterfall, particles, kit) */
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
  uGlow: { value: 0.4 },
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

const _c = new THREE.Color(), _d = new THREE.Vector3();
export function updateEnv() {
  for (const k of KEYS_C) ENV[k].setRGB(0, 0, 0);
  for (const k of KEYS_N) ENV[k] = 0;
  _d.set(0, 0, 0);
  for (let i = 0; i < PRESETS.length; i++) {
    const w = zoneMix[i];
    if (w <= 0) continue;
    const p = PRESETS[i];
    for (const k of KEYS_C) { ENV[k].r += p[k].r * w; ENV[k].g += p[k].g * w; ENV[k].b += p[k].b * w; }
    for (const k of KEYS_N) ENV[k] += p[k] * w;
    _d.addScaledVector(p.sunDir, w);
  }
  const m = Math.min(2, Math.max(0, G.mood));
  const b = Math.min(1, m) * (1 - Math.max(0, m - 1)); // battle peaks at mood 1
  const g = Math.max(0, m - 1); // victory
  if (b > 0.001) {
    const k = b * 0.62;
    for (const key of ['sunColor', 'skyTop', 'skyHorizon', 'cloudLit', 'cloudShade', 'fog']) ENV[key].lerp(BATTLE[key], k * (ENV.glow > 1.2 ? 0.35 : 1));
    ENV.coverage = lerp(ENV.coverage, Math.max(ENV.coverage, BATTLE.coverage), b);
    ENV.wind = lerp(ENV.wind, Math.max(ENV.wind, BATTLE.wind), b);
    ENV.fogD *= 1 + (BATTLE.fogMul - 1) * b;
    ENV.contrast += BATTLE.contrast * b;
    ENV.bloom += BATTLE.bloom * b;
  }
  if (g > 0.001) {
    for (const k of KEYS_C) ENV[k].lerp(GOLDEN[k], g);
    for (const k of KEYS_N) ENV[k] = lerp(ENV[k], GOLDEN[k], g);
    _d.lerp(GOLDEN.sunDir, g);
  }
  ENV.sunDir.copy(_d).normalize();
  envUniforms.uCoverage.value = ENV.coverage;
  envUniforms.uFogDensity.value = ENV.fogD;
  envUniforms.uWindK.value = ENV.wind;
  envUniforms.uGlow.value = ENV.glow;
  sharedUniforms.uWind.value.set(0.92, 0.38, ENV.wind, 0);
}
updateEnv();
export { _c };
