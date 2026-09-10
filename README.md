# GHOSTCAM

Original browser-based bodycam combat and ragdoll simulation prototype.

The previous NULLSPACE / Backrooms project has been retired. The repository now targets a single-player CQB sandbox first so movement, AI, hit reactions and physics can be made solid before multiplayer is reintroduced.

## Current prototype

- Three.js first-person bodycam presentation
- Rapier 3D physics
- articulated multi-body combat ragdolls
- non-lethal knockdowns with recovery attempts
- permanent physics deaths
- two AI teams that seek, strafe, fire and use the map
- player rifle with ADS, recoil, reload and tactical light
- head / torso / limb damage multipliers
- tracers, impact marks, dust, shell ejection and optional blood particles
- procedural layered gunshots, impacts, footsteps, distant fire and explosions
- CQB compound with structures, containers, cover and physics clutter
- graphics / AI / camera / audio settings

## Controls

- `WASD` move
- `Shift` sprint
- `Ctrl` crouch
- `Mouse` look
- `LMB` fire
- `RMB` aim down sights
- `R` reload
- `F` tactical light
- `Esc` game menu
- `Space` redeploy after death

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

The target is a convincing original bodycam war sandbox: physical reactions first, then smarter AI, richer sound/material assets, better weapon handling, destructible props, active-ragdoll balance/recovery and eventually optional multiplayer. It may take inspiration from the presentation and pacing of modern bodycam shooters, but should not copy proprietary BODYCAM code, maps, UI, models or audio.
