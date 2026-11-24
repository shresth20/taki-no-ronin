import { G, ui, getUI } from './state.js';

/* Unified input: keyboard + mouse on desktop, virtual stick + buttons on touch.
   Actions are edge-triggered and buffered for a short window so combos feel forgiving. */
export const input = {
  move: { x: 0, y: 0 }, // x: right, y: forward
  look: { dx: 0, dy: 0 },
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
const KEY_ACTION = { KeyJ: 'attack', KeyK: 'heavy', Space: 'jump', ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyL: 'dodge', KeyE: 'special', KeyI: 'special', KeyF: 'block', KeyQ: 'block', ControlLeft: 'block' };
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
    if (!locked() && (ph === 'combat' || ph === 'training')) {
      // first click captures the mouse; where that is refused, dragging still turns the camera
      try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* optional */ }
      dragging = true;
    }
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
  const plc = () => ui({ locked: locked() });
  const ctx = (e) => e.preventDefault();
  const blur = () => { keys.clear(); syncMove(); input.held.block = false; };
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  canvas.addEventListener('mousedown', md);
  window.addEventListener('mouseup', mu);
  window.addEventListener('mousemove', mm);
  canvas.addEventListener('contextmenu', ctx);
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
    document.removeEventListener('pointerlockchange', plc);
    window.removeEventListener('blur', blur);
  };
}
