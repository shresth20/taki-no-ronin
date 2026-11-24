/* Solid footprints for every structure type. One source of truth shared by the collision system,
   the boundary dresser (which skips edges already blocked by something solid), the debug overlay and the overview map.
   Circles: { x, z, r }   Boxes: { x, z, w, d, rot }  (w along local X, d along local Z)
   Each one covers everything the kit draws (world/kit/build.js) between knee and head height, so a body is stopped
   by what you see rather than walking through a post, a sign or the corner of a plinth. `aux` marks the extra pieces
   (posts, boards, shafts) the overview map leaves out of a building's roof outline. */
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

/** floors a body steps up onto, as boxes: `top` above the ground at the structure (or `y`, an absolute height) */
export function floors(s) {
  const f = (lx0, lx1, lz0, lz1, o) => { const [x, z] = local(s, (lx0 + lx1) / 2, (lz0 + lz1) / 2); return { x, z, w: lx1 - lx0, d: lz1 - lz0, rot: s.rot || 0, ...o }; };
  if (s.type === 'pavilion') return [f(-2.5, 2.5, -2.5, 2.5, { top: 0.2 })];
  if (s.type === 'abutment') {
    // the wall a bridge comes ashore on: coping along its face at road level, the wall's top 0.2 lower behind it, and
    // the seat the deck rests in (the same runs as kit abutment(); ground banked up over the top wins in nav)
    const half = s.len / 2, d = s.d ?? 2.2, st = s.seat, s0 = st.x - st.w / 2, s1 = st.x + st.w / 2, step = s.step === false ? half : Math.max(s1, half - 1.6), cd = Math.min(0.75, d * 0.6);
    const out = [f(s0, s1, -st.d, 0, { y: st.y }), f(s0, s1, -d, -st.d, { y: s.top })];
    const run = (x0, x1, top) => out.push(f(x0, x1, -cd, 0.05, { y: top }), f(x0, x1, -d, -cd, { y: top - 0.2 }));
    if (s0 > -half + 0.05) run(-half, s0, s.top);
    if (step > s1 + 0.05) run(s1, step, s.top);
    if (half > step + 0.05) run(step, half, s.top - 0.6);
    return out;
  }
  // the great hall's plinth, whose porch the zone makes walkable (kit hall(): porch 5.6, plinth top 2.1)
  if (s.type === 'temple') { const [x, z] = local(s, 0, 2.8); return [{ x, z, w: s.w + 3, d: s.d + 7.6, rot: s.rot || 0, top: 2.1, at: [s.x, s.z] }]; }
  return [];
}

export function footprint(s) {
  const b = (lx, lz, w, d, aux) => { const [x, z] = local(s, lx, lz); return { x, z, w, d, rot: s.rot || 0, ...(aux && { aux }) }; };
  const c = (lx, lz, r) => { const [x, z] = local(s, lx, lz); return { x, z, r }; };
  const k = s.s || 1;
  switch (s.type) {
    // the stone footing is 0.5 wider than the walls; a house with a veranda has its posts 1.25 out from the front wall
    case 'house': { const h = HOUSE[s.kind], f = h.kura ? 0.25 : 1.35; return [b(0, (f - 0.25) / 2, h.w + 0.5, h.d + 0.25 + f)]; }
    // the water wheel, its bearing frame and the flume trestle stand off the west wall
    case 'mill': return [b(0, 0, 7, 6), b(-5.3, -0.45, 2.0, 7.3, true)];
    // the stone plinth reaches out past the walls, furthest under the porch (kit hall(): porch 2.2)
    case 'hall': return [b(0, 1.1, s.w + 3, s.d + 4.2)];
    // the great hall: walls and plinth sides solid, the porch walkable (the zone lays a veranda on it), with its
    // row of pillars and the offering box out on it
    case 'temple': {
      const n = Math.round(s.w / 3.6), out = [b(0, 0, s.w + 3, s.d + 1), b(0, s.d / 2 + 1.6, 2.3, 1.2, true)];
      for (let i = 0; i <= n; i++) out.push(c(-s.w / 2 + (s.w * i) / n, s.d / 2 + 4.4, 0.32));
      return out;
    }
    case 'barracks': return [b(0, 0, 13.5, 8.9)]; // the plinth
    case 'hut': return [b(0, 0, 4.6, 3.6)];
    case 'keep': return [b(0, 0, 32 * k, 27 * k)];
    case 'pagoda': return [b(0, 0, 9.4 * k, 9.4 * k)];
    case 'belltower': return [b(0, 0, 5, 5)];
    case 'pavilion': return [c(-1.9, -1.9, 0.3), c(1.9, -1.9, 0.3), c(-1.9, 1.9, 0.3), c(1.9, 1.9, 0.3)];
    case 'statue': return [c(0, 0, 2.7 * k)];
    case 'shrine': return [b(0, 0, 1.95 * k, 1.75 * k)]; // the plinth (the offering box stands on it)
    case 'jizo': return [b(0, 0, (s.n || 3) * 0.62, 0.6)];
    // a yukimi's wide hat is at chest height; a stone lantern's footing is the widest part below the head.
    // `edge`: how far the boundary dressing keeps clear of it. A lamp post stands just behind the fence line and lets
    // the fence run on past it; a stone lantern takes a narrow gap in the fence or the bamboo, not a 3 m hole.
    // one on a masonry pier (`pier` wide, its coping slab 0.14 wider) is stopped by the pier; the map leaves it out
    case 'lantern': return [s.pier ? { ...b(0, 0, s.pier + 0.14, s.pier + 0.14, true), edge: 0.45 }
      : { ...c(0, 0, s.kind === 'yukimi' ? 0.9 : s.kind === 'post' ? 0.2 : s.big ? 0.75 : 0.5), edge: s.kind === 'post' ? 0 : 0.45 }];
    case 'torii': return [c(-2.5 * k, 0, 0.42 * k), c(2.5 * k, 0, 0.42 * k)];
    case 'gate': {
      // a temple gate's four pillars stand 1.2 either side of the gateway's line
      const g = GATE[s.style], o = s.w / 2 + g.post[0] / 2, d = s.style === 'temple' ? 3.05 : g.post[1];
      return [b(-o, 0, g.post[0], d), b(o, 0, g.post[0], d)];
    }
    case 'wall': return wallSegments(s).map(({ x, z, w, d, rot }) => ({ x, z, w, d, rot }));
    case 'tower': return s.kind === 'watch' ? [b(0, 0, 3, 3), c(2.6, 0.55, 0.45)] : [b(0, 0, 6.6, 6.6)]; // + the ladder's foot (+x)
    case 'stall': return [b(0, 0, 3.4, 2.1)];
    case 'well': return [c(0, 0, 1.0)];
    case 'crates': return [c(0, 0, 0.75 + 0.14 * (s.n || 3))];
    case 'barrels': return [c(0, 0, 0.6 + 0.15 * (s.n || 2))];
    case 'baskets': return [c(0, 0, 0.8)];
    case 'cart': return [b(0, 0.7, 2.0, 4.4)]; // wheels out to the sides, shafts out in front
    case 'woodpile': return [b(0, 0, 2.6, 1.1)];
    case 'haystack': return [c(0, 0, 1.3)];
    case 'scarecrow': return [b(0, 0, 1.8, 0.36)]; // arms out at shoulder height
    case 'signpost': return [c(0, 0, 0.22), b(0.35, 0.06, 1.26, 0.2, true)]; // and the board
    case 'rack': return [b(0, 0.15, 2.8, 1.0)]; // frame plus the feet and footboard out front
    case 'barricade': return [b(0, 0, 3.3, 1.8)]; // the stakes splay out either side
    // the canvas with its hem pegged out either side, and the guy ropes running out from the uprights at both ends
    // (kit tent(): pegs 0.32 past the hem, end pegs 1.45 past the uprights and 0.8 to either side)
    case 'tent': return [b(0, 0, 4.6, 4.8), b(-2.95, 0, 1.5, 1.8, true), b(2.95, 0, 1.5, 1.8, true)];
    case 'brazier': return [c(0, 0, s.big ? 0.8 : 0.6)];
    case 'torch': return [c(0, 0, 0.22)];
    case 'banner': return [c(0, 0, 0.18)];
    case 'drum': return [c(0, 0, 1.1)];
    case 'curtain': return [b(0, 0, s.w, 0.5)];
    case 'censer': return [c(0, 0, 0.95)];
    case 'fallen': return [b(0, 0, 1.7, s.len * 1.15)]; // stalks lie skewed and staggered, longer than the nominal length
    // a stone stands proud of the ground by about two thirds of its height (kit rocks())
    case 'rocks': return rockCluster(s).filter((r) => r.r * r.sy > 0.18).map((r) => ({ x: r.x, z: r.z, r: r.r * 0.88 }));
    case 'checkpoint': return [c(0, 0, 0.5)];
    case 'garden': return [c(0, 0, 0.9), c(s.r * 0.45, -s.r * 0.3, 0.48)]; // its two stones
    default: return [];
  }
}
