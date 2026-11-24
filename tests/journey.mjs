// Walks the whole road from the falls to the castle with a simple bot: follows each zone's route, fights every encounter,
// skips cinematics. Fails loudly if the player ever gets stuck. usage: node scripts/shot.mjs --file tests/journey.mjs [--q "start=road"] [--god 1] [--shots 1]
const S = 'shots';
export default async function (page, { shot, args }) {
  const god = args.god !== '0';
  const shots = args.shots === '1';
  await page.evaluate((god) => {
    const G = window.__G;
    const R = window.__route, P0 = G.player.pos;
    let wp = 0, bd = 1e9;
    R.forEach((p, i) => { const d = Math.hypot(p[0] - P0.x, p[1] - P0.z); if (d < bd) { bd = d; wp = i; } });
    window.__bot = { wp, stuck: 0, last: [0, 0], log: [], frames: 0 };
    const Z = G.journey && window.__zones;
    if (god) { G.player.hpMax = 100000; G.player.hp = 100000; }
  }, god);
  const run = (frames) => page.evaluate(([frames, god]) => {
    const G = window.__G, I = window.__input, P = G.player, D = G.director, B = window.__bot, ui = window.__ui;
    const route = window.__route;
    for (let f = 0; f < frames; f++) {
      const ph = ui().phase;
      B.frames++;
      if (god && P.hp < 50000) P.hp = 100000;
      if (ph === 'victory') return { done: true, ...B };
      if (ph === 'defeat') { D.retry(); B.log.push('retry@' + B.frames); }
      let tx, tz, fight = false;
      if (ph === 'combat') {
        const e = P.nearestEnemy(80);
        if (e) { tx = e.pos.x; tz = e.pos.z; fight = true; }
      } else if (ph === 'explore') {
        // next waypoint on the road
        while (B.wp < route.length - 1 && Math.hypot(route[B.wp][0] - P.pos.x, route[B.wp][1] - P.pos.z) < 1.7) B.wp++;
        tx = route[B.wp][0]; tz = route[B.wp][1];
      } else if (ui().canSkip && B.frames % 20 === 0) D.skip();
      if (tx !== undefined) {
        const b = G.rig.basis({}, G.rig.moveYaw);
        const dist = Math.hypot(tx - P.pos.x, tz - P.pos.z) || 1, dx = (tx - P.pos.x) / dist, dz = (tz - P.pos.z) / dist;
        const far = !fight || dist > 1.9;
        I.move.x = far ? dx * b.rx + dz * b.rz : 0;
        I.move.y = far ? dx * b.fx + dz * b.fz : 0;
        if (fight && !far && f % 7 === 0) {
          const r = Math.abs((Math.sin(G.real * 12.9898 + f * 0.37) * 43758.5453) % 1);
          if (P.ki >= 100) I.press('special'); else if (r < 0.14) I.press('heavy'); else if (r < 0.22) I.press('dodge'); else I.press('attack');
        }
      } else { I.move.x = I.move.y = 0; }
      window.__step(1 / 30, 1, false);
      // stuck detection while walking
      if (ph === 'explore') {
        const moved = Math.hypot(P.pos.x - B.last[0], P.pos.z - B.last[1]);
        if (B.frames % 90 === 0) { B.stuck = moved < 0.5 ? B.stuck + 1 : 0; B.last = [P.pos.x, P.pos.z]; }
        if (B.stuck >= 4) return { stuck: true, at: [P.pos.x.toFixed(1), P.pos.z.toFixed(1)], wp: B.wp, target: route[B.wp], walk: 0, ...B };
      } else B.stuck = 0;
    }
    return { phase: ui().phase, zone: ui().zone, p: [+P.pos.x.toFixed(1), +P.pos.y.toFixed(1), +P.pos.z.toFixed(1)], wp: B.wp, of: route.length, hp: Math.round(P.hp), enc: G.journey.active?.enc.id, wave: ui().wave, left: ui().enemiesLeft, cleared: G.journey.state.cleared.join(','), t: +G.real.toFixed(0), en: G.enemies.map((e) => e.kind[0] + ':' + e.state + ':' + Math.round(e.hp)).join(' ') };
  }, [frames, god]);
  let lastZone = -1, n = 0, lastKey = '';
  const t0 = Date.now();
  for (let i = 0; i < 400; i++) {
    const r = await run(150);
    if (r.done) { console.log('VICTORY', JSON.stringify({ frames: r.frames, log: r.log })); await page.evaluate(() => window.__step(1 / 30, 200, true)); await shot(S + '/j_victory.png'); break; }
    if (r.stuck) { console.log('STUCK', JSON.stringify(r)); await page.evaluate(() => window.__step(1 / 30, 1, true)); await shot(S + '/j_stuck.png'); break; }
    const key = r.zone + '|' + r.cleared + '|' + r.enc + '|' + r.wave;
    if (key !== lastKey || i % 30 === 0) console.log(JSON.stringify(r));
    lastKey = key;
    if (shots && (r.zone !== lastZone || i % 12 === 0)) { await page.evaluate(() => window.__step(1 / 30, 1, true)); await shot(`${S}/j_${String(n++).padStart(2, '0')}_z${r.zone}.png`); }
    lastZone = r.zone;
  }
  console.log('wall ms', Date.now() - t0);
}
