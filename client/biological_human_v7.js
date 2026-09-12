import * as THREE from "three";
import { BiologicalArtagdollHuman } from "./biological_human.js";
import { InjuryBehavior } from "./injury_behavior.js";
import { familyOf, sideOf } from "./physiology.js";

const clamp = THREE.MathUtils.clamp;
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);
const q = (value) => new THREE.Quaternion(value.x, value.y, value.z, value.w);

// v7 combines the v6 physiology hierarchy with conscious injury behaviour.
// The goals are procedural (protect, retreat, limp, kneel), not canned poses.
export class BiologicalArtagdollHumanV7 extends BiologicalArtagdollHuman {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v7-human-behavior";
    this.behavior = new InjuryBehavior();
    this.guardWound = null;
  }

  // v6 principle: conscious CNS shock damages coordination before it removes all
  // gross motor drive. True unconsciousness still produces global collapse.
  systemicDrive() {
    const p = this.physiology;
    if (!p || this.dead) return this.dead ? 0 : 1;
    const awareness = p.unconscious
      ? p.consciousness
      : Math.max(p.consciousness, 0.68 + p.brainFunction * 0.24);
    const perfusionDrive = 0.46 + p.perfusion * 0.54;
    const oxygenDrive = 0.72 + p.oxygenation * 0.28;
    const stressCompensation = clamp(0.97 + p.adrenaline * 0.06, 0.97, 1.025);
    return clamp(awareness * perfusionDrive * oxygenDrive * stressCompensation, 0, 1);
  }

  controlDrive() {
    const p = this.physiology;
    if (!p) return 1;
    const gross = this.systemicDrive();
    if (p.unconscious) return gross * 0.08;

    const neurologicCoordination = clamp(
      p.brainFunction * (1 - Math.min(1, p.cnsShock) * 0.3),
      0,
      1,
    );
    const coordination = Math.max(p.coordination, neurologicCoordination);
    const reflexFloor = p.postureMode ? 0.25 : 0;
    let drive = Math.max(reflexFloor, gross * (0.56 + coordination * 0.44));

    // A conscious frightened person generally still has useful gross motor
    // output. Pain first changes strategy: guarding, limping and escape steps.
    const b = this.behavior;
    if (
      b &&
      ["flinch", "guard", "panic"].includes(b.phase) &&
      p.perfusion > 0.72 &&
      p.oxygenation > 0.78
    ) {
      drive = Math.max(drive, gross * 0.86);
    }
    return clamp(drive, 0, 1);
  }

  hit(part, dir, strength = 12, point) {
    const rb = this.body(part) || this.body("chest");
    const direction = v(dir);
    if (!rb || direction.lengthSq() < 1e-10) return null;
    direction.normalize();
    const hitPoint = v(point || rb.translation());
    const localPoint = hitPoint
      .clone()
      .sub(v(rb.translation()))
      .applyQuaternion(q(rb.rotation()).invert());

    const event = super.hit(part, direction, strength, hitPoint);
    if (!event) return event;

    const family = familyOf(part);
    const side = sideOf(part);

    // Keep non-catastrophic head response local: neck yield + disorientation,
    // not Hollywood whole-body knockback.
    if (family === "head" && !event.immediateMotorLoss) {
      rb.applyImpulseAtPoint(
        direction.clone().multiplyScalar(-clamp(strength, 0, 28) * 0.075),
        hitPoint,
        true,
      );
      rb.applyTorqueImpulse(
        new THREE.Vector3(direction.z, 0, -direction.x).multiplyScalar(-strength * 0.011),
        true,
      );
      this.reaction.strength = clamp(
        Math.max(this.reaction.strength, 0.42 + event.startle * 0.22),
        0.38,
        0.72,
      );
      this.reaction.headStun = Math.min(this.reaction.headStun, 0.74);
    }

    // Torso pain/startle should be visually readable without adding extra
    // translational impulse.
    if (family === "torso" && !event.immediateMotorLoss) {
      this.reaction.strength = clamp(
        Math.max(
          this.reaction.strength,
          0.36 + event.startle * 0.38 + event.painSpike * 0.22,
        ),
        0.38,
        0.95,
      );
    }

    if ((family === "arm" || family === "leg") && !event.immediateMotorLoss) {
      this.reaction.strength = clamp(
        Math.max(
          this.reaction.strength,
          0.32 + event.withdrawal * 0.4 + event.motorShock * 0.18,
        ),
        0.34,
        0.92,
      );
    }

    this.guardWound = { part, localPoint, family, side };
    this.behavior.onHit({
      event,
      physiology: this.physiology,
      part,
      side,
      strength,
    });

    // Escalate light chest trauma through protective behaviour rather than
    // stacking three near-identical full-body flinches into a guaranteed fall.
    if (family === "torso" && strength <= 10 && !event.immediateMotorLoss) {
      this.reaction.strength = Math.min(this.reaction.strength, 0.48);
      this.shock = Math.min(this.shock, 0.5);
    }

    return event;
  }

  woundWorld() {
    if (!this.guardWound) return null;
    const rb = this.body(this.guardWound.part) || this.body("chest");
    if (!rb) return null;
    return this.guardWound.localPoint
      .clone()
      .applyQuaternion(q(rb.rotation()))
      .add(v(rb.translation()));
  }

  pullHandTo(handName, anchorName, goal, strength, dt) {
    const hand = this.body(handName);
    const anchor = this.body(anchorName) || this.body("chest");
    if (!hand || !anchor) return;
    const relativeVelocity = v(hand.linvel()).sub(v(anchor.linvel()));
    const force = goal
      .clone()
      .sub(v(hand.translation()))
      .multiplyScalar(115 + strength * 85)
      .addScaledVector(relativeVelocity, -(12 + strength * 6));
    this.forcePair(hand, anchor, force, 58 + strength * 44, dt);
  }

  applyGuarding(dt) {
    const b = this.behavior;
    const p = this.physiology;
    if (!b?.wantsGuard() || !p || p.unconscious || this.dead) return;

    const wound = this.woundWorld();
    if (!wound) return;
    const family = b.family;
    const intensity = clamp(b.guard * (0.72 + b.painFocus * 0.42), 0, 1.1);
    const chest = this.body("chest");
    const pelvis = this.body("pelvis");
    const chestPos = v(chest.translation());
    const pelvisPos = v(pelvis.translation());
    const tremor = b.panic > 0.5 ? Math.sin(this.age * 18) * 0.012 * b.panic : 0;

    if (family === "torso") {
      const leftGoal = wound.clone().add(new THREE.Vector3(-0.045, -0.015 + tremor, 0.055));
      const rightGoal = wound.clone().add(new THREE.Vector3(0.045, 0.02 - tremor, 0.065));
      this.pullHandTo("handL", this.guardWound.part, leftGoal, intensity, dt);
      this.pullHandTo("handR", this.guardWound.part, rightGoal, intensity, dt);

      const curl = clamp(0.06 + intensity * 0.16, 0.06, 0.24);
      this.cohere(
        this.body("pelvis"),
        this.body("abdomen"),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(curl * 0.52, 0, 0)),
        42,
        4.8,
        24,
        0.42,
        dt,
      );
      this.cohere(
        this.body("abdomen"),
        chest,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(curl, 0, 0)),
        38,
        4.2,
        22,
        0.44,
        dt,
      );
    } else if (family === "head") {
      const hp = v(this.body("head").translation());
      this.pullHandTo(
        "handL",
        "head",
        hp.clone().add(new THREE.Vector3(-0.12, 0.015 + tremor, 0.03)),
        intensity * 0.82,
        dt,
      );
      this.pullHandTo(
        "handR",
        "head",
        hp.clone().add(new THREE.Vector3(0.12, 0.015 - tremor, 0.03)),
        intensity * 0.82,
        dt,
      );
    } else if (family === "arm") {
      const injuredSide = this.guardWound.side || "R";
      const helperSide = injuredSide === "L" ? "R" : "L";
      const goal = v(this.body(this.guardWound.part).translation()).add(
        new THREE.Vector3(0, -0.03 + tremor, 0.04),
      );
      this.pullHandTo("hand" + helperSide, this.guardWound.part, goal, intensity, dt);
    } else if (family === "leg") {
      // Preserve the arms for balance while upright; reach for the injured leg
      // once already crouched/bracing/kneeling.
      if (
        pelvisPos.y < 0.78 ||
        ["brace", "down", "collapse"].includes(this.state) ||
        b.phase === "kneel"
      ) {
        const goal = v(this.body(this.guardWound.part).translation()).add(
          new THREE.Vector3(0, 0.05, 0.04),
        );
        this.pullHandTo(
          "hand" + (this.guardWound.side || "L"),
          this.guardWound.part,
          goal,
          intensity * 0.75,
          dt,
        );
      }
    }

    // Shoulder/elbow protection makes the intention legible while the physical
    // hands are still travelling to the wound.
    if (family === "torso" || family === "head") {
      for (const side of ["L", "R"]) {
        const sign = side === "L" ? -1 : 1;
        const upper = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            -0.32 - intensity * 0.13,
            0,
            sign * (0.16 + intensity * 0.1),
          ),
        );
        const lower = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(-0.66 - intensity * 0.22, 0, 0),
        );
        this.cohere(chest, this.body("upperArm" + side), upper, 26, 3, 17, 0.44, dt);
        this.cohere(
          this.body("upperArm" + side),
          this.body("lowerArm" + side),
          lower,
          22,
          2.4,
          14,
          0.46,
          dt,
        );
      }
    }

    if (b.phase === "panic" && chestPos.y > 0.85) {
      const sway = Math.sin(this.age * 5.2) * 0.04 * b.panic;
      this.cohere(
        this.body("abdomen"),
        chest,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sway)),
        14,
        2.2,
        9,
        0.28,
        dt,
      );
    }
  }

  applyPanicMovement() {
    const b = this.behavior;
    const p = this.physiology;
    if (!b?.wantsPanicStep() || !p || p.unconscious || this.dead) return;
    if (this.step.phase !== "idle" || this.step.cooldown > 0 || this.support < 0.2) return;

    const pelvis = v(this.body("pelvis").translation());
    const dir = v(this.lastHit?.dir || { x: 0, y: 0, z: -1 });
    dir.y = 0;
    if (dir.lengthSq() < 1e-5) dir.set(0, 0, -1);
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const weave = Math.sin((this.age + b.hitCount) * 3.1) * 0.14 * b.panic;
    const target = pelvis
      .clone()
      .addScaledVector(dir, 0.2 + b.retreat * 0.18)
      .addScaledVector(side, weave);
    if (this.startScrambleStep(target)) b.consumeStep();
  }

  applyPainKneel(dt) {
    const b = this.behavior;
    const p = this.physiology;
    if (!b || b.phase !== "kneel" || !p || p.unconscious || this.dead) return;

    if (!["down", "collapse", "limp"].includes(this.state)) this.setState("brace");
    const amount = clamp(b.kneelIntent, 0, 1);
    for (const side of ["L", "R"]) {
      this.cohere(
        this.body("pelvis"),
        this.body("thigh" + side),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(-0.1 - amount * 0.14, 0, 0),
        ),
        32,
        3.8,
        22,
        0.38,
        dt,
      );
      this.cohere(
        this.body("thigh" + side),
        this.body("shin" + side),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0.22 + amount * 0.38, 0, 0),
        ),
        30,
        3.2,
        21,
        0.4,
        dt,
      );
    }
  }

  update(dt) {
    if (this.behavior && this.physiology) this.behavior.update(dt, this.physiology);
    super.update(dt);
    if (!this.behavior || !this.physiology || this.dead) return;
    this.applyGuarding(dt);
    this.applyPanicMovement();
    this.applyPainKneel(dt);
  }

  behaviorSnapshot() {
    return this.behavior?.snapshot?.() ?? null;
  }
}
