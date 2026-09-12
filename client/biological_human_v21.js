import { BiologicalArtagdollHumanV19 } from "./biological_human_v19.js";

const TORSO = /^(chest|abdomen|pelvis)$/;

// V21 treats several rapid low-energy torso impacts as one escalating event.
// A single weak hit can still flinch/guard and recover. Three fast hits can push
// an otherwise conscious person into the same panic system used by a severe
// chest wound: disorganised physical stepping, loose torso rotation, imperfect
// bracing and -- if the body reaches the floor -- active conscious writhing.
// This replaces the old requirement that three light hits must always end in a
// pristine standing pose, while still forbidding an instant passive/dead ragdoll.
export class BiologicalArtagdollHumanV21 extends BiologicalArtagdollHumanV19 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v21-cumulative-panic";
    this.rapidTorsoHits = 0;
    this.rapidTorsoAge = 99;
  }

  activateCumulativePanic() {
    if (this.dead || this.physiology?.unconscious) return;
    const t = this.trauma;
    t.active = true;
    t.mode = "panic";
    t.age = 0;
    t.hitSerial++;
    t.panicScore = Math.max(t.panicScore ?? 0, 0.9);
    t.groundActive = false;
    t.groundAge = 0;
    t.groundDuration = 5.8;
    this.passiveHandoff = false;

    if (this.behavior) {
      this.behavior.panic = Math.max(this.behavior.panic, 0.84);
      this.behavior.retreat = Math.max(this.behavior.retreat, 0.68);
      this.behavior.guard = Math.max(this.behavior.guard, 0.7);
      this.behavior.maxGuardSteps = Math.max(this.behavior.maxGuardSteps, 2);
      this.behavior.nextStep = Math.min(this.behavior.nextStep, 0.16);
    }
  }

  hit(part, dir, strength = 12, point) {
    const rapidLightTorso =
      TORSO.test(part || "") &&
      strength <= 10 &&
      strength >= 5;

    if (rapidLightTorso) {
      this.rapidTorsoHits = this.rapidTorsoAge < 0.72
        ? this.rapidTorsoHits + 1
        : 1;
      this.rapidTorsoAge = 0;
    } else if (TORSO.test(part || "") && strength > 10) {
      this.rapidTorsoHits = 0;
      this.rapidTorsoAge = 99;
    }

    const event = super.hit(part, dir, strength, point);
    if (
      event &&
      rapidLightTorso &&
      this.rapidTorsoHits >= 3 &&
      !event.immediateMotorLoss &&
      !this.dead &&
      !this.physiology?.unconscious
    ) {
      this.activateCumulativePanic();
    }
    return event;
  }

  update(dt) {
    this.rapidTorsoAge += dt;
    if (this.rapidTorsoAge > 1.15 && !this.trauma?.active) this.rapidTorsoHits = 0;
    super.update(dt);
  }

  traumaSnapshot() {
    return {
      ...super.traumaSnapshot(),
      rapidTorsoHits: this.rapidTorsoHits,
      rapidTorsoAge: this.rapidTorsoAge,
    };
  }
}
