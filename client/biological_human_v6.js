import * as THREE from "three";
import { BiologicalArtagdollHuman } from "./biological_human.js";
import { familyOf } from "./physiology.js";

const clamp = THREE.MathUtils.clamp;
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);

// v6 separates four things that should not be conflated visually:
//   1) projectile momentum (small/local),
//   2) pain/startle flinch (fast/local),
//   3) loss of coordination (CNS/physiology),
//   4) true loss of consciousness/motor drive (global collapse).
// That prevents the common game mistake where every head or torso hit behaves
// like a huge knockback or an instant global "ragdoll switch".
export class BiologicalArtagdollHumanV6 extends BiologicalArtagdollHuman {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v6";
  }

  systemicDrive() {
    const p = this.physiology;
    if (!p || this.dead) return this.dead ? 0 : 1;

    // If consciousness is actually lost, honour it. Otherwise preserve a
    // meaningful amount of gross motor drive while CNS shock primarily damages
    // coordination. This creates dazed/stumbling behaviour instead of an
    // automatic full-body fold after every nonfatal cranial hit.
    const awareness = p.unconscious
      ? p.consciousness
      : Math.max(p.consciousness, 0.68 + p.brainFunction * 0.24);
    const perfusionDrive = 0.46 + p.perfusion * 0.54;
    const oxygenDrive = 0.72 + p.oxygenation * 0.28;
    const stressCompensation = clamp(0.97 + p.adrenaline * 0.06, 0.97, 1.025);
    return clamp(
      awareness * perfusionDrive * oxygenDrive * stressCompensation,
      0,
      1,
    );
  }

  controlDrive() {
    const p = this.physiology;
    if (!p) return 1;
    const gross = this.systemicDrive();
    if (p.unconscious) return gross * 0.08;

    const neurologicCoordination = clamp(
      p.brainFunction * (1 - Math.min(1, p.cnsShock) * 0.3),
      0,
      1,
    );
    const coordination = Math.max(p.coordination, neurologicCoordination);
    const reflexFloor = p.postureMode ? 0.25 : 0;
    return Math.max(reflexFloor, gross * (0.56 + coordination * 0.44));
  }

  hit(part, dir, strength = 12, point) {
    const rb = this.body(part) || this.body("chest");
    const direction = v(dir);
    if (!rb || direction.lengthSq() < 1e-10) return null;
    direction.normalize();
    const hitPoint = v(point || rb.translation());
    const family = familyOf(part);

    const event = super.hit(part, direction, strength, hitPoint);
    if (!event) return event;

    // The v5 layer already applied a deliberately reduced local impulse. For a
    // non-catastrophic cranial hit, reduce it again: the visible response should
    // come from neck yield, balance loss and CNS state, not whole-body knockback.
    if (family === "head" && !event.immediateMotorLoss) {
      rb.applyImpulseAtPoint(
        direction.clone().multiplyScalar(-clamp(strength, 0, 28) * 0.075),
        hitPoint,
        true,
      );
      const counterTorque = new THREE.Vector3(direction.z, 0, -direction.x)
        .multiplyScalar(-strength * 0.011);
      rb.applyTorqueImpulse(counterTorque, true);

      // Keep the head/neck visibly affected while avoiding an artificial global
      // shutdown. True immediate motor loss remains untouched.
      this.reaction.strength = clamp(
        Math.max(this.reaction.strength, 0.42 + event.startle * 0.22),
        0.38,
        0.72,
      );
      this.reaction.headStun = Math.min(this.reaction.headStun, 0.74);
    }

    // Torso hits need a visible protective/local response even when projectile
    // momentum is low. Increase only the procedural flinch target; do not add
    // translational knockback.
    if (family === "torso" && !event.immediateMotorLoss) {
      this.reaction.strength = clamp(
        Math.max(
          this.reaction.strength,
          0.36 + event.startle * 0.38 + event.painSpike * 0.22,
        ),
        0.38,
        0.95,
      );
    }

    if ((family === "arm" || family === "leg") && !event.immediateMotorLoss) {
      this.reaction.strength = clamp(
        Math.max(
          this.reaction.strength,
          0.32 + event.withdrawal * 0.4 + event.motorShock * 0.18,
        ),
        0.34,
        0.92,
      );
    }

    return event;
  }
}
