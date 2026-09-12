import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { ActiveHuman } from "../active_human.js";
import { PhysiologyModel, familyOf, sideOf } from "../physiology.js";
import { MotorController, MOTOR_PROFILES } from "./motor_controller.js";
import { StepPlanner } from "./step_planner.js";
import { BalanceController } from "./balance_controller.js";
import { ReactionController } from "./reaction_controller.js";
import { GroundBehavior } from "./ground_behavior.js";
import { BraceController } from "./brace_controller.js";

const clamp = THREE.MathUtils.clamp;
const v = (p) => new THREE.Vector3(p.x, p.y, p.z);
const ID = () => new THREE.Quaternion();
const GROUP = (0x0002 << 16) | 0x0003;

const MOTOR_JOINTS = [
  ["pelvis", "abdomen", "abdomen", "spineLower"], ["abdomen", "chest", "chest", "spineUpper"], ["chest", "head", "head", "neck"],
  ["chest", "upperArmL", "upperArmL", "shoulder"], ["chest", "upperArmR", "upperArmR", "shoulder"],
  ["upperArmL", "lowerArmL", "lowerArmL", "elbow"], ["upperArmR", "lowerArmR", "lowerArmR", "elbow"],
  ["lowerArmL", "handL", "handL", "wrist"], ["lowerArmR", "handR", "handR", "wrist"],
  ["pelvis", "thighL", "thighL", "hip"], ["pelvis", "thighR", "thighR", "hip"],
  ["thighL", "shinL", "shinL", "knee"], ["thighR", "shinR", "shinR", "knee"],
  ["shinL", "footL", "footL", "ankle"], ["shinR", "footR", "footR", "ankle"],
];
const Y = new THREE.Vector3(0, 1, 0);
const SOFT_LIMITS = [
  ["pelvis", "abdomen", { axis: Y, swingMax: 0.5, twistMin: -0.34, twistMax: 0.34, kp: 58, kd: 6.5, maxTorque: 40 }],
  ["abdomen", "chest", { axis: Y, swingMax: 0.48, twistMin: -0.4, twistMax: 0.4, kp: 54, kd: 6.2, maxTorque: 38 }],
  ["chest", "head", { axis: Y, swingMax: 0.68, twistMin: -0.78, twistMax: 0.78, kp: 20, kd: 3.1, maxTorque: 16 }],
  ["chest", "upperArmL", { axis: Y, swingMax: 1.72, twistMin: -1.05, twistMax: 1.05, kp: 24, kd: 3.5, maxTorque: 20 }],
  ["chest", "upperArmR", { axis: Y, swingMax: 1.72, twistMin: -1.05, twistMax: 1.05, kp: 24, kd: 3.5, maxTorque: 20 }],
  ["pelvis", "thighL", { axis: Y, swingMax: 1.36, twistMin: -0.58, twistMax: 0.58, kp: 62, kd: 7, maxTorque: 48 }],
  ["pelvis", "thighR", { axis: Y, swingMax: 1.36, twistMin: -0.58, twistMax: 0.58, kp: 62, kd: 7, maxTorque: 48 }],
  ["lowerArmL", "handL", { axis: Y, swingMax: 0.62, twistMin: -0.5, twistMax: 0.5, kp: 9, kd: 1.6, maxTorque: 7 }],
  ["lowerArmR", "handR", { axis: Y, swingMax: 0.62, twistMin: -0.5, twistMax: 0.5, kp: 9, kd: 1.6, maxTorque: 7 }],
];

export class EuphoriaHuman extends ActiveHuman {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.addPhysicalHands();
    this.controllerStyle = "euphoria-human-v2-clean-physics";
    this.state = "balance"; this.stateTime = 0; this.history = ["balance"]; this.age = 0; this.hitAge = 99; this.dead = false; this.passiveHandoff = false; this.lastStepSide = "R";
    this.physiology = new PhysiologyModel();
    this.injury = { L: 0, R: 0, armL: 0, armR: 0 };
    this.feet = { L: { quality: 0, anchor: v(this.body("footL").translation()) }, R: { quality: 0, anchor: v(this.body("footR").translation()) } };
    this.metrics = { steps: 0, plants: 0, maxForce: 0, maxTorque: 0, activeImpulse: 0 };
    this.mass = 0; for (const { rb } of this.parts.values()) this.mass += rb.mass();
    this.reaction = { age: 99, strength: 0, part: null, family: null, side: null, dir: new THREE.Vector3(0, 0, -1), point: new THREE.Vector3(), headStun: 0 };
    this.motor = new MotorController(this); this.steps = new StepPlanner(this); this.balance = new BalanceController(this); this.reactions = new ReactionController(this); this.groundBehavior = new GroundBehavior(this); this.bracing = new BraceController(this);
    this._debugPanel = this._debugKey = null; this.installDebug(); this.sync();
  }

  addPhysicalHands() {
    if (this.parts.has("handL")) return;
    const skin = new THREE.MeshStandardMaterial({ color: 0x9b7159, roughness: 0.9 });
    for (const side of ["L", "R"]) {
      const lower = this.parts.get("lowerArm" + side);
      for (const child of [...lower.mesh.children]) { lower.mesh.remove(child); child.geometry?.dispose?.(); }
      const lp = v(lower.rb.translation()), hp = lp.clone().add(new THREE.Vector3(0, -0.235, 0));
      const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(hp.x, hp.y, hp.z).setLinearDamping(0.07).setAngularDamping(0.22).setCcdEnabled(true).setAdditionalSolverIterations(4));
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.055, 0.075, 0.04).setMass(0.28).setFriction(1.08).setRestitution(0.001).setCollisionGroups(GROUP), rb);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, 0.08), skin); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.part = "hand" + side; this.scene.add(mesh); this.parts.set("hand" + side, { rb, mesh, collider }); this.hitMeshes.push(mesh);
      const joint = this.world.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: -0.205, z: 0 }, { x: 0, y: 0.075, z: 0 }), lower.rb, rb, true); try { joint?.setContactsEnabled?.(false); } catch {} if (joint) this.joints.push(joint);
    }
  }

  installDebug() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const panel = document.createElement("div"); panel.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:40;display:none;padding:9px 11px;background:rgba(0,0,0,.74);color:#d9f7ff;font:12px/1.35 monospace;white-space:pre;pointer-events:none;border:1px solid rgba(180,235,255,.25);border-radius:6px"; document.body.appendChild(panel); this._debugPanel = panel;
    this._debugKey = (e) => { if (e.code !== "F3") return; e.preventDefault(); panel.style.display = this.balance.toggleDebug() ? "block" : "none"; }; window.addEventListener("keydown", this._debugKey);
  }
  updateDebugPanel() {
    if (!this._debugPanel || !this.balance.debugEnabled) return; const b = this.balance.snapshot(), pv = this.body("pelvis").linvel(), g = this.groundBehavior.snapshot();
    this._debugPanel.textContent = `EUPHORIA HUMAN V2  [F3]\nbalance:${b.state} risk:${b.risk.toFixed(2)} drive:${this.controlDrive().toFixed(2)}\nCOM:${b.com.x.toFixed(2)},${b.com.y.toFixed(2)},${b.com.z.toFixed(2)} pred:${b.predictedCom.x.toFixed(2)},${b.predictedCom.z.toFixed(2)}\nsupport:${b.supportPolygon.length} outside:${Number.isFinite(b.outside) ? b.outside.toFixed(3) : "inf"}\npelvis v:${pv.x.toFixed(2)},${pv.y.toFixed(2)},${pv.z.toFixed(2)} recovery:${b.recoveryFoot ?? "-"}\nstep:${this.step.phase === "idle" ? "none" : `${this.step.side}:${this.step.phase}`} ground:${g.intent}`;
  }

  legCapacity(side) { return this.physiology?.limbCapacity?.("leg", side) ?? 1; }
  armCapacity(side) { return this.physiology?.limbCapacity?.("arm", side) ?? 1; }
  refreshCompatibilityInjury() { const p = this.physiology; this.injury.L = 1 - p.localLimbCapacity("leg", "L"); this.injury.R = 1 - p.localLimbCapacity("leg", "R"); this.injury.armL = 1 - p.localLimbCapacity("arm", "L"); this.injury.armR = 1 - p.localLimbCapacity("arm", "R"); }
  controlDrive() { if (this.dead) return 0; if (this.physiology?.unconscious || this.passiveHandoff) return 0.015; let d = clamp(this.physiology?.motorDrive ?? 1, 0, 1) * (this.balance?.muscleScale?.() ?? 1); if (this.balance?.state === "downed") d *= this.groundBehavior?.driveScale?.() ?? 0.35; return clamp(d, 0.03, 1); }
  startRecoveryStep(target, side, urgency) { return this.steps.request(target, side, urgency); }

  pullHandTo(side, point, strength, dt) {
    const hand = this.body("hand" + side), chest = this.body("chest"); if (!hand || !chest) return;
    const rel = v(hand.linvel()).sub(v(chest.linvel())), error = point.clone().sub(v(hand.translation())), distance = error.length();
    const force = error.multiplyScalar(62 + strength * 48).addScaledVector(rel, -(8 + strength * 7)); const capacity = this.armCapacity(side) * this.reactions.motorScale("hand" + side);
    this.forcePair(hand, chest, force, (42 + strength * 55) * Math.max(0.18, capacity), dt); if (distance > 0.95) this.forcePair(hand, chest, rel.clone().multiplyScalar(-12), 28, dt);
  }

  hit(part, dir, strength = 12, point) {
    const rb = this.body(part) || this.body("chest"), direction = v(dir); if (!rb || direction.lengthSq() < 1e-9) return null; direction.normalize(); const hitPoint = v(point || rb.translation());
    const event = this.physiology.hit({ part, strength, point: hitPoint }), family = event?.family || familyOf(part);
    const scale = family === "torso" ? 0.18 : family === "head" ? 0.15 : family === "leg" ? 0.13 : family === "arm" ? 0.11 : 0.13;
    rb.applyImpulseAtPoint(direction.clone().multiplyScalar(clamp(strength, 0, 28) * scale), hitPoint, true);
    this.hitAge = 0; this.lastHit = { part, dir: direction.clone(), point: hitPoint.clone() }; this.reactions.onHit(part, direction, strength, hitPoint, event);
    Object.assign(this.reaction, { age: 0, strength: clamp(strength / 18, 0, 1.6), part, family, side: event?.side || sideOf(part), headStun: family === "head" ? clamp(event?.motorShock ?? 0, 0, 1) : 0 }); this.reaction.dir.copy(direction); this.reaction.point.copy(hitPoint);
    const whole = family === "torso" ? 0.42 : family === "head" ? 0.28 : family === "leg" ? 0.2 : 0.11; this.balance.registerDisturbance(direction, clamp((strength / 18) * whole, 0, 0.78));
    this.passiveHandoff = !!event?.immediateMotorLoss; this.dead = !!this.physiology.dead; this.refreshCompatibilityInjury(); return event;
  }

  makeTargets() {
    const t = { abdomen: ID(), chest: ID(), head: ID(), upperArmL: ID(), upperArmR: ID(), lowerArmL: ID(), lowerArmR: ID(), handL: ID(), handR: ID(), thighL: ID(), thighR: ID(), shinL: ID(), shinR: ID(), footL: ID(), footR: ID() };
    if (!["downed", "passive"].includes(this.balance.state)) for (const side of ["L", "R"]) this.legTargets(side, this.steps.targetFor(side), t);
    return t;
  }
  strengthFor(name) { let s = this.controlDrive() * this.reactions.motorScale(name); const side = name.endsWith("L") ? "L" : name.endsWith("R") ? "R" : null; if (side && /upperArm|lowerArm|hand/.test(name)) s *= this.armCapacity(side); if (side && /thigh|shin|foot/.test(name)) s *= this.legCapacity(side); if (name === "head") s *= clamp(this.physiology?.coordination ?? 1, 0.22, 1); return clamp(s, 0, 1); }
  applyMotors(targets, dt) { for (const [a, b, limit] of SOFT_LIMITS) this.motor.applySwingTwistLimit(this.body(a), this.body(b), limit, dt); for (const [a, b, target, profile] of MOTOR_JOINTS) this.motor.drive(this.body(a), this.body(b), targets[target] || ID(), MOTOR_PROFILES[profile], this.strengthFor(b), dt); }
  mapState() { const n = this.balance.state === "stable" ? "balance" : ["disturbed", "recovering", "stumbling"].includes(this.balance.state) ? "stumble" : ["critical", "falling"].includes(this.balance.state) ? "brace" : this.balance.state === "downed" ? "down" : "limp"; if (n !== this.state) { this.state = n; this.stateTime = 0; this.history.push(n); if (this.history.length > 64) this.history.shift(); } }

  update(dt) {
    this.age += dt; this.hitAge += dt; this.stateTime += dt; this.reaction.age += dt; this.metrics.activeImpulse = 0;
    this.physiology.update(dt); this.dead = !!this.physiology.dead; if (this.dead || this.physiology.unconscious) this.passiveHandoff = true; this.refreshCompatibilityInjury();
    this.reactions.update(dt); this.steps.update(dt); this.balance.update(dt); this.mapState(); this.groundBehavior.update(dt); this.steps.applySwingGuide(dt);
    const targets = this.makeTargets(), handGoals = new Map(); this.balance.pose(targets); this.reactions.apply(targets, handGoals, this.balance); this.groundBehavior.apply(targets, handGoals); this.bracing.update(dt, handGoals);
    for (const [side, goal] of handGoals) this.pullHandTo(side, goal.point, goal.strength, dt); this.applyMotors(targets, dt);
  }

  woundWorld() { return this.reactions.woundWorld(); }
  reactionSnapshot() { return this.reactions.snapshot(); }
  balanceSnapshot() { return this.balance.snapshot(); }
  behaviorSnapshot() { return { balance: this.balanceSnapshot(), reaction: this.reactionSnapshot(), ground: this.groundBehavior.snapshot(), brace: this.bracing.snapshot() }; }
  sync() { super.sync(); this.updateDebugPanel(); }
  destroy() { if (this._debugKey && typeof window !== "undefined") window.removeEventListener("keydown", this._debugKey); this._debugPanel?.remove?.(); if (this.balance?.debug?.group) this.scene.remove(this.balance.debug.group); super.destroy(); }
}
