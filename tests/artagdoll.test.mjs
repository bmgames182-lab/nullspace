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

test("Artagdoll controller settles into a supported standing pose", () => {
  const f = fixture();
  try {
    advance(f, 3);
    assert.equal(f.h.dead, false);
    assert.ok(f.h.body("pelvis").translation().y > 0.72);
    assert.ok(f.h.body("chest").translation().y > 1.12);
    assert.ok(["balance", "stumble"].includes(f.h.state));
  } finally {
    f.world.free();
  }
});

test("torso hit reacts before committing to a floor collapse", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("chest", { x: 0, y: 0, z: -1 }, 18);
    advance(f, 0.14);
    assert.ok(f.h.body("pelvis").translation().y > 0.58, "torso hit should stagger before collapsing");
    assert.notEqual(f.h.state, "down");
    assert.ok(f.h.history.includes("react"));
  } finally {
    f.world.free();
  }
});

test("arm hit stays local enough that the legs keep supporting", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("upperArmR", { x: 0, y: 0, z: -1 }, 18);
    advance(f, 0.18);
    assert.ok(f.h.injury.armR > 0 && f.h.injury.armR < 0.25);
    assert.ok(f.h.body("pelvis").translation().y > 0.58);
    assert.notEqual(f.h.state, "down");
  } finally {
    f.world.free();
  }
});

test("leg hit creates temporary inhibition instead of instant binary disable", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("shinL", { x: 0, y: 0, z: -1 }, 18);
    assert.ok(f.h.injury.L > 0.1 && f.h.injury.L < 0.3);
    assert.ok(f.h.reaction.legStun.L > 0.6);
    advance(f, 0.16);
    assert.ok(f.h.body("pelvis").translation().y > 0.48);
    assert.ok(f.h.reaction.legStun.L < 1);
  } finally {
    f.world.free();
  }
});

test("head hit produces a distinct temporary head inhibition", () => {
  const f = fixture();
  try {
    advance(f, 2);
    f.h.hit("head", { x: 0, y: 0, z: -1 }, 14);
    assert.ok(f.h.reaction.headStun > 0.5);
    advance(f, 0.12);
    assert.ok(f.h.reaction.headStun > 0.35);
    assert.ok(f.h.body("pelvis").translation().y > 0.5);
    assert.ok(f.h.history.includes("react"));
  } finally {
    f.world.free();
  }
});
