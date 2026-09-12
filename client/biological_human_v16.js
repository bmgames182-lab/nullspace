import { BiologicalArtagdollHumanV15 } from "./biological_human_v15.js";

const TORSO_ZONES = new Set(["chest", "abdomen", "pelvis"]);

// V16 separates two ideas that used to be accidentally stacked:
//   1) behavioral panic/retreat steps caused by pain/startle
//   2) real capture/recovery steps caused by COM/support failure
// The whole-body balance controller owns (2) and is never budget-limited here.
// This class only keeps (1) finite and proportional to trauma severity.
export class BiologicalArtagdollHumanV16 extends BiologicalArtagdollHumanV15 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v16-physics-first-step-budget";
  }

  hit(part, dir, strength = 12, point) {
    const previousZone = this.hitReaction?.zone;
    const previousAge = this.hitReaction?.age ?? 99;
    const previousDirectedSteps = this.directedSteps ?? 0;
    const previousWasTorso = TORSO_ZONES.has(previousZone);
    const nextIsTorso = TORSO_ZONES.has(part);

    const event = super.hit(part, dir, strength, point);
    if (!event) return event;

    // Rapid hits are one coping episode, not three fresh stumble animations.
    // V10 resets directedSteps on every hit; restore the already-spent budget
    // for a rapid torso follow-up. A stronger follow-up can still have a larger
    // total budget, but it cannot refund steps that were already taken.
    if (previousWasTorso && nextIsTorso && previousAge < 0.8) {
      this.directedSteps = Math.max(this.directedSteps ?? 0, previousDirectedSteps);
    }
    return event;
  }

  applyPanicMovement() {
    const r = this.hitReaction;
    if (!r || this.dead || this.physiology?.unconscious) {
      return super.applyPanicMovement();
    }

    if (TORSO_ZONES.has(r.zone) && !r.delayedCollapse) {
      // Recoverable torso trauma can still flinch, clutch and look alarmed, but
      // pain alone must not force repeated locomotion. Strength < 11 receives no
      // choreography step. Moderate torso trauma gets at most one. If the COM
      // really escapes the support polygon, EuphoriaBalanceController is free
      // to request additional physical rescue steps independently.
      const behavioralBudget = r.strength >= 11 ? 1 : 0;
      if (behavioralBudget === 0) return;
      if (this.directedSteps >= behavioralBudget) return;
      if (r.phase !== "panic") return;
      return super.applyPanicMovement();
    }

    // Severe delayed-collapse torso trauma keeps the deliberately readable
    // clutch -> panic -> kneel sequence, while head/leg/arm reactions retain
    // their existing zone-specific behavior.
    return super.applyPanicMovement();
  }

  behaviorSnapshot() {
    const base = super.behaviorSnapshot?.() ?? null;
    const r = this.hitReaction;
    const behavioralStepBudget =
      r && TORSO_ZONES.has(r.zone)
        ? r.delayedCollapse
          ? r.profile?.panicSteps ?? 0
          : r.strength >= 11
            ? 1
            : 0
        : null;
    return {
      base,
      behavioralStepBudget,
      directedSteps: this.directedSteps,
    };
  }
}
