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

test("moderate conscious head trauma degrades coordination before global collapse", () => {
  const f = fixture();
  try {
    advance(f, 2);
    const event = f.h.hit("head", { x: 0, y: 0, z: -1 }, 14);
    assert.equal(event.immediateMotorLoss, false);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(f.h.reaction.headStun > 0);
    advance(f, 0.7);
    assert.ok(f.h.physiology.consciousness > 0.35);
    assert.ok(f.h.body("pelvis").translation().y > 0.55);
    assert.ok(!["down", "limp"].includes(f.h.state));
  } finally {
    f.world.free();
  }
});

test("torso trauma creates a strong local procedural flinch without launch velocity", () => {
  const f = fixture();
  try {
    advance(f, 2);
    const event = f.h.hit("chest", { x: 0, y: 0, z: -1 }, 18);
    assert.equal(event.family, "torso");
    assert.ok(f.h.reaction.strength >= 0.5, "torso startle should be visually readable");
    advance(f, 0.18);
    const pelvisSpeed = Math.hypot(...Object.values(f.h.body("pelvis").linvel()));
    assert.ok(pelvisSpeed < 3.5, "torso reaction should not be projectile-launch knockback");
    assert.ok(f.h.body("pelvis").translation().y > 0.58);
  } finally {
    f.world.free();
  }
});
