# Haunted Gallery

A 3D mobile browser survival game for a live event: every guest scans one QR code, plays on their own phone, and tries to escape Elias Voss's mansion museum alive while saving as many others as possible.

- **Client**: [PlayCanvas](https://playcanvas.com) engine 2.x (code-first, built with Vite) in `client/`.
- **Server**: [Colyseus](https://colyseus.io) 0.18 authoritative multiplayer server in `server/`.
- **Design source**: `PlayCanvas-Handoff/` (build brief, game bible, rescue/SOS rules, voice direction, audio auditions, legacy reference code).
- **Status and next steps**: see [`PROGRESS.md`](PROGRESS.md).
- **Multiplayer architecture, reconnection and handoff**: see [`docs/HAUNTED_GALLERY_MULTIPLAYER_HANDOFF.md`](docs/HAUNTED_GALLERY_MULTIPLAYER_HANDOFF.md).

## Run a local preview (same Wi-Fi)

Requires Node.js 22.18+.

```sh
cd server && npm install && npm test      # rules + multiplayer tests
cd ../client && npm install && npm run build   # builds into server/public
cd ../server && npm start                 # http://localhost:2567
```

1. On the laptop open `http://localhost:2567/host.html` and create a session. With no `HOST_KEY` set (local development), the first host tab gets control.
2. Phones on the same Wi-Fi scan the QR code shown there (it uses the laptop's LAN address).
3. Guests choose a character; the host presses **Start match**.

Add `&debug=1` to a phone URL to show frame-rate and resolution stats.

For development with hot reload run `npm start` in `server/` and `npm run dev` in `client/`, then open the Vite URL (port 5173).

## Temporary public HTTPS preview (free, from this laptop)

This preview runs only while the laptop, the server and the tunnel are all running. The address changes every time the tunnel restarts.

```sh
# server/.env.production (gitignored) must contain HOST_KEY=<password>
cd server && npm run build && NODE_ENV=production node build/index.js
cloudflared tunnel --no-autoupdate --url http://localhost:2567   # prints https://<random>.trycloudflare.com
```

Open `https://<random>.trycloudflare.com/host.html` and enter the `HOST_KEY` password. The QR code then points phones to the same HTTPS address.

## Tests

- `server/`: `npm test` runs the real-time rules tests, the WebSocket room tests, and the multiplayer suite (independent SDK clients: same-match join, validated/invalid actions, private-data isolation, drop and reload reconnection, second-tab takeover, match separation, expired sessions).
- `tools/e2e/eagle-eye-landscape.mjs`: the landscape phone playthrough at iPhone sizes (`PHONE=844x390` or `932x430`, safe-area insets emulated). It covers the rotate screen, Add to Home Screen, the mansion and room views, tap to move and hide, peeking, the break-free struggle, the Garden Gate and the results, and saves a screenshot at each step (`SHARP=1 CLEAN=1` for sharp screenshots without the debug overlay). It runs against a **test** server started with `HG_TEST_HOOKS=1 PORT=2570 npx tsx src/index.ts` in `server/`; the hooks never run in production.
- `tools/e2e/scenario.mjs`, `guest-suite.mjs`, `bedrooms.mjs`, `gallery.mjs`, `arrival.mjs` and `cloud-tour.mjs` drive the earlier portrait interface (room cards, thumb stick, dock). They do not pass against the eagle-eye interface on this branch.
- `tools/e2e/bots.mjs`: 12 WebSocket bots play full matches and check every private view for leaks (`HOST_KEY=... node tools/e2e/bots.mjs <url> 12 1`).
- `?offline=1&skip=1&room=conservation` runs the rules engine in the page with computer guests, for reviewing a room on one phone without a server (`VITE_REVIEW_ROOM=conservation` bakes those defaults into a build; `VITE_MODEL_EXT=.glb.wasm` changes the model URLs for hosts that don't serve `.glb`, after renaming the files to match).
- `tools/capture-rooms.mjs`: regenerates the room picture cards from the empty scene.
- `tools/audio/validate-audio.mjs`: decodes every voice clip with ffmpeg and checks it against the manifest.

## Security

- `HOST_KEY` (server environment variable) protects session creation in production; the server refuses to create sessions without it when `NODE_ENV=production`.
- No credentials, tokens or `.colyseus-cloud.json` files belong in this repository (`.gitignore` blocks them).
- Phones receive only their own private view; the public state carries the roster, statuses and team totals, never rooms, hiding places or SOS messages.
