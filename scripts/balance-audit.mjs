import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { BiologicalArtagdollHumanV13 } from "../client/biological_human_v13.js";

await RAPIER.init();
const DT = 1 / 240;
const outDir = new URL("../test-results/balance-audit/", import.meta.url);
await mkdir(outDir, { recursive: true });
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
  return { world, h: new BiologicalArtagdollHumanV13(world, new THREE.Scene()) };
}

function impulse(h, part, xyz, offset = [0, 0, 0]) {
  const rb = h.body(part);
  const p = vec(rb.translation()).add(new THREE.Vector3(...offset));
  rb.applyImpulseAtPoint(new THREE.Vector3(...xyz), p, true);
}

function telemetry(h) {
  const b = h.balanceSnapshot();
  return {
    age: h.age,
    state: h.state,
    balanceState: b?.state,
    risk: b?.risk ?? 0,
    pelvisY: h.body("pelvis").translation().y,
    chestY: h.body("chest").translation().y,
    pelvisVelocity: h.body("pelvis").linvel(),
    steps: h.metrics.steps,
    plants: h.metrics.plants,
    stepPhase: h.step.phase,
    recoveryFoot: b?.recoveryFoot,
    passive: h.passiveHandoff,
    unconscious: h.physiology?.unconscious ?? false,
    supportPoints: b?.supportPolygon?.length ?? 0,
    drive: h.controlDrive(),
  };
}

function simulate(f, seconds, stats) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    f.h.update(DT);
    f.world.step();
    const t = telemetry(f.h);
    stats.minPelvisY = Math.min(stats.minPelvisY, t.pelvisY);
    stats.maxRisk = Math.max(stats.maxRisk, t.risk);
    stats.maxPelvisSpeed = Math.max(stats.maxPelvisSpeed, Math.hypot(t.pelvisVelocity.x, t.pelvisVelocity.y, t.pelvisVelocity.z));
    if (f.h.step.phase !== "idle") {
      const foot = f.h.body("foot" + f.h.step.side);
      const rel = vec(foot.linvel()).sub(vec(f.h.body("pelvis").linvel())).length();
      stats.maxSwingFootSpeed = Math.max(stats.maxSwingFootSpeed, rel);
    }
    for (const { rb } of f.h.parts.values()) {
      const p = rb.translation();
      const lv = rb.linvel();
      assert.ok(Number.isFinite(p.x + p.y + p.z + lv.x + lv.y + lv.z));
    }
  }
}

function freshStats(name) {
  return {
    name,
    minPelvisY: Infinity,
    maxRisk: 0,
    maxPelvisSpeed: 0,
    maxSwingFootSpeed: 0,
    startSteps: 0,
    endSteps: 0,
    final: null,
  };
}

async function run(name, action, seconds = 3.0, settle = 2.2) {
  const f = fixture();
  const stats = freshStats(name);
  try {
    simulate(f, settle, stats);
    stats.startSteps = f.h.metrics.steps;
    await action(f, stats);
    simulate(f, seconds, stats);
    stats.endSteps = f.h.metrics.steps;
    stats.final = telemetry(f.h);
    return stats;
  } finally {
    f.world.free();
  }
}

const scenarios = [
  ["01-standing-long", async () => {}, 12],
  ["02-small-front", async ({ h }) => impulse(h, "chest", [0, 0, -2.2])],
  ["03-small-back", async ({ h }) => impulse(h, "chest", [0, 0, 2.2])],
  ["04-small-side", async ({ h }) => impulse(h, "chest", [2.2, 0, 0])],
  ["05-medium-shove", async ({ h }) => impulse(h, "chest", [5.0, 0, 0], [0, 0.1, 0])],
  ["06-strong-shove", async ({ h }) => impulse(h, "chest", [8.5, 0, -1], [0, 0.14, 0])],
  ["07-pull-pelvis-sideways", async ({ h }) => impulse(h, "pelvis", [6.0, 0, 0])],
  ["08-pull-left-thigh", async ({ h }) => impulse(h, "thighL", [5.0, 0, 0])],
  ["09-pull-right-arm", async ({ h }) => impulse(h, "upperArmR", [4.8, 0, 0])],
  ["10-push-chest", async ({ h }) => impulse(h, "chest", [0, 0, -5.2], [0.08, 0.08, 0])],
  ["11-push-during-step", async (f, stats) => {
    impulse(f.h, "chest", [5.0, 0, 0]);
    for (let i = 0; i < Math.round(0.7 / DT); i++) {
      f.h.update(DT);
      f.world.step();
      if (f.h.step.phase !== "idle") break;
    }
    impulse(f.h, "chest", [-2.8, 0, -1.0]);
  }],
  ["12-repeated-disturbances", async (f, stats) => {
    for (let n = 0; n < 4; n++) {
      impulse(f.h, "chest", [n % 2 ? -2.5 : 2.5, 0, n % 2 ? 0.6 : -0.6]);
      simulate(f, 0.34, stats);
    }
  }],
  ["13-imperfect-stance", async (f, stats) => {
    impulse(f.h, "footL", [-0.75, 0, 0.35]);
    simulate(f, 0.55, stats);
    impulse(f.h, "chest", [2.8, 0, 0]);
  }],
  ["14-fall-forward", async ({ h }) => {
    impulse(h, "chest", [0, 0, -10.5], [0, 0.17, 0.08]);
    h.body("chest").applyTorqueImpulse({ x: -1.1, y: 0, z: 0 }, true);
  }, 4],
  ["15-fall-backward", async ({ h }) => {
    impulse(h, "chest", [0, 0, 10.5], [0, 0.17, -0.08]);
    h.body("chest").applyTorqueImpulse({ x: 1.1, y: 0, z: 0 }, true);
  }, 4],
  ["16-fall-sideways", async ({ h }) => {
    impulse(h, "chest", [10.5, 0, 0], [0.08, 0.17, 0]);
    h.body("chest").applyTorqueImpulse({ x: 0, y: 0, z: -1.1 }, true);
  }, 4],
];

const report = [];
for (const [name, action, seconds = 3] of scenarios) {
  const result = await run(name, action, seconds);
  report.push(result);

  // Guard rails, not choreography assertions: small disturbances must stay up;
  // large disturbances may save themselves or fall, but cannot instantly become
  // a passive/dead body simply because an external force was applied.
  if (/standing|small-/.test(name)) {
    assert.ok(result.final.pelvisY > 0.62, `${name}: tiny disturbance caused collapse`);
    assert.ok(!["collapse", "down", "limp"].includes(result.final.state), `${name}: tiny disturbance ended down`);
  }
  if (!/fall-/.test(name)) assert.equal(result.final.unconscious, false, `${name}: mechanics disturbance should not cause fake unconsciousness`);
  assert.equal(result.final.passive, false, `${name}: external disturbance must not instant-switch to passive ragdoll`);
  assert.ok(result.maxSwingFootSpeed < 3.5, `${name}: recovery foot moved implausibly fast (${result.maxSwingFootSpeed.toFixed(2)} m/s)`);
}

await writeFile(
  new URL("report.json", outDir),
  JSON.stringify({ generatedAt: new Date().toISOString(), controller: "V13", scenarios: report }, null, 2),
);
console.log("Balance audit passed: 16 disturbance/fall scenarios simulated with bounded active-ragdoll recovery.");
