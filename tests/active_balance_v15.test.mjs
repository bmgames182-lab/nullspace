import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { BiologicalArtagdollHumanV6 } from "../client/biological_human_v6.js";

await RAPIER.init();
const DT = 1 / 240;

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

function advance(f, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    f.h.update(DT);
    f.world.step();
  }
}

test("live controller emergency balance states actually unlatch back to stable", () => {
  const f = fixture();
  try {
    advance(f, 2.2);
    const chest = f.h.body("chest");
    chest.applyImpulse({ x: 5.4, y: 0, z: 0 }, true);
    advance(f, 0.45);
    assert.ok(["disturbed", "recovering", "stumbling", "stable"].includes(f.h.balanceSnapshot().state));
    advance(f, 2.2);
    const b = f.h.balanceSnapshot();
    assert.ok(b.risk < 0.16, `risk should settle (${b.risk.toFixed(3)})`);
    assert.equal(b.state, "stable", `low-risk body must leave emergency state (candidate=${b.transitionCandidate})`);
    assert.ok(f.h.body("pelvis").translation().y > 0.72);
  } finally {
    f.h.destroy();
    f.world.free();
  }
});

test("three rapid light chest hits escalate to conscious panic rather than a dead-looking floor ragdoll", () => {
  const f = fixture();
  try {
    advance(f, 2.2);
    for (let n = 0; n < 3; n++) {
      const chest = f.h.body("chest");
      f.h.hit("chest", { x: 0, y: 0, z: -1 }, 8, chest.translation());
      advance(f, 0.14);
    }

    const escalated = f.h.traumaSnapshot?.();
    assert.equal(escalated?.mode, "panic", "rapid repeated chest trauma should escalate behaviorally");
    assert.ok((escalated?.rapidTorsoHits ?? 0) >= 3, "the three hits should be treated as one cumulative episode");

    advance(f, 4.0);
    const trauma = f.h.traumaSnapshot?.();
    const pelvisY = f.h.body("pelvis").translation().y;
    const onFloor = ["down", "collapse"].includes(f.h.state) || pelvisY < 0.7;

    assert.equal(f.h.dead, false);
    assert.equal(f.h.physiology.unconscious, false);
    assert.equal(f.h.passiveHandoff, false, "conscious panic must happen before passive ragdoll handoff");
    assert.ok(f.h.controlDrive() > 0.14, "a conscious floor reaction must retain muscle tone");

    if (onFloor) {
      assert.equal(trauma?.mode, "panic");
      assert.ok(
        trauma?.groundActive || trauma?.reactionPhase === "groundPanic" || trauma?.behaviorPhase === "groundGuard",
        `a fall must become active ground coping, not inert down (state=${f.h.state}, phase=${trauma?.reactionPhase})`,
      );
    } else {
      assert.ok(pelvisY > 0.7, `a saved recovery should remain genuinely upright (${pelvisY.toFixed(3)})`);
      assert.ok(!["limp", "collapse"].includes(f.h.state));
    }
  } finally {
    f.h.destroy();
    f.world.free();
  }
});
