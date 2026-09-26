# Haunted Gallery: progress log

_Last updated: 2026-09-25 (real-time gameplay, camera and hiding upgrade)_

This log separates what is **verified**, what is **built but not verified on real phones**, and what is **missing**. It is a playable multiplayer blockout with placeholder characters, not a finished production game.

Recoverable checkpoint of the previous round-based build: git tag **`checkpoint-rounds-v1`** (commit `a2fbac9`).

## What changed in the upgrade

The game no longer runs global choice countdowns. It is continuous real-time hide-and-seek. Every movement is an **intent** that the server validates, turns into a route through real doorways, and plays out at walking or running speed.

| Brief item | Implemented | How it was tested |
|---|---|---|
| 1. Room picture → bird's-eye travel → physically enter cover → first person → back to bird's-eye on leaving | Yes | 3-phone browser scenario (screenshots 01–05) |
| 2. Following angled bird's-eye travel view | Yes: follows behind the character, frames the direction of travel, stays over the current room/corridor (never looks through walls), drag to swing, pinch to zoom. Slim control bar while travelling. | Browser scenario screenshots |
| 3. Suspense without omniscience | The server sends each phone only the people its character can perceive: same room within sight, or across a nearby doorway. It never sends anyone in cover. No enemy arrows, outlines or live map. Name tags are neutral, shown only in the travel view and only within 10 m. | Engine tests; 12-bot privacy checks (0 violations in 13,000+ views) |
| 4. Movement choices for survivors and zombies, walk/run, legal routes, redirect mid-route, no bypass | Survivors: go to a room, hide, leave cover, stop, run for the exit. Zombies: go to a room, search a hiding place, block a doorway, go after someone they can see, wait. Walk/Run toggle (run 3.6 m/s vs walk 1.7). Routes use fixed geometry only. One movement command at a time (350 ms), none while caught or stunned. | Engine tests (travel timing, run faster, doorway-only routes, mid-corridor redirect, rejection rules) |
| 5. Cover is an outcome, not immunity | "Hidden — stay alert" only after the character arrives and settles in (0.7 s). Capacity 2 per spot. A hunter who *watched* you get in may search there; others learn nothing. | Engine test "only hidden after physically entering"; scenario check "not hidden while walking" |
| 6. First person while hidden | Camera sits at the hiding pose (under a table 0.42 m, crouched behind 1.05 m, standing behind a curtain 1.5 m). Drag to look within limits. Hold **Peek** to lean out, which exposes you within 7 m. Your own body is not drawn. Looking never exposes you. You can't switch to the overhead view while hidden. | Scenario screenshots 04–07, 09–10 |
| 7. Room picture cards | 7 static JPEGs rendered from the real scene with **no actors, camera or hiding markers** (`tools/capture-rooms.mjs`). Only the current and adjacent rooms are selectable. Pending / accepted / interrupted / rejected states are shown. Map sheet for orientation. | Screenshots 01–02 |
| 8. Secret infection | No public announcement, status, count, tag colour or roster change. Public state says only "inside" or "escaped". The victim gets a private briefing and keeps control. Clothes, shoes and hair stay the same. Skin and posture change only when the face is readable: within 3.2 m, while attacking, while frozen or snared, or while bent searching your hiding place. Elias and the opening victim are publicly known. The full infection history is in the recap. | Engine test; scenario (from a distance he looks normal, up close he's revealed, nothing announced to others, public state clean); bots |
| 9. SOS doesn't leak infection | Contacts list everyone still inside, turned or not. An SOS to a turned guest is accepted but never delivered, and looks exactly like an unanswered one. Nothing is cancelled visibly on infection. Hunters receive no SOS. No impersonation. | Engine test "SOS cannot be used to test who turned" |
| 10. Doorway blocking | A zombie must walk to a doorway of its current room and stand in it. Survivors physically stop 2.4 m short ("Someone is standing in the doorway"). The block releases when the zombie moves, is frozen or snared (it staggers 1.8 m clear), or its player disconnects. | Engine tests (block → halt → flash → pass through; disconnect releases block) |
| 11. Escape, single camera, rescue | One camera. Take Photo freezes eligible *visible* zombies within 9 m for 5 s, and it recharges 7 s after the shutter. Dropping it where the holder is bitten keeps the cooldown. The camera is not a weapon and not needed to escape. Rescue credit is paid only after the saved guest escapes. | Engine test (freeze/recharge/rescue/escape without camera) |
| 12. Clues and one limited defence | 7 inspectable clues, each within reach (≤ 1.6 m) of a hiding place. They give the camera's last room, the exit route, the exit timer and identity advice. Three give a **velvet rope snare**: rig it where you stand, or just outside your cover when hidden. A zombie that walks into it is tangled for 6 s (no attack, search or block, and it lets go), then gets 20 s of immunity. Permanent banishment is a separate rule, off by default. | Engine test (clue → snare → tangle → recovery → immunity) |
| 13. Engaged hiding | Real sound cues only: footsteps, running, rummaging, a struggle, with direction and near/far, never identity. Hiding panel: Peek, Inspect (in reach), Rig snare, Take Photo, Leave hiding, Ask for help. | Browser scenario; bots |
| 14. Authoritative and synchronized | The server validates every action. Private per-phone views are about 10 per second. CPU players use the same perception limits (no hidden knowledge). Reconnection restores the same seat. | 15 server tests; 12 bots over the public HTTPS/WSS link |

## Verification (actually run)

- **Server tests** (`cd server && npm test`): **15/15 pass.**
  - 13 real-time rules tests: travel physics, doorway-only routes, redirect, cover timing, secret infection, search, blocking + flash, camera timing + rescue, snare, SOS secrecy, disconnect releases a block, and 12 CPU-only matches checked for hidden-guest leaks.
  - 2 WebSocket room tests.
- **Browser scenario** (`tools/e2e/scenario.mjs`, three 390×844 touch browsers, Edge headless with software rendering, against a local test server with test hooks). All checks pass:
  - not hidden while walking; first-person view in cover;
  - a friend approaching is seen and never marked infected;
  - the infection is not announced to others; public state is clean;
  - the infected guest looks normal from a distance and is revealed up close; the searched hiders are caught.
- **12 WebSocket bots** (`tools/e2e/bots.mjs`) played full matches, including one **over the public HTTPS/WSS link**: **0 privacy violations** in more than 13,000 private views. The SOS messages sent were received; blocks, searches and flashes all happened.
- **Balance** (40 CPU-only matches): about 6.7 of 12 escape, 5.3 turn, 4 minutes on average. Initial values; tune in `TUNING` after the rehearsal.
- **Not verified:** real iPhone/Android frame rate, heat, touch feel, audio on phones, and a 12-device rehearsal. Everything above ran on a laptop.
  - Headless browsers are throttled to about 10 fps with software rendering, so their frame numbers mean nothing for phones.
  - **Desktop mobile emulation is not phone testing.**

## Missing assets (still placeholders)

| Asset | Current stand-in |
|---|---|
| 13 guest models + Elias Voss (clothing, shoes, hair, faces, infected look) | Primitive rigs: per-guest pants, shoes, hair and torso colours; green skin and red eyes when revealed |
| Animations: walk/run cycles, crouch into and crawl out of cover, search-bend, lunge/grab, bite, turning collapse, flash freeze, snare tangle, escape | Procedural leg/arm swing, bend, crouch and shake only |
| Final environment art: mansion rooms, props, painting, limousine exterior | Primitive blockout; limo arrival is a caption only |
| Zombie discovery cue, bite/grab Foley, footsteps, doors, ambience, alarm, shutter | **Synthesized placeholders** in `client/src/audio.js` |
| Elias voice lines; approved AI voice performances | 52 unapproved auditions (Julian's grabbed MP3 repaired) |
| Room card photography | Captured from the blockout (regenerate after final art with `tools/capture-rooms.mjs`) |

## Connections

| Connection | State | Action needed |
|---|---|---|
| GitHub `ScaleBeaconLLC/Haunted-Gallery` | Connected | — |
| Public preview | **Live** via a free Cloudflare quick tunnel from this laptop, in production mode. The first tunnel expired on Cloudflare's side and was replaced, so **the URL changes when that happens**. | Laptop, server and tunnel must stay running. A permanent URL needs a paid host (Colyseus Cloud or similar); that's your decision. |
| PlayCanvas Editor MCP | Configured in `.mcp.json`; not connected | Open the project in Chrome → MCP → port 52000 → Connect, then restart Claude Code here |
| Colyseus Cloud | Not set up (paid) | Your decision |

## Next steps

1. **Real phones:**
   - one iPhone and one Android on the public link with `&debug=1`;
   - check fps, heat, voice playback, peek hold, travel readability, and whether the phone rejoins after sleep.
2. **12-device rehearsal:** privacy, secret-infection moments, blocking, snares, reconnect, tuning.
3. **Assets:** replace the stand-ins as models, animations and sounds arrive, then re-capture the room cards.
4. **Permanent hosting** before the event, if you approve a paid host.
