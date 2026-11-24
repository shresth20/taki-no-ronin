import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { G, useUI } from '../core/state.js';
import { ZONES } from '../world/zones/index.js';
import { walkAt, groundAt, zoneAt, listBlockers } from '../world/nav.js';

/* Developer overlay (toggle with the ` key or ?debug). Shows what the engine believes about the world:
   walkable area, solid footprints, closed gates and wards, zone bounds, spawn points, triggers, the camera's view on
   the ground, streaming status, frame rate and renderer memory. The buttons jump straight to any zone.            */
const SIZE = 250, SCALE = 3.2; // px, px per metre

export default function Debug() {
  const on = useUI((s) => s.debug);
  const canvas = useRef(null);
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    let frames = 0, last = performance.now(), raf = 0, fps = 0;
    const tick = () => { frames++; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    const draw = () => {
      const now = performance.now();
      fps = Math.round((frames * 1000) / (now - last));
      frames = 0; last = now;
      const P = G.player, W = G.world, c = canvas.current;
      if (!P || !W || !c) return;
      const ctx = c.getContext('2d'), px = P.pos.x, pz = P.pos.z;
      const X = (x) => SIZE / 2 + (x - px) * SCALE, Z = (z) => SIZE / 2 + (z - pz) * SCALE;
      // walk mask
      const img = ctx.createImageData(SIZE, SIZE), step = 2;
      for (let j = 0; j < SIZE; j += step) for (let i = 0; i < SIZE; i += step) {
        const w = walkAt(px + (i - SIZE / 2) / SCALE, pz + (j - SIZE / 2) / SCALE);
        const col = w < 0 ? [70, 150, 96] : w < 0.35 ? [240, 240, 240] : [30, 34, 44];
        for (let b = 0; b < step; b++) for (let a = 0; a < step; a++) { const o = ((j + b) * SIZE + i + a) * 4; img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 215; }
      }
      ctx.putImageData(img, 0, 0);
      // solid footprints of loaded zones
      ctx.strokeStyle = '#ffb14a'; ctx.lineWidth = 1;
      for (const h of W.streamer.handles()) for (const f of h.solids) {
        if (Math.abs(f.x - px) > 60 || Math.abs(f.z - pz) > 60) continue;
        ctx.save(); ctx.translate(X(f.x), Z(f.z));
        if (f.r !== undefined) { ctx.beginPath(); ctx.arc(0, 0, f.r * SCALE, 0, 6.3); ctx.stroke(); }
        else { ctx.rotate(-(f.rot || 0)); ctx.strokeRect((-f.w / 2) * SCALE, (-f.d / 2) * SCALE, f.w * SCALE, f.d * SCALE); }
        ctx.restore();
      }
      for (const cdr of W.colliders) { if (Math.abs(cdr.x - px) > 45 || Math.abs(cdr.z - pz) > 45) continue; ctx.beginPath(); ctx.arc(X(cdr.x), Z(cdr.z), cdr.r * SCALE, 0, 6.3); ctx.stroke(); }
      // closed gates and wards
      ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 3;
      for (const b of listBlockers()) { ctx.beginPath(); ctx.moveTo(X(b.ax), Z(b.az)); ctx.lineTo(X(b.bx), Z(b.bz)); ctx.stroke(); }
      ctx.lineWidth = 1;
      for (const z of ZONES) {
        const r = z.rect;
        ctx.strokeStyle = '#ffe14a'; ctx.setLineDash([4, 4]); ctx.strokeRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * SCALE, (r.z1 - r.z0) * SCALE); ctx.setLineDash([]);
        for (const e of z.encounters) {
          ctx.strokeStyle = '#ff6a6a'; ctx.beginPath(); ctx.arc(X(e.arena.x), Z(e.arena.z), e.arena.r * SCALE, 0, 6.3); ctx.stroke();
          ctx.strokeStyle = '#ffe14a'; ctx.beginPath(); ctx.arc(X(e.trigger.x), Z(e.trigger.z), e.trigger.r * SCALE, 0, 6.3); ctx.stroke();
          ctx.fillStyle = '#ff4ad8'; for (const w of e.waves) for (const [, x, zz] of w.list) ctx.fillRect(X(x) - 2, Z(zz) - 2, 4, 4);
        }
        ctx.fillStyle = '#5fe8ff'; for (const cp of z.checkpoints) { ctx.beginPath(); ctx.arc(X(cp.x), Z(cp.z), 4, 0, 6.3); ctx.fill(); }
        ctx.fillStyle = '#7dff7a'; ctx.fillRect(X(z.entry.x) - 3, Z(z.entry.z) - 3, 6, 6);
        ctx.fillStyle = '#ff9a3a'; ctx.fillRect(X(z.exit.x) - 3, Z(z.exit.z) - 3, 6, 6);
      }
      for (const e of G.enemies) { ctx.fillStyle = e.alive ? '#ff2a2a' : '#663'; ctx.beginPath(); ctx.arc(X(e.pos.x), Z(e.pos.z), 3, 0, 6.3); ctx.fill(); }
      // what the camera sees, projected on the ground at the player's level
      plane.constant = -P.pos.y;
      ctx.strokeStyle = '#ffffff'; ctx.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].forEach(([u, v], i) => {
        ray.setFromCamera({ x: u, y: v }, G.camera);
        const p = ray.ray.intersectPlane(plane, hit) || ray.ray.at(60, hit);
        i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z));
      });
      ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, 3.5, 0, 6.3); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(SIZE / 2, SIZE / 2); ctx.lineTo(SIZE / 2 + Math.sin(P.yaw) * 12, SIZE / 2 + Math.cos(P.yaw) * 12); ctx.stroke();
      const gi = G.gl.info;
      setInfo({
        fps, x: px.toFixed(1), y: P.pos.y.toFixed(2), z: pz.toFixed(1), zone: zoneAt(px, pz), walk: walkAt(px, pz).toFixed(2), ground: groundAt(px, pz).toFixed(2),
        chunks: W.streamer.status(), calls: gi.render.calls, tris: gi.render.triangles, geo: gi.memory.geometries, tex: gi.memory.textures, progs: gi.programs?.length ?? 0,
        phase: useUI.getState().phase, state: P.state, enemies: G.enemies.length, yaw: G.rig.yaw.toFixed(2), enc: G.journey.active?.enc.id || '—',
      });
    };
    const t = setInterval(draw, 220);
    return () => { clearInterval(t); cancelAnimationFrame(raf); };
  }, [on]);
  if (!on) return null;
  return (
    <div className="dbg">
      <canvas ref={canvas} width={SIZE} height={SIZE} />
      {info && (
        <pre>
          {`${info.fps} fps   calls ${info.calls}   tris ${(info.tris / 1000).toFixed(0)}k\ngeo ${info.geo}  tex ${info.tex}  programs ${info.progs}\npos ${info.x}, ${info.y}, ${info.z}   zone ${info.zone} ${ZONES[info.zone].id}\nwalk ${info.walk}  ground ${info.ground}  cam yaw ${info.yaw}\nphase ${info.phase} · ${info.state} · enemies ${info.enemies} · enc ${info.enc}\nchunks ${info.chunks.map((s, i) => i + ':' + s[0]).join(' ')}  (l loaded, b building, i idle)`}
        </pre>
      )}
      <div className="dbg-row">{ZONES.map((z) => <button key={z.id} id={`dbg-z${z.index}`} onClick={() => G.director.debugJump(z.index)}>{z.index} {z.kanji}</button>)}</div>
      <p>green walkable · white edge · orange solids · red gates/wards · yellow zone bounds and triggers · pink spawns · cyan lamps · white camera view</p>
    </div>
  );
}
