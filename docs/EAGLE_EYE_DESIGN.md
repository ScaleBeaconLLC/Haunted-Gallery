# Eagle-eye gameplay and landscape presentation: design (proof round)

Branch `claude/eagle-eye-room-proof` (from `visual-upgrade`). This is the single reference for the proof: rules, protocol, cameras, interface and the first rebuilt room. The Conservation Lab is the proof room; the other older rooms are unchanged until the look is approved.

## What stays

The 14 characters, the opening (limousine, party, dialogue, first bite, curator announcement), the single 15-minute countdown, the multiplayer foundation, private per-phone views, the secret infection story, the hiding-place data model, the camera flash stun, snares and clues, SOS, and the Garden Gate ending.

## Rules (authoritative server)

| Rule | Detail |
|---|---|
| Travel | Tap a reachable room (your room, its neighbours, or both ends of the passage you are in). The character walks or runs there through real doorways. Tap a point inside that room and they go to that point; otherwise they stop about 1.5 m inside the entry door. |
| Move inside a room | Tap the floor: intent `move`. The server plans a path around furniture (0.25 m grid, A*, corners smoothed), so nobody walks through tables. Taps inside the 350 ms move cooldown are queued and the last one wins, not rejected. |
| Pace | Still (silent), Sneak (1.7 m/s, heard within 6 m), Run (3.6 m/s, heard within 13 m and through the next doorway). Double-tap a destination to run there once. |
| Hide | Tap a hiding place in your room or the next one. The character walks to its open side, settles in (0.7 s), and the phone switches to first person. Hold Peek to lean out (you become visible within 7 m). |
| Seeing people | Everyone in the same **room** is visible regardless of distance (the old 18 m cap hid far corners of big rooms). Passages keep the 18 m cap; the view through a doorway is unchanged. People in cover stay invisible unless they peek. |
| Zombie enters your room | Anyone entering your room appears on your screen. They are drawn and labelled as a zombie **only** when the server marks them revealed (Elias, the birthday guest, a turned guest within 3.2 m, grabbing, searching your spot, or stunned). Everyone else is "Someone came in". This keeps infection secret. |
| Lunge warning | When a hunter starts the 0.7 s grab windup on you, your phone gets `lunging` on that actor: red edge flash and a haptic buzz. |
| Break free | The grab starts a **2.7 s struggle** inside the existing 3 s bite delay (the flash-rescue timing is unchanged). Tap as fast as you can: 14 taps frees you. Elias needs 4 more, and each time you have already broken free adds 5. The server counts taps (at most 12 per second) and decides. Success: the hunter staggers back and cannot grab for 2 s, and you cannot be grabbed for 2.5 s. Failure: the bite, then you turn (secretly), as before. A friend's flash still frees you at any point. CPU survivors tap at 3.5 to 6.5 taps/s. |
| Garden Gate | Unchanged: reach the gate in the Sealed Exhibition Room before the 15:00 hunt ends. Messages say "Garden Gate" everywhere. |

### Protocol additions

- Client to server:
  - `intent {kind:'move', p:[x,z], pace?}` for survivors and hunters.
  - `intent {kind:'room', room, p?:[x,z], pace?}`: `p` is an optional arrival point inside the room.
  - `struggle {grabId, n}`: `n` is the cumulative local tap count. Send it on the first tap, then at most every 150 ms. It has its own rate bucket.
- Server to client:
  - `view.me.struggle = {grabId, by, until, need, got} | null`: `until` is a server time and is converted like the other times.
  - `view.actors[i].lunging` is set only for the viewer being grabbed, or for perceivers who see a revealed hunter.
  - fx `struggle` goes to the victim.
  - fx `broke_free` goes to witnesses.
- Hunters use the same taps:
  - room: travel;
  - floor: move;
  - hiding place: search;
  - doorway: block;
  - a visible person: chase.

## Cameras

| Mode | When | Framing |
|---|---|---|
| `mansion` | Travelling between rooms, in passages, or opened with the map button | The whole mansion from high above, looking along +x, so the long axis runs left to right across a landscape phone (the entrance side on the left, the bedroom wing on the right). Pitch about 62°. Reachable rooms get a gold rim and a name; the others are dimmed. |
| `room` | Default once you are inside a room | Eased zoom (about 0.9 s) to the room's rect with the same heading, pitch about 66°. |
| `fp` | Hidden (automatic), during a struggle (facing the attacker), or opened with the eye button | First person at the hiding pose or the character's eyes. Drag to look. |
| opening / gallery / escaped | Unchanged | |

Fog, near clip and far clip are set per mode: the mansion view is about 90 m away and would otherwise be fogged, clipped, and flicker on rugs. The field of view is horizontal in landscape so the scene isn't fish-eyed.

## Landscape interface (iPhone 844×390, 932×430; every anchor offset by `env(safe-area-inset-*)`)

- **Top left:** room name (one line) and state word (Still, Sneaking, Running, Hidden, Caught).
- **Top right:** timer `14:51`, then the view buttons (mansion, room, first person) and the ⋯ menu (SOS, team, clues, hand over the camera).
- **Bottom left:** Still / Sneak / Run pill.
- **Bottom right:**
  - a round Flash button with a recharge ring, shown only while you hold the camera;
  - up to three contextual pills: Hide, hold Peek, Leave, Snare, Inspect, Garden Gate, Search, Block.
- **Bottom centre:** subtitles, two lines at most.
- **Screen edges:** direction chevrons for sounds.
- **Removed:**
  - the room-card drawer;
  - the Walk/Run/Wait bars;
  - the full-width Garden Gate button;
  - the thumb stick (keyboard WASD stays for desktop).
- **Turn your phone sideways:** an animated full-screen prompt in portrait from the lobby onwards. It includes the Control Center orientation-lock hint and mirrors the latest subtitle.
- **Launch:** "Enter the mansion" (a user gesture) asks for fullscreen and a landscape lock where the device supports them (Android). iPhone Safari supports neither, so the rotate prompt is its fallback.
- **Add to Home Screen:**
  - `manifest.webmanifest` (standalone, landscape, icons) plus Apple meta tags;
  - an iOS instruction sheet on the join screen, shown before joining because Home Screen apps don't share storage with Safari.

## The proof room: Conservation Lab (x 16–32, z 22–38)

Blender build: `tools/blender/build_conservation_lab.py` (shared helpers in `tools/blender/hg_room.py`).

- Real furniture: two restoration tables, a canvas drying rack under a drop cloth, a solvent cabinet, two plan chests, easels, a covered statue, a bust, pigment shelves and a cart.
- Lancet windows and stone door surrounds.
- CC0 wood textures plus generated stone, linen and paintings.
- **Baked lighting:** Cycles irradiance on a second UV set, shipped as `conservation_lab_lightmap.jpg`. The game multiplies it by `scale` from `conservation_lab.json`. Lab surfaces ignore the runtime lights; people are still lit by the practical lights at the lamps and sconces.

Hiding places (ids kept where the concept survives):

| id | Where | Pose |
|---|---|---|
| `under_restoration_table` (new) | Under the main table (24.6, 32.0); drop cloth on the far side | under, looking south |
| `canvas_rack` | Behind the draped canvas rack, in the bay against the west wall (17.1, 35.0) | behind |
| `cabinet_bay` | Behind the solvent cabinet, closed in by the plan chest and a folding screen (31.0, 24.4) | behind |

The snare clue `restoration_notes` stays at (17.4, 34.3), on a small desk inside the rack bay.
