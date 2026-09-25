# What exists and what still has to be built

Snapshot: September 25, 2026. Use this as a factual inventory, not a completion certificate.

## Existing materials in this ZIP

- The current product rules, seven-room story, character roster, approximate room/hiding layout, private SOS and rescue scoring are in `CLAUDE.md`, `project6-game-bible.json`, `scene-layout.json`, and `RESCUE_AND_SOS.md`. For conflicts, follow `CLAUDE.md` and `RESCUE_AND_SOS.md` first; the older Python code was exploratory.
- The 52 Inworld AI voice takes for 13 characters are auditions in MP3 and OGG, with the manifest and direction. The delivery of screams and discovery lines has **not** passed a realistic acting review on actual phones. Zombie detection sound, bite Foley, ambience and spatial mix remain to be sourced or produced.
- A seven-room Unreal blockout with two hiding covers per room and cast-related prototype work existed on a remote Windows machine. A native PlayCanvas scene, imported PlayCanvas models, animations and verified mobile experience do not yet exist in this package. An Unreal `.umap` cannot be opened as a PlayCanvas scene.
- `legacy-reference/rules/` has Python story, hunt and rescue prototypes, including an exploratory rule that made the camera mandatory to exit. The approved current design allows escape without the camera. Port *intent and vetted rules*, not that conflicting condition.
- `legacy-reference/phone-prototype/` and `legacy-reference/unreal-prototype/` are selected source excerpts of an older five-room phone controller and Unreal bridge. They cannot be plugged into a PlayCanvas + Colyseus game as-is. The old ChatGPT Site is not the requested product. These excerpts are not a standalone working application.

## Open build work

1. Connect Claude Code to a PlayCanvas Editor session; confirm the exact target project before creating or editing anything. Build the 3D mobile scene from the story and approximate layout, including real navigation/collision, cast representations and performance checks.
2. Implement a separate Colyseus Node.js server for up to 12 simultaneous survivor seats, private state, room validation, infection, rescue evidence, camera, reconnect and host controls. This ZIP contains no deployed Colyseus server.
3. Wire the PlayCanvas client to the server; test multiple real phones, QR entry, security/privacy, audio, victory and reset. Publish only after those flows are verified. This ZIP contains no published PlayCanvas game.
4. Audition and replace any AI lines whose diction, timing or scream intensity sounds artificial. Do not treat the existing files as final approved performances.

## Access and launch

Claude Code can edit PlayCanvas through its official Editor MCP only after the PlayCanvas project is opened and its MCP panel is connected locally. Claude Code can create and test Colyseus code via its terminal and deploy through an authorized Colyseus Cloud account. Cloudflare is optional if PlayCanvas hosts the client and Colyseus Cloud hosts the server. The ZIP does not confer account credentials, subscriptions, billing approval or access to the remote Unreal workstation. No passwords or tokens are included.

The previously tracked Project 6 was **0 of 8 steps verified as a finished game**. Completing account connections and beginning the playable blockout today is plausible; finishing and validating a polished 12-phone production game in one day is not something this package guarantees.
