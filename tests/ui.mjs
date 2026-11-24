// HUD, journey map and debug overlay captures
export default async function (page, { shot }) {
  const step = (n, r = false) => page.evaluate(([n, r]) => window.__step(1 / 30, n, r), [n, r]);
  await step(40); await step(2, true); await shot('shots/u_explore.png');
  await page.evaluate(() => window.__G.director.toggleMap(true));
  await page.waitForTimeout(700); await shot('shots/u_map.png');
  await page.evaluate(() => { window.__G.director.toggleMap(false); window.__ui().set({ debug: true }); });
  await step(4, true); await page.waitForTimeout(600); await shot('shots/u_debug.png');
}
