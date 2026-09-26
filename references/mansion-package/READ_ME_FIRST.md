# Haunted Gallery — mansion visual storyboard

15 individual AI-generated concept views, September 2026. Each PNG is a separate room reference, not a playable 3D asset or an exact architectural blueprint.

## Visual direction

An ornate curator mansion at night: carved walnut, stone Gothic architecture, burgundy textiles, painted portraits, warm amber lamps and cold moonlight. Images use an oblique bird’s-eye cutaway so doors, furniture and hiding opportunities remain legible. Use them to model real 3D rooms with walkable human-scale geometry. Some image details may not have correct physical clearance; measure and correct those during modeling.

## Views and hiding targets

- `01_Mansion_Overview.png` — Full mansion cutaway; entrance, upper bedrooms, corridors, library and art wing; architectural mood and broad connectivity.
- `02_Grand_Foyer.png` — Twin stairs and balcony; hide behind stairwell or in curtained niche.
- `03_Portrait_Corridor.png` — Fictional victims in portrait wall; optional View Gallery interaction; ajar frame recess and curtained alcove.
- `04_Master_Bedroom.png` — Four-poster bed, fireplace and wardrobe; design crawl space under bed and an adult-size wardrobe hiding volume.
- `05_Guest_Bedroom.png` — Blue guest room, raised bed, window seat and wardrobe; under-bed and window recess hiding.
- `06_Spare_Bedroom.png` — Converted nursery with single bed, daybed, adult-height folding screen and closet.
- `07_Archive_Library.png` — Two-level book collection; sliding bookcase recess and curtained window bay.
- `08_Dining_Room.png` — Birthday dinner table; curtained window niche and full-height sideboard pantry.
- `09_Ballroom.png` — Grand piano, dance floor and balcony; behind stage drape or folding screen.
- `10_Conservatory.png` — Moonlit glasshouse; walk-in planted trellis and clearance beneath potting bench.
- `11_Curator_Study.png` — Private study; sliding portrait recess and large document cupboard.
- `12_Sculpture_Vault.png` — Stone art vault; rear of crated sculpture and storage alcove.
- `13_Conservation_Lab.png` — Portrait restoration; canvas rack and cloth-covered supply niche.
- `14_Cellar_Passage.png` — Servants stair and wine cellar; rack alcove and storage cupboard.
- `15_Sealed_Exhibition.png` — Draped masterpiece and victim portraits; tall exhibition drape and recessed display case.

## Continuity for Claude

- Preserve the existing Haunted Gallery repository, current Colyseus Cloud multiplayer rules and PlayCanvas browser build. Do not replace the code with static renders.
- These 15 images are visual options and architectural references. They do not require 15 playable rooms. Keep the currently implemented room graph, identifiers, doors and network events unless the owner separately approves a map expansion.
- Core fiction: mysterious invitations draw guests to a private birthday event at the Curator’s mansion. The intercom announces the hunt and starts one overall 15-minute countdown. No new restrictive per-turn movement timers.
- The portrait hallway supports an optional “View Gallery” interaction revealing many fictional people Elias trapped across the years. Viewing it should not pause or reset the countdown.
- For each actual playable room, implement two or more reachable adult-sized hiding volumes with concealment rules, enter/exit animations, collision checks, mobile-readable camera cuts and safe pathing for the hunter.
- Bed hiding must have a visible gap and enough real 3D clearance for the avatar. Door hinges, wardrobes, curtains and movable props should not clip avatars or block the only path out.
- Use efficient mobile browser assets: shared materials and modular meshes, compressed textures, baked/static lighting where appropriate, restrained dynamic lights, LODs and culling. Test a phone-sized multiplayer session after implementation.
- Make images architectural inspiration rather than textures pasted onto planes. Preserve all existing character identities, voices, story, host controls and progress.

## Existing 14-character roster

Thirteen guest identities plus Elias Voss. Twelve active players can use the existing guest selection rules; avoid silently changing role assignment.

| Character | Age | Role |
| --- | ---: | --- |
| Julian Mercer | 34 | Architectural photographer |
| Anika Rao | 27 | Conservation scientist |
| Marcus Bell | 44 | Restaurant owner |
| Mei Chen | 38 | Documentary editor |
| Dev Patel | 41 | Sound engineer |
| Amara Okafor | 25 | Fashion stylist |
| Alex Park | 30 | Lighting designer |
| Andre Calder | 19 | Apprentice mechanic |
| Rafael Duarte | 31 | Furniture designer |
| Simone Whitaker | 53 | Radio host |
| Owen Price | 22 | Culinary student |
| Tessa Monroe | 35 | Theater stage manager |
| Nia Calder | 29 | Event organizer |
| Elias Voss | 62 | The Curator |

## Prompt set used for these images

Built-in image generation produced fifteen distinct prompts: one for each scene listed under “Views and hiding targets.” Shared specification: standalone premium realistic 3D game environment concept, physically based materials, one consistent Gothic mansion, nighttime amber practicals against cool moonlight, oblique 55-degree bird’s-eye cutaway, visible floor/doors/walkways and adult-sized hide spots, no characters, text, overlays or UI.
