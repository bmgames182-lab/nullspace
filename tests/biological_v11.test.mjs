import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { BiologicalArtagdollHumanV11 } from "../client/biological_human_v11.js";

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
  return { world, h: new BiologicalArtagdollHumanV11(world, new THREE.Scene()) };
}

function advance(f, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    f.h.update(DT);
    f.world.step();
    for (const { rb } of f.h.parts.values()) {
      const p = rb.translation();
      const vel = rb.linvel();
      assert.ok(Number.isFinite(p.x + p.y + p.z + vel.x + vel.y + vel.z));
    }
  }
}

function distance(a, b) {
  return vec(a.translation()).distanceTo(vec(b.translation()));
}

test("strong chest hit becomes clutching and guarded retreat, not impact-frame ragdoll", () => {
  const f = fixture();
  try {
    advance(f, 2);
    const chest = f.h.body("chest");
    const initialNearest = Math.min(
      distance(f.h.body("handL"), chest),
      distance(f.h.body("handR"), chest),
    );

    f.h.hit("chest", { x: 0, y: 0, z: -1 }, 18, chest.translation());
    advance(f, 0.68);

    const wound = f.h.woundWorld();
    assert.ok(wound);
    const nearest = Math.min(
      vec(f.h.body("handL").translation()).distanceTo(wound),
      vec(f.h.body("handR").translation()).distanceTo(wound),
    );
    assert.ok(nearest < initialNearest - 0.12, `a hand should travel toward the wound (${initialNearest.toFixed(3)} -> ${nearest.toFixed(3)})`);
    assert.equal(f.h.physiology.unconscious, false);
    assert.equal(f.h.hitReaction.finalRagdoll, false);
    assert.ok(["clutch", "panic"].includes(f.h.hitReaction.phase));
    assert.ok(!["down", "collapse", "limp"].includes(f.h.state));

    advance(f, 1.25);
    assert.ok(f.h.directedSteps >= 1, "chest trauma should create at least one real guarded retreat step");
    assert.equal(f.h.hitReaction.finalRagdoll, false);
  } finally {
    f.world.free();
  }
});

test("severe conscious chest pain ends in grounded guarding rather than fake neurological limp", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("chest", { x: 0, y: 0, z: -1 }, 18, f.h.body("chest").translation());
    advance(f, 5.35);

    assert.equal(f.h.physiology.unconscious, false);
    assert.equal(f.h.dead, false);
    assert.equal(f.h.hitReaction.phase, "grounded");
    assert.equal(f.h.hitReaction.finalRagdoll, false);
    assert.equal(f.h.behavior.phase, "groundGuard");
    assert.ok(f.h.behavior.guard > 0.25);
    assert.ok(f.h.controlDrive() > 0.08, "a conscious grounded person should retain purposeful muscle drive");
  } finally {
    f.world.free();
  }
});

test("arm hit is cradled by the opposite hand while the person remains upright", () => {
  const f = fixture();
  try {
    advance(f, 2);
    const arm = f.h.body("upperArmR");
    const helper = f.h.body("handL");
    const before = distance(helper, arm);
    f.h.hit("upperArmR", { x: 0, y: 0, z: -1 }, 18, arm.translation());
    advance(f, 0.82);
    const after = distance(helper, arm);

    assert.ok(after < before - 0.06, `opposite hand should move toward hurt arm (${before.toFixed(3)} -> ${after.toFixed(3)})`);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(f.h.body("pelvis").translation().y > 0.62);
    assert.notEqual(f.h.hitReaction.phase, "ragdoll");
  } finally {
    f.world.free();
  }
});

test("moderate head hit produces dazed guarding while gross support remains active", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("head", { x: 0, y: 0, z: -1 }, 14, f.h.body("head").translation());
    advance(f, 0.78);

    assert.equal(f.h.physiology.unconscious, false);
    assert.equal(f.h.hitReaction.phase, "dazed");
    assert.equal(f.h.hitReaction.finalRagdoll, false);
    assert.ok(f.h.behavior.guard > 0.25);
    assert.ok(f.h.body("pelvis").translation().y > 0.62);
    assert.ok(f.h.controlDrive() > 0.35);
  } finally {
    f.world.free();
  }
});
