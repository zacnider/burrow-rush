# Burrow Rush

A real-time multiplayer hamster arena for Squeekchain. Players steer a hamster directly across an endless, hand-drawn grass-and-bedding world, gather illustrated seeds, corn, berries and carrots, and grow. Larger hamsters can steal a few seeds from smaller rivals on contact. Three four-frame hamster sprite sheets animate movement; the terrain is generated from coordinate-seeded chunks with varied grass, clover, flowers and straw. Food spawns in irregular rings around active players.

## Run locally

Use Node.js 20 or later. Start both the arena server and Vite together:

```sh
npm run dev:all
```

Open the Vite URL printed in the terminal. The arena server listens on `ws://localhost:8787/arena`; its health check is `http://localhost:8787/health`. Set `ARENA_PORT` to change the server port and `VITE_ARENA_WS_URL` to point the frontend at another WebSocket server.

## Pages and sharing

The app has separate `/`, `/play`, `/leaderboard`, and `/how-to` routes. Each arena holds up to 24 players; the next numbered arena opens when the current one fills. The leaderboard has a live-arena view and an all-time wallet XP view. `public/og-burrow-rush.png` is the 1200 × 630 Open Graph/Twitter preview image referenced by `index.html`.

## Squeekchain and wallet use

The arena server reads the public `https://api.squeekchain.com/v1/status` endpoint every five seconds. Fresh wheel activity increases the shared food spawn rate. A newly settled round adds a shared seed burst. Stale or unavailable data does not stop the game.

Wallet connection is optional for casual play. To save size and convert collected seeds to XP, sign a one-time, nonce-based message (no transaction); the server recovers the signer and checks the Squeekchain account endpoint. Each banked seed adds 10 XP, and the player's current size is saved for their next entry. Verified Squeek holders spawn slightly larger and move a little slower. Genesis tiers (Member, Bronze, Silver, Gold) are not exposed through the documented public developer API, so the game does not grant tier-based advantages or claim that a tier has been verified. XP is an in-game score only; there are no token rewards, wagers, or on-chain game transactions.

## Deployment

The production Node server serves both the built Vite site and multiplayer WebSocket on the same origin. Build with `npm ci && npm run build`, then run `npm start`. The server uses the platform `PORT` variable (or `ARENA_PORT`, then `8787`) and listens on `0.0.0.0`; in local development the Vite client still connects to port 8787. In production it automatically uses same-origin `wss://<host>/arena` when HTTPS is enabled by a reverse proxy such as Caddy.

For a VPS, keep the Node service behind a TLS reverse proxy and expose only ports 80/443 publicly. Set `ARENA_ORIGINS` to the exact comma-separated HTTPS site origins, for example `https://burrowrush.lol,https://www.burrowrush.lol`. Set `ARENA_DATA_FILE` to a writable path outside the release directory, such as `/var/lib/burrow-rush/profiles.json`, and back it up. Banked XP and saved sizes are stored there; live arena state resets on restart. The leaderboard and profile storage are server-backed, not on-chain.

## Current gameplay scope

- Numbered arenas that open in sequence, with a 24-player cap per arena.
- Server-authoritative direct movement, food collection, growth and seed-stealing collisions.
- Mouse, touch and WASD/arrow-key steering.
- Live wheel state and settled-round events from the official public Squeekchain API.
- Server-verified Squeek holder size bonus, with a small speed tradeoff. Genesis tier verification is pending an official source.
- Wallet-linked size saves and seed-to-XP banking, with an all-time XP leaderboard.
