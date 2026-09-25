# Haunted Gallery: PlayCanvas + Colyseus handoff

This archive is a **build brief and AI voice source pack**, not a playable game or an Unreal-to-PlayCanvas conversion. Unzip it into a local folder and run Claude Code with Opus 5.5 in that folder. Read `CLAUDE.md` first.

See `HANDOFF_STATUS.md` for what is verified, what remains unfinished, and the boundary between the current design and `legacy-reference/` source excerpts.

## What Jermell needs to set up once

1. On the same Windows computer, [install Claude Code](https://code.claude.com/docs/en/setup) and Node.js **22.18 or newer** and sign in to Claude. Shadow already has Node.js 24.21.0, but the Claude CLI was not found during the September 25 check. Open a new PlayCanvas project in Chrome on that computer. The phone app alone cannot run the local editor connection.
2. In Claude Code, run `claude mcp add playcanvas -- cmd /c npx -y @playcanvas/editor-mcp-server` on Windows. The PlayCanvas docs show the generic command with `npx`; `cmd /c` is their Windows form for JSON MCP clients. If this CLI command fails, ask Claude Code to configure the documented Windows MCP command before proceeding.
3. In the PlayCanvas Editor, click **MCP** at the bottom, use port **52000**, press **Connect**, and allow the browser's **Apps on device** permission. Leave that Editor tab and Claude Code session open while building.
4. Create/sign in to a Colyseus Cloud account when ready for the multiplayer deployment. Its `npx @colyseus/cloud deploy` step opens a browser authorization. Never put tokens or a `.colyseus-cloud.json` credential file in this archive or a chat message.
5. From this extracted folder, start `claude --model claude-opus-5-5`. Tell it: **Read `CLAUDE.md` and implement the Haunted Gallery build in the PlayCanvas project currently connected over MCP. Begin with a read-only project check.**

The PlayCanvas MCP is the direct editor connection. Claude in Chrome can be added for other browser-only steps, but it is not required to manipulate the connected PlayCanvas scene. A Claude subscription or API allowance is separate from ChatGPT credits.

## What Opus receives

- `CLAUDE.md`: build instructions, scope, quality gates, and required direct connections.
- `project6-game-bible.json`: existing story and room graph from the Unreal prototype; its Unreal-specific words must be adapted for PlayCanvas.
- `RESCUE_AND_SOS.md`: private messaging and points rules.
- `AI_VOICE_DIRECTION.md`: character-specific acting direction. Current takes are auditions; dramatic quality is not approved.
- `scene-layout.json`: approximate blockout coordinates and two hiding places per room. Rebuild native PlayCanvas entities and collision; a `.umap` is not a PlayCanvas asset.
- `audio/{MP3,OGG}/...`: 52 existing AI voice auditions in browser-oriented formats. Use a separate sound for the zombie's discovery cue; it is not in this pack.
- `audio/manifest.json`: clip IDs, character names, event types and paths.
- `legacy-reference/`: selected prior Python game logic and phone-controller source, labeled as earlier prototypes; use as reference when writing native PlayCanvas and Colyseus code.

## Important product boundary

The old ChatGPT Site was an engineering phone controller for a five-room Unreal prototype. It is **not** the desired PlayCanvas game and should not be presented to guests. The PlayCanvas build must render each player's 3D world on their own phone, at a QR-accessible published URL. Colyseus owns the authoritative 12-person session and private events. Cloudflare is optional for future custom hosting; PlayCanvas can host the browser client and Colyseus Cloud can host the Node server.

The previous status was **0/8 Project 6 tracker steps verified** as a finished game. A seven-room Unreal blockout existed, but the Unreal editor was stuck before the audio import or live hunt verification. Reusing the story and AI takes does not make the PlayCanvas game finished.
