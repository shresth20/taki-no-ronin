// freeze-frames of individual moves, shot from a fixed side camera
const S = 'shots';
export default async function (page, { shot }) {
  const step = (n, render = false, dt = 1 / 60) => page.evaluate(([n, r, dt]) => window.__step(dt, n, r), [n, render, dt]);
  const cam = (ox, oy, oz) => page.evaluate(([ox, oy, oz]) => { const G = window.__G, P = G.player; window.__game.debugCam = { pos: [P.pos.x + ox, P.pos.y + oy, P.pos.z + oz], look: [P.pos.x, P.pos.y + 1.1, P.pos.z] }; }, [ox, oy, oz]);
  const press = (k) => page.evaluate((k) => window.__input.press(k), k);
  await page.evaluate(() => { const G = window.__G; G.player.place(-12, 8, Math.PI); G.rig.snapBehind(0); });
  await step(30);
  const moves = [['attack', 9], ['attack', 30, 'attack', 9], ['heavy', 24], ['dodge', 14], ['jump', 18]];
  let i = 0;
  for (const m of moves) {
    await page.evaluate(() => { const G = window.__G; G.player.place(-12, 8, Math.PI); G.player.setState('idle'); G.player.char.stop(); G.player.comboI = 0; G.hitstop = 0; });
    await step(20);
    for (let k = 0; k < m.length; k += 2) { await press(m[k]); await step(m[k + 1]); }
    await cam(3.2, 1.3, -3.4);
    await step(1, true);
    await shot(S + '/m_' + (i++) + '.png');
  }
  // back view as the player sees it
  await page.evaluate(() => { window.__game.debugCam = null; const G = window.__G; G.player.place(-12, 8, Math.PI); G.player.setState('idle'); G.rig.snapBehind(0); });
  await page.evaluate(() => { window.__input.move.y = 1; });
  await step(50); await step(1, true); await shot(S + '/m_run.png');
  await page.evaluate(() => { window.__input.move.y = 0; window.__G.mood = 1; });
  await step(40); await step(1, true); await shot(S + '/m_idle_mood1.png');
}
