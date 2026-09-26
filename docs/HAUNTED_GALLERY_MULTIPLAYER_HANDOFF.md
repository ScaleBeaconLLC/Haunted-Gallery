# Haunted Gallery: authoritative multiplayer handoff

_Written 2026-09-25. No secrets in this file. The host password lives only in the gitignored `server/.env.production`._

## Where the work is

| Item | Value |
|---|---|
| Repository | `https://github.com/ScaleBeaconLLC/Haunted-Gallery` (only remote: `origin`) |
| Gameplay baseline commit | `6f65621`, "Real-time hide-and-seek upgrade…" (was `main` == `origin/main`) |
| Baseline checkpoint tag | `checkpoint-gameplay-upgrade` → `6f65621` (earlier: `checkpoint-rounds-v1` → `a2fbac9`) |
| Working branch | `multiplayer-foundation` (branched from `6f65621`) |
| Deployed to Colyseus Cloud? | **No** (not part of this task) |

## Actual architecture (verified in the code, not the planning docs)

- **Client:** the standalone **PlayCanvas engine** (`playcanvas` npm package 2.22.4) used code-first, built with Vite 8.3.1 (`client/`).
  - The level is generated from `server/src/game/data.ts`.
  - **There is no PlayCanvas Editor project.** The PlayCanvas Editor MCP server is configured in `.mcp.json` but has never been connected, and nothing is stored in an Editor project.
- **Server:** one **Colyseus 0.18** room type, `gallery` (`server/src/rooms/GalleryRoom.ts`). The rules engine is `server/src/game/engine.ts` with `nav.ts`; it runs **only on the server**.
  - The client imports only shared constants and geometry (`data.ts`), never the rules, so there are no competing rule copies.
- **One venue match = one Colyseus room.** The seven mansion rooms are locations inside that match, not separate sessions.
  - Join codes are the Colyseus room id: 5 characters, private room, `joinById`.
- **Authority:** phones send intents only: `intent` (room / hide / exit / pickup / search / block / chase / idle), `pace`, `peek`, `inspect`, `snare`, `flash`, `give`, `drop`, `sos:*`. The server validates and simulates everything:
  - movement along doorway routes, hiding capacity and timing;
  - searches, grabs, bites and infection;
  - camera ownership, freeze (5 s) and recharge (7 s from the shutter), doorway blocks;
  - snares, rescue credit, escapes and the exit timer.
- **Hosting today:**
  - The same Node process serves the built client (`server/public`) and the WebSocket endpoint, so the page and WSS share one origin.
  - The temporary public preview is a Cloudflare quick tunnel to this laptop, currently running the **baseline** (`main`) build, not this branch.

### Package versions (installed, server and client matched)

| Package | Version |
|---|---|
| colyseus / @colyseus/core | 0.18.8 / 0.18.16 |
| @colyseus/schema | 5.0.34 (server and client) |
| @colyseus/sdk | 0.18.4 (client, and server tests) |
| @colyseus/tools / @colyseus/testing | 0.18.4 / 0.18.6 |
| playcanvas | 2.22.4 |
| Node.js (this machine) | 24.21.0 (PlayCanvas Editor MCP needs ≥ 22.18) |

## Private data model

- **Public schema state** (`GalleryState`, synced to everyone) carries only:
  - join code, phase, pause, timers, exit open;
  - team score, escaped count, inside count, human count;
  - birthday guest and photographer (both witnessed publicly in the opening);
  - per-seat character, display name, taken / CPU / connected, and status `""`, `"inside"` or `"escaped"`.
  - **No** infection, rooms, positions, hiding places, SOS or scores.
- **Private data** travels as per-client `view` messages computed by `HauntedGame.viewFor()` from what that character can perceive. Effects (`fx`) go only to the phones that witness them.
- We use private messages rather than a schema `StateView`: nothing private is ever put in the synchronized state, so there is nothing to filter.
- Tests check the **actual received messages**, not UI labels.

## Reconnection and identity

| Case | Mechanism |
|---|---|
| Temporary network drop (app still running) | SDK automatic retry (15 attempts, exponential backoff, and only after the room has been joined for 5 s). Server `onDrop` → `allowReconnection` for **30 s in the lobby / 120 s in a match**. Same session; the seat shows "reconnecting". |
| Page reload | The tab's `sessionStorage` holds the reconnection token (never in a URL, link or log) → `client.reconnect(token)` inside the same window. |
| After the window, or a deliberate leave during a match | The device key (`localStorage`, random, opaque) returns that phone to **its own seat** via `joinById`. Meanwhile the AI played the seat. Nothing is duplicated or reset: infection, camera and cooldowns live on the server character, not the connection. |
| Second tab / second device with the same device key | The newest connection takes over. The old one gets `replaced` and close code **4201**, and the client stops auto-rejoining and explains why. A late drop, reconnect or leave from the old connection can't disturb the seat. |
| Expired session or wrong code | Colyseus matchmaking error **522** → the client shows "This game session has ended, or the code is wrong", clears the stored token and stops retrying. **A replacement match is never created silently.** |
| Stranger during a running match | Refused: "This match has already started". |
| Host control | Only with `HOST_KEY` (session creation) or that session's host token. A player's rejoin never grants it. |

## Configuration names (examples only: `server/.env.example`, `client/.env.example`)

| Name | Where | Purpose |
|---|---|---|
| `HOST_KEY` | server env (gitignored `.env.production`, or the Colyseus Cloud dashboard) | Required in production to create sessions |
| `PORT` | server env | Listen port (default 2567; Colyseus Cloud sets it) |
| `NODE_ENV` | server env | `production` disables `/monitor` and `/api/lan` and enforces `HOST_KEY` |
| `HG_TEST_HOOKS` | server env, **tests only** | Enables `test:setup` (skip opening, park AI, place, infect). Ignored when `NODE_ENV=production`. |
| `VITE_SERVER_URL` | client build env | Colyseus endpoint when the client is hosted elsewhere, e.g. `https://<app>.<region>.colyseus.cloud`. Unset = same origin (local and tunnel). |
| `VITE_PUBLIC_URL` | client build env | Address the host QR code points phones to |

## Commands

```sh
# Server
cd server && npm install
npm test                       # 24 tests: rules + room + multiplayer (shared test server)
npm start                      # dev server, http://localhost:2567
npm run build && NODE_ENV=production node build/index.js   # production mode (needs HOST_KEY)

# Client
cd client && npm install && npm run build   # builds into server/public (copies voice audio)
npm run dev                                 # Vite on :5173, talks to :2567

# End-to-end (see file headers)
HG_TEST_HOOKS=1 PORT=2570 npx tsx src/index.ts                  # in server/: test server with hooks
node tools/e2e/scenario.mjs http://localhost:2570 <outDir>      # 3 browser phones (needs Edge/Chrome + playwright-core)
HOST_KEY=... node tools/e2e/bots.mjs http://localhost:2567 12 1 # 12 WebSocket bots, privacy checks
```

## Tests and results (this branch)

`server/test/multiplayer.test.ts` uses **independent `@colyseus/sdk` clients over real WebSockets**. All pass, stable across 4 consecutive runs:

1. Two clients join the **same** match by code with distinct session ids and characters; a bad code is refused (522).
2. Permitted state is synchronized; a move happens **only** through a server-validated intent, and the other client's copy matches the server position.
3. Invalid actions are rejected with no state change: non-adjacent room, another wing's hiding place, a flash without the camera, a player using host start, and an unknown action.
4. Private-data isolation on received messages: a hidden player is absent from others' views; infection is told only to the victim (public state clean); SOS reaches only its recipient.
5. A temporary drop auto-reconnects to the same session: infection not cured, camera and cooldown unchanged, no duplicate characters.
6. Page reload: the token resumes the same session; a bogus token is refused; after a deliberate leave the device key returns the same seat; no host powers; a stranger is refused.
7. A second tab takes over (close 4201) with exactly one controller.
8. Two matches stay completely separate (same character in both, starting one leaves the other in its lobby, no cross-traffic).
9. An expired session gives a clear 522 and no replacement.

Gameplay baseline, re-run on this branch:

- 13 rules tests and 2 room tests pass.
- The browser scenario passes all 8 checks.
- A 12-bot match against a production build: 0 privacy violations.
- Audio validation: 104/104 files.
- Client build and type-check are clean.

## Audit: what the gameplay upgrade actually implemented

| Area | Status | Evidence |
|---|---|---|
| Room picture cards, bird's-eye travel, walk/run, physical entry into cover, first-person hiding, peek, leave cover | **Working** in the blockout | Browser scenario screenshots and checks; engine tests |
| Secret infection, readable only up close, private briefing, recap history | **Working** | Engine test, scenario, multiplayer test 4, bots |
| Doorway blocking and release by flash/snare/disconnect | **Working** (server) | Engine tests. **Not** exercised in the browser scenario. |
| Clues and the rope snare | **Working** (server + UI buttons) | Engine test. The UI path is covered by the bots, not the browser scenario. |
| Camera 5 s / 7 s, rescue on escape, escape without the camera | **Working** | Engine tests |
| Characters | **Placeholder:** primitive rigs with per-guest clothes, shoes and hair | No models or animation clips exist |
| Animation | **Placeholder:** procedural swing, bend and crouch | — |
| Environment art | **Placeholder:** primitive blockout; room cards captured from it | — |
| Voices | 52 **unapproved** AI auditions, played with priority and interruption | Audio validator |
| Zombie cue, Foley, ambience, alarm | **Synthesized placeholders** | `client/src/audio.js` |
| Real phones (iOS/Android), 12-device rehearsal | **Not tested** | Headless desktop emulation only |

## Remaining issues

1. **Colyseus Cloud build shape (unresolved, not tested):**
   - The server serves the client from `server/public`, which is built from `client/` and is gitignored.
   - A Cloud deploy of `server/` alone would ship without the game page. Two options:
     - (a) set the Cloud build command to build the client first;
     - (b) host the client elsewhere (e.g. PlayCanvas hosting) with `VITE_SERVER_URL` pointing at Cloud. That needs CORS and join-URL checks.
   - `ecosystem.config.cjs` runs one process, because rooms are in memory and joined by code; more processes would need Redis presence.
2. Deploying needs a Colyseus Cloud account and a paid plan: **your approval and a browser sign-in**.
3. The public tunnel preview still runs `main` (baseline). This branch's seat takeover, expired-session messages and endpoint examples aren't live there.
4. No real-phone or 12-device testing yet; balance values are initial.
5. The PlayCanvas Editor is not integrated (standalone engine only).

## Next step (task 3)

Full cloud client integration:

1. choose the Cloud build shape (issue 1);
2. with your approval, create the Colyseus Cloud app and deploy `multiplayer-foundation`;
3. set `HOST_KEY` in the Cloud dashboard;
4. point the client at it (same origin or `VITE_SERVER_URL`);
5. re-run `tools/e2e/bots.mjs` and `scenario.mjs` against the cloud URL;
6. do the first real two-phone test.
