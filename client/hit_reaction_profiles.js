const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function reactionZone(part) {
  if (part === "head") return "head";
  if (part === "chest") return "chest";
  if (part === "abdomen") return "abdomen";
  if (part === "pelvis") return "pelvis";
  if (/Arm|hand/.test(part || "")) return "arm";
  if (/thigh|shin|foot/.test(part || "")) return "leg";
  return "other";
}

export const HIT_REACTION_PROFILES = Object.freeze({
  chest: Object.freeze({
    impactEnd: 0.18,
    clutchEnd: 0.78,
    panicEnd: 2.6,
    kneelEnd: 4.05,
    failEnd: 5.0,
    delayedCollapseStrength: 16,
    panicSteps: 3,
    guardHands: "both",
  }),
  abdomen: Object.freeze({
    impactEnd: 0.2,
    clutchEnd: 0.9,
    panicEnd: 2.35,
    kneelEnd: 4.15,
    failEnd: 5.15,
    delayedCollapseStrength: 17,
    panicSteps: 2,
    guardHands: "both",
  }),
  pelvis: Object.freeze({
    impactEnd: 0.18,
    clutchEnd: 0.62,
    panicEnd: 1.65,
    kneelEnd: 3.6,
    failEnd: 4.8,
    delayedCollapseStrength: 18,
    panicSteps: 2,
    guardHands: "one",
  }),
  head: Object.freeze({
    impactEnd: 0.16,
    clutchEnd: 0.52,
    panicEnd: 1.55,
    kneelEnd: 2.9,
    failEnd: 3.8,
    delayedCollapseStrength: 99,
    panicSteps: 2,
    guardHands: "one",
  }),
  arm: Object.freeze({
    impactEnd: 0.15,
    clutchEnd: 0.58,
    panicEnd: 1.75,
    kneelEnd: 2.9,
    failEnd: 4.0,
    delayedCollapseStrength: 99,
    panicSteps: 1,
    guardHands: "opposite",
  }),
  leg: Object.freeze({
    impactEnd: 0.14,
    clutchEnd: 0.42,
    panicEnd: 1.45,
    kneelEnd: 2.9,
    failEnd: 4.2,
    delayedCollapseStrength: 99,
    panicSteps: 3,
    guardHands: "late",
  }),
  other: Object.freeze({
    impactEnd: 0.16,
    clutchEnd: 0.5,
    panicEnd: 1.4,
    kneelEnd: 2.7,
    failEnd: 3.8,
    delayedCollapseStrength: 99,
    panicSteps: 1,
    guardHands: "one",
  }),
});

// This director produces intent only. It deliberately does not own rigid bodies
// or animation. The active-ragdoll layer turns these phases into physical hand,
// trunk, stepping and support actions.
export class HitReactionDirector {
  constructor() {
    this.reset();
  }

  reset() {
    this.zone = "other";
    this.part = null;
    this.side = null;
    this.phase = "calm";
    this.age = 99;
    this.phaseAge = 0;
    this.strength = 0;
    this.severity = 0;
    this.pain = 0;
    this.startle = 0;
    this.motorShock = 0;
    this.delayedCollapse = false;
    this.finalRagdoll = false;
    this.phaseHistory = ["calm"];
    this.profile = HIT_REACTION_PROFILES.other;
  }

  setPhase(next) {
    if (this.phase === next) return;
    this.phase = next;
    this.phaseAge = 0;
    this.phaseHistory.push(next);
    if (this.phaseHistory.length > 24) this.phaseHistory.shift();
  }

  onHit({ part, side = null, strength = 12, event = null, physiology = null }) {
    this.zone = reactionZone(part);
    this.profile = HIT_REACTION_PROFILES[this.zone] || HIT_REACTION_PROFILES.other;
    this.part = part;
    this.side = side;
    this.age = 0;
    this.phaseAge = 0;
    this.strength = strength;
    this.severity = clamp(event?.severity ?? strength / 18, 0.05, 1.8);
    this.pain = clamp(event?.painSpike ?? 0.3, 0, 1);
    this.startle = clamp(event?.startle ?? 0.3, 0, 1);
    this.motorShock = clamp(event?.motorShock ?? 0.2, 0, 1);
    this.finalRagdoll = false;
    this.phaseHistory = [];

    const catastrophic =
      !!event?.immediateMotorLoss ||
      !!physiology?.unconscious ||
      !!physiology?.dead;
    if (catastrophic) {
      this.delayedCollapse = false;
      this.setPhase("ragdoll");
      this.finalRagdoll = true;
      return;
    }

    // Strong torso wounds use the dramatic sandbox sequence requested by the
    // game design. Lighter wounds are allowed to guard, stumble and recover.
    this.delayedCollapse =
      ["chest", "abdomen", "pelvis"].includes(this.zone) &&
      strength >= this.profile.delayedCollapseStrength;
    this.setPhase("impact");
  }

  update(dt, physiology, limbCapacity = 1) {
    if (this.phase === "calm" || this.finalRagdoll) return;
    this.age += dt;
    this.phaseAge += dt;

    if (physiology?.dead || physiology?.unconscious) {
      this.setPhase("ragdoll");
      this.finalRagdoll = true;
      return;
    }

    const p = this.profile;
    const weakSystemically =
      (physiology?.perfusion ?? 1) < 0.62 ||
      (physiology?.oxygenation ?? 1) < 0.68 ||
      (physiology?.motorDrive ?? 1) < 0.5;

    if (this.zone === "head") {
      const neurologicallySevere =
        (physiology?.cnsShock ?? 0) > 0.82 ||
        (physiology?.consciousness ?? 1) < 0.48 ||
        (physiology?.brainFunction ?? 1) < 0.5;
      if (neurologicallySevere && this.age > 0.24) {
        this.setPhase("ragdoll");
        this.finalRagdoll = true;
        return;
      }
    }

    if (this.zone === "leg" && limbCapacity < 0.36 && this.age > 1.15) {
      this.setPhase("kneel");
    }

    if (this.phase === "impact" && this.age >= p.impactEnd) {
      this.setPhase(this.zone === "leg" ? "unload" : "clutch");
      return;
    }

    if (["clutch", "unload"].includes(this.phase) && this.age >= p.clutchEnd) {
      if (this.zone === "arm") this.setPhase("guard");
      else if (this.zone === "head") this.setPhase("dazed");
      else if (this.zone === "leg") this.setPhase("hop");
      else this.setPhase("panic");
      return;
    }

    if (["panic", "hop", "dazed", "guard"].includes(this.phase) && this.age >= p.panicEnd) {
      const needsKneel =
        this.delayedCollapse ||
        weakSystemically ||
        (this.zone === "leg" && limbCapacity < 0.58);
      this.setPhase(needsKneel ? "kneel" : "recover");
      return;
    }

    if (this.phase === "kneel" && this.age >= p.kneelEnd) {
      if (this.delayedCollapse || weakSystemically || limbCapacity < 0.3)
        this.setPhase("failing");
      else this.setPhase("recover");
      return;
    }

    if (this.phase === "failing" && this.age >= p.failEnd) {
      this.setPhase("ragdoll");
      this.finalRagdoll = true;
      return;
    }

    if (this.phase === "recover" && this.phaseAge > 1.15) this.setPhase("calm");
  }

  activeDriveScale() {
    switch (this.phase) {
      case "impact": return 0.88;
      case "clutch": return 0.9;
      case "guard": return 0.9;
      case "panic": return 0.82;
      case "dazed": return 0.68;
      case "unload": return 0.88;
      case "hop": return 0.78;
      case "kneel": return 0.68;
      case "failing": return clamp(0.54 - this.phaseAge * 0.34, 0.18, 0.54);
      case "ragdoll": return 0.035;
      case "recover": return clamp(0.72 + this.phaseAge * 0.18, 0.72, 1);
      default: return 1;
    }
  }

  snapshot() {
    return {
      zone: this.zone,
      part: this.part,
      side: this.side,
      phase: this.phase,
      age: this.age,
      phaseAge: this.phaseAge,
      strength: this.strength,
      severity: this.severity,
      pain: this.pain,
      startle: this.startle,
      motorShock: this.motorShock,
      delayedCollapse: this.delayedCollapse,
      finalRagdoll: this.finalRagdoll,
      phaseHistory: [...this.phaseHistory],
    };
  }
}
