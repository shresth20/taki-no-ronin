import * as THREE from 'three';
import { G, QUALITY } from '../core/state.js';
import { sharedUniforms, getNoiseTexture, getPaintTexture, setPaintTextureFromImage, getToonRamp, patchMaterial, GLSL_PAINT, damp } from '../core/util.js';
import { PAINT } from '../assets/paint.js';
import { ENV, updateEnv } from './env.js';
import { buildTerrainGeometry, buildCliffGeometry, buildWaterDataTexture, heightAt, ARENA } from './terrain.js';
import { createSky, createMountains } from './sky.js';
import { createWater, createWaterfall, createMist } from './water.js';
import { createTrees, createBamboo, createGrass } from './vegetation.js';
import { createRocks, createProps } from './props.js';
import { createPetals, createBirds, createShafts, createWindLines, createRainbow } from './atmosphere.js';

export function createWorld(Q) {
  sharedUniforms.uNoise.value = getNoiseTexture();
  sharedUniforms.uPaint.value = getPaintTexture();
  if (PAINT) {
    const img = new Image();
    img.onload = () => setPaintTextureFromImage(img);
    img.src = PAINT;
  }
  const group = new THREE.Group();
  group.name = 'world';

  /* lights */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  {
    const c = sun.shadow.camera;
    c.left = -30; c.right = 30; c.top = 30; c.bottom = -30; c.near = 1; c.far = 190;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.06;
  }
  group.add(hemi, sun, sun.target);

  /* ground + cliff */
  const terrain = new THREE.Mesh(
    buildTerrainGeometry(),
    patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), {
      key: 'terrain',
      fHead: GLSL_PAINT,
      fColor: `
        float pt = paintTri(vWPos, vWNrm, 0.085), pt2 = paintTri(vWPos, vWNrm, 0.33);
        diffuseColor.rgb *= (0.74 + 0.3 * pt) * (0.9 + 0.12 * pt2);
        float cz = texture2D(uNoise, vWPos.xz * 0.085 + uTime * 0.012).b;
        diffuseColor.rgb += smoothstep(0.08, 0.0, cz) * 0.14 * smoothstep(0.0, -0.3, vWPos.y);`,
    })
  );
  terrain.receiveShadow = true;
  terrain.name = 'terrain';
  const cliff = new THREE.Mesh(
    buildCliffGeometry(),
    patchMaterial(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('soft') }), {
      key: 'cliff',
      fHead: GLSL_PAINT,
      fColor: `
        float pt = paintTri(vWPos, vWNrm, 0.06), pt2 = paintTri(vWPos, vWNrm, 0.21);
        diffuseColor.rgb *= (0.6 + 0.46 * pt) * (0.82 + 0.2 * pt2);
        diffuseColor.rgb *= mix(vec3(1.0), paintTriRGB(vWPos, vWNrm, 0.06), 0.55);   // painted hue variation
        float st = texture2D(uNoise, vec2(vWPos.x * 0.011, vWPos.y * 0.07)).g;   // horizontal strata
        diffuseColor.rgb *= 0.86 + 0.24 * smoothstep(0.35, 0.65, st);`,
    })
  );
  cliff.receiveShadow = true;
  cliff.castShadow = true;
  cliff.name = 'cliff';
  group.add(terrain, cliff);

  /* rocks, props, plants */
  const rocks = createRocks();
  const props = createProps();
  const trees = createTrees(rocks.pineSpots);
  const bamboo = createBamboo();
  const MAXQ = QUALITY.high;
  const grass = createGrass(MAXQ.grass);
  group.add(rocks.group, props.group, trees.group, bamboo, grass);

  /* water */
  const water = createWater(buildWaterDataTexture(rocks.waterRocks), MAXQ.reflect);
  const waterfall = createWaterfall();
  const mist = createMist();
  group.add(water.mesh, waterfall, mist);

  /* sky + far scenery */
  const sky = createSky();
  const mountains = createMountains();
  group.add(sky, mountains);

  /* atmosphere */
  const petals = createPetals(MAXQ.petals);
  const leaves = createPetals(Math.floor(MAXQ.petals * 0.3), { leaf: true });
  const birds = createBirds();
  const shafts = createShafts();
  const wind = createWindLines();
  const rainbow = createRainbow();
  group.add(petals.mesh, leaves.mesh, birds.mesh, shafts.group, wind, rainbow);

  const fog = new THREE.FogExp2(0xffffff, 0.005);
  const colliders = [...rocks.colliders, ...props.colliders, ...trees.colliders];
  const drift = new THREE.Vector2();
  const focus = new THREE.Vector3(ARENA.x, 1, ARENA.z);

  function update(dt, camera, playerPos) {
    updateEnv();
    sharedUniforms.uTime.value = G.time;
    if (playerPos) {
      sharedUniforms.uPlayerPos.value.copy(playerPos);
      focus.lerp(playerPos, 1 - Math.exp(-4 * dt));
    }
    hemi.color.copy(ENV.hemiSky);
    hemi.groundColor.copy(ENV.hemiGround);
    hemi.intensity = ENV.hemiI;
    sun.color.copy(ENV.sunColor);
    sun.intensity = ENV.sunI;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(ENV.sunDir, 90);
    fog.color.copy(ENV.fog);
    fog.density = ENV.fogD;

    sky.position.copy(camera.position);
    mountains.position.set(camera.position.x * 0.6, 0, camera.position.z * 0.6);

    drift.x += 0.92 * ENV.wind * dt * 1.6;
    drift.y += 0.38 * ENV.wind * dt * 1.6;
    for (const p of [petals, leaves]) {
      p.uniforms.uCenter.value.set(camera.position.x, camera.position.y + 5, camera.position.z);
      p.uniforms.uDrift.value.copy(drift);
    }
    petals.uniforms.uDensity.value = damp(petals.uniforms.uDensity.value, G.mood > 0.5 && G.mood < 1.5 ? 1.0 : 0.6, 1.5, dt);
    leaves.uniforms.uDensity.value = damp(leaves.uniforms.uDensity.value, G.mood > 0.5 && G.mood < 1.5 ? 1.0 : 0.45, 1.5, dt);
    birds.update(dt, G.time);
    shafts.update(camera);
    rainbow.material.uniforms.uK.value = 0.28 + (G.mood > 1.5 ? (G.mood - 1.5) * 1.2 : 0);

    // training post wobble (damped spring)
    const pu = props.post.userData;
    pu.wobbleV += (-pu.wobble * 160 - pu.wobbleV * 7) * dt;
    pu.wobble += pu.wobbleV * dt;
    props.post.rotation.set(pu.dirZ * pu.wobble, 0, -pu.dirX * pu.wobble);
  }

  const grassMesh = grass.children[0];
  const grassMax = grassMesh.count;
  /** quality can change while playing: shadows, mirror size, grass and petal density */
  function applyQuality(q) {
    sun.castShadow = q.shadow > 0;
    if (q.shadow > 0 && sun.shadow.mapSize.x !== q.shadow) {
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    water.setReflectSize(q.reflect);
    grassMesh.count = Math.min(grassMax, q.grass);
    petals.mesh.geometry.instanceCount = q.petals;
    leaves.mesh.geometry.instanceCount = Math.floor(q.petals * 0.3);
    shafts.group.visible = q.bloom;
  }
  applyQuality(Q);
  return { group, update, applyQuality, water, fog, colliders, birds, post: props.post, meditation: rocks.meditation, sun, heightAt };
}
