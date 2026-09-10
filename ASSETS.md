# GHOSTCAM asset / dependency sources

The current GHOSTCAM prototype intentionally uses procedural geometry, procedural materials and synthesized Web Audio effects so the NULLSPACE asset stack could be removed cleanly during the project reset.

## Runtime libraries

### Three.js

- Purpose: rendering, camera, lighting, materials and ray casting
- Package: `three`
- Runtime source: jsDelivr ESM build
- Project: https://threejs.org/
- License: MIT

### Rapier 3D compatibility build

- Purpose: rigid-body simulation and articulated ragdolls
- Package: `@dimforge/rapier3d-compat`
- Runtime source: esm.sh
- Project: https://rapier.rs/
- License: Apache-2.0

## Current art/audio

- Weapon: original procedural Three.js geometry
- Soldiers: original procedural Three.js geometry
- CQB compound: original procedural Three.js geometry/materials
- Gunfire, impacts, footsteps and ambience: synthesized at runtime with Web Audio
- Blood particles / impact marks: procedural

## Next asset pass

When external models, textures or recorded audio are added, prefer CC0, public-domain or otherwise clearly permissive assets. Vendor important files into the project when licensing permits and record the creator, source URL, exact file and licence here. Do not copy BODYCAM proprietary assets, maps, weapon models, animations, UI, audio or code.
