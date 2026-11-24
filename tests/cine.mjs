// Captures the zone reveal shots and the title screen
export default async function (page, { shot }) {
  const step = (n, r = false) => page.evaluate(([n, r]) => window.__step(1 / 30, n, r), [n, r]);
  await step(30); await step(2, true); await shot('shots/c_title.png');
  for (const zi of [1, 2, 3, 4, 5]) {
    await page.evaluate((zi) => { const G = window.__G; G.journey.reset(false); G.journey.unlockThrough(zi - 1); G.journey.state.seen = G.journey.state.seen.filter((i) => i < zi); window.__goto(zi); G.journey.state.seen = G.journey.state.seen.filter((i) => i < zi); }, zi);
    await page.evaluate((zi) => { const G = window.__G; G.director.onZoneEnter(zi, true); }, zi);
    await step(40); await step(2, true); await shot(`shots/c_reveal${zi}a.png`);
    await step(70); await step(2, true); await shot(`shots/c_reveal${zi}b.png`);
  }
}
