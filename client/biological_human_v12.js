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

  enforcePassiveHandoff() {
    const r = this.hitReaction;
    if (!r) return;
    // V11 intentionally maps a conscious terminal torso reaction back to its
    // grounded-coping phase. Once V12 has completed the requested sandbox
    // handoff, make that transition one-way instead of oscillating every frame.
    if (r.phase !== "ragdoll") r.setPhase("ragdoll");
    r.finalRagdoll = true;
    this.step.phase = "idle";
    if (this.behavior) {
      this.behavior.phase = "collapse";
      this.behavior.guard = 0;
      this.behavior.retreat = 0;
    }
    if (!["down", "limp"].includes(this.state)) this.setState("collapse");
  }

  update(dt) {
    super.update(dt);
    const r = this.hitReaction;
    const p = this.physiology;
    if (!r || !p || this.dead) return;

    // Super/V11 may intentionally restore "grounded" for a conscious person.
    // After the presentation handoff has begun, immediately restore passive
    // ragdoll so active coping cannot switch itself back on.
    if (this.passiveHandoff) {
      this.enforcePassiveHandoff();
      return;
    }

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

    if (completedStrongTorsoSequence) {
      this.passiveHandoff = true;
      this.enforcePassiveHandoff();
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
