import { BiologicalArtagdollHumanV10 } from "./biological_human_v10.js";
import { HitReactionDirector } from "./hit_reaction_profiles.js";

// The profile director is useful for sequencing intent, but a painful conscious
// torso injury must not end by pretending the nervous system switched off.
// This variant converts that terminal scripted ragdoll into a conscious grounded
// coping state. True ragdoll still comes from actual physiology: unconsciousness,
// severe CNS failure, or death.
class ConsciousReactionDirector extends HitReactionDirector {
  update(dt, physiology, limbCapacity = 1) {
    if (this.phase === "grounded") {
      this.age += dt;
      this.phaseAge += dt;
      if (physiology?.dead || physiology?.unconscious) {
        this.setPhase("ragdoll");
        this.finalRagdoll = true;
      }
      return;
    }

    super.update(dt, physiology, limbCapacity);

    const consciousTorsoPainCollapse =
      this.phase === "ragdoll" &&
      this.finalRagdoll &&
      this.delayedCollapse &&
      ["chest", "abdomen", "pelvis"].includes(this.zone) &&
      !physiology?.dead &&
      !physiology?.unconscious &&
      (physiology?.consciousness ?? 1) > 0.3;

    if (consciousTorsoPainCollapse) {
      this.finalRagdoll = false;
      this.setPhase("grounded");
    }
  }

  activeDriveScale() {
    if (this.phase === "grounded") return 0.34;
    return super.activeDriveScale();
  }
}

export class BiologicalArtagdollHumanV11 extends BiologicalArtagdollHumanV10 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v11-conscious-coping";
    this.hitReaction = new ConsciousReactionDirector();
  }

  update(dt) {
    super.update(dt);
    const r = this.hitReaction;
    const p = this.physiology;
    const b = this.behavior;
    if (!r || !p || !b || this.dead) return;

    if (r.phase === "grounded" && !p.unconscious) {
      if (b.phase !== "groundGuard") {
        b.phase = "groundGuard";
        b.phaseAge = 0;
      }
      b.guard = Math.max(b.guard, 0.46);
      b.painFocus = Math.max(b.painFocus, r.pain * 0.72);
      // If the body has not quite reached the floor yet, keep the voluntary
      // pain-kneel active instead of abruptly removing the last support effort.
      if (this.body("pelvis")?.translation().y > 0.62 && !["down", "collapse"].includes(this.state)) {
        this.setState("brace");
      }
    }
  }
}
