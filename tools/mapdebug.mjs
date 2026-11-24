// Top-down debug render of the baked navigation data. usage: node tools/mapdebug.mjs out.png [x0 x1 z0 z1 scale]
import zlib from 'node:zlib';
import fs from 'node:fs';
const t0 = Date.now();
const nav = await import('../src/world/nav.js');
const { ZONES } = await import('../src/world/zones/index.js');
console.log('bake ms', Date.now() - t0);
const a = process.argv.slice(2);
const out = a[0] || 'map.png';
const X0 = Number(a[1] ?? -60), X1 = Number(a[2] ?? 445), Z0 = Number(a[3] ?? -262), Z1 = Number(a[4] ?? 292), S = Number(a[5] ?? 2);
const W = Math.round((X1 - X0) * S), H = Math.round((Z1 - Z0) * S);
const px = new Uint8Array(W * H * 3);
const set = (i, j, r, g, b, al = 1) => { if (i < 0 || j < 0 || i >= W || j >= H) return; const o = (j * W + i) * 3; px[o] = px[o] * (1 - al) + r * al; px[o + 1] = px[o + 1] * (1 - al) + g * al; px[o + 2] = px[o + 2] * (1 - al) + b * al; };
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = X0 + (i + 0.5) / S, z = Z0 + (j + 0.5) / S;
  const h = nav.terrainAt(x, z), w = nav.walkAt(x, z), wl = nav.waterLevelAt(x, z), g = nav.groundAt(x, z);
  const hx = nav.terrainAt(x + 1, z) - h, hz = nav.terrainAt(x, z + 1) - h;
  const sh = Math.max(0.35, Math.min(1.25, 0.85 - hx * 0.35 - hz * 0.2));
  let r = 70 + h * 3.2, gg = 110 + h * 2.2, b = 60 + h * 2.4;
  r *= sh; gg *= sh; b *= sh;
  if (wl > h + 0.02) { r = 40; gg = 110; b = 170; }
  if (w < 0) { r = r * 0.35 + 215 * 0.65; gg = gg * 0.35 + 190 * 0.65; b = b * 0.35 + 130 * 0.65; if (g > h + 0.3) { r = 190; gg = 90; b = 60; } }
  if (Math.abs(w) < 0.22) { r = 250; gg = 250; b = 250; }
  set(i, j, Math.min(255, r), Math.min(255, gg), Math.min(255, b));
}
const P = (x, z) => [Math.round((x - X0) * S), Math.round((z - Z0) * S)];
const circle = (x, z, rad, c, fill = false) => { const [ci, cj] = P(x, z), R = rad * S; for (let dj = -Math.ceil(R); dj <= R; dj++) for (let di = -Math.ceil(R); di <= R; di++) { const d = Math.hypot(di, dj); if (fill ? d <= R : Math.abs(d - R) < 0.8) set(ci + di, cj + dj, ...c, fill ? 0.85 : 1); } };
const boxf = (f, c) => { const hw = f.w / 2, hd = f.d / 2, R = Math.hypot(hw, hd), cs = Math.cos(f.rot || 0), sn = Math.sin(f.rot || 0); const [ci, cj] = P(f.x, f.z); for (let dj = -Math.ceil(R * S); dj <= R * S; dj++) for (let di = -Math.ceil(R * S); di <= R * S; di++) { const dx = di / S, dz = dj / S; const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) set(ci + di, cj + dj, ...c, 0.85); } };
const COL = { house: [120, 60, 40], wall: [60, 60, 70], gate: [230, 40, 40], tower: [40, 40, 50] };
for (const zn of ZONES) {
  for (const s of zn.structures) for (const f of nav.NAV ? (await import('../src/world/zones/footprints.js')).footprint(s) : []) { const c = COL[s.type] || [90, 70, 110]; if (f.r) circle(f.x, f.z, Math.max(f.r, 0.5), c, true); else boxf(f, c); }
  for (const t of zn.trees || []) circle(t[1], t[2], 1.6 * (t[3] || 1), t[0] === 'momiji' ? [220, 70, 40] : t[0] === 'pine' ? [20, 90, 60] : [230, 160, 60], true);
  for (const e of zn.encounters) { circle(e.arena.x, e.arena.z, e.arena.r, [255, 0, 0]); circle(e.trigger.x, e.trigger.z, e.trigger.r, [255, 220, 0]); for (const w of e.waves) for (const [k, x, z] of w.list) circle(x, z, 0.6, [255, 0, 255], true); }
  for (const c of zn.checkpoints) circle(c.x, c.z, 1, [0, 255, 255], true);
  for (const c of zn.camera) circle(c.x, c.z, 0.7, [255, 255, 255], true);
  const r = zn.rect; for (let x = r.x0; x <= r.x1; x += 0.5) { set(...P(x, r.z0), 255, 255, 0, 0.6); set(...P(x, r.z1), 255, 255, 0, 0.6); } for (let z = r.z0; z <= r.z1; z += 0.5) { set(...P(r.x0, z), 255, 255, 0, 0.6); set(...P(r.x1, z), 255, 255, 0, 0.6); }
}
// grid ticks every 20 m
for (let x = Math.ceil(X0 / 20) * 20; x <= X1; x += 20) for (let z = Math.ceil(Z0 / 20) * 20; z <= Z1; z += 20) { const [i, j] = P(x, z); for (let d = -2; d <= 2; d++) { set(i + d, j, 0, 0, 0); set(i, j + d, 0, 0, 0); } }
// PNG encode
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let j = 0; j < H; j++) { raw[j * (W * 3 + 1)] = 0; Buffer.from(px.buffer, j * W * 3, W * 3).copy(raw, j * (W * 3 + 1) + 1); }
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', out, W, H, 'total ms', Date.now() - t0);
