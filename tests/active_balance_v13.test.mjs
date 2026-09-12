import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { BiologicalArtagdollHumanV14 } from "../client/biological_human_v14.js";

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
  return { world, h: new BiologicalArtagdollHumanV14(world, new THREE.Scene()) };
}

function advance(f, seconds, sample) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    f.h.update(DT);
    f.world.step();
    sample?.(f.h, i * DT);
    for (const { rb } of f.h.parts.values()) {
      const p = rb.translation();
      const lv = rb.linvel();
      const av = rb.angvel();
      assert.ok(Number.isFinite(p.x + p.y + p.z + lv.x + lv.y + lv.z + av.x + av.y + av.z));
      assert.ok(Math.hypot(lv.x, lv.y, lv.z) < 15, "body must not numerically launch");
    }
  }
}

function disturb(f, part, impulse, offset = { x: 0, y: 0, z: 0 }) {
  const rb = f.h.body(part);
  const p = vec(rb.translation()).add(new THREE.Vector3(offset.x, offset.y, offset.z));
  rb.applyImpulseAtPoint(impulse, p, true);
}

function settle(f) {
  advance(f, 2.2);
  assert.ok(f.h.body("pelvis").translation().y > 0.82);
}

test("V14 stands indefinitely without becoming a rigid statue", () => {
  const f = fixture();
  try {
    let maxSpeed = 0;
    advance(f, 30, (h) => {
      const v = h.body("pelvis").linvel();
      maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y, v.z));
    });
    assert.ok(f.h.body("pelvis").translation().y > 0.82);
    assert.ok(!["collapse", "down", "limp"].includes(f.h.state));
    assert.ok(f.h.balanceSnapshot().supportPolygon.length >= 4);
    assert.ok(maxSpeed < 1.2, `quiet standing should not chatter (${maxSpeed.toFixed(2)} m/s)`);
  } finally {
    f.world.free();
  }
});

test("small front/back/side shoves are absorbed without a floor collapse", () => {
  const directions = [
    new THREE.Vector3(0, 0, -2.2),
    new THREE.Vector3(0, 0, 2.2),
    new THREE.Vector3(2.2, 0, 0),
    new THREE.Vector3(-2.2, 0, 0),
  ];
  for (const impulse of directions) {
    const f = fixture();
    try {
      settle(f);
      disturb(f, "chest", impulse, { x: 0, y: 0.08, z: 0 });
      advance(f, 2.4);
      assert.equal(f.h.physiology.unconscious, false);
      assert.ok(f.h.body("pelvis").translation().y > 0.63);
      assert.ok(!["collapse", "down", "limp"].includes(f.h.state));
      assert.ok(f.h.balanceSnapshot().state !== "passive");
    } finally {
      f.world.free();
    }
  }
});

test("medium shove produces visible COM recovery and at least one finite recovery step", () => {
  const f = fixture();
  try {
    settle(f);
    const before = f.h.metrics.steps;
    let maxRisk = 0;
    let maxDisplacement = 0;
    const start = vec(f.h.body("pelvis").translation());
    disturb(f, "chest", new THREE.Vector3(5.2, 0, 0), { x: 0, y: 0.12, z: 0 });
    advance(f, 2.7, (h) => {
      maxRisk = Math.max(maxRisk, h.balanceSnapshot()?.risk ?? 0);
      maxDisplacement = Math.max(maxDisplacement, vec(h.body("pelvis").translation()).distanceTo(start));
    });
    assert.ok(maxRisk > 0.18, "controller should register a real disturbance");
    assert.ok(maxDisplacement > 0.08, "body should visibly yield instead of staying statue-stiff");
    assert.ok(f.h.metrics.steps > before, "medium shove should use a physical recovery step");
    assert.ok(f.h.body("pelvis").translation().y > 0.58);
  } finally {
    f.world.free();
  }
});

test("pelvis/thigh/arm pulls propagate locally before whole-body correction", () => {
  for (const part of ["pelvis", "thighL", "upperArmR"]) {
    const f = fixture();
    try {
      settle(f);
      const pelvis0 = vec(f.h.body("pelvis").translation());
      const local0 = vec(f.h.body(part).translation());
      disturb(f, part, new THREE.Vector3(4.6, 0, 0));
      advance(f, 0.18);
      const pelvisMove = vec(f.h.body("pelvis").translation()).distanceTo(pelvis0);
      const localMove = vec(f.h.body(part).translation()).distanceTo(local0);
      if (part !== "pelvis") assert.ok(localMove >= pelvisMove * 0.65, `${part} should move locally before the torso catches up`);
      assert.ok(f.h.body("pelvis").translation().y > 0.62, `${part} pull must not cause impact-frame collapse`);
      advance(f, 1.8);
      assert.equal(f.h.physiology.unconscious, false);
    } finally {
      f.world.free();
    }
  }
});

test("repeated disturbances and a second shove during a step stay bounded", () => {
  const f = fixture();
  try {
    settle(f);
    let maxFootRelativeSpeed = 0;
    for (let n = 0; n < 4; n++) {
      disturb(f, "chest", new THREE.Vector3(n % 2 ? -2.7 : 2.7, 0, n % 2 ? 0.8 : -0.8));
      advance(f, 0.38, (h) => {
        if (h.step.phase !== "idle") {
          const foot = h.body("foot" + h.step.side);
          const pelvis = h.body("pelvis");
          maxFootRelativeSpeed = Math.max(
            maxFootRelativeSpeed,
            vec(foot.linvel()).sub(vec(pelvis.linvel())).length(),
          );
        }
      });
    }
    advance(f, 2.2);
    assert.ok(maxFootRelativeSpeed < 3.2, `swing feet must stay physically bounded (${maxFootRelativeSpeed.toFixed(2)} m/s)`);
    assert.equal(f.h.physiology.unconscious, false);
    assert.ok(f.h.body("pelvis").translation().y > 0.5);
  } finally {
    f.world.free();
  }
});

test("large forward/back/side disturbances attempt recovery before passive fall", () => {
  const impulses = [
    new THREE.Vector3(0, 0, -8.5),
    new THREE.Vector3(0, 0, 8.5),
    new THREE.Vector3(8.5, 0, 0),
  ];
  for (const impulse of impulses) {
    const f = fixture();
    try {
      settle(f);
      const before = f.h.metrics.steps;
      disturb(f, "chest", impulse, { x: 0, y: 0.16, z: 0.04 });
      advance(f, 0.65);
      assert.equal(f.h.passiveHandoff, false, "external shove must not instant-switch to passive ragdoll");
      assert.equal(f.h.physiology.unconscious, false);
      assert.ok(f.h.metrics.steps > before || f.h.balanceSnapshot().risk > 0.55, "large shove should create a recovery attempt or critical imbalance");
      assert.ok(f.h.controlDrive() > 0.2, "muscles should fade progressively rather than switch off on impact");
      advance(f, 1.8);
      assert.ok(!f.h.dead);
    } finally {
      f.world.free();
    }
  }
});
