import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { BiologicalArtagdollHumanV12 } from "../client/biological_human_v12.js";

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
  return { world, h: new BiologicalArtagdollHumanV12(world, new THREE.Scene()) };
}

function advance(f, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    f.h.update(DT);
    f.world.step();
    for (const { rb } of f.h.parts.values()) {
      const p = rb.translation();
      const vel = rb.linvel();
      assert.ok(Number.isFinite(p.x + p.y + p.z + vel.x + vel.y + vel.z));
      assert.ok(Math.hypot(vel.x, vel.y, vel.z) < 14, "reaction must not launch the body");
    }
  }
}

function hit(f, part, strength = 18, dir = { x: 0, y: 0, z: -1 }) {
  const rb = f.h.body(part);
  f.h.hit(part, dir, strength, rb.translation());
}

test("strong chest hit performs clutch -> panic -> kneel -> grounded coping -> passive ragdoll", () => {
  const f = fixture();
  try {
    advance(f, 2);
    hit(f, "chest", 18);

    advance(f, 0.52);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(["clutch", "panic"].includes(f.h.hitReaction.phase));
    assert.equal(f.h.hitReaction.finalRagdoll, false);
    assert.ok(!["collapse", "down", "limp"].includes(f.h.state));
    assert.ok(f.h.behavior.guard > 0.45, "chest wound should be actively guarded");

    advance(f, 1.05);
    assert.equal(f.h.hitReaction.phase, "panic");
    assert.ok(f.h.metrics.steps >= 1, "panic phase should create a real protective step");
    assert.equal(f.h.hitReaction.finalRagdoll, false);

    advance(f, 1.65);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(["kneel", "failing"].includes(f.h.hitReaction.phase));
    assert.equal(f.h.dead, false);
    assert.equal(f.h.hitReaction.finalRagdoll, false);

    advance(f, 2.05);
    assert.ok(["failing", "grounded"].includes(f.h.hitReaction.phase));
    assert.equal(f.h.physiology.unconscious, false);
    assert.equal(f.h.dead, false);

    advance(f, 1.25);
    assert.equal(f.h.hitReaction.phase, "ragdoll");
    assert.equal(f.h.hitReaction.finalRagdoll, true);
    assert.equal(f.h.passiveHandoff, true);
    assert.ok(["collapse", "down"].includes(f.h.state));
  } finally {
    f.world.free();
  }
});

test("light chest trauma guards and recovers instead of using the delayed ragdoll path", () => {
  const f = fixture();
  try {
    advance(f, 2);
    hit(f, "chest", 8);
    advance(f, 3.8);
    assert.equal(f.h.hitReaction.delayedCollapse, false);
    assert.equal(f.h.hitReaction.finalRagdoll, false);
    assert.equal(f.h.passiveHandoff, false);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(!["collapse", "limp"].includes(f.h.state));
    assert.ok(f.h.body("pelvis").translation().y > 0.62);
  } finally {
    f.world.free();
  }
});

test("arm hit stays local: hurt arm is guarded while the body remains active", () => {
  const f = fixture();
  try {
    advance(f, 2);
    hit(f, "upperArmR", 18);
    advance(f, 1.05);
    assert.equal(f.h.hitReaction.zone, "arm");
    assert.ok(["guard", "recover"].includes(f.h.hitReaction.phase));
    assert.equal(f.h.hitReaction.finalRagdoll, false);
    assert.ok(f.h.physiology.localLimbCapacity("arm", "R") < 1);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(f.h.body("pelvis").translation().y > 0.62);
    assert.ok(!["collapse", "down", "limp"].includes(f.h.state));
  } finally {
    f.world.free();
  }
});

test("leg hit uses unload/hop behavior before any possible kneel", () => {
  const f = fixture();
  try {
    advance(f, 2);
    hit(f, "shinL", 18);
    advance(f, 0.72);
    assert.equal(f.h.hitReaction.zone, "leg");
    assert.ok(["hop", "kneel"].includes(f.h.hitReaction.phase));
    assert.ok(f.h.metrics.steps >= 1, "injured leg should trigger a physical rescue step");
    assert.equal(f.h.hitReaction.finalRagdoll, false);
    assert.equal(f.h.physiology.unconscious, false);
  } finally {
    f.world.free();
  }
});

test("moderate head hit stays dazed but supported unless physiology actually fails", () => {
  const f = fixture();
  try {
    advance(f, 2);
    hit(f, "head", 14);
    advance(f, 0.82);
    assert.equal(f.h.hitReaction.zone, "head");
    if (!f.h.physiology.unconscious) {
      assert.ok(["dazed", "recover"].includes(f.h.hitReaction.phase));
      assert.equal(f.h.hitReaction.finalRagdoll, false);
      assert.ok(!["collapse", "limp"].includes(f.h.state));
    }

    advance(f, 2.15);
    if (!f.h.physiology.unconscious && f.h.physiology.brainFunction > 0.5) {
      assert.equal(f.h.hitReaction.finalRagdoll, false);
      assert.ok(!["collapse", "down", "limp"].includes(f.h.state));
      assert.ok(f.h.body("pelvis").translation().y > 0.62, "conscious head trauma should preserve gross standing support");
      assert.ok(f.h.body("chest").translation().y > 0.9, "conscious head trauma should not become a torso-first floor collapse");
      assert.ok(f.h.directedSteps <= 1, "moderate head trauma should not produce a frantic multi-step panic loop");
    }
  } finally {
    f.world.free();
  }
});
