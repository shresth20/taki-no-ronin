import { useEffect, useMemo, useRef, useState } from 'react';
import { G, useUI } from '../core/state.js';
import { PARCHMENT } from '../assets/parchment.js';
import { ZONES, CHECKPOINTS } from '../world/zones/index.js';
import { footprint, wallSegments } from '../world/zones/footprints.js';
import DevJump from './DevJump.jsx';

/* Campaign overview: an ink-and-gold road map drawn from the very same zone files the world is built from,
   so every bend of the route, every bridge and every court is where it really is. North is up.
   It is its own screen: the gameplay camera never shows it and it is never used as a backdrop.            */
const VB = { x: -78, z: -272, w: 536, h: 572 };
const TINT = ['#7fb8a8', '#c9b46a', '#86ad5c', '#d08a5a', '#a8766a', '#7b6a9a'];
const BOSS = { 't-abbot': '寂', 'f-captain': '黒', 'c-lord': '鬼' };
// where each land's name and landmark glyph sit on the sheet (clear of the road)
const LABEL_AT = [[-70, -20], [-62, 196], [170, 246], [128, -52], [316, 62], [250, -150]];
const ICON_AT = [[-54, -52], [-36, 232], [262, 196], [170, -24], [410, 22], [424, -230]];
// zoom: 1 = the whole sheet; the view is a scale plus the map point at the middle of the sheet
const MAX_ZOOM = 4, ZOOM_STEP = 1.6;
const WHOLE = { s: 1, x: VB.x + VB.w / 2, z: VB.z + VB.h / 2 };

const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
const boxPath = (f) => {
  const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0), hw = f.w / 2, hd = f.d / 2;
  const pt = (lx, lz) => [f.x + lx * c + lz * s, f.z - lx * s + lz * c];
  return line([pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)]) + 'Z';
};

function Icon({ kind, x, z, k = 1 }) {
  const t = `translate(${x} ${z}) scale(${k})`;
  if (kind === 'falls') return <g transform={t} className="mk-ico"><path d="M-9 -16 L-9 10 M-3 -18 L-3 12 M3 -18 L3 12 M9 -16 L9 10" /><path d="M-14 13 Q-7 8 0 13 T14 13" /><path d="M-16 -17 L-11 -22 L11 -22 L16 -17" /></g>;
  if (kind === 'village') return <g transform={t} className="mk-ico"><path d="M-15 4 L-7 -6 L1 4 Z M-13 4 V12 H-1 V4" /><path d="M2 2 L10 -8 L18 2 Z M4 2 V12 H16 V2" /></g>;
  if (kind === 'bamboo') return <g transform={t} className="mk-ico"><path d="M-10 16 V-16 M0 16 V-20 M10 16 V-14" /><path d="M-10 -6 l7 -5 M0 -10 l8 -5 M0 0 l-8 -5 M10 -4 l7 -5 M-10 6 l-7 -5" /></g>;
  if (kind === 'temple') return <g transform={t} className="mk-ico"><path d="M-18 -4 Q-9 -6 0 -16 Q9 -6 18 -4 L13 0 H-13 Z" /><path d="M-11 0 V13 M11 0 V13 M-4 0 V13 M4 0 V13 M-15 13 H15" /></g>;
  if (kind === 'fort') return <g transform={t} className="mk-ico"><path d="M-16 14 V-4 H-10 V-10 H-4 V-4 H4 V-10 H10 V-4 H16 V14 Z" /><path d="M-4 14 V4 H4 V14" /></g>;
  return <g transform={t} className="mk-ico"><path d="M-16 16 L-12 4 H12 L16 16 Z" /><path d="M-14 4 Q-7 2 0 -3 Q7 2 14 4 M-10 -3 Q-5 -5 0 -9 Q5 -5 10 -3 M-6 -9 Q-3 -11 0 -15 Q3 -11 6 -9 M0 -15 V-21" /></g>;
}

// ink compass rose pinned to the sheet's top-left corner; the map is drawn north-up with east to the right
function Compass() {
  const arm = (r) => `rotate(${r})`;
  return (
    <svg className="map-compass" viewBox="-50 -50 100 100" role="img" aria-label="Compass: north is up">
      <circle r="30" className="ring" />
      <circle r="26.5" className="ring thin" />
      {[45, 135, 225, 315].map((r) => <g key={r} transform={arm(r)} className="pt minor"><path d="M0 -24 L3 -3 L0 0 Z" /><path d="M0 -24 L-3 -3 L0 0 Z" className="lit" /></g>)}
      {[90, 180, 270].map((r) => <g key={r} transform={arm(r)} className="pt"><path d="M0 -33 L5.5 -5.5 L0 0 Z" /><path d="M0 -33 L-5.5 -5.5 L0 0 Z" className="lit" /></g>)}
      <g className="pt north"><path d="M0 -33 L5.5 -5.5 L0 0 Z" /><path d="M0 -33 L-5.5 -5.5 L0 0 Z" className="lit" /></g>
      <circle r="2.6" className="hub" />
      <text className="north" x="0" y="-38">N</text>
      <text x="42" y="0">E</text>
      <text x="0" y="39">S</text>
      <text x="-42" y="0">W</text>
    </svg>
  );
}

export default function WorldMap({ onClose }) {
  const progress = useUI((s) => s.progress);
  const zone = useUI((s) => s.zone);
  const objective = useUI((s) => s.objective);
  const [pos, setPos] = useState({ x: 0, z: 0, yaw: 0 });
  useEffect(() => {
    const read = () => { const p = G.player; if (p) setPos({ x: p.pos.x, z: p.pos.z, yaw: p.yaw }); };
    read();
    const t = setInterval(read, 250);
    return () => clearInterval(t);
  }, []);
  const posRef = useRef(pos);
  posRef.current = pos;

  /* ---- zoom & pan: wheel, trackpad pinch / two-finger swipe, touch pinch, drag, the +/− buttons and keys ---- */
  const paper = useRef(null);
  const [view, setView] = useState(WHOLE);
  const viewRef = useRef(WHOLE), anim = useRef(0);
  const put = (v) => { viewRef.current = v; setView(v); };
  const sheet = () => { const r = paper.current?.getBoundingClientRect(); return r && r.width ? r : null; };
  // pixels per map metre at zoom s (the sheet fits the whole map at s = 1)
  const pxPerM = (r, s) => Math.min(r.width / VB.w, r.height / VB.h) * s;
  // never pan past the map's edges; a side that already fits on the sheet stays centred
  const fit = (s, x, z) => {
    s = Math.min(MAX_ZOOM, Math.max(1, s));
    const r = sheet();
    if (!r) return { s, x, z };
    const k = pxPerM(r, s), hw = r.width / k / 2, hh = r.height / k / 2;
    x = hw * 2 >= VB.w ? WHOLE.x : Math.min(VB.x + VB.w - hw, Math.max(VB.x + hw, x));
    z = hh * 2 >= VB.h ? WHOLE.z : Math.min(VB.z + VB.h - hh, Math.max(VB.z + hh, z));
    return { s, x, z };
  };
  const mapAt = (cx, cy) => {
    const r = sheet(), v = viewRef.current;
    if (!r) return v;
    const k = pxPerM(r, v.s);
    return { x: v.x + (cx - r.left - r.width / 2) / k, z: v.z + (cy - r.top - r.height / 2) / k };
  };
  // scale by f while the map point `at` stays under the same spot on screen
  const zoomed = (f, at) => {
    const v = viewRef.current, s = Math.min(MAX_ZOOM, Math.max(1, v.s * f)), q = v.s / s;
    return fit(s, at.x - (at.x - v.x) * q, at.z - (at.z - v.z) * q);
  };
  const zoomNow = (f, at) => { cancelAnimationFrame(anim.current); put(zoomed(f, at)); };
  const panBy = (dx, dy) => {
    const r = sheet(), v = viewRef.current;
    if (!r || v.s <= 1) return;
    const k = pxPerM(r, v.s);
    put(fit(v.s, v.x - dx / k, v.z - dy / k));
  };
  const glide = (to) => {
    cancelAnimationFrame(anim.current);
    const from = viewRef.current, t0 = performance.now();
    const tick = (t) => {
      const u = Math.min(1, (t - t0) / 220), e = 1 - (1 - u) ** 3;
      put({ s: from.s * (to.s / from.s) ** e, x: from.x + (to.x - from.x) * e, z: from.z + (to.z - from.z) * e });
      if (u < 1) anim.current = requestAnimationFrame(tick);
    };
    anim.current = requestAnimationFrame(tick);
  };
  // buttons and keys: the first step in from the whole map centres on where you stand; after that they zoom about
  // you while you are on the sheet, and about its middle once you have dragged yourself out of sight
  const stepZoom = (f) => {
    const v = viewRef.current, me = posRef.current, r = sheet();
    if (f > 1 && v.s <= 1.01) { glide(fit(v.s * f, me.x, me.z)); return; }
    const k = r ? pxPerM(r, v.s) : 0;
    const seen = r && Math.abs(me.x - v.x) * k < r.width / 2 - 24 && Math.abs(me.z - v.z) * k < r.height / 2 - 24;
    glide(zoomed(f, seen ? me : v));
  };

  // wheel / trackpad (pinch arrives as ctrl+wheel, a two-finger swipe as plain wheel) and Safari's pinch gesture.
  // These need non-passive listeners so the page itself never zooms or scrolls under the map.
  const fingers = useRef(new Map());
  useEffect(() => {
    const el = paper.current;
    const wheel = (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 400 : 1;
      const d = Math.max(-120, Math.min(120, e.deltaY * unit)) * (e.ctrlKey ? 0.012 : 0.0025);
      zoomNow(Math.exp(-d), mapAt(e.clientX, e.clientY));
    };
    let g = 1, gAt = null;
    const gStart = (e) => { e.preventDefault(); g = 1; gAt = mapAt(e.clientX, e.clientY); };
    const gChange = (e) => {
      e.preventDefault();
      if (fingers.current.size >= 2 || !(e.scale > 0)) return; // a touch pinch is handled by the pointer events
      zoomNow(e.scale / g, gAt || viewRef.current);
      g = e.scale;
    };
    const key = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Equal' || e.code === 'NumpadAdd') stepZoom(ZOOM_STEP);
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') stepZoom(1 / ZOOM_STEP);
      else if (e.code === 'Digit0' || e.code === 'Numpad0') glide(WHOLE);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', gStart);
    el.addEventListener('gesturechange', gChange);
    window.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('gesturestart', gStart);
      el.removeEventListener('gesturechange', gChange);
      window.removeEventListener('keydown', key);
      cancelAnimationFrame(anim.current);
    };
  }, []);

  // one finger or the mouse drags the map; two fingers pinch to zoom (and slide to move)
  const drag = useRef({ moved: false, pinch: 0 });
  const down = (e) => {
    if (fingers.current.size === 0) drag.current.moved = false;
    if (e.button > 0 || e.target.closest('button')) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    drag.current.pinch = 0;
  };
  const move = (e) => {
    const f = fingers.current.get(e.pointerId);
    if (!f) return;
    const dx = e.clientX - f.x, dy = e.clientY - f.y;
    f.x = e.clientX; f.y = e.clientY;
    const two = fingers.current.size >= 2;
    if (!drag.current.moved) {
      if (!two && Math.hypot(f.x - f.sx, f.y - f.sy) < 5) return; // still a click / tap
      drag.current.moved = true;
      paper.current.classList.add('dragging');
    }
    paper.current.setPointerCapture?.(e.pointerId);
    cancelAnimationFrame(anim.current);
    if (!two) { panBy(dx, dy); return; }
    const [a, b] = fingers.current.values();
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (drag.current.pinch && d > 0) zoomNow(d / drag.current.pinch, mapAt((a.x + b.x) / 2, (a.y + b.y) / 2));
    drag.current.pinch = d;
    panBy(dx / 2, dy / 2);
  };
  const up = (e) => {
    fingers.current.delete(e.pointerId);
    drag.current.pinch = 0;
    if (fingers.current.size === 0) paper.current?.classList.remove('dragging');
  };
  // a drag must not end as a click (with ?dev=1 a click on the map is a teleport)
  const swallowDragClick = (e) => { if (drag.current.moved && !e.target.closest('button')) { e.stopPropagation(); e.preventDefault(); } };
  const vb = { x: view.x - VB.w / view.s / 2, z: view.z - VB.h / view.s / 2, w: VB.w / view.s, h: VB.h / view.s };
  const mk = 1 / Math.sqrt(view.s); // markers and names grow only gently as the map zooms in

  // everything that does not change is built once from the zone data
  const art = useMemo(() => ZONES.map((z) => {
    const ground = [], decks = [], shapes = [];
    for (const s of z.walk) {
      if (s.legacy) { shapes.push(<circle key={shapes.length} cx={s.x} cy={s.z} r={s.r} />); continue; }
      if (s.t === 'circle') shapes.push(<circle key={shapes.length} cx={s.x} cy={s.z} r={s.r} />);
      else if (s.t === 'box') shapes.push(<path key={shapes.length} d={boxPath(s)} />);
      else (s.deck ? decks : ground).push(<path key={ground.length + decks.length} d={line(s.pts)} strokeWidth={Math.max(s.w, 3)} />);
    }
    const water = (z.water || []).map((w, i) => (w.t === 'pond' ? <circle key={i} cx={w.x} cy={w.z} r={w.r} className="mk-pond" /> : w.t === 'paddy' ? <path key={i} d={boxPath(w)} className="mk-paddy" /> : <path key={i} d={line(w.pts)} strokeWidth={w.w} />));
    const solids = [];
    for (const s of z.structures) {
      if (s.type === 'wall') { for (const g of wallSegments(s)) solids.push(<path key={solids.length} d={line([[g.ax, g.az], [g.bx, g.bz]])} className="mk-wall" />); continue; }
      if (!['house', 'mill', 'hall', 'temple', 'barracks', 'keep', 'pagoda', 'tower', 'tent', 'belltower', 'pavilion', 'hut'].includes(s.type)) continue;
      for (const f of footprint(s)) if (f.r === undefined) solids.push(<path key={solids.length} d={boxPath(f)} className="mk-roof" />);
    }
    const torii = z.structures.filter((s) => s.type === 'torii' || s.type === 'gate').map((s, i) => <path key={i} className={s.type === 'gate' ? 'mk-gate' : 'mk-torii'} d={`M${s.x - Math.cos(s.rot) * 3.4} ${s.z + Math.sin(s.rot) * 3.4} L${s.x + Math.cos(s.rot) * 3.4} ${s.z - Math.sin(s.rot) * 3.4}`} />);
    return { ground, decks, shapes, water, solids, torii };
  }), []);

  const done = (i) => ZONES[i].encounters.every((e) => progress.cleared.includes(e.id)) && (i === ZONES.length - 1 ? progress.cleared.includes('c-lord') : progress.zones[i + 1]);
  const cpIndex = CHECKPOINTS.findIndex((c) => c.id === progress.checkpoint);
  return (
    <div className="sheet map" role="dialog" aria-label="Journey map">
      <div className="map-frame">
        <header className="map-head">
          <span className="map-kanji">道中図</span>
          <div><h2>The Road to Onikage Castle</h2><p>{objective}</p></div>
          <button id="map-close" className="btn-ghost" onClick={onClose}>Close <kbd>M</kbd></button>
        </header>
        <div
          ref={paper}
          className={`map-paper${PARCHMENT ? ' inked' : ''}${view.s > 1.001 ? ' zoomed' : ''}`}
          style={PARCHMENT ? { borderImageSource: `url(${PARCHMENT})` } : undefined}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onClickCapture={swallowDragClick}
          onDoubleClick={(e) => { if (!e.target.closest('button') && !G.dev) glide(zoomed(ZOOM_STEP, mapAt(e.clientX, e.clientY))); }}
        >
        <svg className="map-svg" viewBox={`${vb.x} ${vb.z} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="mk-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="4" seed="7" /><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.26  0 0 0 0 0.14  0 0 0 0.22 0" /></filter>
            <filter id="mk-wash" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7" /></filter>
            <filter id="mk-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" /></filter>
          </defs>
          {!PARCHMENT && <rect x={VB.x - 600} y={VB.z - 300} width={VB.w + 1200} height={VB.h + 600} className="mk-paper" />}
          {!PARCHMENT && <rect x={VB.x - 600} y={VB.z - 300} width={VB.w + 1200} height={VB.h + 600} filter="url(#mk-grain)" />}
          {/* colour washes: one per land, dim until it has been seen */}
          {ZONES.map((z, i) => (
            <g key={z.id} filter="url(#mk-wash)" opacity={progress.zones[i] ? 0.5 : 0.16} stroke={TINT[i]} fill={TINT[i]} strokeLinecap="round" strokeLinejoin="round">
              {z.walk.map((s, k) => (s.t === 'circle' ? <circle key={k} cx={s.x} cy={s.z} r={s.r + 16} /> : s.t === 'box' ? <rect key={k} x={s.x - s.w / 2 - 14} y={s.z - s.d / 2 - 14} width={s.w + 28} height={s.d + 28} /> : <path key={k} d={line(s.pts)} strokeWidth={s.w + 34} fill="none" />))}
            </g>
          ))}
          {ZONES.map((z, i) => (
            <g key={z.id} className={`mk-zone ${progress.zones[i] ? 'seen' : 'unseen'} ${done(i) ? 'done' : ''}`}>
              <g className="mk-water" fill="none" strokeLinecap="round" strokeLinejoin="round">{art[i].water}</g>
              <g className="mk-ground" fill="none" strokeLinecap="round" strokeLinejoin="round">{art[i].ground}</g>
              <g className="mk-shapes">{art[i].shapes}</g>
              <g className="mk-decks" fill="none" strokeLinecap="butt">{art[i].decks}</g>
              <g>{art[i].solids}</g>
              <g>{art[i].torii}</g>
            </g>
          ))}
          {/* the route: gold where walked, dotted where still ahead */}
          {ZONES.map((z, i) => (
            <g key={z.id}>
              {done(i) && <path d={line(z.route)} className="mk-route-glow" filter="url(#mk-glow)" />}
              <path d={line(z.route)} className={`mk-route ${done(i) ? 'done' : progress.zones[i] ? 'now' : 'ahead'}`} />
            </g>
          ))}
          {ZONES.map((z, i) => <Icon key={z.id} kind={z.landmark.icon} x={ICON_AT[i][0]} z={ICON_AT[i][1]} k={mk} />)}
          {/* spirit lamps */}
          {CHECKPOINTS.map((c, i) => <g key={c.id} transform={`translate(${c.x} ${c.z}) scale(${mk})`} className={`mk-lamp ${i <= cpIndex ? 'lit' : ''} ${i === cpIndex ? 'here' : ''}`}><circle r="3.4" /><circle r="1.4" className="core" /></g>)}
          {/* bosses */}
          {ZONES.flatMap((z) => z.encounters.filter((e) => e.boss).map((e) => (
            <g key={e.id} transform={`translate(${e.arena.x} ${e.arena.z}) scale(${mk})`} className={`mk-boss ${progress.cleared.includes(e.id) ? 'slain' : ''}`}>
              <rect x="-7.5" y="-7.5" width="15" height="15" rx="2" transform="rotate(8)" />
              <text y="4.6" textAnchor="middle">{BOSS[e.id]}</text>
            </g>
          )))}
          {/* names */}
          {ZONES.map((z, i) => {
            const [lx, lz] = LABEL_AT[i];
            return (
              <g key={z.id} transform={`translate(${lx} ${lz}) scale(${mk})`} className={`mk-label ${progress.zones[i] ? 'seen' : ''} ${i === zone ? 'here' : ''}`}>
                <text className="k" y="0">{z.kanji}</text>
                <text className="n" y="13">{progress.zones[i] || G.dev ? z.name : '· · ·'}</text>
                {done(i) && <g transform="translate(-13 -6)" className="mk-seal"><circle r="6" /><path d="M-3 0 l2.2 2.4 l4 -4.8" /></g>}
              </g>
            );
          })}
          <g transform={`translate(${ZONES[0].route[0][0]} ${ZONES[0].route[0][1]}) scale(${mk})`} className="mk-start"><circle r="4" /></g>
          {/* you are here */}
          <g transform={`translate(${pos.x} ${pos.z}) scale(${mk})`} className="mk-you">
            <circle r="9" className="pulse" />
            <path d="M0 -8 L5 5 L0 2 L-5 5 Z" transform={`rotate(${180 - (pos.yaw * 180) / Math.PI})`} />
          </g>
        </svg>
        {G.dev && <DevJump vb={vb} mk={mk} />}
        <Compass />
        <div className="map-zoom" role="group" aria-label="Map zoom">
          <button type="button" onClick={() => stepZoom(ZOOM_STEP)} disabled={view.s >= MAX_ZOOM - 0.01} aria-label="Zoom in" title="Zoom in (+)">+</button>
          <button type="button" onClick={() => stepZoom(1 / ZOOM_STEP)} disabled={view.s <= 1.01} aria-label="Zoom out" title="Zoom out (−)">−</button>
          <button type="button" onClick={() => glide(WHOLE)} disabled={view.s <= 1.01} aria-label="Show the whole map" title="Whole map (0)">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
          </button>
        </div>
        <ul className="map-legend" aria-label="Legend">
          <li><i className="lg lg-you" /> You</li>
          <li><i className="lg lg-lamp" /> Spirit lamp</li>
          <li><i className="lg lg-boss" /> Boss</li>
          <li><i className="lg lg-route" /> Road walked</li>
          <li><i className="lg lg-ahead" /> Road ahead</li>
          <li><i className="lg lg-bridge" /> Bridge</li>
        </ul>
        </div>
      </div>
    </div>
  );
}
