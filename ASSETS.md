# NULLSPACE asset sources

NULLSPACE uses original code and procedural materials plus the permissively licensed assets below.

## Quaternius — Ultimate Modular Men Pack

- Used for: remote player / security character model (`Swat.gltf`) and its bundled character animations
- Creator: Quaternius
- Original pack: https://quaternius.com/packs/ultimatemodularcharacters.html
- License: CC0 1.0 / public domain dedication
- Runtime mirror used by the browser build: `agentkaerf/FreeModels` via jsDelivr
- File: `Ultimate Modular Men- Feb 2022/Individual Characters/glTF/Swat.gltf`

## Kenney — RPG Audio

- Used for: footsteps (`footstep00.ogg` through `footstep04.ogg`), door/gate movement (`doorOpen_1.ogg`, `doorOpen_2.ogg`, `doorClose_1.ogg`, `doorClose_2.ogg`) and small metallic interaction/ambience sounds (`metalClick.ogg`, `metalLatch.ogg`, `metalPot1.ogg`)
- Creator: Kenney
- Original pack: https://kenney.nl/assets/rpg-audio
- License: CC0 1.0
- Runtime mirror used by the browser build: `Nazarwadim/School-Hooligan` via jsDelivr

## Kenney — Furniture Kit 2.1

- Used for: abandoned Level 0 room dressing — desks, office chairs, bookcases, cardboard boxes, radios, trash cans and vintage televisions
- Creator: Kenney
- Pack: Furniture Kit 2.1
- License: Creative Commons Zero (CC0); the included license explicitly permits personal, educational and commercial use
- Runtime mirror used by the browser build: `eturner58/game-assets` via jsDelivr
- Format: small GLB models from `Models/GLTF format/`

## Notes

Wallpaper, carpet, ceiling tiles, stains and most environment geometry are generated procedurally in the client. Furniture is loaded asynchronously and is intentionally non-blocking: if the CDN is unavailable, gameplay still starts. The browser also keeps procedural fallbacks for remote avatars and sound effects.

Asset authors are not affiliated with or endorsing NULLSPACE. Attribution is included for provenance even though CC0 does not require it.
