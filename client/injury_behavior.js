const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

// Human-looking injury behavior sits above physiology. Physiology answers
// "what can the body still do?"; this layer answers "what does a conscious
// person try to do about it?" The states are intents, not canned animations.
export class InjuryBehavior {
  constructor() {
    this.age = 0;
    this.injuryAge = 99;
    this.phase = "calm";
    this.phaseAge = 0;
    this.family = "other";
    this.part = null;
    this.side = null;
    this.intensity = 0;
    this.distress = 0;
    this.panic = 0;
    this.guard = 0;
    this.painFocus = 0;
    this.hitCount = 0;
    this.lastStrength = 0;
    this.retreat = 0;
    this.nextStep = 0;
    this.guardSteps = 0;
    this.maxGuardSteps = 0;
    this.kneelIntent = 0;
  }

  onHit({ event, physiology, part, side, strength = 12 }) {
    this.hitCount++;
    this.injuryAge = 0;
    this.phase = "flinch";
    this.phaseAge = 0;
    this.family = event?.family || "other";
    this.part = part;
    this.side = side;
    this.lastStrength = strength;
    this.guardSteps = 0;

    const startle = event?.startle ?? 0.25;
    const pain = event?.painSpike ?? 0.25;
    const localFailure = Math.max(
      event?.structuralLoss ?? 0,
      event?.nerveLoss ?? 0,
      event?.motorShock ?? 0,
    );
    const vascular = event?.vascularLoss ?? 0;
    this.intensity = clamp(
      0.18 + startle * 0.38 + pain * 0.34 + localFailure * 0.28,
      0.12,
      1.2,
    );
    this.distress = clamp(
      pain * 0.56 + startle * 0.22 + localFailure * 0.2 + vascular * 0.34,
      0,
      1,
    );
    this.painFocus = clamp(Math.max(this.painFocus * 0.72, pain));
    this.guard = clamp(
      Math.max(this.guard * 0.82, 0.25 + pain * 0.68 + localFailure * 0.24),
    );

    // Acute threat does not guarantee panic; it raises a persistent arousal
    // variable. Repeated impacts build it, while adrenaline can temporarily
    // keep useful movement available.
    const repeat = clamp((this.hitCount - 1) * 0.08, 0, 0.28);
    this.panic = clamp(
      Math.max(this.panic, startle * 0.58 + pain * 0.24 + repeat),
      0,
      1,
    );
    this.retreat = clamp(Math.max(this.retreat, startle * 0.48 + repeat), 0, 1);

    // A substantial conscious torso wound often creates a few disorganised
    // protective steps: recoil, clutch wound, back/side-step, then reassess.
    // Keep this finite so it never turns into an endless zombie run.
    if (this.family === "torso" && strength >= 16) {
      this.maxGuardSteps = 2;
      this.retreat = Math.max(this.retreat, 0.46);
      this.panic = Math.max(this.panic, 0.5);
    } else if (this.family === "torso" && strength >= 11) {
      this.maxGuardSteps = 1;
    } else {
      this.maxGuardSteps = 0;
    }
    this.nextStep = 0.18 + (1 - this.panic) * 0.22;

    const p = physiology;
    const stillConscious = !p?.unconscious && (p?.consciousness ?? 1) > 0.3;
    if (!stillConscious || event?.immediateMotorLoss) {
      this.phase = "collapse";
      this.guard = 0;
      this.retreat = 0;
      this.maxGuardSteps = 0;
    }
  }

  update(dt, physiology) {
    this.age += dt;
    this.injuryAge += dt;
    this.phaseAge += dt;
    this.nextStep -= dt;

    if (physiology?.dead || physiology?.unconscious) {
      this.phase = "collapse";
      this.guard *= Math.exp(-dt * 7);
      this.panic *= Math.exp(-dt * 2);
      this.kneelIntent = 0;
      return;
    }

    const pain = physiology?.pain ?? this.painFocus;
    const perfusion = physiology?.perfusion ?? 1;
    const motor = physiology?.motorDrive ?? 1;
    const oxygen = physiology?.oxygenation ?? 1;

    this.panic *= Math.exp(-dt / 8);
    this.retreat *= Math.exp(-dt / 5.5);
    this.guard *= Math.exp(-dt / 18);
    this.painFocus *= Math.exp(-dt / 16);

    if (this.phase === "flinch" && this.phaseAge > 0.16 + this.intensity * 0.11) {
      this.phase = this.guard > 0.3 ? "guard" : "recover";
      this.phaseAge = 0;
    }

    if (
      this.phase === "guard" &&
      this.phaseAge > 0.45 &&
      (this.panic > 0.46 ||
        (this.family === "torso" && this.guardSteps < this.maxGuardSteps))
    ) {
      this.phase = "panic";
      this.phaseAge = 0;
    }

    if (
      this.phase === "panic" &&
      this.phaseAge > 0.75 &&
      (this.guardSteps >= this.maxGuardSteps || this.injuryAge > 2.2) &&
      this.panic < 0.5
    ) {
      this.phase = this.guard > 0.25 ? "guard" : "recover";
      this.phaseAge = 0;
    }

    // Voluntary pain-kneeling is different from neurological/circulatory
    // collapse. A severe torso wound can lead to a guarded controlled kneel a
    // couple seconds later while the person remains conscious and protective.
    // Light hits never enter this torso-distress path.
    const severePain = pain > 0.86 && this.intensity > 0.72;
    const physiologicWeakness = perfusion < 0.7 || oxygen < 0.72 || motor < 0.58;
    const torsoDistress =
      this.family === "torso" &&
      this.lastStrength >= 16 &&
      this.injuryAge > 2.25
        ? clamp(
            Math.max(0, pain - 0.34) * 1.5 +
              this.distress * 0.72 +
              Math.max(0, this.injuryAge - 2.25) * 0.08,
            0,
            1,
          )
        : 0;
    this.kneelIntent = clamp(
      (severePain ? (pain - 0.82) * 3.2 : 0) +
        (physiologicWeakness
          ? Math.max(0, 0.72 - Math.min(perfusion, oxygen, motor)) * 1.8
          : 0) +
        torsoDistress,
      0,
      1,
    );
    if (
      this.phase !== "collapse" &&
      this.kneelIntent > 0.55 &&
      this.injuryAge > 2.35
    ) {
      this.phase = "kneel";
    }

    if (
      this.phase === "kneel" &&
      this.kneelIntent < 0.22 &&
      motor > 0.7 &&
      this.injuryAge > 4.5
    ) {
      this.phase = this.guard > 0.25 ? "guard" : "recover";
      this.phaseAge = 0;
    }

    if (
      this.phase === "recover" &&
      this.phaseAge > 1.2 &&
      this.guard < 0.18 &&
      this.panic < 0.18
    ) {
      this.phase = "calm";
      this.phaseAge = 0;
    }
  }

  wantsGuard() {
    return !["calm", "collapse"].includes(this.phase) && this.guard > 0.18;
  }

  wantsPanicStep() {
    const guardedTorsoMove =
      this.family === "torso" &&
      ["guard", "panic"].includes(this.phase) &&
      this.guardSteps < this.maxGuardSteps &&
      this.injuryAge > 0.32 &&
      this.injuryAge < 2.25;
    return (
      (this.phase === "panic" || guardedTorsoMove) &&
      this.retreat > 0.3 &&
      this.nextStep <= 0
    );
  }

  consumeStep() {
    this.guardSteps++;
    this.nextStep = 0.32 + (1 - this.panic) * 0.28;
  }

  snapshot() {
    return {
      phase: this.phase,
      phaseAge: this.phaseAge,
      injuryAge: this.injuryAge,
      family: this.family,
      part: this.part,
      side: this.side,
      intensity: this.intensity,
      distress: this.distress,
      panic: this.panic,
      guard: this.guard,
      painFocus: this.painFocus,
      retreat: this.retreat,
      guardSteps: this.guardSteps,
      maxGuardSteps: this.maxGuardSteps,
      kneelIntent: this.kneelIntent,
      hitCount: this.hitCount,
    };
  }
}
