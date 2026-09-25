# Haunted Gallery: progress log

_Last updated: 2026-09-25_

This file separates what has been **verified**, what is **built but not yet verified on real devices**, and what is **missing**. The handoff tracker stood at 0 of 8 steps verified as a finished game. The build is a playable multiplayer blockout, not a finished production game.

## Status by build-order step (from `PlayCanvas-Handoff/CLAUDE.md`)

| # | Step | Status |
|---|------|--------|
| 1 | PlayCanvas 3D seven-room blockout, touch controls, camera, doors, 14 hiding covers | **Built.** Renders in phone-sized headless browsers. **Not yet checked on a real iPhone or Android** (memory and frame pacing still to measure). |
| 2 | Colyseus lobby, 12-seat synchronized match, server-authoritative travel, private camera/SOS | **Built and tested**: 12 WebSocket bots played full matches with 0 privacy violations; 3–4 simulated phones in browsers. **Two real phones in the same room: not yet done.** |
| 3 | Hunt, infection, rescue scoring, opening/ending, MP3/OGG audio | **Built.** Rules unit-tested. Audio plays through Web Audio but **has not been auditioned on phones**. |
| 4 | Published test URL/QR, 12-device rehearsal | **Local Wi-Fi preview only.** No public deployment yet (needs a Colyseus Cloud decision; see Connections). |

## Completed

### Setup
- The handoff ZIP was extracted to `PlayCanvas-Handoff/` without overwriting anything. All handoff documents were read, and the approved design is kept: CLAUDE.md and RESCUE_AND_SOS.md take precedence over the legacy Python.
- Git: `origin` points only to `ScaleBeaconLLC/Haunted-Gallery`.
- PlayCanvas Editor MCP registered for this project in `.mcp.json` (Windows form: `cmd /c npx -y @playcanvas/editor-mcp-server`, port 52000). Smoke-tested: the server starts and listens on 52000.

### Audio
- All 104 files (52 clips × MP3 and OGG) were decoded with ffmpeg and checked against `audio/manifest.json`. Report: `tools/audio/audio-report.json`.
- **Repaired:** `audio/MP3/Grabbed/VO_julian_grabbed_01.mp3` was 0 bytes. It was re-encoded from the valid matching OGG (48 kHz mono, 64 kb/s, 3.26 s). After the repair all 104 files pass. The original empty file is still inside the handoff ZIP.

### Server (`server/`, Colyseus 0.18.16, @colyseus/schema 5)
- `src/game/data.ts` holds the canonical cast, room graph, room rectangles, 14 hiding places, corridors/doorways, the exit, tuning and scoring. The client imports the same file.
- `src/game/engine.ts` is the pure, clock-injected rules engine:
  - Opening: the unselected 13th guest is the birthday victim. There is one photographer. The bite comes about 5 s after the flash, and the camera drops intact in the Portrait Gallery.
  - Choice → travel → encounter rounds: stay, move to an adjacent room, hide in one of the current room's two places, or escape.
  - Hunters (Elias, the birthday guest and infected players) choose a room plus a hiding place to search. Discovery, then grab, then bite.
  - Camera: one only. A photo freezes visible hunters for 5 s and it recharges 7 s after the shutter. It drops where its holder turns, can be picked up or passed, and can leave with a survivor.
  - **The camera is not required to escape.** The legacy camera gate was not ported.
  - Scoring: escape +100/+100. Rescue +150 to the lead rescuer and +150 team, paid only when the saved guest actually escapes. Camera assist +50 to the photographer. Each is paid once per guest. SOS earns 0.
  - Private SOS with presets: one per sender per window, a cooldown, expiry, a room snapshot marked "last seen" (the new room is never leaked), deliberate "update location", and cancellation on escape or infection.
  - CPU survivors and CPU hunters, including the repeat-hiding search pressure.
- `src/rooms/GalleryRoom.ts`:
  - Private room joined by a 5-character code.
  - Host control protected by `HOST_KEY` plus an opaque per-session host token. Nothing secret ships in the client.
  - 13 distinct seats, at most 12 humans, and optional CPU fill only when fewer than 12 humans join.
  - Opaque per-device key to return to a seat; 120 s reconnection during a match. A seat left for good is played by the AI.
  - Pause/resume excludes paused time. Reset keeps the connected players.
  - Rate limiting, and every message validated on the server.
  - **Public state** holds only the roster, statuses and aggregate counts. **Each phone gets its own private view** (room, visible occupants of that room, own hiding place, camera, own SOS). Effects go only to phones in the same room.
- Tests (`npm test`): 9 rules tests (including 40 full CPU matches with invariants) and 1 WebSocket integration test. **All 10 pass.**
- Balance snapshot from 500 CPU-only matches: about 5.1 rounds (~3.5 min), 8.5 of 12 escape, 3.5 turn, 0.9 camera rescues per match. These are initial values to tune at the rehearsal (`TUNING` in `data.ts`).

### Client (`client/`, PlayCanvas engine 2.22.4 + @colyseus/sdk 0.18.4, built with Vite into `server/public`)
- **3D mansion blockout**, generated from the shared layout:
  - Seven rooms with room-specific set dressing, 10 corridors (straight and L-shaped).
  - Walls are computed with gaps only at doorways. Hinged doors swing as someone passes; the service exit door is locked until the exit opens.
  - 14 hiding covers with floor markers, and the antique camera prop. Static geometry is batched.
- **Characters**: capsule stand-ins with per-character tint and name tags. Infected guests get a green skin and a hunch; stunned hunters glow blue; Elias is taller and wears a cape. Everyone walks along corridor waypoints only, so nobody passes through walls or teleports.
- **Touch camera**: drag to orbit, pinch to zoom. The camera stays inside the player's current room or corridor so walls never block the view.
- **Phone UI**:
  - Join by code (the QR fills it in), then choose a guest.
  - HUD shows room, role, phase timer and team totals.
  - Choice panel: stay, hide (2 places), move (legal rooms), escape. Camera pick-up, pass and drop; FLASH button with a recharge countdown.
  - SOS compose and inbox cards (I'm coming / I can't risk it / Open map), and an SVG map with the legal route.
  - Hunter panel for infected players. Opening cinematic captions (limo arrival is caption-only). Results screen.
- **Audio**:
  - MP3 with OGG fallback. One voice per character with priority quiet < discovery < grabbed < bite; grab and bite interrupt lower-priority lines.
  - Each guest's quiet whisper plays softly on their own phone only when they settle into cover.
  - Discovery plays only for phones in the same room, after the reveal.
  - Stereo panning and distance attenuation, separate buses and a master limiter. iOS audio unlocks on tap.
- **Phone robustness**: screen wake lock (HTTPS only), automatic reconnect and rejoin after sleep, server clock sync, vibration on SOS/grab/bite, and adaptive render resolution.
- **Host console** (`/host.html`): create a session, QR code plus join URL (uses the laptop's LAN address on local previews), roster with seat freeing, CPU-fill toggle, start/pause/resume/reset, live aggregate counts and results. It never shows rooms, hiding places or SOS.

### Verified with 12 WebSocket bots (`tools/e2e/bots.mjs`)
- 12 protocol-level phones (no rendering) played **2 complete 12-player matches** against the running server: 3.4 and 2.7 minutes, 8 and 6 rounds.
- 1,101 private views were checked: **0 privacy violations** (no other guest's hiding place, no misrouted SOS, no survivor data to hunters).
- 20 SOS sent / 20 received, and only by the intended recipients. Camera flashes and pickups raced correctly: the losers got "Someone already has the camera".

### Verified production build
- `npm run build` + `NODE_ENV=production node build/index.js`:
  - session creation is refused without `HOST_KEY` or with a wrong key, and accepted with the right one;
  - `/monitor` and `/api/lan` are disabled.
- `ecosystem.config.cjs` runs **one** process. Rooms are in memory and joined by code; several processes would need Redis presence.

### 12 browsers on this laptop
- 12 phone browsers in one Edge process joined, claimed 12 distinct seats, started, and received the SOS privately (the other 11 phones got nothing).
- Rendering 12 WebGL phones at once is **not** possible here: Chromium's cap on WebGL contexts per process dropped the oldest phone's 3D view, and 12 separate browsers exceeded the laptop's free RAM (1.6 of 7.2 GB).
- The 3D view is therefore checked with 3–4 phones, and the 12-seat logic with the bots. **A real 12-device rehearsal is still required.**

### Verified with automated browser tests (`tools/e2e/phones.mjs`, Edge headless, 390×844 touch viewports)
- Host creates a session; 3–4 phones join by code and claim distinct guests; the host starts.
- The opening cinematic plays. Round 1 choices appear.
- SOS reaches only its recipient (0 leaks to other phones). The reply shows on the sender's phone; the map opens.
- Travel animates through doorways. The hunt runs. Hiding works. Host pause reaches the phones and resume works.
- 0 page errors.
- **Frame rate is not meaningful here**: headless software rendering was throttled to 10 fps. It must be measured on real phones.

## Missing assets (none of these exist in the handoff or the repo)

| Asset | Needed for | Current stand-in |
|---|---|---|
| 13 guest character models + Elias Voss | All gameplay visuals | Capsule placeholders |
| Animations: walk, idle, hide/crouch, discover/lunge, grab, bite, turn, frozen-by-flash, escape; Elias welcome/freeze | Encounters, cinematic | Procedural bob/lean only |
| Final environment art: mansion rooms, props, painting, limousine exterior | All scenes | Primitive blockout; limo arrival is a caption only |
| Zombie physical discovery cue (a separate sound; not in the pack) | Discovery | **Placeholder**: synthesized growl (`audio.js`) |
| Bite / grab / body / fabric Foley (licensed) | Grab, bite | **Placeholder**: synthesized crunch |
| Ambience, lockdown alarm, camera shutter/flash | Atmosphere | **Placeholder**: synthesized drone, alarm and click |
| Elias Voss voice lines (welcome, infected breath/growl) | Opening, hunt | None |
| Per AI_VOICE_DIRECTION.md: `aftermath` and `distant_scream` takes, 2+ variations of key reactions, 48 kHz WAV masters | Voice design | Only the 52 existing auditions |
| Acting approval of the 52 auditions (Dev, Amara and Marcus already failed the dramatic check) | Release | Not auditioned on phones in the scene; these are **not approved performances** |

## Connections

| Connection | State | Action needed |
|---|---|---|
| GitHub `ScaleBeaconLLC/Haunted-Gallery` | Connected (Git Credential Manager) | — |
| Node.js | 24.21.0 installed | — |
| PlayCanvas Editor MCP | Configured in `.mcp.json`; **not connected** (needs the Editor open in Chrome) | See next steps |
| Blender | **Not installed** | Only needed once models or animations must be converted to GLB |
| Colyseus Cloud | **No account or credentials** on this machine; it is a paid subscription | Your decision (see next steps) |
| ffmpeg | Not installed system-wide; a portable copy was used for validation only | None |

## Next steps

1. **Real-phone check (free, now):**
   - Start the server on the laptop.
   - Join the laptop and at least one iPhone and one Android phone to the same Wi-Fi or hotspot.
   - Open `http://<laptop-LAN-IP>:2567/host.html` on the laptop, scan the QR, and play one match with `&debug=1`.
   - Record fps, heat, audio playback and whether reconnect after screen sleep works.
   - Note: wake lock needs HTTPS, so the local preview allows sleep.
2. **Public HTTPS preview:** needs a Colyseus Cloud account and plan (paid).
   - Deploy `server/` with `npx @colyseus/cloud deploy`; the first deploy opens a browser authorization.
   - Set `HOST_KEY` in the Cloud dashboard. The server also serves the built client, so one HTTPS URL is the QR target.
3. **PlayCanvas Editor:** open the target project in Chrome, then in the Editor click **MCP** → port 52000 → **Connect** and allow local access. Then restart Claude Code in this folder so it loads `.mcp.json`. After that:
   - verify the project name read-only;
   - create a checkpoint;
   - import the blockout, scripts and assets;
   - publish through PlayCanvas hosting if that is still preferred over the single-origin build.
4. Replace placeholder sounds and characters as assets arrive, then tune `TUNING` after the 12-phone rehearsal.
5. 12-device rehearsal checklist: privacy (no SOS or room leaks), cross-phone sync, reconnect, audio, victory and reset.

## Decisions made (routine)

- **Code-first client:** the client uses the PlayCanvas engine in code (not yet an Editor project) so it can be built and tested now. The level is generated from `data.ts` and can move into an Editor scene later.
- **Exit:** the service exit is on the Sealed Exhibition Room's south wall (layout reference [0, 20]).
  - It unlocks at the start of round 3, after the lockdown.
  - Round 1 is a lockdown scramble in which hunters stay with the first victim.
- **Hiding places moved:** three were nudged up to 2.5 m so their covers don't block doorways (listed in `data.ts`).
- **Rescue evidence in this release:** a camera flash that makes a hunter release or miss a co-located guest. The "jammed door" assist is not built because the blockout has no jammed-door interaction yet.
- **One origin:** the server serves the built client, so one HTTPS origin covers both the page and the WSS connection.
