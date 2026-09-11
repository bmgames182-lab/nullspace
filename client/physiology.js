const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function sideOf(part) {
  return part?.endsWith("L") ? "L" : part?.endsWith("R") ? "R" : null;
}

function familyOf(part) {
  if (part === "head") return "head";
  if (/pelvis|abdomen|chest/.test(part)) return "torso";
  if (/thigh|shin|foot/.test(part)) return "leg";
  if (/Arm|hand/.test(part)) return "arm";
  return "other";
}

function hash32(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function pointKey(point) {
  if (!point) return "0:0:0";
  const x = Math.round((point.x || 0) * 20);
  const y = Math.round((point.y || 0) * 20);
  const z = Math.round((point.z || 0) * 20);
  return `${x}:${y}:${z}`;
}

function freshLimb() {
  return {
    structure: 1,
    nerve: 1,
    vascular: 1,
    pain: 0,
    fracture: false,
    disabled: false,
  };
}

// A deliberately coarse physiology model for gameplay. It models mechanisms
// (mechanical integrity, peripheral nerve function, circulation, CNS function,
// respiration and stress response) rather than pretending a body-part name can
// deterministically predict a real person's outcome.
export class PhysiologyModel {
  constructor() {
    this.age = 0;
    this.hitCount = 0;
    this.bloodVolume = 1;
    this.perfusion = 1;
    this.oxygenation = 1;
    this.brainFunction = 1;
    this.spinalFunction = 1;
    this.respiration = 1;
    this.consciousness = 1;
    this.motorDrive = 1;
    this.coordination = 1;
    this.pain = 0;
    this.adrenaline = 0.08;
    this.bleedRate = 0;
    this.cnsShock = 0;
    this.systemicShock = 0;
    this.lowOxygenTime = 0;
    this.unconscious = false;
    this.dead = false;
    this.postureMode = null;
    this.postureTime = 0;
    this.lastEvent = null;
    this.limbs = {
      armL: freshLimb(),
      armR: freshLimb(),
      legL: freshLimb(),
      legR: freshLimb(),
    };
  }

  sample(seed, lane = 0) {
    const h = hash32(`${seed}|${lane}`);
    return h / 0xffffffff;
  }

  hit({ part, strength = 12, point = null }) {
    this.hitCount++;
    const family = familyOf(part);
    const side = sideOf(part);
    const base = clamp(strength / 18, 0.04, 1.8);
    const seed = `${part}|${this.hitCount}|${Math.round(strength * 10)}|${pointKey(point)}`;
    const variability = 0.82 + this.sample(seed, 0) * 0.36;
    const severity = clamp(base * variability, 0.03, 1.7);

    const event = {
      family,
      side,
      severity,
      painSpike: 0,
      startle: 0,
      structuralLoss: 0,
      nerveLoss: 0,
      vascularLoss: 0,
      bleedAdded: 0,
      brainLoss: 0,
      spinalLoss: 0,
      respiratoryLoss: 0,
      motorShock: 0,
      withdrawal: 0,
      immediateMotorLoss: false,
      unconscious: false,
      fractured: false,
      postureMode: null,
    };

    if (family === "arm" || family === "leg") {
      const key = `${family}${side}`;
      const limb = this.limbs[key];
      const segmentFactor = /thigh|upperArm/.test(part)
        ? 1.05
        : /shin|lowerArm/.test(part)
          ? 0.95
          : 0.78;
      event.structuralLoss = clamp(
        severity * segmentFactor * (0.07 + this.sample(seed, 1) * 0.2),
        0,
        0.62,
      );
      event.nerveLoss = clamp(
        severity * (0.025 + this.sample(seed, 2) * 0.17),
        0,
        0.52,
      );
      event.vascularLoss = clamp(
        severity * (0.025 + this.sample(seed, 3) * 0.15),
        0,
        0.48,
      );

      // A small subset of otherwise similar impacts cause a much larger local
      // structural or nerve deficit. This creates believable variability without
      // changing the same hit into a magical whole-body impulse.
      if (severity > 0.72 && this.sample(seed, 4) > 0.82)
        event.structuralLoss = clamp(event.structuralLoss + severity * 0.24, 0, 0.78);
      if (severity > 0.68 && this.sample(seed, 5) > 0.86)
        event.nerveLoss = clamp(event.nerveLoss + severity * 0.28, 0, 0.72);

      limb.structure = clamp(limb.structure - event.structuralLoss);
      limb.nerve = clamp(limb.nerve - event.nerveLoss);
      limb.vascular = clamp(limb.vascular - event.vascularLoss);
      event.fractured = limb.structure < 0.5;
      limb.fracture ||= event.fractured;
      limb.disabled = this.localLimbCapacity(family, side) < 0.22;

      event.painSpike = clamp(
        severity * (0.34 + event.structuralLoss * 0.9 + this.sample(seed, 6) * 0.24),
        0,
        1,
      );
      event.startle = clamp(0.18 + severity * 0.34 + this.sample(seed, 7) * 0.16, 0, 0.9);
      event.motorShock = clamp(
        severity * 0.22 + event.nerveLoss * 1.25 + event.structuralLoss * 0.72,
        0,
        1,
      );
      event.withdrawal = clamp(
        event.painSpike * 0.72 + event.motorShock * 0.42,
        0,
        1,
      );
      event.bleedAdded =
        0.00018 + severity * 0.00028 + event.vascularLoss * 0.0026;
      limb.pain = clamp(limb.pain + event.painSpike * 0.8);
    } else if (family === "torso") {
      const chest = part === "chest";
      const pelvis = part === "pelvis";
      event.painSpike = clamp(severity * (0.42 + this.sample(seed, 1) * 0.32), 0, 1);
      event.startle = clamp(0.22 + severity * 0.38 + this.sample(seed, 2) * 0.16, 0, 0.95);
      event.vascularLoss = clamp(severity * (0.05 + this.sample(seed, 3) * 0.2), 0, 0.5);
      event.bleedAdded =
        0.00035 + severity * 0.00055 + event.vascularLoss * 0.0032;
      event.respiratoryLoss = chest
        ? clamp(severity * (0.015 + this.sample(seed, 4) * 0.1), 0, 0.28)
        : 0;

      // Penetrating torso trauma can produce a neurological deficit, but most
      // torso hits should not behave as spinal-cord hits. Keep this uncommon and
      // mechanism-specific rather than tying it to generic torso damage.
      const spinalRoll = this.sample(seed, 5);
      if (severity > 0.78 && spinalRoll > 0.93) {
        event.spinalLoss = clamp(
          severity * (0.26 + this.sample(seed, 6) * (pelvis ? 0.38 : 0.55)),
          0,
          0.82,
        );
      } else {
        event.spinalLoss = severity * spinalRoll * 0.012;
      }
      event.motorShock = clamp(
        severity * 0.18 + event.spinalLoss * 0.95 + event.painSpike * 0.13,
        0,
        1,
      );
      this.respiration = clamp(this.respiration - event.respiratoryLoss);
      this.spinalFunction = clamp(this.spinalFunction - event.spinalLoss);
    } else if (family === "head") {
      event.painSpike = clamp(severity * (0.26 + this.sample(seed, 1) * 0.28), 0, 0.88);
      event.startle = clamp(0.2 + severity * 0.32 + this.sample(seed, 2) * 0.15, 0, 0.9);
      event.brainLoss = clamp(
        severity * (0.09 + this.sample(seed, 3) * 0.29),
        0,
        0.72,
      );
      if (severity > 1.05 && this.sample(seed, 4) > 0.68)
        event.brainLoss = clamp(event.brainLoss + severity * 0.24, 0, 0.9);
      this.brainFunction = clamp(this.brainFunction - event.brainLoss);
      this.cnsShock = clamp(
        Math.max(
          this.cnsShock,
          severity * (0.3 + this.sample(seed, 5) * 0.48) + event.brainLoss * 0.45,
        ),
        0,
        1.25,
      );
      event.motorShock = clamp(this.cnsShock, 0, 1);
      event.bleedAdded = 0.00022 + severity * 0.00042;

      if (
        event.brainLoss > 0.48 ||
        this.brainFunction < 0.28 ||
        (severity > 1.2 && this.sample(seed, 6) > 0.62)
      ) {
        event.immediateMotorLoss = true;
        this.consciousness = Math.min(this.consciousness, 0.14);
      } else {
        this.consciousness = clamp(this.consciousness - event.brainLoss * 0.42);
      }

      // Severe brain injury can produce abnormal motor posturing. Keep it rare,
      // short-lived and separate from ordinary hit flinching.
      if (event.brainLoss > 0.38 && this.sample(seed, 7) > 0.7) {
        this.postureMode = this.sample(seed, 8) > 0.5 ? "extensor" : "flexor";
        this.postureTime = 0.35 + this.sample(seed, 9) * 0.75;
        event.postureMode = this.postureMode;
      }
    } else {
      event.painSpike = clamp(severity * 0.45, 0, 0.7);
      event.startle = clamp(0.15 + severity * 0.25, 0, 0.65);
      event.bleedAdded = severity * 0.00025;
    }

    this.bleedRate = clamp(this.bleedRate + event.bleedAdded, 0, 0.018);
    this.pain = clamp(this.pain + event.painSpike * (0.72 + this.sample(seed, 10) * 0.28));
    this.adrenaline = clamp(
      Math.max(this.adrenaline, 0.24 + event.startle * 0.58 + severity * 0.12),
      0,
      1,
    );
    this.systemicShock = clamp(
      this.systemicShock + event.motorShock * 0.16 + event.vascularLoss * 0.12,
      0,
      1,
    );

    event.unconscious = event.immediateMotorLoss || this.consciousness < 0.2;
    this.lastEvent = event;
    return event;
  }

  localLimbCapacity(family, side) {
    if (!side || (family !== "arm" && family !== "leg")) return 1;
    const limb = this.limbs[`${family}${side}`];
    if (!limb) return 1;
    let capacity = limb.structure * (0.28 + limb.nerve * 0.72);
    if (limb.fracture) capacity *= 0.56;
    if (limb.nerve < 0.3) capacity *= 0.58;
    return clamp(capacity);
  }

  limbCapacity(family, side) {
    const local = this.localLimbCapacity(family, side);
    const central = clamp(
      this.motorDrive * (family === "leg" ? this.spinalFunction : 0.62 + this.spinalFunction * 0.38),
      0,
      1,
    );
    return clamp(local * central);
  }

  update(dt) {
    if (dt <= 0) return;
    this.age += dt;

    // External bleeding is persistent on gameplay timescales; spontaneous
    // hemostasis is intentionally slow compared with the short sandbox session.
    const bleedDecay = Math.exp(-dt / 150);
    this.bleedRate *= bleedDecay;
    this.bloodVolume = clamp(this.bloodVolume - this.bleedRate * dt, 0, 1);

    this.pain *= Math.exp(-dt / 24);
    for (const limb of Object.values(this.limbs))
      limb.pain *= Math.exp(-dt / 20);
    this.cnsShock *= Math.exp(-dt / 1.8);
    this.systemicShock *= Math.exp(-dt / 6.5);

    const perfusionTarget = clamp((this.bloodVolume - 0.42) / 0.58, 0, 1);
    this.perfusion +=
      (perfusionTarget - this.perfusion) * (1 - Math.exp(-dt * 0.65));

    const oxygenTarget = clamp(
      (0.38 + this.respiration * 0.62) * (0.42 + this.perfusion * 0.58),
      0,
      1,
    );
    this.oxygenation +=
      (oxygenTarget - this.oxygenation) * (1 - Math.exp(-dt * 0.75));

    if (this.oxygenation < 0.5 || this.perfusion < 0.45) this.lowOxygenTime += dt;
    else this.lowOxygenTime = Math.max(0, this.lowOxygenTime - dt * 0.45);

    const stressTarget = clamp(
      0.05 + this.pain * 0.52 + (1 - this.perfusion) * 0.82 + this.systemicShock * 0.3,
      0.05,
      1,
    );
    this.adrenaline +=
      (stressTarget - this.adrenaline) * (1 - Math.exp(-dt * (stressTarget > this.adrenaline ? 1.8 : 0.16)));

    const cnsCapacity = clamp(this.brainFunction * (1 - this.cnsShock * 0.62), 0, 1);
    const metabolicCapacity = clamp(
      this.oxygenation * (0.48 + this.perfusion * 0.52),
      0,
      1,
    );
    const consciousnessTarget = clamp(cnsCapacity * (0.18 + metabolicCapacity * 0.82), 0, 1);
    const consciousnessRate = consciousnessTarget < this.consciousness ? 2.5 : 0.42;
    this.consciousness +=
      (consciousnessTarget - this.consciousness) *
      (1 - Math.exp(-dt * consciousnessRate));

    const adrenalineCompensation = 0.72 + this.adrenaline * 0.28;
    this.motorDrive = clamp(
      this.consciousness *
        this.spinalFunction *
        (0.48 + this.perfusion * 0.52) *
        adrenalineCompensation,
      0,
      1,
    );
    this.coordination = clamp(
      this.motorDrive *
        (0.62 + this.brainFunction * 0.38) *
        (1 - this.cnsShock * 0.42) *
        (1 - this.systemicShock * 0.2),
      0,
      1,
    );

    if (this.postureTime > 0) {
      this.postureTime = Math.max(0, this.postureTime - dt);
      if (this.postureTime === 0) this.postureMode = null;
    }

    this.unconscious =
      this.consciousness < 0.18 ||
      this.brainFunction < 0.12 ||
      this.lowOxygenTime > 4.5;
    this.dead =
      this.brainFunction < 0.035 ||
      this.bloodVolume < 0.34 ||
      (this.oxygenation < 0.22 && this.lowOxygenTime > 12);
  }

  snapshot() {
    return {
      bloodVolume: this.bloodVolume,
      perfusion: this.perfusion,
      oxygenation: this.oxygenation,
      brainFunction: this.brainFunction,
      spinalFunction: this.spinalFunction,
      respiration: this.respiration,
      consciousness: this.consciousness,
      motorDrive: this.motorDrive,
      coordination: this.coordination,
      pain: this.pain,
      adrenaline: this.adrenaline,
      bleedRate: this.bleedRate,
      cnsShock: this.cnsShock,
      unconscious: this.unconscious,
      dead: this.dead,
      postureMode: this.postureMode,
      limbs: Object.fromEntries(
        Object.entries(this.limbs).map(([key, limb]) => [key, { ...limb }]),
      ),
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
    };
  }
}

export { familyOf, sideOf };
