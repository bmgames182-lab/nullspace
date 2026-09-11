import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { ActiveHuman } from "./active_human.js";

const clamp = THREE.MathUtils.clamp;
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();
const GROUP = (0x0002 << 16) | 0x0003;
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);
const q = (value) => new THREE.Quaternion(value.x, value.y, value.z, value.w);
const horizontal = (value) => new THREE.Vector3(value.x, 0, value.z);

function sideOf(part) {
  return part?.endsWith("L") ? "L" : part?.endsWith("R") ? "R" : null;
}

function familyOf(part) {
  if (part === "head") return "head";
  if (/pelvis|abdomen|chest/.test(part)) return "torso";
  if (/thigh|shin|foot/.test(part)) return "leg";
  if (/Arm|hand/.test(part)) return "arm";
  return "other";
}

// Original controller inspired by Artagdoll's public, visible design goals:
// procedural stumbling and event-specific physical reactions. No addon source
// code or assets are used.
export class ArtagdollHuman extends ActiveHuman {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.addPhysicalHands();
    this.initializeControl();
    this.sync();
  }

  addPhysicalHands() {
    if (this.parts.has("handL")) return;
    const skin = new THREE.MeshStandardMaterial({
      color: 0x9b7159,
      roughness: 0.9,
    });

    for (const side of ["L", "R"]) {
      const lowerPart = this.parts.get("lowerArm" + side);
      for (const child of [...lowerPart.mesh.children]) {
        lowerPart.mesh.remove(child);
        child.geometry?.dispose();
      }

      const lp = v(lowerPart.rb.translation());
      const handPos = lp.clone().add(new THREE.Vector3(0, -0.235, 0));
      const rb = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(handPos.x, handPos.y, handPos.z)
          .setLinearDamping(0.06)
          .setAngularDamping(0.2)
          .setCcdEnabled(true)
          .setAdditionalSolverIterations(4),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.055, 0.075, 0.04)
          .setMass(0.28)
          .setFriction(1.05)
          .setRestitution(0.002)
          .setCollisionGroups(GROUP),
        rb,
      );
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.15, 0.08),
        skin,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.part = "hand" + side;
      this.scene.add(mesh);
      this.parts.set("hand" + side, { rb, mesh, collider });
      this.hitMeshes.push(mesh);

      const joint = this.world.createImpulseJoint(
        RAPIER.JointData.spherical(
          { x: 0, y: -0.205, z: 0 },
          { x: 0, y: 0.075, z: 0 },
        ),
        lowerPart.rb,
        rb,
        true,
      );
      try {
        joint?.setContactsEnabled?.(false);
      } catch {}
      if (joint) this.joints.push(joint);
    }
  }

  initializeControl() {
    super.initializeControl();
    this.controllerStyle = "artagdoll-inspired-v4";
    this.state = "balance";
    this.history = ["balance"];
    this.reaction = {
      age: 99,
      strength: 0,
      part: "chest",
      family: "torso",
      side: null,
      dir: new THREE.Vector3(0, 0, -1),
      point: new THREE.Vector3(),
      headStun: 0,
      legStun: { L: 0, R: 0 },
      armStun: { L: 0, R: 0 },
    };
    this.balanceTime = 0;
    this.downTime = 0;
    this.airTime = 0;
    this.lastStepSide = "R";
    this.forcedStepSide = null;
    this.forcedStepAge = 99;

    if (this.parts.has("handL")) {
      for (const side of ["L", "R"])
        this.muscles.push([
          "lowerArm" + side,
          "hand" + side,
          [-0.55, -0.45, -0.4],
          [0.55, 0.45, 0.4],
          8,
          0.8,
          6,
        ]);
      this.mass = 0;
      for (const { rb } of this.parts.values()) this.mass += rb.mass();
    }
  }

  setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.stateTime = 0;
    this.history.push(next);
    if (this.history.length > 64) this.history.shift();
  }

  hit(part, dir, strength = 12, point) {
    const rb = this.body(part) || this.body("chest");
    const direction = v(dir);
    if (direction.lengthSq() < 1e-10) return;
    direction.normalize();

    const family = familyOf(part);
    const side = sideOf(part);
    const impulseScale =
      family === "head"
        ? 0.36
        : family === "torso"
          ? 0.34
          : family === "leg"
            ? 0.3
            : family === "arm"
              ? 0.24
              : 0.3;
    const hitPoint = v(point || rb.translation());
    rb.applyImpulseAtPoint(
      direction.clone().multiplyScalar(clamp(strength, 0, 28) * impulseScale),
      hitPoint,
      true,
    );

    if (family === "head" || family === "torso") {
      const torque = new THREE.Vector3(direction.z, 0, -direction.x)
        .multiplyScalar(strength * (family === "head" ? 0.055 : 0.022));
      rb.applyTorqueImpulse(torque, true);
    }

    if (this.dead) return;

    this.lastHit = {
      part,
      dir: direction.clone(),
      point: hitPoint.clone(),
    };
    this.hitAge = 0;
    this.shock = Math.min(1, this.shock + strength / 48);
    this.reaction.age = 0;
    this.reaction.strength = clamp(strength / 18, 0.1, 1.45);
    this.reaction.part = part;
    this.reaction.family = family;
    this.reaction.side = side;
    this.reaction.dir.copy(direction);
    this.reaction.point.copy(hitPoint);

    if (family === "leg" && side) {
      this.injury[side] = clamp(this.injury[side] + strength / 120, 0, 1);
      this.reaction.legStun[side] = clamp(
        Math.max(this.reaction.legStun[side], strength / 21),
        0,
        1,
      );
      this.forcedStepSide = side;
      this.forcedStepAge = 0;
    }
    if (family === "arm" && side) {
      this.injury["arm" + side] = clamp(
        this.injury["arm" + side] + strength / 150,
        0,
        1,
      );
      this.reaction.armStun[side] = clamp(
        Math.max(this.reaction.armStun[side], strength / 23),
        0,
        1,
      );
    }
    if (family === "head")
      this.reaction.headStun = clamp(
        Math.max(this.reaction.headStun, strength / 22),
        0,
        1.25,
      );

    this.health -=
      strength *
      (family === "head"
        ? 0.034
        : family === "torso"
          ? 0.008
          : family === "leg" || family === "arm"
            ? 0.0018
            : 0.002);

    if (this.health <= 0 || (this.injury.L > 0.97 && this.injury.R > 0.97)) {
      this.dead = true;
      this.step.phase = "idle";
      this.setState("limp");
      return;
    }

    this.setState("react");
  }

  startScrambleStep(capture, requestedSide = null) {
    if (this.step.phase !== "idle" || this.step.cooldown > 0) return false;

    const pelvis = v(this.body("pelvis").translation());
    const offset = capture.clone().sub(pelvis);
    offset.y = 0;

    let side = requestedSide;
    if (!side && Math.abs(offset.x) > 0.09)
      side = offset.x > 0 ? "R" : "L";
    if (!side) side = this.lastStepSide === "L" ? "R" : "L";

    const other = side === "L" ? "R" : "L";
    if (this.feet[other].quality < 0.22 || this.injury[other] > 0.92) {
      side = other;
    }
    const supportSide = side === "L" ? "R" : "L";
    if (this.feet[supportSide].quality < 0.18 || this.injury[supportSide] > 0.95)
      return false;

    const from = v(this.body("foot" + side).translation());
    const target = capture.clone();
    const sign = side === "L" ? -1 : 1;
    target.x += sign * 0.13;

    const reach = target.clone().sub(pelvis);
    reach.y = 0;
    reach.clampLength(0, 0.58);
    target.x = pelvis.x + reach.x;
    target.z = pelvis.z + reach.z;

    if (Math.abs(offset.x) > 0.12)
      target.x += Math.sign(offset.x) * 0.055;

    const ray = new RAPIER.Ray(
      { x: target.x, y: pelvis.y + 0.25, z: target.z },
      { x: 0, y: -1, z: 0 },
    );
    const ground = this.world.castRay(ray, 1.8, true, undefined, 0x00010001);
    if (!ground) return false;
    target.y = pelvis.y + 0.25 - ground.timeOfImpact + 0.055;

    this.step = {
      phase: "lift",
      side,
      time: 0,
      cooldown: 0,
      from,
      target,
    };
    this.lastStepSide = side;
    this.metrics.steps++;
    return true;
  }

  update(dt) {
    this.age += dt;
    this.hitAge += dt;
    this.stateTime += dt;
    this.reaction.age += dt;
    this.forcedStepAge += dt;
    this.metrics.activeImpulse = 0;

    for (const muscle of this.muscles) this.passiveLimit(muscle, dt);
    if (this.dead) return;

    this.shock *= Math.exp(-dt * 1.65);
    this.reaction.headStun *= Math.exp(-dt * 1.15);
    for (const side of ["L", "R"]) {
      this.reaction.legStun[side] *= Math.exp(-dt * 2.15);
      this.reaction.armStun[side] *= Math.exp(-dt * 2.4);
    }
    this.step.cooldown -= dt;

    const pelvis = this.body("pelvis");
    const chest = this.body("chest");
    const pp = v(pelvis.translation());
    const pv = v(pelvis.linvel());
    const cp = v(chest.translation());
    const cv = v(chest.linvel());
    const com = this.centreOfMass();
    const pelvisQuat = q(pelvis.rotation());
    const pelvisInv = pelvisQuat.clone().invert();
    const chestUp = v(UP).applyQuaternion(q(chest.rotation())).y;
    const pelvisUp = v(UP).applyQuaternion(pelvisQuat).y;

    let supportQuality = 0;
    const supportCenter = new THREE.Vector3();
    const supportPoints = [];
    for (const side of ["L", "R"]) {
      const foot = this.body("foot" + side);
      const quality = this.footQuality(foot);
      const data = this.feet[side];
      if (quality > 0.38 && data.quality <= 0.38)
        data.anchor.copy(v(foot.translation()));
      data.quality = quality;
      supportQuality += quality;
      supportCenter.addScaledVector(v(foot.translation()), quality);
      if (quality > 0.12) supportPoints.push(v(foot.translation()));
    }
    if (supportQuality > 1e-4) supportCenter.multiplyScalar(1 / supportQuality);
    else supportCenter.copy(pp).setY(0);
    this.support = supportQuality;

    if (supportQuality < 0.14) this.airTime += dt;
    else this.airTime = 0;

    const capture = com.position
      .clone()
      .addScaledVector(
        com.velocity,
        clamp(
          Math.sqrt(Math.max(0.2, com.position.y - supportCenter.y) / 9.81),
          0.16,
          0.34,
        ),
      );
    capture.y = supportCenter.y;

    let outsideX = 0;
    let outsideZ = 0;
    if (supportPoints.length) {
      const xs = supportPoints.map((p) => p.x);
      const zs = supportPoints.map((p) => p.z);
      const padX = supportPoints.length > 1 ? 0.105 : 0.09;
      const padZ = 0.17;
      const minX = Math.min(...xs) - padX;
      const maxX = Math.max(...xs) + padX;
      const minZ = Math.min(...zs) - padZ;
      const maxZ = Math.max(...zs) + padZ;
      outsideX = Math.max(minX - capture.x, 0, capture.x - maxX);
      outsideZ = Math.max(minZ - capture.z, 0, capture.z - maxZ);
    } else {
      outsideX = Math.abs(capture.x - pp.x);
      outsideZ = Math.abs(capture.z - pp.z);
    }
    const balanceError = Math.hypot(outsideX, outsideZ);
    const horizontalSpeed = Math.hypot(com.velocity.x, com.velocity.z);
    const torsoGround =
      this.contact("pelvis") || this.contact("abdomen") || this.contact("chest");
    const trulyDown =
      torsoGround ||
      (cp.y < 0.47 && pp.y < 0.52) ||
      (cp.y < 0.58 && this.airTime > 0.28);
    const acute = this.reaction.age < 0.24;
    const unstable =
      balanceError > 0.028 ||
      horizontalSpeed > 0.78 ||
      chestUp < 0.68 ||
      pelvisUp < 0.66;
    const severe =
      this.airTime > 0.2 ||
      chestUp < 0.28 ||
      pelvisUp < 0.3 ||
      pp.y < 0.56 ||
      cp.y < 0.76;

    if (trulyDown) {
      this.downTime += dt;
      this.balanceTime = 0;
      this.setState("down");
    } else if (this.state === "collapse") {
      this.balanceTime = 0;
    } else if (acute) {
      this.downTime = 0;
      this.balanceTime = 0;
      this.setState("react");
    } else if (severe) {
      this.downTime = 0;
      this.balanceTime = 0;
      this.setState("brace");
    } else if (unstable) {
      this.downTime = 0;
      this.balanceTime = 0;
      this.setState("scramble");
    } else {
      this.downTime = 0;
      this.balanceTime += dt;
      if (this.balanceTime > 0.16) this.setState("balance");
    }

    if (
      this.state === "brace" &&
      this.stateTime > 1.25 &&
      (this.airTime > 0.3 || chestUp < 0.3 || cp.y < 0.68)
    )
      this.setState("collapse");

    const rescuing =
      this.state === "balance" ||
      this.state === "react" ||
      this.state === "scramble" ||
      this.state === "brace";

    if (!rescuing && this.step.phase !== "idle") {
      this.step.phase = "idle";
      this.step.cooldown = 0.18;
    }

    if (
      rescuing &&
      this.step.phase === "idle" &&
      this.step.cooldown <= 0 &&
      this.forcedStepSide &&
      this.forcedStepAge < 0.48 &&
      this.feet[this.forcedStepSide === "L" ? "R" : "L"].quality > 0.22
    ) {
      const forcedTarget = capture.clone();
      forcedTarget.z += 0.06;
      if (this.startScrambleStep(forcedTarget, this.forcedStepSide))
        this.forcedStepSide = null;
    }

    if (
      rescuing &&
      this.step.phase === "idle" &&
      this.step.cooldown <= 0 &&
      pp.y > 0.58 &&
      supportQuality > 0.16 &&
      (balanceError > 0.015 ||
        horizontalSpeed > 0.4 ||
        this.state === "scramble" ||
        this.state === "brace")
    )
      this.startScrambleStep(capture);

    if (this.step.phase !== "idle") {
      const step = this.step;
      step.time += dt;
      if (step.phase === "lift" && step.time > 0.07) {
        step.phase = "travel";
        step.time = 0;
      } else if (step.phase === "travel" && step.time > 0.15) {
        step.phase = "plant";
        step.time = 0;
      } else if (
        step.phase === "plant" &&
        (this.feet[step.side].quality > 0.4 || step.time > 0.16)
      ) {
        if (this.feet[step.side].quality > 0.4) this.metrics.plants++;
        this.feet[step.side].anchor.copy(
          v(this.body("foot" + step.side).translation()),
        );
        step.phase = "idle";
        step.cooldown = balanceError > 0.03 ? 0.045 : 0.11;
      }
    }

    const targets = {};
    const swing = this.step.phase !== "idle" ? this.step.side : null;

    for (const side of ["L", "R"]) {
      const foot = this.body("foot" + side);
      const fp = v(foot.translation());
      const fv = v(foot.linvel());
      const injured = this.injury[side];
      const stunned = this.reaction.legStun[side];
      let target = this.feet[side].anchor.clone();

      if (side === swing) {
        const step = this.step;
        const progress =
          step.phase === "lift"
            ? 0
            : step.phase === "travel"
              ? clamp(step.time / 0.15, 0, 1)
              : 1;
        const smooth = progress * progress * (3 - 2 * progress);
        target.lerpVectors(step.from, step.target, smooth);
        const lift =
          step.phase === "lift"
            ? 0.11 * clamp(step.time / 0.07, 0, 1)
            : step.phase === "travel"
              ? 0.11 + Math.sin(progress * Math.PI) * 0.035
              : 0.11 * (1 - clamp(step.time / 0.13, 0, 1));
        target.y += lift;

        const force = target
          .clone()
          .sub(fp)
          .multiplyScalar(285)
          .addScaledVector(fv, -22);
        this.forcePair(
          foot,
          pelvis,
          force,
          150 * (1 - injured * 0.5) * (1 - stunned * 0.2),
          dt,
        );
      } else if (rescuing && this.feet[side].quality > 0.18) {
        const anchorError = this.feet[side].anchor.clone().sub(fp);
        anchorError.y = 0;
        const traction = anchorError
          .multiplyScalar(175)
          .addScaledVector(new THREE.Vector3(fv.x, 0, fv.z), -18);
        this.forcePair(
          foot,
          pelvis,
          traction,
          82 * (1 - injured * 0.4) * (1 - stunned * 0.25),
          dt,
        );
      }

      this.legTargets(side, target, targets);

      if (
        this.reaction.family === "leg" &&
        this.reaction.side === side &&
        this.reaction.age < 0.36
      ) {
        const yieldEnvelope =
          Math.sin(clamp(this.reaction.age / 0.36, 0, 1) * Math.PI) *
          this.reaction.strength;
        targets["thigh" + side].multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              0.12 * yieldEnvelope,
              0,
              (side === "L" ? -1 : 1) * 0.08 * yieldEnvelope,
            ),
          ),
        );
        targets["shin" + side].multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0.42 * yieldEnvelope, 0, 0),
          ),
        );
      }
    }

    if (rescuing && supportQuality > 0.12) {
      const supports = ["L", "R"].map((side) => {
        const capacity = clamp(
          1 -
            this.injury[side] * 0.55 -
            this.reaction.legStun[side] * 0.72,
          0.08,
          1,
        );
        return {
          side,
          q: this.feet[side].quality,
          capacity: side === swing ? 0 : capacity,
        };
      });
      const loadTotal = supports.reduce(
        (sum, item) => sum + item.q * item.capacity,
        0,
      );

      for (const item of supports) {
        if (item.q <= 0.08 || item.capacity <= 0 || loadTotal <= 0.01) continue;
        const share = (item.q * item.capacity) / loadTotal;
        const supportFoot = this.body("foot" + item.side);
        const desiredHeight =
          this.state === "balance"
            ? 0.93
            : this.state === "react"
              ? 0.9
              : this.state === "scramble"
                ? 0.86
                : 0.77;
        const heightForce = clamp(
          (desiredHeight - pp.y) * 900 - pv.y * 115,
          -120,
          620,
        );
        const horizontalGain = this.state === "balance" ? 180 : 125;
        const horizontalDamping = this.state === "balance" ? 48 : 34;
        const force = new THREE.Vector3(
          clamp(
            (supportCenter.x - com.position.x) * horizontalGain -
              com.velocity.x * horizontalDamping,
            -105,
            105,
          ),
          Math.max(0, (this.mass * 9.81 + heightForce) * share),
          clamp(
            (supportCenter.z - com.position.z) * horizontalGain -
              com.velocity.z * horizontalDamping,
            -105,
            105,
          ),
        );
        this.forcePair(pelvis, supportFoot, force, 900, dt);
      }

      const rootGain =
        this.state === "balance"
          ? 330
          : this.state === "react"
            ? 150
            : this.state === "scramble"
              ? 225
              : 145;
      const rootDamp =
        this.state === "balance" ? 42 : this.state === "react" ? 18 : 28;
      const upright = v(UP)
        .applyQuaternion(pelvisQuat)
        .cross(UP)
        .multiplyScalar(rootGain)
        .addScaledVector(v(pelvis.angvel()), -rootDamp);
      for (const item of supports)
        if (item.q > 0.12 && item.capacity > 0)
          this.torquePair(
            this.body("foot" + item.side),
            pelvis,
            upright.clone().multiplyScalar(
              item.capacity / Math.max(0.5, loadTotal),
            ),
            125,
            dt,
          );
    }

    const localHitDir = this.reaction.dir
      .clone()
      .applyQuaternion(pelvisInv)
      .normalize();
    const reactionEnvelope =
      Math.exp(-this.reaction.age * 4.2) * this.reaction.strength;
    const family = this.reaction.family;

    let abdomenPitch = 0;
    let abdomenRoll = 0;
    let chestPitch = 0;
    let chestRoll = 0;
    let chestYaw = 0;

    if (family === "torso") {
      abdomenPitch = localHitDir.z * reactionEnvelope * 0.2;
      abdomenRoll = -localHitDir.x * reactionEnvelope * 0.18;
      chestPitch = localHitDir.z * reactionEnvelope * 0.42;
      chestRoll = -localHitDir.x * reactionEnvelope * 0.38;
      chestYaw = -localHitDir.x * reactionEnvelope * 0.12;
    } else if (family === "head") {
      abdomenPitch = -localHitDir.z * reactionEnvelope * 0.04;
      chestPitch = -localHitDir.z * reactionEnvelope * 0.08;
      chestRoll = localHitDir.x * reactionEnvelope * 0.06;
    }

    const localVelocity = horizontal(com.velocity).applyQuaternion(pelvisInv);
    const counter =
      this.state === "scramble" || this.state === "brace" ? 1 : 0;
    chestPitch += clamp(localVelocity.z * 0.08 * counter, -0.16, 0.16);
    chestRoll += clamp(-localVelocity.x * 0.08 * counter, -0.16, 0.16);

    targets.abdomen = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        clamp(abdomenPitch, -0.3, 0.3),
        0,
        clamp(abdomenRoll, -0.28, 0.28),
      ),
    );
    targets.chest = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        clamp(chestPitch, -0.48, 0.48),
        clamp(chestYaw, -0.2, 0.2),
        clamp(chestRoll, -0.46, 0.46),
      ),
    );

    if (family === "head") {
      targets.head = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          clamp(localHitDir.z * reactionEnvelope * 0.78, -0.78, 0.78),
          clamp(-localHitDir.x * reactionEnvelope * 0.28, -0.42, 0.42),
          clamp(-localHitDir.x * reactionEnvelope * 0.68, -0.7, 0.7),
        ),
      );
    } else {
      targets.head = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          clamp(-chestPitch * 0.28, -0.22, 0.22),
          clamp(-chestYaw * 0.2, -0.16, 0.16),
          clamp(-chestRoll * 0.2, -0.18, 0.18),
        ),
      );
    }

    const fallDirection = horizontal(com.velocity);
    if (fallDirection.lengthSq() < 0.02)
      fallDirection.copy(horizontal(this.reaction.dir));
    if (fallDirection.lengthSq() > 1e-5) fallDirection.normalize();

    for (const side of ["L", "R"]) {
      const sign = side === "L" ? -1 : 1;
      const struck = family === "arm" && this.reaction.side === side;
      let shoulderPitch = -0.08;
      let shoulderRoll = sign * 0.1;
      let shoulderYaw = 0;
      let elbow = -0.18;

      if (struck && this.reaction.age < 0.52) {
        shoulderPitch = clamp(
          -0.18 + localHitDir.z * reactionEnvelope * 0.42,
          -0.72,
          0.28,
        );
        shoulderRoll = sign * clamp(0.32 + reactionEnvelope * 0.5, 0.3, 0.9);
        shoulderYaw = -localHitDir.x * reactionEnvelope * 0.18;
        elbow = -0.78;
      } else if (family === "head" && this.reaction.age < 0.5) {
        shoulderPitch = -0.5;
        shoulderRoll = sign * 0.42;
        elbow = -0.95;
      } else if (this.state === "react" && family === "torso") {
        shoulderPitch = clamp(-0.12 - localHitDir.z * 0.18, -0.38, 0.14);
        shoulderRoll = sign * 0.28 - localHitDir.x * 0.12;
        elbow = -0.28;
      } else if (this.state === "scramble" || this.state === "brace") {
        const chaos = clamp(
          horizontalSpeed / 1.5 + balanceError * 8 + (1 - chestUp) * 0.6,
          0,
          1,
        );
        shoulderPitch = clamp(
          -0.12 -
            fallDirection.z * 0.28 +
            Math.sin(this.age * 8.5 + sign * 1.7) * 0.15 * chaos,
          -0.62,
          0.18,
        );
        shoulderRoll =
          sign * (0.28 + chaos * 0.28) -
          fallDirection.x * 0.18;
        elbow = -0.26 - chaos * 0.22;
      }

      targets["upperArm" + side] = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(shoulderPitch, shoulderYaw, shoulderRoll),
      );
      targets["lowerArm" + side] = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(elbow, 0, 0),
      );
      if (this.body("hand" + side))
        targets["hand" + side] = IDENTITY;

      if (
        this.body("hand" + side) &&
        (this.state === "brace" ||
          (this.state === "scramble" && chestUp < 0.58)) &&
        cp.y < 1.2
      ) {
        const hand = this.body("hand" + side);
        const goal = cp
          .clone()
          .addScaledVector(fallDirection, 0.36)
          .add(new THREE.Vector3(sign * 0.3, -0.52, 0));
        goal.y = Math.max(0.075, goal.y);
        const handForce = goal
          .sub(v(hand.translation()))
          .multiplyScalar(105)
          .addScaledVector(v(hand.linvel()).sub(cv), -11);
        this.forcePair(
          hand,
          chest,
          handForce,
          78 * (1 - this.injury["arm" + side] * 0.72),
          dt,
        );

        if (this.contact("hand" + side)) {
          const handSupport = clamp(
            (0.9 - cp.y) * 360 - cv.y * 65 + 80,
            0,
            230,
          );
          this.forcePair(
            chest,
            hand,
            new THREE.Vector3(0, handSupport, 0),
            230,
            dt,
          );
        }
      }
    }

    if (this.state === "collapse" || this.state === "down") {
      const floorActivity = this.state === "collapse" ? 0.08 : 0.035;
      for (const muscle of this.muscles) {
        const [a, b, , , gain, damping, cap] = muscle;
        this.cohere(
          this.body(a),
          this.body(b),
          targets[b] || IDENTITY,
          gain * 0.55,
          damping * 0.72,
          cap * 0.55,
          floorActivity,
          dt,
        );
      }
      return;
    }

    const headActivity = clamp(1 - this.reaction.headStun * 0.55, 0.32, 1);
    const shockActivity = clamp(1 - this.shock * 0.25, 0.66, 1);

    for (const muscle of this.muscles) {
      const [a, b, , , gain, damping, cap] = muscle;
      let strength = shockActivity;

      if (/hand/.test(b)) {
        const side = b.slice(-1);
        strength *=
          0.5 *
          (1 - this.injury["arm" + side] * 0.7) *
          (1 - this.reaction.armStun[side] * 0.45);
      } else if (/Arm/.test(b)) {
        const side = b.slice(-1);
        strength *=
          (this.state === "react" ? 0.38 : 0.68) *
          (1 - this.injury["arm" + side] * 0.72) *
          (1 - this.reaction.armStun[side] * 0.62);
      } else if (/thigh|shin|foot/.test(b)) {
        const side = b.slice(-1);
        const supportLeg = side !== swing;
        strength *=
          (supportLeg ? 0.96 : 0.66) *
          (1 - this.injury[side] * 0.62) *
          (1 - this.reaction.legStun[side] * (supportLeg ? 0.55 : 0.28));
      } else if (b === "head") {
        strength *=
          family === "head" && this.reaction.age < 0.42
            ? 0.18 * headActivity
            : 0.7 * headActivity;
      } else {
        strength *=
          this.state === "balance"
            ? 0.92
            : this.state === "react"
              ? 0.4
              : this.state === "scramble"
                ? 0.68
                : 0.52;
      }

      this.cohere(
        this.body(a),
        this.body(b),
        targets[b] || IDENTITY,
        gain,
        damping,
        cap,
        clamp(strength, 0.025, 1),
        dt,
      );
    }
  }
}
