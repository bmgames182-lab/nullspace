import { BiologicalArtagdollHumanV19 } from "./biological_human_v19.js";

const LIGHT_TORSO_MAX = 10;
const TORSO = /^(chest|abdomen|pelvis)$/;

// V20 keeps repeated light torso hits painful and protective without allowing
// their accumulated startle variable to keep the whole torso deliberately in a
// panic sway. Real COM instability is still free to request capture steps and
// all normal active-balance corrections; this only limits behavior-generated
// destabilization for low-energy trauma.
export class BiologicalArtagdollHumanV20 extends BiologicalArtagdollHumanV19 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v20-light-trauma-settling";
    this.lightTorsoEpisodeAge = 99;
  }

  hit(part, dir, strength = 12, point) {
    const event = super.hit(part, dir, strength, point);
    if (
      event &&
      TORSO.test(part || "") &&
      strength <= LIGHT_TORSO_MAX &&
      !event.immediateMotorLoss &&
      !this.dead &&
      !this.physiology?.unconscious
    ) {
      this.lightTorsoEpisodeAge = 0;
      if (this.behavior) {
        this.behavior.panic = Math.min(this.behavior.panic, 0.4);
        this.behavior.retreat = Math.min(this.behavior.retreat, 0.22);
        this.behavior.maxGuardSteps = 0;
        this.behavior.nextStep = Math.max(this.behavior.nextStep, 0.6);
        if (this.behavior.phase === "panic") {
          this.behavior.phase = "guard";
          this.behavior.phaseAge = 0;
        }
      }
    }
    return event;
  }

  update(dt) {
    this.lightTorsoEpisodeAge += dt;

    // A weak-hit episode may raise pain/guarding for several seconds, but once
    // the acute startle window has passed it should not continuously re-enter a
    // behavior-driven panic sway. This is intentionally independent from the
    // balance controller: if the body is actually unstable, COM/capture-point
    // logic can still produce stumble states and unlimited real rescue steps.
    if (
      this.lightTorsoEpisodeAge < 4.8 &&
      this.behavior &&
      this.behavior.family === "torso" &&
      this.behavior.lastStrength <= LIGHT_TORSO_MAX &&
      !this.dead &&
      !this.physiology?.unconscious
    ) {
      this.behavior.panic = Math.min(this.behavior.panic, 0.4);
      this.behavior.retreat = Math.min(this.behavior.retreat, 0.22);
      this.behavior.maxGuardSteps = 0;
      if (this.behavior.phase === "panic") {
        this.behavior.phase = "guard";
        this.behavior.phaseAge = 0;
      }
    }

    super.update(dt);
  }
}
