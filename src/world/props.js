import * as THREE from 'three';
import { mulberry32, getToonRamp, patchMaterial, GLSL_PAINT, mergeColored, fbm, ridged, smoothstep, M4, lerp } from '../core/util.js';
import { heightAt, cliffZ, ARENA, POOL, RIVER, riverHalfWidth, TRAIN_SPOT, WATER_Y, FALLS } from './terrain.js';

const ROCK_FRAG = `
  float paint = paintTri(vWPos, vWNrm, 0.21);
  float paintB = paintTri(vWPos, vWNrm, 0.05);
  vec3 rock = diffuseColor.rgb * (0.62 + 0.42 * paint) * (0.8 + 0.25 * paintB) * mix(vec3(1.0), paintTriRGB(vWPos, vWNrm, 0.09), 0.5);
  float mossK = smoothstep(0.42, 0.68, vWNrm.y + (paint - 1.0) * 0.4 + (paintB - 1.0) * 0.25);
  vec3 moss = mix(vec3(0.16, 0.36, 0.1), vec3(0.5, 0.6, 0.14), clamp(paintB * 0.6, 0.0, 1.0));
  rock = mix(rock, moss, mossK * 0.92);
  rock *= mix(0.55, 1.0, smoothstep(-0.05, 0.45, vWPos.y));
  diffuseColor.rgb = rock;
`;
export function rockMaterial() {
  return patchMaterial(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('soft') }), { key: 'rock', fHead: GLSL_PAINT, fColor: ROCK_FRAG });
}

function rockGeometry(seed, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const o = seed * 13.7;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let k = 0.78 + fbm(x * 1.2 + o, y * 1.2 + z * 1.7 + o, 3) * 0.55;
    k += (Math.round(fbm(x * 2.5 + z + o, y * 2.5 - o, 2) * 4) / 4 - 0.5) * 0.16; // chiselled planes
    const yy = y * k;
    p.setXYZ(i, x * k, yy < -0.2 ? -0.2 + (yy + 0.2) * 0.3 : yy, z * k);
  }
  g.computeVertexNormals();
  return g;
}
function pillarGeometry(seed) {
  const g = new THREE.CylinderGeometry(0.6, 1, 1, 26, 30, false);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  const o = seed * 7.1;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x), r = Math.hypot(x, z);
    if (r < 0.01) { p.setY(i, y - 0.03); continue; }
    const ca = Math.cos(a), sa = Math.sin(a);
    let k = 0.72 + fbm(ca * 1.4 + o, y * 2.6 + sa * 1.4, 3) * 0.5;
    k += (ridged(ca * 2.2 + sa * 0.7 + o, y * 0.9, 3) - 0.35) * 0.5; // vertical fluting
    const st = (((y * 4.2 + fbm(ca + o, sa, 2) * 1.5) % 1) + 1) % 1;
    k += smoothstep(0, 0.12, st) * (1 - st) * 0.2; // ledges
    const top = Math.max(0, y - 0.88) / 0.12;
    k *= 1 - top * top * 0.6;
    p.setXYZ(i, x * k, y + (fbm(x * 3 + o, z * 3, 2) - 0.5) * 0.05 * (y > 0.9 ? 1 : 0.15), z * k);
  }
  const flat = g.toNonIndexed(); // faceted, chiselled look
  flat.computeVertexNormals();
  return flat;
}

/** rocks, boulders and karst pillars. returns { group, colliders, waterRocks, pineSpots } */
export function createRocks() {
  const rnd = mulberry32(1212);
  const group = new THREE.Group();
  group.name = 'rocks';
  const mat = rockMaterial();
  const colliders = [], waterRocks = [], pineSpots = [];
  const lists = [[], [], []];
  const push = (x, z, sx, sy, sz, sink = 0.25, v = Math.floor(rnd() * 3)) => {
    const y = Math.max(heightAt(x, z), WATER_Y - 0.5) - sy * sink;
    lists[v].push({ x, y, z, sx, sy, sz, a: rnd() * 6.28 });
    const r = Math.max(sx, sz);
    if (sy > 0.5) colliders.push({ x, z, r: r * 0.86 });
    if (heightAt(x, z) < 0.25) waterRocks.push({ x, z, r: r * 0.95 });
    return y;
  };
  // pool rim
  for (let i = 0; i < 20; i++) {
    const a = -0.35 + (i / 19) * (Math.PI + 0.7) + Math.PI; // skip the southern outlet
    const d = POOL.r + 0.5 + rnd() * 3.5, s = 0.9 + rnd() * 1.7;
    const x = POOL.x + Math.cos(a) * d * 1.02, z = POOL.z + Math.sin(a) * d * 0.9 + 3;
    if (z < cliffZ(x) + 1.5) continue;
    push(x, z, s, s * (0.6 + rnd() * 0.5), s * (0.8 + rnd() * 0.5));
  }
  // stepping stones and midstream rocks
  for (let i = 14; i < 170; i += 9 + Math.floor(rnd() * 6)) {
    const p = RIVER[i];
    const hw = riverHalfWidth(p.z);
    for (let k = 0; k < 2; k++) {
      const off = (rnd() - 0.5) * 2 * (hw + 1.5), s = 0.45 + rnd() * 1.0;
      push(p.x - p.dz * off, p.z + p.dx * off, s, s * (0.5 + rnd() * 0.4), s * (0.8 + rnd() * 0.4), 0.3);
    }
  }
  // boulders ringing the meadow
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * 6.283 + rnd() * 0.35, d = ARENA.r + 3 + rnd() * 5;
    const x = ARENA.x + Math.cos(a) * d, z = ARENA.z + Math.sin(a) * d;
    if (heightAt(x, z) < 0.4) continue;
    const s = 0.8 + rnd() * 1.5;
    push(x, z, s, s * (0.6 + rnd() * 0.6), s * (0.8 + rnd() * 0.4));
  }
  // rubble at the foot of the cliff
  for (let i = 0; i < 22; i++) {
    const x = -70 + rnd() * 140;
    if (Math.abs(x) < 10) continue;
    const z = cliffZ(x) + 2.5 + rnd() * 4.5, s = 1.2 + rnd() * 2.6;
    push(x, z, s, s * (0.7 + rnd() * 0.7), s);
  }
  // the flat meditation stone by the bank
  push(TRAIN_SPOT.x + 4.3, TRAIN_SPOT.z - 3.6, 2.3, 0.85, 2.0, 0.42, 0);
  colliders.pop(); // it is walkable
  const med = lists[0][lists[0].length - 1];
  med.y = -0.2;
  med.a = 0.6;
  const medY = med.y;

  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const tones = ['#7fa39b', '#62908c', '#8fae9e', '#557f86'];
  lists.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(rockGeometry(v + 1, 2), mat, list.length);
    list.forEach((r, i) => {
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(0, r.a, 0);
      dummy.scale.set(r.sx, r.sy, r.sz);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      im.setColorAt(i, col.set(tones[Math.floor(rnd() * tones.length)]));
    });
    im.castShadow = im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);
  });

  // karst pillars: tall mossy columns flanking the falls and standing in the valley
  const pillars = [
    [-19, cliffZ(-19) + 7, 5.5, 25], [20, cliffZ(20) + 6, 5, 21], [-39, cliffZ(-39) + 9, 6.5, 30], [41, cliffZ(41) + 8, 6, 26],
    [-58, 6, 7, 27], [46, 34, 6.5, 23], [-52, 44, 6, 19], [58, 2, 7, 31], [-70, -8, 8, 36], [70, -20, 8, 34],
  ];
  const pg = [pillarGeometry(1), pillarGeometry(2)];
  pillars.forEach(([x, z, r, h], i) => {
    const m = new THREE.Mesh(pg[i % 2], mat);
    const y = Math.max(heightAt(x, z), 0) - 1.5;
    m.position.set(x, y, z);
    m.scale.set(r, h, r);
    m.rotation.y = rnd() * 6.28;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    pineSpots.push({ x: x + (rnd() - 0.5) * r * 0.3, z: z + (rnd() - 0.5) * r * 0.3, y: y + h * 0.97, s: 1.2 + rnd() * 0.7 });
    if (rnd() < 0.7) pineSpots.push({ x: x + r * 0.5, z: z + r * 0.3, y: y + h * (0.5 + rnd() * 0.2), s: 0.9 + rnd() * 0.4 });
    if (Math.hypot(x - ARENA.x, z - ARENA.z) < 50) colliders.push({ x, z, r: r * 0.9 });
  });
  // pillar geometry has no colour attribute: give it a neutral one so the shared material works
  for (const g of pg) {
    const c = new Float32Array(g.attributes.position.count * 3);
    const base = new THREE.Color('#7fa3a6');
    for (let i = 0; i < c.length; i += 3) c.set([base.r, base.g, base.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  // boulders that split the water at the lip of the falls
  {
    const lipRocks = [[-7.6, 2.6, 2.2], [7.9, 2.9, 2.5], [-2.4, 1.1, 1.0], [3.6, 0.9, 0.8]];
    const lg = rockGeometry(7, 2);
    const col = new Float32Array(lg.attributes.position.count * 3).fill(0.42);
    lg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const [dx, s, sy] of lipRocks) {
      const m = new THREE.Mesh(lg, mat);
      m.position.set(FALLS.x + dx, FALLS.top - 0.3 - (Math.abs(dx) > 5 ? 0.6 : 0.2), FALLS.zLip + 0.6 + (Math.abs(dx) > 5 ? 0.8 : 0));
      m.scale.set(s, sy, s * 0.9);
      m.rotation.y = rnd() * 6.28;
      group.add(m);
    }
  }
  // a few pines on the cliff top lip
  for (let i = 0; i < 9; i++) {
    const x = -80 + rnd() * 160;
    if (Math.abs(x) < 11) continue;
    pineSpots.push({ x, z: cliffZ(x) - 8.5, y: 35.2, s: 1.3 + rnd() * 0.7 });
  }
  return { group, colliders, waterRocks, pineSpots, meditation: { x: TRAIN_SPOT.x + 4.3, y: medY + 0.85 * 0.93, z: TRAIN_SPOT.z - 3.6 } };
}

/* ---------- man-made props: torii, stone lanterns, training post ---------- */
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 10) => new THREE.CylinderGeometry(rt, rb, h, n);

export function createProps() {
  const group = new THREE.Group();
  group.name = 'props';
  const colliders = [];
  const toon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('soft') });

  // torii gate where the path enters the meadow
  {
    const red = '#d6432c', dark = '#2a2326', cap = '#3a3136';
    const parts = [];
    for (const s of [-1, 1]) {
      parts.push({ geometry: cyl(0.25, 0.3, 5.3, 12), matrix: M4(s * 2.5, 2.65, 0, 0, 0, s * -0.035), color: red });
      parts.push({ geometry: cyl(0.4, 0.44, 0.5, 12), matrix: M4(s * 2.58, 0.25, 0), color: dark });
    }
    parts.push({ geometry: box(6.6, 0.34, 0.34), matrix: M4(0, 4.05, 0), color: red }); // nuki
    parts.push({ geometry: box(7.2, 0.4, 0.5), matrix: M4(0, 5.35, 0), color: red }); // shimaki
    // curved kasagi: three slabs rising toward the ends
    parts.push({ geometry: box(4.2, 0.3, 0.72), matrix: M4(0, 5.7, 0), color: cap });
    for (const s of [-1, 1]) parts.push({ geometry: box(2.3, 0.3, 0.72), matrix: M4(s * 3.1, 5.82, 0, 0, 0, s * 0.11), color: cap });
    parts.push({ geometry: box(0.3, 1.0, 0.24), matrix: M4(0, 4.7, 0), color: red });
    parts.push({ geometry: box(0.9, 0.62, 0.1), matrix: M4(0, 4.72, 0.16), color: '#e9dcb4' });
    const m = new THREE.Mesh(mergeColored(parts), toon);
    const x = -15.6, z = 29;
    m.position.set(x, heightAt(x, z) - 0.1, z);
    m.rotation.y = 0.16;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    for (const s of [-1, 1]) colliders.push({ x: x + Math.cos(0.16) * s * 2.55, z: z - Math.sin(0.16) * s * 2.55, r: 0.45 });
  }

  // stone lanterns along the path
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.9, 0.7) });
  const stone = '#9aa39a', stoneD = '#7e8983';
  const lantern = mergeColored([
    { geometry: cyl(0.42, 0.5, 0.22, 6), matrix: M4(0, 0.11, 0), color: stoneD },
    { geometry: cyl(0.14, 0.17, 0.95, 6), matrix: M4(0, 0.68, 0), color: stone },
    { geometry: cyl(0.36, 0.2, 0.16, 6), matrix: M4(0, 1.22, 0), color: stoneD },
    { geometry: box(0.44, 0.42, 0.44), matrix: M4(0, 1.5, 0), color: stone },
    { geometry: new THREE.ConeGeometry(0.62, 0.38, 6), matrix: M4(0, 1.9, 0), color: stoneD },
    { geometry: new THREE.SphereGeometry(0.1, 8, 6), matrix: M4(0, 2.14, 0), color: stone },
  ]);
  const lanternSpots = [[-13.2, 21.5], [-9.8, 10.2], [-6.2, -8.6], [-18.4, 26.5]];
  for (const [x, z] of lanternSpots) {
    const y = heightAt(x, z) - 0.05;
    const m = new THREE.Mesh(lantern, patchMaterial(toon.clone(), { key: 'lantern', fHead: GLSL_PAINT, fColor: 'diffuseColor.rgb *= 0.7 + 0.5 * paintTri(vWPos, vWNrm, 0.9);' }));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    const g = new THREE.Mesh(box(0.3, 0.26, 0.46), glow);
    g.position.set(x, y + 1.5, z);
    const g2 = new THREE.Mesh(box(0.46, 0.26, 0.3), glow);
    g2.position.copy(g.position);
    group.add(m, g, g2);
    colliders.push({ x, z, r: 0.5 });
  }

  // training post (makiwara): a straw-wrapped target the samurai practises on
  const post = new THREE.Group();
  {
    const wood = '#6b4a34', straw = '#d9bd72', rope = '#8a6a3c';
    const parts = [
      { geometry: cyl(0.1, 0.13, 2.0, 8), matrix: M4(0, 1.0, 0), color: wood },
      { geometry: cyl(0.24, 0.22, 0.95, 12), matrix: M4(0, 1.3, 0), color: straw },
      { geometry: cyl(0.2, 0.2, 0.3, 12), matrix: M4(0, 1.92, 0), color: straw },
      { geometry: box(1.1, 0.09, 0.09), matrix: M4(0, 1.5, 0), color: wood },
    ];
    for (const y of [0.9, 1.15, 1.45, 1.72]) parts.push({ geometry: new THREE.TorusGeometry(0.245, 0.028, 6, 14), matrix: M4(0, y, 0, Math.PI / 2, 0, 0), color: rope });
    const m = new THREE.Mesh(mergeColored(parts), toon);
    m.castShadow = true;
    post.add(m);
    const x = TRAIN_SPOT.x - 3.4, z = TRAIN_SPOT.z + 2.6;
    post.position.set(x, heightAt(x, z) - 0.15, z);
    post.userData = { x, z, wobble: 0, wobbleV: 0, dirX: 0, dirZ: 1 };
    group.add(post);
    colliders.push({ x, z, r: 0.34 });
  }
  return { group, colliders, post };
}
export { lerp };
