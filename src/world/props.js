import * as THREE from 'three';
import { mulberry32, getToonRamp, patchMaterial, GLSL_PAINT, mergeColored, fbm, ridged, smoothstep, M4, lerp } from '../core/util.js';
import { heightAt, cliffZ, ARENA, POOL, RIVER, riverHalfWidth, TRAIN_SPOT, WATER_Y, FALLS, pathDist, MEADOW_PATH, MEADOW_PATH_W } from './terrain.js';
import { beside } from './zones/shapes.js';
import { addStandable } from './nav.js';
import { Parts, mergeKit, kitMaterial } from './kit/core.js';
import { lanternBody, FIREBOX_Y } from './kit/build.js';

/** the top of one rock instance as a height map, for feet to step onto: rays straight down through its own geometry */
const _ray = new THREE.Raycaster(), _down = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3();
function standOn(geometry, r, step = 0.15) {
  const mesh = new THREE.Mesh(geometry);
  mesh.position.set(r.x, r.y, r.z);
  mesh.rotation.set(0, r.a, 0);
  mesh.scale.set(r.sx, r.sy, r.sz);
  mesh.updateMatrixWorld(true);
  const R = Math.max(r.sx, r.sz) * 1.4, nx = Math.ceil((R * 2) / step) + 1, h = new Float32Array(nx * nx).fill(NaN), hits = [];
  const x0 = r.x - R, z0 = r.z - R;
  for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
    _ray.set(_o.set(x0 + i * step, r.y + r.sy * 2 + 1, z0 + j * step), _down);
    hits.length = 0;
    const hit = mesh.raycast(_ray, hits) ?? hits.sort((a, b) => a.distance - b.distance)[0];
    if (hit && hit.point.y > heightAt(hit.point.x, hit.point.z) + 0.02) h[j * nx + i] = hit.point.y;
  }
  // a body steps up onto the stone as it reaches it (as a character controller's capsule rides up onto a step it
  // touches), not once the shin is already inside a steep side: carry the rim's height out by about a body's radius
  const out = h.slice(), k = Math.round(0.3 / step);
  for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
    if (h[j * nx + i] === h[j * nx + i]) continue;
    let best = NaN;
    for (let b = -k; b <= k; b++) for (let a = -k; a <= k; a++) {
      const ii = i + a, jj = j + b, v = h[jj * nx + ii];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nx || a * a + b * b > k * k || v !== v) continue;
      if (!(v <= best)) best = v;
    }
    out[j * nx + i] = best;
  }
  addStandable({ x0, z0, step, nx, nz: nx, h: out });
}
/** a rock's collider shaped to the rock: the convex outline of the mesh between knee and head height, so a body is
    stopped where the stone actually bulges, neither inside it nor short of it */
function fitCollider(geometry, r, col) {
  const P = geometry.attributes.position, c = Math.cos(r.a), sn = Math.sin(r.a), pts = [];
  const g = heightAt(r.x, r.z);
  for (let i = 0; i < P.count; i++) {
    const lx = P.getX(i) * r.sx, ly = P.getY(i) * r.sy, lz = P.getZ(i) * r.sz, y = r.y + ly;
    if (y < g + 0.15 || y > g + 1.9) continue;
    pts.push([r.x + lx * c + lz * sn, r.z - lx * sn + lz * c]);
  }
  if (pts.length < 3) return;
  // monotone chain
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  col.poly = lo.slice(0, -1).concat(hi.slice(0, -1));
  col.r = Math.max(...col.poly.map(([x, z]) => Math.hypot(x - r.x, z - r.z)));
}

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
let _rockMat = null;
export function rockMaterial() {
  return (_rockMat ??= patchMaterial(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('soft') }), { key: 'rock', occlude: true, fHead: GLSL_PAINT, fColor: ROCK_FRAG }));
}

// cut rock walls (the gorge): grey stone faces, moss only where a ledge faces the sky
const CRAG_FRAG = `
  float paint = paintTri(vWPos, vWNrm, 0.17);
  float paintB = paintTri(vWPos, vWNrm, 0.045);
  vec3 rock = diffuseColor.rgb * (0.74 + 0.34 * paint) * (0.86 + 0.2 * paintB) * mix(vec3(1.0), paintTriRGB(vWPos, vWNrm, 0.08), 0.4);
  float mossK = smoothstep(0.72, 0.93, vWNrm.y + (paint - 1.0) * 0.3);
  vec3 moss = mix(vec3(0.22, 0.4, 0.15), vec3(0.47, 0.57, 0.2), clamp(paintB * 0.6, 0.0, 1.0));
  rock = mix(rock, moss, mossK * 0.7);
  rock *= mix(0.62, 1.0, smoothstep(-0.05, 0.45, vWPos.y));
  diffuseColor.rgb = rock;
`;
let _cragMat = null;
/** instanced only: the per-instance colour is the stone's tone (no vertex colours, which rockGeometry doesn't carry) */
export function cragMaterial() {
  return (_cragMat ??= patchMaterial(new THREE.MeshToonMaterial({ gradientMap: getToonRamp('soft') }), { key: 'crag', occlude: true, fHead: GLSL_PAINT, fColor: CRAG_FRAG }));
}

export function rockGeometry(seed, detail = 2) {
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
    const rock = { x, y, z, sx, sy, sz, a: rnd() * 6.28 };
    lists[v].push(rock);
    const r = Math.max(sx, sz);
    if (sy > 0.5) colliders.push((rock.col = { x, z, r: r * 0.86 }));
    else rock.stand = true; // low enough to step onto: feet follow its top (below)
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
    const s = 0.8 + rnd() * 1.5, sy = s * (0.6 + rnd() * 0.6), sz = s * (0.8 + rnd() * 0.4);
    if (pathDist(x, z) < Math.max(s, sz) + 0.5) {
      // the gorge trail south was cut through here: leave the boulder out, but spend the draws push() would have
      // made (variant + yaw, and its tone below) so every other rock, pillar and pine keeps its place
      lists[Math.floor(rnd() * 3)].push({ cleared: true });
      rnd();
      continue;
    }
    push(x, z, s, sy, sz);
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
  med.stand = true;
  const medY = med.y;

  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const tones = ['#7fa39b', '#62908c', '#8fae9e', '#557f86'];
  lists.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(rockGeometry(v + 1, 2), mat, list.filter((r) => !r.cleared).length);
    let i = 0;
    for (const r of list) {
      const tone = tones[Math.floor(rnd() * tones.length)]; // drawn for cleared rocks too, so the rest keep their colours
      if (r.cleared) continue;
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(0, r.a, 0);
      dummy.scale.set(r.sx, r.sy, r.sz);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      im.setColorAt(i++, col.set(tone));
      if (r.stand) standOn(im.geometry, r);
      else if (r.col) fitCollider(im.geometry, r, r.col);
    }
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
      // pillars lean in at the top: a positive rz tips the top toward -x, so the feet splay out to the base collars
      parts.push({ geometry: cyl(0.25, 0.3, 5.3, 12), matrix: M4(s * 2.5, 2.65, 0, 0, 0, s * 0.035), color: red });
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

  // stone lanterns along the meadow path, walked from the training ground to the torii: a pair flanking the approach
  // to the torii, one on the outside of the path's bend, one across the path from the training post. Each stands on
  // the verge with a window turned to the path, and its flame is one of the sources the pooled lamps can light.
  // the same carved lantern the zones use (world/kit/build.js), its windows papered with lantern paper that is plain
  // by day and glows at night
  const stone = '#9aa39a', stoneD = '#7e8983';
  const LP = new Parts();
  lanternBody(LP, stone, stoneD);
  const lantern = mergeKit(LP.list);
  const walk = [...MEADOW_PATH].reverse(), W = MEADOW_PATH_W, gap = 1.15;
  const lanternSpots = [beside(walk, W, 33.5, 1, gap), beside(walk, W, 33.5, -1, gap), beside(walk, W, 19, 1, gap), beside(walk, W, 2.5, -1, gap)];
  const lights = [];
  const lanternMat = patchMaterial(toon.clone(), { key: 'lantern', fHead: GLSL_PAINT, fColor: 'diffuseColor.rgb *= 0.7 + 0.5 * paintTri(vWPos, vWNrm, 0.9);' });
  for (const { x, z, rot } of lanternSpots) {
    // stand level on the meadow's slope: tucked a little into the uphill side, and where the ground falls away under
    // the base a cut-stone footing (set in below the lowest ground) carries it, so no edge hangs in the air
    let lo = heightAt(x, z), hi = lo;
    for (let i = 0; i < 16; i++) for (const f of [0.55, 1]) { const a = (i / 16) * 6.283, h = heightAt(x + Math.sin(a) * 0.62 * f, z + Math.cos(a) * 0.62 * f); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const y = Math.max(lo, hi - 0.16) - 0.05;
    if (y + 0.05 - lo > 0.04) {
      const fh = 0.3 + (y + 0.05 - lo), foot = new THREE.Mesh(mergeColored([{ geometry: cyl(0.58, 0.62, fh, 6), matrix: M4(0, 0, 0), color: '#748079' }]), lanternMat);
      foot.position.set(x, y + 0.02 - fh / 2, z);
      foot.rotation.y = rot;
      foot.castShadow = foot.receiveShadow = true;
      group.add(foot);
    }
    const m = new THREE.Mesh(lantern, kitMaterial());
    m.position.set(x, y, z);
    m.rotation.y = rot;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    colliders.push({ x, z, r: 0.5 });
    lights.push({ x, y: y + FIREBOX_Y, z, i: 0.8 });
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
  return { group, colliders, post, lights };
}
export { lerp };
