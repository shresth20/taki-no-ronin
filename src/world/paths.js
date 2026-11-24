import * as THREE from 'three';
import { clamp } from '../core/util.js';

/* Worn ground: how a path is painted onto the terrain.

   A path is not a ruled band of one colour. It is ground walked bare: ragged at the verge where the grass holds on
   in clumps, paler and dusty along the untrodden margins, packed darker down the line people actually walk (one line
   down a narrow trail, a pair of cart tracks on a wide street), mottled damp and dry, with grit and the odd pebble.

   Everything is driven by a smooth distance field to the walk edge (wd, metres, negative inside) plus how much of the
   ground nearby is bare soil, paving or litter (typ), so the same code serves the zones' terrain (fed from the nav grid)
   and the valley's original terrain (fed from a field baked over its own paths). The shared noise texture supplies
   every wobble: R and G broad fbm, A fine fbm.                                                                       */
export const GLSL_PATH = /* glsl */ `
vec3 wornGround(vec3 col, vec2 p, float wd, vec3 typ, float pt2, vec3 dirtC, vec3 specC, float flat_) {
  // paving counts too: where a flag is missing, or a paved square meets a dirt street, bare soil shows, not lawn
  float tot = typ.x + typ.y + typ.z;
  if (tot < 0.002) return col;
  vec4 nA = texture2D(uNoise, p * 0.031), nB = texture2D(uNoise, p * 0.23);
  // the worn edge wanders round the walk edge at three scales
  float e = wd - 0.45 - ((nA.r - 0.5) * 0.9 + (nA.g - 0.5) * 0.5 + (nB.g - 0.5) * 0.3);
  float inside = -e, worn = smoothstep(-0.1, 0.1, inside);
  // grass holds on in clumps along the verge and thins out toward the middle
  float verge = 1.0 - smoothstep(0.0, 0.9, inside);
  float grassy = smoothstep(-0.06, 0.06, verge * 0.85 - texture2D(uNoise, p * 0.37 + 0.5).g);
  float k = worn * (1.0 - grassy) * flat_ * smoothstep(0.0, 0.35, tot);

  // bare soil
  float mott = texture2D(uNoise, p * 0.083 + 0.21).r;
  vec3 soil = dirtC * (0.86 + 0.24 * pt2) * (0.88 + 0.22 * mott);
  float tr = exp(-pow((-wd - 1.65) / 0.42, 2.0)) * smoothstep(0.25, 0.55, texture2D(uNoise, p * 0.05 + 0.63).g);
  soil *= 1.0 - 0.15 * tr;                                                  // the trodden line(s), packed darker
  soil = mix(soil, soil * vec3(1.07, 1.04, 0.96) + 0.025, verge * 0.55);   // dusty, pale margins
  float fine = texture2D(uNoise, p * 0.6 + 0.13).a;
  soil *= 0.93 + 0.14 * nB.a;                                              // grit
  vec3 stone = mix(soil, vec3(dot(soil, vec3(0.3333))), 0.6) * 1.5;
  soil = mix(soil, stone, smoothstep(0.8, 0.88, fine) * 0.7);              // pebbles
  soil = mix(soil, soil * 0.7, smoothstep(0.2, 0.12, fine) * 0.5);         // their shadows and small hollows

  // leaf litter, moss or gravel: the same ground strewn with flecks of a paler, warmer and a darker tone
  vec3 lit = specC * (0.88 + 0.2 * pt2) * (0.9 + 0.2 * mott);
  float fl = texture2D(uNoise, p * 0.29 + 0.77).a;
  lit = mix(lit, lit * vec3(1.3, 1.18, 0.82), smoothstep(0.58, 0.68, fl) * 0.75);
  lit = mix(lit, lit * 0.7, smoothstep(0.42, 0.32, fl) * 0.55);

  vec3 ground = mix(soil, lit, typ.z / max(typ.x + typ.z, 1e-3));
  ground = mix(ground, col, verge * 0.22);                                 // a green tinge where the grass meets it
  col = mix(col, ground, k);
  // the grass right along the verge stands a little taller and shades itself
  col *= 1.0 - 0.1 * exp(-pow((e + 0.1) / 0.35, 2.0)) * (1.0 - k) * flat_ * smoothstep(0.0, 0.35, tot);
  return col;
}
`;

/** encode a signed distance (m) the way the zones' surface map does: 0.5 at the edge, ±4 m across the byte */
export const encodeEdge = (d) => clamp(Math.round((0.5 - d / 8) * 255), 0, 255);

/** A surface map for the valley (zone 00), which keeps its own terrain mesh: R the distance to the nearest worn
    path's walk edge, G = bare soil. `edge(x, z)` gives that distance. Same layout as zone.js surfaceTexture.        */
export function valleyPathTexture(rect, edge) {
  const nx = rect.x1 - rect.x0 + 1, nz = rect.z1 - rect.z0 + 1, data = new Uint8Array(nx * nz * 4);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const o = (j * nx + i) * 4, d = edge(rect.x0 + i, rect.z0 + j);
    data[o] = encodeEdge(d);
    data[o + 1] = d < 4 ? 255 : 0;
  }
  const t = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
