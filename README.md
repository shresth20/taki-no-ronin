# Taki no Ronin (滝の浪人)

An anime samurai action game for the browser. A ronin leaves the waterfall where he trains and walks one continuous road through six lands to the castle of the Black Fang: a village, a bamboo forest, a mountain temple, a fortress and the castle itself, with three bosses on the way.

Built with **Three.js, React Three Fiber, Drei, Rapier, GSAP and postprocessing**. Every model, animation, shader and sound is generated in code. Two painted textures (a brush texture for rock and ground, and the parchment of the journey map) were generated with ChatGPT and are embedded in the bundle, so the game makes no asset requests and runs offline.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/index.html + dist/game.js + dist/style.css
npm run build:page   # also writes page/standalone.html (one self-contained file, works from disk)
```

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | WASD or arrows | Left stick |
| Attack (4-hit combo) | Left click, J or U | 斬 |
| Heavy (guard break, press again to leap) | Right click, K or O | 剛 |
| Dodge roll | Shift or L | 避 |
| Block, tap just before impact to parry | F or Q | 防 |
| Jump, attack in the air to plunge | Space | 跳 |
| Special, when ki is full | E or I | 奥義 |
| Journey map | M or Tab | 地 button |
| Pause / skip cinematic | P / Enter | Buttons |
| Developer overlay | ` (backquote) | add `?debug` to the URL |

The camera is authored per place and follows on its own, so there is no look control. Gold weapon glints can be parried. Red glints cannot be blocked: roll away. Spirit lamps (blue flames) heal you, save the journey and are where you rise again after a defeat.

## The world

The six zones sit side by side in one coordinate space (+X east, +Z south, metres) and are joined by ground you walk on. There are no loading screens and no teleports.

| # | Zone | Data file | Leaves by | Fights |
| --- | --- | --- | --- | --- |
| 00 | Shirataki Falls 白滝 | `z0-waterfall.js` | gorge trail, boardwalk and wooden bridge | training |
| 01 | Hanamura village 花村 | `z1-village.js` | red bridge behind the east gate | street ambush, plaza |
| 02 | Sasayaki bamboo forest 囁きの森 | `z2-bamboo.js` | stream bridge to the mountain stair | ambush, clearing |
| 03 | Unkai-ji temple 雲海寺 | `z3-temple.js` | east gate and sky bridge | landing, abbot Jakugan (boss) |
| 04 | Kurogane stronghold 黒鉄砦 | `z4-fortress.js` | main gate to the castle road | gate guards, yard, captain Kurogane (boss) |
| 05 | Onikage castle 鬼影城 | `z5-castle.js` | (journey's end) | garden, inner court, lord Onikage (final boss) |

The waterfall valley is the original scene and is kept as it was; only its exits (trail, boardwalk, bridge) are new.

### Zone data

Everything about a zone is plain data in `src/world/zones/`. The engine reads these files and nothing else, so the layout can be reshaped without touching engine code.

```js
export default {
  id, index, name, kanji, sub,
  rect,                      // world bounds: streaming, camera limits, map
  entry, exit,               // where the road comes in and goes out
  ground, boundary,          // palette, edge treatment, what stands along the walkable edge
  walk: [circle(), box(), path(), deck(), stairs()],   // where feet may go, with heights
  pads, water, terrain,      // raised courts, rivers/ponds/paddies, ridges and cliffs
  structures: [{ type, x, z, rot, ... }],              // buildings, gates, walls, props, lamps
  trees,                     // planting rules
  checkpoints: [{ id, x, z }],
  encounters: [{ id, trigger, arena, waves, intro, locks, opens, checkpoint }],
  camera: [{ x, z, r, yaw, dist, pitch }],             // authored view regions, blended
  lighting, audio,           // sun, fog, sky, ambience mix
  route, landmark, reveal, objective,                  // map line, map icon, arrival shot, HUD line
};
```

`footprints.js` turns structures into collision shapes. The same shapes feed the physics colliders, the debug overlay and the map, so they cannot drift apart.

## How it is put together

```
src/
  core/        state, input, physics (Rapier), audio, shared shader helpers
  world/
    zones/     the six zone definitions, shape constructors, structure footprints   <- level data
    nav.js     walkable area, ground and water height, collision, gates and wards, camera regions
    zone.js    builds one zone's meshes from its data (terrain, water, architecture, planting, boundary)
    stream.js  loads zones ahead of the player and releases them behind
    kit/       cel-shaded architecture kit: one material, roofs, walls, bridges, props
    env.js     per-zone lighting blended by position, battle and victory moods
    index.js   shared sky, sun, lights, particles; owns the streamer
    (terrain, water, vegetation, props, sky, atmosphere: the original waterfall valley)
  chars/       procedural skinned rig, IK animator, pose clips, cloth
  game/        loop, player, enemy AI, combat, camera rig, journey (progress, gates, save), director (flow, cinematics)
  vfx/         sword trails, slashes, particles, colour grade
  ui/          HUD, touch controls, journey map, debug overlay, title, pause and result screens
tests/         headless playtests (run with scripts/shot.mjs)
tools/         mapdebug.mjs: top-down PNG of the baked navigation
docs/          ASSETS.md: what is temporary and what a production pass would replace
```

**Navigation and collision.** Each zone's walk shapes are baked into 1 m grids (ground height, walk distance field, water level, surface type). The player and enemies are projected back onto the walkable field every step, so nobody can leave a bridge deck, step off a cliff, wade into deep water or cross a balustrade, and there are no invisible walls where the ground looks walkable. Buildings, rocks and props are Rapier colliders. Closed gates and the wards that seal an arena are one-sided walls.

**Streaming.** The zone you are in and its neighbours are always built. Any other zone within 70 m starts building a few milliseconds per frame and is disposed once it is 125 m behind. Geometry and texture counts return to their baseline after a zone is released (checked in `tests/world.mjs`).

**Camera.** An elevated three-quarter view with an authored direction, distance and pitch for each stretch of road, blended as you walk. It pulls back in arenas, cuts a window through roofs, rock and canopy that come between the lens and the ronin, and plays a short establishing shot the first time you enter each zone.

**Progress.** Clearing a fight opens the gate it guards, lights the next lamp and is saved to `localStorage` (`tnr-journey-v1`). The title screen offers Continue.

**Journey map.** Drawn from the same zone data as the world (roads, bridges, water, roofs, walls, gates), so it always matches the real layout. It shows where you are, the road walked in gold and the road ahead dotted, lamps, boss seals and the castle.

## Developer tools

Press ` or add `?debug` for the overlay: walkable area, collision footprints, closed gates and wards, zone bounds, triggers, spawn points, lamps, entry and exit, the camera's view on the ground, loaded chunks, frame rate, draw calls, triangles, geometry and texture counts, and buttons that jump to any zone.

URL parameters: `quality=low|medium|high`, `start=training|intro|road`, `zone=0..5`, `at=x,z`, `debug`, `noocc` (turn off the camera cut-away), `test` (deterministic stepping for the harness).

## Tests

```bash
npm run build
node scripts/shot.mjs --file tests/journey.mjs --q "start=road"   # a bot walks and fights the whole road to victory
node scripts/shot.mjs --file tests/world.mjs                      # 18 checks: collision, gates, stairs, wards, save, streaming, memory
node scripts/shot.mjs --file tests/logic.mjs                      # parry, counter, block, plunge, defeat, retry, pause
node scripts/shot.mjs --file tests/perf.mjs --q "quality=low"     # draw calls, triangles, update cost and memory per zone
node scripts/shot.mjs --file tests/tour.mjs --set a               # screenshots along the road (sets a, b, c)
node scripts/shot.mjs --file tests/cine.mjs                       # title and zone reveal shots
node scripts/shot.mjs --file tests/mobile.mjs --w 844 --h 390 --touch 1 --tag ml
node tools/mapdebug.mjs nav.png -130 440 -260 290 2               # navigation bake as an image
```

## Performance

Measured in headless Chromium at one gameplay spot per zone (`tests/perf.mjs`). Triangle counts include the shadow and water-mirror passes.

| Quality | Draw calls | Triangles per frame | Geometry held | Notes |
| --- | --- | --- | --- | --- |
| High | 117 to 361 | 0.40 M to 2.5 M | 25 to 37 MB | 2048 shadows, mirror water, bloom, DPR up to 2 |
| Medium | 116 to 361 | 0.39 M to 2.4 M | 24 to 35 MB | 1024 shadows, mirror on alternate frames, DPR up to 1.5 |
| Low (reduced effects) | 76 to 152 | 0.17 M to 0.89 M | 22 to 29 MB | no shadows, mirror or bloom, DPR 1, half-density terrain, 40% planting |

Simulation costs 0.1 to 0.5 ms per frame. In-scene textures decode to under 1 MB; the map parchment is 2.6 MB decoded while the map is open. The heaviest place is the waterfall valley, which is the original dense scene.

The game starts on low for devices that report 4 GB of memory or fewer than five cores and are touch or small-screen, medium for other phones and tablets, and high on desktops. If the frame rate stays low it steps down by itself, and the title and pause screens let the player choose.

These are renderer loads, not frame rates. The build has not been run on physical phones, tablets or Chromebooks yet.

## Replacing the temporary art

See `docs/ASSETS.md` for the full inventory. In short:

- **Characters:** `src/chars/character.js` is the only place gameplay touches a rig. A GLB with authored clips can be wrapped in the same interface (`play`, `update`, `tip`, `base`, `chest`, `head`).
- **Architecture and props:** each structure type is one builder function in `src/world/kit/build.js`, keyed by the `type` used in zone data. Swap a builder for a loaded model and every placement updates.
- **Textures:** `src/assets/paint.js` and `src/assets/parchment.js` hold the two painted images; originals are in `assets-src/`.
