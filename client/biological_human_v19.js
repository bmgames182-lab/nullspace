import * as THREE from "three";
import { BiologicalArtagdollHumanV18 } from "./biological_human_v18.js";

const v = (p) => new THREE.Vector3(p.x, p.y, p.z);

// V19 keeps V18's expressive panic but makes the swing leg feel heavy. Dramatic
// movement should come from a loose torso, bad balance and imperfect stepping --
// not from a foot accelerating like a servo-driven propeller.
export class BiologicalArtagdollHumanV19 extends BiologicalArtagdollHumanV18 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v19-heavy-panic-steps";
  }

  applyPanicSwingBrake(dt) {
    if (
      this.trauma?.mode !== "panic" ||
      !this.trauma?.active ||
      this.step.phase === "idle" ||
      this.dead ||
      this.physiology?.unconscious
    ) return;

    const foot = this.body("foot" + this.step.side);
    const pelvis = this.body("pelvis");
    if (!foot || !pelvis) return;

    const relative = v(foot.linvel()).sub(v(pelvis.linvel()));
    const speed = relative.length();
    if (speed <= 2.35) return;

    // Equal/opposite braking through the pelvis keeps total linear momentum
    // honest. It only removes excess *internal* swing speed; it cannot freeze
    // the whole character in space or create a magic floor anchor.
    const excess = speed - 2.35;
    const brake = relative
      .normalize()
      .multiplyScalar(-Math.min(92, 34 + excess * 48));
    this.forcePair(foot, pelvis, brake, 92, dt);
  }

  cohere(parent, child, target, gain, damping, cap, activity, dt) {
    if (
      this.trauma?.mode === "panic" &&
      this.step.phase !== "idle" &&
      this._bodyNames
    ) {
      const side = this.step.side;
      const names = [this._bodyNames.get(parent), this._bodyNames.get(child)];
      const swingChain = names.some((name) =>
        name === "thigh" + side || name === "shin" + side || name === "foot" + side,
      );
      if (swingChain) {
        gain *= 0.76;
        damping *= 1.24;
        cap *= 0.7;
      }
    }
    return super.cohere(parent, child, target, gain, damping, cap, activity, dt);
  }

  update(dt) {
    super.update(dt);
    this.applyPanicSwingBrake(dt);
  }
}
