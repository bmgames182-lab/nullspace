import * as THREE from "three";
import { BiologicalArtagdollHumanV13 } from "./biological_human_v13.js";

const clamp = THREE.MathUtils.clamp;
const v = (p) => new THREE.Vector3(p.x, p.y, p.z);

// V14 adds a short-lived disturbance sensor in front of V13's low-level support
// controller. An external shove changes upper-body velocity immediately; if we
// wait until all legacy support impulses have run, that evidence can disappear
// before the capture-step controller sees it. We therefore remember sudden
// horizontal momentum changes for a few tenths of a second and let balance use
// that transient without turning small pushes into scripted steps.
export class BiologicalArtagdollHumanV14 extends BiologicalArtagdollHumanV13 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v14-impulse-aware-balance";
    this.disturbanceRisk = 0;
    this.disturbanceDirection = new THREE.Vector3(0, 0, 1);
    this._previousChestVelocity = v(this.body("chest").linvel());
    this._previousPelvisVelocity = v(this.body("pelvis").linvel());
    this._previousComVelocity = this.centreOfMass().velocity.clone();
    this._disturbanceReady = false;
  }

  detectDisturbance(dt) {
    const chest = this.body("chest");
    const pelvis = this.body("pelvis");
    if (!chest || !pelvis || this.dead || this.physiology?.unconscious || this.passiveHandoff) {
      this.disturbanceRisk *= Math.exp(-dt * 6);
      return;
    }

    const chestV = v(chest.linvel());
    const pelvisV = v(pelvis.linvel());
    const comV = this.centreOfMass().velocity;
    const chestDv = chestV.clone().sub(this._previousChestVelocity).setY(0);
    const pelvisDv = pelvisV.clone().sub(this._previousPelvisVelocity).setY(0);
    const comDv = comV.clone().sub(this._previousComVelocity).setY(0);

    if (this._disturbanceReady && this.age > 0.8) {
      // Chest delta is most sensitive to an actual torso shove; pelvis and COM
      // deltas keep hip/pelvis disturbances visible. Local arm/thigh pulls do
      // not automatically look like whole-body danger because their COM delta
      // remains small.
      const chestKick = clamp((chestDv.length() - 0.075) / 0.42, 0, 1.15);
      const pelvisKick = clamp((pelvisDv.length() - 0.055) / 0.34, 0, 1.1);
      const comKick = clamp((comDv.length() - 0.025) / 0.16, 0, 1.1);
      const detected = clamp(
        Math.max(chestKick * 0.78, pelvisKick * 0.72, comKick * 0.84),
        0,
        1.05,
      );

      if (detected > 0.035) {
        this.disturbanceRisk = Math.max(this.disturbanceRisk, detected);
        const dir = chestDv.lengthSq() > pelvisDv.lengthSq() ? chestDv : pelvisDv;
        if (dir.lengthSq() > 1e-6) this.disturbanceDirection.copy(dir).normalize();
      }
    }

    this.disturbanceRisk *= Math.exp(-dt * 2.9);
    this._previousChestVelocity.copy(chestV);
    this._previousPelvisVelocity.copy(pelvisV);
    this._previousComVelocity.copy(comV);
    this._disturbanceReady = true;
  }

  prepareBalanceForDisturbance(dt) {
    if (!this.balance2 || this.disturbanceRisk < 0.035) return;

    // Sample BEFORE the legacy body controller has a chance to erase the peak.
    this.balance2.sample();
    const geometricRisk = this.balance2.risk;
    this.balance2.risk = Math.max(geometricRisk, this.disturbanceRisk);
    this.balance2.stepNeed = Math.max(
      this.balance2.stepNeed,
      clamp((this.disturbanceRisk - 0.16) * 1.2, 0, 1),
    );

    // Keep the capture direction aligned with the actual shove while the COM is
    // still near the old support polygon. This prevents the first recovery foot
    // from being selected from stale pre-impact geometry.
    if (this.disturbanceRisk > 0.22 && this.disturbanceDirection.lengthSq() > 1e-6) {
      const lead = 0.08 + this.disturbanceRisk * 0.24;
      this.balance2.capture.addScaledVector(this.disturbanceDirection, lead);
      this.balance2.escape.copy(this.balance2.capture).sub(this.balance2.supportCenter).setY(0);
      if (this.balance2.escape.lengthSq() > 1e-6) this.balance2.escape.normalize();
    }

    this.balance2.classify(0);
    this.balance2.maybeRequestRecoveryStep();
  }

  update(dt) {
    this.detectDisturbance(dt);
    this.prepareBalanceForDisturbance(dt);

    super.update(dt);

    // V13 recomputes geometry after the old controller runs. Preserve the short
    // disturbance memory in telemetry/state so the reaction does not visually
    // disappear one frame after the shove and tests can observe the real peak.
    if (this.balance2 && this.disturbanceRisk > 0.035) {
      this.balance2.risk = Math.max(this.balance2.risk, this.disturbanceRisk);
      this.balance2.stepNeed = Math.max(
        this.balance2.stepNeed,
        clamp((this.disturbanceRisk - 0.16) * 1.2, 0, 1),
      );
      this.balance2.classify(0);
    }
  }

  balanceSnapshot() {
    const base = super.balanceSnapshot();
    return base && {
      ...base,
      disturbanceRisk: this.disturbanceRisk,
      disturbanceDirection: {
        x: this.disturbanceDirection.x,
        y: this.disturbanceDirection.y,
        z: this.disturbanceDirection.z,
      },
    };
  }
}
