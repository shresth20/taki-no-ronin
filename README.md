# Taki no Ronin (滝の浪人)

An anime samurai action vertical slice for the browser: dawn practice beside a waterfall, an ambush, three waves of combat, a cinematic finisher and a victory sequence.

Built with **Three.js, React Three Fiber, Drei, Rapier, GSAP and postprocessing**. Every model, animation, shader, sound and effect is generated in code, apart from one painted brush texture.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/index.html + dist/game.js + dist/style.css
npm run build:page   # also writes page/standalone.html (one self-contained file)
```

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | WASD or arrows | Left stick |
| Look | Mouse (click the scene to capture it) | Drag on the right side |
| Attack (4-hit combo) | Left click or J | 斬 |
| Heavy (guard break, press again to leap) | Right click or K | 剛 |
| Dodge roll | Shift or L | 避 |
| Block, tap just before impact to parry | F or Q | 防 |
| Jump, attack in the air to plunge | Space | 跳 |
| Special, when ki is full | E or I | 奥義 |
| Pause / skip cinematic | P / Enter | Buttons |

Gold weapon glints can be parried. Red glints cannot be blocked: roll away.
Attacking right after a parry is a counter. Attacking right after a roll is a dash cut.

## How it is put together

```
src/
  core/      state (zustand + mutable game context), input, physics (Rapier), audio, shared shader helpers
  world/     terrain + cliff generation, water and waterfall shaders, sky, vegetation, props, atmosphere, mood presets
  chars/     procedural skinned rig, IK animator, pose clips, cloth ribbons
  game/      game loop, player, enemy AI, combat resolution, camera rig, director (flow + cinematics)
  vfx/       sword trails, slash crescents, particles, rings, glints, final colour grade
  ui/        React HUD, touch controls, title, pause and result screens
tests/       headless playtest scripts (run with scripts/shot.mjs)
```

**Rendering.** React Three Fiber hosts the canvas and the post chain (bloom plus a custom grade effect that also does impact flashes, chromatic split, invert frames and radial speed blur). The simulation is imperative and lives in `src/game`, so nothing re-renders through React during play.

**World.** A height function carves the river, plunge pool, meadow and valley walls; the cliff is a separate faceted mesh. Water uses a baked data texture (bed height, flow direction, churn) for depth colour, flow-mapped ripples, cel caustic lines, shoreline foam, interactive ripple rings and a planar reflection. Foliage is solid toon blobs plus camera-facing "fluffy" cards with spherical normals. Three mood presets (calm morning, storm of battle, golden victory) drive sun, sky, fog, wind and grade.

**Characters.** Each character is one skinned mesh assembled from primitives with vertex colours, an inverted-hull outline, and a weapon. Animation is pose-driven: clips are short lists of targets (hips, spine, sword-hand position, blade direction, feet) and arms and legs are solved with two-bone IK every frame, so sword arcs are authored as hand paths. Locomotion is procedural. Scarf, headband and ponytail are verlet ribbons.

**Combat.** Hit windows, lunges and cancel points are data on each clip (`src/chars/poses.js`). Enemies take turns through attack tokens, spread around the player in slots, telegraph with a glint, and can block, hop back, be guard-broken or parried. Hit-stop, camera trauma, sparks and petals are applied in `src/game/combat.js`.

**Physics.** Rapier kinematic character controllers slide the player and enemies around trees, rocks and props; dropped weapons are rigid bodies on a trimesh of the arena. If WebAssembly is unavailable the same interface falls back to a small built-in solver.

**Audio.** No samples: ambience, a small generative score and all effects are synthesised with the Web Audio API.

## Swapping in authored assets

The slice is structured so real assets can replace the procedural ones:

- **Characters:** `src/chars/character.js` is the only place gameplay touches a rig. A GLB with Mixamo clips can be wrapped in the same interface (`play`, `update`, `tip`, `base`, `chest`, `head`) using `THREE.AnimationMixer`.
- **Environment:** every world piece is a function returning an `Object3D` in `src/world`. Replace any of them with a loaded GLB.
- **Brush texture:** `src/assets/paint.js` holds the painted texture used triplanar on rock, cliff and ground.

## Automated playtest

```bash
npm run build
node scripts/shot.mjs --q "quality=medium&start=training" --file tests/flow2.mjs
```

A simple bot plays from training to victory in a headless browser using deterministic stepping (`?test` exposes `window.__step`).
