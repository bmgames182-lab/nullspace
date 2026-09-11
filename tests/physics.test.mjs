import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { ActiveHuman } from "../client/active_human.js";
await RAPIER.init();
const DT = 1 / 240;
function fixture(ground = true) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 12;
  if (ground)
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(20, 0.1, 20)
        .setTranslation(0, -0.1, 0)
        .setFriction(1),
    );
  return { world, h: new ActiveHuman(world, new THREE.Scene()) };
}
function advance(f, seconds, observe = () => {}) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    f.h.update(DT);
    f.world.step();
    observe(f.h);
    for (const { rb } of f.h.parts.values()) {
      const p = rb.translation(),
        v = rb.linvel();
      assert.ok(
        Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z),
        "finite rigid body state",
      );
      assert.ok(Math.hypot(v.x, v.y, v.z) < 14, "no launch velocity");
    }
  }
}
function position(h, name) {
  return new THREE.Vector3().copy(h.body(name).translation());
}

test("76 kg articulated body stands for 30 seconds with planted feet and quiet joints", () => {
  const f = fixture();
  try {
    assert.ok(Math.abs(f.h.mass - 76) < 0.01);
    advance(f, 3);
    const feet = ["L", "R"].map((s) => position(f.h, "foot" + s));
    let min = 2,
      max = 0;
    advance(f, 27, (h) => {
      min = Math.min(min, h.body("pelvis").translation().y);
      max = Math.max(max, h.body("pelvis").translation().y);
    });
    assert.equal(f.h.state, "balance");
    assert.equal(f.h.metrics.steps, 0);
    assert.ok(min > 0.86 && max - min < 0.025);
    for (const [i, s] of ["L", "R"].entries())
      assert.ok(
        position(f.h, "foot" + s).distanceTo(feet[i]) < 0.025,
        "foot skating",
      );
    for (const j of f.h.joints) {
      const p = j.body1(),
        c = j.body2();
      const a = new THREE.Vector3()
        .copy(j.anchor1())
        .applyQuaternion(new THREE.Quaternion().copy(p.rotation()))
        .add(new THREE.Vector3().copy(p.translation()));
      const b = new THREE.Vector3()
        .copy(j.anchor2())
        .applyQuaternion(new THREE.Quaternion().copy(c.rotation()))
        .add(new THREE.Vector3().copy(c.translation()));
      assert.ok(a.distanceTo(b) < 0.025, "joint anchor separation");
    }
  } finally {
    f.world.free();
  }
});

test("torso impact triggers a completed catch step and recovers balance", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("chest", { x: 0, y: 0, z: -1 }, 18);
    advance(f, 12);
    assert.ok(f.h.history.includes("stumble"));
    assert.ok(f.h.metrics.steps > 0 && f.h.metrics.plants > 0);
    assert.equal(f.h.state, "balance");
    assert.ok(f.h.body("pelvis").translation().y > 0.8);
  } finally {
    f.world.free();
  }
});

test("injured leg unloads asymmetrically and attempts brace, kneel, stand recovery", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("shinL", { x: 0, y: 0, z: -1 }, 18);
    let min = 2;
    advance(
      f,
      12,
      (h) => (min = Math.min(min, h.body("pelvis").translation().y)),
    );
    assert.ok(f.h.injury.L > 0.5);
    assert.equal(f.h.injury.R, 0);
    assert.ok(min < 0.5);
    for (const state of ["stumble", "brace", "kneel", "stand"])
      assert.ok(f.h.history.includes(state), state);
    assert.ok(
      f.h.metrics.maxForce <= 850.001 && f.h.metrics.maxTorque <= 180.001,
    );
  } finally {
    f.world.free();
  }
});

test("off-center impacts produce deterministic directional angular momentum", () => {
  const results = [];
  for (const sign of [-1, 1]) {
    const f = fixture();
    try {
      const p = position(f.h, "chest");
      p.x += sign * 0.18;
      f.h.hit("chest", { x: 0, y: 0, z: -1 }, 12, p);
      results.push(f.h.body("chest").angvel().y);
    } finally {
      f.world.free();
    }
  }
  assert.ok(results[0] * results[1] < 0);
  assert.ok(Math.abs(results[0] + results[1]) < 0.001);
});

test("unsupported muscles add no net linear momentum or hovering force", () => {
  const f = fixture(false);
  try {
    advance(f, 0.12);
    const momentum = () => {
      const p = new THREE.Vector3();
      for (const { rb } of f.h.parts.values())
        p.addScaledVector(new THREE.Vector3().copy(rb.linvel()), rb.mass());
      return p;
    };
    const before = momentum();
    f.h.update(DT);
    assert.equal(f.h.support, 0);
    assert.ok(momentum().distanceTo(before) < 0.002);
    assert.ok(f.h.centreOfMass().velocity.y < -0.9);
  } finally {
    f.world.free();
  }
});

test("fatal head hits disable all active muscles and leave a settling ragdoll", () => {
  const f = fixture();
  try {
    advance(f, 2);
    for (let i = 0; i < 2; i++) f.h.hit("head", { x: 0, y: 0, z: -1 }, 18);
    assert.equal(f.h.dead, true);
    advance(f, 18, (h) => assert.equal(h.metrics.activeImpulse, 0));
    assert.equal(f.h.state, "limp");
    assert.ok(f.h.body("pelvis").translation().y < 0.45);
    let energy = 0;
    for (const { rb } of f.h.parts.values()) {
      const v = rb.linvel();
      energy += rb.mass() * (v.x * v.x + v.y * v.y + v.z * v.z);
      assert.ok(rb.translation().y > -0.02, "ground tunnelling");
    }
    assert.ok(energy < 2, "corpse settles instead of jittering");
  } finally {
    f.world.free();
  }
});
