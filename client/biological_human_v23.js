import { BiologicalArtagdollHumanV22 } from "./biological_human_v22.js";

// V23 closes a visual edge case in the V17 ground detector. A bracing arm can
// touch the floor while the pelvis is still essentially standing-height; that
// must not relabel the character as grounded and start the writhing controller.
// Ground coping now starts only when the torso is really low, torso contact is
// present, or an arm brace accompanies an already-low descending body.
export class BiologicalArtagdollHumanV23 extends BiologicalArtagdollHumanV22 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v23-real-ground-gate";
  }

  maybeStartGroundReaction() {
    const t = this.trauma;
    const r = this.hitReaction;
    if (!t?.active || t.groundActive || !r || this.dead || this.physiology?.unconscious) return;

    const pelvisY = this.body("pelvis")?.translation().y ?? 2;
    const chestY = this.body("chest")?.translation().y ?? 2;
    const torsoContact =
      this.contact("pelvis") ||
      this.contact("abdomen") ||
      this.contact("chest");
    const armBrace =
      this.contact("upperArmL") ||
      this.contact("upperArmR") ||
      this.contact("lowerArmL") ||
      this.contact("lowerArmR") ||
      this.contact("handL") ||
      this.contact("handR");

    const collapsedState = this.state === "collapse" || this.state === "down";
    const reactionLow = ["kneel", "failing", "grounded", "ragdoll"].includes(r.phase);
    const bodyActuallyLow = pelvisY < 0.64 || chestY < 0.76;
    const lowArmBrace = armBrace && pelvisY < 0.76 && chestY < 0.92;

    if (
      r.phase === "grounded" ||
      (t.age > 0.72 &&
        (torsoContact || bodyActuallyLow || lowArmBrace) &&
        (reactionLow || collapsedState))
    ) {
      this.startGroundReaction();
    }
  }
}
