# GHOSTCAM asset / dependency sources

GHOSTCAM uses original game code and procedural geometry, supplemented with clearly permissive third-party assets. All optional runtime assets have procedural fallbacks so a failed CDN request does not stop the simulation.

## Runtime libraries

### Three.js
- Purpose: rendering, camera, lighting, materials, animation and ray casting
- Runtime: jsDelivr ESM build
- Project: https://threejs.org/
- License: MIT

### Rapier 3D compatibility build
- Purpose: rigid-body simulation and articulated ragdolls
- Package: `@dimforge/rapier3d-compat`
- Runtime: esm.sh
- Project: https://rapier.rs/
- License: Apache-2.0

## Character model

### Quaternius — Ultimate Modular Men / SWAT
- Purpose: animated standing AI soldier visual; original procedural meshes remain invisible hitboxes and fallback visuals
- Creator: Quaternius
- Source pack: https://quaternius.com/packs/ultimatemodularcharacters.html
- License: CC0 1.0 / public-domain dedication
- Runtime mirror: `agentkaerf/FreeModels` through jsDelivr
- File: `Ultimate Modular Men- Feb 2022/Individual Characters/glTF/Swat.gltf`
- The Rapier ragdoll body is original GHOSTCAM geometry and takes over for physics knockdowns/deaths.

## Environment textures

### Poly Haven — Asphalt 01
- Purpose: outdoor compound ground diffuse, OpenGL normal and roughness maps
- Source: https://polyhaven.com/a/asphalt_01
- Authors: Charlotte Baglioni (photography), Dario Barresi (processing)
- License: CC0
- Runtime: 1K JPG maps from `dl.polyhaven.org`

### Poly Haven — Concrete Floor Worn 001
- Purpose: concrete wall/cover surface diffuse, OpenGL normal and roughness maps
- Source: https://polyhaven.com/a/concrete_floor_worn_001
- Authors: Dimitrios Savva (photography), Rico Cilliers (processing)
- License: CC0
- Runtime: 1K JPG maps from `dl.polyhaven.org`

## Combat audio

### qubodup — Tiny Naval Battle Sounds Set
- Purpose: heavy gunshot recording (`fire_heavy.wav`) and metallic impact recording (`impact_pen.wav`)
- Original source: https://opengameart.org/content/tiny-naval-battle-sounds-set
- License: CC0
- Runtime mirror: `euuuuuuan/voidclad-public` raw GitHub files; that repository's `CREDITS.md` records the per-file provenance and CC0 status

### Za-Games — Deep Boom
- Purpose: distant/explosion low-frequency recording (`core_boom.wav`)
- Original source: https://freesound.org/people/Za-Games/sounds/539968/
- License: CC0
- Runtime mirror: `euuuuuuan/voidclad-public` raw GitHub file

### GameAudio — Ping Sound Ricochet
- Purpose: occasional metal ricochet layer (`ricochet_ping.wav`)
- Original source: https://freesound.org/people/GameAudio/sounds/220204/
- License: CC0
- Runtime mirror: `euuuuuuan/voidclad-public` raw GitHub file

### Kenney — RPG Audio
- Purpose: randomized player footstep recordings
- Source: https://kenney.nl/assets/rpg-audio
- License: CC0 1.0
- Runtime mirror: `Nazarwadim/School-Hooligan` through jsDelivr

## Original GHOSTCAM assets
- first-person rifle/viewmodel: procedural Three.js geometry
- AI fallback bodies and invisible hitboxes: procedural Three.js geometry
- articulated physics ragdoll: original Rapier body/joint layout
- compound geometry, cover and dynamic crates: procedural
- body-hit layers, weapon transients, ambient wind and some UI/foley: synthesized with Web Audio
- blood particles, tracers, shell casings, impact dust and bullet marks: procedural

## Policy

Do not import proprietary BODYCAM code, maps, UI, models, animations or audio. New third-party assets should be CC0, public domain, MIT/Apache-compatible, or otherwise clearly licensed for redistribution/use, with creator/source/licence recorded here.
