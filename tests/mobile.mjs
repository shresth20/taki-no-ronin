const S = 'shots';
export default async function (page, { shot }) {
  const step = (n, render = false, dt = 1 / 30) => page.evaluate(([n, r, dt]) => window.__step(dt, n, r), [n, render, dt]);
  await step(20); await step(1, true); await shot(S + '/p_title.png');
  await page.evaluate(() => window.__G.director.startTraining());
  await step(30); await step(1, true); await shot(S + '/p_train.png');
  await page.evaluate(() => window.__G.director.startCombat());
  await step(90);
  await page.evaluate(() => { window.__input.press('attack'); });
  await step(6); await step(1, true); await shot(S + '/p_combat.png');
}
