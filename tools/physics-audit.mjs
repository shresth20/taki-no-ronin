// Physics audit: builds every zone's architecture headless (no browser) and checks, at every spot a character can
// stand, that (a) nothing drawn passes through the body between knee and head height (THROUGH: a footprint in
// zones/footprints.js or a solid in nav.js is smaller than its mesh), and (b) the feet rest on what is drawn
// (SINK / FLOAT: groundAt disagrees with the visible deck, tread, floor or stone).
// usage: node tools/physics-audit.mjs [zoneIndex ...] [--step 0.3] [--verbose] [--at x,z]
//   --at x,z   dumps one spot: ground heights, the geometry in its column, what touches the body, solids nearby
// A few FLOAT spots beside the meadow's low stones are expected: a body steps up onto a stone as it reaches it.
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => ({ data: [] }) }) }) };
const nav = await import(ROOT + '/src/world/nav.js');
const { BUILD, bridge, landing, stairway, crags } = await import(ROOT + '/src/world/kit/build.js');
const { Parts, clothBuffers } = await import(ROOT + '/src/world/kit/core.js');
const { ZONES } = await import(ROOT + '/src/world/zones/index.js');
const { mulberry32, clamp } = await import(ROOT + '/src/core/util.js');

const args = process.argv.slice(2);
const STEP = args.includes('--step') ? +args[args.indexOf('--step') + 1] : 0.3;
const VERBOSE = args.includes('--verbose');
const zonesWanted = args.filter((a) => /^\d$/.test(a)).map(Number);
const CHAR_R = 0.38; // capsule radius (physics.js createCharacter)
const BODY_R = 0.26; // the visible body: torso/hips, a little inside the capsule
const BAND = [0.28, 1.62]; // the body above the feet
const SINK = 0.07, FLOAT = 0.09;

function distSolid(f, x, z) {
  if (f.poly) {
    // signed distance to a convex polygon
    let d = 1e9, inside = true;
    const P = f.poly;
    for (let i = 0; i < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length], vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      d = Math.min(d, Math.hypot(x - ax - vx * t, z - az - vz * t));
      if (vx * (z - az) - vz * (x - ax) < 0) inside = false;
    }
    return inside ? -d : d;
  }
  if (f.r !== undefined) return Math.hypot(x - f.x, z - f.z) - f.r;
  const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0), dx = x - f.x, dz = z - f.z;
  const qx = Math.abs(dx * c - dz * s) - f.w / 2, qz = Math.abs(dx * s + dz * c) - f.d / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

function buildCtx(zone) {
  const g = nav.NAV.GRIDS[zone.index];
  const ctx = {
    P: new Parts(), glow: new Parts(), cloth: clothBuffers(), sprites: [], lights: [], meshes: [], spin: [], gates: [], marks: [], rocks: [], stalks: [], tufts: [],
    Y: nav.terrainAt, T: nav.terrainAt, rnd: mulberry32(9000 + zone.index * 131), zone,
    W: (x, z) => g.W[clamp(Math.round(z - g.z0), 0, g.nz - 1) * g.nx + clamp(Math.round(x - g.x0), 0, g.nx - 1)],
  };
  const src = []; // part index -> label
  const tag = (label, fn) => { const a = ctx.P.list.length, r0 = ctx.rocks.length; fn(); for (let i = a; i < ctx.P.list.length; i++) src[i] = label; for (let i = r0; i < ctx.rocks.length; i++) ctx.rocks[i].src = label; };
  for (const s of zone.structures) { const b = BUILD[s.type]; if (b) tag(`${s.type}${s.kind ? ':' + s.kind : ''}${s.id ? '#' + s.id : ''} @${s.x?.toFixed?.(1)},${s.z?.toFixed?.(1)}`, () => b(s, ctx)); }
  for (const s of zone.walk) {
    const lbl = `${s.landing ? 'landing' : s.deck ? 'bridge:' + s.deck : s.stairs ? 'stairs' : ''}#${s.id || '?'} @${(s.pts?.[0] || [s.x, s.z]).slice(0, 2).map((v) => v.toFixed(1))}`;
    if (s.landing) tag(lbl, () => landing(s, ctx));
    else if (s.deck) tag(lbl, () => bridge(s, ctx));
    else if (s.stairs) tag(lbl, () => stairway(s, ctx));
  }
  for (const t of zone.terrain || []) if (t.op === 'gorge' || t.op === 'cut') tag('crags:' + t.op, () => crags(t, ctx));
  // the mill wheel and other spinners, in their rest pose
  for (const sp of ctx.spin) {
    const base = new (ctx.P.base.constructor)().makeRotationY(sp.rot).setPosition(sp.x, sp.y, sp.z);
    for (const p of sp.parts) { ctx.P.list.push({ ...p, matrix: p.matrix.clone().premultiply(base) }); src[ctx.P.list.length - 1] = 'spinner'; }
  }
  return { ctx, src };
}

/* ---------- triangles in a spatial hash ---------- */
function indexParts(list) {
  const tris = []; // per part: Float32Array of 9*n
  const cells = new Map();
  const key = (i, j) => (i + 4096) * 8192 + (j + 4096);
  list.forEach((p, pi) => {
    const g = p.geometry, P = g.attributes.position, I = g.index, e = p.matrix.elements;
    const n = I ? I.count : P.count, out = new Float32Array(n * 3);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let k = 0; k < n; k++) {
      const v = I ? I.getX(k) : k, x = P.getX(v), y = P.getY(v), z = P.getZ(v);
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      out[k * 3] = wx; out[k * 3 + 1] = wy; out[k * 3 + 2] = wz;
      if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
    }
    tris[pi] = out;
    for (let i = Math.floor(x0); i <= Math.floor(x1); i++) for (let j = Math.floor(z0); j <= Math.floor(z1); j++) {
      const k = key(i, j);
      let a = cells.get(k);
      if (!a) cells.set(k, (a = []));
      a.push(pi);
    }
  });
  return { tris, cells, key };
}
/** vertical line at (x,z): per part, the [min,max] height where it is inside (convex parts) */
function column(idx, rocks, x, z) {
  const out = [];
  const ids = idx.cells.get(idx.key(Math.floor(x), Math.floor(z)));
  if (ids) for (const pi of ids) {
    const T = idx.tris[pi];
    let lo = 1e9, hi = -1e9;
    for (let k = 0; k < T.length; k += 9) {
      const ax = T[k], az = T[k + 2], bx = T[k + 3], bz = T[k + 5], cx = T[k + 6], cz = T[k + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * T[k + 1] + v * T[k + 4] + w * T[k + 7];
      if (y < lo) lo = y; if (y > hi) hi = y;
    }
    if (hi >= lo) out.push([lo, hi, pi]);
  }
  for (const r of rocks) {
    // rockGeometry: an icosphere of radius ~0.78..1.33, flattened below -0.2; take radius 0.95 as its body
    const c = Math.cos(r.a), s = Math.sin(r.a), dx = x - r.x, dz = z - r.z;
    const lx = (dx * c - dz * s) / (r.sx * 0.95), lz = (dx * s + dz * c) / (r.sz * 0.95), q = lx * lx + lz * lz;
    if (q >= 1) continue;
    const h = Math.sqrt(1 - q) * r.sy * 0.95;
    out.push([r.y - Math.min(h, 0.2 * r.sy), r.y + h, -1, r]);
  }
  return out;
}

// every zone's parts in one index: a bridge built by one zone may reach into the next
let ALL = null;
async function allParts() {
  if (ALL) return ALL;
  const list = [], src = [], rocks = [];
  for (const z of ZONES) { const { ctx, src: s } = buildCtx(z); for (let i = 0; i < ctx.P.list.length; i++) { list.push(ctx.P.list[i]); src.push(s[i]); } rocks.push(...ctx.rocks); }
  // the hand-built valley of zone 00: its rocks are instanced icospheres, its props plain meshes
  const { createRocks, createProps } = await import(ROOT + '/src/world/props.js');
  const THREE = await import('file://' + ROOT + '/node_modules/three/build/three.module.js');
  const R = createRocks(), Pp = createProps(), m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();
  R.group.traverse((o) => {
    if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); list.push({ geometry: o.geometry, matrix: m.clone() }); src.push('valley rock'); }
    else if (o.isMesh) { o.updateMatrixWorld(true); list.push({ geometry: o.geometry, matrix: o.matrixWorld.clone() }); src.push('valley pillar/rock'); }
  });
  Pp.group.updateMatrixWorld(true);
  Pp.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry.attributes.position) { list.push({ geometry: o.geometry, matrix: o.matrixWorld.clone() }); src.push('valley prop ' + (o.parent?.name || '') + ' @' + o.getWorldPosition(new THREE.Vector3()).toArray().map((v) => v.toFixed(1))); } });
  return (ALL = { idx: indexParts(list), src, ctx: { rocks } });
}
async function auditZone(zone) {
  const { idx, src, ctx } = await allParts();
  const solids = ZONES.flatMap((z) => (Math.abs(z.index - zone.index) <= 1 ? nav.zoneSolids(z) : [])); // streamed in together
  if (zone.index === 0) solids.push(...(await import(ROOT + '/src/world/props.js')).createRocks().colliders, ...(await import(ROOT + '/src/world/props.js')).createProps().colliders);
  const rocksNear = (x, z) => ctx.rocks.filter((r) => Math.abs(r.x - x) < r.sx * 1.4 + 1 && Math.abs(r.z - z) < r.sz * 1.4 + 1);
  const r = zone.rect, issues = new Map();
  const note = (kind, label, amt, x, z) => {
    const k = kind + '|' + label;
    let it = issues.get(k);
    if (!it) issues.set(k, (it = { kind, label, n: 0, max: 0, at: null }));
    it.n++;
    if (amt > it.max) { it.max = amt; it.at = [+x.toFixed(2), +z.toFixed(2)]; }
  };
  const labelOf = (iv) => (iv[2] >= 0 ? src[iv[2]] || 'part' : 'rock:' + (iv[3].src || 'planted'));
  // rings from the centre out to the body's radius: penetration = how far inside the body the geometry reaches
  const ring = [[0, 0, BODY_R]];
  for (const rr of [0.1, 0.18, BODY_R]) for (let i = 0; i < 12; i++) ring.push([Math.cos((i / 12) * 6.283) * rr, Math.sin((i / 12) * 6.283) * rr, BODY_R - rr]);
  let samples = 0;
  for (let z = r.z0 + STEP / 2; z < r.z1; z += STEP) for (let x = r.x0 + STEP / 2; x < r.x1; x += STEP) {
    if (nav.zoneAt(x, z) !== zone.index) continue;
    if (nav.walkAt(x, z) > 0) continue;
    if (solids.some((f) => (f.r !== undefined ? Math.abs(f.x - x) < f.r + 1 && Math.abs(f.z - z) < f.r + 1 : Math.abs(f.x - x) < f.w + f.d && Math.abs(f.z - z) < f.w + f.d) && distSolid(f, x, z) < CHAR_R)) continue;
    samples++;
    const g = nav.groundAt(x, z), rk = rocksNear(x, z);
    // (a) body: nothing visible inside the torso column
    const pen = new Map();
    for (const [ox, oz, depth] of ring) {
      for (const iv of column(idx, rk, x + ox, z + oz)) {
        if (iv[1] > g + BAND[0] && iv[0] < g + BAND[1]) { const l = labelOf(iv); if (!(pen.get(l) >= depth)) pen.set(l, depth); }
      }
    }
    for (const [l, d] of pen) if (d > 0.02) note('THROUGH', l, d + 0.04, x, z);
    // (b) feet: the highest surface under the feet (below knee height) should be where the feet are
    const col = column(idx, rk, x, z);
    let top = nav.terrainAt(x, z), who = 'terrain';
    const wl = nav.waterLevelAt(x, z);
    for (const iv of col) if (iv[1] < g + BAND[0] + 0.02 && iv[1] > top) { top = iv[1]; who = labelOf(iv); }
    // a tread overlaps the next by 1.5 cm (kit stairway()): a foot right on that seam is not sunk into anything
    // a joint between two slabs is not a gap a foot falls into: float only if nothing within 4 cm holds the foot up
    const held = (px, pz) => column(idx, rk, px, pz).some((iv) => iv[1] < g + BAND[0] + 0.02 && iv[1] >= g - FLOAT);
    const sunk = (px, pz) => column(idx, rk, px, pz).some((iv) => iv[1] < g + BAND[0] + 0.02 && iv[1] > g + SINK);
    if (top > g + SINK && sunk(x + 0.04, z) && sunk(x - 0.04, z) && sunk(x, z + 0.04) && sunk(x, z - 0.04)) note('SINK', who, top - g, x, z);
    else if (top < g - FLOAT && !(wl > top + 0.05 && wl > g - 0.6) && ![[0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]].some(([a, b]) => held(x + a, z + b))) note('FLOAT', who === 'terrain' ? 'over terrain (deck?)' : who, g - top, x, z);
  }
  return { samples, issues: [...issues.values()].sort((a, b) => b.n * b.max - a.n * a.max) };
}

const at = args.includes('--at') ? args[args.indexOf('--at') + 1].split(',').map(Number) : null;
if (at) {
  const [x, z] = at, zone = ZONES[nav.zoneAt(x, z)], { ctx, src, idx } = await allParts();
  console.log(`zone ${zone.index} at ${x},${z}: groundAt=${nav.groundAt(x, z).toFixed(3)} terrainAt=${nav.terrainAt(x, z).toFixed(3)} walkAt=${nav.walkAt(x, z).toFixed(3)} water=${nav.waterLevelAt(x, z).toFixed(2)}`);
  for (const iv of column(idx, ctx.rocks, x, z)) console.log(`  [${iv[0].toFixed(3)}, ${iv[1].toFixed(3)}]  ${iv[2] >= 0 ? src[iv[2]] : 'rock ' + (iv[3].src || '')}`);
  const g = nav.groundAt(x, z);
  for (let i = 0; i < 16; i++) for (const rr of [0.1, 0.18, BODY_R]) {
    const ox = Math.cos((i / 16) * 6.283) * rr, oz = Math.sin((i / 16) * 6.283) * rr;
    for (const iv of column(idx, ctx.rocks, x + ox, z + oz)) if (iv[1] > g + BAND[0] && iv[0] < g + BAND[1]) console.log(`  body hit at offset ${ox.toFixed(2)},${oz.toFixed(2)}: [${iv[0].toFixed(2)}, ${iv[1].toFixed(2)}] ${iv[2] >= 0 ? src[iv[2]] : 'rock'}`);
  }
  const sol = nav.zoneSolids(zone).filter((f) => distSolid(f, x, z) < 3).map((f) => JSON.stringify(f) + ' d=' + distSolid(f, x, z).toFixed(2));
  console.log('  solids within 3 m:\n   ' + sol.join('\n   '));
  process.exit(0);
}
let total = 0;
for (const zone of ZONES) {
  if (zonesWanted.length && !zonesWanted.includes(zone.index)) continue;
  const t0 = Date.now();
  const { samples, issues } = await auditZone(zone);
  console.log(`\n=== zone ${zone.index} ${zone.id}: ${samples} standing spots, ${issues.length} issue groups (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  for (const it of issues) {
    if (!VERBOSE && it.n < 2 && it.max < 0.05) continue;
    total++;
    console.log(`  ${it.kind.padEnd(7)} ${it.label.padEnd(44)} spots=${String(it.n).padStart(4)} worst=${it.max.toFixed(2)}m at ${it.at}`);
  }
}
console.log(`\n${total} issue groups`);
