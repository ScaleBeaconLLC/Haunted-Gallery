# Haunted Gallery

A 3D mobile browser survival game for a live event: every guest scans one QR code, plays on their own phone, and tries to escape Elias Voss's mansion museum alive while saving as many others as possible.

- **Client**: [PlayCanvas](https://playcanvas.com) engine 2.x (code-first, built with Vite) in `client/`.
- **Server**: [Colyseus](https://colyseus.io) 0.18 authoritative multiplayer server in `server/`.
- **Design source**: `PlayCanvas-Handoff/` (build brief, game bible, rescue/SOS rules, voice direction, audio auditions, legacy reference code).
- **Status and next steps**: see [`PROGRESS.md`](PROGRESS.md).

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

## Tests

- `server/`: `npm test` runs the rules engine tests (scoring, privacy, camera, infection, 40 CPU matches) and a WebSocket room test (host auth, seats, private SOS delivery, rejoin, pause/reset).
- `tools/e2e/phones.mjs`: drives a host console plus N phone-sized browsers through a match with screenshots (see the header of the file).
- `tools/audio/validate-audio.mjs`: decodes every voice clip with ffmpeg and checks it against the manifest.

## Security

- `HOST_KEY` (server environment variable) protects session creation in production; the server refuses to create sessions without it when `NODE_ENV=production`.
- No credentials, tokens or `.colyseus-cloud.json` files belong in this repository (`.gitignore` blocks them).
- Phones receive only their own private view; the public state carries the roster, statuses and team totals, never rooms, hiding places or SOS messages.
