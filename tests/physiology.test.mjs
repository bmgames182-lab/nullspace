import test from "node:test";
import assert from "node:assert/strict";
import { PhysiologyModel } from "../client/physiology.js";

function advance(model, seconds, dt = 1 / 120) {
  for (let t = 0; t < seconds; t += dt) model.update(dt);
}

test("extremity injury stays local instead of acting like global HP damage", () => {
  const p = new PhysiologyModel();
  const event = p.hit({
    part: "upperArmR",
    strength: 18,
    point: { x: 0.3, y: 1.45, z: 0 },
  });
  assert.equal(event.family, "arm");
  assert.ok(p.limbs.armR.structure < 1 || p.limbs.armR.nerve < 1);
  assert.equal(p.limbs.armL.structure, 1);
  assert.equal(p.limbs.legL.structure, 1);
  assert.equal(p.brainFunction, 1);
  assert.ok(p.consciousness > 0.8);
  assert.equal(p.dead, false);
});

test("ordinary torso trauma creates bleeding and stress without instant brain shutdown", () => {
  const p = new PhysiologyModel();
  const event = p.hit({
    part: "chest",
    strength: 18,
    point: { x: 0, y: 1.51, z: 0.12 },
  });
  assert.equal(event.family, "torso");
  assert.ok(p.bleedRate > 0);
  assert.ok(p.pain > 0);
  assert.equal(p.brainFunction, 1);
  assert.ok(p.consciousness > 0.7);
  assert.equal(event.immediateMotorLoss, false);
});

test("hemorrhage degrades physiology progressively rather than on the impact frame", () => {
  const p = new PhysiologyModel();
  for (let i = 0; i < 4; i++)
    p.hit({
      part: i % 2 ? "abdomen" : "chest",
      strength: 18,
      point: { x: 0.01 * i, y: 1.3 + i * 0.03, z: 0.1 },
    });
  const immediatelyAfter = p.bloodVolume;
  assert.ok(immediatelyAfter > 0.995, "impact itself should not delete a chunk of blood volume");
  advance(p, 20);
  assert.ok(p.bloodVolume < immediatelyAfter);
  assert.ok(p.perfusion < 1);
  assert.ok(p.motorDrive < 1);
});

test("head trauma affects CNS function while an equivalent arm hit does not", () => {
  const head = new PhysiologyModel();
  const arm = new PhysiologyModel();
  head.hit({ part: "head", strength: 18, point: { x: 0, y: 1.84, z: 0.1 } });
  arm.hit({ part: "upperArmR", strength: 18, point: { x: 0.3, y: 1.45, z: 0 } });
  assert.ok(head.brainFunction < 1);
  assert.equal(arm.brainFunction, 1);
  assert.ok(head.cnsShock > arm.cnsShock);
});

test("repeat hits accumulate local structural and neurological deficits", () => {
  const p = new PhysiologyModel();
  const before = p.localLimbCapacity("leg", "L");
  p.hit({ part: "shinL", strength: 18, point: { x: -0.13, y: 0.28, z: 0 } });
  const afterOne = p.localLimbCapacity("leg", "L");
  p.hit({ part: "shinL", strength: 18, point: { x: -0.13, y: 0.3, z: 0.02 } });
  const afterTwo = p.localLimbCapacity("leg", "L");
  assert.ok(afterOne < before);
  assert.ok(afterTwo < afterOne);
  assert.equal(p.localLimbCapacity("leg", "R"), 1);
});
