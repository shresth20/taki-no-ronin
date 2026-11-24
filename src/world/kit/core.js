import * as THREE from 'three';
import { getToonRamp, patchMaterial, GLSL_PAINT, sharedUniforms, getSoftTexture } from '../../core/util.js';
import { envUniforms, GLSL_FOG } from '../env.js';

/* Architecture kit — shared materials and geometry helpers.
   Every building, wall, bridge and prop in zones 01–05 is assembled from boxes, cylinders and swept roofs,
   merged into a handful of meshes per zone and drawn with ONE cel-shaded material. Surface detail (roof tiles,
   planking, stone courses, plaster, thatch) is painted in the fragment shader from a per-vertex material code,
   then brushed over with the same hand-painted texture the valley rocks use, so all six zones read as one world. */

// lamp: a paper lantern's body (geometry carries aUv = height 0–1, hoop count); lampWin: a lantern's papered window
export const MAT = { plain: 0, tile: 1, plank: 2, stone: 3, plaster: 4, thatch: 5, paper: 6, metal: 7, lamp: 8, lampWin: 9 };
export const kitUniforms = { uGlow: envUniforms.uGlow };

const KIT_FRAG_HEAD = GLSL_PAINT + /* glsl */ `
  varying vec3 vKit; uniform float uGlow; vec3 kitEmis = vec3(0.0);
  float kHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;
const KIT_FRAG = /* glsl */ `
  {
    float m = vKit.z;
    vec3 base = diffuseColor.rgb;
    float pt = paintTri(vWPos, vWNrm, 0.27);
    float ptL = paintTri(vWPos, vWNrm, 0.07);
    if (m < 0.5) {
      base *= (0.8 + 0.24 * pt) * (0.92 + 0.1 * ptL);
    } else if (m < 1.5) {
      // kawara roof tiles: columns of rounded tiles, a dark lip where each course ends
      vec2 g = vec2(vKit.x * 2.5, vKit.y * 1.7);
      float id = kHash(floor(g));
      float rib = sin(fract(g.x) * 3.14159);
      float lip = smoothstep(0.0, 0.16, fract(g.y));
      base *= (0.66 + 0.4 * rib) * mix(0.55, 1.0, lip) * (0.88 + 0.22 * id) * (0.84 + 0.2 * pt);
      base += vec3(0.05, 0.07, 0.07) * smoothstep(0.75, 1.0, rib) * lip;   // sheen on the crown of each tile
    } else if (m < 2.5) {
      // planks: a gap every board, each board its own tone, grain from the brush texture
      float g = vKit.x * 4.2;
      float id = kHash(vec2(floor(g), floor(vKit.y * 0.31)));
      float gap = smoothstep(0.0, 0.07, fract(g)) * smoothstep(1.0, 0.93, fract(g));
      float grain = texture2D(uPaint, vec2(vKit.x * 0.9, vKit.y * 0.13)).r;
      base *= mix(0.5, 1.0, gap) * (0.82 + 0.3 * id) * (0.82 + 0.3 * grain);
    } else if (m < 3.5) {
      // coursed stone: staggered blocks with dark joints, moss creeping in from below
      vec3 an = abs(vWNrm);
      vec2 q = an.y > 0.6 ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
      q *= vec2(0.78, 1.45);
      q.x += floor(q.y) * 0.5 + kHash(vec2(floor(q.y), 3.0)) * 0.4;
      vec2 f = fract(q);
      float id = kHash(floor(q));
      float joint = smoothstep(0.0, 0.07, f.x) * smoothstep(1.0, 0.93, f.x) * smoothstep(0.0, 0.1, f.y) * smoothstep(1.0, 0.9, f.y);
      base *= mix(0.5, 1.0, joint) * (0.8 + 0.3 * id) * (0.82 + 0.26 * pt);
      base = mix(base, vec3(0.3, 0.42, 0.2), smoothstep(0.62, 0.9, ptL * 0.55 + id * 0.25) * 0.35);
    } else if (m < 4.5) {
      // lime plaster: nearly flat, weather-stained toward the ground
      base *= (0.9 + 0.12 * pt) * (0.95 + 0.07 * ptL);
    } else if (m < 5.5) {
      // thatch: long combed strands running down the slope
      float s1 = texture2D(uPaint, vec2(vKit.x * 1.7, vKit.y * 0.16)).g;
      float s2 = kHash(vec2(floor(vKit.x * 9.0), 1.0));
      float course = smoothstep(0.0, 0.2, fract(vKit.y * 0.9));
      base *= (0.72 + 0.4 * s1) * (0.9 + 0.16 * s2) * mix(0.78, 1.0, course);
    } else if (m < 6.5) {
      // paper screens: lattice shadows, lit from inside as the day fades
      vec2 g = vKit.xy * vec2(3.2, 2.4);
      float bar = smoothstep(0.0, 0.07, fract(g.x)) * smoothstep(1.0, 0.93, fract(g.x)) * smoothstep(0.0, 0.07, fract(g.y)) * smoothstep(1.0, 0.93, fract(g.y));
      base *= mix(0.32, 1.0, bar);
      kitEmis = diffuseColor.rgb * vec3(1.0, 0.72, 0.38) * bar * uGlow * 1.25;
    } else if (m < 7.5) {
      base *= 0.85 + 0.25 * pt;   // metal / lacquer
    } else {
      // lantern paper, lit from inside by a flame. By day it is just paper with a faint warmth in it; as the light
      // goes it glows, so a lamp reads as a lamp at dusk and night without being a block of yellow at noon
      float lit = 0.16 + 1.0 * smoothstep(0.45, 1.6, uGlow);
      vec3 flame = diffuseColor.rgb * vec3(1.0, 0.7, 0.4) * lit;
      if (m < 8.5) {
        // chōchin: paper on bamboo hoops, hottest round its middle, the hoops dark lines against the glow
        float d = abs(fract(vKit.y) - 0.5) * 2.0;
        float hoop = smoothstep(0.7, 0.9, d);
        float core = pow(sin(3.14159 * clamp(vKit.x, 0.0, 1.0)), 0.8);
        base *= (1.0 - 0.3 * hoop) * (0.92 + 0.1 * ptL);
        kitEmis = flame * (0.45 + 0.75 * core) * (1.0 - 0.6 * hoop);
      } else {
        // a stone lantern's window: paper behind a fine lattice (kumiko)
        vec2 g = vKit.xy * 13.0;
        float bar = smoothstep(0.0, 0.12, fract(g.x)) * smoothstep(1.0, 0.88, fract(g.x)) * smoothstep(0.0, 0.12, fract(g.y)) * smoothstep(1.0, 0.88, fract(g.y));
        base *= mix(0.45, 1.0, bar);
        kitEmis = flame * mix(0.2, 1.0, bar);
      }
    }
    diffuseColor.rgb = base;
  }
`;

let _kit = null, _kitDouble = null;
const mkKit = (side, key) =>
  patchMaterial(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp('soft'), side }), {
    key,
    occlude: true,
    uniforms: kitUniforms,
    vHead: 'attribute vec3 aKit; varying vec3 vKit;',
    vBegin: 'vKit = aKit;',
    fHead: KIT_FRAG_HEAD,
    fColor: KIT_FRAG,
    fEnd: 'gl_FragColor.rgb += kitEmis;',
  });
export const kitMaterial = () => (_kit ??= mkKit(THREE.FrontSide, 'kit'));
export const kitMaterialDouble = () => (_kitDouble ??= mkKit(THREE.DoubleSide, 'kit2'));

/* ---------- geometry cache + part list ---------- */
const _geo = new Map();
const cached = (key, make) => { let g = _geo.get(key); if (!g) { g = make(); _geo.set(key, g); } return g; };
export const boxG = (w, h, d) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
export const cylG = (rt, rb, h, n = 8, open = false) => cached(`c${rt},${rb},${h},${n},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, n, 1, open));
export const coneG = (r, h, n = 6) => cached(`k${r},${h},${n}`, () => new THREE.ConeGeometry(r, h, n));
export const sphG = (r, w = 8, h = 6) => cached(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
export const torusG = (r, t, a = 6, b = 12, arc = Math.PI * 2) => cached(`t${r},${t},${a},${b},${arc}`, () => new THREE.TorusGeometry(r, t, a, b, arc));

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export const mat4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));

/** A list of coloured parts placed relative to an anchor (a structure's position and yaw). */
export class Parts {
  constructor() { this.list = []; this.base = new THREE.Matrix4(); this.cx = 0; this.cz = 0; }
  /** set the anchor for the parts that follow */
  at(x, y, z, rot = 0, s = 1) { this.base = mat4(x, y, z, 0, rot, 0, s); this.cx = x; this.cz = z; return this; }
  /** parts added in world space (bridges, stairs) still need a place for culling tiles */
  center(x, z) { this.cx = x; this.cz = z; return this; }
  add(geometry, x, y, z, color, mat = 0, o = {}) {
    const m = mat4(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0, o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1).premultiply(this.base);
    this.list.push({ geometry, matrix: m, color, mat, grad: o.grad, uv: o.uv, uvS: o.uvS, cx: this.cx, cz: this.cz });
    return this;
  }
  box(w, h, d, x, y, z, color, mat = 0, o) { return this.add(boxG(w, h, d), x, y, z, color, mat, o); }
  cyl(rt, rb, h, x, y, z, color, mat = 0, o = {}) { return this.add(cylG(rt, rb, h, o.n ?? 8), x, y, z, color, mat, o); }
}

/**
 * Merge parts into one geometry. Attributes: position, normal, color, aKit (u, v, material code).
 * part.uv picks which local axes drive the pattern ('xy' | 'xz' | 'zy' ...). Geometries carrying their own aUv keep it.
 * part.grad = [bottom, top] multiplies the colour along local Y: grounds walls with a darker foot.
 */
export function mergeKit(parts) {
  let vCount = 0, iCount = 0;
  for (const p of parts) {
    vCount += p.geometry.attributes.position.count;
    iCount += p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3), kit = new Float32Array(vCount * 3);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), c = new THREE.Color(), cc = new THREE.Color();
  const AX = { x: 0, y: 1, z: 2 };
  for (const p of parts) {
    const g = p.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.aUv, C = g.attributes.color;
    nm.getNormalMatrix(p.matrix);
    const flip = p.matrix.determinant() < 0;
    c.set(p.color ?? 0xffffff);
    let y0 = 0, y1 = 1;
    if (p.grad) { if (!g.boundingBox) g.computeBoundingBox(); y0 = g.boundingBox.min.y; y1 = g.boundingBox.max.y; }
    const ua = AX[(p.uv || 'xy')[0]], ub = AX[(p.uv || 'xy')[1]], us = p.uvS ?? 1;
    const sx = Math.hypot(p.matrix.elements[0], p.matrix.elements[1], p.matrix.elements[2]), sy = Math.hypot(p.matrix.elements[4], p.matrix.elements[5], p.matrix.elements[6]), sz = Math.hypot(p.matrix.elements[8], p.matrix.elements[9], p.matrix.elements[10]);
    const sc = [sx, sy, sz];
    for (let i = 0; i < P.count; i++) {
      const o = (vo + i) * 3;
      v.fromBufferAttribute(P, i);
      const lx = v.x, ly = v.y, lz = v.z;
      v.applyMatrix4(p.matrix);
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      nrm[o] = n.x; nrm[o + 1] = n.y; nrm[o + 2] = n.z;
      cc.copy(c);
      if (C) cc.r *= C.getX(i), cc.g *= C.getY(i), cc.b *= C.getZ(i);
      if (p.grad) cc.multiplyScalar(p.grad[0] + (p.grad[1] - p.grad[0]) * ((ly - y0) / (y1 - y0 || 1)));
      col[o] = cc.r; col[o + 1] = cc.g; col[o + 2] = cc.b;
      const l = [lx, ly, lz];
      if (U) { kit[o] = U.getX(i); kit[o + 1] = U.getY(i); }
      else if (p.uv === 'h') { kit[o] = lx * sx + lz * sz; kit[o + 1] = ly * sy; } // vertical boarding on any wall
      else { kit[o] = l[ua] * sc[ua] * us; kit[o + 1] = l[ub] * sc[ub] * us; }
      kit[o + 2] = p.mat || 0;
    }
    const cnt = g.index ? g.index.count : P.count;
    for (let i = 0; i < cnt; i += 3) {
      const a = g.index ? g.index.getX(i) : i, b = g.index ? g.index.getX(i + 1) : i + 1, d = g.index ? g.index.getX(i + 2) : i + 2;
      idx[io++] = a + vo; idx[io++] = (flip ? d : b) + vo; idx[io++] = (flip ? b : d) + vo;
    }
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aKit', new THREE.BufferAttribute(kit, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/* ---------- swept Japanese roof ----------
   Four faces lofted from the eave rectangle (w × d) up to a ridge of length `ridge`:
     ridge = w        → gable (kirizuma): the end faces come out vertical and are returned separately as wall
     0 < ridge < w    → hip-and-gable silhouette (irimoya / yosemune)
     ridge = 0        → pyramid (hōgyō), used on pagodas and turrets
   The slope is concave (steep at the ridge, flattening to the eave) and the corners sweep up.
   th > 0 gives the roof body: the tiles ride th above the soffit, and a band closes the gap all round the eaves (and up
   the rakes of a gable), so the roof reads as a thick layer of tiles on rafters rather than a sheet of paper.
   gin sets a gable's end walls in from the roof's ends, so the roof overhangs them as a real verge does.            */
export function roofGeo({ w, d, h, ridge = w * 0.6, lift = 0.3, curve = 1.55, segU = 8, segV = 5, th = 0, gin = 0 }) {
  const key = `r${w},${d},${h},${ridge},${lift},${curve},${segU},${segV},${th},${gin}`;
  return cached(key, () => {
    const pos = [], upos = [], uv = [], idx = [], gpos = [], gidx = [], epos = [], euv = [], eidx = [];
    const gable = ridge >= w - 0.01;
    const hw = w / 2, hd = d / 2, hr = ridge / 2;
    const yAt = (s, t) => h * Math.pow(t, curve) + lift * Math.pow(Math.abs(2 * s - 1), 2.6) * (1 - t) * (1 - t);
    // a band from the soffit edge (ys) up to the tile edge (ys + th) along a run of points; `out` points away from the roof
    const band = (run, out) => {
      let u = 0;
      for (let k = 0; k < run.length - 1; k++) {
        const [ax, ay, az] = run[k], [bx, by, bz] = run[k + 1], L = Math.hypot(bx - ax, bz - az, by - ay), base = epos.length / 3;
        epos.push(ax, ay, az, bx, by, bz, bx, by + th, bz, ax, ay + th, az);
        euv.push(u, 0, u + L, 0, u + L, th, u, th);
        u += L;
        // wind it to face `out`: the normal of (a, b, b') is (b - a) × up
        const nx = -(bz - az), nz = bx - ax;
        if (nx * out[0] + nz * out[1] >= 0) eidx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else eidx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    };
    const face = (ex0, ez0, ex1, ez1, rx0, rz0, rx1, rz1, asGable) => {
      if (asGable) {
        // the end wall: a vertical triangle under the soffit, set in by gin from the roof's end
        const base = gpos.length / 3, gx = Math.sign(ex0) * (hw - gin), k = lift * Math.pow((hw - gin) / hw, 2.6);
        for (let j = 0; j <= segV; j++) {
          const t = j / segV;
          for (let i = 0; i <= segU; i++) {
            const s = i / segU, ez = ez0 + (ez1 - ez0) * s;
            gpos.push(gx, h * Math.pow(t, curve) + k * (1 - t) * (1 - t), ez * (1 - t));
          }
        }
        for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
          const a = base + j * (segU + 1) + i, b = a + 1, c = a + segU + 1, e = c + 1;
          gidx.push(a, b, c, b, e, c);
        }
        return;
      }
      const base = pos.length / 3, eaveLen = Math.hypot(ex1 - ex0, ez1 - ez0);
      const eave = [], rake0 = [], rake1 = [];
      for (let j = 0; j <= segV; j++) {
        const t = j / segV;
        for (let i = 0; i <= segU; i++) {
          const s = i / segU;
          const ex = ex0 + (ex1 - ex0) * s, ez = ez0 + (ez1 - ez0) * s, rx = rx0 + (rx1 - rx0) * s, rz = rz0 + (rz1 - rz0) * s;
          const x = ex + (rx - ex) * t, z = ez + (rz - ez) * t, y = yAt(s, t);
          pos.push(x, y + th, z);
          upos.push(x, y, z);
          uv.push(s * eaveLen, (1 - t) * Math.hypot(h, Math.hypot(rx - ex, rz - ez)));
          if (j === 0) eave.push([x, y, z]);
          if (i === 0) rake0.push([x, y, z]);
          if (i === segU) rake1.push([x, y, z]);
        }
      }
      for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
        const a = base + j * (segU + 1) + i, b = a + 1, c = a + segU + 1, e = c + 1;
        idx.push(a, b, c, b, e, c);
      }
      if (th > 0) {
        band(eave, [(ex0 + ex1) / 2 - (rx0 + rx1) / 2, (ez0 + ez1) / 2 - (rz0 + rz1) / 2]);
        // a gable roof's slopes end in open rakes (the bargeboards); a hipped roof's meet their neighbours
        if (gable) { band(rake0, [ex0 - ex1, ez0 - ez1]); band(rake1, [ex1 - ex0, ez1 - ez0]); }
      }
    };
    face(-hw, hd, hw, hd, -hr, 0, hr, 0, false); // front (+z)
    face(hw, -hd, -hw, -hd, hr, 0, -hr, 0, false); // back
    face(hw, hd, hw, -hd, hr, 0, hr, 0, gable); // right end
    face(-hw, -hd, -hw, hd, -hr, 0, -hr, 0, gable); // left end
    const mk = (p, i, u) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      if (u) g.setAttribute('aUv', new THREE.Float32BufferAttribute(u, 2));
      g.setIndex(i);
      const flat = g.toNonIndexed();
      flat.computeVertexNormals();
      return flat;
    };
    // slopes are smooth across each face but creased at hips: build per-face normals by keeping faces unshared.
    // The eave band rides along in the same geometry (tile ends: the same colour and pattern), on vertices of its own.
    const grid = (p, i) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(i);
      g.computeVertexNormals();
      return g;
    };
    const top = grid(pos, idx);
    let slopes = top;
    if (epos.length) {
      const n0 = pos.length / 3, eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.Float32BufferAttribute(epos, 3));
      eg.setIndex(eidx);
      eg.computeVertexNormals();
      slopes = new THREE.BufferGeometry();
      slopes.setAttribute('position', new THREE.Float32BufferAttribute([...pos, ...epos], 3));
      slopes.setAttribute('normal', new THREE.Float32BufferAttribute([...top.attributes.normal.array, ...eg.attributes.normal.array], 3));
      slopes.setAttribute('aUv', new THREE.Float32BufferAttribute([...uv, ...euv], 2));
      slopes.setIndex([...idx, ...eidx.map((v) => v + n0)]);
    }
    // underside: the soffit, the same surface th lower with its winding reversed (seen from below)
    const under = grid(upos, idx);
    const ui = under.index.array.slice();
    for (let i = 0; i < ui.length; i += 3) { const t = ui[i + 1]; ui[i + 1] = ui[i + 2]; ui[i + 2] = t; }
    under.setIndex(new THREE.BufferAttribute(ui, 1));
    const un = under.attributes.normal;
    for (let i = 0; i < un.count; i++) un.setXYZ(i, -un.getX(i), -un.getY(i), -un.getZ(i));
    return { slopes, under, gables: gable ? mk(gpos, gidx) : null };
  });
}

/* ---------- carved stone lantern cap (kasa) ----------
   An n-sided cap cut from one block: a concave top sweeping up from the eaves to a small crown, a cut face round the
   eaves, and an underside, all sharing the same corner sweep so the stone has real thickness right out to its tips.
   Corners sit where CylinderGeometry puts its vertices (angle measured from +Z toward +X), so an n-sided cylinder
   underneath lines up with them. y = 0 is the underside at the centre; the crown is at th + h.                    */
export function kasaGeo({ n = 6, r, th, h, lift = 0.06, crown = 0.1, curve = 1.6 }) {
  return cached(`kasa${n},${r},${th},${h},${lift},${crown},${curve}`, () => {
    const pos = [], idx = [];
    const grid = (fn, nu, nv, flip) => {
      const base = pos.length / 3;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pos.push(...fn(i / nu, j / nv));
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, e = c + 1;
        if (flip) idx.push(a, c, b, b, c, e); else idx.push(a, b, c, b, e, c);
      }
    };
    const sweep = (s) => lift * Math.pow(Math.abs(2 * s - 1), 3);   // flat mid-face, rising sharply into each corner
    const k0 = crown / r;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const x0 = Math.sin(a0) * r, z0 = Math.cos(a0) * r, x1 = Math.sin(a1) * r, z1 = Math.cos(a1) * r;
      const ex = (s) => x0 + (x1 - x0) * s, ez = (s) => z0 + (z1 - z0) * s;
      // top: eave edge (t = 0) up to the crown (t = 1)
      grid((s, t) => { const q = 1 - t * (1 - k0); return [ex(s) * q, th + h * Math.pow(t, curve) + sweep(s) * (1 - t) * (1 - t), ez(s) * q]; }, 8, 5);
      // crown: closes the top
      grid((s, t) => [ex(s) * k0 * (1 - t), th + h, ez(s) * k0 * (1 - t)], 1, 1);
      // the eave's cut face
      grid((s, t) => [ex(s), th * t + sweep(s), ez(s)], 8, 1);
      // underside: eave edge in to the centre; the corner sweep dies away within the outer 40%, leaving a flat bed
      // for whatever the cap rests on
      grid((s, t) => { const f = Math.max(0, 1 - t / 0.4); return [ex(s) * (1 - t), sweep(s) * f * f, ez(s) * (1 - t)]; }, 8, 5, true);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

/** add a complete roof (tiles/thatch, soffit, ridge beam, gable walls) to a part list at local (x, y, z) */
/** how thick a roof is at its eaves: tiles on battens on rafters, or a deep layer of thatch */
export const roofTh = (o, mat = MAT.tile) => o.th ?? (mat === MAT.thatch ? Math.min(0.62, Math.max(0.2, Math.min(o.w, o.d) * 0.055)) : Math.min(0.42, Math.max(0.1, Math.min(o.w, o.d) * 0.026)));
/**
 * add a complete roof (tiles/thatch with their thickness, soffit, ridge, hip ridges with end tiles, gable walls) to a
 * part list at local (x, y, z). y is the soffit at the eaves; the tiles ride the roof's thickness above it.
 * soffit: the underside's colour (bare rafters by default; castles plaster theirs white)
 */
export function addRoof(P, o, x, y, z, color, { mat = MAT.tile, wall = '#e4dac4', wood = '#3a2c26', soffit, ry = 0, ridgeCap = true, hips = true } = {}) {
  const th = roofTh(o, mat), r = roofGeo({ ...o, th });
  P.add(r.slopes, x, y, z, color, mat, { ry });
  P.add(r.under, x, y, z, soffit ?? wood, MAT.plank, { ry });
  if (r.gables) P.add(r.gables, x, y, z, wall, MAT.plaster, { ry, grad: [0.92, 1.05] });
  const ridge = o.ridge ?? o.w * 0.6, thatch = mat === MAT.thatch, capC = thatch ? '#6d5a3c' : '#2f3a40';
  const cr = Math.cos(ry), sr = Math.sin(ry), at = (lx, lz) => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
  // the tile ridge grows with the roof: a garden-wall coping carries a slim one, a castle a heavy one
  const k = Math.min(1.6, Math.max(0.55, Math.min(o.w, o.d) / 8));
  if (ridgeCap && ridge > 0.3) {
    P.add(boxG(1, 1, 1), x, y + o.h + th + 0.06 * k, z, capC, MAT.plain, { ry, sx: ridge + 0.5 * k, sy: 0.3 * k, sz: 0.36 * k });
    for (const s of [-1, 1]) {
      const [cx, cz] = at(s * (ridge / 2 + 0.2 * k), 0);
      P.add(boxG(1, 1, 1), cx, y + o.h + th + 0.2 * k, cz, capC, MAT.plain, { ry, sx: 0.3 * k, sy: 0.55 * k, sz: 0.5 * k });
    }
  }
  // hip ridges (kudari-mune): a row of ridge tiles down each hip, following its sweep, with an end tile at the corner
  if (hips && !thatch && ridge < o.w - 0.01) {
    const { w, d, h, lift = 0.3, curve = 1.55 } = o, hw = w / 2, hd = d / 2, hr = ridge / 2, n = 6, t2 = 0.2 * k;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pt = (t) => { const [px, pz] = at(sx * (hw + (hr - hw) * t), sz * hd * (1 - t)); return [px, y + h * Math.pow(t, curve) + lift * (1 - t) * (1 - t) + th + t2 * 0.4, pz]; };
      for (let i = 0; i < n; i++) {
        const a = pt(i / n), b = pt((i + 1) / n), dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
        P.add(boxG(1, 1, 1), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, capC, MAT.plain, { rx: Math.acos(dy / L), ry: Math.atan2(dx, dz), sx: t2 * 1.2, sy: L + 0.02, sz: t2 });
      }
      // the end tile (onigawara) standing up off the corner
      const [ex, ey, ez] = pt(0), [fx, , fz] = pt(1 / n);
      P.add(boxG(1, 1, 1), ex, ey + t2 * 0.5, ez, capC, MAT.plain, { ry: Math.atan2(fx - ex, fz - ez), rx: -0.35, sx: t2 * 1.9, sy: t2 * 2.2, sz: t2 * 0.9 });
    }
  }
}

/* ---------- emissive glow (lantern windows, paper lamps, embers) ---------- */
let _glow = null;
export function glowMaterial() {
  if (_glow) return _glow;
  _glow = new THREE.ShaderMaterial({
    uniforms: { ...envUniforms, uGlow: kitUniforms.uGlow },
    vertexShader: /* glsl */ `
      attribute vec3 color; varying vec3 vC; varying vec3 vW; uniform float uTime;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
        float seed = fract(sin(dot(floor(wp.xz * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
        float fl = 0.86 + 0.14 * sin(uTime * (5.0 + seed * 4.0) + seed * 40.0) * sin(uTime * 2.3 + seed * 9.0);
        vC = color * fl;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float; varying vec3 vC; varying vec3 vW; uniform float uGlow;
      ${GLSL_FOG}
      void main(){ gl_FragColor = vec4(applyFog(vC * (0.62 + 0.72 * min(uGlow, 1.6)), vW), 1.0); }`,
  });
  _glow.toneMapped = false;
  return _glow;
}

/* ---------- running water for streams, rivers, ponds and paddies ---------- */
export function streamMaterial({ calm = 0, tint = null } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...envUniforms, uCalm: { value: calm }, uShallow: { value: new THREE.Color(tint?.[0] ?? '#63dcca') }, uDeep: { value: new THREE.Color(tint?.[1] ?? '#11708a') } },
    vertexShader: /* glsl */ `
      attribute vec3 aW; varying vec3 vWtr; varying vec3 vW;
      void main(){ vWtr = aW; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uNoise; uniform float uTime, uCalm; uniform vec3 uShallow, uDeep, uSunColor, uSunDir, uSkyTop, uSkyHorizon;
      varying vec3 vWtr; varying vec3 vW;
      ${GLSL_FOG}
      void main(){
        float edge = abs(vWtr.x);                    // 0 mid-stream .. 1 at the bank
        float sp = mix(vWtr.z, 0.06, uCalm);
        vec2 p = vec2(vWtr.x * 1.6, vWtr.y * 0.22 - uTime * sp * 0.22);
        float n0 = texture2D(uNoise, p * 0.55).g;
        float n1 = texture2D(uNoise, p * 1.3 + vec2(0.37, uTime * 0.02)).r;
        float caust = texture2D(uNoise, vW.xz * 0.11 + vec2(uTime * 0.012, -uTime * 0.016)).b;
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
        vec3 body = mix(uShallow, uDeep, smoothstep(0.95, 0.25, edge));
        body += vec3(0.16, 0.24, 0.2) * smoothstep(0.12, 0.0, caust) * smoothstep(0.3, 0.9, edge);   // cel caustics in the shallows
        vec3 sky = mix(uSkyHorizon, uSkyTop, 0.45);
        vec3 col = mix(body, sky, clamp(fres * 0.75 + 0.1, 0.0, 0.85));
        float streak = smoothstep(0.62, 0.7, n0 * 0.6 + n1 * 0.5) * (1.0 - uCalm * 0.8);
        col = mix(col, vec3(0.9, 0.98, 0.98), streak * 0.5);
        float lap = sin(uTime * 1.4 + vWtr.y * 0.9) * 0.03;
        float foam = smoothstep(0.86 + lap, 0.97, edge + (n1 - 0.5) * 0.16) + vWtr.z * 0.0;
        col = mix(col, vec3(0.96, 1.0, 1.0), clamp(foam, 0.0, 1.0) * 0.9);
        vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
        col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 90.0) * step(0.5, n1) * 0.7;
        float alpha = clamp(0.62 + fres * 0.3 + foam + streak * 0.2, 0.0, 0.96) * smoothstep(1.0, 0.985, edge);
        gl_FragColor = vec4(applyFog(col, vW), alpha);
      }`,
  });
}
/** ribbon of water following a polyline. pts: [x, z]; returns geometry with aW (across -1..1, along metres, speed) */
export function ribbonGeo(pts, width, yAt, { sub = 3, speed = 1, segW = 6, start = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const len = curve.getLength(), n = Math.max(4, Math.ceil(len / sub));
  const pos = [], aw = [], idx = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    const nx = t.z, nz = -t.x;
    for (let j = 0; j <= segW; j++) {
      const s = (j / segW) * 2 - 1;
      const x = p.x + nx * s * width * 0.5, z = p.z + nz * s * width * 0.5;
      pos.push(x, yAt(x, z), z);
      aw.push(s, start + u * len, speed);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < segW; j++) {
    const a = i * (segW + 1) + j, b = a + 1, c = a + segW + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(aw, 3));
  g.setIndex(idx);
  return g;
}
export function discGeo(x, z, r, y, squareW = 0, squareD = 0, rot = 0) {
  const pos = [], aw = [], idx = [];
  if (squareW) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const add = (lx, lz, e) => { pos.push(x + lx * c + lz * s, y, z - lx * s + lz * c); aw.push(e, lx + lz, 0); };
    const hw = squareW / 2, hd = squareD / 2, k = 0.82;
    add(-hw, -hd, 1); add(hw, -hd, 1); add(hw, hd, 1); add(-hw, hd, 1);
    add(-hw * k, -hd * k, 0.2); add(hw * k, -hd * k, 0.2); add(hw * k, hd * k, 0.2); add(-hw * k, hd * k, 0.2);
    idx.push(0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 6, 2, 6, 3, 3, 6, 7, 3, 7, 0, 0, 7, 4, 4, 7, 5, 5, 7, 6);
  } else {
    const n = 28;
    pos.push(x, y, z); aw.push(0, 0, 0);
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; pos.push(x + Math.sin(a) * r * 0.7, y, z + Math.cos(a) * r * 0.7); aw.push(0.45, a * r, 0); }
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; pos.push(x + Math.sin(a) * r, y, z + Math.cos(a) * r); aw.push(1, a * r, 0); }
    for (let i = 0; i < n; i++) { idx.push(0, 1 + i, 2 + i); const a = 1 + i, b = 2 + i, c = n + 2 + i, d = n + 3 + i; idx.push(a, c, b, b, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(aw, 3));
  g.setIndex(idx);
  return g;
}

/* ---------- cloth: nobori banners, noren, camp curtains ---------- */
let _banner = null;
export function bannerMaterial() {
  if (_banner) return _banner;
  _banner = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...envUniforms },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute vec4 aB;   // aB: free distance from the fixed edge (0..1), phase, emblem id, v
      uniform float uTime, uWindK;
      varying vec3 vC; varying vec3 vW; varying vec3 vB; varying float vShade;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float ph = uTime * (2.2 + uWindK * 0.5) + aB.y * 7.0 - aB.x * 3.4 - aB.w * 1.3;
        float amp = aB.x * (0.1 + 0.07 * uWindK);
        vec3 n = normalize(mat3(modelMatrix) * normal);
        wp.xyz += n * sin(ph) * amp + vec3(0.0, -abs(sin(ph * 0.5)) * amp * 0.25, 0.0);
        vShade = 0.84 + 0.2 * cos(ph);
        vC = color; vW = wp.xyz; vB = vec3(aB.x, aB.w, aB.z);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uSunColor; varying vec3 vC; varying vec3 vW; varying vec3 vB; varying float vShade;
      ${GLSL_FOG}
      void main(){
        vec3 col = vC * vShade;
        float em = floor(vB.z + 0.001), asp = fract(vB.z) * 20.0;   // emblem id and cloth height / width
        vec2 q = vec2(vB.x - 0.5, (vB.y - 0.3) * asp);      // emblem space: centred a third of the way down
        float r = length(q);
        vec3 ink = em > 2.5 ? vec3(0.62, 0.5, 0.2) : vec3(0.05, 0.04, 0.05);
        if (em > 0.5) {
          float ring = smoothstep(0.34, 0.32, r) * smoothstep(0.26, 0.28, r);
          float core = smoothstep(0.19, 0.17, r);
          if (em < 1.5) core *= step(abs(q.x) * 1.9 - 0.02, 0.2 - (q.y) * 0.9);       // fang: a tooth cut into the disc
          else if (em < 2.5) core = max(core * step(q.y, 0.05), smoothstep(0.05, 0.03, abs(abs(q.x) - 0.11)) * step(-0.24, -abs(q.y + 0.1)));  // oni: disc with two horns
          col = mix(col, ink, max(ring, core) * 0.92);
        }
        col = mix(col, col * 0.55, smoothstep(0.035, 0.0, vB.y) + smoothstep(0.965, 1.0, vB.y));   // hems
        col *= mix(vec3(1.0), uSunColor, 0.25);
        gl_FragColor = vec4(applyFog(col, vW), 1.0);
      }`,
  });
  return _banner;
}
/** cloth quad hanging in a plane. origin = top fixed corner, `right` = unit vector along the width; fixed: 'side' (nobori) or 'top' (noren, curtain) */
export function clothQuad(out, ox, oy, oz, rx, rz, w, h, color, { emblem = 0, fixed = 'side', seg = 6, phase = Math.random() } = {}) {
  const c = new THREE.Color(color), base = out.pos.length / 3;
  const nu = fixed === 'side' ? 4 : seg, nv = fixed === 'side' ? seg * 2 : 5;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    out.pos.push(ox + rx * w * u, oy - h * v, oz + rz * w * u);
    out.nrm.push(-rz, 0, rx);
    out.col.push(c.r, c.g, c.b);
    // z packs the emblem id with the cloth's aspect so the crest stays round on any banner
    out.ab.push(fixed === 'side' ? u : v, phase + (fixed === 'side' ? 0 : u * 0.6), emblem + Math.min(0.49, (fixed === 'side' ? h / w : w / h) / 20), fixed === 'side' ? v : u);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = base + j * (nu + 1) + i, b = a + 1, d = a + nu + 1, e = d + 1;
    out.idx.push(a, d, b, b, d, e);
  }
}
export const clothBuffers = () => ({ pos: [], nrm: [], col: [], ab: [], idx: [] });
export function clothGeo(b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('aB', new THREE.Float32BufferAttribute(b.ab, 4));
  g.setIndex(b.idx);
  return g;
}

/* ---------- fire, smoke, cloud sea: camera-facing sprites drawn in one instanced call per zone ---------- */
const SPRITE_VERT = /* glsl */ `
  attribute vec4 aP; attribute vec4 aS;   // aP: xyz + size, aS: seed, rise, aspect, kind
  uniform float uTime, uWindK; varying vec2 vUv; varying vec4 vS; varying vec3 vW; varying float vLife;
  void main(){
    float life = fract(aS.x + uTime * aS.y);
    vec3 p = aP.xyz;
    float size = aP.w;
    if (aS.w > 0.5 && aS.w < 1.5) {          // smoke: rises, drifts, swells
      p.y += life * aP.w * 5.0;
      p.xz += vec2(sin(aS.x * 40.0), cos(aS.x * 31.0)) * life * 1.2 + vec2(0.9, 0.4) * life * life * 2.0;
      size *= 0.5 + life * 1.3;
    } else if (aS.w > 1.5 && aS.w < 2.5) {   // drifting cloud bank
      p.x += sin(uTime * 0.03 + aS.x * 30.0) * 9.0;
      p.z += cos(uTime * 0.021 + aS.x * 17.0) * 6.0;
    } else if (aS.w > 2.5 && aS.w < 3.5) {   // embers
      p.y += life * 7.0; p.xz += vec2(sin(uTime * 0.7 + aS.x * 50.0), cos(uTime * 0.6 + aS.x * 37.0)) * (0.5 + life * 1.5);
    } else if (aS.w > 3.5 && aS.w < 4.5) {   // spirit fire: stays in its lamp, breathing gently
      p.y += sin(uTime * 1.3 + aS.x * 6.283) * 0.012 * size;
    } else if (aS.w > 4.5) {                 // waterfall mist: billows up from the foot, drifts off on the wind, spreads as it thins
      float rise = aS.z;
      float lift = 1.0 - pow(1.0 - life, 1.6);                              // fast off the water, slowing as it climbs
      p.y += lift * rise;
      p.x += (0.3 + uWindK * 0.4) * life * life * rise * 0.5 + sin(aS.x * 40.0 + uTime * 0.35) * 0.45 * life;
      p.z += cos(aS.x * 29.0 + uTime * 0.27) * 0.5 * life;
      size *= 0.45 + life * 1.6;
    }
    vLife = life; vUv = uv; vS = aS; vW = p;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    mv.xy += (position.xy) * vec2(size * (aS.w > 4.5 ? 1.2 : aS.z), size);
    if (aS.w < 0.5 || (aS.w > 3.5 && aS.w < 4.5)) mv.y += size * 0.5;      // flames stand on their base
    gl_Position = projectionMatrix * mv;
  }`;
const SPRITE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uNoise, uSoft; uniform float uTime, uGlow; uniform vec3 uFogTint, uSunColor;
  varying vec2 vUv; varying vec4 vS; varying vec3 vW; varying float vLife;
  ${GLSL_FOG}
  void main(){
    if (vS.w < 0.5 || (vS.w > 3.5 && vS.w < 4.5)) {
      // flame: a teardrop with a round base that narrows to a flickering tip. Rising noise sways it and
      // tears the top into tongues; heat runs from a white core through yellow and orange to a red rim.
      // Spirit lamps burn a calmer blue.
      float spirit = step(3.5, vS.w);
      float t = uTime * mix(1.0, 0.6, spirit);
      vec2 p = vec2((vUv.x - 0.5) * vS.z, vUv.y);           // in units of height, so the base is round
      float n1 = texture2D(uNoise, vec2(p.x * 1.1 + vS.x, p.y * 0.8 - t * 1.2 - vS.x * 3.0)).g;
      float n2 = texture2D(uNoise, vec2(p.x * 2.6 + vS.x * 2.0, p.y * 1.9 - t * 2.2)).r;
      float rise = smoothstep(0.2, 0.95, p.y);              // the root holds still, the tip dances
      float sway = sin(t * 2.1 + vS.x * 20.0) * 0.6 + sin(t * 4.7 + vS.x * 9.0) * 0.4;
      float x = p.x + sway * 0.03 * rise * rise + ((n1 - 0.5) * 0.16 + (n2 - 0.5) * 0.08) * rise;
      float c = 0.25, r = mix(0.15, 0.19, spirit), tip = mix(0.95, 0.82, spirit) + (n1 - 0.5) * 0.14;
      float dy = p.y - c, k = clamp(dy / (tip - c), 0.0, 1.0);
      float w = dy < 0.0 ? r * sqrt(max(1.0 - dy * dy / (r * r), 0.0)) : r * pow(1.0 - k, 0.9) * (1.0 + 0.5 * k);
      float f = 1.0 - abs(x) / max(w, 1e-4);               // 1 on the axis, 0 at the edge
      float body = smoothstep(0.0, 0.45, f);
      body *= mix(1.0, smoothstep(0.2, 0.55, (n1 + n2) * 0.5 + 0.5 - rise * 0.6), rise);
      float heat = smoothstep(0.15, 0.95, f) * (1.0 - 0.8 * rise) * body;
      // (the grade rolls each channel off on its own, so the green of the orange stays low until the core)
      vec3 cEdge = mix(vec3(1.4, 0.22, 0.04), vec3(0.08, 0.25, 1.3), spirit);
      vec3 cMid = mix(vec3(2.2, 0.62, 0.1), vec3(0.2, 0.7, 2.0), spirit);
      vec3 cHot = mix(vec3(2.6, 1.35, 0.35), vec3(0.65, 1.5, 2.3), spirit);
      vec3 col = mix(cEdge, cMid, smoothstep(0.0, 0.3, heat));
      col = mix(col, cHot, smoothstep(0.3, 0.6, heat));
      col = mix(col, mix(vec3(2.6, 2.1, 1.3), vec3(1.7, 2.2, 2.5), spirit), smoothstep(0.65, 0.95, heat));
      // a soft halo of light around the body, fading out before the quad's edge
      vec2 hp = (p - vec2(0.0, c + 0.12)) * vec2(1.2, 0.85);
      float halo = exp(-dot(hp, hp) * 22.0) * mix(0.1, 0.28, spirit) * (0.9 + 0.1 * sin(t * 13.0 + vS.x * 40.0));
      halo *= smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.85, vUv.y) * smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
      gl_FragColor = vec4(max((col * body * (1.0 - 0.5 * rise) + cMid * halo) * (0.75 + 0.5 * uGlow), 0.0), 1.0);
    } else if (vS.w < 1.5) {
      float a = texture2D(uSoft, vUv).r * (1.0 - vLife) * smoothstep(0.0, 0.12, vLife) * 0.34;
      float n = texture2D(uNoise, vUv * 0.6 + vS.x).g;
      gl_FragColor = vec4(applyFog(mix(vec3(0.16, 0.15, 0.17), vec3(0.42, 0.4, 0.42), n), vW), a * smoothstep(0.25, 0.6, n + 0.2));
    } else if (vS.w < 2.5) {
      float a = texture2D(uSoft, vUv).a;   // (the soft texture is white with a radial alpha: its colour is a hard disc)
      float n = texture2D(uNoise, vUv * 0.45 + vS.x * 3.0 + uTime * 0.004).g;
      a *= smoothstep(0.28, 0.62, n + a * 0.35) * 0.85;
      float d = distance(cameraPosition, vW);
      a *= smoothstep(6.0, 26.0, d);
      gl_FragColor = vec4(mix(uFogTint, vec3(1.0), 0.55) * mix(vec3(1.0), uSunColor, 0.35), a);
    } else if (vS.w > 4.5) {
      // mist: a soft puff torn ragged by drifting noise, born dense at the water and thinning out as it spreads;
      // white where the sun catches its top, the colour of the air lower down
      float a = texture2D(uSoft, vUv).a;
      float n = texture2D(uNoise, vUv * 0.7 + vS.x * 5.0 + vec2(uTime * 0.012, -uTime * 0.03)).g;
      float n2 = texture2D(uNoise, vUv * 1.9 + vS.x * 3.0 - uTime * 0.05).a;
      a *= smoothstep(0.3, 0.78, n * 0.8 + n2 * 0.4 + a * 0.3);
      a *= smoothstep(0.0, 0.12, vLife) * pow(1.0 - vLife, 0.9) * 0.36;
      a *= smoothstep(1.5, 6.0, distance(cameraPosition, vW));
      vec3 air = mix(uFogTint, vec3(1.0), 0.45), top = mix(vec3(1.0), uSunColor, 0.22);
      vec3 col = mix(air, top, smoothstep(0.3, 0.9, vUv.y + n * 0.3));
      gl_FragColor = vec4(applyFog(col, vW), a);
    } else {
      float a = texture2D(uSoft, vUv).r * (1.0 - vLife) * smoothstep(0.0, 0.1, vLife);
      gl_FragColor = vec4(vec3(3.0, 1.3, 0.3) * a * (0.6 + uGlow * 0.5), 1.0);
    }
  }`;
/** sprites: [{x,y,z,size,kind:'flame'|'smoke'|'cloud'|'ember'|'spirit'|'mist', aspect, rise}] → { flames (additive), soft (alpha) } meshes */
export function spriteMeshes(list) {
  const KIND = { flame: 0, smoke: 1, cloud: 2, ember: 3, spirit: 4, mist: 5 };
  const make = (items, additive) => {
    if (!items.length) return null;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    const ap = new Float32Array(items.length * 4), as = new Float32Array(items.length * 4);
    items.forEach((s, i) => {
      ap.set([s.x, s.y, s.z, s.size], i * 4);
      // mist carries how far it climbs where the others carry their aspect
      const rate = s.kind === 'smoke' ? 0.07 + Math.random() * 0.04 : s.kind === 'ember' ? 0.12 + Math.random() * 0.2 : s.kind === 'mist' ? 0.05 + Math.random() * 0.04 : 0;
      as.set([Math.random(), rate, s.kind === 'mist' ? s.rise : s.aspect ?? (s.kind === 'flame' || s.kind === 'spirit' ? 0.62 : 1), KIND[s.kind]], i * 4);
    });
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(ap, 4));
    g.setAttribute('aS', new THREE.InstancedBufferAttribute(as, 4));
    g.instanceCount = items.length;
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { ...envUniforms, uGlow: kitUniforms.uGlow, uSoft: { value: getSoftTexture() }, uFogTint: envUniforms.uFogColor },
      vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    m.frustumCulled = false;
    m.renderOrder = additive ? 8 : 7;
    m.layers.set(1);
    return m;
  };
  return {
    hot: make(list.filter((s) => s.kind === 'flame' || s.kind === 'ember' || s.kind === 'spirit'), true),
    soft: make(list.filter((s) => s.kind === 'smoke' || s.kind === 'cloud' || s.kind === 'mist'), false),
  };
}

/* ---------- encounter wards: a curtain of light across a path while a fight is on ---------- */
export function wardMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { ...envUniforms, uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      precision highp float; uniform sampler2D uNoise; uniform float uTime, uAlpha; varying vec2 vUv; varying vec3 vW;
      void main(){
        float n = texture2D(uNoise, vec2(vW.x + vW.z, vW.y) * 0.16 + vec2(0.0, -uTime * 0.16)).g;
        float rune = step(0.5, texture2D(uNoise, floor(vec2((vW.x + vW.z) * 1.4, vW.y * 1.1 - uTime * 0.5)) * 0.13).r);
        // a thin veil: bright at the ground, thinning upward, with drifting runes
        float streak = smoothstep(0.55, 0.8, texture2D(uNoise, vec2((vW.x + vW.z) * 0.9, vW.y * 0.08 - uTime * 0.25)).g);
        float a = pow(1.0 - vUv.y, 2.6) * (0.03 + n * 0.07) + smoothstep(0.05, 0.0, vUv.y) * 0.55 + streak * 0.07 * (1.0 - vUv.y) + rune * 0.03 * smoothstep(1.0, 0.3, vUv.y);
        a *= smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
        gl_FragColor = vec4(max(vec3(1.9, 0.42, 0.16) * a * uAlpha, 0.0), 1.0);
      }`,
  });
}

export { sharedUniforms };
