import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { BiologicalArtagdollHumanV15 } from "../client/biological_human_v15.js";

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
  return { world, h: new BiologicalArtagdollHumanV15(world, new THREE.Scene()) };
}

function advance(f, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    f.h.update(DT);
    f.world.step();
  }
}

test("V15 emergency balance states actually unlatch back to stable", () => {
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
    f.world.free();
  }
});

test("three light chest hits recover instead of inheriting a stale scramble state", () => {
  const f = fixture();
  try {
    advance(f, 2.2);
    for (let n = 0; n < 3; n++) {
      const chest = f.h.body("chest");
      f.h.hit("chest", { x: 0, y: 0, z: -1 }, 8, chest.translation());
      advance(f, 0.14);
    }
    advance(f, 4.0);
    assert.equal(f.h.physiology.unconscious, false);
    assert.equal(f.h.passiveHandoff, false);
    assert.ok(!["collapse", "down", "limp"].includes(f.h.state), `light hits ended in ${f.h.state}`);
    assert.ok(f.h.body("pelvis").translation().y > 0.7, `pelvis should recover (${f.h.body("pelvis").translation().y.toFixed(3)})`);
    assert.equal(f.h.balanceSnapshot().state, "stable");
  } finally {
    f.world.free();
  }
});
