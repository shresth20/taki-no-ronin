import * as THREE from 'three';
import { getToonRamp, sharedUniforms, M4 } from '../core/util.js';

/* Procedural character: one skinned mesh built from primitives (rigid-bound parts, vertex colours),
   an inverted-hull outline sharing the skeleton, and separate weapon meshes.                        */

export const DIM = { upper: 0.28, fore: 0.26, thigh: 0.42, shin: 0.42, ankle: 0.09, hipsY: 0.98 };
const BONE_DEF = [
  // name, parent, x, y, z (model-space bind position)
  ['hips', null, 0, 0.98, 0],
  ['spine', 'hips', 0, 1.1, 0],
  ['chest', 'spine', 0, 1.27, 0],
  ['neck', 'chest', 0, 1.49, 0],
  ['head', 'neck', 0, 1.57, 0],
  ['lUpper', 'chest', 0.19, 1.44, 0],
  ['lFore', 'lUpper', 0.19, 1.16, 0],
  ['lHand', 'lFore', 0.19, 0.9, 0],
  ['rUpper', 'chest', -0.19, 1.44, 0],
  ['rFore', 'rUpper', -0.19, 1.16, 0],
  ['rHand', 'rFore', -0.19, 0.9, 0],
  ['lThigh', 'hips', 0.095, 0.93, 0],
  ['lShin', 'lThigh', 0.095, 0.51, 0],
  ['lFoot', 'lShin', 0.095, 0.09, 0],
  ['rThigh', 'hips', -0.095, 0.93, 0],
  ['rShin', 'rThigh', -0.095, 0.51, 0],
  ['rFoot', 'rShin', -0.095, 0.09, 0],
  ['browL', 'head', 0.043, 1.682, 0.1],
  ['browR', 'head', -0.043, 1.682, 0.1],
  ['lidL', 'head', 0.043, 1.652, 0.105],
  ['lidR', 'head', -0.043, 1.652, 0.105],
];
export const BIND = Object.fromEntries(BONE_DEF.map(([n, , x, y, z]) => [n, new THREE.Vector3(x, y, z)]));

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, n, 1, open);
const sph = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
const cone = (r, h, n = 6) => new THREE.ConeGeometry(r, h, n);
const C = (h) => new THREE.Color(h);

export const PALETTES = {
  ronin: { skin: '#f3cba8', hair: '#1d1b26', gi: '#2c3f78', trim: '#f1ecdc', haori: '#efe9d8', hakama: '#22283c', obi: '#b8232c', armor: '#1c2030', gold: '#e0b04a', scarf: '#cf2530', sock: '#ebe6dc', sole: '#5a3d28', eye: '#3a2a22' },
  bandit: { skin: '#d9b18f', hair: '#16151a', gi: '#33323c', trim: '#8c8a92', haori: '#2a2930', hakama: '#1d1e25', obi: '#7c2326', armor: '#33262a', gold: '#8f7d57', scarf: '#5b2226', sock: '#2a2a30', sole: '#33261d', eye: '#ff3b2b', straw: '#c8a765' },
  spear: { skin: '#d9b18f', hair: '#16151a', gi: '#3b3340', trim: '#9a94a0', haori: '#2e2a33', hakama: '#22202a', obi: '#8a6a2a', armor: '#2b2e3a', gold: '#b99a4c', scarf: '#3a2a4a', sock: '#2a2a30', sole: '#33261d', eye: '#ff7a2b', straw: '#c8a765' },
  elite: { skin: '#d2a888', hair: '#101014', gi: '#23242c', trim: '#b22c2c', haori: '#1a1b22', hakama: '#17181e', obi: '#b22c2c', armor: '#3c1519', gold: '#c9a34a', scarf: '#7c1d20', sock: '#1c1c22', sole: '#2a1e18', eye: '#ff5a2b', straw: '#3a3336' },
  monk: { skin: '#cfa27e', hair: '#101014', gi: '#b9772a', trim: '#e6d6a8', haori: '#2b2622', hakama: '#5a3a22', obi: '#2b2622', armor: '#3a342c', gold: '#d9b150', scarf: '#8a2a1a', sock: '#e6dcc8', sole: '#4a3626', eye: '#9fe8ff', straw: '#c8a765' },
  lord: { skin: '#c39a7c', hair: '#0c0c10', gi: '#16161c', trim: '#e6bb55', haori: '#5a0f14', hakama: '#101014', obi: '#e6bb55', armor: '#17171d', gold: '#f2cf6a', scarf: '#8e1c22', sock: '#141418', sole: '#22181a', eye: '#ff2a2a', straw: '#c8a765' },
  captain: { skin: '#c9a184', hair: '#101014', gi: '#2a1c22', trim: '#c9a34a', haori: '#3a1216', hakama: '#1c1418', obi: '#c9a34a', armor: '#8e1c22', gold: '#e6bb55', scarf: '#1a1a22', sock: '#1c1c22', sole: '#2a1e18', eye: '#ffd23b', straw: '#c8a765' },
};

function hakamaLeg(rt, rb, h, base) {
  // pleated trouser leg: stripes baked into vertex colours
  const g = cyl(rt, rb, h, 14, false);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const b = C(base);
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const k = 0.84 + 0.2 * (Math.sin(a * 7) > 0 ? 1 : 0);
    col.set([b.r * k, b.g * k, b.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** returns the part list for a humanoid in bind pose */
function buildParts(P, o) {
  const parts = [];
  const add = (bone, geometry, matrix, color) => parts.push({ bone, geometry, matrix, color });
  const armor = o.armorColor ?? P.armor;

  // pelvis + trousers
  add('hips', sph(0.165), M4(0, 0.965, 0, 0, 0, 0, 1.02, 0.8, 0.82), P.hakama);
  add('hips', box(0.3, 0.09, 0.2), M4(0, 1.035, 0), P.hakama);
  add('spine', cyl(0.158, 0.162, 0.1, 14), M4(0, 1.1, 0, 0, 0, 0, 1, 1, 0.8), P.obi);
  add('spine', box(0.07, 0.07, 0.05), M4(0.05, 1.1, 0.125, 0, 0, 0.5), P.obi);
  add('spine', cyl(0.15, 0.156, 0.14, 12), M4(0, 1.165, 0, 0, 0, 0, 1, 1, 0.78), P.gi);
  // torso
  add('chest', cyl(0.186, 0.152, 0.27, 12), M4(0, 1.345, 0, 0, 0, 0, 1, 1, 0.72), P.gi);
  add('chest', new THREE.CapsuleGeometry(0.076, 0.27, 4, 10), M4(0, 1.452, 0, 0, 0, Math.PI / 2, 1, 1, 0.95), P.gi);
  for (const s of [-1, 1]) add('chest', box(0.042, 0.25, 0.02), M4(s * 0.047, 1.395, 0.128, 0.08, 0, s * 0.4), P.trim); // collar
  if (o.haori) {
    // open-fronted coat: a shell round the torso and a flared skirt over the hips
    const shell = (rt, rb, h, gap) => new THREE.CylinderGeometry(rt, rb, h, 16, 1, true, gap / 2, Math.PI * 2 - gap);
    add('chest', shell(0.206, 0.178, 0.37, 0.95), M4(0, 1.335, 0, 0, 0, 0, 1, 1, 0.76), P.haori);
    add('hips', shell(0.192, 0.262, 0.3, 1.3), M4(0, 0.9, 0, 0, 0, 0, 1, 1, 0.82), P.haori);
    add('hips', shell(0.264, 0.27, 0.036, 1.3), M4(0, 0.748, 0, 0, 0, 0, 1, 1, 0.82), P.gi);
    for (const s of [-1, 1]) {
      add('chest', box(0.034, 0.37, 0.022), M4(s * 0.097, 1.335, 0.139, 0, s * 0.45, 0), P.gi); // lapel trim
      add('chest', box(0.15, 0.036, 0.27), M4(s * 0.2, 1.512, 0, 0, 0, s * -0.12), P.haori); // shoulder wings
      add('chest', box(0.15, 0.012, 0.274), M4(s * 0.272, 1.498, 0, 0, 0, s * -0.12), P.gi);
    }
    add('chest', cyl(0.043, 0.043, 0.008, 12), M4(0, 1.405, -0.158, Math.PI / 2, 0, 0), P.obi); // crest
    add('chest', cyl(0.027, 0.027, 0.01, 12), M4(0, 1.405, -0.159, Math.PI / 2, 0, 0), P.haori);
  }
  if (o.cuirass) {
    add('chest', cyl(0.2, 0.172, 0.3, 10), M4(0, 1.33, 0.005, 0, 0, 0, 1, 1, 0.8), armor);
    add('chest', box(0.3, 0.03, 0.05), M4(0, 1.47, 0.13), P.gold);
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      add('hips', box(0.13, 0.2, 0.03), M4(Math.sin(a) * 0.19, 0.9, Math.cos(a) * 0.15, 0.12, a, 0), armor); // tassets
      add('hips', box(0.13, 0.02, 0.034), M4(Math.sin(a) * 0.19, 0.81, Math.cos(a) * 0.155, 0.12, a, 0), P.gold);
    }
  }
  if (o.sode) {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        add('chest', box(0.035, 0.075, 0.19 - i * 0.012), M4(s * (0.262 + i * 0.016), 1.455 - i * 0.066, 0, 0, 0, s * (0.22 + i * 0.12)), armor);
        add('chest', box(0.037, 0.012, 0.194 - i * 0.012), M4(s * (0.27 + i * 0.019), 1.424 - i * 0.066, 0, 0, 0, s * (0.22 + i * 0.12)), P.gold);
      }
    }
  }
  // neck + scarf
  add('neck', cyl(0.05, 0.056, 0.1, 8), M4(0, 1.525, 0), P.skin);
  if (o.scarf) add('chest', new THREE.TorusGeometry(0.086, 0.042, 6, 14), M4(0, 1.5, 0.005, Math.PI / 2 + 0.12, 0, 0, 1, 1.15, 1), P.scarf);

  // head
  add('head', sph(0.118, 14, 10), M4(0, 1.656, 0.004, 0, 0, 0, 0.93, 1.08, 0.98), P.skin);
  add('head', sph(0.086, 12, 8), M4(0, 1.59, 0.02, 0, 0, 0, 0.86, 0.92, 0.92), P.skin);
  for (const s of [-1, 1]) add('head', sph(0.022, 6, 5), M4(s * 0.11, 1.648, 0), P.skin);
  if (o.hair) {
    add('head', new THREE.SphereGeometry(0.128, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), M4(0, 1.668, -0.01, -0.3, 0, 0, 0.97, 1.08, 1.03), P.hair);
    add('head', sph(0.112, 12, 8), M4(0, 1.636, -0.04, 0, 0, 0, 1.0, 1.02, 0.9), P.hair);
    // bangs, side locks, back spikes
    [[-0.07, 0.5, 0.2], [-0.03, 0.2, 0.12], [0.015, -0.15, 0.1], [0.06, -0.45, 0.2], [0.095, -0.7, 0.42]].forEach(([x, rz, rx]) =>
      add('head', cone(0.03, 0.13, 5), M4(x, 1.722, 0.098, Math.PI + rx, 0, rz), P.hair)
    );
    for (const s of [-1, 1]) add('head', cone(0.024, 0.2, 5), M4(s * 0.108, 1.63, 0.035, Math.PI - 0.05, 0, s * 0.08), P.hair);
    [[0, 1.74, -0.1, -1.1, 0], [-0.07, 1.7, -0.1, -1.3, 0.5], [0.07, 1.7, -0.1, -1.3, -0.5], [0, 1.66, -0.13, -1.9, 0], [-0.06, 1.62, -0.11, -2.2, 0.4], [0.06, 1.62, -0.11, -2.2, -0.4]].forEach(([x, y, z, rx, rz]) =>
      add('head', cone(0.036, 0.15, 5), M4(x, y, z, rx, 0, rz), P.hair)
    );
    add('head', cyl(0.026, 0.03, 0.05, 8), M4(0, 1.775, -0.075, -0.5, 0, 0), P.scarf); // ponytail tie
  }
  if (o.headband) add('head', new THREE.TorusGeometry(0.119, 0.014, 5, 18), M4(0, 1.698, 0, Math.PI / 2 - 0.12, 0, 0, 0.95, 1.02, 1), P.scarf);
  if (o.face) {
    // anime face built from flat shapes; brows and lids ride their own bones so expressions can change
    for (const s of [-1, 1]) {
      const b = s > 0 ? 'L' : 'R';
      add('lid' + b, sph(0.021, 10, 6), M4(s * 0.043, 1.652, 0.099, 0, s * 0.3, 0, 1.28, 0.72, 0.4), '#ffffff');
      add('lid' + b, sph(0.0135, 8, 6), M4(s * 0.041, 1.651, 0.107, 0, s * 0.3, 0, 1, 1.02, 0.35), P.eye);
      add('lid' + b, sph(0.0045, 5, 4), M4(s * 0.046, 1.656, 0.112), '#ffffff');
      add('lid' + b, box(0.056, 0.008, 0.012), M4(s * 0.044, 1.6665, 0.104, 0, s * 0.3, s * -0.1), P.hair); // upper lash line
      add('brow' + b, box(0.058, 0.0125, 0.012), M4(s * 0.045, 1.686, 0.103, 0, s * 0.28, s * -0.22), P.hair);
    }
    add('head', box(0.008, 0.02, 0.012), M4(0, 1.62, 0.118, -0.3, 0, 0), '#d9a882');
    add('head', box(0.034, 0.005, 0.008), M4(0, 1.588, 0.105), '#8a4a44');
  }
  if (o.mask) {
    add('head', sph(0.092, 12, 8), M4(0, 1.6, 0.022, 0, 0, 0, 0.92, 0.82, 0.98), P.haori); // cloth over the lower face
    for (const s of [-1, 1]) add('head', sph(0.012, 6, 5), M4(s * 0.042, 1.653, 0.108, 0, 0, 0, 1.5, 0.55, 0.5), P.eyeGlow);
    add('head', new THREE.SphereGeometry(0.126, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), M4(0, 1.662, -0.008, -0.1, 0, 0, 0.97, 1.05, 1.02), P.hair);
  }
  if (o.hat === 'kasa') {
    add('head', new THREE.ConeGeometry(0.36, 0.17, 16, 1, true), M4(0, 1.79, 0), P.straw);
    add('head', new THREE.ConeGeometry(0.355, 0.14, 16, 1, true), M4(0, 1.768, 0), '#5a4a30');
    add('head', sph(0.03, 6, 5), M4(0, 1.875, 0), '#5a4a30');
  } else if (o.hat === 'jingasa') {
    add('head', new THREE.ConeGeometry(0.3, 0.1, 14, 1, true), M4(0, 1.775, 0), armor);
    add('head', new THREE.ConeGeometry(0.297, 0.085, 14, 1, true), M4(0, 1.762, 0), '#1a1a1e');
    add('head', cyl(0.3, 0.3, 0.012, 14, true), M4(0, 1.727, 0), P.gold);
    add('head', sph(0.035, 6, 5), M4(0, 1.83, 0), P.gold);
  } else if (o.hat === 'kabuto') {
    add('head', new THREE.SphereGeometry(0.14, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), M4(0, 1.69, -0.005, 0, 0, 0, 1, 1.05, 1.08), armor);
    add('head', box(0.2, 0.025, 0.09), M4(0, 1.705, 0.13, 0.25, 0, 0), armor); // visor
    for (let i = 0; i < 3; i++) add('head', new THREE.CylinderGeometry(0.16 + i * 0.04, 0.19 + i * 0.045, 0.05, 14, 1, true, Math.PI * 0.62, Math.PI * 1.76), M4(0, 1.672 - i * 0.045, -0.01, 0, Math.PI, 0), i % 2 ? P.gold : armor); // neck guard
    for (const s of [-1, 1]) add('head', box(0.022, 0.3, 0.012), M4(s * 0.1, 1.88, 0.11, 0.1, 0, s * -0.42), P.gold); // crest horns
    add('head', sph(0.03, 6, 5), M4(0, 1.75, 0.13), P.gold);
  }

  // arms
  for (const s of [-1, 1]) {
    const x = s * 0.19, u = s > 0 ? 'lUpper' : 'rUpper', f = s > 0 ? 'lFore' : 'rFore', h = s > 0 ? 'lHand' : 'rHand';
    add(u, sph(0.072, 10, 7), M4(x, 1.44, 0), P.gi);
    add(u, cyl(0.064, 0.088, 0.26, 10), M4(x, 1.3, 0), P.gi);
    add(u, cyl(0.09, 0.09, 0.016, 10), M4(x, 1.172, 0), P.trim);
    add(f, sph(0.052, 8, 6), M4(x, 1.16, 0), o.kote ? armor : P.skin);
    add(f, cyl(0.052, 0.042, 0.24, 8), M4(x, 1.03, 0), o.kote ? armor : P.skin);
    if (o.kote) {
      add(f, cyl(0.055, 0.053, 0.018, 8), M4(x, 1.11, 0), P.gold);
      add(f, cyl(0.047, 0.046, 0.018, 8), M4(x, 0.95, 0), P.gold);
    }
    add(h, box(0.062, 0.088, 0.072), M4(x, 0.86, 0), P.skin);
    if (o.kote) add(h, box(0.068, 0.034, 0.078), M4(x, 0.9, 0), armor);
  }
  // legs
  for (const s of [-1, 1]) {
    const x = s * 0.095, t = s > 0 ? 'lThigh' : 'rThigh', sh = s > 0 ? 'lShin' : 'rShin', ft = s > 0 ? 'lFoot' : 'rFoot';
    add(t, hakamaLeg(0.108, 0.126, 0.44, P.hakama), M4(x, 0.72, 0, 0, 0, 0, 1, 1, 0.92));
    add(sh, sph(0.126, 10, 7), M4(x, 0.5, 0, 0, 0, 0, 1, 0.75, 0.92), P.hakama);
    add(sh, hakamaLeg(0.126, 0.15, 0.25, P.hakama), M4(x, 0.385, 0, 0, 0, 0, 1, 1, 0.92));
    add(sh, cyl(0.052, 0.045, 0.2, 8), M4(x, 0.17, 0), o.kote ? armor : P.sock);
    if (o.kote) add(sh, cyl(0.055, 0.054, 0.018, 8), M4(x, 0.24, 0), P.gold);
    add(ft, box(0.085, 0.06, 0.22), M4(x, 0.045, 0.045), P.sock);
    add(ft, box(0.092, 0.018, 0.235), M4(x, 0.009, 0.045), P.sole);
  }
  return parts;
}

function mergeSkinned(parts, boneIndex) {
  let vCount = 0, iCount = 0;
  for (const p of parts) {
    vCount += p.geometry.attributes.position.count;
    iCount += p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3);
  const si = new Uint16Array(vCount * 4), sw = new Float32Array(vCount * 4);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3(), c = new THREE.Color();
  for (const p of parts) {
    const g = p.geometry, P = g.attributes.position, N = g.attributes.normal, Cc = g.attributes.color;
    nm.getNormalMatrix(p.matrix);
    if (p.color != null) c.set(p.color);
    const flip = p.matrix.determinant() < 0;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(p.matrix);
      pos.set([v.x, v.y, v.z], (vo + i) * 3);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      nrm.set([v.x, v.y, v.z], (vo + i) * 3);
      if (Cc) col.set([Cc.getX(i), Cc.getY(i), Cc.getZ(i)], (vo + i) * 3);
      else col.set([c.r, c.g, c.b], (vo + i) * 3);
      si[(vo + i) * 4] = boneIndex[p.bone];
      sw[(vo + i) * 4] = 1;
    }
    const n = g.index ? g.index.count : P.count;
    for (let i = 0; i < n; i += 3) {
      const a = g.index ? g.index.getX(i) : i, b = g.index ? g.index.getX(i + 1) : i + 1, d = g.index ? g.index.getX(i + 2) : i + 2;
      idx[io++] = vo + a;
      idx[io++] = vo + (flip ? d : b);
      idx[io++] = vo + (flip ? b : d);
    }
    vo += P.count;
  }
  // smoothed normals for the outline hull so hard edges do not split open
  const acc = new Map();
  const key = (i) => `${Math.round(pos[i * 3] * 2000)},${Math.round(pos[i * 3 + 1] * 2000)},${Math.round(pos[i * 3 + 2] * 2000)}`;
  for (let i = 0; i < vCount; i++) {
    const k = key(i);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = [0, 0, 0]));
    a[0] += nrm[i * 3]; a[1] += nrm[i * 3 + 1]; a[2] += nrm[i * 3 + 2];
  }
  const on = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    const a = acc.get(key(i));
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    on.set([a[0] / l, a[1] / l, a[2] / l], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('onormal', new THREE.BufferAttribute(on, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/* ---------- materials ---------- */
export function toonCharMaterial() {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('char'), side: THREE.DoubleSide });
  const u = (mat.userData.u = { uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 1, 1) }, uRim: { value: 0.5 }, uRimColor: { value: new THREE.Color('#bfe0ff') }, uDissolve: { value: 0 } });
  mat.customProgramCacheKey = () => 'toonChar';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, { uNoise: sharedUniforms.uNoise });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFlash, uRim, uDissolve; uniform vec3 uFlashColor, uRimColor; uniform sampler2D uNoise; varying vec3 vLPos;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float dn = texture2D(uNoise, vLPos.xy * 1.7 + vLPos.z).g;
        if (uDissolve > 0.0 && dn < uDissolve * 1.15 - 0.08) discard;`
      )
      .replace(
        '#include <dithering_fragment>',
        `float rim = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.2);
        gl_FragColor.rgb += uRimColor * rim * uRim;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uFlashColor, uFlash);
        if (uDissolve > 0.0) gl_FragColor.rgb += vec3(2.4, 1.2, 0.5) * smoothstep(0.1, 0.0, dn - (uDissolve * 1.15 - 0.08));
        #include <dithering_fragment>`
      );
  };
  return mat;
}
export function outlineMaterial(thickness = 0.014, color = 0x191420) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.userData.u = { uOutline: { value: thickness } };
  mat.customProgramCacheKey = () => 'outline';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = mat.userData.u.uOutline;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 onormal; uniform float uOutline;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += onormal * uOutline;');
  };
  return mat;
}

/* ---------- weapons (plain meshes, parented to the hand bone) ---------- */
function withOutlineNormals(g) {
  g.setAttribute('onormal', g.attributes.normal.clone());
  return g;
}
export function buildKatana(P, scale = 1) {
  const group = new THREE.Group();
  // blade profile in the Y (length) / Z (edge) plane, gently curved
  const len = 0.76, pts = [];
  const curve = (t) => -0.045 * t * t; // sori: the back curves away from the edge
  for (let i = 0; i <= 10; i++) pts.push(new THREE.Vector2(curve(i / 10) - 0.012, 0.04 + (i / 10) * len));
  pts.push(new THREE.Vector2(curve(1) + 0.004, 0.04 + len + 0.03)); // kissaki
  for (let i = 10; i >= 0; i--) pts.push(new THREE.Vector2(curve(i / 10) + 0.02 - (i === 10 ? 0.006 : 0), 0.04 + (i / 10) * len));
  const shape = new THREE.Shape(pts);
  const bg = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false });
  bg.translate(0, 0, -0.004);
  bg.rotateY(-Math.PI / 2); // shape X -> Z (edge toward +Z)
  const p = bg.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const edge = THREE.MathUtils.smoothstep(p.getZ(i) - curve((p.getY(i) - 0.04) / len), -0.012, 0.02);
    const k = 0.55 + edge * 1.25; // bright hamon along the edge (HDR so it blooms)
    col.set([k * 0.92, k * 0.97, k * 1.05], i * 3);
  }
  bg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const blade = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ vertexColors: true }));
  const toon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('char') });
  const parts = [
    { geometry: cyl(0.045, 0.045, 0.009, 12), matrix: M4(0, 0.032, 0, 0, 0, 0, 0.85, 1, 1.1), color: P.gold },
    { geometry: box(0.014, 0.03, 0.03), matrix: M4(0, 0.05, 0.002), color: P.gold },
    { geometry: cyl(0.0165, 0.018, 0.25, 8), matrix: M4(0, -0.1, 0, 0, 0, 0, 0.8, 1, 1.1), color: P.scarf },
    { geometry: cyl(0.02, 0.02, 0.02, 8), matrix: M4(0, -0.232, 0, 0, 0, 0, 0.8, 1, 1.1), color: P.gold },
  ];
  for (let i = 0; i < 6; i++) parts.push({ geometry: cyl(0.0185, 0.0185, 0.008, 8), matrix: M4(0, -0.01 - i * 0.04, 0, 0, 0, 0, 0.8, 1, 1.1), color: '#1a1a22' });
  const hg = mergeStatic(parts);
  const hilt = new THREE.Mesh(hg, toon);
  const out = new THREE.Mesh(hg, outlineMaterial(0.006));
  const bout = new THREE.Mesh(withOutlineNormals(bg), outlineMaterial(0.005));
  group.add(blade, hilt, out, bout);
  group.scale.setScalar(scale);
  group.userData = { base: new THREE.Vector3(0, 0.08, 0), tip: new THREE.Vector3(0, 0.04 + len + 0.02, -0.03), blade, len: (len + 0.07) * scale };
  group.traverse((m) => {
    if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
  });
  return group;
}
export function buildSpear(P) {
  const group = new THREE.Group();
  const toon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('char') });
  const hg = mergeStatic([
    { geometry: cyl(0.016, 0.018, 2.1, 8), matrix: M4(0, 0.45, 0), color: '#4a3526' },
    { geometry: cyl(0.024, 0.024, 0.07, 8), matrix: M4(0, 1.47, 0), color: P.gold },
    { geometry: cyl(0.022, 0.022, 0.05, 8), matrix: M4(0, -0.6, 0), color: P.gold },
    { geometry: box(0.03, 0.12, 0.03), matrix: M4(0, 1.4, 0), color: P.scarf },
  ]);
  const sg = new THREE.ConeGeometry(0.034, 0.36, 4);
  sg.scale(0.35, 1, 1);
  sg.translate(0, 1.68, 0);
  const c = new Float32Array(sg.attributes.position.count * 3).fill(1.5);
  sg.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const blade = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true }));
  group.add(new THREE.Mesh(hg, toon), new THREE.Mesh(hg, outlineMaterial(0.006)), blade, new THREE.Mesh(withOutlineNormals(sg), outlineMaterial(0.005)));
  group.userData = { base: new THREE.Vector3(0, 1.3, 0), tip: new THREE.Vector3(0, 1.86, 0), blade, len: 1.9 };
  group.traverse((m) => {
    if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
  });
  return group;
}
function mergeStatic(parts) {
  const g = mergeSkinned(parts.map((p) => ({ ...p, bone: 'x' })), { x: 0 });
  g.deleteAttribute('skinIndex');
  g.deleteAttribute('skinWeight');
  return g;
}

/* ---------- assemble a character ---------- */
const VARIANTS = {
  ronin: { palette: 'ronin', haori: true, sode: true, kote: true, hair: true, face: true, headband: true, scarf: true, weapon: 'katana', saya: true },
  bandit: { palette: 'bandit', kote: false, mask: true, hat: 'kasa', scarf: true, weapon: 'katana' },
  spear: { palette: 'spear', kote: true, sode: true, mask: true, hat: 'jingasa', weapon: 'spear' },
  captain: { palette: 'captain', haori: true, kote: true, sode: true, cuirass: true, mask: true, hat: 'kabuto', scarf: true, weapon: 'odachi', scale: 1.2 },
  elite: { palette: 'elite', kote: true, sode: true, cuirass: true, mask: true, hat: 'jingasa', scarf: true, weapon: 'katana', scale: 1.05 },
  monk: { palette: 'monk', haori: true, kote: true, mask: true, hat: 'kasa', scarf: true, weapon: 'spear', scale: 1.22 },
  lord: { palette: 'lord', haori: true, kote: true, sode: true, cuirass: true, mask: true, hat: 'kabuto', scarf: true, weapon: 'odachi', scale: 1.34 },
};

export function buildCharacter(kind) {
  const o = VARIANTS[kind];
  const P = { ...PALETTES[o.palette] };
  P.eyeGlow = new THREE.Color(P.eye).multiplyScalar(3.2); // HDR so masked eyes bloom
  const bones = {}, list = [], boneIndex = {};
  for (const [name, parent, x, y, z] of BONE_DEF) {
    const b = new THREE.Bone();
    b.name = name;
    const pp = parent ? BIND[parent] : new THREE.Vector3();
    b.position.set(x - pp.x, y - pp.y, z - pp.z);
    if (parent) bones[parent].add(b);
    bones[name] = b;
    boneIndex[name] = list.length;
    list.push(b);
  }
  const geo = mergeSkinned(buildParts(P, o), boneIndex);
  const skeleton = new THREE.Skeleton(list);
  const material = toonCharMaterial();
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.add(bones.hips);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const outline = new THREE.SkinnedMesh(geo, outlineMaterial(0.013));
  outline.bind(skeleton, mesh.bindMatrix);
  outline.frustumCulled = false;

  const root = new THREE.Group(); // feet on the ground, faces +Z
  const pivot = new THREE.Group(); // lets the whole body tumble (dodge roll, knockdown)
  root.add(pivot);
  pivot.add(mesh, outline);
  const scale = o.scale ?? 1;
  pivot.scale.setScalar(scale);

  // weapon in the right hand: blade along the hand's +Y, edge toward +Z
  const weapon = o.weapon === 'spear' ? buildSpear(P) : buildKatana(P, o.weapon === 'odachi' ? 1.28 : 1);
  weapon.position.set(0, -0.045, 0);
  bones.rHand.add(weapon);

  let saya = null, sheathed = null;
  if (o.saya) {
    const dir = new THREE.Vector3(0.1, -0.33, -0.94).normalize();
    const open = new THREE.Vector3(0.165, 0.075, 0.13); // relative to the hips bone
    const sg = mergeStatic([
      { geometry: cyl(0.021, 0.017, 0.8, 8), matrix: M4(0, -0.4, 0, 0, 0, 0, 0.75, 1, 1.25), color: '#17161d' },
      { geometry: cyl(0.024, 0.024, 0.03, 8), matrix: M4(0, -0.015, 0, 0, 0, 0, 0.75, 1, 1.25), color: P.gold },
      { geometry: cyl(0.02, 0.02, 0.03, 8), matrix: M4(0, -0.79, 0, 0, 0, 0, 0.75, 1, 1.25), color: P.gold },
      { geometry: box(0.03, 0.02, 0.05), matrix: M4(0, -0.17, 0), color: P.scarf },
    ]);
    saya = new THREE.Group();
    saya.add(new THREE.Mesh(sg, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('char') })), new THREE.Mesh(sg, outlineMaterial(0.006)));
    saya.position.copy(open);
    saya.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    bones.hips.add(saya);
    // hilt shown while the sword rests in the scabbard
    sheathed = buildKatana(P, 1);
    sheathed.userData.blade.visible = false;
    sheathed.children[3].visible = false;
    sheathed.position.copy(open).addScaledVector(dir, -0.04);
    sheathed.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    sheathed.visible = false;
    bones.hips.add(sheathed);
    saya.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
  }
  return { root, pivot, mesh, outline, bones, material, weapon, saya, sheathed, palette: P, scale, kind, variant: o };
}
