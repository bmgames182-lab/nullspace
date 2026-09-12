import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { BiologicalArtagdollHumanV23 } from "../client/biological_human_v23.js";

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
  return { world, h: new BiologicalArtagdollHumanV23(world, new THREE.Scene()) };
}

function advance(f, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    f.h.update(DT);
    f.world.step();
  }
}

test("V23 arm-only floor brace at standing height does not start ground writhing", () => {
  const f = fixture();
  try {
    advance(f, 2.2);
    assert.ok(f.h.body("pelvis").translation().y > 0.78);
    assert.ok(f.h.body("chest").translation().y > 1.15);

    f.h.trauma.active = true;
    f.h.trauma.mode = "calm";
    f.h.trauma.age = 2;
    f.h.trauma.groundActive = false;
    f.h.hitReaction.setPhase("kneel");
    f.h.state = "brace";

    const originalContact = f.h.contact.bind(f.h);
    f.h.contact = (name) => name === "upperArmL";
    f.h.maybeStartGroundReaction();
    assert.equal(f.h.trauma.groundActive, false, "a bracing arm alone must not relabel a standing body as grounded");

    f.h.contact = (name) => name === "chest";
    f.h.maybeStartGroundReaction();
    assert.equal(f.h.trauma.groundActive, true, "real torso floor contact should start conscious ground coping");
    assert.equal(f.h.hitReaction.phase, "groundPanic");

    f.h.contact = originalContact;
  } finally {
    f.h.destroy();
    f.world.free();
  }
});
