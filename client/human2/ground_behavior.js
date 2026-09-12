import * as THREE from "three";

const clamp = THREE.MathUtils.clamp;
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function mul(targets, name, euler) { targets[name]?.multiply(new THREE.Quaternion().setFromEuler(euler)); }

// Ground behavior chooses finite intents rather than running a writhing sine loop.
// Contacts and PD joints decide the exact outcome, so repeated falls do not replay.
export class GroundBehavior {
  constructor(human) {
    this.h = human;
    this.intent = "rest";
    this.intentAge = 0;
    this.intentDuration = 0.65;
    this.exhaustion = 0;
    this.side = "L";
  }

  consciousDown() {
    return this.h.balance?.state === "downed" && !this.h.dead && !this.h.physiology?.unconscious && !this.h.passiveHandoff;
  }

  chooseIntent() {
    const h = this.h, pain = clamp(h.physiology?.pain ?? 0, 0, 1), stress = clamp(h.reactions?.stress ?? 0, 0, 1.2), fatigue = clamp(this.exhaustion, 0, 1), wound = h.reactions?.activeEpisode?.();
    let intent = "rest";
    if (Math.random() < clamp(0.42 + pain * 0.34 + stress * 0.18 - fatigue * 0.38, 0.18, 0.82)) {
      const r = Math.random();
      if (wound && r < 0.3 + pain * 0.18) intent = "guard";
      else if (r < 0.47) intent = "curl";
      else if (r < 0.64) intent = "brace";
      else if (r < 0.78 && fatigue < 0.72) intent = "sitAttempt";
      else if (r < 0.9) intent = "roll";
      else intent = "legFlex";
    }
    this.intent = intent;
    this.intentAge = 0;
    this.intentDuration = intent === "rest" ? 0.55 + Math.random() * 0.85 : intent === "sitAttempt" ? 0.75 + Math.random() * 0.55 : 0.42 + Math.random() * 0.68;
    this.side = Math.random() < 0.5 ? "L" : "R";
  }

  update(dt) {
    if (!this.consciousDown()) {
      this.intent = "rest"; this.intentAge = 0; this.exhaustion = Math.max(0, this.exhaustion - dt * 0.08); return;
    }
    this.intentAge += dt;
    this.exhaustion = this.intent === "rest" ? Math.max(0, this.exhaustion - dt * 0.018) : clamp(this.exhaustion + dt * 0.035, 0, 1);
    if (this.intentAge >= this.intentDuration) this.chooseIntent();
  }

  envelope() {
    if (this.intent === "rest") return 0;
    const d = Math.max(0.1, this.intentDuration);
    return smooth(this.intentAge / Math.min(0.18, d * 0.3)) * smooth((d - this.intentAge) / Math.min(0.22, d * 0.35));
  }

  driveScale() {
    if (!this.consciousDown()) return 1;
    return clamp(0.2 + (1 - this.exhaustion) * 0.24 + (this.intent === "rest" ? -0.06 : 0.08), 0.14, 0.5);
  }

  apply(targets, handGoals) {
    if (!this.consciousDown()) return;
    const h = this.h, amp = this.envelope(); if (amp <= 0.001) return;
    const side = this.side, other = side === "L" ? "R" : "L", sign = side === "L" ? -1 : 1, wound = h.reactions?.woundWorld?.();
    if (this.intent === "guard") {
      if (wound) { handGoals.set(side, { point: wound.clone(), strength: 0.25 + amp * 0.18, priority: 0.86, source: "groundGuard" }); if ((h.physiology?.pain ?? 0) > 0.72) handGoals.set(other, { point: wound.clone().add(new THREE.Vector3(-sign * 0.04, -0.02, 0)), strength: 0.22 + amp * 0.14, priority: 0.72, source: "groundGuard" }); }
      mul(targets, "abdomen", new THREE.Euler(0.12 * amp, 0, sign * 0.06 * amp)); mul(targets, "chest", new THREE.Euler(0.16 * amp, 0, sign * 0.09 * amp));
    } else if (this.intent === "curl") {
      mul(targets, "abdomen", new THREE.Euler(0.24 * amp, sign * 0.05 * amp, sign * 0.08 * amp)); mul(targets, "chest", new THREE.Euler(0.2 * amp, -sign * 0.06 * amp, sign * 0.1 * amp)); mul(targets, "thigh" + side, new THREE.Euler(-0.24 * amp, 0, sign * 0.05 * amp)); mul(targets, "shin" + side, new THREE.Euler(0.46 * amp, 0, 0)); if (wound) handGoals.set(side, { point: wound.clone(), strength: 0.28, priority: 0.76, source: "curlGuard" });
    } else if (this.intent === "brace") {
      const c = h.body("chest").translation(), goal = new THREE.Vector3(c.x + sign * 0.36, Math.max(0.065, c.y - 0.42), c.z + 0.08); handGoals.set(side, { point: goal, strength: 0.32 + amp * 0.16, priority: 0.9, source: "groundBrace" }); mul(targets, "chest", new THREE.Euler(-0.05 * amp, 0, -sign * 0.12 * amp));
    } else if (this.intent === "sitAttempt") {
      mul(targets, "abdomen", new THREE.Euler(-0.16 * amp, 0, -sign * 0.06 * amp)); mul(targets, "chest", new THREE.Euler(-0.22 * amp, 0, -sign * 0.1 * amp)); const p = h.body("pelvis").translation(), goal = new THREE.Vector3(p.x + sign * 0.42, Math.max(0.07, p.y - 0.28), p.z + 0.04); handGoals.set(side, { point: goal, strength: 0.38, priority: 0.94, source: "sitBrace" }); mul(targets, "thigh" + other, new THREE.Euler(-0.18 * amp, 0, 0)); mul(targets, "shin" + other, new THREE.Euler(0.32 * amp, 0, 0));
    } else if (this.intent === "roll") {
      mul(targets, "abdomen", new THREE.Euler(0.05 * amp, sign * 0.14 * amp, sign * 0.17 * amp)); mul(targets, "chest", new THREE.Euler(0.04 * amp, -sign * 0.12 * amp, sign * 0.2 * amp)); mul(targets, "thigh" + side, new THREE.Euler(-0.12 * amp, 0, sign * 0.08 * amp));
    } else if (this.intent === "legFlex") {
      mul(targets, "thigh" + side, new THREE.Euler(-0.3 * amp, 0, sign * 0.05 * amp)); mul(targets, "shin" + side, new THREE.Euler(0.62 * amp, 0, 0));
    }
  }

  snapshot() { return { active: this.consciousDown(), intent: this.intent, age: this.intentAge, duration: this.intentDuration, side: this.side, exhaustion: this.exhaustion, driveScale: this.driveScale() }; }
}
