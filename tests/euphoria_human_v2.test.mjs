import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { EuphoriaHuman } from "../client/human2/euphoria_human.js";

await RAPIER.init();
const DT = 1 / 240;
const vec = (p) => new THREE.Vector3(p.x, p.y, p.z);

function fixture() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 12;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.1, 20).setTranslation(0, -0.1, 0).setFriction(1));
  return { world, h: new EuphoriaHuman(world, new THREE.Scene()) };
}
function advance(f, seconds, sample) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    f.h.update(DT); f.world.step(); sample?.(f.h, i * DT);
    for (const { rb } of f.h.parts.values()) {
      const p = rb.translation(), lv = rb.linvel(), av = rb.angvel();
      assert.ok([p.x,p.y,p.z,lv.x,lv.y,lv.z,av.x,av.y,av.z].every(Number.isFinite));
      assert.ok(Math.hypot(lv.x, lv.y, lv.z) < 15, "body segment numerically launched");
    }
  }
}
function assertUprightPosture(h, label = "human") {
  const pelvis = h.body("pelvis").translation();
  const abdomen = h.body("abdomen").translation();
  const chest = h.body("chest").translation();
  const head = h.body("head").translation();
  assert.ok(pelvis.y > 0.76, `${label}: pelvis too low (${pelvis.y.toFixed(3)})`);
  assert.ok(abdomen.y > pelvis.y + 0.12, `${label}: abdomen folded below pelvis (${abdomen.y.toFixed(3)} vs ${pelvis.y.toFixed(3)})`);
  assert.ok(chest.y > pelvis.y + 0.34, `${label}: chest folded down (${chest.y.toFixed(3)} vs pelvis ${pelvis.y.toFixed(3)})`);
  assert.ok(chest.y > abdomen.y + 0.12, `${label}: upper spine folded (${chest.y.toFixed(3)} vs abdomen ${abdomen.y.toFixed(3)})`);
  assert.ok(head.y > chest.y + 0.2, `${label}: head not anatomically above chest (${head.y.toFixed(3)} vs ${chest.y.toFixed(3)})`);
}
function settle(f) { advance(f, 2.4); assertUprightPosture(f.h, "settled human"); }
function disturb(f, part, impulse, offset = { x: 0, y: 0, z: 0 }) { const rb = f.h.body(part), p = vec(rb.translation()).add(new THREE.Vector3(offset.x, offset.y, offset.z)); rb.applyImpulseAtPoint(impulse, p, true); }

test("clean human stands anatomically upright for 30 seconds with a real support polygon", () => {
  const f = fixture(); try {
    let max = 0;
    advance(f, 30, (h) => { const p = h.body("pelvis").linvel(); max = Math.max(max, Math.hypot(p.x,p.y,p.z)); });
    assertUprightPosture(f.h, "30 s idle human");
    assert.equal(f.h.passiveHandoff, false);
    assert.ok(f.h.balanceSnapshot().supportPolygon.length >= 4);
    assert.ok(max < 1.4, `idle chatter ${max.toFixed(2)}`);
    assert.ok(f.h.metrics.steps <= 3, `idle human should not pace to stay alive (${f.h.metrics.steps} recovery steps)`);
  } finally { f.world.free(); }
});

test("chest shot is local first, not impact-frame ragdoll", () => {
  const f = fixture(); try { settle(f); const c0 = vec(f.h.body("chest").translation()), p0 = vec(f.h.body("pelvis").translation()), point = vec(f.h.body("chest").translation()); f.h.hit("chest", { x: 0, y: 0, z: -1 }, 18, point); advance(f, 0.1); const cm = vec(f.h.body("chest").translation()).distanceTo(c0), pm = vec(f.h.body("pelvis").translation()).distanceTo(p0); assert.ok(cm > pm * 0.7, `chest should lead pelvis (${cm.toFixed(3)} vs ${pm.toFixed(3)})`); assert.ok(f.h.body("pelvis").translation().y > 0.72); assert.equal(f.h.passiveHandoff, false); assert.notEqual(f.h.balance.state, "passive"); advance(f, 0.7); const wound = f.h.woundWorld(); const nearest = Math.min(vec(f.h.body("handL").translation()).distanceTo(wound), vec(f.h.body("handR").translation()).distanceTo(wound)); assert.ok(nearest < 0.62, `protective hand should seek wound (${nearest.toFixed(2)}m)`); } finally { f.world.free(); }
});

test("medium shove yields locally without forcing an unnecessary recovery step", () => {
  const f = fixture(); try {
    settle(f);
    const start = vec(f.h.body("pelvis").translation()), chestStart = vec(f.h.body("chest").translation());
    let risk = 0, pelvisDisplacement = 0, chestDisplacement = 0, footSpeed = 0;
    disturb(f, "chest", new THREE.Vector3(5.2,0,0), { x:0,y:0.12,z:0 });
    advance(f, 2.5, (h) => {
      risk = Math.max(risk, h.balance.risk);
      pelvisDisplacement = Math.max(pelvisDisplacement, vec(h.body("pelvis").translation()).distanceTo(start));
      chestDisplacement = Math.max(chestDisplacement, vec(h.body("chest").translation()).distanceTo(chestStart));
      if (h.step.phase !== "idle") footSpeed = Math.max(footSpeed, vec(h.body("foot" + h.step.side).linvel()).sub(vec(h.body("pelvis").linvel())).length());
    });
    const metrics = `risk=${risk.toFixed(3)} pelvis=${pelvisDisplacement.toFixed(3)} chest=${chestDisplacement.toFixed(3)} steps=${f.h.metrics.steps} foot=${footSpeed.toFixed(3)}`;
    assert.ok(risk > 0.18, metrics);
    assert.ok(chestDisplacement > 0.04, `struck torso should visibly yield; ${metrics}`);
    assert.ok(pelvisDisplacement > 0.012, `stance should not be perfectly pinned; ${metrics}`);
    assert.ok(chestDisplacement > pelvisDisplacement * 1.45, `local torso response should lead whole-body translation; ${metrics}`);
    if (footSpeed > 0) assert.ok(footSpeed < 2.5, `swing foot too fast; ${metrics}`);
    assert.equal(f.h.passiveHandoff, false);
    assert.ok(f.h.body("pelvis").translation().y > 0.72, `medium shove should remain recoverable; ${metrics}`);
  } finally { f.world.free(); }
});

test("arm shot stays mostly local", () => {
  const f = fixture(); try { settle(f); const p0 = vec(f.h.body("pelvis").translation()); f.h.hit("upperArmR", {x:1,y:0,z:0}, 18, f.h.body("upperArmR").translation()); advance(f, 0.75); assert.ok(vec(f.h.body("pelvis").translation()).distanceTo(p0) < 0.5); assert.ok(f.h.body("pelvis").translation().y > 0.62); assert.equal(f.h.physiology.unconscious, false); assert.equal(f.h.passiveHandoff, false); } finally { f.world.free(); }
});

test("leg shot reduces local capacity and can recover without torso-first limp", () => {
  const f = fixture(); try { settle(f); const before = f.h.physiology.localLimbCapacity("leg", "L"); f.h.hit("shinL", {x:0,y:0,z:-1}, 18, f.h.body("shinL").translation()); advance(f, 0.5); const after = f.h.physiology.localLimbCapacity("leg", "L"); assert.ok(after < before, `local leg capacity should fall after injury (${before.toFixed(3)} -> ${after.toFixed(3)})`); assert.ok(f.h.body("pelvis").translation().y > 0.5); assert.equal(f.h.physiology.unconscious, false); assert.equal(f.h.passiveHandoff, false); } finally { f.world.free(); }
});

test("moderate head shot can daze without switching off both legs", () => {
  const f = fixture(); try { settle(f); f.h.hit("head", {x:0,y:0,z:-1}, 14, f.h.body("head").translation()); advance(f, 0.8); assert.equal(f.h.physiology.unconscious, false); assert.equal(f.h.passiveHandoff, false); assert.ok(f.h.body("pelvis").translation().y > 0.58); assert.ok(f.h.controlDrive() > 0.2); } finally { f.world.free(); }
});

test("large shove attempts recovery before any passive fall", () => {
  for (const impulse of [new THREE.Vector3(0,0,-8.5), new THREE.Vector3(0,0,8.5), new THREE.Vector3(8.5,0,0)]) { const f = fixture(); try { settle(f); const before = f.h.metrics.steps; disturb(f,"chest",impulse,{x:0,y:0.16,z:0.04}); advance(f,0.7); assert.equal(f.h.physiology.unconscious,false); assert.equal(f.h.passiveHandoff,false); assert.ok(f.h.metrics.steps > before || f.h.balance.risk > 0.55); assert.ok(f.h.controlDrive() > 0.2); } finally { f.world.free(); } }
});