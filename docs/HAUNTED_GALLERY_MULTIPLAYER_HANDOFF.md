# Haunted Gallery: authoritative multiplayer handoff

_Written 2026-09-25, updated 2026-09-26 after the Colyseus Cloud deployment. No secrets in this file: the host password lives only in the gitignored `server/.env.production` and the Cloud dashboard's `HOST_KEY` variable; the deploy token lives only in the gitignored `.colyseus-cloud.json`._

## Where the work is

| Item | Value |
|---|---|
| Repository | `https://github.com/ScaleBeaconLLC/Haunted-Gallery` (only remote: `origin`) |
| Gameplay baseline commit | `6f65621`, "Real-time hide-and-seek upgrade…" (was `main` == `origin/main`) |
| Baseline checkpoint tag | `checkpoint-gameplay-upgrade` → `6f65621` (earlier: `checkpoint-rounds-v1` → `a2fbac9`) |
| Working branch | `multiplayer-foundation` (branched from `6f65621`), then **`mansion-rooms`** (branched from `multiplayer-foundation`: bedroom wing, reference-based room art, 15-minute spec timing; see `docs/MANSION_REFERENCE_MAPPING.md`) |
| Deployed to Colyseus Cloud? | **Yes**: now commit **`b1581a4`** on **`mansion-rooms`** (2026-09-26). Previously `fd998c0` on `multiplayer-foundation`. |

## Current deployment: `visual-upgrade` @ `68f7588` (2026-09-26)

- **Merge:** `mansion-rooms` was fast-forward merged into `main` (tag `checkpoint-mansion-merged`) and verified live on Cloud as `main` @ `0e0c2c1`.
- **Deploy:** the tested `visual-upgrade` branch was then deployed with `--branch visual-upgrade`. `/version` reports `{"commit":"68f7588"}`.
- **Checks against Cloud:**
  - `remote-multiplayer.mjs` 15/15.
  - 12 bots: 0 privacy violations in 6,146 views.
  - `cloud-tour.mjs`: two phone-sized players and one desktop player walk room by room and hide under the four-poster, inside the wardrobe and under the single bed.
  - `arrival.mjs`: the limousine and all 12 arriving guests as real models.
- **Screenshots:** `docs/screenshots/visual-upgrade/`.
- **To go back to `main` on Cloud:** `npx @colyseus/cloud@1.0.12 deploy --env production --branch main --remote https://github.com/ScaleBeaconLLC/Haunted-Gallery.git`.
- **`/version`** (added in `0e0c2c1`) reports the running commit and start time, so any deploy can be verified from outside.

## Previous deployment: `mansion-rooms` @ `b1581a4` (2026-09-26)

| Check | Result |
|---|---|
| Deployed with | `npx @colyseus/cloud@1.0.12 deploy --env production --branch mansion-rooms --remote https://github.com/ScaleBeaconLLC/Haunted-Gallery.git` (not `main`) |
| Fingerprint | Cloud serves `main-DZTZQa03.js`, identical to a fresh GitHub clone of `b1581a4` built with `npm install && npm run build` (27/27 server tests pass in that clone) |
| `tools/e2e/remote-multiplayer.mjs` | **15/15 pass** against the Cloud endpoint |
| `tools/e2e/bots.mjs` (12 bots) | Full match, **0 privacy violations** in 3,410 private views |
| `tools/e2e/cloud-tour.mjs` (no test hooks) | The host creates a session with `HOST_KEY`, and players join through the QR link. There are 13 guests plus Elias, the countdown shows 15:00 with the "Final lockdown · 11:45 p.m." clock, and each player walks room by room to the bedroom wing. Julian (phone) ends up under the four-poster, Anika (desktop) inside the guest wardrobe, Marcus (phone) under the single bed. No page errors. Screenshots are in `docs/screenshots/mansion-cloud/`. |

Found and fixed during the Cloud tour:
- The action panel, lobby grid, SOS inbox and host roster were rebuilt on every view (~10×/s), so a tap could land on a replaced button. They now update only when their content changes.
- "Hand over the camera" appeared and vanished as guests walked past. It now stays in place and is disabled when nobody is in reach.
- On a 390 px phone the lockdown caption overlapped the HUD. Captions now sit below the HUD's actual height.

## Colyseus Cloud deployment (verified)

| Item | Value |
|---|---|
| Application | `1966-haunted-gallery` (created by the owner in the Colyseus Cloud dashboard) |
| **Verified Cloud endpoint** | **https://us-ord-c6919c4a.colyseus.cloud**: serves the game page, the host console (`/host.html`) and WSS for Colyseus |
| Deployed branch / commit | `multiplayer-foundation` / **`fd998c0`** (`main` is not deployed and was not merged) |
| How it was deployed | `npx @colyseus/cloud@1.0.12 deploy --env production --branch multiplayer-foundation --remote https://github.com/ScaleBeaconLLC/Haunted-Gallery.git` from the repo root. Browser sign-in selected the existing app; the token is stored only in `.colyseus-cloud.json` (gitignored). |
| Build on Cloud | Cloud clones over **SSH** with its own key, so its **read-only deploy key is added to the GitHub repo's Deploy keys** (without it: `Permission denied (publickey)`). Then it runs `npm install` + `npm run build` at the repo root, which builds the PlayCanvas client into `server/public` and compiles the server. PM2 starts `server/build/index.js` from the root `ecosystem.config.cjs` (`NODE_ENV=production`, 1 process). |
| Environment variable | `HOST_KEY` set in the Cloud dashboard (value never in git or public files) |
| Automatic deploys | **Off.** The GitHub integration (which deploys `main` on push) is intentionally not connected; deploys are triggered with the CLI command above. |

### Proof the deployment is the tested commit

- A fresh GitHub clone of `fd998c0` built with `npm install && npm run build` (1 min 16 s, no files from the laptop) and passed all 24 server tests.
- Started through PM2 with `ecosystem.config.cjs`, that clean-clone build passed `tools/e2e/remote-multiplayer.mjs` (15/15).
- The Cloud page references exactly the same content-hashed client files as that clean build (`main-I_naqONd.js`, `net-u5b_V9dC.js`, `net-CBJJvwHq.css`).

### Live test results against https://us-ord-c6919c4a.colyseus.cloud (2026-09-26)

| Test | Result |
|---|---|
| Serves page, host console, room pictures, voice clips (incl. repaired `VO_julian_grabbed_01.mp3`); `/monitor` and `/api/lan` return 404 (production) | Pass |
| Session creation refused with no or a wrong host password; allowed with the configured `HOST_KEY` | Pass |
| `tools/e2e/remote-multiplayer.mjs`, two independent SDK clients over WSS: same match by code; distinct identities; synchronized roster; unknown code → 522; hunt start seen by both; invalid move rejected with no state change; B sees A's server-validated movement; hidden player absent from B's received data; SOS only to its recipient; public state free of private data; drop → automatic reconnection, same session, still hidden; reload → token reconnection, same session and seat; no host control after rejoin; second match separate with no cross-traffic | **15/15 pass** |
| `tools/e2e/bots.mjs`, 12 bots, one full match | Completed; **0 privacy violations in 12,554 private views** |
| Browser smoke test: host console → create session with password → QR link points at the Cloud host → phone-sized browser joins, picks a guest, host starts → phone enters the match and renders the 3D opening; no page errors | Pass |

Not tested on Cloud: real iPhone/Android devices, a 12-phone rehearsal, and long-running stability or restarts.

### Cloud endpoint vs. the old preview

- **Verified Cloud endpoint:** https://us-ord-c6919c4a.colyseus.cloud runs `fd998c0`, and every check above passed against it.
- **Old tunnel preview** (`*.trycloudflare.com` from this laptop): still the **baseline `main` build (`6f65621`)**, not updated or tested in this task. It is temporary and not the Cloud deployment.

### Redeploying

1. Commit and push to `multiplayer-foundation` (or another tested branch).
2. From the repo root run the deploy command above. It reuses `.colyseus-cloud.json` on this laptop; use `--reset` to pick the app again on another machine.
3. Wait for `/healthz` to return `{"ok":true}`, then re-run `tools/e2e/remote-multiplayer.mjs https://us-ord-c6919c4a.colyseus.cloud` with `HOST_KEY` in the environment.

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
- **Hosting:** the same Node process serves the built client (`server/public`) and the WebSocket endpoint (one origin, no `VITE_SERVER_URL` needed).
  - **Colyseus Cloud:** https://us-ord-c6919c4a.colyseus.cloud runs `fd998c0`.
  - **Old tunnel preview:** runs the baseline `main` build.

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

1. ~~Cloud build shape~~ **Resolved:** a root `package.json` build plus root `ecosystem.config.cjs`, verified from a clean clone and on Cloud. One process only, because rooms are in memory and joined by code; more processes would need Redis presence.
2. ~~Cloud account~~ **Done:** the owner created the app; it's deployed and tested (see above).
3. The old tunnel preview still runs `main` (baseline). The Cloud endpoint is the current, tested server.
4. No real-phone or 12-device testing yet; balance values are initial.
5. The PlayCanvas Editor is not integrated (standalone engine only).
6. The host password has appeared in chat; rotate `HOST_KEY` (Cloud dashboard + local `server/.env.production`) before the event.
7. `multiplayer-foundation` is not merged into `main`. Merge after review if the Cloud build should become the mainline.

## Next step

1. **First real-phone test on the Cloud endpoint:** host console at https://us-ord-c6919c4a.colyseus.cloud/host.html, one iPhone and one Android phone scanning the QR, with `&debug=1` for frame rate.
2. Then the 12-device rehearsal.
3. Rotate `HOST_KEY`.
4. Decide whether to merge `mansion-rooms` (which contains `multiplayer-foundation`) into `main`.
