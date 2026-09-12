import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { BiologicalArtagdollHumanV6 } from "../client/biological_human_v6.js";

await RAPIER.init();
const DT = 1 / 240;
const vec = (p) => new THREE.Vector3(p.x, p.y, p.z);

function fixture() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 12;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.1, 20)
      .setTranslation(0, -0.1, 0)
      .setFriction(1),
  );
  return { world, h: new BiologicalArtagdollHumanV6(world, new THREE.Scene()) };
}

function advance(f, seconds, sample) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    f.h.update(DT);
    f.world.step();
    sample?.(f.h, i * DT);
    for (const { rb } of f.h.parts.values()) {
      const p = rb.translation();
      const lv = rb.linvel();
      const av = rb.angvel();
      assert.ok(Number.isFinite(p.x + p.y + p.z + lv.x + lv.y + lv.z + av.x + av.y + av.z));
      assert.ok(Math.hypot(lv.x, lv.y, lv.z) < 15, "trauma response must remain numerically bounded");
    }
  }
}

function settle(f) {
  advance(f, 2.2);
  assert.ok(f.h.body("pelvis").translation().y > 0.82);
}

function chestHit(f, strength = 18, direction = new THREE.Vector3(0.08, -0.015, -1).normalize()) {
  const rb = f.h.body("chest");
  const point = vec(rb.translation()).add(new THREE.Vector3(0.045, 0.045, 0.02));
  return f.h.hit("chest", direction, strength, point);
}

test("V18 calm chest trauma clutches without pain-driven panic walking", () => {
  const f = fixture();
  try {
    settle(f);
    f.h.setReactionModeForDebug("calm");
    chestHit(f, 18);
    let minPelvis = Infinity;
    let maxChestAngular = 0;
    advance(f, 1.1, (h) => {
      minPelvis = Math.min(minPelvis, h.body("pelvis").translation().y);
      const a = h.body("chest").angvel();
      maxChestAngular = Math.max(maxChestAngular, Math.hypot(a.x, a.y, a.z));
    });
    const t = f.h.traumaSnapshot();
    assert.equal(t.mode, "calm");
    assert.equal(t.directedSteps, 0, "calm pain should not inject a retreat-step animation");
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(maxChestAngular > 0.08, "chest should physically yield/twist around the wound");
    assert.ok(minPelvis > 0.48, "calm impact must not instant-collapse on the hit frame");

    let sawLowOrGrounded = false;
    advance(f, 5.8, (h) => {
      const trauma = h.traumaSnapshot();
      if (h.body("pelvis").translation().y < 0.62 || trauma.groundActive) sawLowOrGrounded = true;
    });
    assert.equal(f.h.physiology.unconscious, false, "pain sequence must remain distinct from CNS shutdown");
    assert.ok(sawLowOrGrounded, "severe calm chest trauma should eventually give way into a guarded fall/kneel");
  } finally {
    f.h.destroy();
    f.world.free();
  }
});

test("V18 panic chest trauma uses chaotic physical recovery before the fall", () => {
  const f = fixture();
  try {
    settle(f);
    f.h.setReactionModeForDebug("panic");
    chestHit(f, 18, new THREE.Vector3(0.38, -0.02, -0.92).normalize());

    let maxChestAngular = 0;
    let maxFootRelativeSpeed = 0;
    let sawStep = false;
    advance(f, 3.25, (h) => {
      const a = h.body("chest").angvel();
      maxChestAngular = Math.max(maxChestAngular, Math.hypot(a.x, a.y, a.z));
      if (h.step.phase !== "idle") {
        sawStep = true;
        const foot = h.body("foot" + h.step.side);
        maxFootRelativeSpeed = Math.max(
          maxFootRelativeSpeed,
          vec(foot.linvel()).sub(vec(h.body("pelvis").linvel())).length(),
        );
      }
    });

    const t = f.h.traumaSnapshot();
    assert.equal(t.mode, "panic");
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(sawStep || t.directedSteps > 0, "panic should attempt at least one real recovery/retreat step");
    assert.ok(maxChestAngular > 0.16, "panic reaction should produce visible torso rotation");
    assert.ok(maxFootRelativeSpeed < 3.5, `panic feet must stay physically believable (${maxFootRelativeSpeed.toFixed(2)} m/s)`);
  } finally {
    f.h.destroy();
    f.world.free();
  }
});

test("V18 conscious ground panic keeps finite muscle tone and non-mirrored writhing", () => {
  const f = fixture();
  try {
    settle(f);
    f.h.setReactionModeForDebug("panic");
    chestHit(f, 18);

    let reachedGround = false;
    for (let i = 0; i < Math.round(8 / DT); i++) {
      f.h.update(DT);
      f.world.step();
      if (f.h.traumaSnapshot().groundActive) {
        reachedGround = true;
        break;
      }
    }
    assert.ok(reachedGround, "panic sequence should reach conscious ground coping");
    assert.equal(f.h.passiveHandoff, false, "ground panic must happen before passive ragdoll handoff");
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(f.h.controlDrive() > 0.15, "conscious floor reaction needs remaining muscle tone");

    let motionL = 0;
    let motionR = 0;
    let maxBodySpeed = 0;
    advance(f, 1.35, (h) => {
      const l = h.body("shinL").angvel();
      const r = h.body("shinR").angvel();
      motionL += Math.hypot(l.x, l.y, l.z) * DT;
      motionR += Math.hypot(r.x, r.y, r.z) * DT;
      for (const { rb } of h.parts.values()) {
        const lv = rb.linvel();
        maxBodySpeed = Math.max(maxBodySpeed, Math.hypot(lv.x, lv.y, lv.z));
      }
    });

    assert.ok(motionL > 0.05 && motionR > 0.05, "both legs should retain visible conscious movement");
    assert.ok(Math.abs(motionL - motionR) > 0.003, "ground motion should not be perfectly mirrored");
    assert.ok(maxBodySpeed < 8, `ground writhing must stay heavy rather than launching (${maxBodySpeed.toFixed(2)} m/s)`);
    assert.equal(f.h.passiveHandoff, false);
  } finally {
    f.h.destroy();
    f.world.free();
  }
});
