# Third-party assets

## Trauma voice samples

The optional runtime pain audio in `client/pain_audio.js` references three files from the public-domain section of `jonjonsson/SoundMonster`:

- `Public domain/shock gasp.mp3`
- `Public domain/scream pain man 2.mp3`
- `Public domain/scream pain man 3.mp3`

Source repository: `https://github.com/jonjonsson/SoundMonster`

The upstream repository places these files in its **Public domain** collection and identifies them as public-domain / CC0-style reusable sound effects. They are streamed from the upstream raw GitHub URLs at runtime; no upstream binary is vendored into this repository.

The game has a WebAudio-generated fallback transient if an optional remote sample cannot load. Automated `?test` runs disable trauma voice playback entirely so CI never depends on an external network resource.

## Blood visuals

Blood droplets, streams, pools, smears and impact splats are generated procedurally by this project. No third-party blood image is required by the runtime.
