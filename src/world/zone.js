import * as THREE from 'three';
import { ZONES } from './zones/index.js';
import { NAV, terrainAt, waterLevelAt, zoneSolids, zoneAt } from './nav.js';
import { BUILD, bridge, stairway, K, hash } from './kit/build.js';
import { Parts, mergeKit, kitMaterial, glowMaterial, streamMaterial, ribbonGeo, discGeo, bannerMaterial, clothBuffers, clothGeo, spriteMeshes, MAT, boxG, cylG, sphG, coneG } from './kit/core.js';
import { treeSet, bambooSet, grassSet } from './vegetation.js';
import { rockGeometry, rockMaterial } from './props.js';
import { fallGeometry, fallMaterial } from './water.js';
import { patchMaterial, GLSL_PAINT, mulberry32, fbm, smoothstep, lerp, clamp } from '../core/util.js';

/* Builds everything a zone file describes into one THREE.Group:
   ground, water, architecture, planting, the dressing that makes every edge of the walkable area visibly an edge,
   and the moving parts (gates, wheels, cloth, fire). Written as a generator so the streaming manager can spread
   the work over several frames and bring the next zone in without a hitch.                                      */

const PAL = {
  valley: { a: '#76b040', b: '#3f8c44', gold: '#bfb24a', rock: '#6d8983', dirt: '#a8905c', pave: '#a9aba0', spec: '#7a9a50', bed: '#7fa08a' },
  village: { a: '#80b648', b: '#4d9447', gold: '#c6b552', rock: '#80918a', dirt: '#b99a64', pave: '#aaa99a', spec: '#7a9a50', bed: '#7fa08a' },
  forest: { a: '#5f9642', b: '#3a743b', gold: '#93a046', rock: '#6c8578', dirt: '#9c8055', pave: '#9aa095', spec: '#8d7a44', bed: '#6f9080' },
  mountain: { a: '#88ad4d', b: '#57914a', gold: '#cba94b', rock: '#7c9599', dirt: '#b19a72', pave: '#b6b7aa', spec: '#6f9a4a', bed: '#7b9a8c' },
  fort: { a: '#8c9651', b: '#687b46', gold: '#aa914f', rock: '#7f8684', dirt: '#9d8563', pave: '#93958d', spec: '#8b8367', bed: '#7b9a8c' },
  castle: { a: '#60865a', b: '#406b4b', gold: '#7e8b53', rock: '#6f7986', dirt: '#8b7b67', pave: '#7f828d', spec: '#cdc8b8', bed: '#5f8088' },
};
const shared = (g) => { g.userData.shared = true; return g; };
const own = (m) => { m.userData.own = true; return m; };

/* ---------- ground ---------- */
function surfaceTexture(grid) {
  const { nx, nz, W, S } = grid, data = new Uint8Array(nx * nz * 4);
  for (let i = 0; i < nx * nz; i++) {
    const s = S[i];
    data[i * 4] = clamp(Math.round((0.5 - W[i] / 8) * 255), 0, 255);
    data[i * 4 + 1] = s === 1 ? 255 : 0;
    data[i * 4 + 2] = s === 2 || s === 7 ? 255 : 0;
    data[i * 4 + 3] = s === 3 || s === 4 || s === 5 ? 255 : 0;
  }
  const t = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
const TERRAIN_FRAG = /* glsl */ `
  {
    vec2 suv = (vWPos.xz - uRect.xy + 0.5) * uRect.zw;
    vec4 sf = texture2D(uSurf, suv);
    float pt = paintTri(vWPos, vWNrm, 0.085), pt2 = paintTri(vWPos, vWNrm, 0.33);
    float nz = (pt2 - 1.0) * 0.32;
    vec3 col = diffuseColor.rgb;
    float flat_ = smoothstep(0.55, 0.8, vWNrm.y);
    col = mix(col, uDirt * (0.86 + 0.24 * pt2), smoothstep(0.3, 0.58, sf.g + nz) * flat_);
    col = mix(col, uSpec * (0.88 + 0.2 * pt2), smoothstep(0.3, 0.58, sf.a + nz) * flat_);
    vec2 g = vWPos.xz / 1.35; g.x += floor(g.y) * 0.5;
    vec2 f = fract(g);
    float id = fract(sin(dot(floor(g), vec2(127.1, 311.7))) * 43758.5453);
    float joint = smoothstep(0.0, 0.05, f.x) * smoothstep(1.0, 0.95, f.x) * smoothstep(0.0, 0.05, f.y) * smoothstep(1.0, 0.95, f.y);
    vec3 pave = uPave * (0.82 + 0.26 * id) * mix(0.58, 1.0, joint);
    col = mix(col, pave, smoothstep(0.38, 0.56, sf.b + nz * 0.4) * flat_);
    col *= (0.74 + 0.3 * pt) * (0.9 + 0.12 * pt2);
    diffuseColor.rgb = col;
  }
`;
function terrainMesh(zone, step) {
  const r = zone.rect, grid = NAV.GRIDS[zone.index], pal = PAL[zone.ground.palette];
  const nx = Math.floor((r.x1 - r.x0) / step) + 1, nz = Math.floor((r.z1 - r.z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), nrm = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  const A = new THREE.Color(pal.a), B = new THREE.Color(pal.b), GD = new THREE.Color(pal.gold), RK = new THREE.Color(pal.rock), BED = new THREE.Color(pal.bed), DEEP = new THREE.Color('#2f6a70'), WET = new THREE.Color('#8d8866');
  const c = new THREE.Color(), t = new THREE.Color(), n = new THREE.Vector3();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = r.x0 + i * step, z = r.z0 + j * step, o = (j * nx + i) * 3;
    const h = terrainAt(x, z);
    pos[o] = x; pos[o + 1] = h; pos[o + 2] = z;
    n.set(terrainAt(x - 1, z) - terrainAt(x + 1, z), 2, terrainAt(x, z - 1) - terrainAt(x, z + 1)).normalize();
    nrm[o] = n.x; nrm[o + 1] = n.y; nrm[o + 2] = n.z;
    const n1 = fbm(x * 0.06 + 3, z * 0.06 + 7, 3), n2 = fbm(x * 0.021 + 30, z * 0.021 + 11, 3);
    c.copy(A).lerp(B, smoothstep(0.35, 0.7, n1)).lerp(GD, smoothstep(0.56, 0.72, n2) * 0.7);
    const wl = Math.max(waterLevelAt(x, z), waterLevelAt(x + 1.5, z), waterLevelAt(x - 1.5, z), waterLevelAt(x, z + 1.5), waterLevelAt(x, z - 1.5));
    if (wl > -100) {
      c.lerp(WET, 1 - smoothstep(wl + 0.05, wl + 0.6, h));
      if (h < wl) c.copy(BED).lerp(DEEP, smoothstep(wl - 0.3, wl - 1.6, h)).multiplyScalar(0.9 + n1 * 0.2);
    }
    c.lerp(t.copy(RK).multiplyScalar(0.78 + n1 * 0.44), smoothstep(0.2, 0.42, 1 - n.y));
    col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const cx = r.x0 + (i + 0.5) * step, cz = r.z0 + (j + 0.5) * step;
    let covered = false;
    for (let k = 0; k < zone.index; k++) { const q = ZONES[k].rect; if (cx > q.x0 && cx < q.x1 && cz > q.z0 && cz < q.z1) covered = true; }
    if (covered) continue;
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const tex = surfaceTexture(grid);
  const mat = own(patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), {
    key: 'zterrain',
    uniforms: {
      uSurf: { value: tex }, uRect: { value: new THREE.Vector4(grid.x0, grid.z0, 1 / grid.nx, 1 / grid.nz) },
      uDirt: { value: new THREE.Color(pal.dirt) }, uPave: { value: new THREE.Color(pal.pave) }, uSpec: { value: new THREE.Color(pal.spec) },
    },
    fHead: GLSL_PAINT + 'uniform sampler2D uSurf; uniform vec4 uRect; uniform vec3 uDirt, uPave, uSpec;',
    fColor: TERRAIN_FRAG,
  }));
  mat.userData.tex = tex;
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.name = 'terrain-' + zone.id;
  return m;
}

/* ---------- water ---------- */
function waterMeshes(zone, group, ctx) {
  const flowing = [], calm = [];
  const yOff = zone.index * 0.012;
  for (const w of zone.water || []) {
    if (w.legacy) continue;
    if (w.t === 'pond') calm.push(discGeo(w.x, w.z, w.r + w.bank * 0.7, w.y + yOff));
    else if (w.t === 'paddy') {
      calm.push(discGeo(w.x, w.z, 0, w.y - 0.06 + yOff, w.w + 1.2, w.d + 1.2, w.rot));
      // rows of young rice
      const cs = Math.cos(w.rot), sn = Math.sin(w.rot);
      for (let a = -w.w / 2 + 0.6; a < w.w / 2 - 0.3; a += 0.62) for (let b = -w.d / 2 + 0.6; b < w.d / 2 - 0.3; b += 0.5) {
        const x = w.x + a * cs + b * sn, z = w.z - a * sn + b * cs, k = 0.85 + hash(x, z) * 0.3;
        ctx.tufts.push({ x, y: w.y - 0.02, z, w: 0.09, h: 0.42 * k, r: 0.5 * k, g: 0.8 * k, b: 0.28 });
      }
    } else {
      let pts = w.pts;
      if (w.weir) {
        pts = pts.map(([x, z]) => [x, Math.max(z, w.weir.z + 0.3)]).filter((p, i, a) => i === 0 || p[1] !== a[i - 1][1]);
        // the lip of the weir: a short curtain of white water and a line of boulders
        const x0 = w.pts[0][0];
        const fall = new THREE.Mesh(fallGeometry(x0, w.w * 0.96, w.y + w.weir.drop, w.y - 0.05, w.weir.z - 0.6, w.weir.z + 0.9, 0.6), own(fallMaterial(0.8, 0.95, 3.2, 0.5)));
        fall.renderOrder = 6;
        group.add(fall);
        for (let i = 0; i < 9; i++) { const u = (i / 8 - 0.5) * (w.w + 3), s = 0.7 + hash(i, 4) * 0.8; ctx.rocks.push({ x: x0 + u, y: w.y - 0.4, z: w.weir.z + (hash(i, 9) - 0.5) * 0.8, sx: s, sy: s * 1.1, sz: s * 0.8, a: i }); }
      }
      (w.calm ? calm : flowing).push(ribbonGeo(pts, w.w + w.bank * 1.4, () => w.y + yOff, { speed: w.calm ? 0.2 : 1 }));
    }
  }
  const add = (list, isCalm) => {
    if (!list.length) return;
    const m = new THREE.Mesh(mergeW(list), own(streamMaterial({ calm: isCalm ? 1 : 0, tint: zone.ground.palette === 'castle' ? ['#4fb7b0', '#0e4a66'] : null })));
    m.renderOrder = 5;
    m.layers.set(1);
    group.add(m);
  };
  add(flowing, false);
  add(calm, true);
}
function mergeW(list) {
  let n = 0, k = 0;
  for (const g of list) { n += g.attributes.position.count; k += g.index.count; }
  const pos = new Float32Array(n * 3), aw = new Float32Array(n * 3), idx = new Uint32Array(k);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    aw.set(g.attributes.aW.array, vo * 3);
    for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('aW', new THREE.BufferAttribute(aw, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/* ---------- edge dressing: every boundary of the walkable area gets something you can see ---------- */
const _pieces = {};
function boundaryPiece(style) {
  if (_pieces[style]) return _pieces[style];
  const P = new Parts(), L = 1.3;
  if (style === 'fence') {
    P.box(0.12, 1.15, 0.12, -L / 2, 0.55, 0, K.woodD).box(L, 0.09, 0.06, 0, 0.95, 0, K.woodL).box(L, 0.09, 0.06, 0, 0.55, 0, K.woodL).box(0.07, 0.8, 0.05, 0, 0.5, 0, K.wood).box(0.07, 0.8, 0.05, L * 0.28, 0.5, 0, K.wood).box(0.07, 0.8, 0.05, -L * 0.28, 0.5, 0, K.wood);
  } else if (style === 'rail') {
    P.box(0.14, 1.0, 0.14, -L / 2, 0.45, 0, K.woodD).cyl(0.05, 0.05, L, 0, 0.88, 0, K.wood, 0, { rz: Math.PI / 2, n: 5 }).cyl(0.04, 0.04, L, 0, 0.5, 0, K.wood, 0, { rz: Math.PI / 2, n: 5 });
  } else if (style === 'balustrade') {
    P.box(0.3, 1.05, 0.3, -L / 2, 0.5, 0, K.stoneD, MAT.plain).box(L, 0.16, 0.26, 0, 0.92, 0, K.stone).box(L, 0.2, 0.22, 0, 0.14, 0, K.stone).box(0.12, 0.6, 0.12, -L * 0.17, 0.52, 0, K.stoneL).box(0.12, 0.6, 0.12, L * 0.17, 0.52, 0, K.stoneL).add(sphG(0.16, 6, 5), -L / 2, 1.12, 0, K.stoneL);
  } else if (style === 'palisade') {
    for (let i = 0; i < 4; i++) P.cyl(0.15, 0.17, 2.3 + (i % 2) * 0.2, -L / 2 + (i + 0.5) * (L / 4), 1.1, 0, i % 2 ? K.wood : K.woodD, 0, { n: 6 }).add(coneG(0.15, 0.4, 6), -L / 2 + (i + 0.5) * (L / 4), 2.42 + (i % 2) * 0.2, 0, K.woodL);
    P.box(L, 0.12, 0.08, 0, 1.5, 0.16, K.rope);
  } else {
    P.box(L, 1.5, 0.5, 0, 0.7, 0, '#ece6d8', MAT.plaster, { grad: [0.8, 1.03] }).box(L, 0.5, 0.56, 0, 0.2, 0, K.stone, MAT.stone).box(L, 0.16, 0.9, 0, 1.52, 0, K.tileD).box(L, 0.12, 0.3, 0, 1.64, 0, '#2c383e');
  }
  return (_pieces[style] = shared(mergeKit(P.list)));
}
function dressBoundary(zone, ctx, solids) {
  const g = NAV.GRIDS[zone.index], style = zone.boundary, out = [];
  const W = (x, z) => { const fx = clamp(x - g.x0, 0, g.nx - 1.001), fz = clamp(z - g.z0, 0, g.nz - 1.001), ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, o = iz * g.nx + ix; return lerp(lerp(g.W[o], g.W[o + 1], tx), lerp(g.W[o + g.nx], g.W[o + g.nx + 1], tx), tz); };
  const special = [...NAV.DECKS, ...NAV.SHAPES.filter((s) => s.stairs)];
  const nearSpecial = (x, z) => special.some((s) => x > s.bb[0] - 1 && x < s.bb[1] + 1 && z > s.bb[2] - 1 && z < s.bb[3] + 1 && distPoly(s.pts, x, z) - s.w / 2 < 0.75);
  for (let j = 0; j < g.nz - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
    const o = j * g.nx + i, a = g.W[o], b = g.W[o + 1], c = g.W[o + g.nx], d = g.W[o + g.nx + 1];
    if (Math.min(a, b, c, d) >= 0 || Math.max(a, b, c, d) <= 0) continue;
    let x = g.x0 + i + 0.5, z = g.z0 + j + 0.5;
    if (zone.legacy && z < 29) continue; // the meadow keeps its open edge
    let gx = W(x + 0.4, z) - W(x - 0.4, z), gz = W(x, z + 0.4) - W(x, z - 0.4);
    const gl = Math.hypot(gx, gz);
    if (gl < 1e-4) continue;
    gx /= gl; gz /= gl;
    const w0 = W(x, z);
    x -= gx * w0; z -= gz * w0;
    if (nearSpecial(x, z)) continue;
    const ox = x + gx * 1.0, oz = z + gz * 1.0;
    if (waterLevelAt(ox, oz) > terrainAt(ox, oz) - 0.1 || waterLevelAt(x + gx * 2, z + gz * 2) > terrainAt(x + gx * 2, z + gz * 2) - 0.1) continue; // a bank is its own edge
    const y = terrainAt(x, z), rise = terrainAt(x + gx * 2.2, z + gz * 2.2) - y;
    if (rise > 1.5) continue; // a slope you plainly cannot climb
    if (solids.some((f) => distSolid(f, x + gx * 0.4, z + gz * 0.4) < 1.5)) continue;
    out.push({ x, z, y, gx, gz });
  }
  if (style === 'bamboo') {
    // a wall of stalks instead of a fence
    for (const p of out) for (let k = 0; k < 3; k++) {
      const d = 0.45 + ctx.rnd() * 1.5, s = (ctx.rnd() - 0.5) * 1.1;
      ctx.stalks.push({ x: p.x + p.gx * d - p.gz * s, z: p.z + p.gz * d + p.gx * s, h: 5.5 + ctx.rnd() * 3, a: ctx.rnd() * 6.28, w: 0.8 + ctx.rnd() * 0.6 });
    }
    return null;
  }
  if (!out.length || style === 'none') return null;
  const geo = boundaryPiece(style);
  const im = new THREE.InstancedMesh(geo, kitMaterial(), out.length);
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  out.forEach((p, i) => {
    dummy.position.set(p.x + p.gx * 0.42, Math.min(p.y, terrainAt(p.x + p.gx * 0.42, p.z + p.gz * 0.42)) - 0.06, p.z + p.gz * 0.42);
    dummy.rotation.set(0, Math.atan2(-p.gx, -p.gz), 0);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
    const k = 0.88 + hash(p.x, p.z) * 0.22;
    im.setColorAt(i, col.setRGB(k, k, k));
  });
  im.castShadow = true;
  im.receiveShadow = true;
  im.name = 'boundary-' + zone.id;
  return im;
}
function distPoly(P, x, z) {
  let best = 1e18;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], vx = b[0] - a[0], vz = b[1] - a[1];
    const t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1);
    best = Math.min(best, (x - a[0] - vx * t) ** 2 + (z - a[1] - vz * t) ** 2);
  }
  return Math.sqrt(best);
}
function distSolid(f, x, z) {
  if (f.r !== undefined) return Math.hypot(x - f.x, z - f.z) - f.r;
  const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0), dx = x - f.x, dz = z - f.z;
  const qx = Math.abs(dx * c - dz * s) - f.w / 2, qz = Math.abs(dx * s + dz * c) - f.d / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/* ---------- planting ---------- */
const PLANT = {
  valley: null,
  village: { trees: [['momiji', 0.34], ['maple', 0.3], ['green', 0.3], ['sakura', 0.06]], count: 64, min: 4.5, grass: 9000, bamboo: 0, rocks: 14 },
  forest: { trees: [['green', 0.7], ['momiji', 0.3]], count: 26, min: 14, grass: 4200, bamboo: 2700, rocks: 46 },
  mountain: { trees: [['momiji', 0.5], ['pine', 0.3], ['maple', 0.2]], count: 70, min: 5, grass: 7000, bamboo: 0, rocks: 60 },
  fort: { trees: [['pine', 0.7], ['momiji', 0.3]], count: 30, min: 8, grass: 3600, bamboo: 0, rocks: 30 },
  castle: { trees: [['pine', 0.6], ['momiji', 0.4]], count: 30, min: 8, grass: 3000, bamboo: 0, rocks: 26 },
};
function plant(zone, ctx, solids, Q) {
  const rule = PLANT[zone.ground.palette], r = zone.rect, rnd = ctx.rnd;
  const spots = { sakura: [], maple: [], green: [], pine: [], momiji: [] };
  for (const [k, x, z, s] of zone.trees || []) spots[k].push({ x, z, s, a: hash(x, z) * 6.28 });
  const g = NAV.GRIDS[zone.index];
  const Wn = (x, z) => g.W[clamp(Math.round(z - g.z0), 0, g.nz - 1) * g.nx + clamp(Math.round(x - g.x0), 0, g.nx - 1)];
  const dry = (x, z) => waterLevelAt(x, z) < terrainAt(x, z) - 0.05;
  const slope = (x, z) => Math.hypot(terrainAt(x + 1, z) - terrainAt(x - 1, z), terrainAt(x, z + 1) - terrainAt(x, z - 1)) / 2;
  // rasterise the solids once: near = within 1 m, far = within 3.5 m
  const occ = new Uint8Array(g.nx * g.nz);
  for (const f of solids) {
    const rad = (f.r ?? Math.hypot(f.w, f.d) / 2) + 3.6;
    for (let zz = Math.floor(f.z - rad); zz <= f.z + rad; zz++) for (let xx = Math.floor(f.x - rad); xx <= f.x + rad; xx++) {
      const i = xx - g.x0, j = zz - g.z0;
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
      const d = distSolid(f, xx, zz);
      if (d < 3.5) occ[j * g.nx + i] |= d < 1.0 ? 3 : d < 1.8 ? 2 : 1;
    }
  }
  const occAt = (x, z) => occ[clamp(Math.round(z - g.z0), 0, g.nz - 1) * g.nx + clamp(Math.round(x - g.x0), 0, g.nx - 1)];
  const clear = (x, z, m) => (m > 2 ? occAt(x, z) === 0 : m > 1.2 ? occAt(x, z) < 2 : occAt(x, z) < 3);
  const owned = (x, z) => zoneAt(x, z) === zone.index;
  if (rule) {
    // trees: a belt around the walkable area, thinning with distance
    let tries = 0, n = 0;
    const all = () => Object.values(spots).flat();
    while (n < rule.count && tries++ < rule.count * 60) {
      const x = r.x0 + rnd() * (r.x1 - r.x0), z = r.z0 + rnd() * (r.z1 - r.z0), w = Wn(x, z);
      if (w < rule.min || w > 44 || rnd() < (w - rule.min) / 55) continue;
      if (!owned(x, z) || !dry(x, z) || slope(x, z) > 0.8 || !clear(x, z, 3.2)) continue;
      if (all().some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 36)) continue;
      let pick = rnd(), kind = rule.trees[0][0];
      for (const [k, p] of rule.trees) { if (pick < p) { kind = k; break; } pick -= p; }
      spots[kind].push({ x, z, s: 1.0 + rnd() * 0.55, a: rnd() * 6.28 });
      n++;
    }
    // bamboo: dense by the paths, opening out behind
    const nb = Math.round(rule.bamboo * Q.plantK);
    for (let i = 0, t = 0; i < nb && t < nb * 12; t++) {
      const x = r.x0 + rnd() * (r.x1 - r.x0), z = r.z0 + rnd() * (r.z1 - r.z0), w = Wn(x, z);
      if (w < 0.7 || w > 30 || rnd() < w / 34) continue;
      if (!dry(x, z) || !clear(x, z, 0.9)) continue;
      ctx.stalks.push({ x, z, h: 5.5 + Math.min(w, 12) * 0.45 + rnd() * 4, a: rnd() * 6.28, w: 0.8 + rnd() * 0.6 });
      i++;
    }
    // grass and reeds in tufts just off the paths, never on stone
    const ng = Math.round(rule.grass * Q.plantK), pal = PAL[zone.ground.palette];
    const cA = new THREE.Color(pal.a), cB = new THREE.Color(pal.b), c = new THREE.Color();
    for (let i = 0, t = 0; i < ng && t < ng * 10; t++) {
      const x = r.x0 + rnd() * (r.x1 - r.x0), z = r.z0 + rnd() * (r.z1 - r.z0), w = Wn(x, z);
      if (w < 0.25 || w > 13 || rnd() < w / 15) continue;
      const y = terrainAt(x, z);
      if (!owned(x, z) || slope(x, z) > 0.7 || !clear(x, z, 0.4)) continue;
      const wl = waterLevelAt(x, z), reed = wl > y - 0.35;
      if (wl > y + 0.25) continue;
      c.copy(cA).lerp(cB, fbm(x * 0.07, z * 0.07, 2)).multiplyScalar(1.0 + rnd() * 0.3);
      // each tuft is a little clump of blades
      for (let k = 0; k < 5; k++) {
        const bx = x + (rnd() - 0.5) * 0.5, bz = z + (rnd() - 0.5) * 0.5;
        ctx.tufts.push({ x: bx, y: terrainAt(bx, bz), z: bz, w: 0.07 + rnd() * 0.07, h: reed ? 0.7 + rnd() * 0.5 : 0.2 + rnd() * 0.32, r: c.r, g: c.g, b: c.b });
      }
      i++;
    }
    // loose rocks
    for (let i = 0, t = 0; i < rule.rocks && t < rule.rocks * 30; t++) {
      const x = r.x0 + rnd() * (r.x1 - r.x0), z = r.z0 + rnd() * (r.z1 - r.z0), w = Wn(x, z);
      if (w < 1.6 || w > 26 || !owned(x, z) || !clear(x, z, 1.6)) continue;
      const s = 0.5 + rnd() * rnd() * 2.2;
      ctx.rocks.push({ x, y: terrainAt(x, z) - s * 0.3, z, sx: s, sy: s * (0.55 + rnd() * 0.5), sz: s * (0.8 + rnd() * 0.4), a: rnd() * 6.28 });
      i++;
    }
  }
  return spots;
}
/** split a list into square tiles so each can be frustum-culled on its own */
function tiles(list, size, fn) {
  const map = new Map();
  for (const it of list) {
    const k = Math.floor(it.x / size) + ',' + Math.floor(it.z / size);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  for (const [k, items] of map) {
    const [tx, tz] = k.split(',').map(Number);
    let y = 0;
    for (const it of items) y += it.y ?? terrainAt(it.x, it.z);
    fn(items, new THREE.Sphere(new THREE.Vector3((tx + 0.5) * size, y / items.length + 5, (tz + 0.5) * size), size * 0.9 + 12));
  }
}

/* ---------- the builder ---------- */
const ROCK_TONES = { valley: ['#7fa39b', '#62908c'], village: ['#8a9a8e', '#75897f'], forest: ['#6f8f78', '#5d8068', '#7f9a7a'], mountain: ['#8ca4a6', '#74909a'], fort: ['#8a8f8c', '#777d7c'], castle: ['#7d8794', '#6a7482'] };
let _rockGeo = null;

export function* buildZone(zone, Q) {
  const group = new THREE.Group();
  group.name = 'zone-' + zone.id;
  const ctx = {
    P: new Parts(), glow: new Parts(), cloth: clothBuffers(), sprites: [], lights: [], spin: [], gates: [], marks: [], rocks: [], stalks: [], tufts: [],
    Y: terrainAt, T: terrainAt, rnd: mulberry32(9000 + zone.index * 131), zone,
    W: (x, z) => { const g = NAV.GRIDS[zone.index]; return g.W[clamp(Math.round(z - g.z0), 0, g.nz - 1) * g.nx + clamp(Math.round(x - g.x0), 0, g.nx - 1)]; },
  };
  const solids = zoneSolids(zone);

  if (!zone.legacy) { group.add(terrainMesh(zone, Q.terrainStep)); yield; }
  waterMeshes(zone, group, ctx);
  yield;

  // architecture and props
  let n = 0;
  for (const s of zone.structures) {
    const b = BUILD[s.type];
    if (b) b(s, ctx);
    if (++n % 12 === 0) yield;
  }
  for (const s of zone.walk) {
    if (s.deck) bridge(s, ctx);
    else if (s.stairs) stairway(s, ctx);
  }
  yield;
  // falls pouring off cliffs
  for (const s of zone.structures) {
    if (s.type !== 'fall') continue;
    const h = s.top - s.bottom;
    for (const [dw, sp, al, st] of [[1, 0.55, 1.0, 1.6], [0.8, 0.8, 0.5, 2.4]]) {
      const m = new THREE.Mesh(fallGeometry(0, s.w * dw, s.top, s.bottom, 0.4, 2.6 + h * 0.06, 1.6), own(fallMaterial(sp, al, st, h / 12)));
      m.position.set(s.x, 0, s.z);
      m.rotation.y = s.rot;
      m.renderOrder = 6;
      group.add(m);
    }
    const fx = s.x + Math.sin(s.rot) * 3.4, fz = s.z + Math.cos(s.rot) * 3.4;
    for (let i = 0; i < 4; i++) ctx.sprites.push({ x: fx + (hash(i, 1) - 0.5) * 4, y: s.bottom + 1.5 + hash(i, 2) * 3, z: fz + (hash(i, 3) - 0.5) * 4, size: 7 + hash(i, 5) * 5, kind: 'cloud', aspect: 1.3 });
  }

  // planting and edges
  const edge = dressBoundary(zone, ctx, solids);
  if (edge) group.add(edge);
  yield;
  const spots = plant(zone, ctx, solids, Q);
  yield;

  // merge the kit into culling tiles
  const byTile = new Map();
  for (const p of ctx.P.list) {
    const k = Math.floor(p.cx / 56) + ',' + Math.floor(p.cz / 56);
    if (!byTile.has(k)) byTile.set(k, []);
    byTile.get(k).push(p);
  }
  for (const parts of byTile.values()) {
    const m = new THREE.Mesh(mergeKit(parts), kitMaterial());
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    yield;
  }
  if (ctx.glow.list.length) group.add(new THREE.Mesh(mergeKit(ctx.glow.list), glowMaterial()));
  if (ctx.cloth.idx.length) {
    const m = new THREE.Mesh(clothGeo(ctx.cloth), bannerMaterial());
    m.frustumCulled = false;
    group.add(m);
  }
  for (const m of ctx.marks) ctx.sprites.push({ x: m.x, y: m.y, z: m.z, size: 0.62, kind: 'spirit' });
  const sp = spriteMeshes(ctx.sprites);
  if (sp.hot) group.add(sp.hot);
  if (sp.soft) group.add(sp.soft);
  yield;

  // rocks
  if (ctx.rocks.length) {
    _rockGeo ??= [1, 2, 3].map((v) => shared(rockGeometry(v, 2)));
    const tones = ROCK_TONES[zone.ground.palette], dummy = new THREE.Object3D(), col = new THREE.Color();
    for (let v = 0; v < 3; v++) {
      const list = ctx.rocks.filter((_, i) => i % 3 === v);
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(_rockGeo[v], rockMaterial(), list.length);
      list.forEach((r, i) => {
        dummy.position.set(r.x, r.y, r.z);
        dummy.rotation.set(0, r.a, 0);
        dummy.scale.set(r.sx, r.sy, r.sz);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        im.setColorAt(i, col.set(tones[Math.floor(hash(r.x, r.z, 7) * tones.length)]));
      });
      im.castShadow = im.receiveShadow = true;
      group.add(im);
    }
  }
  // trees, bamboo, grass
  const treeGroup = new THREE.Group();
  treeSet(spots, ctx.rnd, treeGroup);
  treeGroup.traverse((o) => { if (o.isInstancedMesh) { o.frustumCulled = true; o.computeBoundingSphere(); o.boundingSphere.radius += 6; } });
  group.add(treeGroup);
  yield;
  tiles(ctx.stalks, 34, (items, bounds) => bambooSet(items, ctx.rnd, group, bounds));
  yield;
  tiles(ctx.tufts, 40, (items, bounds) => group.add(grassSet(items, bounds)));
  yield;

  // moving parts
  const spinners = ctx.spin.map((s) => {
    const m = new THREE.Mesh(mergeKit(s.parts), kitMaterial());
    m.position.set(s.x, s.y, s.z);
    m.rotation.order = 'YXZ';
    m.rotation.y = s.rot;
    m.castShadow = true;
    group.add(m);
    return { m, speed: s.speed };
  });
  const gates = new Map();
  for (const g of ctx.gates) {
    const geo = mergeKit(g.parts), leaves = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group(), m = new THREE.Mesh(geo, kitMaterial());
      pivot.position.set(g.x - Math.cos(g.rot) * sx * (g.w / 2) * -1, g.y, g.z + Math.sin(g.rot) * sx * (g.w / 2) * -1);
      pivot.rotation.y = g.rot;
      m.scale.x = -sx;
      m.castShadow = true;
      pivot.add(m);
      group.add(pivot);
      leaves.push({ pivot, sx });
    }
    gates.set(g.id, { ...g, leaves, k: g.open ? 1 : 0, target: g.open ? 1 : 0 });
  }
  const applyGate = (g) => { for (const l of g.leaves) l.pivot.rotation.y = g.rot + l.sx * g.k * 1.72; };
  for (const g of gates.values()) applyGate(g);

  group.updateMatrixWorld(true);

  return {
    zone, group, solids, lights: ctx.lights, marks: ctx.marks, gates,
    shafts: zone.structures.filter((s) => s.type === 'shafts'),
    pickups: zone.structures.filter((s) => s.type === 'pickup'),
    setGate(id, open, instant = false) {
      const g = gates.get(id);
      if (!g) return;
      g.target = open ? 1 : 0;
      if (instant) { g.k = g.target; applyGate(g); }
    },
    update(dt) {
      for (const s of spinners) s.m.rotation.x += s.speed * dt;
      for (const g of gates.values()) {
        if (g.k === g.target) continue;
        g.k = g.k < g.target ? Math.min(g.target, g.k + dt * 0.9) : Math.max(g.target, g.k - dt * 1.6);
        applyGate(g);
      }
    },
    dispose() {
      group.traverse((o) => {
        if (!o.isMesh) return;
        if (!o.geometry.userData.shared) o.geometry.dispose();
        if (o.material.userData.own) { o.material.userData.tex?.dispose(); o.material.dispose(); }
        if (o.isInstancedMesh) o.dispose();
      });
      group.parent?.remove(group);
    },
  };
}
export { PAL, boxG, cylG };
