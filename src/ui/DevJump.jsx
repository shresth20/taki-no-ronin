import { useEffect, useRef, useState } from 'react';
import { G, useUI } from '../core/state.js';
import { ZONES, CHECKPOINTS } from '../world/zones/index.js';
import { planJump } from '../game/devjump.js';

/* Tester teleport layer for the journey map (?dev=1). It lies over the map in the same world coordinates:
   hover to see where you would land and what the jump would skip, click to go there. Shift+click also counts the
   fight at that spot as won, so you can walk an arena without fighting it.                                       */
export default function DevJump({ vb, mk = 1 }) {
  const svg = useRef(null);
  const isTouch = useUI((s) => s.isTouch);
  const [aim, setAim] = useState(null); // { x, z, plan } under the pointer, in world metres
  const last = useRef(null), raf = useRef(0);

  const toWorld = (cx, cy) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { x: p.x, z: p.y };
  };
  const refresh = () => {
    raf.current = 0;
    const l = last.current;
    if (!l) return;
    const w = toWorld(l.cx, l.cy);
    if (w) setAim({ ...w, plan: planJump(w.x, w.z, { skipHere: l.shift }) });
  };
  const queue = (cx, cy, shift) => {
    last.current = { cx, cy, shift };
    if (!raf.current) raf.current = requestAnimationFrame(refresh);
  };
  // holding Shift changes the plan without moving the pointer
  useEffect(() => {
    const k = (e) => { if (e.key === 'Shift' && last.current && last.current.shift !== e.shiftKey) queue(last.current.cx, last.current.cy, e.shiftKey); };
    window.addEventListener('keydown', k);
    window.addEventListener('keyup', k);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('keyup', k); cancelAnimationFrame(raf.current); };
  }, []);
  // the map zoomed or panned under a still pointer: aim at what is under it now
  useEffect(() => { if (last.current) queue(last.current.cx, last.current.cy, last.current.shift); }, [vb.x, vb.z, vb.w, vb.h]);

  const jump = (e) => {
    const w = toWorld(e.clientX, e.clientY);
    const plan = w && planJump(w.x, w.z, { skipHere: e.shiftKey });
    if (!plan) { queue(e.clientX, e.clientY, e.shiftKey); return; }
    G.director?.devTeleport(plan);
  };

  const plan = aim?.plan, z = plan && ZONES[plan.zone], f = plan?.fight;
  const cp = plan && CHECKPOINTS.find((c) => c.id === plan.checkpoint);
  return (
    <>
      <svg
        ref={svg}
        className="map-svg dev-jump"
        viewBox={`${vb.x} ${vb.z} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={(e) => queue(e.clientX, e.clientY, e.shiftKey)}
        onPointerDown={(e) => queue(e.clientX, e.clientY, e.shiftKey)}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') { last.current = null; setAim(null); } }}
        onClick={jump}
      >
        {plan && (
          <g className="dj-aim">
            {f && <circle cx={f.arena.x} cy={f.arena.z} r={f.arena.r} className="dj-arena" />}
            {plan.snapped > 1.5 && <path d={`M${aim.x} ${aim.z} L${plan.x} ${plan.z}`} className="dj-snap" />}
            <g transform={`translate(${plan.x} ${plan.z}) scale(${mk})`} className={f ? 'dj-land fight' : 'dj-land'}>
              <circle r="5.5" />
              <path d="M-9 0 H-3 M3 0 H9 M0 -9 V-3 M0 3 V9" />
              <path d="M0 -4 L3 3 L0 1.4 L-3 3 Z" className="dj-dir" transform={`rotate(${180 - (plan.yaw * 180) / Math.PI})`} />
            </g>
          </g>
        )}
        {aim && !plan && <g transform={`translate(${aim.x} ${aim.z}) scale(${mk})`} className="dj-none"><path d="M-5 -5 L5 5 M5 -5 L-5 5" /></g>}
      </svg>
      <div className="dj-panel" aria-live="polite">
        <b>Dev jump</b>
        {plan ? (
          <>
            <span className="dj-zone">{z.index} · {z.kanji} {z.name}</span>
            <span>x {plan.x.toFixed(1)} · z {plan.z.toFixed(1)}{plan.snapped > 1.5 ? ` · nearest ground ${plan.snapped.toFixed(0)} m` : ''}</span>
            <span>{plan.skipped} {plan.skipped === 1 ? 'fight' : 'fights'} won before · lamp: {cp?.label}</span>
            <span className={f ? 'dj-fight' : ''}>{f ? `Starts ${f.label}${f.boss ? ' (boss)' : ''} at its trigger` : plan.wonHere.length ? `Free roam · ${plan.wonHere[0].label} counted as won` : 'Free roam'}</span>
          </>
        ) : (
          <span>{aim ? 'No ground within reach of this point' : `${isTouch ? 'Tap' : 'Point at'} any place on the road`}</span>
        )}
        <small>{isTouch ? 'Tap to jump there' : 'Click to jump · Shift+click also wins the fight there'}</small>
      </div>
    </>
  );
}
