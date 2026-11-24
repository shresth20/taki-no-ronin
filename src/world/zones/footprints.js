/* Solid footprints for every structure type. One source of truth shared by the collision system,
   the boundary dresser (which skips edges already blocked by something solid), the debug overlay and the overview map.
   Circles: { x, z, r }   Boxes: { x, z, w, d, rot }  (w along local X, d along local Z) */
export const HOUSE = {
  farm: { w: 10, d: 7.4, h: 2.9, roof: 'thatch' },
  town: { w: 9, d: 7, h: 3.1, roof: 'tile' },
  shop: { w: 8.6, d: 6.6, h: 3.0, roof: 'tile' },
  inn: { w: 13, d: 8.6, h: 3.4, roof: 'tile', upper: true },
  store: { w: 5.4, d: 5.4, h: 3.6, roof: 'tile', kura: true },
};

const rot2 = (x, z, a) => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
export const local = (s, lx, lz) => {
  const [dx, dz] = rot2(lx, lz, s.rot || 0);
  return [s.x + dx, s.z + dz];
};
const hash = (x, z, i) => {
  const v = Math.sin(x * 12.9898 + z * 78.233 + i * 37.719) * 43758.5453;
  return v - Math.floor(v);
};
/** deterministic rock cluster so the mesh and its colliders agree */
export function rockCluster(s) {
  const out = [], n = s.n || 3, k = s.s || 1;
  for (let i = 0; i < n; i++) {
    const a = hash(s.x, s.z, i) * 6.283, d = i === 0 ? 0 : (0.9 + hash(s.x, s.z, i + 9) * 1.1) * k;
    const r = (i === 0 ? 1.0 : 0.55 + hash(s.x, s.z, i + 5) * 0.4) * k;
    out.push({ x: s.x + Math.cos(a) * d, z: s.z + Math.sin(a) * d, r, sy: 0.6 + hash(s.x, s.z, i + 3) * 0.5, a: hash(s.x, s.z, i + 2) * 6.283 });
  }
  return out;
}
export function wallSegments(s) {
  const out = [], th = s.kind === 'ishigaki' ? 1.6 : 1.2;
  for (let i = 0; i < s.pts.length - 1; i++) {
    const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    out.push({ x: (ax + bx) / 2, z: (az + bz) / 2, w: len + th, d: th, rot: Math.atan2(-(bz - az), bx - ax), len, ax, az, bx, bz });
  }
  return out;
}
export const GATE = {
  village: { post: [0.9, 0.9], h: 4.4 },
  temple: { post: [1.5, 2.2], h: 6.2 },
  fort: { post: [1.9, 2.2], h: 6.2 },
  fortmain: { post: [2.4, 2.8], h: 7.6 },
  castle: { post: [2.6, 3.2], h: 8 },
};

export function footprint(s) {
  const b = (lx, lz, w, d) => { const [x, z] = local(s, lx, lz); return { x, z, w, d, rot: s.rot || 0 }; };
  const c = (lx, lz, r) => { const [x, z] = local(s, lx, lz); return { x, z, r }; };
  const k = s.s || 1;
  switch (s.type) {
    case 'house': { const h = HOUSE[s.kind]; return [b(0, 0, h.w, h.d)]; }
    case 'mill': return [b(0, 0, 6.6, 5.6)];
    case 'hall': return [b(0, 0, s.w, s.d)];
    case 'temple': return [b(0, 0, s.w + 3, s.d + 1)];
    case 'barracks': return [b(0, 0, 13, 8.4)];
    case 'hut': return [b(0, 0, 4.6, 3.6)];
    case 'keep': return [b(0, 0, 32 * k, 27 * k)];
    case 'pagoda': return [b(0, 0, 8.6 * k, 8.6 * k)];
    case 'belltower': return [b(0, 0, 4.4, 4.4)];
    case 'pavilion': return [c(-1.9, -1.9, 0.3), c(1.9, -1.9, 0.3), c(-1.9, 1.9, 0.3), c(1.9, 1.9, 0.3)];
    case 'statue': return [c(0, 0, 2.7 * k)];
    case 'shrine': return [b(0, 0, 1.7 * k, 1.5 * k)];
    case 'jizo': return [b(0, 0, (s.n || 3) * 0.62, 0.6)];
    case 'lantern': return [c(0, 0, s.big ? 0.62 : 0.45)];
    case 'torii': return [c(-2.5 * k, 0, 0.42 * k), c(2.5 * k, 0, 0.42 * k)];
    case 'gate': { const g = GATE[s.style]; const o = s.w / 2 + g.post[0] / 2; return [b(-o, 0, g.post[0], g.post[1]), b(o, 0, g.post[0], g.post[1])]; }
    case 'wall': return wallSegments(s).map(({ x, z, w, d, rot }) => ({ x, z, w, d, rot }));
    case 'tower': return s.kind === 'watch' ? [b(0, 0, 3, 3)] : [b(0, 0, 6.2, 6.2)];
    case 'stall': return [b(0, 0, 3.4, 2.1)];
    case 'well': return [c(0, 0, 1.0)];
    case 'crates': return [c(0, 0, 0.75 + 0.14 * (s.n || 3))];
    case 'barrels': return [c(0, 0, 0.6 + 0.15 * (s.n || 2))];
    case 'baskets': return [c(0, 0, 0.8)];
    case 'cart': return [b(0, 0, 1.7, 2.8)];
    case 'woodpile': return [b(0, 0, 2.6, 1.1)];
    case 'haystack': return [c(0, 0, 1.3)];
    case 'scarecrow': return [c(0, 0, 0.3)];
    case 'signpost': return [c(0, 0, 0.22)];
    case 'rack': return [b(0, 0, 2.8, 0.7)];
    case 'barricade': return [b(0, 0, 3.2, 1.0)];
    case 'tent': return [b(0, 0, 4.4, 4.0)];
    case 'brazier': return [c(0, 0, s.big ? 0.8 : 0.6)];
    case 'torch': return [c(0, 0, 0.22)];
    case 'banner': return [c(0, 0, 0.18)];
    case 'drum': return [c(0, 0, 1.1)];
    case 'curtain': return [b(0, 0, s.w, 0.5)];
    case 'censer': return [c(0, 0, 0.95)];
    case 'fallen': return [b(0, 0, 0.7, s.len)];
    case 'rocks': return rockCluster(s).filter((r) => r.r * r.sy > 0.45).map((r) => ({ x: r.x, z: r.z, r: r.r * 0.85 }));
    case 'checkpoint': return [c(0, 0, 0.5)];
    case 'garden': return [c(0, 0, 0.9)];
    default: return [];
  }
}
