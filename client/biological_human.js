import * as THREE from "three";
import { ArtagdollHuman } from "./artagdoll_human.js";
import { PhysiologyModel, familyOf, sideOf } from "./physiology.js";

const clamp = THREE.MathUtils.clamp;
const IDENTITY = new THREE.Quaternion();
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);

// Adds a physiology/control layer to the proven Artagdoll-style mechanics.
// The base class still owns balance, stepping, bracing and joint control; this
// class decides how much control is available after each injury and over time.
export class BiologicalArtagdollHuman extends ArtagdollHuman {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.physiology = new PhysiologyModel();
    this.controllerStyle = "artagdoll-biological-v5";
    this.lastBiologyEvent = null;
  }

  systemicDrive() {
    const p = this.physiology;
    if (!p || this.dead) return this.dead ? 0 : 1;
    // Central consciousness, oxygen delivery and perfusion affect the whole
    // body. Regional spinal/limb deficits are mapped separately below.
    return clamp(
      p.consciousness *
        (0.46 + p.perfusion * 0.54) *
        (0.72 + p.oxygenation * 0.28) *
        (0.88 + p.adrenaline * 0.12),
      0,
      1,
    );
  }

  controlDrive() {
    const p = this.physiology;
    if (!p) return 1;
    const reflexFloor = p.postureMode ? 0.25 : 0;
    return Math.max(
      reflexFloor,
      this.systemicDrive() * (0.48 + p.coordination * 0.52),
    );
  }

  // All active force pairs inherit current physiological drive. Passive joint
  // limits remain in the base class and still protect a limp/unconscious body.
  forcePair(a, b, force, cap, dt) {
    const drive = this.controlDrive();
    return super.forcePair(
      a,
      b,
      force.clone().multiplyScalar(drive),
      cap * drive,
      dt,
    );
  }

  torquePair(parent, child, torque, cap, dt, active = true) {
    if (!active)
      return super.torquePair(parent, child, torque, cap, dt, false);
    const drive = this.controlDrive();
    return super.torquePair(
      parent,
      child,
      torque.clone().multiplyScalar(drive),
      cap * drive,
      dt,
      true,
    );
  }

  syncRegionalDeficits() {
    const p = this.physiology;
    if (!p) return;
    for (const side of ["L", "R"]) {
      // Torso spinal injury in this simplified body primarily affects lower
      // extremity motor control; arm capacity remains local/brain-driven.
      const legRegional = clamp(
        p.localLimbCapacity("leg", side) * p.spinalFunction,
        0,
        1,
      );
      const armRegional = p.localLimbCapacity("arm", side);
      this.injury[side] = 1 - legRegional;
      this.injury["arm" + side] = 1 - armRegional;
    }
  }

  hit(part, dir, strength = 12, point) {
    const rb = this.body(part) || this.body("chest");
    const direction = v(dir);
    if (!rb || direction.lengthSq() < 1e-10) return null;
    direction.normalize();
    const family = familyOf(part);
    const side = sideOf(part);
    const hitPoint = v(point || rb.translation());

    // Penetrating trauma does not act like a giant cinematic knockback. Keep a
    // modest physical impulse for local momentum, and let altered motor control,
    // structure, pain and balance create the visible reaction.
    const impulseScale =
      family === "head"
        ? 0.17
        : family === "torso"
          ? 0.15
          : family === "leg"
            ? 0.14
            : family === "arm"
              ? 0.115
              : 0.13;
    rb.applyImpulseAtPoint(
      direction.clone().multiplyScalar(clamp(strength, 0, 28) * impulseScale),
      hitPoint,
      true,
    );

    if (family === "head" || family === "torso") {
      const torque = new THREE.Vector3(direction.z, 0, -direction.x)
        .multiplyScalar(strength * (family === "head" ? 0.026 : 0.012));
      rb.applyTorqueImpulse(torque, true);
    }

    // Corpse impacts stay physical but no new active biological response is
    // generated after death.
    if (this.dead) return null;

    const event = this.physiology.hit({
      part,
      strength,
      point: hitPoint,
      direction,
    });
    this.lastBiologyEvent = event;
    this.syncRegionalDeficits();

    this.lastHit = {
      part,
      dir: direction.clone(),
      point: hitPoint.clone(),
    };
    this.hitAge = 0;
    this.shock = clamp(
      Math.max(
        this.shock,
        event.startle * 0.7 + event.motorShock * 0.3,
      ),
      0,
      1,
    );

    this.reaction.age = 0;
    this.reaction.strength = clamp(
      0.12 +
        event.startle * 0.38 +
        event.motorShock * 0.42 +
        event.withdrawal * 0.24,
      0.08,
      1.25,
    );
    this.reaction.part = part;
    this.reaction.family = family;
    this.reaction.side = side;
    this.reaction.dir.copy(direction);
    this.reaction.point.copy(hitPoint);

    // A conscious lateral torso reaction often needs a visible catch step; do
    // not request one when CNS failure has already removed coordinated control.
    if (
      family === "torso" &&
      !event.immediateMotorLoss &&
      Math.abs(direction.x) > 0.35 &&
      event.startle > 0.28
    ) {
      this.forcedStepSide = direction.x > 0 ? "R" : "L";
      this.forcedStepAge = 0;
    }

    if (family === "leg" && side) {
      this.reaction.legStun[side] = clamp(
        Math.max(
          this.reaction.legStun[side],
          event.motorShock * 0.82 + event.withdrawal * 0.25,
        ),
        0,
        1,
      );
      // The injured leg becomes the swing/unloaded leg while the opposite side
      // attempts to carry body weight.
      if (!event.immediateMotorLoss) {
        this.forcedStepSide = side;
        this.forcedStepAge = 0;
      }
    }

    if (family === "arm" && side) {
      this.reaction.armStun[side] = clamp(
        Math.max(
          this.reaction.armStun[side],
          event.motorShock * 0.8 + event.withdrawal * 0.32,
        ),
        0,
        1,
      );
    }

    if (family === "head") {
      this.reaction.headStun = clamp(
        Math.max(this.reaction.headStun, event.motorShock),
        0,
        1.25,
      );
    }

    this.health = clamp(
      Math.min(
        this.physiology.brainFunction,
        this.physiology.bloodVolume,
        this.physiology.oxygenation,
      ),
      0,
      1,
    );

    if (this.physiology.dead) {
      this.dead = true;
      this.step.phase = "idle";
      this.setState("limp");
    } else if (event.immediateMotorLoss || this.physiology.unconscious) {
      this.step.phase = "idle";
      this.setState("collapse");
    } else {
      this.setState("react");
    }
    return event;
  }

  applyNeurologicPosture(dt) {
    const mode = this.physiology?.postureMode;
    if (!mode || this.dead) return;
    const flexor = mode === "flexor";

    for (const side of ["L", "R"]) {
      const sign = side === "L" ? -1 : 1;
      const upperTarget = new THREE.Quaternion().setFromEuler(
        flexor
          ? new THREE.Euler(-0.82, 0, sign * 0.2)
          : new THREE.Euler(0.16, 0, sign * 0.08),
      );
      const lowerTarget = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(flexor ? -1.55 : -0.06, 0, 0),
      );
      const thighTarget = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(flexor ? -0.08 : 0.1, 0, sign * 0.02),
      );
      const shinTarget = flexor
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, 0))
        : IDENTITY;

      this.cohere(
        this.body("chest"),
        this.body("upperArm" + side),
        upperTarget,
        34,
        3.5,
        20,
        0.42,
        dt,
      );
      this.cohere(
        this.body("upperArm" + side),
        this.body("lowerArm" + side),
        lowerTarget,
        28,
        2.8,
        17,
        0.44,
        dt,
      );
      this.cohere(
        this.body("pelvis"),
        this.body("thigh" + side),
        thighTarget,
        31,
        3.2,
        22,
        0.34,
        dt,
      );
      this.cohere(
        this.body("thigh" + side),
        this.body("shin" + side),
        shinTarget,
        27,
        2.8,
        20,
        0.34,
        dt,
      );
    }
  }

  update(dt) {
    if (!this.physiology) return super.update(dt);

    if (!this.dead) {
      this.physiology.update(dt);
      this.syncRegionalDeficits();
      this.health = clamp(
        Math.min(
          this.physiology.brainFunction,
          this.physiology.bloodVolume,
          this.physiology.oxygenation,
        ),
        0,
        1,
      );

      // Progressive hypoperfusion/hypoxia degrades balance rather than acting
      // like a hidden health threshold. Unconsciousness removes rescue stepping;
      // death removes all active muscle drive entirely.
      const metabolicShock = clamp(
        (1 - this.physiology.perfusion) * 0.58 +
          (1 - this.physiology.oxygenation) * 0.34 +
          this.physiology.cnsShock * 0.4,
        0,
        1,
      );
      this.shock = Math.max(this.shock, metabolicShock);

      if (this.physiology.dead) {
        this.dead = true;
        this.step.phase = "idle";
        this.setState("limp");
      } else if (this.physiology.unconscious) {
        this.step.phase = "idle";
        if (this.state !== "down") this.setState("collapse");
      } else if (
        this.systemicDrive() < 0.42 &&
        this.state === "balance"
      ) {
        this.setState("brace");
      }
    }

    super.update(dt);
    if (!this.dead) this.applyNeurologicPosture(dt);
  }
}
