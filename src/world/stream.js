import { ZONES } from './zones/index.js';
import { buildZone } from './zone.js';
import { zoneAt } from './nav.js';

/* Zone streaming. The world is one continuous place, but only the zones near the player exist as meshes.
   The zones either side of the current one are always kept ready, and any zone within LOAD_AT metres starts building,
   a few milliseconds of work per frame, and is released once the player is well clear of it again.
   Nothing ever pops in at a seam and no screen ever goes black between zones.                              */
const LOAD_AT = 70, DROP_AT = 125;

export function createStreamer(root, quality, hooks = {}) {
  const slots = ZONES.map((zone) => ({ zone, handle: null, gen: null, busy: false }));
  const dist = (r, x, z) => Math.max(r.x0 - x, x - r.x1, r.z0 - z, z - r.z1, 0);
  let current = 0;

  function finish(slot, handle) {
    slot.handle = handle;
    slot.gen = null;
    root.add(handle.group);
    hooks.onLoad?.(handle);
  }
  /** build a zone right now (start-up, continue from a checkpoint, debug jumps) */
  function loadNow(i) {
    const slot = slots[i];
    if (slot.handle) return slot.handle;
    const gen = slot.gen ?? buildZone(slot.zone, quality());
    let r = gen.next();
    while (!r.done) r = gen.next();
    finish(slot, r.value);
    return slot.handle;
  }
  function update(x, z, budgetMs = 5, sync = false) {
    current = zoneAt(x, z);
    // release what is far behind
    for (const s of slots) {
      const d = dist(s.zone.rect, x, z);
      s.d = d;
      s.near = Math.abs(s.zone.index - current) <= 1; // the zones before and after this one are always kept ready
      if (s.handle && d > DROP_AT && !s.near && !s.zone.legacy) {
        hooks.onUnload?.(s.handle);
        s.handle.dispose();
        s.handle = null;
      }
      if (s.gen && d > DROP_AT && !s.near) s.gen = null;
    }
    // bring in what is coming up: nearest first
    const wanted = slots.filter((s) => !s.handle && (s.d < LOAD_AT || s.near)).sort((a, b) => a.d - b.d);
    if (!wanted.length) return;
    if (sync) { for (const s of wanted) loadNow(s.zone.index); return; }
    const s = wanted[0];
    s.gen ??= buildZone(s.zone, quality());
    const t0 = performance.now();
    // a zone the player is already standing in must not wait
    const limit = s.d <= 0 ? 1e9 : budgetMs;
    while (performance.now() - t0 < limit) {
      const r = s.gen.next();
      if (r.done) { finish(s, r.value); break; }
    }
  }
  return {
    slots,
    update,
    loadNow,
    get current() { return current; },
    handle: (i) => slots[i].handle,
    handles: () => slots.filter((s) => s.handle).map((s) => s.handle),
    status: () => slots.map((s) => (s.handle ? 'loaded' : s.gen ? 'building' : 'idle')),
  };
}
