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
| 02 | Grand Foyer | Grand Portrait Gallery (`portrait`) | Checkered marble floor, olive walls with walnut wainscot, gilt portraits, statues on plinths, a candle chandelier. **Twin staircases** flank the front doors and climb to a balustraded landing (added in `visual-upgrade`). They are decorative only: velvet ropes close the foot of each flight and a plaque says *Upper gallery closed*, so no route is implied (spec §9). The front doors are seen from outside in the arrival shot. | Curtain recess (curtain) · Under the draped buffet table (under) |
| 03 | Portrait Corridor | **Portrait Corridor (`corridor`, new)** | 52 m gallery hall lined with portraits between moonlit windows, a runner rug, benches, sconces, extra lights. The portrait-wall plaques (spec §22 text) are inspectable. **View Gallery** (spec §22) has three curated sections on the north wall with nine works; a player walks up to a section and looks at the actual wall. | Behind the ajar portrait frame (behind) · Behind the alcove curtain (curtain) |
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
| 14 | Cellar Passage | Garden Gate service passage + courtyard | Stone-walled service passage from the Sealed Exhibition Room to a wrought-iron Garden Gate with lanterns. Beyond the bars lies a walled **garden courtyard** (hedges, fountain, lanterns). A "Garden Gate · Courtyard →" plaque by the door gives the spec §10 wayfinding. The wine cellar itself is not built. | — |
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
*Updated for the `visual-upgrade` branch; full details in `docs/ASSET_MANIFEST.md`.*

| Item | Current state |
|---|---|
| Characters | **Real rigged models** (CC0 Quaternius parts) in each guest's colours, with 22 animation clips. Faces, complexions and hairstyles are **not approved identity art**: everyone shares one neutral skin tone. |
| Animation | Real clips for walk, run, idle, crouch, kneel, grab, recoil and others. **Missing:** a true crawl, bite and transformation clips; these are approximated. |
| Decorative furniture | **Real models** (CC0 Quaternius furniture): bookcases, nightstands, dressers, sofas, armchairs, lamps, plants. |
| Hiding covers (beds, wardrobes, screens, tables) | **Primitive assemblies, on purpose.** Their clearances are tuned to the hiding rules; modelled replacements with matching clearances are still missing. |
| Room shells, statues, fireplaces | Primitive geometry with procedural textures (low resolution, no normal or roughness maps). |
| Portraits and View Gallery works | Painted in code: placeholder art, not commissioned paintings. |
| Lighting | Room lights plus 40+ small practical lights at lamps and sconces, contact shadows under characters, lamps failing after the attack. **No baked lightmaps or real-time shadows.** |
| Exterior | Stone façade, portico with columns and doors, forecourt, lamp posts and moon: primitives plus CC0 models. **The limousine is a stretched CC0 Kenney sedan (placeholder).** |
| Conservatory, dining room, ballroom upper levels, wine cellar, walkable upper floor | Not built. |
| Sound | Same as before: 52 AI voice auditions plus synthesized placeholder effects. No new room sounds. |
