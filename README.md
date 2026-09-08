# NULLSPACE

Early browser multiplayer horror prototype inspired by social-paranoia Backrooms games.

## What already works

- Three.js first-person 3D Backrooms prototype
- WASD / sprint / pointer-lock mouse look
- pistol firing + reload
- room-code lobby UI
- multiplayer player synchronization
- Cloudflare Worker + Durable Object room backend
- WebSocket Hibernation-compatible Durable Object
- simple hit / HP events
- Cloudflare Pages-ready static client

## Local multiplayer

### 1. Start the Worker

```bash
cd worker
npm install
npx wrangler dev
```

Default local address: `http://localhost:8787`

### 2. Serve the client

From the repository root:

```bash
npx wrangler pages dev client --port 3000
```

Open two browser windows at `http://localhost:3000`, create a room in one, then join the same code in the other.

## Deploy Worker

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

Copy the resulting `https://...workers.dev` URL.

## Deploy client to Pages

Either connect the GitHub repository in the Cloudflare Pages dashboard with:

- Build command: `exit 0`
- Build output directory: `client`

or deploy manually:

```bash
npx wrangler pages deploy client --project-name nullspace
```

After deployment, open **Connection settings** on the game's title screen and paste the Worker URL.

## Next milestones

1. collision-safe maze / proper capsule controller
2. server-side shot validation
3. procedural level generation using deterministic room seed
4. real player model + animation
5. Rapier ragdolls
6. proximity voice chat via WebRTC
7. items / magazines / flashlight / inventory
8. entities and AI
9. extraction / persistence
10. spatial audio, lighting events and ambience

## Important

This is a starter prototype. Combat is not yet cheat-resistant; the client currently claims hits and the Durable Object bounds damage. Move hit validation server-side before treating it as competitive multiplayer.
