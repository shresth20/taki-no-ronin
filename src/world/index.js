import * as THREE from 'three';
import { G, QUALITY } from '../core/state.js';
import { sharedUniforms, getNoiseTexture, getPaintTexture, setPaintTextureFromImage, getToonRamp, patchMaterial, GLSL_PAINT, damp } from '../core/util.js';
import { PAINT } from '../assets/paint.js';
import { terrainAt, groundAt, zoneWeights, zoneAt, ZONES, NAV } from './nav.js'; // evaluated first: stitches the six zones into one ground
import { ENV, updateEnv, zoneMix } from './env.js';
import { buildTerrainGeometry, buildCliffGeometry, buildWaterDataTexture, ARENA, legacyPathDist, MEADOW_PATH_W, HALF } from './terrain.js';
import { GLSL_PATH, valleyPathTexture } from './paths.js';
import { createSky, createMountains } from './sky.js';
import { createWater, createWaterfall, createMist } from './water.js';
import { createTrees, createBamboo, createGrass } from './vegetation.js';
import { createRocks, createProps } from './props.js';
import { createPetals, createBirds, createShafts, createWindLines, createRainbow } from './atmosphere.js';
import { createStreamer } from './stream.js';

const LEAF_TINT = ['#f0a83a', '#e8782e', '#a8c64e', '#e2472c', '#c9622e', '#b0302a'].map((h) => new THREE.Color(h));
const LEAF_K = [0.45, 0.6, 0.5, 0.85, 0.2, 0.25];
const LIGHTS = 3;

/** distance to the walk edge of the valley's nearest worn path: the meadow path (worn to MEADOW_PATH_W) and the
    zone file's bare-earth walk shapes */
function valleyPathEdge(x, z) {
  let d = legacyPathDist(x, z) - MEADOW_PATH_W / 2;
  for (const c of NAV.SHAPES) {
    if (c.zi !== 0 || c.role !== 'walk' || c.surface !== 'dirt') continue;
    if (c.t === 'circle') { d = Math.min(d, Math.hypot(x - c.x, z - c.z) - c.r); continue; }
    let best = 1e18;
    for (let i = 0; i < c.pts.length - 1; i++) {
      const a = c.pts[i], b = c.pts[i + 1], vx = b[0] - a[0], vz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1)));
      best = Math.min(best, (x - a[0] - vx * t) ** 2 + (z - a[1] - vz * t) ** 2);
    }
    d = Math.min(d, Math.sqrt(best) - c.w / 2);
  }
  return d;
}

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
    c.left = -34; c.right = 34; c.top = 34; c.bottom = -34; c.near = 1; c.far = 210;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.06;
  }
  group.add(hemi, sun, sun.target);
  // a small fixed pool of warm lights hops between the nearest lanterns and fires (the count never changes, so no shader rebuilds)
  const lamps = [];
  for (let i = 0; i < LIGHTS; i++) {
    // a gentle falloff: with no shadows, a steep one lit a lantern's own stone (under a metre off) many times brighter
    // than the pool of light on the ground around it, and at night every lantern burned white
    const l = new THREE.PointLight('#ffb066', 0, 15, 1.25);
    l.userData.k = 0;
    lamps.push(l);
    group.add(l);
  }

  /* ---------- zone 00: the valley exactly as it was built ---------- */
  const valley = new THREE.Group();
  valley.name = 'zone-waterfall-legacy';
  // the valley's worn paths (the meadow path, the gorge trail, the shrine nook, the ledge past the bridge), painted by
  // the same worn-ground shader as the zones, from a distance field to their walk edges
  const vrect = { x0: -HALF, x1: HALF, z0: -HALF, z1: HALF };
  const paths = valleyPathTexture(vrect, valleyPathEdge);
  const terrain = new THREE.Mesh(
    buildTerrainGeometry(),
    patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), {
      key: 'terrain',
      uniforms: { uPathMap: { value: paths }, uPathRect: { value: new THREE.Vector4(vrect.x0, vrect.z0, 1 / (vrect.x1 - vrect.x0 + 1), 1 / (vrect.z1 - vrect.z0 + 1)) }, uDirt: { value: new THREE.Color('#a8905c') } },
      fHead: GLSL_PAINT + 'uniform sampler2D uPathMap; uniform vec4 uPathRect; uniform vec3 uDirt;' + GLSL_PATH,
      fColor: `
        float pt = paintTri(vWPos, vWNrm, 0.085), pt2 = paintTri(vWPos, vWNrm, 0.33);
        {
          vec4 sf = texture2D(uPathMap, (vWPos.xz - uPathRect.xy + 0.5) * uPathRect.zw);
          float flat_ = smoothstep(0.55, 0.8, vWNrm.y) * smoothstep(0.25, 0.55, vWPos.y); // never down a bank into the water
          diffuseColor.rgb = wornGround(diffuseColor.rgb, vWPos.xz, (0.5 - sf.r) * 8.0, vec3(sf.g, 0.0, 0.0), pt2, uDirt, uDirt, flat_);
        }
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
  const rocks = createRocks();
  const props = createProps();
  const trees = createTrees(rocks.pineSpots);
  const bamboo = createBamboo();
  const MAXQ = QUALITY.high;
  const grass = createGrass(MAXQ.grass);
  const water = createWater(buildWaterDataTexture(rocks.waterRocks), MAXQ.reflect);
  const waterfall = createWaterfall();
  const mist = createMist();
  const birds = createBirds();
  const wind = createWindLines();
  const rainbow = createRainbow();
  valley.add(terrain, cliff, rocks.group, props.group, trees.group, bamboo, grass, water.mesh, waterfall, mist, birds.mesh, wind, rainbow);
  group.add(valley);

  /* sky + far scenery + air */
  const sky = createSky();
  const mountains = createMountains();
  const petals = createPetals(MAXQ.petals);
  const leaves = createPetals(Math.floor(MAXQ.petals * 0.45), { leaf: true });
  const shafts = createShafts();
  // a fog-coloured apron far below the world: wide shots never look into a void beneath the horizon
  const apron = new THREE.Mesh(new THREE.CircleGeometry(1500, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ fog: false }));
  apron.position.y = -6;
  apron.renderOrder = -80;
  apron.frustumCulled = false;
  group.add(sky, mountains, apron, petals.mesh, leaves.mesh, shafts.group);

  /* ---------- zones 01–05 (and zone 00's new structures) stream in around the player ---------- */
  const zoneRoot = new THREE.Group();
  zoneRoot.name = 'zones';
  group.add(zoneRoot);
  const listeners = { load: [], unload: [] };
  let quality = Q;
  const streamer = createStreamer(zoneRoot, () => quality, {
    onLoad: (h) => listeners.load.forEach((f) => f(h)),
    onUnload: (h) => listeners.unload.forEach((f) => f(h)),
  });
  streamer.loadNow(0);

  const fog = new THREE.FogExp2(0xffffff, 0.005);
  const colliders = [...rocks.colliders, ...props.colliders, ...trees.colliders];
  const drift = new THREE.Vector2();
  const focus = new THREE.Vector3(ARENA.x, 1, ARENA.z);
  const tint = new THREE.Color();
  const near = [];
  let shaftZone = -1;

  function update(dt, camera, playerPos, rdt = dt) {
    const px = playerPos ? playerPos.x : focus.x, pz = playerPos ? playerPos.z : focus.z;
    zoneWeights(px, pz, zoneMix);
    updateEnv();
    sharedUniforms.uTime.value = G.time;
    if (playerPos) {
      sharedUniforms.uPlayerPos.value.copy(playerPos);
      focus.lerp(playerPos, 1 - Math.exp(-4 * dt));
      if (focus.distanceToSquared(playerPos) > 900) focus.copy(playerPos);
    }
    streamer.update(px, pz, G.test ? 1e9 : 5, G.test);
    for (const h of streamer.handles()) h.update(dt);
    const here = streamer.current;
    // the valley's planting is drawn unculled, so it is switched off as a whole once it is out of sight
    valley.visible = streamer.slots[0].d < (G.rig?.cine.on ? 150 : 56);

    hemi.color.copy(ENV.hemiSky);
    hemi.groundColor.copy(ENV.hemiGround);
    hemi.intensity = ENV.hemiI;
    sun.color.copy(ENV.sunColor);
    sun.intensity = ENV.sunI;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(ENV.sunDir, 96);
    fog.color.copy(ENV.fog);
    fog.density = ENV.fogD;

    sky.position.copy(camera.position);
    apron.position.set(camera.position.x, -6, camera.position.z);
    apron.material.color.copy(ENV.fog).lerp(ENV.hemiGround, 0.35).multiplyScalar(0.92);
    mountains.position.set(camera.position.x * 0.8, 0, camera.position.z * 0.8);

    drift.x += 0.92 * ENV.wind * dt * 1.6;
    drift.y += 0.38 * ENV.wind * dt * 1.6;
    for (const p of [petals, leaves]) {
      p.uniforms.uCenter.value.set(camera.position.x, camera.position.y + 2, camera.position.z);
      p.uniforms.uDrift.value.copy(drift);
    }
    const storm = G.mood > 0.5 && G.mood < 1.5 ? 1 : 0;
    let lk = 0;
    tint.setRGB(0, 0, 0);
    for (let i = 0; i < ZONES.length; i++) { lk += LEAF_K[i] * zoneMix[i]; tint.r += LEAF_TINT[i].r * zoneMix[i]; tint.g += LEAF_TINT[i].g * zoneMix[i]; tint.b += LEAF_TINT[i].b * zoneMix[i]; }
    petals.uniforms.uDensity.value = damp(petals.uniforms.uDensity.value, zoneMix[0] * (storm ? 1.0 : 0.6), 1.5, dt);
    leaves.uniforms.uDensity.value = damp(leaves.uniforms.uDensity.value, Math.min(1, lk * (storm ? 1.5 : 1)), 1.5, dt);
    leaves.uniforms.uTint.value.copy(tint);
    if (valley.visible) birds.update(dt, G.time);
    if (shaftZone !== here) {
      shaftZone = here;
      const h = streamer.handle(here);
      const list = here === 0 ? shafts.defaults : (h?.shafts || []).flatMap((s) => [[s.x - s.r * 0.4, s.z + s.r * 0.2, 4.5], [s.x + s.r * 0.5, s.z - s.r * 0.3, 5], [s.x, s.z + s.r * 0.6, 4]]);
      shafts.setSpots(list);
    }
    shafts.update(camera);
    rainbow.material.uniforms.uK.value = 0.28 + (G.mood > 1.5 ? (G.mood - 1.5) * 1.2 : 0);

    // lantern light: hand the pooled lamps to the nearest sources
    near.length = 0;
    if (quality.shadow > 0 || quality.bloom) {
      const consider = (l) => {
        const d = (l.x - focus.x) ** 2 + (l.z - focus.z) ** 2;
        if (d < 520) near.push({ l, d: d / (l.i * l.i) });
      };
      for (const h of streamer.handles()) h.lights.forEach(consider);
      if (valley.visible) props.lights.forEach(consider); // the meadow's own stone lanterns
      near.sort((a, b) => a.d - b.d);
    }
    for (let i = 0; i < LIGHTS; i++) {
      const lamp = lamps[i], src = near[i]?.l;
      // a lantern is a small flame behind paper or stone: by night it glows, it does not floodlight (fires burn on)
      // (a lantern's flame is a candle's: a warm pool a couple of metres across round its foot, not a floodlight that
      // turns the pale garden gravel white)
      const night = Math.max(0, ENV.glow - 0.3), lit = src?.fire ? night : Math.min(night, 0.75) * 0.5;
      const want = src ? src.i * lit * 26 * (src.fire ? 1.25 + Math.sin(G.time * 11 + i * 2.1) * 0.12 + Math.sin(G.time * 23.7 + i) * 0.08 : 1) : 0;
      if (src && (lamp.userData.src !== src)) {
        // fade out before hopping so the hand-over is never visible
        lamp.userData.k = damp(lamp.userData.k, 0, 14, rdt);
        // sources name the glow itself (a firebox, a paper shade, the flames' roots); the light hangs 0.4 above it, which
        // tucks it inside the lantern's cap or the lamp post's arm: there it lights the ground around the lantern without
        // blasting the lantern's own stone white from a few centimetres away
        if (lamp.userData.k < 0.04) { lamp.userData.src = src; lamp.position.set(src.x, src.y + 0.4, src.z); lamp.color.set(src.fire ? '#ff9548' : '#ffc27a'); }
      } else lamp.userData.k = damp(lamp.userData.k, src ? 1 : 0, 6, rdt);
      lamp.intensity = want * lamp.userData.k;
    }

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
    quality = q;
    sun.castShadow = q.shadow > 0;
    if (q.shadow > 0 && sun.shadow.mapSize.x !== q.shadow) {
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    water.setReflectSize(q.reflect);
    grassMesh.count = Math.min(grassMax, q.grass);
    petals.mesh.geometry.instanceCount = q.petals;
    leaves.mesh.geometry.instanceCount = Math.floor(q.petals * 0.45);
    shafts.group.visible = q.bloom;
  }
  applyQuality(Q);
  return {
    group, update, applyQuality, water, fog, colliders, birds, post: props.post, meditation: rocks.meditation, sun, heightAt: terrainAt, groundAt, valley,
    streamer, zoneAt,
    onZoneLoad: (f) => { listeners.load.push(f); for (const h of streamer.handles()) f(h); },
    onZoneUnload: (f) => listeners.unload.push(f),
    /** swing a gate's doors (the walk blocker is owned by the journey module) */
    setGate(id, open, instant) { for (const h of streamer.handles()) h.setGate(id, open, instant); },
    reflects: () => valley.visible && streamer.current <= 1,
  };
}
