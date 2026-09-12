import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { BiologicalArtagdollHumanV8 } from "../client/biological_human_v8.js";

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
  return { world, h: new BiologicalArtagdollHumanV8(world, new THREE.Scene()) };
}

function advance(f, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    f.h.update(DT);
    f.world.step();
  }
}

test("strong conscious chest trauma produces guarded movement before any pain-kneel", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("chest", { x: 0, y: 0, z: -1 }, 18);
    advance(f, 1.55);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(f.h.behavior.guard > 0.35);
    assert.ok(f.h.behavior.guardSteps >= 1, "strong torso trauma should produce at least one protective step");
    assert.ok(f.h.metrics.steps >= 1, "protective intent must translate into an actual physics step");
    assert.ok(!["down", "collapse", "limp"].includes(f.h.state));
  } finally {
    f.world.free();
  }
});

test("persistent severe chest distress becomes a conscious controlled kneel instead of a death switch", () => {
  const f = fixture();
  try {
    advance(f, 2);
    const startY = f.h.body("pelvis").translation().y;
    f.h.hit("chest", { x: 0, y: 0, z: -1 }, 18);
    advance(f, 3.15);
    assert.equal(f.h.physiology.unconscious, false);
    assert.equal(f.h.dead, false);
    assert.equal(f.h.behavior.phase, "kneel");
    assert.ok(f.h.behavior.kneelIntent > 0.5);
    assert.ok(f.h.body("pelvis").translation().y < startY - 0.08, "pain-kneel should visibly lower the pelvis");
  } finally {
    f.world.free();
  }
});

test("light torso hits stay on the recoverable guard path and never use severe pain-kneel", () => {
  const f = fixture();
  try {
    advance(f, 2);
    for (let i = 0; i < 3; i++) {
      f.h.hit("chest", { x: 0, y: 0, z: -1 }, 8);
      advance(f, 0.5);
    }
    advance(f, 2.2);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(f.h.behavior.kneelIntent < 0.5);
    assert.notEqual(f.h.behavior.phase, "kneel");
    assert.ok(f.h.body("pelvis").translation().y > 0.7);
  } finally {
    f.world.free();
  }
});
