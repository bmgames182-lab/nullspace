# GHOSTCAM

Original browser-based bodycam ragdoll playground and physics sandbox.

The previous NULLSPACE / Backrooms project has been retired. GHOSTCAM is now focused on bodycam presentation, weapon feel and physical ragdoll interaction rather than tactical or "smart" NPC combat.

## Current prototype

- Three.js first-person bodycam presentation
- Rapier 3D articulated multi-body ragdolls
- passive test dummies instead of tactical AI
- individual head / torso / limb hit reactions
- non-lethal knockdowns and permanent physics deaths
- shootable / shoveable / draggable ragdolls
- player rifle with ADS, recoil, reload and tactical light
- frag grenades with blast forces, flash, smoke and camera shake
- tracers, impact marks, dust, shell ejection and optional blood particles
- CC0 animated soldier model with procedural hitboxes
- CC0 recorded combat/footstep audio plus synthesized fallback layers
- CQB physics playground with structures, containers, cover and movable clutter
- render, camera, blood and audio settings

## Playground controls

- `WASD` move
- `Shift` sprint
- `Ctrl` crouch
- `Mouse` look
- `LMB` fire
- `RMB` aim down sights
- `R` reload
- `F` tactical light
- `G` throw frag
- `T` spawn a dummy in front of the camera
- `K` ragdoll the aimed dummy
- `J` ragdoll every standing dummy
- `E` hold to grab / drag the aimed ragdoll body part
- `Q` shove the aimed dummy or ragdoll
- `Y` stand an aimed recoverable dummy back up
- `Delete` remove the aimed dummy
- `H` reset the playground with a fresh dummy group
- `Esc` game menu
- `Space` redeploy after player death

## Run locally

Serve the `client` directory with any static HTTP server. For example from the repository root:

```bash
python -m http.server 8000 --directory client
```

Then open `http://localhost:8000`.

The game imports Three.js and `@dimforge/rapier3d-compat` from public ESM CDNs, so an internet connection is required for the current build.

## Cloudflare Pages

The existing Pages project can continue using `client` as its static output directory. No Worker is required for the current single-player prototype.

## Direction

The target is a convincing original BODYCAM-style physics toybox: heavier body reactions, better active-ragdoll balance, richer get-up / stumble behaviour, more physical props, better weapon handling and audio, and eventually optional multiplayer sandbox play. It should capture the broad bodycam-ragdoll feel without copying proprietary BODYCAM code, maps, UI, models or audio.
