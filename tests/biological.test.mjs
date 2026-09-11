import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { BiologicalArtagdollHuman } from "../client/biological_human.js";

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
  return { world, h: new BiologicalArtagdollHuman(world, new THREE.Scene()) };
}

function advance(f, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    f.h.update(DT);
    f.world.step();
    for (const { rb } of f.h.parts.values()) {
      const p = rb.translation();
      const vel = rb.linvel();
      assert.ok(Number.isFinite(p.x + p.y + p.z + vel.x + vel.y + vel.z));
      assert.ok(Math.hypot(vel.x, vel.y, vel.z) < 14, "no explosive launch velocity");
    }
  }
}

test("biological controller stands normally before injury", () => {
  const f = fixture();
  try {
    advance(f, 3);
    assert.equal(f.h.controllerStyle, "artagdoll-biological-v5");
    assert.equal(f.h.dead, false);
    assert.equal(f.h.physiology.bloodVolume, 1);
    assert.ok(f.h.body("pelvis").translation().y > 0.7);
    assert.ok(["balance", "scramble"].includes(f.h.state));
  } finally {
    f.world.free();
  }
});

test("arm hit produces local deficit without cinematic whole-body knockback", () => {
  const f = fixture();
  try {
    advance(f, 2);
    const event = f.h.hit("upperArmR", { x: 0, y: 0, z: -1 }, 18);
    assert.equal(event.family, "arm");
    assert.ok(f.h.physiology.localLimbCapacity("arm", "R") < 1);
    assert.equal(f.h.physiology.localLimbCapacity("arm", "L"), 1);
    assert.ok(f.h.physiology.consciousness > 0.75);
    advance(f, 1.2);
    assert.ok(f.h.body("pelvis").translation().y > 0.58);
    assert.notEqual(f.h.state, "down");
    assert.equal(f.h.dead, false);
  } finally {
    f.world.free();
  }
});

test("leg hit unloads the injured side while preserving consciousness", () => {
  const f = fixture();
  try {
    advance(f, 2);
    const event = f.h.hit("shinL", { x: 0, y: 0, z: -1 }, 18);
    assert.equal(event.family, "leg");
    assert.ok(f.h.injury.L > f.h.injury.R);
    assert.ok(f.h.physiology.consciousness > 0.75);
    advance(f, 0.3);
    assert.ok(f.h.metrics.steps > 0, "injured leg should trigger unloading/catch stepping");
    assert.ok(f.h.body("pelvis").translation().y > 0.48);
  } finally {
    f.world.free();
  }
});

test("moderate head hit changes CNS state without requiring instant death", () => {
  const f = fixture();
  try {
    advance(f, 2);
    const before = f.h.physiology.brainFunction;
    const event = f.h.hit("head", { x: 0, y: 0, z: -1 }, 14);
    assert.equal(event.family, "head");
    assert.ok(f.h.physiology.brainFunction < before);
    assert.ok(f.h.reaction.headStun > 0);
    assert.equal(f.h.dead, false);
    advance(f, 0.18);
    assert.ok(f.h.body("pelvis").translation().y > 0.55);
  } finally {
    f.world.free();
  }
});

test("repeated torso trauma accumulates hemorrhage and later weakens control", () => {
  const f = fixture();
  try {
    advance(f, 2);
    for (let i = 0; i < 4; i++) {
      f.h.hit(i % 2 ? "abdomen" : "chest", { x: 0, y: 0, z: -1 }, 18);
      advance(f, 0.12);
    }
    const bloodAfterHits = f.h.physiology.bloodVolume;
    const driveAfterHits = f.h.systemicDrive();
    assert.ok(bloodAfterHits > 0.99, "hemorrhage should not act like instant HP loss");
    advance(f, 12);
    assert.ok(f.h.physiology.bloodVolume < bloodAfterHits);
    assert.ok(f.h.systemicDrive() <= driveAfterHits);
  } finally {
    f.world.free();
  }
});
