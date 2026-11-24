// Touch layout on a phone: exploring, fighting and the journey map
export default async function (page, { shot, args }) {
  const tag = args.tag || 'm';
  const step = (n, r = false) => page.evaluate(([n, r]) => window.__step(1 / 30, n, r), [n, r]);
  await page.evaluate(() => { window.__ui().set({ isTouch: true }); const G = window.__G; G.journey.reset(false); G.journey.unlockThrough(1); window.__goto(1, 52, 194); });
  await step(30); await step(2, true); await shot(`shots/${tag}_explore.png`);
  await page.evaluate(() => { const G = window.__G; G.player.hpMax = G.player.hp = 9999; window.__walk?.(0, 0, 0); G.player.place(58, 202, 0); });
  await step(200); await step(2, true); await shot(`shots/${tag}_combat.png`);
  await page.evaluate(() => { window.__ui().set({ phase: 'explore' }); window.__G.director.toggleMap(true); });
  await page.waitForTimeout(600); await shot(`shots/${tag}_map.png`);
}
