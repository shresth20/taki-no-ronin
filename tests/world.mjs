// World logic checks: collision, gates, wards, checkpoints, defeat/retry, save/continue, streaming and memory.
export default async function (page) {
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const out = [];
  const ok = (name, pass, info = '') => { out.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
  // helper inside the page: hold a world-space direction for n frames
  await ev(() => {
    window.__walk = (dx, dz, n) => {
      const G = window.__G, I = window.__input, P = G.player;
      for (let i = 0; i < n; i++) {
        const b = G.rig.basis({}, G.rig.moveYaw);
        I.move.x = dx * b.rx + dz * b.rz; I.move.y = dx * b.fx + dz * b.fz;
        window.__step(1 / 30, 1, false);
      }
      I.move.x = I.move.y = 0;
      return [P.pos.x, P.pos.y, P.pos.z];
    };
    window.__nav = null;
  });

  // 1. the river blocks, the bridge carries
  let r = await ev(() => { window.__G.journey.reset(false); window.__goto(0, 6, 118.7); return window.__walk(0, 1, 90); });
  ok('cannot walk off the side of the falls bridge', r[2] < 120.6, `z=${r[2].toFixed(2)}`);
  r = await ev(() => { window.__goto(0, -9, 60); return window.__walk(1, 0, 120); });
  ok('gorge trail: river bank stops the player', r[0] < -5.5, `x=${r[0].toFixed(2)}`);
  r = await ev(() => { window.__goto(0, -9, 60); return window.__walk(-1, 0, 120); });
  ok('gorge trail: hillside stops the player', r[0] > -13.5, `x=${r[0].toFixed(2)}`);

  // 2. a locked gate holds, then opens once its encounter is cleared
  r = await ev(() => { const G = window.__G; G.journey.reset(false); G.journey.unlockThrough(1); window.__goto(1, 88, 212.4); return { p: window.__walk(1, 0.16, 150), open: G.journey.gateOpen('v-east') }; });
  ok('village east gate is barred before the plaza is cleared', !r.open && r.p[0] < 95.2, `x=${r.p[0].toFixed(2)}`);
  r = await ev(() => { const G = window.__G; G.journey.unlockThrough(2); window.__goto(1, 88, 212.4); return { p: window.__walk(1, 0.16, 150), open: G.journey.gateOpen('v-east') }; });
  ok('…and stands open afterwards', r.open && r.p[0] > 99, `x=${r.p[0].toFixed(2)}`);

  // 3. buildings are solid
  r = await ev(() => { window.__goto(1, 43, 178); return window.__walk(0.87, -0.5, 120); });
  ok('houses block movement', Math.hypot(r[0] - 51.5, r[2] - 172.5) > 3.2, `at ${r[0].toFixed(1)}, ${r[2].toFixed(1)}`);

  // 4. plateau edges and stairs
  r = await ev(() => { const G = window.__G; G.journey.unlockThrough(4); window.__goto(3, 222, -4); return window.__walk(-1, 0, 200); });
  ok('temple court: balustrade edge holds', r[0] > 198.5 && Math.abs(r[1] - 21.5) < 0.3, `x=${r[0].toFixed(2)} y=${r[1].toFixed(2)}`);
  r = await ev(() => { window.__goto(3, 222, 86); const a = window.__walk(0, -1, 110); return a; });
  ok('stairs climb to the landing', r[1] > 11.5, `y=${r[1].toFixed(2)} z=${r[2].toFixed(1)}`);
  r = await ev(() => { window.__goto(3, 284, 8); return [window.__walk(0, 1, 60), window.__G.player.pos.y]; });
  ok('sky bridge: stays on the deck', r[0][2] < 10.2 && r[1] > 22, `z=${r[0][2].toFixed(2)} y=${r[1].toFixed(2)}`);

  // 5. an encounter raises wards, clears, and remembers
  r = await ev(() => {
    const G = window.__G, P = G.player;
    G.journey.reset(false); G.journey.unlockThrough(1); window.__goto(1, 36, 166);
    P.hpMax = P.hp = 9999;
    window.__walk(0.5, 0.86, 60);
    const started = G.journey.active?.enc.id, wards = G.journey.active?.wards.length;
    // try to leave the fight the way we came
    const back = window.__walk(-0.5, -0.86, 140);
    const held = Math.hypot(back[0] - 43, back[2] - 178) < 12.4;
    for (const e of G.enemies) e.takeHit(9999, P.pos.x, P.pos.z, { heavy: 1 }, { pierce: true });
    window.__step(1 / 30, 150, false);
    return { started, wards, held, cleared: G.journey.state.cleared.includes('v-street'), phase: window.__ui().phase, back };
  });
  ok('street encounter starts and raises wards', r.started === 'v-street' && r.wards >= 2, `wards=${r.wards}`);
  ok('wards hold the player inside the fight', r.held, `at ${r.back[0].toFixed(1)}, ${r.back[2].toFixed(1)}`);
  ok('encounter clears and returns to exploring', r.cleared && r.phase === 'explore', r.phase);

  // 6. checkpoint, defeat, rise again
  r = await ev(() => {
    const G = window.__G, P = G.player;
    G.journey.reset(false); G.journey.unlockThrough(2); window.__goto(2, 124, 212);
    window.__walk(1, 0, 40);
    const cp = G.journey.state.checkpoint;
    window.__goto(2, 150, 194.4); window.__step(1 / 30, 5, false);
    P.hp = 0; P.setState('dead'); G.director.onPlayerDeath();
    window.__step(1 / 30, 80, false);
    const phase = window.__ui().phase;
    G.director.retry();
    window.__step(1 / 30, 10, false);
    return { cp, phase, after: window.__ui().phase, pos: [P.pos.x, P.pos.z], hp: P.hp, deaths: G.journey.state.deaths };
  });
  ok('spirit lamp sets the checkpoint', r.cp === 'bamboo-edge', r.cp);
  ok('defeat then rise again at the lamp', r.phase === 'defeat' && r.after === 'explore' && Math.hypot(r.pos[0] - 129.5, r.pos[1] - 212) < 1.5 && r.hp > 90, `${r.phase} → ${r.after} at ${r.pos.map((v) => v.toFixed(1))}`);

  // 7. the save survives a reload
  const saved = await ev(() => localStorage.getItem('tnr-journey-v1'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.ready && window.__step, null, { timeout: 90000 });
  r = await ev(() => {
    const G = window.__G;
    window.__step(1 / 30, 5, false);
    const has = window.__ui().hasSave;
    G.director.begin(true);
    window.__step(1 / 30, 20, false);
    return { has, phase: window.__ui().phase, pos: [G.player.pos.x, G.player.pos.z], zone: window.__ui().zone, cleared: G.journey.state.cleared.length, gate: G.journey.gateOpen('v-east') };
  });
  ok('save is written', !!saved && saved.includes('bamboo-edge'));
  ok('Continue resumes at the saved lamp with gates as left', r.has && r.phase === 'explore' && r.zone === 2 && r.gate === true && Math.hypot(r.pos[0] - 129.5, r.pos[1] - 212) < 1.5, JSON.stringify(r));

  // 8. streaming: zones come and go, and memory comes back
  r = await ev(() => {
    const G = window.__G, mem = () => ({ ...G.gl.info.memory });
    const st = () => G.world.streamer.status().map((s) => s[0]).join('');
    G.journey.unlockThrough(6);
    window.__goto(0); window.__step(1 / 30, 3, true); const sa = st();
    window.__goto(5); window.__step(1 / 30, 3, true); const sb = st();
    window.__goto(0); window.__step(1 / 30, 3, true); const a = mem();
    window.__goto(3); window.__step(1 / 30, 3, true); const sd = st();
    window.__goto(5); window.__step(1 / 30, 3, true); const b = mem();
    window.__goto(0); window.__step(1 / 30, 3, true); const c = mem(), sc = st();
    return { a, sa, b, sb, c, sc, sd, calls: G.gl.info.render.calls, tris: G.gl.info.render.triangles };
  });
  const count = (s) => s.split('l').length - 1;
  ok('only nearby zones are loaded', count(r.sa) <= 3 && count(r.sb) <= 4 && r.sb[5] === 'l' && count(r.sd) <= 5, `${r.sa} ${r.sb} ${r.sd} ${r.sc}`);
  ok('released zones free their geometry and textures', Math.abs(r.c.geometries - r.a.geometries) <= 2 && Math.abs(r.c.textures - r.a.textures) <= 1, `geometries ${r.a.geometries} → ${r.b.geometries} → ${r.c.geometries}, textures ${r.a.textures} → ${r.b.textures} → ${r.c.textures}`);
  console.log(out.join('\n'));
  console.log(`${out.filter((l) => l.startsWith('PASS')).length} / ${out.length} passed`);
}
