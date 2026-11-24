// Visual tour: fixed cameras and gameplay views across the world. usage: node scripts/shot.mjs --file tests/tour.mjs --set a
const SETS = {
  a: [ // zone 0 additions + village
    ['t0_trail', 0, -12, 50, null],
    ['t0_shrine', 0, -13, 56, [[-4, 6, 62], [-17, 1.5, 55]]],
    ['t0_board', 0, -3, 98, null],
    ['t0_bridge', 0, 6, 118.6, null],
    ['t0_bridge2', 0, 6, 118.6, [[-14, 9, 132], [8, 2, 118]]],
    ['t1_gate', 1, 24, 147, null],
    ['t1_weir', 1, 24, 147, [[22, 7, 160], [6, 0, 150]]],
    ['t1_mill', 1, 19, 191, null],
    ['t1_mill2', 1, 19, 191, [[26, 6, 198], [12, 2, 186]]],
    ['t1_knoll', 1, 79, 180, null],
    ['t1_dike', 1, 62, 236, null],
    ['t1_redbridge', 1, 104, 213.6, null],
    ['t1_redbridge2', 1, 104, 213.6, [[96, 7, 226], [112, 3, 212]]],
  ],
  b: [ // bamboo + temple
    ['t2_enter', 2, 130, 210, null],
    ['t2_foot', 2, 150, 194.5, null],
    ['t2_c1', 2, 166, 180, null],
    ['t2_fork', 2, 196, 168.5, null],
    ['t2_grove', 2, 232, 165, null],
    ['t2_grove2', 2, 232, 165, [[224, 6, 172], [236, 3.5, 163]]],
    ['t2_bridge', 2, 220.8, 113, null],
    ['t3_foot', 3, 222, 96, null],
    ['t3_landing', 3, 222, 58, null],
    ['t3_stair2', 3, 222, 40, null],
    ['t3_court', 3, 222, 18, null],
    ['t3_statue', 3, 212, 6, [[224, 25, 16], [206, 24, 6]]],
    ['t3_fall', 3, 240, -5, [[250, 30, 10], [262, 12, -34]]],
    ['t3_east', 3, 256, 7, null],
    ['t3_sky', 3, 284, 8, null],
    ['t3_sky2', 3, 284, 8, [[262, 30, 34], [288, 16, 6]]],
  ],
  c: [ // fortress + castle
    ['t4_gate', 4, 305, 8, null],
    ['t4_a', 4, 322, 10, null],
    ['t4_b', 4, 360, 8, null],
    ['t4_b2', 4, 360, 8, [[344, 30, 32], [364, 22, 2]]],
    ['t4_c', 4, 372, -36, null],
    ['t4_c2', 4, 372, -36, [[372, 27, -22], [372, 24, -52]]],
    ['t5_road', 5, 372, -70, null],
    ['t5_garden', 5, 372, -94, null],
    ['t5_garden2', 5, 366, -94, [[352, 30, -84], [380, 24, -102]]],
    ['t5_inner', 5, 372, -140, null],
    ['t5_stair', 5, 372, -168, null],
    ['t5_arena', 5, 372, -194, null],
    ['t5_arena2', 5, 372, -194, [[372, 46, -166], [372, 38, -226]]],
  ],
};
export default async function (page, { shot, args }) {
  for (const [name, zi, x, z, cam] of SETS[args.set || 'a']) {
    await page.evaluate(([zi, x, z, cam]) => {
      const G = window.__G;
      G.journey.unlockThrough(6); // everything cleared: no fights interrupt the tour
      window.__goto(zi, x, z);
      window.__cam(cam ? cam[0] : null, cam ? cam[1] : null);
      window.__step(1 / 30, 50, false);
      window.__step(1 / 30, 2, true);
    }, [zi, x, z, cam]);
    await shot(`shots/${name}.png`);
  }
}
