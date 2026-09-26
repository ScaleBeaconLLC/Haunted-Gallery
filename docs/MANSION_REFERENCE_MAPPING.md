# Mansion reference mapping

How each image in `references/mansion-package/rooms/` (the 15 concept views from `Haunted_Gallery_Claude_Complete_Package.zip`) maps to the playable PlayCanvas mansion.

- **Previews** (768 px) are committed in `references/mansion-package/previews/`. The 3 MB originals stay local; they're gitignored and remain in the ZIP.
- The images are **concept references, not game assets**. Nothing from them is pasted into the game as a texture or backdrop. Every room is walkable 3D geometry generated in `client/src/world.js`, using procedural textures from `client/src/textures.js` in the references' palette: walnut, burgundy, checkered marble, blue damask, gilt, moonlight.
- Room ids, doorways and hiding places live in `server/src/game/data.ts`. The server is authoritative for movement, hiding, searching and escape.

## The playable map (11 rooms)

```
                         Master Bedroom   Guest Bedroom   Spare Bedroom        (bedroom wing: new)
                                \               |               /
   Curator's Study ───────── Portrait Corridor (52 m) ───────── Hall of Mirrors
        |      \                                               /      |
 Sculpture Vault ───────── Sealed Exhibition Room ─────── Conservation Lab
        |                   /      |       \                         |
 Grand Portrait Gallery ───┘  [Garden Gate]  └─────────── Archive Library
```

- The seven established rooms keep their ids, sizes, doorways and original hiding places.
- The **bedroom wing** is the approved expansion. It connects only through the Study and the Hall of Mirrors, via the Portrait Corridor, and each bedroom has a single door.
- The **Garden Gate** is the existing exit, in the south wall of the Sealed Exhibition Room. It is open from the start (spec §10). CPU Elias physically guards it for stretches, and it can be passed by luring him, a camera flash or a snare.

## Image → room

| # | Reference | Playable room (id) | What was built from it | Hiding places (pose) |
|---|---|---|---|---|
| 01 | Mansion Overview | Whole map | Bird's-eye cutaway language: no ceilings, warm interiors against cold moonlight, a bedroom wing off a long gallery, a stone service side. Informs the layout, not a room. | — |
| 02 | Grand Foyer | Grand Portrait Gallery (`portrait`) | Checkered marble floor, olive walls with walnut wainscot, gilt portraits, statues on plinths, a candle chandelier. The twin staircases were **not** built: decorative stairs would imply routes that don't exist (spec §9). | Curtain recess (curtain) · Under the draped buffet table (under) |
| 03 | Portrait Corridor | **Portrait Corridor (`corridor`, new)** | 52 m gallery hall lined with portraits between moonlit windows, a runner rug, benches, sconces, extra lights. The portrait-wall plaques (spec §22 text) are inspectable. | Behind the ajar portrait frame (behind) · Behind the alcove curtain (curtain) |
| 04 | Master Bedroom | **Master Bedroom (`master_bedroom`, new)** | Four-poster with canopy and tied drapes, **0.62 m crawl gap** under the bed, fireplace with live firelight, tall hollow wardrobe with doors ajar, windows, chaise, nightstands with lamps, dresser, rug. | Under the four-poster (under) · Inside the tall wardrobe (inside) · Behind the dressing screen (behind) |
| 05 | Guest Bedroom | **Guest Bedroom (`guest_bedroom`, new)** | Blue damask walls, **raised brass bed (0.72 m gap)** with brass foot rail, window seat behind a curtain, wardrobe, nightstand, dresser. | Under the brass bed (under) · Behind the window-seat curtain (curtain) · Inside the wardrobe (inside) |
| 06 | Spare Bedroom | **Spare Bedroom (`spare_bedroom`, new)** | Faded nursery paper, canopied single bed (**0.55 m gap**) with a sheer drape, adult-height three-panel folding screen, old closet, toy shelf, trunk, daybed, armchair. | Under the single bed (under) · Behind the folding screen (behind) · Inside the old closet (inside) |
| 07 | Archive Library | Archive Library (`archive`) | Herringbone floor, book stacks with book-spine faces, wall bookcases, fireplace, leather armchairs, reading-table lamp, window. The two-level gallery is not walkable (single floor). | Under the reading table (under) · Behind the rolling shelf (behind) |
| 08 | Dining Room | Grand Portrait Gallery (birthday) | The birthday setting: cake with lit candles on the draped buffet, burgundy rug. There is no separate dining room. | (buffet table above) |
| 09 | Ballroom | Hall of Mirrors (`mirrors`) | Parquet floor, gilded mirrors, grand piano on a low stage, chandelier; drapes and screens as hiding cover. | Behind the false reflection (behind) · Behind the velvet partition (curtain) |
| 10 | Conservatory | **Not built** | No playable conservatory yet. Candidate for a future expansion with its own doorways and hiding spots (walk-in trellis, potting bench). | — |
| 11 | Curator's Study | Curator's Study (`study`) | Herringbone floor, fireplace, desk (under-desk hide), leather armchairs, portrait wall, curiosity cabinet, bookcases split around the new north door. | Behind the secret bookcase (behind) · Under the curator's desk (under) |
| 12 | Sculpture Vault | Sculpture Vault (`sculpture`) | Stone floor and walls, pale and bronze statues on dark plinths, draped figures, crates, an easel, gothic windows with moonlight. | Behind the plinth (behind) · Behind the shipping screen (behind) |
| 13 | Conservation Lab | Conservation Lab (`conservation`) | Work table with a painting, easels with portraits, plan chest, covered figure, cart, window. | Behind the cabinet bay (behind) · Behind the canvas rack (behind) |
| 14 | Cellar Passage | Garden Gate service passage | Stone-walled service passage behind the Sealed Exhibition Room ending at a wrought-iron Garden Gate with lanterns. The wine cellar itself is not built. | — |
| 15 | Sealed Exhibition | Sealed Exhibition Room (`sealed`) | Draped masterpiece behind brass stanchions, tufted bench, urns on plinths, the old display case, portraits, chandelier. | Inside the crate tunnel (under) · Behind the blackout curtain (curtain) |

**Totals:** 11 playable rooms, 15 passages, 31 doorways, **25 hiding places** (up from 14), 11 inspectable clues.

## How hiding works in the new rooms

- **Under a bed:** the hider walks to the bed's open side, visibly crawls under, and only then becomes "Hidden — stay alert". The first-person camera sits at that bed's real clearance, below the slats, looking out.
  - A hunter who searches that bed stands at its open side, **kneels and looks under**, so their face comes into view.
  - If someone is there, they're pulled out to the open side and caught.
- **Inside a wardrobe or closet:** the hider steps in upright. The first-person view looks out through the ajar doors, and Peek pushes a door open, which exposes the hider.
- **Behind screens, frames and curtains:** as before.
- **Knowledge:** hunters only know a spot if they watched someone get in. Searching the wrong place is a real miss.
- **Checked on the server** (`server/test/engine.test.ts`): the bedrooms are reachable only through the corridor, the open side of every cover is on real floor, found hiders are pulled clear of the furniture, and arrivals stand on open floor rather than on beds.

## Still placeholder (not production art)

| Item | Current state |
|---|---|
| Characters | Primitive rigs (capsules/spheres) with per-guest clothing, pants, shoes and hair colours; procedural walk, crawl, kneel and bend. **No rigged models or animation clips.** |
| Room geometry | Real walkable 3D built from boxes, cylinders and spheres. **No modelled furniture meshes**: beds, wardrobes, fireplaces and statues are primitive assemblies. |
| Textures | Procedurally painted at load (low resolution, no normal or roughness maps, no lightmaps). |
| Portraits | Generated placeholder sitters, not painted portraits. The plaques use the specification's text. |
| Lighting | Real-time omni lights plus one directional "moonlight". No baked lightmaps yet. |
| Staircases, balconies, conservatory, dining room, ballroom stage upper levels, wine cellar | Not built. |
| Sound | Same as before: 52 AI voice auditions plus synthesized placeholder effects. No new room sounds. |
