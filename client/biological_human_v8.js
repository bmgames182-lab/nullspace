import * as THREE from "three";
import { BiologicalArtagdollHumanV7 } from "./biological_human_v7.js";

const clamp = THREE.MathUtils.clamp;
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);
const q = (value) => new THREE.Quaternion(value.x, value.y, value.z, value.w);

// v8 makes conscious distress visibly different from neurological collapse:
// guarded steps, threat attention, and a controlled pain-kneel keep active
// muscles online while the person protects the wound.
export class BiologicalArtagdollHumanV8 extends BiologicalArtagdollHumanV7 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v8-distress-sequence";
  }

  applyThreatAttention(dt) {
    const b = this.behavior;
    const p = this.physiology;
    if (!b || !p || p.unconscious || this.dead) return;
    if (b.family !== "torso" || !["guard", "panic"].includes(b.phase)) return;
    if (b.injuryAge < 0.28 || b.injuryAge > 2.4) return;

    const chest = this.body("chest");
    const head = this.body("head");
    const pelvis = this.body("pelvis");
    if (!chest || !head || !pelvis) return;

    // Threat source is opposite projectile travel. Convert it to pelvis-local
    // space so side hits make the head turn toward where the shot came from.
    const source = v(this.lastHit?.dir || { x: 0, y: 0, z: -1 }).multiplyScalar(-1);
    source.y = 0;
    if (source.lengthSq() < 1e-6) return;
    source.normalize().applyQuaternion(q(pelvis.rotation()).invert());
    const yaw = clamp(Math.atan2(source.x, Math.max(0.05, source.z)), -0.55, 0.55);
    const scan = Math.sin(this.age * 3.2) * 0.055 * b.panic;
    const target = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-0.08 - b.guard * 0.05, yaw * 0.62 + scan, 0),
    );
    this.cohere(chest, head, target, 11, 1.8, 7.5, 0.42, dt);
  }

  applyPainKneel(dt) {
    super.applyPainKneel(dt);
    const b = this.behavior;
    const p = this.physiology;
    if (!b || b.phase !== "kneel" || !p || p.unconscious || this.dead) return;

    const amount = clamp(b.kneelIntent, 0, 1);
    const pelvis = this.body("pelvis");
    if (!pelvis) return;

    // Lower the centre of mass through the actual grounded feet. This is an
    // internal force pair, not a magic downward teleport; feet push into the
    // floor while the pelvis settles. Active guarding continues throughout.
    for (const side of ["L", "R"]) {
      const foot = this.body("foot" + side);
      const quality = this.feet?.[side]?.quality ?? 0;
      if (!foot || quality < 0.18) continue;
      const settleForce = new THREE.Vector3(
        0,
        -(70 + amount * 115) * quality,
        0,
      );
      this.forcePair(pelvis, foot, settleForce, 185, dt);
    }

    // Add a small forward protective curl as the knees lower. This makes the
    // motion read as pain/guarding rather than the legs simply losing power.
    const abdomen = this.body("abdomen");
    const chest = this.body("chest");
    if (abdomen && chest) {
      const abdomenTarget = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.1 + amount * 0.14, 0, 0),
      );
      const chestTarget = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.14 + amount * 0.18, 0, 0),
      );
      this.cohere(pelvis, abdomen, abdomenTarget, 34, 4, 20, 0.4, dt);
      this.cohere(abdomen, chest, chestTarget, 30, 3.6, 18, 0.42, dt);
    }
  }

  update(dt) {
    super.update(dt);
    if (this.dead || this.physiology?.unconscious) return;
    this.applyThreatAttention(dt);
  }
}
