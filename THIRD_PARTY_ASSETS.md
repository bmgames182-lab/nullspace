# Third-party assets

## Trauma voice samples

`client/pain_audio.js` streams four public-domain / CC0 voice files from Wikimedia Commons at runtime. They are not vendored into this repository.

- `Nl-scream.ogg` — short scream, CC0 1.0 Universal. Source page: `https://commons.wikimedia.org/wiki/File:Nl-scream.ogg`
- `En-us-scream.ogg` — short scream, released to the public domain by the copyright holder. Source page: `https://commons.wikimedia.org/wiki/File:En-us-scream.ogg`
- `UncleSigmund - ahhh (cc0) (freesound).mp3` — scream, CC0 1.0 Universal. Source page: `https://commons.wikimedia.org/wiki/File:UncleSigmund_-_ahhh_(cc0)_(freesound).mp3`
- `Male pain grunts.ogg` — male pain vocalisations. Source page: `https://commons.wikimedia.org/wiki/File:Male_pain_grunts.ogg`

The runtime uses Wikimedia's `Special:Redirect/file/...` URLs so the source remains auditable while Commons can serve the canonical media object. Automated `?test` runs disable trauma voice playback entirely, so CI does not depend on external audio availability.

The audio system has a WebAudio-generated fallback transient if a remote file cannot load. The fallback is intentionally non-speech and is only there so a network failure does not silently remove all pain feedback.

## Blood visuals

Blood droplets, streams, pools, smears and impact splats are generated procedurally by this project. No third-party blood image is required by the runtime.
