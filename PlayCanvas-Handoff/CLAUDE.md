# Build Haunted Gallery with Claude Code Opus 5.5

You are building a **real 3D mobile browser game** for Jermell's in-person event, using the currently connected PlayCanvas Editor MCP server and a separately coded Colyseus Node.js multiplayer server. Use the official PlayCanvas editor and current Colyseus APIs. The published PlayCanvas URL is the QR destination; every guest plays on their own phone. A laptop may be used by the host but guests do not share its screen.

## First checks

1. Read this file, `project6-game-bible.json`, `RESCUE_AND_SOS.md`, `AI_VOICE_DIRECTION.md`, `scene-layout.json`, and `audio/manifest.json`.
2. Inspect the connected PlayCanvas project's name, active scene, selected entity and version-control state **read-only**. If the editor MCP is disconnected or points to another project, stop mutations and explain exactly which connection is missing.
3. Create a project checkpoint before scene edits. Develop the Colyseus server locally in its own `server/` folder or a connected Git repository. Do not paste credentials into files, chat, or client JavaScript.

## The experience

- At the venue, guests scan one QR code, open the **3D game on their own phones**, enter a private lobby, choose distinct characters from the 13-person cast, and join up to 12 active survivors. The unselected thirteenth guest is already inside as the birthday victim. Elias Voss is the Curator. Offer CPU seats only when fewer than 12 humans join.
- Opening: twelve active guests arrive by limo; the birthday guest is inside; a deliberate photo freezes Elias; roughly five seconds later he bites the birthday guest; the one camera falls with batteries intact; security locks down. The painting is background story, not a supernatural trigger.
- Seven connected mansion-museum rooms, two physically covered hiding locations per room, real collision-backed doors, no through-wall travel or teleporting. Build a performant mobile blockout before final art.
- Play loop: private choice to stay, move to an adjacent room, or hide; visible travel on each player's phone; infected players and Elias hunt, search specific hiding locations, discover, grab, bite, and turn survivors. Camera photo freezes visible infected hunters for five seconds and recharges seven seconds later. The single camera drops where its holder turns and can be recovered.
- The personal goal is to escape alive. The team goal is to save as many guests as possible. The camera is an important rescue tool; **it is not a mandatory key to the exit** under `RESCUE_AND_SOS.md`. A previous untested Python prototype had a conflicting camera-required escape gate. Use the documented rule here unless Jermell explicitly changes it.
- Private named SOS on phones: one living sender selects one living recipient and a preset, with a **server-verified room snapshot** and timestamp. Recipient may accept or ignore; messages, locations and replies remain invisible to hunters and other guests. Accepting does not move a character or award points. A zombie sees living identities but not their rooms.
- Award +100 personal/+100 team for an actual escape; +150 to one verified rescuer/+150 team only after the assisted guest truly escapes; +50 personal to photographer for an actual camera-assisted rescue. Send/accept SOS earns zero. Show escaped headcount and team score in results and the private player's earned points. A selfish escape is allowed.
- Distinct AI voices: 52 **audition** clips cover 13 guests in quiet, discovery, grabbed and bite phases. Trigger discovery only after sightline; interrupt lower-priority speech on grab/bite. Keep physical zombie cue, attack Foley, distance attenuation, occlusion, and loudness control separate. Do not tell Jermell these takes sound realistic until they are auditioned on phones in the scene. No human actors.

## Architecture and authority

- PlayCanvas owns mobile 3D rendering, animation, UI and spatial audio. Colyseus server owns the lobby, 12 distinct seats, host authorization, timed choices, legal room graph, actor position validation, camera cooldown, infection, rescue evidence, score, hidden information and endings.
- Send player intent to the server; server validates before broadcasting minimal public state. Send private SOS only to sender and intended recipient. Never ship the full world state or SOS map to every phone, and never accept a client-asserted room, score, bite or rescue as authoritative.
- Host controls start/pause/reset through a protected interface. Use opaque session tokens and a QR join code; do not expose a host secret in the public build. Handle reconnect, stale/disconnected seats, duplicate actions and device sleep. Test with 12 browsers/phones, including different network conditions.
- Serve client over HTTPS and connect by WSS to Colyseus. Use PlayCanvas hosting for the client and Colyseus Cloud for the Node backend initially; Cloudflare is optional later. Do not assume generic Cloudflare static hosting can run an unchanged long-lived Colyseus server.

## Build order and evidence

1. PlayCanvas 3D seven-room blockout that loads on an iPhone and Android with touch controls, camera, doors and 14 hiding covers. Check memory and frame pacing on real phones.
2. Colyseus lobby, 12-seat synchronized match, server-authoritative travel and private camera/SOS state. Demonstrate two real phones in the same room before extending to twelve.
3. Full hunt, infection, rescue scoring and opening/ending events; integrate browser audio in MP3 with OGG fallback; audit every character's diction and scream delivery.
4. Publish a test URL/QR, run a 12-device rehearsal, record pass/fail for privacy, cross-phone synchronization, reconnect and audio, and fix failures. Report honestly what is verified, what is staged and what still needs accounts or assets.

Use the PlayCanvas MCP for scene, asset and viewport operations and inspect the running app through it. Build the Colyseus server with Claude Code's terminal and documented deployment CLI. Browser automation can help with a sign-in or deploy flow only after Jermell signs in; do not assume that a model name grants account access. Keep working through implementable steps without claiming the game is finished on the strength of a mockup.
