const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

// Human-looking injury behavior sits above physiology. Physiology answers
// "what can the body still do?"; this layer answers "what does a conscious
// person try to do about it?"  The states are intents, not canned animations.
export class InjuryBehavior {
  constructor() {
    this.age = 0;
    this.phase = "calm";
    this.phaseAge = 0;
    this.family = "other";
    this.part = null;
    this.side = null;
    this.intensity = 0;
    this.panic = 0;
    this.guard = 0;
    this.painFocus = 0;
    this.hitCount = 0;
    this.lastStrength = 0;
    this.retreat = 0;
    this.nextStep = 0;
    this.kneelIntent = 0;
  }

  onHit({ event, physiology, part, side, strength = 12 }) {
    this.hitCount++;
    this.phase = "flinch";
    this.phaseAge = 0;
    this.family = event?.family || "other";
    this.part = part;
    this.side = side;
    this.lastStrength = strength;

    const startle = event?.startle ?? 0.25;
    const pain = event?.painSpike ?? 0.25;
    const localFailure = Math.max(
      event?.structuralLoss ?? 0,
      event?.nerveLoss ?? 0,
      event?.motorShock ?? 0,
    );
    this.intensity = clamp(0.18 + startle * 0.38 + pain * 0.34 + localFailure * 0.28, 0.12, 1.2);
    this.painFocus = clamp(Math.max(this.painFocus * 0.72, pain));
    this.guard = clamp(Math.max(this.guard * 0.82, 0.25 + pain * 0.68 + localFailure * 0.24));

    // Acute threat does not guarantee panic; it raises a persistent arousal
    // variable. Repeated impacts build it, while adrenaline can temporarily
    // keep useful movement available.
    const repeat = clamp((this.hitCount - 1) * 0.08, 0, 0.28);
    this.panic = clamp(Math.max(this.panic, startle * 0.58 + pain * 0.24 + repeat), 0, 1);
    this.retreat = clamp(Math.max(this.retreat, startle * 0.48 + repeat), 0, 1);
    this.nextStep = 0.18 + (1 - this.panic) * 0.22;

    const p = physiology;
    const stillConscious = !p?.unconscious && (p?.consciousness ?? 1) > 0.3;
    if (!stillConscious || event?.immediateMotorLoss) {
      this.phase = "collapse";
      this.guard = 0;
      this.retreat = 0;
    }
  }

  update(dt, physiology) {
    this.age += dt;
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

    if (this.phase === "guard" && this.phaseAge > 0.55 && this.panic > 0.46) {
      this.phase = "panic";
      this.phaseAge = 0;
    }

    if (this.phase === "panic" && this.phaseAge > 1.1 && this.panic < 0.42) {
      this.phase = this.guard > 0.25 ? "guard" : "recover";
      this.phaseAge = 0;
    }

    // Voluntary pain-kneeling is deliberately harder to trigger than guarding.
    // Mild/repeated impacts should usually produce protective movement rather
    // than an automatic floor state. Poor circulation/CNS control can later
    // turn the same guarded behavior into true collapse.
    const severePain = pain > 0.86 && this.intensity > 0.72;
    const physiologicWeakness = perfusion < 0.7 || oxygen < 0.72 || motor < 0.58;
    this.kneelIntent = clamp(
      (severePain ? (pain - 0.82) * 3.2 : 0) +
        (physiologicWeakness ? (0.72 - Math.min(perfusion, oxygen)) * 1.8 : 0),
      0,
      1,
    );
    if (this.phase !== "collapse" && this.kneelIntent > 0.55 && this.phaseAge > 0.8) {
      this.phase = "kneel";
    }

    if (this.phase === "kneel" && this.kneelIntent < 0.22 && motor > 0.7) {
      this.phase = this.guard > 0.25 ? "guard" : "recover";
      this.phaseAge = 0;
    }

    if (this.phase === "recover" && this.phaseAge > 1.2 && this.guard < 0.18 && this.panic < 0.18) {
      this.phase = "calm";
      this.phaseAge = 0;
    }
  }

  wantsGuard() {
    return !["calm", "collapse"].includes(this.phase) && this.guard > 0.18;
  }

  wantsPanicStep() {
    return this.phase === "panic" && this.retreat > 0.32 && this.nextStep <= 0;
  }

  consumeStep() {
    this.nextStep = 0.32 + (1 - this.panic) * 0.28;
  }

  snapshot() {
    return {
      phase: this.phase,
      phaseAge: this.phaseAge,
      family: this.family,
      part: this.part,
      side: this.side,
      intensity: this.intensity,
      panic: this.panic,
      guard: this.guard,
      painFocus: this.painFocus,
      retreat: this.retreat,
      kneelIntent: this.kneelIntent,
      hitCount: this.hitCount,
    };
  }
}
