// logic checks without rendering: parry -> counter, plunge attack, defeat -> retry, pause
export default async function (page) {
  const step = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => window.__step(dt, n, false), [n, dt]);
  const ev = (f) => page.evaluate(f);
  await ev(() => window.__G.director.startCombat());
  await step(30);
  // --- parry: start blocking, then let an enemy blow land inside the window
  let r = await ev(() => {
    const G = window.__G, P = G.player, e = G.enemies[0];
    e.pos.set(P.pos.x + 1.6, P.pos.y, P.pos.z); e.activate(); e.setState('attack'); e.char.play('over');
    P.yaw = Math.PI / 2; window.__input.press('block');
    window.__step(1 / 60, 3, false);
    const res = G.combat.enemyHit(e, e.char.clip);
    return { res, pState: P.state, eState: e.state, parryOpen: G.time < P.parryUntil };
  });
  console.log('parry', JSON.stringify(r));
  await step(20);
  r = await ev(() => { const G = window.__G, P = G.player; window.__input.release('block'); window.__input.press('attack'); window.__step(1 / 60, 4, false); return { attack: P.attack, state: P.state }; });
  console.log('counter', JSON.stringify(r));
  await step(60);
  // --- block (late): chip damage only
  r = await ev(() => {
    const G = window.__G, P = G.player, e = G.enemies[1];
    e.pos.set(P.pos.x, P.pos.y, P.pos.z + 1.6); P.yaw = 0; P.setState('idle'); P.iframes = 0;
    window.__input.press('block'); window.__step(1 / 60, 30, false);
    const hp0 = P.hp; const res = G.combat.enemyHit(e, e.char.clips.side); window.__input.release('block');
    return { res, lost: +(hp0 - P.hp).toFixed(1) };
  });
  console.log('block', JSON.stringify(r));
  await step(40);
  // --- jump + plunge
  r = await ev(() => {
    const G = window.__G, P = G.player; P.setState('idle'); P.iframes = 0; window.__input.press('jump'); window.__step(1 / 60, 12, false);
    const air = P.airY; window.__input.press('attack'); window.__step(1 / 60, 3, false); const st = P.state; window.__step(1 / 60, 40, false);
    return { air: +air.toFixed(2), st, after: P.state, attack: P.attack, y: +P.airY.toFixed(2), roll: P.char.roll };
  });
  console.log('plunge', JSON.stringify(r));
  await step(60);
  // --- unblockable while blocking, then defeat and retry
  r = await ev(() => {
    const G = window.__G, P = G.player, e = G.enemies[0];
    P.setState('idle'); P.iframes = 0; P.hp = 8; window.__input.press('block'); window.__step(1 / 60, 30, false);
    const res = G.combat.enemyHit(e, { unblockable: 1, dmg: 1 });
    window.__input.release('block'); window.__step(1 / 30, 80, false);
    return { res, hp: P.hp, phase: window.__ui().phase, st: P.state };
  });
  console.log('defeat', JSON.stringify(r));
  r = await ev(() => { const G = window.__G; G.director.retry(); window.__step(1 / 30, 30, false); return { phase: window.__ui().phase, hp: G.player.hp, n: G.enemies.length, st: G.player.state, desat: +G.post.desat.toFixed(2) }; });
  console.log('retry', JSON.stringify(r));
  // --- pause freezes time
  r = await ev(() => { const G = window.__G; G.director.togglePause(); const t0 = G.time; window.__step(1 / 30, 10, false); const frozen = G.time === t0; G.director.togglePause(); window.__step(1 / 30, 5, false); return { frozen, running: G.time > t0 }; });
  console.log('pause', JSON.stringify(r));
  // --- roll interrupted by nothing, then hit during the vulnerable tail must not leave the body tilted
  r = await ev(() => { const G = window.__G, P = G.player, e = G.enemies[0]; P.setState('idle'); P.iframes = 0; window.__input.press('dodge'); window.__step(1 / 60, 26, false); const mid = P.char.roll; P.iframes = 0; G.combat.enemyHit(e, e.char.clips.side); window.__step(1 / 60, 2, false); return { mid: +mid.toFixed(2), after: P.char.roll, st: P.state }; });
  console.log('roll-hit', JSON.stringify(r));
}
