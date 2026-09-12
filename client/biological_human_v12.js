import { BiologicalArtagdollHumanV11 } from "./biological_human_v11.js";

// v12 preserves v11's conscious ground-guarding moment, then hands a severe
// torso reaction over to the passive ragdoll after the readable human sequence
// has completed. This is a sandbox presentation state, not a claim that pain
// itself physiologically causes unconsciousness or death.
export class BiologicalArtagdollHumanV12 extends BiologicalArtagdollHumanV11 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v12-delayed-ragdoll-handoff";
    this.passiveHandoff = false;
  }

  hit(part, dir, strength = 12, point) {
    const event = super.hit(part, dir, strength, point);
    this.passiveHandoff = false;
    return event;
  }

  controlDrive() {
    if (this.passiveHandoff) return 0.025;
    return super.controlDrive();
  }

  update(dt) {
    super.update(dt);
    const r = this.hitReaction;
    const p = this.physiology;
    if (!r || !p || this.dead) return;

    // Catastrophic physiology remains immediate. The special delayed handoff
    // only applies to the strong torso sequence the user can visibly read first:
    // impact -> clutch -> panic/stumble -> kneel -> grounded guard -> passive.
    const completedStrongTorsoSequence =
      r.phase === "grounded" &&
      r.phaseAge > 0.9 &&
      r.delayedCollapse &&
      ["chest", "abdomen", "pelvis"].includes(r.zone) &&
      !p.unconscious &&
      !p.dead;

    if (completedStrongTorsoSequence && !this.passiveHandoff) {
      this.passiveHandoff = true;
      r.setPhase("ragdoll");
      r.finalRagdoll = true;
      this.step.phase = "idle";
      if (this.behavior) {
        this.behavior.phase = "collapse";
        this.behavior.guard = 0;
        this.behavior.retreat = 0;
      }
      this.setState("collapse");
    }
  }

  behaviorSnapshot() {
    const base = super.behaviorSnapshot?.() ?? null;
    return {
      base,
      passiveHandoff: this.passiveHandoff,
      reaction: this.hitReaction?.snapshot?.() ?? null,
    };
  }
}
