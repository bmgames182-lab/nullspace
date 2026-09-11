# Active Body Lab

A focused browser physics sandbox: one articulated human, one first-person rifle, and a flat test environment with two obstacles. The original controller explores Euphoria / Artagdoll-inspired physical reactions; it does not contain code from those systems.

**Controls:** WASD move, LMB shoot, RMB aim, R reset, Escape unlock mouse. Click the page to enter first person.

## Run

Requires Node 22 or later:

```sh
npm ci
npm start
```

Open http://127.0.0.1:8000. The development server serves the pinned local Three.js and Rapier dependencies without a CDN. For static hosting, publish `client/`; its import map uses the same pinned CDN versions. No build step or server backend is needed for static hosting.

## Physics

`client/active_human.js` owns the body and controller; `client/euphoria_lab.js` owns rendering, FPS input and the gun. There is one controller, not a chain of overrides.

- 14 rigid bodies, 76 kg total, aligned joint anchors, CCD and self-collision except connected neighbors.
- Fixed 240 Hz physics, bounded catch-up, additional constraint solver iterations. Rendering never sets physics poses or velocities.
- Capped PD relative joint torques, equal and opposite muscle impulses, mass-weighted centre of mass and velocity.
- Rapier contact manifolds determine support. Standing and recovery lift react against contacting feet, knees or forearms; muscles cannot add net upward momentum to an unsupported body.
- Capture-point-inspired stepping with a support foot and lift, travel, plant, cooldown phases. Plant confirmation comes from contact. Targets stay within leg reach.
- Native knee, elbow and ankle hinge limits. Rapier JS 0.19 does not expose spherical angular limits, so spine, neck, hip and shoulder tissue limits use capped passive torque stops. These are compliant limits, not hard anatomical guarantees.
- Exact collider/impact-point impulses, persistent asymmetric limb injuries, short protective responses, surface-directed arm bracing, and stumble → brace → kneel → stand recovery attempts.
- Fatal head/torso damage or two fully disabled legs turns off every active muscle. Passive constraints and tissue limits remain for the limp ragdoll.

This remains a procedural prototype. Recovery can fail or repeat after serious injury, and extreme poses can exceed compliant spherical limits. It is not a reproduction of proprietary Euphoria or the Artagdoll mod. Historical prototype files are not loaded by the focused entrypoint.

## Validation

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

The tests simulate prolonged standing and foot drift, catch-step completion, injury and recovery, directional off-center hits, unsupported momentum conservation, and corpse settling. Browser tests use real pointer lock and mouse shooting at chest, shin, arm and head, then check ADS, strafing, reset and Escape. Screenshots and a state report are saved in `test-results/` and uploaded by CI. Windows uses installed Microsoft Edge; Linux uses Playwright Chromium.

The `?test` URL exposes a developer test interface for reproducible aiming and inspecting physics. Normal play does not expose it. CI runs both suites on every push to `main`.
