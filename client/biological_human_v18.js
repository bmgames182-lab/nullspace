import { BiologicalArtagdollHumanV17 } from "./biological_human_v17.js";
import { PainAudio } from "./pain_audio.js";

// V18 keeps audio as presentation attached to the physically simulated state.
// The physics never waits for, times itself to, or branches because of a sound.
export class BiologicalArtagdollHumanV18 extends BiologicalArtagdollHumanV17 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v18-trauma-audio";
    this.painAudio = new PainAudio();
  }

  hit(part, dir, strength = 12, point) {
    const event = super.hit(part, dir, strength, point);
    if (event) this.painAudio?.impact?.({ human: this, part, strength, event });
    return event;
  }

  update(dt) {
    super.update(dt);
    this.painAudio?.update?.(this, dt);
  }

  destroy() {
    this.painAudio?.reset?.();
    super.destroy();
  }
}
