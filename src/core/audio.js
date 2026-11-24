import { G } from './state.js';
import { clamp, rand, rrange } from './util.js';

/* Fully procedural audio (no samples): ambience (falls, river, wind, birds), a small generative
   score (koto-like plucks at peace, taiko and ostinato in battle, a resolved swell at victory)
   and synthesised combat effects. Starts on the first user gesture.                           */
export function createAudio() {
  let ctx = null, master, sfxBus, musicBus, ambBus, verb;
  let noiseBuf = null;
  let enabled = true;
  const amb = {};
  let mode = 'peace', nextNote = 0, step = 0, started = false;
  const SCALE = [0, 1, 5, 7, 8, 12, 13, 17, 19, 20]; // in-sen flavoured pentatonic
  const ROOT = 146.83; // D3
  const hz = (semi) => ROOT * Math.pow(2, semi / 12);

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9;
    musicBus = ctx.createGain(); musicBus.gain.value = 0.55;
    ambBus = ctx.createGain(); ambBus.gain.value = 0.7;
    // light convolution reverb from a generated impulse
    verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.26;
    verb.connect(wet).connect(master);
    for (const b of [sfxBus, musicBus, ambBus]) b.connect(master);
    musicBus.connect(verb);
    sfxBus.connect(verb);
    // shared noise
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.04 * w) / 1.04;
      nd[i] = w * 0.5 + last * 6;
    }
    // ambience beds
    const bed = (type, freq, q, gain) => {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = true;
      s.playbackRate.value = rrange(0.9, 1.1);
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      s.connect(f).connect(g).connect(ambBus);
      s.start();
      return { f, g };
    };
    amb.falls = bed('lowpass', 900, 0.4, 0.0);
    amb.river = bed('bandpass', 1900, 0.7, 0.0);
    amb.wind = bed('bandpass', 420, 1.1, 0.0);
    started = true;
    nextNote = ctx.currentTime + 0.4;
    return true;
  }
  const now = () => ctx.currentTime;

  function noise(dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.5, attack = 0.005, bus = sfxBus, rate = 1 } = {}) {
    const t = now(), s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.05);
  }
  function tone(freq, dur, { type = 'sine', gain = 0.3, f1 = freq, attack = 0.004, bus = sfxBus, when = 0, detune = 0 } = {}) {
    const t = now() + when, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(freq, t);
    if (f1 !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  // plucked string (koto / shamisen): bright attack, fast decay, slight pitch bend
  function pluck(semi, when, gain = 0.2, bright = 1) {
    const f = hz(semi);
    tone(f * 1.012, 1.4, { type: 'triangle', gain, f1: f, bus: musicBus, when, attack: 0.002 });
    tone(f * 2, 0.5, { type: 'sine', gain: gain * 0.35 * bright, bus: musicBus, when, attack: 0.002 });
    tone(f * 3.01, 0.18, { type: 'square', gain: gain * 0.07 * bright, bus: musicBus, when, attack: 0.001 });
  }
  function taiko(when, gain = 0.5, low = true) {
    tone(low ? 96 : 150, low ? 0.5 : 0.26, { type: 'sine', gain, f1: low ? 44 : 80, bus: musicBus, when, attack: 0.002 });
    const t = now() + when, s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = low ? 500 : 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(f).connect(g).connect(musicBus);
    s.start(t, Math.random());
    s.stop(t + 0.12);
  }
  function flute(semi, when, dur, gain = 0.07) {
    const t = now() + when, o = ctx.createOscillator(), g = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = hz(semi + 12);
    l.frequency.value = 5.2;
    lg.gain.value = 5;
    l.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(gain * 0.7, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(musicBus);
    o.start(t); l.start(t);
    o.stop(t + dur + 0.1); l.stop(t + dur + 0.1);
  }

  function schedule() {
    // look-ahead sequencer
    while (nextNote < now() + 0.25) {
      const w = nextNote - now();
      if (mode === 'peace') {
        const n = SCALE[Math.floor(rand() * 7) + (rand() < 0.3 ? 2 : 0)];
        pluck(n, w, 0.16);
        if (rand() < 0.35) pluck(n + (rand() < 0.5 ? 7 : 5), w + 0.18, 0.09);
        if (step % 6 === 0) flute(SCALE[Math.floor(rand() * 5) + 3], w + 0.4, 3.6);
        nextNote += rrange(0.9, 1.9);
      } else if (mode === 'battle') {
        const beat = 0.2; // 150 bpm sixteenths
        const s = step % 16;
        if (s === 0 || s === 6 || s === 10) taiko(w, 0.55, true);
        if (s === 4 || s === 12 || s === 14 || s === 15) taiko(w, 0.3, false);
        const ost = [0, 7, 5, 7, 8, 7, 5, 1];
        if (s % 2 === 0) pluck(ost[(s / 2) % 8] + (Math.floor(step / 32) % 2 ? 0 : 0), w, 0.13, 1.6);
        if (s === 0 && Math.floor(step / 16) % 2 === 0) flute(SCALE[5 + Math.floor(rand() * 3)], w, 2.4, 0.06);
        nextNote += beat;
      } else if (mode === 'victory') {
        const prog = [[0, 7, 12], [5, 12, 17], [7, 12, 19], [0, 7, 12, 19]];
        const ch = prog[step % 4];
        ch.forEach((n, i) => pluck(n, w + i * 0.12, 0.17));
        flute(ch[ch.length - 1], w + 0.3, 2.6, 0.07);
        if (step % 2 === 0) taiko(w, 0.35, true);
        nextNote += 2.4;
      } else nextNote += 0.5;
      step++;
    }
  }

  const sfx = {
    whoosh(heavy = false) { noise(heavy ? 0.34 : 0.2, { f0: heavy ? 500 : 900, f1: heavy ? 2600 : 4200, q: 1.4, gain: heavy ? 0.5 : 0.34, attack: 0.03 }); },
    hit(heavy = false) {
      noise(0.16, { type: 'highpass', f0: 2200, f1: 900, q: 0.6, gain: 0.55 });
      tone(heavy ? 120 : 170, 0.22, { gain: heavy ? 0.7 : 0.45, f1: 46, type: 'sine' });
      tone(2600, 0.12, { gain: 0.12, f1: 5200, type: 'triangle' });
      if (heavy) noise(0.4, { type: 'lowpass', f0: 700, f1: 90, gain: 0.5 });
    },
    clang(big = false) {
      for (const [f, d] of [[1870, 0.5], [2760, 0.36], [4130, 0.26], [5490, 0.2]]) tone(f * rrange(0.98, 1.02), d * (big ? 1.6 : 1), { type: 'triangle', gain: big ? 0.2 : 0.13 });
      noise(0.06, { type: 'highpass', f0: 5000, gain: 0.4 });
    },
    parry() {
      this.clang(true);
      tone(880, 0.6, { gain: 0.16, f1: 1760, type: 'sine' });
      noise(0.5, { f0: 6000, f1: 800, q: 2, gain: 0.25, attack: 0.01 });
    },
    hurt() { tone(220, 0.3, { type: 'sawtooth', gain: 0.22, f1: 70 }); noise(0.22, { type: 'lowpass', f0: 1200, f1: 200, gain: 0.5 }); },
    step(wet = false) {
      if (wet) noise(0.16, { f0: 1400, f1: 500, q: 0.8, gain: 0.16, attack: 0.01 });
      else noise(0.07, { type: 'lowpass', f0: 520, f1: 180, gain: 0.13 });
    },
    roll() { noise(0.32, { f0: 300, f1: 1200, q: 0.8, gain: 0.3, attack: 0.05 }); },
    jump() { noise(0.2, { f0: 400, f1: 1600, q: 1, gain: 0.2, attack: 0.03 }); },
    land(heavy = false) { tone(90, 0.2, { gain: heavy ? 0.7 : 0.3, f1: 38 }); noise(0.25, { type: 'lowpass', f0: 900, f1: 120, gain: heavy ? 0.6 : 0.25 }); },
    splash() { noise(0.4, { f0: 2400, f1: 600, q: 0.5, gain: 0.3, attack: 0.02 }); },
    glint(danger = false) { tone(danger ? 1320 : 2100, 0.3, { type: 'sine', gain: 0.12, f1: danger ? 990 : 3100 }); if (danger) tone(330, 0.4, { type: 'sawtooth', gain: 0.08, f1: 160 }); },
    death() { noise(0.7, { f0: 2400, f1: 150, q: 0.7, gain: 0.3, attack: 0.02 }); tone(140, 0.5, { gain: 0.3, f1: 50 }); },
    charge() { tone(180, 0.5, { type: 'sawtooth', gain: 0.1, f1: 900 }); noise(0.5, { f0: 300, f1: 5000, q: 3, gain: 0.25, attack: 0.3 }); },
    flash() { noise(0.5, { type: 'highpass', f0: 800, f1: 6000, gain: 0.6, attack: 0.005 }); tone(60, 0.9, { gain: 0.8, f1: 28 }); tone(3200, 0.5, { type: 'triangle', gain: 0.14, f1: 1200 }); },
    sheath() { noise(0.35, { type: 'highpass', f0: 3000, f1: 7000, gain: 0.2, attack: 0.2 }); tone(1500, 0.07, { type: 'square', gain: 0.16, when: 0.36 }); noise(0.05, { type: 'highpass', f0: 4000, gain: 0.35, attack: 0.001 }); },
    click() { tone(1500, 0.06, { type: 'square', gain: 0.2 }); noise(0.04, { type: 'highpass', f0: 3500, gain: 0.3 }); },
    ui() { pluck(12, 0, 0.2); },
    gong() { for (const [f, g] of [[98, 0.5], [147, 0.3], [196.5, 0.22], [311, 0.12]]) tone(f, 4, { gain: g * 0.6, type: 'sine', bus: musicBus }); noise(1.2, { type: 'lowpass', f0: 1200, f1: 200, gain: 0.3, bus: musicBus }); },
    birds() { for (let i = 0; i < 14; i++) noise(0.1, { f0: 1200, f1: 2600, q: 2, gain: 0.12, attack: 0.02, rate: rrange(0.8, 1.6) }), tone(rrange(1800, 3600), 0.12, { gain: 0.04, when: i * 0.07 + rand() * 0.05, f1: rrange(2400, 4800) }); },
    wave() { taiko(0, 0.7, true); taiko(0.18, 0.5, false); taiko(0.36, 0.8, true); },
  };
  const safe = {};
  for (const k in sfx) safe[k] = (...a) => { if (ctx && enabled && ctx.state === 'running') try { sfx[k](...a); } catch { /* audio is best-effort */ } };

  let chirp = 2;
  function update(rdt, listener) {
    if (!ctx || !started) return;
    if (ctx.state !== 'running' || !enabled) return;
    schedule();
    // ambience follows the listener and the mood
    const t = now();
    const dFalls = listener ? Math.hypot(listener.x, listener.z + 44) : 40;
    const dRiver = listener ? Math.abs(listener.x - 8) : 10;
    amb.falls.g.gain.setTargetAtTime(clamp(0.5 * (22 / (dFalls + 14)), 0.05, 0.5), t, 0.3);
    amb.river.g.gain.setTargetAtTime(clamp(0.11 * (9 / (dRiver + 6)), 0.01, 0.11), t, 0.3);
    const wind = G.mood > 0.5 && G.mood < 1.5 ? 0.2 : 0.07;
    amb.wind.g.gain.setTargetAtTime(wind * (0.7 + 0.3 * Math.sin(G.real * 0.7)), t, 0.5);
    amb.wind.f.frequency.setTargetAtTime(380 + 160 * Math.sin(G.real * 0.31), t, 0.5);
    // birdsong while the valley is calm
    chirp -= rdt;
    if (chirp < 0 && (G.mood < 0.4 || G.mood > 1.7)) {
      chirp = rrange(1.5, 5);
      const base = rrange(2200, 3800), n = 2 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) tone(base * rrange(0.9, 1.2), 0.09, { gain: 0.035, when: i * 0.11, f1: base * rrange(1.1, 1.5), bus: ambBus });
    }
  }
  return {
    sfx: safe,
    start() {
      if (!init()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      step = 0;
      if (ctx) nextNote = now() + (m === 'victory' ? 0.8 : 0.3);
    },
    setEnabled(v) {
      enabled = v;
      if (master) master.gain.setTargetAtTime(v ? 0.9 : 0, now(), 0.05);
    },
    duck(v) {
      if (musicBus) musicBus.gain.setTargetAtTime(v ? 0.2 : 0.55, now(), 0.2);
    },
    update,
  };
}
