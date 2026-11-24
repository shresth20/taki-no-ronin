import * as THREE from 'three';
import { mulberry32, getToonRamp, sharedUniforms, patchMaterial, GLSL_PAINT, mergeColored, fbm, smoothstep, lerp, clamp } from '../core/util.js';
import { heightAt, slopeAt, riverDistAt, riverHalfWidth, cliffZ, ARENA, pathDist, inArena, PLAY } from './terrain.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---------- small canvas textures for foliage cards ---------- */
function clusterTexture(kind) {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const r = mulberry32(kind.length * 31 + 5);
  ctx.translate(s / 2, s / 2);
  const n = kind === 'needle' ? 46 : kind === 'bamboo' ? 9 : 16;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.33;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const v = Math.round(200 + r() * 55);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r() * Math.PI * 2);
    if (kind === 'blossom') {
      const pr = s * (0.07 + r() * 0.035);
      for (let k = 0; k < 5; k++) {
        ctx.rotate((Math.PI * 2) / 5);
        ctx.beginPath();
        ctx.ellipse(0, pr * 0.8, pr * 0.55, pr * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 'needle') {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, s * (0.16 + r() * 0.12));
      ctx.stroke();
    } else if (kind === 'bamboo') {
      const l = s * (0.3 + r() * 0.14), w = s * 0.06;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(w, l * 0.4, 0, l);
      ctx.quadraticCurveTo(-w, l * 0.4, 0, 0);
      ctx.fill();
    } else {
      const l = s * (0.13 + r() * 0.07);
      ctx.beginPath();
      ctx.moveTo(0, -l);
      ctx.quadraticCurveTo(l * 0.75, 0, 0, l);
      ctx.quadraticCurveTo(-l * 0.75, 0, 0, -l);
      ctx.fill();
    }
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* ---------- "fluffy" foliage: camera-facing cards with spherical normals ---------- */
function fluffMaterial(map, { emissive = 0x000000, sway = 1, flutter = 0.25 } = {}) {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('soft'), map, alphaTest: 0.42, emissive, emissiveIntensity: 1 });
  mat.customProgramCacheKey = () => 'fluff' + sway + flutter;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWind = sharedUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aOff;\nuniform float uTime; uniform vec4 uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float hh = max(transformed.y, 0.0);
          float ph = uTime * 1.3 + transformed.x * 0.35 + transformed.z * 0.3;
          transformed.xz += uWind.xy * (sin(ph) * 0.5 + sin(ph * 2.3) * 0.2) * 0.022 * hh * uWind.z * ${sway.toFixed(2)};
        }`
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
        float fScale = 1.0;
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          fScale = length(instanceMatrix[0].xyz);
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        {
          float rot = aOff.z * 6.283 + sin(uTime * (1.1 + aOff.z) + aOff.z * 40.0) * ${flutter.toFixed(2)} * uWind.z;
          float cr = cos(rot), sr = sin(rot);
          vec2 o = mat2(cr, -sr, sr, cr) * aOff.xy;
          mvPosition.xy += o * fScale;
        }
        gl_Position = projectionMatrix * mvPosition;`
      );
  };
  return mat;
}
/** cards: [{c:Vector3, n:Vector3, size, color:Color}] */
function fluffGeometry(cards, rnd) {
  const n = cards.length;
  const pos = new Float32Array(n * 12), nrm = new Float32Array(n * 12), col = new Float32Array(n * 12), off = new Float32Array(n * 12), uv = new Float32Array(n * 8);
  const idx = new Uint32Array(n * 6);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  cards.forEach((q, i) => {
    const seed = rnd();
    for (let k = 0; k < 4; k++) {
      const o = (i * 4 + k) * 3;
      pos.set([q.c.x, q.c.y, q.c.z], o);
      nrm.set([q.n.x, q.n.y, q.n.z], o);
      col.set([q.color.r, q.color.g, q.color.b], o);
      off.set([corners[k][0] * q.size * 0.5, corners[k][1] * q.size * 0.5, seed], o);
      uv.set([corners[k][0] * 0.5 + 0.5, corners[k][1] * 0.5 + 0.5], (i * 4 + k) * 2);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aOff', new THREE.BufferAttribute(off, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/* ---------- tapered branch tube ---------- */
function taperedTube(pts, r0, r1, segs = 5, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, c = curve.getPointAt(t), rad = lerp(r0, r1, t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const nx = Math.cos(a) * frames.normals[i].x + Math.sin(a) * frames.binormals[i].x;
      const ny = Math.cos(a) * frames.normals[i].y + Math.sin(a) * frames.binormals[i].y;
      const nz = Math.cos(a) * frames.normals[i].z + Math.sin(a) * frames.binormals[i].z;
      pos.push(c.x + nx * rad, c.y + ny * rad, c.z + nz * rad);
      nrm.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/* ---------- procedural tree: trunk tubes + solid toon blobs + fluffy cards ---------- */
function genTree(seed, o) {
  const r = mulberry32(seed);
  const branches = [], blobs = [];
  const lean = (r() - 0.5) * 1.4;
  const top = V3(lean * 0.7, o.trunkH, (r() - 0.5) * 0.9);
  const trunkPts = o.twisty
    ? [V3(0, -0.4, 0), V3(lean * 0.9, o.trunkH * 0.35, 0.4), V3(-lean * 0.5, o.trunkH * 0.7, -0.3), top]
    : [V3(0, -0.4, 0), V3(lean * 0.2, o.trunkH * 0.5, 0.12), top];
  branches.push({ pts: trunkPts, r0: o.trunkR, r1: o.trunkR * 0.6, segs: 6 });
  const nb = o.branches + Math.floor(r() * 2);
  for (let b = 0; b < nb; b++) {
    const ang = (b / nb) * Math.PI * 2 + r() * 0.9;
    const len = o.branchLen * (0.75 + r() * 0.5), up = o.up + r() * 0.35;
    const end = V3(top.x + Math.cos(ang) * len, top.y + len * up, top.z + Math.sin(ang) * len);
    const mid = top.clone().lerp(end, 0.5).add(V3((r() - 0.5) * 0.5, len * 0.14, (r() - 0.5) * 0.5));
    branches.push({ pts: [top.clone(), mid, end], r0: o.trunkR * 0.5, r1: o.trunkR * 0.14, segs: 4 });
    blobs.push({ c: end, r: o.blobR * (0.8 + r() * 0.45) });
    blobs.push({ c: mid.clone().lerp(end, 0.45).add(V3((r() - 0.5) * 0.8, 0.5 + r() * 0.5, (r() - 0.5) * 0.8)), r: o.blobR * (0.65 + r() * 0.4) });
    for (let s2 = 0; s2 < 2; s2++) {
      const a2 = ang + (r() - 0.5) * 1.9, l2 = len * (0.5 + r() * 0.25);
      const e2 = V3(mid.x + Math.cos(a2) * l2, mid.y + l2 * (up * 0.6 + r() * 0.3), mid.z + Math.sin(a2) * l2);
      branches.push({ pts: [mid.clone(), mid.clone().lerp(e2, 0.5).add(V3(0, 0.18, 0)), e2], r0: o.trunkR * 0.24, r1: 0.035, segs: 3 });
      blobs.push({ c: e2, r: o.blobR * (0.6 + r() * 0.45) });
    }
  }
  blobs.push({ c: V3(top.x, top.y + o.branchLen * (0.55 + o.up * 0.6), top.z), r: o.blobR * 1.12 });
  const center = V3(top.x, top.y + o.branchLen * 0.55, top.z);

  const trunk = mergeColored(branches.map((b) => ({ geometry: taperedTube(b.pts, b.r0, b.r1, b.segs, 6), color: o.bark })));
  const cols = o.palette.map((h) => new THREE.Color(h));
  const blobParts = blobs.map((b) => {
    const g = new THREE.IcosahedronGeometry(b.r * 0.86, 1);
    const p = g.attributes.position, n = g.attributes.normal;
    const col = cols[Math.floor(r() * cols.length)].clone().multiplyScalar(0.86);
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (fbm(p.getX(i) * 1.3 + b.c.x, p.getY(i) * 1.3 + p.getZ(i), 2) - 0.5) * 0.5;
      p.setXYZ(i, p.getX(i) * k + b.c.x, p.getY(i) * k * o.flat + b.c.y, p.getZ(i) * k + b.c.z);
      const v = V3(p.getX(i), p.getY(i), p.getZ(i)).sub(center).normalize().lerp(V3(n.getX(i), n.getY(i), n.getZ(i)), 0.5).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    return { geometry: g, color: col };
  });
  const blob = mergeColored(blobParts);
  const cards = [];
  for (const b of blobs) {
    const k = Math.round(o.cards * (b.r / o.blobR) ** 2);
    for (let i = 0; i < k; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const d = V3(Math.cos(a) * s, u * 0.9 + 0.12, Math.sin(a) * s).normalize();
      const c = V3(b.c.x + d.x * b.r * 0.92, b.c.y + d.y * b.r * 0.92 * o.flat, b.c.z + d.z * b.r * 0.92);
      const n = c.clone().sub(center).normalize().lerp(d, 0.6).normalize();
      const col = cols[Math.floor(r() * cols.length)].clone().multiplyScalar(0.92 + r() * 0.18);
      cards.push({ c, n, size: b.r * (0.75 + r() * 0.5) * o.cardSize, color: col });
    }
  }
  return { trunk, blob, fluff: fluffGeometry(cards, r) };
}

const SPECIES = {
  sakura: { trunkH: 2.5, trunkR: 0.36, branches: 3, branchLen: 3.3, up: 0.42, blobR: 1.55, flat: 0.78, cards: 26, cardSize: 1.0, bark: '#4b3936', palette: ['#ffc2d8', '#ff9fc4', '#ffe4ee', '#ffb3cf', '#f786ad'], tex: 'blossom', emissive: 0x4a1f30 },
  maple: { trunkH: 3.0, trunkR: 0.34, branches: 3, branchLen: 3.0, up: 0.55, blobR: 1.5, flat: 0.82, cards: 24, cardSize: 1.0, bark: '#3f3531', palette: ['#f0b83c', '#e8982e', '#f7d35a', '#d97a2a', '#c9c24a'], tex: 'leaf', emissive: 0x3a2608 },
  green: { trunkH: 3.4, trunkR: 0.4, branches: 3, branchLen: 3.4, up: 0.6, blobR: 1.7, flat: 0.85, cards: 24, cardSize: 1.0, bark: '#3b3a33', palette: ['#5fa33f', '#3f8a3c', '#86b84a', '#2f7440', '#a3c552'], tex: 'leaf', emissive: 0x10240c },
  pine: { trunkH: 2.6, trunkR: 0.3, branches: 3, branchLen: 2.5, up: 0.12, blobR: 1.35, flat: 0.36, cards: 30, cardSize: 0.85, bark: '#3a2f2c', palette: ['#2f6f4a', '#3f8552', '#24583f', '#56924f'], tex: 'needle', emissive: 0x06160e, twisty: true },
};

/** returns { group, colliders:[{x,z,r}] } */
export function createTrees(rocksForPines = []) {
  const group = new THREE.Group();
  group.name = 'trees';
  const rnd = mulberry32(31337);
  const colliders = [];
  const spots = { sakura: [], maple: [], green: [], pine: [] };

  // hand-placed hero trees framing the arena and the falls
  const hero = [
    ['sakura', -27, -9, 1.35], ['sakura', -30, 9, 1.2], ['sakura', -22, 25, 1.25], ['sakura', -2, 27, 1.15], ['sakura', 19, -6, 1.3],
    ['sakura', 21, 14, 1.2], ['sakura', -17, -18, 1.25], ['sakura', 14, -24, 1.1], ['maple', -33, -1, 1.2], ['maple', -9, 30, 1.1],
    ['maple', 23, 3, 1.15], ['sakura', -34, 20, 1.3], ['green', -37, 8, 1.3], ['green', 26, 24, 1.3], ['sakura', 9, 34, 1.2],
  ];
  for (const [k, x, z, s] of hero) spots[k].push({ x, z, s, a: rnd() * 6.28 });
  // scattered forest on the valley floor and slopes
  let tries = 0;
  const all = () => spots.sakura.length + spots.maple.length + spots.green.length;
  while (all() < 118 && tries++ < 6000) {
    const a = rnd() * Math.PI * 2, d = ARENA.r + 9 + Math.pow(rnd(), 0.8) * 78;
    const x = ARENA.x + Math.cos(a) * d, z = ARENA.z + Math.sin(a) * d;
    if (Math.abs(x) > 122 || Math.abs(z) > 122) continue;
    const h = heightAt(x, z);
    if (h < 0.6 || slopeAt(x, z) > 0.75 || z < cliffZ(x) + 5 || riverDistAt(x, z) < riverHalfWidth(z) + 4) continue;
    if (pathDist(x, z) < 3) continue;
    let ok = true;
    for (const k in spots) for (const s of spots[k]) if ((s.x - x) ** 2 + (s.z - z) ** 2 < 30) ok = false;
    if (!ok) continue;
    const pick = rnd();
    const k = d < 34 ? (pick < 0.55 ? 'sakura' : pick < 0.8 ? 'maple' : 'green') : pick < 0.28 ? 'sakura' : pick < 0.5 ? 'maple' : 'green';
    spots[k].push({ x, z, s: 1.0 + rnd() * 0.55 + (d > 40 ? 0.3 : 0), a: rnd() * 6.28 });
  }
  // trees on the plateau above the falls
  for (let i = 0; i < 26; i++) {
    const x = -85 + rnd() * 170;
    if (Math.abs(x) < 9) continue;
    const z = cliffZ(x) - 12 - rnd() * 22;
    spots[rnd() < 0.5 ? 'green' : rnd() < 0.6 ? 'maple' : 'sakura'].push({ x, z, s: 1.3 + rnd() * 0.6, a: rnd() * 6.28 });
  }
  // pines cling to rocks and ledges
  for (const r of rocksForPines) spots.pine.push({ x: r.x, z: r.z, y: r.y, s: r.s, a: rnd() * 6.28 });

  const trunkMat = patchMaterial(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('soft') }), {
    key: 'trunk',
    fHead: GLSL_PAINT,
    fColor: 'diffuseColor.rgb *= 0.75 + 0.5 * paintTri(vWPos, vWNrm, 0.35);',
  });
  const blobMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('soft') });
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  for (const kind in spots) {
    const sp = SPECIES[kind], list = spots[kind];
    if (!list.length) continue;
    const fmat = fluffMaterial(clusterTexture(sp.tex), { emissive: sp.emissive, sway: kind === 'pine' ? 0.5 : 1 });
    const variants = kind === 'pine' ? 2 : 3;
    for (let v = 0; v < variants; v++) {
      const sub = list.filter((_, i) => i % variants === v);
      if (!sub.length) continue;
      const t = genTree(1000 + v * 77 + kind.length * 13, sp);
      const mk = (geo, mat, cast) => {
        const im = new THREE.InstancedMesh(geo, mat, sub.length);
        im.castShadow = cast;
        im.receiveShadow = !cast;
        im.frustumCulled = false;
        return im;
      };
      const a = mk(t.trunk, trunkMat, true), b = mk(t.blob, blobMat, true), c = mk(t.fluff, fmat, false);
      b.receiveShadow = true;
      sub.forEach((s, i) => {
        const y = s.y ?? heightAt(s.x, s.z);
        dummy.position.set(s.x, y - 0.1, s.z);
        dummy.rotation.set(0, s.a, 0);
        dummy.scale.setScalar(s.s);
        dummy.updateMatrix();
        a.setMatrixAt(i, dummy.matrix);
        b.setMatrixAt(i, dummy.matrix);
        c.setMatrixAt(i, dummy.matrix);
        const k = 0.9 + rnd() * 0.2;
        tint.setRGB(k, 0.92 + rnd() * 0.12, k);
        b.setColorAt(i, tint);
        c.setColorAt(i, tint);
        if (kind !== 'pine' && Math.hypot(s.x - PLAY.x, s.z - PLAY.z) < PLAY.r + 8) colliders.push({ x: s.x, z: s.z, r: sp.trunkR * s.s * 1.25 });
      });
      group.add(a, b, c);
    }
  }
  return { group, colliders, blossomTrees: spots.sakura };
}

/* ---------- bamboo groves ---------- */
export function createBamboo() {
  const group = new THREE.Group();
  group.name = 'bamboo';
  const rnd = mulberry32(8080);
  const stalks = [];
  const clumps = [[-36, 14, 9, 46], [-33, -12, 7, 30], [-24, 32, 8, 40], [-5, 38, 6, 26], [24, 30, 7, 28], [27, -12, 6, 24], [-42, 0, 7, 26]];
  for (const [cx, cz, cr, n] of clumps) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, d = Math.sqrt(rnd()) * cr;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (inArena(x, z, 2.5) || heightAt(x, z) < 0.5 || pathDist(x, z) < 2) continue;
      stalks.push({ x, z, h: 8 + rnd() * 5, a: rnd() * 6.28, w: 0.8 + rnd() * 0.5 });
    }
  }
  const sg = new THREE.CylinderGeometry(0.055, 0.085, 1, 6, 8, true);
  sg.translate(0, 0.5, 0);
  const windLocal = `
    {
      vec4 root = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float ph = uTime * 0.9 + root.x * 0.21 + root.z * 0.17;
      float g = texture2D(uNoise, root.xz * 0.012 + uTime * 0.02).r - 0.35;
      vec3 w = vec3(uWind.x, 0.0, uWind.y) * (sin(ph) * 0.35 + g * 1.2) * uWind.z * 0.55 * HH * HH;
      vec3 c0 = instanceMatrix[0].xyz, c2 = instanceMatrix[2].xyz;
      transformed.x += dot(c0, w) / dot(c0, c0);
      transformed.z += dot(c2, w) / dot(c2, c2);
    }`;
  const stalkMat = patchMaterial(new THREE.MeshToonMaterial({ color: '#8fb04a', gradientMap: getToonRamp('soft') }), {
    key: 'bambooStalk',
    vHead: 'varying float vH;',
    vBegin: 'vH = position.y;\n#define HH position.y\n' + windLocal,
    fHead: 'varying float vH;',
    fColor: 'float node = smoothstep(0.035, 0.0, abs(fract(vH * 13.0) - 0.5)); diffuseColor.rgb *= mix(1.0, 0.55, node) * mix(0.8, 1.12, vH);',
  });
  const sm = new THREE.InstancedMesh(sg, stalkMat, stalks.length);
  sm.castShadow = true;
  sm.frustumCulled = false;
  // leaves: cards in the top half of a unit-height stalk
  const cards = [];
  const lc = ['#7fb043', '#a4c64f', '#5f9a3d', '#c3d05a'].map((h) => new THREE.Color(h));
  for (let i = 0; i < 26; i++) {
    const y = 0.42 + Math.pow(rnd(), 0.7) * 0.6, a = rnd() * 6.28, d = 0.25 + rnd() * 0.75 * (1.2 - y * 0.5);
    const c = V3(Math.cos(a) * d, y, Math.sin(a) * d);
    cards.push({ c, n: V3(c.x, 0.8, c.z).normalize(), size: 1.2 + rnd() * 0.9, color: lc[Math.floor(rnd() * lc.length)] });
  }
  const lg = fluffGeometry(cards, rnd);
  const leafMat = fluffMaterial(clusterTexture('bamboo'), { emissive: 0x12240a, sway: 0, flutter: 0.35 });
  // leaves must follow the stalk sway: same wind formula on the card centres
  const base = leafMat.onBeforeCompile;
  leafMat.customProgramCacheKey = () => 'bambooLeaf';
  leafMat.onBeforeCompile = (shader) => {
    base(shader);
    shader.uniforms.uNoise = sharedUniforms.uNoise;
    shader.vertexShader = shader.vertexShader
      .replace('uniform float uTime;', 'uniform float uTime; uniform sampler2D uNoise;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#define HH position.y\n' + windLocal);
  };
  const lm = new THREE.InstancedMesh(lg, leafMat, stalks.length);
  lm.frustumCulled = false;
  const dummy = new THREE.Object3D();
  stalks.forEach((s, i) => {
    dummy.position.set(s.x, heightAt(s.x, s.z) - 0.2, s.z);
    dummy.rotation.set((rnd() - 0.5) * 0.08, s.a, (rnd() - 0.5) * 0.08);
    dummy.scale.set(s.w, s.h, s.w);
    dummy.updateMatrix();
    sm.setMatrixAt(i, dummy.matrix);
    dummy.scale.set(s.w * 1.5, s.h, s.w * 1.5);
    dummy.updateMatrix();
    lm.setMatrixAt(i, dummy.matrix);
  });
  group.add(sm, lm);
  return group;
}

/* ---------- grass + wildflowers ---------- */
export function createGrass(count) {
  const rnd = mulberry32(555);
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.34, 0.5, 0, 0.34, 0.5, 0, 0, 1, 0], 3));
  blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), {
    key: 'grass',
    vHead: 'varying float vH;',
    vBegin: `
      vH = position.y;
      {
        vec4 root = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float gust = texture2D(uNoise, root.xz * 0.018 - uTime * 0.035 * uWind.xy).r - 0.38;
        float fl = sin(uTime * 3.1 + root.x * 1.7 + root.z * 2.3) * 0.07;
        vec2 bend = uWind.xy * (gust * 0.9 + fl) * uWind.z * 0.5;
        vec2 dp = root.xz - uPlayerPos.xz; float dl = length(dp);
        bend += (dp / (dl + 0.01)) * smoothstep(1.3, 0.25, dl) * 0.75;
        vec3 w = vec3(bend.x, -dot(bend, bend) * 0.35, bend.y) * vH * vH;
        vec3 c0 = instanceMatrix[0].xyz, c1 = instanceMatrix[1].xyz, c2 = instanceMatrix[2].xyz;
        transformed += vec3(dot(c0, w) / dot(c0, c0), dot(c1, w) / dot(c1, c1), dot(c2, w) / dot(c2, c2)) * length(c1);
      }`,
    fHead: 'varying float vH;',
    fColor: 'diffuseColor.rgb *= mix(0.55, 1.2, vH); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.2, 0.8), smoothstep(0.7, 1.0, vH) * 0.4);',
  });
  const mesh = new THREE.InstancedMesh(blade, mat, count);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.layers.set(1);
  mesh.name = 'grass';
  const dummy = new THREE.Object3D(), c = new THREE.Color();
  const cA = new THREE.Color('#7fc043'), cB = new THREE.Color('#3f9a48'), cG = new THREE.Color('#cdbf4c'), cR = new THREE.Color('#6fa45a');
  let n = 0, tries = 0;
  const flowers = [];
  while (n < count && tries++ < count * 6) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 56;
    const x = ARENA.x + 4 + Math.cos(a) * d, z = ARENA.z + Math.sin(a) * d;
    const h = heightAt(x, z);
    if (h < 0.07 || z < cliffZ(x) + 2.5) continue;
    if (Math.hypot(x - 1.8, z + 9.1) < 3.2) continue; // keep the view of the meditation stone clear
    if (slopeAt(x, z) > 0.7) continue;
    const pd = pathDist(x, z);
    if (pd < 0.7 + rnd() * 0.8) continue;
    const dens = 1 - smoothstep(30, 56, d) * 0.72;
    if (rnd() > dens) continue;
    const ac = Math.hypot(x - ARENA.x, z - ARENA.z);
    const n1 = fbm(x * 0.06 + 3, z * 0.06 + 7, 3), n2 = fbm(x * 0.021 + 30, z * 0.021 + 11, 3), patch = fbm(x * 0.25, z * 0.25, 2);
    let hgt = lerp(0.17, 0.3, rnd()) + smoothstep(14, 23, ac) * (0.25 + rnd() * 0.4) + smoothstep(0.55, 0.75, patch) * smoothstep(10, 20, ac) * 0.25;
    if (h < 0.45) hgt = 0.55 + rnd() * 0.6; // reeds at the waterline
    dummy.position.set(x, h - 0.03, z);
    dummy.rotation.set(0, rnd() * Math.PI, 0);
    dummy.scale.set(0.07 + rnd() * 0.07, hgt, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(n, dummy.matrix);
    c.copy(cA).lerp(cB, smoothstep(0.35, 0.7, n1)).lerp(cG, smoothstep(0.58, 0.74, n2) * 0.65);
    if (h < 0.45) c.lerp(cR, 0.7);
    c.multiplyScalar(0.85 + rnd() * 0.3);
    mesh.setColorAt(n, c);
    n++;
    if (flowers.length < 1500 && ac < 34 && h > 0.5 && pd > 1.6 && patch > 0.52 && rnd() < 0.09) flowers.push({ x, z, h, hgt });
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;

  // wildflowers as tiny fluff cards
  const fc = ['#ffffff', '#fff3a8', '#ffd1e6', '#c9b6ff', '#fff8dc'].map((h) => new THREE.Color(h));
  const cards = flowers.map((f) => ({ c: V3(f.x, f.h + f.hgt * 0.75 + 0.05, f.z), n: V3(0, 1, 0), size: 0.13 + rnd() * 0.1, color: fc[Math.floor(rnd() * fc.length)] }));
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const dctx = dot.getContext('2d');
  dctx.fillStyle = '#fff';
  for (let k = 0; k < 5; k++) {
    dctx.beginPath();
    dctx.ellipse(16 + Math.cos((k / 5) * 6.283) * 7, 16 + Math.sin((k / 5) * 6.283) * 7, 6, 6, 0, 0, 6.283);
    dctx.fill();
  }
  const ftex = new THREE.CanvasTexture(dot);
  const fmat = fluffMaterial(ftex, { emissive: 0x554433, sway: 0, flutter: 0.2 });
  fmat.customProgramCacheKey = () => 'flowers';
  const fm = new THREE.Mesh(fluffGeometry(cards, rnd), fmat);
  fm.frustumCulled = false;
  fm.layers.set(1);
  const group = new THREE.Group();
  group.add(mesh, fm);
  group.name = 'grassGroup';
  return group;
}
export { clamp };
