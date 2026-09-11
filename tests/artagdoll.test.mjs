import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { ArtagdollHuman } from "../client/artagdoll_human.js";

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
  return { world, h: new ArtagdollHuman(world, new THREE.Scene()) };
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

test("Artagdoll v4 has physical hands and settles into a supported standing pose", () => {
  const f = fixture();
  try {
    assert.ok(f.h.body("handL"));
    assert.ok(f.h.body("handR"));
    assert.ok(f.h.parts.size >= 16);
    advance(f, 3);
    assert.equal(f.h.dead, false);
    assert.ok(f.h.body("pelvis").translation().y > 0.72);
    assert.ok(f.h.body("chest").translation().y > 1.1);
    assert.ok(["balance", "scramble"].includes(f.h.state));
  } finally {
    f.world.free();
  }
});

test("front torso hit gives a stagger window instead of an instant crouch or collapse", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("chest", { x: 0, y: 0, z: -1 }, 18);
    advance(f, 0.16);
    assert.ok(f.h.body("pelvis").translation().y > 0.7);
    assert.ok(f.h.body("chest").translation().y > 1.02);
    assert.notEqual(f.h.state, "down");
    assert.notEqual(f.h.state, "collapse");
    assert.ok(f.h.history.includes("react"));
  } finally {
    f.world.free();
  }
});

test("lateral torso hit gets a rescue step before any floor state", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("chest", { x: 1, y: 0, z: 0 }, 18);
    advance(f, 0.42);
    assert.ok(f.h.metrics.steps > 0, "lateral hit should trigger a catch step");
    assert.ok(f.h.body("pelvis").translation().y > 0.54);
    assert.notEqual(f.h.state, "down");
  } finally {
    f.world.free();
  }
});

test("arm hit stays local and does not topple a healthy body seconds later", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("upperArmR", { x: 0, y: 0, z: -1 }, 18);
    assert.ok(f.h.injury.armR > 0 && f.h.injury.armR < 0.2);
    advance(f, 1.4);
    assert.ok(f.h.body("pelvis").translation().y > 0.65);
    assert.ok(f.h.body("chest").translation().y > 0.95);
    assert.notEqual(f.h.state, "down");
    assert.notEqual(f.h.state, "collapse");
  } finally {
    f.world.free();
  }
});

test("leg hit unloads the struck leg into a forced swing instead of torso-first collapse", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("shinL", { x: 0, y: 0, z: -1 }, 18);
    assert.ok(f.h.injury.L > 0.1 && f.h.injury.L < 0.2);
    assert.ok(f.h.reaction.legStun.L > 0.7);
    advance(f, 0.22);
    assert.ok(f.h.metrics.steps > 0);
    assert.ok(f.h.body("pelvis").translation().y > 0.55);
    assert.ok(f.h.body("chest").translation().y > 0.9);
    assert.notEqual(f.h.state, "down");
  } finally {
    f.world.free();
  }
});

test("head hit whips the head while the pelvis remains supported", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("head", { x: 0, y: 0, z: -1 }, 14);
    assert.ok(f.h.reaction.headStun > 0.5);
    advance(f, 0.18);
    assert.ok(f.h.body("pelvis").translation().y > 0.7);
    assert.notEqual(f.h.state, "down");
    assert.ok(f.h.history.includes("react"));
    assert.ok(Math.abs(f.h.body("head").angvel().x) > 0.02);
  } finally {
    f.world.free();
  }
});
