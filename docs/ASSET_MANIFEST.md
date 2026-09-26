# Asset manifest

Per the specification (§32): what each asset is, where it came from, whether we may use it, where it lives, and whether it is **final**, **usable but needs refinement**, or a **placeholder**.

Source files are kept separately from the runtime exports:

- **Sources** are downloaded into `assets-src/`, which is gitignored and never committed. Re-fetch them with `node tools/assets/fetch-sources.mjs`.
- **Runtime exports** are committed under `client/public/`. Build them with `node tools/assets/build-characters.mjs`.

## Characters

| Asset | Status | Source / licence | Runtime | Used by |
|---|---|---|---|---|
| 13 guests + Elias Voss | **Usable, needs refinement.** These are real rigged, skinned models, replacing the capsule stand-ins. Each guest wears their own mix of head / body / legs / feet, recoloured with the established cast colours (top, trousers or skirt, shoes, hair). | Quaternius *Ultimate Modular Women* + *Ultimate Modular Men*, **CC0 1.0** | `client/public/models/characters/parts/*.glb` (84 parts, quantized, ~370 KB per guest); outfit choices in `client/src/cast-looks.js` | `client/src/actors.js`, `client/src/characters.js` |
| Faces, complexions, hairstyles | **Placeholder, not approved identity art.** The repo has no approved face, complexion or hairstyle references. Every guest uses the same neutral skin tone rather than guessing from names. Body type follows each guest's established voice. Hairstyles come from the pack's heads, and Owen's head has no hair (moustache only). | Quaternius heads, CC0 | as above | as above |
| Elias Voss | **Usable, needs refinement.** Uses the pack's older bearded head with the crown hidden, a near-black suit, a wine tie, and a slightly taller build. | Quaternius, CC0 | as above | as above |
| Primitive stand-in | **Fallback only.** Shown for the moment before a model downloads, or if it fails to load. | Built in code | `client/src/actors.js` | loading |

## Animation

| Clip(s) | Status | Source / licence | Notes |
|---|---|---|---|
| idle, idle_alert, walk, run, interact, hit, hit2, collapse, wave, lunge | **Usable** | Quaternius modular packs (native to the rig), CC0 | Walk and run playback speed matches ground speed (no foot sliding) |
| crouch_idle, crouch_walk, kneel_look, pickup, walk_formal, talk, sprint, recoil, grab, idle_breathe, dance, inspect | **Usable, needs refinement** | Quaternius *Universal Animation Library* (free edition), **CC0 1.0**, **retargeted** to the modular rig by `tools/assets/build-characters.mjs` | Converted offline, bone by bone, from the library's T-pose to the rig's bind pose. The feet are placed at the ends of the shins. kneel_look is the held part of *Fixing_Kneeling*. |
| Looking under a bed, lying flat to crawl under cover, infected hunch | **Procedural adjustment on the clips** | Code (`client/src/actors.js`) | The spec allows "limited procedural adjustment" |
| Crawl, hidden idle, bite, transformation, stun recovery, escape | **Missing** (approximated) | — | Approximations: crouch_walk plus lying flat; recoil / grab; freeze = clip paused. A real crawl or bite needs new clips (for example from Mixamo, which needs the owner's Adobe sign-in, or a paid pack). |

## Environment, audio, portraits

These are unchanged by the character work; see `docs/MANSION_REFERENCE_MAPPING.md` for the rooms.

| Asset | Status |
|---|---|
| Room geometry and furniture | **Placeholder art.** Walkable 3D built from primitive assemblies (boxes, cylinders) with procedural canvas textures. |
| Lighting | **Placeholder.** Real-time lights; no baked lightmaps. |
| Portraits | **Placeholder.** Generated in code. |
| Voices | 52 AI voice auditions, **not approved** |
| Sound effects | **Placeholder.** Synthesized in `client/src/audio.js`. |
