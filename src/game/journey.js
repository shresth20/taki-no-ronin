import * as THREE from 'three';
import gsap from 'gsap';
import { G, ui, getUI } from '../core/state.js';
import { ZONES, CHECKPOINTS, ENCOUNTERS, GATES } from '../world/zones/index.js';
import { addBlocker, removeBlocker, arenaOpenings, groundAt, zoneAt } from '../world/nav.js';
import { wardMaterial, glowMaterial, sphG } from '../world/kit/core.js';

/* Journey state: what has been cleared, which gates stand open, where the player last rested.
   It runs the triggers the zone files describe (encounters, checkpoints, pickups), raises the wards or bars the gates
   for a fight, and saves progress to the browser so the road can be picked up again.                               */
const KEY = 'tnr-journey-v1';
const fresh = () => ({ checkpoint: 'falls', cleared: [], pickups: [], seen: [0], hpMax: 100, time: 0, damage: 0, deaths: 0, trained: false });

export function createJourney(scene) {
  let S = fresh();
  const gates = new Map(); // id -> { def, open, blocker }
  let active = null; // running encounter
  let zone = 0, zoneT = 0;
  const wardMat = wardMaterial();
  const wardGroup = new THREE.Group();
  wardGroup.name = 'wards';
  scene.add(wardGroup);
  const pickups = new Map(); // id -> { def, mesh }
  const pickGroup = new THREE.Group();
  scene.add(pickGroup);
  const cpLit = new Set();

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage is optional */ } ui({ hasSave: S.trained }); publish(); };
  const publish = () => ui({ progress: { zones: ZONES.map((z) => S.seen.includes(z.index)), cleared: [...S.cleared], checkpoint: S.checkpoint, pickups: [...S.pickups], gates: Object.fromEntries([...gates].map(([k, g]) => [k, g.open])) } });
  function readSave() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.trained ? { ...fresh(), ...v } : null; } catch { return null; }
  }

  /* ---------- gates ---------- */
  function setGate(id, open, instant = false) {
    const g = gates.get(id);
    if (!g) return;
    if (g.open !== open || g.blocker === undefined) {
      g.open = open;
      if (g.blocker) { removeBlocker(g.blocker); g.blocker = null; }
      if (!open) {
        const d = g.def, c = Math.cos(d.rot), s = Math.sin(d.rot), h = d.w / 2 + 0.6;
        g.blocker = addBlocker(d.x - c * h, d.z + s * h, d.x + c * h, d.z - s * h, 0.8);
      }
      if (!instant && G.audio) G.audio.sfx.gate?.(open);
    }
    G.world?.setGate(id, open, instant);
  }
  function resetGates() {
    for (const def of GATES) {
      if (!gates.has(def.id)) gates.set(def.id, { def, open: undefined, blocker: undefined });
      // a gate is open if the map says so, or if the encounter that unlocks it has been cleared
      const opened = ENCOUNTERS.some((e) => e.opens?.includes(def.id) && S.cleared.includes(e.id));
      gates.get(def.id).open = null; // force the state to be applied afresh
      setGate(def.id, !!def.open || opened, true);
    }
  }

  /* ---------- wards ---------- */
  function raiseWards(arena) {
    const segs = arenaOpenings(arena), list = [];
    for (const [ax, az, bx, bz] of segs) {
      const len = Math.hypot(bx - ax, bz - az), y = Math.min(groundAt(ax, az), groundAt(bx, bz));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.8), wardMat);
      m.position.set((ax + bx) / 2, y + 1.42, (az + bz) / 2);
      m.rotation.y = Math.atan2(-(bz - az), bx - ax);
      m.renderOrder = 9;
      wardGroup.add(m);
      list.push({ m, blocker: addBlocker(ax, az, bx, bz, 0.55) });
    }
    gsap.to(wardMat.uniforms.uAlpha, { value: 1, duration: 0.5, overwrite: true });
    return list;
  }
  function dropWards(list) {
    for (const w of list) removeBlocker(w.blocker);
    if (!list.length) return;
    gsap.to(wardMat.uniforms.uAlpha, { value: 0, duration: 0.7, overwrite: true });
    gsap.delayedCall(0.8, () => { for (const w of list) { wardGroup.remove(w.m); w.m.geometry.dispose(); } });
  }

  /* ---------- pickups ---------- */
  function spawnPickups(handle) {
    for (const def of handle.pickups) {
      if (S.pickups.includes(def.id) || pickups.has(def.id)) continue;
      const col = def.kind === 'life' ? new THREE.Color(1.6, 3.0, 1.6) : new THREE.Color(3.0, 2.3, 0.9);
      const g = sphG(0.2, 10, 8).clone();
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill([col.r, col.g, col.b]).flat(), 3));
      const mesh = new THREE.Mesh(g, glowMaterial());
      mesh.position.set(def.x, groundAt(def.x, def.z) + 1.0, def.z);
      pickGroup.add(mesh);
      pickups.set(def.id, { def, mesh, zone: handle.zone.index });
    }
  }
  function dropPickups(handle) {
    for (const [id, p] of pickups) if (p.zone === handle.zone.index) { pickGroup.remove(p.mesh); p.mesh.geometry.dispose(); pickups.delete(id); }
  }

  const J = {
    get state() { return S; },
    get active() { return active; },
    get zone() { return zone; },
    hasSave: () => !!readSave(),
    gateOpen: (id) => gates.get(id)?.open,
    /** start a new road, or pick up the saved one */
    reset(cont = false) {
      this.abort();
      S = (cont && readSave()) || fresh();
      cpLit.clear();
      for (const p of pickups.values()) { pickGroup.remove(p.mesh); }
      pickups.clear();
      resetGates();
      for (const h of G.world.streamer.handles()) spawnPickups(h);
      zone = CHECKPOINTS.find((c) => c.id === S.checkpoint)?.zone ?? 0;
      publish();
      ui({ hasSave: !!readSave(), zone });
      return S;
    },
    bind() {
      G.world.onZoneLoad((h) => {
        for (const id of h.gates.keys()) h.setGate(id, gates.get(id)?.open ?? true, true);
        spawnPickups(h);
      });
      G.world.onZoneUnload(dropPickups);
      resetGates();
      ui({ hasSave: !!readSave() });
    },
    markTrained() { S.trained = true; save(); },
    checkpoint: () => CHECKPOINTS.find((c) => c.id === S.checkpoint) || CHECKPOINTS[0],
    setCheckpoint(id, quiet = false) {
      if (S.checkpoint === id && quiet) return;
      S.checkpoint = id;
      save();
    },

    /* ---------- encounters ---------- */
    begin(enc) {
      active = { enc, wave: -1, wards: [], locked: [] };
      G.arena = enc.arena;
      if (enc.locks) for (const id of enc.locks) { if (gates.get(id)?.open) { active.locked.push(id); setGate(id, false); } }
      else active.wards = raiseWards(enc.arena);
      return active;
    },
    /** spawn the next wave; returns the enemies, or null when the encounter is over */
    nextWave() {
      if (!active) return null;
      active.wave++;
      const w = active.enc.waves[active.wave];
      if (!w) return null;
      const p = G.player.pos;
      G.combat.max = w.max;
      return w.list.map(([k, x, z]) => G.combat.spawn(k, x, z, Math.atan2(p.x - x, p.z - z)));
    },
    isLastWave: () => !!active && active.wave >= active.enc.waves.length - 1,
    /** the fight is won: lower the wards, open what it unlocks, remember it */
    clear() {
      if (!active) return null;
      const enc = active.enc;
      dropWards(active.wards);
      for (const id of active.locked) setGate(id, true);
      for (const id of enc.opens || []) setGate(id, true);
      if (!S.cleared.includes(enc.id)) S.cleared.push(enc.id);
      if (enc.checkpoint) S.checkpoint = enc.checkpoint;
      active = null;
      G.arena = null;
      save();
      return enc;
    },
    /** abandon a running fight (defeat, return to title) and put the world back as it was */
    abort() {
      if (!active) return;
      dropWards(active.wards);
      for (const id of active.locked) setGate(id, true, true);
      active = null;
      G.arena = null;
    },

    /** per-frame triggers while the player is free to roam */
    update(dt, rdt) {
      const P = G.player, ph = getUI().phase;
      if (ph === 'explore' || ph === 'combat') S.time += rdt;
      // which zone are we in? (settles for a moment so a seam cannot flicker the card)
      const zi = zoneAt(P.pos.x, P.pos.z);
      if (zi !== zone) {
        zoneT += rdt;
        if (zoneT > 0.6) {
          zone = zi; zoneT = 0;
          const first = !S.seen.includes(zi);
          if (first) { S.seen.push(zi); save(); }
          ui({ zone: zi });
          G.director.onZoneEnter(zi, first);
        }
      } else zoneT = 0;
      // pickups bob and turn; touch to take
      for (const [id, p] of pickups) {
        p.mesh.position.y = groundAt(p.def.x, p.def.z) + 1.0 + Math.sin(G.time * 2 + p.def.x) * 0.12;
        p.mesh.scale.setScalar(1 + Math.sin(G.time * 5) * 0.08);
        if (ph === 'explore' && Math.hypot(P.pos.x - p.def.x, P.pos.z - p.def.z) < 1.3) {
          S.pickups.push(id);
          pickGroup.remove(p.mesh);
          pickups.delete(id);
          if (p.def.kind === 'life') { S.hpMax += 20; P.hpMax = S.hpMax; P.hp = P.hpMax; ui({ hp: P.hp, hpMax: P.hpMax }); G.director.toast('Vitality rises', 'cyan'); }
          else { P.ki = 100; G.director.toast('Ki overflows', 'gold'); }
          G.vfx.ring(P.pos, 0.3, 2.4, p.def.kind === 'life' ? '#a8ffb0' : '#ffe9a8', 0.5);
          G.vfx.embers(P.pos, 14, p.def.kind === 'life' ? [1.2, 3.0, 1.4] : [3.0, 2.3, 0.9], 0.8);
          G.audio.sfx.ui();
          save();
        }
      }
      // a fight keeps both sides inside its ring, whatever threw them about
      if (active && ph === 'combat') {
        const A = active.enc.arena, dx = P.pos.x - A.x, dz = P.pos.z - A.z, d = Math.hypot(dx, dz);
        if (d > A.r + 0.4 && !active.enc.locks) { P.pos.x = A.x + (dx / d) * (A.r - 0.8); P.pos.z = A.z + (dz / d) * (A.r - 0.8); G.physics.teleport(P.body, P.pos); }
      }
      if (ph !== 'explore' || active) return;
      // checkpoints: spirit lamps along the road
      for (const c of CHECKPOINTS) {
        if (Math.abs(c.zone - zone) > 1) continue;
        const d = Math.hypot(P.pos.x - c.x, P.pos.z - c.z);
        if (d < 2.6 && !cpLit.has(c.id)) {
          cpLit.add(c.id);
          if (S.checkpoint !== c.id || P.hp < P.hpMax) {
            S.checkpoint = c.id;
            P.heal(P.hpMax);
            save();
            G.director.toast('The road is remembered · ' + c.label, 'cyan');
            G.vfx.ring(P.pos, 0.3, 2.8, '#bff4ff', 0.6);
            G.audio.sfx.ui();
          }
        } else if (d > 7) cpLit.delete(c.id);
      }
      // encounters
      for (const e of ENCOUNTERS) {
        if (e.zone !== zone || S.cleared.includes(e.id)) continue;
        if (Math.hypot(P.pos.x - e.trigger.x, P.pos.z - e.trigger.z) < e.trigger.r) { G.director.startEncounter(e); break; }
      }
    },
    addDamage(v) { S.damage += v; },
    addDeath() { S.deaths++; save(); },
    clearSave() { try { localStorage.removeItem(KEY); } catch { /* optional */ } ui({ hasSave: false }); },
    /** debug: mark everything before a zone as done */
    unlockThrough(zi) {
      for (const e of ENCOUNTERS) if (e.zone < zi && !S.cleared.includes(e.id)) S.cleared.push(e.id);
      for (let i = 0; i <= zi; i++) if (!S.seen.includes(i)) S.seen.push(i);
      S.trained = true;
      resetGates();
      publish();
    },
    /** dev jump (?dev=1): the road up to a point has been walked. Exactly these fights are won and these lands seen,
        so jumping back down the road makes the later fights fresh again. */
    devPrepare(plan) {
      this.abort();
      S.cleared = [...plan.clear];
      S.seen = Array.from({ length: plan.zone + 1 }, (_, i) => i);
      S.trained = true;
      S.checkpoint = plan.checkpoint;
      zone = plan.zone; // already standing in it: no zone card or reveal on the first frame
      zoneT = 0;
      cpLit.clear();
      resetGates();
      save();
    },
  };
  return J;
}
