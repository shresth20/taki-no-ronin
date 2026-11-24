// walks the whole slice with a simple bot and captures a frame at each beat
const S = 'shots';
export default async function (page, { shot }) {
  const step = (n, render = false, dt = 1 / 30) => page.evaluate(([n, r, dt]) => window.__step(dt, n, r), [n, render, dt]);
  const info = () => page.evaluate(() => { const G = window.__G, P = G.player; return { phase: window.__ui?.().phase, t: +G.real.toFixed(2), p: [+P.pos.x.toFixed(1), +P.pos.y.toFixed(2), +P.pos.z.toFixed(1)], st: P.state, hp: Math.round(P.hp), ki: Math.round(P.ki), en: G.enemies.map(e => e.kind[0] + ':' + e.state + ':' + Math.round(e.hp)).join(' ') }; });
  await step(30); await step(2, true);
  await shot(S + '/f_title.png');
  console.log('title', JSON.stringify(await info()));
  await page.evaluate(() => window.__G.director.begin());
  await step(60); await step(2, true); await shot(S + '/f_intro1.png');
  await step(180); await step(2, true); await shot(S + '/f_intro2.png');           // ~8.1s kneeling
  await step(146); await step(2, true); await shot(S + '/f_intro3.png');           // ~13.1s kata
  console.log('intro', JSON.stringify(await info()));
  await step(40); await step(2, true); await shot(S + '/f_intro4.png');            // heavy
  await step(100);
  console.log('after intro', JSON.stringify(await info()));
  await step(2, true); await shot(S + '/f_training.png');
}
