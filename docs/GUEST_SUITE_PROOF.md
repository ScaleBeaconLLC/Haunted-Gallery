# Guest suite: the first Blender-built playable room

**Scope:** one room built to final-quality intent in Blender and made playable in the real multiplayer game, so the look and the hiding experience can be judged before the rest of the mansion is rebuilt the same way.

**Art direction:** the ten night-mansion references in `references/night-mansion-refs/`. The main ones for this room:

- `06` blue guest bedroom: iron bed, window seat, wardrobe, doors;
- `07` master bedroom: wood, rugs, lamps;
- `09` whole-mansion cutaway: the bird's-eye language.

## What is genuinely built in 3D

| Item | Where | State |
|---|---|---|
| **Guest Bedroom**, 9 × 9 m, and a new **Guest Bathroom** | `tools/blender/build_guest_suite.py` builds everything in Blender 5.2 (headless). The editable file is `art/blender/guest_suite.blend`. | Built |
| Iron bed with a **real 0.58 m crawl space** (slats and a dark base underneath) | Blender geometry | Built |
| Hollow **wardrobe**: doors ajar, coats pushed aside, room to stand in | Blender geometry | Built |
| **Window seat** with a velvet curtain drawn across | Blender geometry | Built |
| Bathroom: **clawfoot tub** behind a shower curtain; **linen cupboard** you can stand in | Blender geometry | Built |
| Hallway door and bathroom door (casings, lintels) lined up with the server's doorways | Blender + server map | Built |
| Real textures: worn oak floor, dark wood panelling, jacquard wallpaper, velvet, tiles | CC0 Poly Haven textures | Built |
| Furniture: nightstands, Gothic commode, ornate mirror, armchair, rocking chair, grandfather clock, plant | CC0 Poly Haven models | Built |
| Rug, paintings, moonlit windows | Painted in code | Placeholder art |
| Game model | `client/public/models/rooms/guest_suite.glb`: one merged mesh (38 materials), 1024/512/256 textures, compressed. About 49k triangles, 3.4 MB. | Built |
| Lamp and sconce light positions | `LIGHT_*` markers in the model; the game lights them | Built |

**Blender renders** (in `docs/renders/`):

- `guest_suite_birdseye.png`
- `guest_suite_room_level.png`
- `guest_suite_inside_wardrobe.png`
- `guest_suite_under_bed.png`

## How it plays

### Rules and server

- **Hiding places**:
  - under the iron bed;
  - inside the wardrobe;
  - behind the window-seat curtain;
  - in the tub behind the shower curtain;
  - inside the linen cupboard.
- The bathroom opens only off the bedroom, so it's a dead end.
- **Furniture blocks movement**: each piece has a footprint on the server, and people can't walk through it.

### Controls (phone)

- **Thumb stick**, bottom left:
  - a gentle push **walks**, which is quiet;
  - a full push **runs**, which is faster but heard through the next doorway (13 m versus 6 m for walking).
  - The knob turns gold and reads *Running · loud*.
  - The first time you move, one caption explains this.
- **Keyboard** on a laptop: WASD or the arrow keys walk; hold Shift to run.
- **Contextual actions**, bottom right: small buttons that appear only when they apply.
  - Survivors: **Hide** beside a hiding place's open side; **Peek** while hidden (hold); **Inspect**, **View Gallery** and **Photo** when available.
  - Hunters: **Search** beside a hiding place; **Block** beside a doorway.
- **Rooms** button: opens a drawer of room cards.
  - Each card has a framed preview and a small floor plan.
  - The plan marks the door you will enter by in gold, and the hiding places as dots.
  - Tapping a card auto-walks you there.

### Cameras

- **Survivor in the open:** a close follow camera that shows the immediate surroundings. It holds still while you steer with the stick, and you can drag to turn it.
- **Hidden:** a first-person view from inside the cover, with limited looking around; hold Peek to lean out.
- **Someone walks into your room:**
  - the camera pulls back smoothly to a **bird's-eye view of that room only**;
  - everything outside the room is masked;
  - a gold ring shows where you are;
  - you can stay still, or push the stick to leave cover and slip out.
- **Hunters:** a grounded camera just behind the shoulder, kept inside the room and clear of doorways. Hunters never get the bird's-eye view.

### Fairness notes

- **The pullback reveals nothing new.** The server already sends hidden players everyone in their own room (sight inside a room isn't blocked). Nobody outside the room is ever sent.
- **It triggers on anyone**, friend or turned. So it never reveals who is infected.
- **The camera stun already existed** (Take Photo: freeze 5 s, recharge 7 s). Nothing new was added, and the balance is unchanged.

## Tests

- **Server:** 33 engine and room tests pass, including new tests for:
  - walking versus running speed;
  - walls, furniture and doorways;
  - running heard from the next room while walking isn't;
  - Hide offered only beside a spot;
  - the stick leaves cover first;
  - the bathroom reached only through the bedroom;
  - escaping by walking through the Garden Gate.
- **Browser**, `tools/e2e/guest-suite.mjs`, using the real on-screen stick on phone-sized screens (390 × 844) and a desktop:
  1. walk in, then run;
  2. Hide appears only beside the wardrobe;
  3. hide, getting the first-person view;
  4. a secretly infected seeker walks in, and the hider's view pulls back to the room only;
  5. the seeker kneels at the bed;
  6. the hider slips out and gets away uncaught;
  7. the seeker finds the player under the bed.
- **Not tested:** real iPhone and Android devices (frame rate, heat, touch feel). Everything ran in headless Edge with software rendering, at about 10 frames a second.

## Still to do (the rest of the brief)

- Rebuild the other rooms the same way (Blender model, footprints, lights), keeping the doors and the back exit lined up across the mansion.
- Tune the in-game lighting to match the Blender renders. The wallpaper reads browner under the game's warm lights.
- Replace the rug, paintings and window art with authored art; add baked lighting.
- Test on real phones.
