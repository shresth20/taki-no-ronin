const S = 'shots';
export default async function (page, { shot }) {
  const step = (n, render = false, dt = 1 / 60) => page.evaluate(([n, r, dt]) => window.__step(dt, n, r), [n, render, dt]);
  await page.evaluate(() => { const G = window.__G; G.player.place(-12, 10, Math.PI); G.rig.snapBehind(0); });
  await step(40); await step(1, true); await shot(S + '/b_idle.png');
  await page.evaluate(() => { window.__input.move.y = 1; });
  await step(45); await step(1, true); await shot(S + '/b_run.png');
  await page.evaluate(() => { window.__input.move.y = 0; window.__G.mood = 1; window.__input.press('block'); });
  await step(60); await step(1, true); await shot(S + '/b_block_mood1.png');
}
