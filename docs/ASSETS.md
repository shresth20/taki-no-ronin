# Asset inventory: what is temporary

No final artwork was supplied for this build, and the reference map image mentioned in the brief did not arrive with it. The world layout was therefore built from the written description, and everything visible is either generated in code or one of two ChatGPT-generated paintings. The game is complete and playable with these stand-ins. This file lists each of them, how good a stand-in it is, and where to swap in authored work.

Status key: **Keep** means the stand-in is close to shippable in this art style. **Temp** means it works and reads clearly but an artist would replace it. **Missing** means nothing stands in for it yet.

## Reference material

| Item | Status | Notes |
| --- | --- | --- |
| Reference world map image | Missing | Not attached to the brief. Zone order, connections and landmarks follow the text. To match a drawn map, edit positions in `src/world/zones/*.js`; the journey map redraws itself from the same data. |

## Characters and animation

| Item | In place now | Status | Swap point |
| --- | --- | --- | --- |
| Ronin (player) | Skinned mesh assembled from primitives with vertex colours and an outline hull | Temp | `src/chars/rig.js`, wrapped by `src/chars/character.js` |
| Bandit, spearman, elite | Same rig, different palette, proportions and weapon | Temp | `PALETTES` and `VARIANTS` in `src/chars/rig.js` |
| Abbot Jakugan, Captain Kurogane, Lord Onikage (bosses) | Same rig, scaled, with distinct colours and weapons | Temp: bosses most need unique silhouettes | same |
| Villagers, monks, animals | None. The village and temple are unpopulated apart from enemies | Missing | new character kinds in `rig.js`, placed from zone data |
| Animation | Pose clips blended procedurally with IK feet and cloth ribbons | Temp | clips in `src/chars/poses.js`; a GLB with Mixamo or mocap clips can sit behind the same `Character` interface |
| Faces and voice | Painted eyes only, no mouth movement, no voice | Missing | subtitles carry all dialogue |

## Architecture and props

All built by `src/world/kit/build.js`, one function per `type` used in zone data.

| Item | In place now | Status |
| --- | --- | --- |
| Farmhouses, town houses, shop, inn, storehouse | Box bodies with swept thatch or tile roofs, plank and plaster shading, lit paper windows | Temp |
| Watermill | Mill house with a turning wheel | Temp |
| Temple hall, pagoda, bell tower, pavilion, shrine, jizo, torii, statues | Kit-built with curved roofs | Temp; the pagoda and main hall deserve authored models |
| Fortress walls, stone bases, yagura and watch towers, barracks, gates | Kit-built, gates swing open | Temp |
| Castle keep, octagonal arena wall, great stair | Kit-built, five-tier keep | Temp; the keep is the journey's destination and the best candidate for a hero model |
| Bridges (plank, boardwalk, red arched, stone, trestle sky bridge) and stairs | Generated along the path data, so they always fit the route | Keep |
| Props: stalls, well, carts, crates, barrels, baskets, racks, barricades, tents, braziers, torches, banners, drums, lanterns, censer, haystacks, scarecrow, signposts | Kit-built | Temp |
| Fences, rails, balustrades, palisades | Instanced along the edge of the walkable area | Keep |

## Terrain, vegetation and water

| Item | In place now | Status |
| --- | --- | --- |
| Terrain | Heightfields built from each zone's walk shapes, pads and ridges, painted by surface type | Keep |
| Rock and cliff | Faceted generated meshes with a painted brush texture | Keep |
| Brush texture | `src/assets/paint.js`, generated with ChatGPT, source in `assets-src/` | Keep |
| Trees (pine, maple, cherry, broadleaf), bamboo, grass, rice | Instanced card foliage with wind | Temp to Keep; bamboo leaves are the weakest |
| Rivers, ponds, paddies, weirs, the great fall | Shader water with flow, foam and a mirror pass in the valley | Keep |
| Sky, far mountains, cloud sea | Generated | Keep |

## Effects and interface

| Item | In place now | Status |
| --- | --- | --- |
| Sword trails, slashes, sparks, dust, petals, leaves, embers, smoke, light shafts | Shader and particle effects | Keep |
| Arena wards | Translucent shimmering planes | Temp |
| HUD, title, pause, result, zone cards | HTML and CSS | Keep |
| Journey map parchment | `src/assets/parchment.js`, generated with ChatGPT, source in `assets-src/` | Keep |
| Journey map drawing and icons | SVG drawn from zone data | Keep |
| Fonts | Zen Antique and Zen Kaku Gothic New from Google Fonts, system serif when offline | Temp: bundle the font files for a fully offline release |

## Audio

| Item | In place now | Status |
| --- | --- | --- |
| Ambience (falls, river, wind, birds, fire) | Synthesised with the Web Audio API and mixed per zone | Temp |
| Music | Small generative score with battle and victory layers | Temp: a composed score per zone and per boss is the largest single upgrade |
| Sword, impact, footstep, gate and interface sounds | Synthesised | Temp |
| Voice | None | Missing |

## Suggested order for a production pass

1. Boss characters and the ronin, with authored animation.
2. Castle keep, temple hall and pagoda as hero models.
3. Composed music and recorded effects.
4. Village life: villagers, animals, more varied house fronts.
5. Bundled fonts and a service worker for an installable offline release.
