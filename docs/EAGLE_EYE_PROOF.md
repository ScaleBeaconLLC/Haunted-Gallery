# Eagle-eye proof: Conservation Lab results

Branch `claude/eagle-eye-room-proof`. The rules, cameras and interface are described in `docs/EAGLE_EYE_DESIGN.md`; this file records what was built, how it was tested and what is still missing. Nothing here is deployed, and `main` and the live game are unchanged.

## What the proof contains

- **The new interface on every room.** Landscape phone layout, the mansion eagle-eye view, the room view, first person for hiding, peeking and struggles, tap to move and hide, Still / Sneak / Run, the break-free struggle, the rotate screen, Add to Home Screen and safe areas. These work in all 12 rooms because they only use the room data.
- **One rebuilt room: the Conservation Lab.** It is built in Blender and uses baked lighting. The other 11 rooms keep their current models. The guest suite keeps its committed model.
- **An offline review mode.** `?offline=1&skip=1&room=conservation` runs the real rules engine in the page with computer-played guests, so one phone can review a room without a server. A build made with `VITE_REVIEW_ROOM=conservation` defaults to this.

## The Conservation Lab build

`tools/blender/build_conservation_lab.py` (shared helpers in `tools/blender/hg_room.py`) builds the room, renders four views with Cycles, bakes the lighting and exports the game model:

```sh
tools/blender/blender-py tools/blender/build_conservation_lab.py              # writes into the repository
tools/blender/blender-py tools/blender/build_conservation_lab.py -- --out=DIR # or a scratch folder
```

| Output | Size |
|---|---|
| `client/public/models/rooms/conservation_lab.glb` | 4.45 MB (6.44 MB before `tools/assets/optimize-room.mjs`), 84,500 triangles, 34 materials |
| `conservation_lab_lightmap.jpg` | 1024 × 1024, 0.31 MB (baked at 2048, then halved) |
| `conservation_lab.json` | lightmap `scale` 3.00, `exposure` 1.52 |
| `art/blender/conservation_lab.blend` | 1.2 MB, uses `art/blender/textures/lab_*.jpg` |
| `docs/renders/conservation_lab_*.png` | bird's-eye, room level, under the table, behind the rack |
| `tools/blender/conservation_lab_obstacles.json` | the 31 furniture footprints the server walks around |

A server test (`server/test/room-data.test.ts`) checks that the server's lab furniture matches that JSON, and that every doorway can reach every hiding place and all 16 arrival spots.

**Lighting in the game.** The lab's surfaces use the baked light and ignore the runtime lights; the characters are still lit by the practical lights at the lamps, sconces and candles. The baked light is multiplied by `scale × exposure` so the room matches the Blender render's brightness.

**Colour.** The game uses ACES tone mapping, which makes the lab warmer and redder than the Blender render (Blender uses AgX). `?tonemap=neutral` switches to PlayCanvas's neutral tone mapping, which is closer to the render. It changes every room, so it is left off until the other rooms are checked with it.

## Tests

| Test | Result |
|---|---|
| `tools/e2e/eagle-eye-landscape.mjs`, 844 × 390 (iPhone 12–15), safe-area insets emulated | 49 of 49 checks pass, no page errors |
| The same at 932 × 430 (Pro Max) | 49 of 49 checks pass, no page errors |
| `server/` `npm test` (rules, rooms, multiplayer suite, lab data) | 57 passing; `tsc` clean |
| `tools/e2e/bots.mjs`, 12 WebSocket phones, 2 full matches | 0 privacy violations in 10,513 private views; no errors |
| Offline review build, served from a sub-folder with no URL parameters | Starts in the lab at the hunt; no errors or missing files |

The landscape playthrough covers:

- the Add to Home Screen sheet, manifest and icons;
- the rotate screen in the lobby and during play;
- subtitles fitting in two lines, and the idle HUD covering under 10% of the screen;
- touch targets of at least 44 px;
- tapping a room in the mansion view, travelling, then the room view on arrival;
- the route and destination markers;
- pinch and the view buttons;
- tap to move, the pace pill and double-tap to run;
- sound direction arrows;
- tapping the table to hide, then first person, peeking and leaving;
- the eye view;
- "Someone came in" without naming the infected;
- the lunge warning, the struggle overlay, breaking free and failing;
- hunter taps (search and move);
- no controls during the opening;
- the View Gallery;
- the Garden Gate pill, escaping and the results screen.

## Performance

These are counted in the game on a phone-sized screen. The browser was a headless one with software rendering, so frame rates from it mean nothing; the counts do.

| View | Draw calls | Triangles |
|---|---|---|
| Room view, Conservation Lab | 107 | 171k |
| Hidden under the table (first person) | 79 | 94k |
| Mansion view (whole house) | 550 | 372k |

The lab itself is comfortable for a phone. The mansion view draws every room's generated furniture separately, and 550 draw calls may cost frame rate on older iPhones. Rebuilding rooms in Blender reduces this, because each baked room is a few large meshes. It still needs a check on a real phone.

## Break-free tuning

The first design (14 taps) was escaped almost every time by a person tapping quickly. The simulation below uses computer survivors and 40 matches for each setting (12 survivors each):

| Setting | Escaped per match | Turned per match | Grabs broken |
|---|---|---|---|
| No break-free (before) | 6.35 | 5.65 | 0% |
| 20 taps, +6 per earlier escape, Elias +4, computer tapping 5–9 per second (chosen) | 7.53 | 4.47 | 25% |
| 18 taps, same | 7.95 | 4.05 | 35% |

The server credits at most 10 taps a second, so a real player needs about 2 seconds of steady tapping out of the 2.7 available.

## Known gaps

- Only the Conservation Lab uses the new art. The other rooms are still the generated versions until the look is approved.
- The lab's paintings are generated placeholders.
- The floor has no glossy sheen in the game. The baked light is matte, so the lamp reflections on the floor in the Blender render are missing; a reflection probe or a cheap specular highlight could add them.
- The first switch to the mansion view can stutter once while the phone compiles shaders.
- The mansion view's draw calls (above).
- iPhone Safari cannot lock landscape or go fullscreen in a web page, so the rotate screen is the fallback there. A Home Screen web app honours the landscape setting in the manifest.
- The earlier portrait browser scenarios (`scenario`, `guest-suite`, `bedrooms`, `gallery`, `arrival`, `cloud-tour`) drive the old interface and do not pass on this branch.
- The guest suite's committed model has untextured furniture (see `docs/GUEST_SUITE_PROOF.md`). The build script is fixed, but the model is left as it is until a rebuild is approved.

## PlayCanvas Editor

A PlayCanvas Editor project would not help this game much. The game is code-first: the server decides everything, and the client builds each scene from shared room data. The Editor's strengths are visual scene layout, asset hosting and collaborative scripting, but the rooms are laid out in Blender and generated from data, and the Editor would add a second source of truth. The Blender → optimised GLB → code pipeline works from a cloud session. The Editor would be worth reconsidering only for a designer who wants to place lights or props by hand without Blender.

## Screenshots

`docs/screenshots/eagle-eye-proof/` holds the old game and the new game side by side for the mansion, room and hiding views (01–06). It also has frames from the playthrough at 844 × 390 (07–14), the lab at 932 × 430 (15), and the game engine at the Blender render cameras (16). The references are in `references/eagle-eye-refs/` (01, 03 and 04 for this room), and the Blender renders are in `docs/renders/`.
