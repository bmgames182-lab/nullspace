import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { BiologicalArtagdollHumanV7 } from "../client/biological_human_v7.js";

await RAPIER.init();
const DT = 1 / 240;
const V = (x) => new THREE.Vector3(x.x, x.y, x.z);

function fixture() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 12;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.1, 20)
      .setTranslation(0, -0.1, 0)
      .setFriction(1),
  );
  return { world, h: new BiologicalArtagdollHumanV7(world, new THREE.Scene()) };
}

function advance(f, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    f.h.update(DT);
    f.world.step();
  }
}

test("conscious chest trauma becomes guarding behavior instead of an instant ragdoll", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("chest", { x: 0, y: 0, z: -1 }, 18);
    assert.equal(f.h.behavior.phase, "flinch");
    advance(f, 0.55);
    assert.ok(["guard", "panic"].includes(f.h.behavior.phase));
    assert.ok(f.h.behavior.guard > 0.35);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(f.h.body("pelvis").translation().y > 0.58);
    assert.ok(!["down", "limp"].includes(f.h.state));
  } finally {
    f.world.free();
  }
});

test("three light torso hits escalate protective behavior without guaranteeing collapse", () => {
  const f = fixture();
  try {
    advance(f, 2);
    for (let i = 0; i < 3; i++) {
      f.h.hit("chest", { x: 0, y: 0, z: -1 }, 8);
      advance(f, 0.55);
    }
    advance(f, 1.8);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(f.h.behavior.hitCount >= 3);
    assert.ok(f.h.body("pelvis").translation().y > 0.52);
    assert.ok(!["down", "collapse", "limp"].includes(f.h.state));
  } finally {
    f.world.free();
  }
});

test("arm trauma makes the opposite hand protect the injured arm", () => {
  const f = fixture();
  try {
    advance(f, 2);
    const before = V(f.h.body("handL").translation()).distanceTo(V(f.h.body("upperArmR").translation()));
    f.h.hit("upperArmR", { x: 0, y: 0, z: -1 }, 18);
    advance(f, 0.65);
    const after = V(f.h.body("handL").translation()).distanceTo(V(f.h.body("upperArmR").translation()));
    assert.ok(["guard", "panic"].includes(f.h.behavior.phase));
    assert.ok(after < before - 0.03, `helper hand should move toward injured arm (before=${before.toFixed(3)}, after=${after.toFixed(3)})`);
    assert.ok(f.h.body("pelvis").translation().y > 0.58);
  } finally {
    f.world.free();
  }
});

test("head trauma can trigger conscious protective behavior without forcing limp", () => {
  const f = fixture();
  try {
    advance(f, 2);
    const event = f.h.hit("head", { x: 0, y: 0, z: -1 }, 14);
    assert.equal(event.immediateMotorLoss, false);
    advance(f, 0.55);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(["guard", "panic"].includes(f.h.behavior.phase));
    assert.ok(!["down", "limp"].includes(f.h.state));
  } finally {
    f.world.free();
  }
});
