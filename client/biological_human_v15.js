import { BiologicalArtagdollHumanV14 } from "./biological_human_v14.js";

const ORDER = ["stable", "disturbed", "recovering", "stumbling", "critical", "falling"];

// V15 fixes a subtle but important controller-state bug from V13/V14. Escalation
// should be immediate, but recovery should use a candidate-state dwell timer.
// Previously the dwell timer only advanced while the requested state already
// equalled the current state, so a body could physically recover while the
// balance controller remained latched in "recovering" or "stumbling" forever.
export class BiologicalArtagdollHumanV15 extends BiologicalArtagdollHumanV14 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v15-unlatched-balance-hysteresis";
    this.balance2.transitionCandidate = null;
    this.balance2.transitionAge = 0;
    this.balance2.classify = (dt) => this.classifyWholeBodyBalance(dt);
  }

  classifyWholeBodyBalance(dt) {
    const b = this.balance2;
    const conscious = !this.dead && !this.physiology?.unconscious && !this.passiveHandoff;
    const pelvisY = this.body("pelvis").translation().y;
    const torsoContact = this.contact("pelvis") || this.contact("abdomen") || this.contact("chest");

    let next;
    if (!conscious) next = "passive";
    else if (torsoContact || pelvisY < 0.38) next = "downed";
    else if (b.risk < 0.16) next = "stable";
    else if (b.risk < 0.34) next = "disturbed";
    else if (b.risk < 0.57) next = "recovering";
    else if (b.risk < 0.82) next = "stumbling";
    else if (b.risk < 1.02) next = "critical";
    else next = "falling";

    const previous = b.state;
    if (next === previous) {
      b.stateAge += dt;
      b.transitionCandidate = null;
      b.transitionAge = 0;
    } else {
      const previousRank = ORDER.indexOf(previous);
      const nextRank = ORDER.indexOf(next);
      const escalation =
        next === "downed" ||
        next === "passive" ||
        (nextRank >= 0 && previousRank >= 0 && nextRank > previousRank);

      if (escalation) {
        b.state = next;
        b.stateAge = 0;
        b.transitionCandidate = null;
        b.transitionAge = 0;
      } else {
        if (b.transitionCandidate !== next) {
          b.transitionCandidate = next;
          b.transitionAge = 0;
        } else {
          b.transitionAge += dt;
        }

        // Recovery should feel continuous, not like a mode snap. The more severe
        // the previous state, the slightly longer the body has to prove that the
        // lower-risk state is real before we reduce assistance.
        const dwell = previous === "falling" || previous === "critical"
          ? 0.22
          : previous === "stumbling"
            ? 0.18
            : 0.12;
        if (b.transitionAge >= dwell) {
          b.state = next;
          b.stateAge = 0;
          b.transitionCandidate = null;
          b.transitionAge = 0;
        } else {
          b.stateAge += dt;
        }
      }
    }

    if (b.state === "stable") b.stableAge += dt;
    else b.stableAge = 0;

    if (b.state === "falling") b.fallAge += dt;
    else b.fallAge = Math.max(0, b.fallAge - dt * 2);
    return b.state;
  }

  balanceSnapshot() {
    const base = super.balanceSnapshot();
    return base && {
      ...base,
      transitionCandidate: this.balance2.transitionCandidate,
      transitionAge: this.balance2.transitionAge,
    };
  }
}
