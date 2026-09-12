import * as THREE from "three";
import { BiologicalArtagdollHumanV21 } from "./biological_human_v21.js";

const v = (p) => new THREE.Vector3(p.x, p.y, p.z);
const clamp = THREE.MathUtils.clamp;

// V22 keeps the expressive V21 panic response but makes grounded movement feel
// heavy. The earlier controller could occasionally accelerate a segment to
// videogame-like speeds while writhing. This governor only removes excessive
// *relative* body-part velocity through equal/opposite internal forces, so it
// cannot pin the character to the floor or erase whole-body momentum.
export class BiologicalArtagdollHumanV22 extends BiologicalArtagdollHumanV21 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v22-heavy-ground-panic";
    this.groundBursts = 0;
  }

  startGroundReaction() {
    super.startGroundReaction();
    if (this.trauma?.groundActive && this.trauma.mode === "panic") {
      this.trauma.groundDuration = Math.max(this.trauma.groundDuration, 6.6 + (this.trauma.panicScore ?? 0) * 1.1);
      this.groundBursts = 0;
    }
  }

  applyGroundPanicBursts(dt) {
    const t = this.trauma;
    if (!t?.groundActive || t.mode !== "panic" || this.dead || this.physiology?.unconscious) return;

    const chest = this.body("chest");
    const pelvis = this.body("pelvis");
    if (!chest || !pelvis) return;

    // Short irregular effort bursts keep the motion from reading like a smooth
    // looping animation. They twist the articulated body internally rather than
    // adding a world-space knockback.
    const age = t.groundAge ?? 0;
    const pulse = Math.max(0, Math.sin(age * 3.6 + t.hitSerial * 0.91)) *
      Math.max(0, Math.sin(age * 1.13 + 0.4));
    const decay = Math.exp(-age / 5.5);
    if (pulse > 0.5 && decay > 0.12) {
      const sign = Math.sin(age * 2.17 + t.hitSerial) >= 0 ? 1 : -1;
      const torque = new THREE.Vector3(0.9 * sign, 0.45 * sign, -0.65 * sign)
        .multiplyScalar((pulse - 0.5) * decay * 9.5);
      this.torquePair(pelvis, chest, torque, 8.5, dt, true);
    }
  }

  applyGroundVelocityGovernor(dt) {
    const t = this.trauma;
    if (!t?.groundActive || this.dead || this.physiology?.unconscious) return;

    const pelvis = this.body("pelvis");
    if (!pelvis) return;
    const pelvisV = v(pelvis.linvel());

    for (const [name, part] of this.parts.entries()) {
      const rb = part?.rb;
      if (!rb || rb === pelvis) continue;
      const relative = v(rb.linvel()).sub(pelvisV);
      const speed = relative.length();
      const limb = /Arm|hand|thigh|shin|foot/.test(name);
      const limit = limb ? 4.15 : name === "head" ? 3.7 : 3.45;
      if (speed <= limit) continue;

      const excess = speed - limit;
      const cap = limb ? 112 : 126;
      const brake = relative
        .normalize()
        .multiplyScalar(-clamp(36 + excess * 58, 36, cap));
      this.forcePair(rb, pelvis, brake, cap, dt);
    }
  }

  update(dt) {
    super.update(dt);
    if (!this.trauma?.groundActive) return;
    this.applyGroundPanicBursts(dt);
    this.applyGroundVelocityGovernor(dt);
  }
}
