import * as THREE from "three";
import { BiologicalArtagdollHumanV6 } from "./biological_human_v6.js";
import { InjuryBehavior } from "./injury_behavior.js";
import { familyOf, sideOf } from "./physiology.js";

const clamp = THREE.MathUtils.clamp;
const IDENTITY = new THREE.Quaternion();
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);
const q = (value) => new THREE.Quaternion(value.x, value.y, value.z, value.w);

// v7 adds conscious injury behaviour on top of the v6 physiology/controller.
// These are procedural goals (protect, retreat, limp, kneel), not canned poses.
export class BiologicalArtagdollHumanV7 extends BiologicalArtagdollHumanV6 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v7-human-behavior";
    this.behavior = new InjuryBehavior();
    this.guardWound = null;
  }

  controlDrive() {
    const base = super.controlDrive();
    const p = this.physiology;
    const b = this.behavior;
    if (!p || !b || p.unconscious || this.dead) return base;

    // A conscious frightened person generally still has gross motor drive.
    // Pain changes *how* they move before it necessarily removes the ability to
    // move. Preserve enough control for guarding, limping and rescue steps.
    if (["flinch", "guard", "panic"].includes(b.phase) && p.perfusion > 0.72 && p.oxygenation > 0.78) {
      return Math.max(base, this.systemicDrive() * 0.86);
    }
    return base;
  }

  hit(part, dir, strength = 12, point) {
    const rb = this.body(part) || this.body("chest");
    if (!rb) return null;
    const hitPoint = v(point || rb.translation());
    const localPoint = hitPoint
      .clone()
      .sub(v(rb.translation()))
      .applyQuaternion(q(rb.rotation()).invert());

    const event = super.hit(part, dir, strength, hitPoint);
    if (!event) return event;

    const family = familyOf(part);
    const side = sideOf(part);
    this.guardWound = { part, localPoint, family, side };
    this.behavior.onHit({
      event,
      physiology: this.physiology,
      part,
      side,
      strength,
    });

    // Repeated *light* torso hits should read as escalating guarding/panic, not
    // repeated full-body impulses that eventually guarantee a floor state.
    if (family === "torso" && strength <= 10 && !event.immediateMotorLoss) {
      this.reaction.strength = Math.min(this.reaction.strength, 0.52);
      this.shock = Math.min(this.shock, 0.58);
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
    const hp = v(hand.translation());
    const hv = v(hand.linvel());
    const av = v(anchor.linvel());
    const force = goal
      .clone()
      .sub(hp)
      .multiplyScalar(115 + strength * 85)
      .addScaledVector(hv.sub(av), -(12 + strength * 6));
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
    const t = this.age;
    const tremor = b.panic > 0.5 ? Math.sin(t * 18) * 0.012 * b.panic : 0;

    if (family === "torso") {
      // Both hands converge on/around the actual wound point. Offset them so
      // they don't occupy exactly the same point and fight the constraints.
      const leftGoal = wound.clone().add(new THREE.Vector3(-0.045, -0.015 + tremor, 0.055));
      const rightGoal = wound.clone().add(new THREE.Vector3(0.045, 0.02 - tremor, 0.065));
      this.pullHandTo("handL", this.guardWound.part, leftGoal, intensity, dt);
      this.pullHandTo("handR", this.guardWound.part, rightGoal, intensity, dt);

      // Curl protectively around the painful area without turning the response
      // into a giant knockback or a forced crouch.
      const curl = clamp(0.08 + intensity * 0.2, 0.08, 0.3);
      const abdomenTarget = new THREE.Quaternion().setFromEuler(new THREE.Euler(curl * 0.55, 0, 0));
      const chestTarget = new THREE.Quaternion().setFromEuler(new THREE.Euler(curl, 0, 0));
      this.cohere(this.body("pelvis"), this.body("abdomen"), abdomenTarget, 48, 5, 26, 0.46, dt);
      this.cohere(this.body("abdomen"), chest, chestTarget, 42, 4.5, 24, 0.48, dt);
    } else if (family === "head") {
      const head = this.body("head");
      const hp = v(head.translation());
      this.pullHandTo("handL", "head", hp.clone().add(new THREE.Vector3(-0.12, 0.015 + tremor, 0.03)), intensity * 0.82, dt);
      this.pullHandTo("handR", "head", hp.clone().add(new THREE.Vector3(0.12, 0.015 - tremor, 0.03)), intensity * 0.82, dt);
    } else if (family === "arm") {
      // The opposite hand protects/grabs the injured arm; the struck arm is
      // allowed to remain weak/withdrawn according to its physiology.
      const injuredSide = this.guardWound.side || "R";
      const helperSide = injuredSide === "L" ? "R" : "L";
      const injured = this.body(this.guardWound.part);
      const goal = v(injured.translation()).add(new THREE.Vector3(0, -0.03 + tremor, 0.04));
      this.pullHandTo("hand" + helperSide, this.guardWound.part, goal, intensity, dt);
    } else if (family === "leg") {
      // Reaching down while upright can itself cause a fall. Keep the hands free
      // for balance until the person is already crouched/bracing, then protect
      // the injured limb.
      if (pelvisPos.y < 0.78 || ["brace", "down", "collapse"].includes(this.state) || b.phase === "kneel") {
        const targetPart = this.body(this.guardWound.part);
        const goal = v(targetPart.translation()).add(new THREE.Vector3(0, 0.05, 0.04));
        const handSide = this.guardWound.side || "L";
        this.pullHandTo("hand" + handSide, this.guardWound.part, goal, intensity * 0.75, dt);
      }
    }

    // Small protective shoulder tension makes guarding read as intentional even
    // when a hand hasn't yet reached the wound.
    if (family === "torso" || family === "head") {
      for (const side of ["L", "R"]) {
        const sign = side === "L" ? -1 : 1;
        const upper = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(-0.36 - intensity * 0.16, 0, sign * (0.18 + intensity * 0.12)),
        );
        const lower = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.72 - intensity * 0.28, 0, 0));
        this.cohere(chest, this.body("upperArm" + side), upper, 28, 3.2, 18, 0.48, dt);
        this.cohere(this.body("upperArm" + side), this.body("lowerArm" + side), lower, 23, 2.5, 15, 0.5, dt);
      }
    }

    // A little torso sway during panic; deterministic, not random jitter.
    if (b.phase === "panic" && chestPos.y > 0.85) {
      const sway = Math.sin(t * 5.2) * 0.045 * b.panic;
      const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sway));
      this.cohere(this.body("abdomen"), chest, target, 16, 2.4, 10, 0.32, dt);
    }
  }

  applyPanicMovement(dt) {
    const b = this.behavior;
    const p = this.physiology;
    if (!b?.wantsPanicStep() || !p || p.unconscious || this.dead) return;
    if (this.step.phase !== "idle" || this.step.cooldown > 0 || this.support < 0.2) return;

    const pelvis = v(this.body("pelvis").translation());
    const dir = v(this.lastHit?.dir || { x: 0, y: 0, z: -1 });
    dir.y = 0;
    if (dir.lengthSq() < 1e-5) dir.set(0, 0, -1);
    dir.normalize();

    // Bullet travel direction points away from the source after impact, so this
    // produces a frightened retreat/side-step instead of robotic in-place sway.
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const weave = Math.sin((this.age + b.hitCount) * 3.1) * 0.16 * b.panic;
    const target = pelvis
      .clone()
      .addScaledVector(dir, 0.24 + b.retreat * 0.22)
      .addScaledVector(side, weave);
    if (this.startScrambleStep(target)) b.consumeStep();
  }

  applyPainKneel(dt) {
    const b = this.behavior;
    const p = this.physiology;
    if (!b || b.phase !== "kneel" || !p || p.unconscious || this.dead) return;

    // Conscious pain-kneeling is controlled flexion, not an instant ragdoll.
    // If physiology later deteriorates, the normal collapse path takes over.
    if (!["down", "collapse", "limp"].includes(this.state)) this.setState("brace");
    const amount = clamp(b.kneelIntent, 0, 1);
    for (const side of ["L", "R"]) {
      const hip = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12 - amount * 0.18, 0, 0));
      const knee = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28 + amount * 0.46, 0, 0));
      this.cohere(this.body("pelvis"), this.body("thigh" + side), hip, 36, 4, 25, 0.42, dt);
      this.cohere(this.body("thigh" + side), this.body("shin" + side), knee, 34, 3.5, 24, 0.46, dt);
    }
  }

  update(dt) {
    if (this.behavior && this.physiology) this.behavior.update(dt, this.physiology);
    super.update(dt);
    if (!this.behavior || !this.physiology || this.dead) return;
    this.applyGuarding(dt);
    this.applyPanicMovement(dt);
    this.applyPainKneel(dt);
  }

  behaviorSnapshot() {
    return this.behavior?.snapshot?.() ?? null;
  }
}
