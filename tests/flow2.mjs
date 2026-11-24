// training -> ambush -> combat with a simple bot; captures frames along the way
const S = 'shots';
export default async function (page, { shot, args }) {
  const step = (n, render = false, dt = 1 / 30) => page.evaluate(([n, r, dt]) => window.__step(dt, n, r), [n, render, dt]);
  const info = () => page.evaluate(() => { const G = window.__G, P = G.player; return { phase: window.__ui().phase, t: +G.real.toFixed(1), p: [+P.pos.x.toFixed(1), +P.pos.z.toFixed(1)], st: P.state, hp: Math.round(P.hp), ki: Math.round(P.ki), wave: window.__ui().wave, en: G.enemies.map(e => e.kind[0] + ':' + e.state + ':' + Math.round(e.hp)).join(' ') }; });
  // bot: walk at the nearest target, mash attack, sometimes heavy / dodge / block
  const bot = (frames, opts = {}) => page.evaluate(([frames, opts]) => {
    const G = window.__G, I = window.__input, P = G.player;
    let shots = 0;
    for (let f = 0; f < frames; f++) {
      const ph = window.__ui().phase;
      let tx, tz, dist = 99;
      if (ph === 'training') { const u = G.world.post.userData; tx = u.x; tz = u.z; dist = Math.hypot(tx - P.pos.x, tz - P.pos.z); }
      else { const e = P.nearestEnemy(60); if (e) { tx = e.pos.x; tz = e.pos.z; dist = Math.hypot(tx - P.pos.x, tz - P.pos.z); } }
      if (tx !== undefined && (ph === 'training' || ph === 'combat')) {
        const b = G.rig.basis({});
        const dx = (tx - P.pos.x) / (dist || 1), dz = (tz - P.pos.z) / (dist || 1);
        const far = dist > (opts.range || 1.9);
        I.move.x = far ? dx * b.rx + dz * b.rz : 0;
        I.move.y = far ? dx * b.fx + dz * b.fz : 0;
        const r = (Math.sin(G.real * 12.9898 + f * 0.37) * 43758.5453) % 1, rr = Math.abs(r);
        if (!far && f % 7 === 0) {
          const tr = window.__ui().prompt?.step;
          if (ph === 'training') { if (tr === 0) I.press('attack'); else if (tr === 1) I.press('heavy'); else if (tr === 2) I.press('dodge'); else if (tr === 3) { I.press('block'); } }
          else if (P.ki >= 100) I.press('special');
          else if (rr < 0.12) I.press('heavy');
          else if (rr < 0.2) I.press('dodge');
          else I.press('attack');
        }
        if (ph === 'combat') I.held.block = opts.block ? (Math.floor(G.real * 2) % 3 === 0) : false;
      } else { I.move.x = I.move.y = 0; }
      window.__step(1 / 30, 1, false);
    }
    return shots;
  }, [frames, opts]);
  console.log('start', JSON.stringify(await info()));
  await bot(60); await step(1, true); await shot(S + '/g_train1.png');
  for (let i = 0; i < 12; i++) { await bot(30); const s = await info(); if (s.phase !== 'training') break; }
  console.log('after training', JSON.stringify(await info()));
  await step(20); await step(1, true); await shot(S + '/g_amb1.png');
  await step(85); await step(1, true); await shot(S + '/g_amb2.png');
  await step(75); await step(1, true); await shot(S + '/g_amb3.png');
  await step(40);
  console.log('combat?', JSON.stringify(await info()));
  let n = 0;
  for (let i = 0; i < 90; i++) {
    await bot(30, { block: i % 3 === 0 });
    const s = await info();
    if (i % 4 === 0) console.log(i, JSON.stringify(s));
    if (i % 6 === 2 && n < 9) { await step(1, true); await shot(S + '/g_c' + (n++) + '.png'); }
    if (s.phase === 'finisher') { await step(24); await step(1, true); await shot(S + '/g_fin1.png'); await step(20); await step(1, true); await shot(S + '/g_fin2.png'); await step(45); await step(1, true); await shot(S + '/g_fin3.png'); }
    if (s.phase === 'victory' || s.phase === 'defeat') { console.log('END', JSON.stringify(s)); break; }
  }
  await step(100); await step(1, true); await shot(S + '/g_vic1.png');
  await step(160); await step(1, true); await shot(S + '/g_vic2.png');
  console.log('final', JSON.stringify(await info()), JSON.stringify(await page.evaluate(() => window.__ui().stats)));
}
