import { G, ui, getUI } from './state.js';
import { clamp } from './util.js';

/* Unified input: keyboard + mouse on desktop, virtual stick + buttons on touch.
   Actions are edge-triggered and buffered for a short window so combos feel forgiving.
   Camera: trackpad two-finger swipe orbits and pinch zooms, a mouse wheel zooms, C recentres; on touch screens a
   drag on open ground orbits, two fingers pinch to zoom and a double tap recentres. The rig drains `look` each frame. */
export const input = {
  move: { x: 0, y: 0 }, // x: right, y: forward
  look: { dx: 0, dy: 0, zoom: 0 }, // dx/dy in screen pixels (right / down), zoom in log-distance (+ = farther)
  held: { block: false },
  at: { attack: -9, heavy: -9, dodge: -9, jump: -9, special: -9, block: -9 },
  enabled: true,
  press(name) {
    this.at[name] = G.real;
    if (name === 'block') this.held.block = true;
  },
  release(name) {
    if (name === 'block') this.held.block = false;
  },
  consume(name, window = 0.22) {
    if (G.real - this.at[name] <= window) {
      this.at[name] = -9;
      return true;
    }
    return false;
  },
  clear() {
    for (const k in this.at) this.at[k] = -9;
    this.held.block = false;
  },
};
if (typeof window !== 'undefined') window.__input = input;

const keys = new Set();
const KEY_ACTION = { KeyJ: 'attack', KeyK: 'heavy', Space: 'jump', ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyL: 'dodge', KeyE: 'special', KeyI: 'special', KeyF: 'block', KeyQ: 'block', ControlLeft: 'block', KeyU: 'attack', KeyO: 'heavy' };
function syncMove() {
  const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const l = Math.hypot(x, y) || 1;
  input.move.x = x / l;
  input.move.y = y / l;
}

export function bindInput(canvas) {
  const kd = (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    const a = KEY_ACTION[e.code];
    if (a) input.press(a);
    if (e.code === 'KeyP' || e.code === 'Escape') G.director?.togglePause(e.code === 'Escape');
    if (e.code === 'Enter') G.director?.skip();
    if (e.code === 'KeyM' || e.code === 'Tab') { e.preventDefault(); G.director?.toggleMap(); }
    if (e.code === 'Backquote') ui({ debug: !getUI().debug });
    if (e.code === 'KeyC') G.rig?.recenter();
    syncMove();
  };
  const ku = (e) => {
    keys.delete(e.code);
    const a = KEY_ACTION[e.code];
    if (a) input.release(a);
    syncMove();
  };
  let dragging = false;
  const locked = () => document.pointerLockElement === canvas;
  const md = (e) => {
    if (getUI().isTouch) return;
    const ph = getUI().phase;
    if (ph !== 'combat' && ph !== 'training' && ph !== 'explore') return;
    if (e.button === 0) input.press('attack');
    if (e.button === 2) input.press('heavy');
    if (e.button === 1) { input.press('block'); e.preventDefault(); }
  };
  const mu = (e) => {
    dragging = false;
    if (e.button === 1) input.release('block');
  };
  const mm = (e) => {
    if (getUI().isTouch) return;
    if (locked() || dragging) {
      input.look.dx += e.movementX || 0;
      input.look.dy += e.movementY || 0;
    }
  };
  // camera steering only while the player is actually in the world (menus and the map keep their own scrolling)
  const steering = () => {
    const s = getUI();
    return (s.phase === 'combat' || s.phase === 'training' || s.phase === 'explore') && !s.paused && !s.map;
  };
  const overPanel = (e) => e.target?.closest?.('.sheet, .dbg, .result');

  // wheel: trackpad two-finger swipe orbits, trackpad pinch (ctrl+wheel in Chrome/Firefox/Edge) and a mouse wheel zoom
  const wheel = (e) => {
    if (!steering() || overPanel(e)) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.ctrlKey) { input.look.zoom += clamp(dy, -40, 40) * 0.01; return; }
    // a trackpad reports fine pixel deltas (wheelDeltaY is exactly -3 x deltaY); a mouse wheel reports notches
    const pad = e.deltaX !== 0 || (e.wheelDeltaY ? e.wheelDeltaY === -3 * e.deltaY : e.deltaMode === 0);
    if (pad) { input.look.dx += dx * 0.6; input.look.dy += dy * 0.6; }
    else input.look.zoom += clamp(dy, -240, 240) * 0.0016;
  };
  // Safari on macOS reports a trackpad pinch as a gesture, not a ctrl+wheel
  let gScale = 1;
  const gStart = (e) => { if (!steering()) return; e.preventDefault(); gScale = 1; };
  const gChange = (e) => {
    if (!steering()) return;
    e.preventDefault();
    if (touches.size < 2 && e.scale > 0) input.look.zoom -= Math.log(e.scale / gScale);
    gScale = e.scale;
  };

  // touch: fingers that land on open ground (not the stick or a button) steer the camera
  const touches = new Map();
  let pinch = 0, lastTap = -9;
  const pd = (e) => {
    if (e.pointerType === 'mouse' || !steering()) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: G.real });
    canvas.setPointerCapture?.(e.pointerId);
    pinch = 0;
  };
  const pm = (e) => {
    const f = touches.get(e.pointerId);
    if (!f) return;
    const dx = e.clientX - f.x, dy = e.clientY - f.y;
    f.x = e.clientX; f.y = e.clientY;
    if (!steering()) return;
    if (touches.size === 1) { input.look.dx += dx; input.look.dy += dy; return; }
    // two fingers: spread / squeeze to zoom, slide together to orbit
    const [a, b] = touches.values();
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch && d > 0) input.look.zoom -= Math.log(d / pinch);
    pinch = d;
    input.look.dx += dx * 0.5; input.look.dy += dy * 0.5;
  };
  const pu = (e) => {
    const f = touches.get(e.pointerId);
    if (!f) return;
    touches.delete(e.pointerId);
    pinch = 0;
    // a quick tap that barely moved; two of them close together recentre the view
    if (G.real - f.t < 0.25 && Math.hypot(e.clientX - f.sx, e.clientY - f.sy) < 12) {
      if (G.real - lastTap < 0.32) { G.rig?.recenter(); lastTap = -9; }
      else lastTap = G.real;
    }
  };
  const pc = (e) => { touches.delete(e.pointerId); pinch = 0; };

  const plc = () => ui({ locked: locked() });
  const ctx = (e) => e.preventDefault();
  const blur = () => { keys.clear(); syncMove(); input.held.block = false; };
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  canvas.addEventListener('mousedown', md);
  window.addEventListener('mouseup', mu);
  window.addEventListener('mousemove', mm);
  canvas.addEventListener('contextmenu', ctx);
  window.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('gesturestart', gStart);
  window.addEventListener('gesturechange', gChange);
  canvas.addEventListener('pointerdown', pd);
  canvas.addEventListener('pointermove', pm);
  canvas.addEventListener('pointerup', pu);
  canvas.addEventListener('pointercancel', pc);
  document.addEventListener('pointerlockchange', plc);
  window.addEventListener('blur', blur);
  const touch = () => ui({ isTouch: true });
  window.addEventListener('touchstart', touch, { once: true, passive: true });
  if (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) ui({ isTouch: true });
  return () => {
    window.removeEventListener('keydown', kd);
    window.removeEventListener('keyup', ku);
    canvas.removeEventListener('mousedown', md);
    window.removeEventListener('mouseup', mu);
    window.removeEventListener('mousemove', mm);
    canvas.removeEventListener('contextmenu', ctx);
    window.removeEventListener('wheel', wheel);
    window.removeEventListener('gesturestart', gStart);
    window.removeEventListener('gesturechange', gChange);
    canvas.removeEventListener('pointerdown', pd);
    canvas.removeEventListener('pointermove', pm);
    canvas.removeEventListener('pointerup', pu);
    canvas.removeEventListener('pointercancel', pc);
    document.removeEventListener('pointerlockchange', plc);
    window.removeEventListener('blur', blur);
  };
}
