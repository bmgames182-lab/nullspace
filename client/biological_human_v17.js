import * as THREE from "three";
import { BiologicalArtagdollHumanV16 } from "./biological_human_v16.js";

const clamp = THREE.MathUtils.clamp;
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);
const q = (value) => new THREE.Quaternion(value.x, value.y, value.z, value.w);
const TORSO_ZONES = new Set(["chest", "abdomen", "pelvis"]);

// V17 makes severe conscious torso reactions stateful rather than replaying the
// same readable sequence every time. A calm person usually clamps the wound and
// folds down with restrained movement. A repeated hit / already-panicked person
// gets a much more chaotic physical reaction: asymmetrical rescue steps, torso
// twist, a free flailing/bracing arm and several seconds of conscious writhing
// after the fall. Every large motion is still produced through the articulated
// body, joint PD targets, contacts and finite recovery steps -- there is no root
// teleport, clip playback or animation/ragdoll switch on the impact frame.
export class BiologicalArtagdollHumanV17 extends BiologicalArtagdollHumanV16 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v17-panic-ground-reaction";
    this.trauma = {
      active: false,
      mode: "calm",
      age: 99,
      hitSerial: 0,
      panicScore: 0,
      groundActive: false,
      groundAge: 0,
      groundDuration: 0,
      personality: 0.42 + Math.random() * 0.22,
      forcedMode: null,
    };
  }

  setReactionModeForDebug(mode = null) {
    this.trauma.forcedMode = mode === "panic" || mode === "calm" ? mode : null;
  }

  hit(part, dir, strength = 12, point) {
    const previousActive = this.trauma.active;
    const previousAge = this.trauma.age;
    const previousMode = this.trauma.mode;
    const prePanic = this.behavior?.panic ?? 0;
    const preStress = this.physiology?.stress ?? 0;
    const sameTorsoEpisode = previousActive && previousAge < 4.2 && TORSO_ZONES.has(part);

    const event = super.hit(part, dir, strength, point);
    if (!event) return event;

    if (
      TORSO_ZONES.has(part) &&
      strength >= 15 &&
      !event.immediateMotorLoss &&
      !this.dead &&
      !this.physiology?.unconscious
    ) {
      const repeatBoost = sameTorsoEpisode ? 0.58 : 0;
      const panicScore = clamp(
        prePanic * 0.5 +
          preStress * 0.18 +
          (event.startle ?? 0.3) * 0.22 +
          (event.painSpike ?? 0.35) * 0.12 +
          repeatBoost +
          this.trauma.personality * 0.1 +
          Math.max(0, strength - 18) * 0.025,
        0,
        1.5,
      );
      let mode = panicScore >= 0.66 ? "panic" : "calm";
      if (sameTorsoEpisode && previousMode === "panic") mode = "panic";
      if (this.trauma.forcedMode) mode = this.trauma.forcedMode;

      this.trauma.active = true;
      this.trauma.mode = mode;
      this.trauma.age = 0;
      this.trauma.hitSerial++;
      this.trauma.panicScore = panicScore;
      this.trauma.groundActive = false;
      this.trauma.groundAge = 0;
      this.trauma.groundDuration = mode === "panic" ? 5.8 : 2.9;
      this.passiveHandoff = false;

      if (this.behavior) {
        if (mode === "panic") {
          this.behavior.panic = Math.max(this.behavior.panic, 0.86);
          this.behavior.retreat = Math.max(this.behavior.retreat, 0.78);
          this.behavior.guard = Math.max(this.behavior.guard, 0.72);
          this.behavior.maxGuardSteps = Math.max(this.behavior.maxGuardSteps, 3);
        } else {
          // A calm severe reaction still hurts and eventually gives way, but it
          // does not receive an artificial panic-walk budget. COM failure can
          // independently request as many genuine rescue steps as it needs.
          this.behavior.panic = Math.min(this.behavior.panic, 0.48);
          this.behavior.retreat = Math.min(this.behavior.retreat, 0.34);
          this.behavior.maxGuardSteps = 0;
        }
      }
    }

    return event;
  }

  controlDrive() {
    const base = super.controlDrive();
    if (!this.trauma?.groundActive || this.dead || this.physiology?.unconscious) return base;
    const t = this.trauma.groundAge;
    const decay = Math.exp(-t / (this.trauma.mode === "panic" ? 4.8 : 2.3));
    const consciousTone = this.trauma.mode === "panic"
      ? 0.2 + decay * 0.36
      : 0.18 + decay * 0.22;
    return clamp(Math.max(base, consciousTone), 0, 1);
  }

  // V12 normally hands a completed severe torso presentation to a nearly
  // passive ragdoll. V17 delays that handoff while conscious ground reaction is
  // active, so the body can keep guarding, bracing and writhing through joints.
  enforcePassiveHandoff() {
    if (
      this.trauma?.groundActive &&
      !this.dead &&
      !this.physiology?.unconscious
    ) {
      this.passiveHandoff = false;
      if (this.hitReaction) {
        this.hitReaction.finalRagdoll = false;
        if (this.hitReaction.phase !== "groundPanic") this.hitReaction.setPhase("groundPanic");
      }
      if (this.behavior) {
        this.behavior.phase = "groundGuard";
        this.behavior.guard = Math.max(this.behavior.guard, 0.42);
      }
      return;
    }
    super.enforcePassiveHandoff();
  }

  // Behavioral retreat is deliberately different from balance rescue. The
  // calm path gets no pain-driven locomotion. The panic path gets finite,
  // asymmetrical physical steps; the COM balance controller can still request
  // additional steps whenever support actually fails.
  applyPanicMovement() {
    const r = this.hitReaction;
    if (
      !this.trauma?.active ||
      !r ||
      !TORSO_ZONES.has(r.zone) ||
      this.dead ||
      this.physiology?.unconscious
    ) {
      return super.applyPanicMovement();
    }

    if (this.trauma.mode === "calm") return;
    if (r.phase !== "panic") return super.applyPanicMovement();
    if (this.step.phase !== "idle" || this.step.cooldown > 0 || this.support < 0.18) return;
    if (this.directedSteps >= 4) return;

    const pelvis = this.body("pelvis");
    if (!pelvis) return;
    const p = v(pelvis.translation());
    const travel = v(this.lastHit?.dir || { x: 0, y: 0, z: -1 });
    travel.y = 0;
    if (travel.lengthSq() < 1e-6) travel.set(0, 0, -1);
    travel.normalize();
    const lateral = new THREE.Vector3(-travel.z, 0, travel.x);
    const stepIndex = this.directedSteps;
    const weave =
      Math.sin(this.age * 3.4 + stepIndex * 1.37) * 0.15 +
      Math.sin(this.age * 7.1 + stepIndex * 0.63) * 0.045;
    const overstep = stepIndex === 1 ? 0.07 : stepIndex === 2 ? -0.045 : 0;
    const target = p
      .clone()
      .addScaledVector(travel, 0.19 + 0.045 * stepIndex)
      .addScaledVector(lateral, weave + overstep);

    if (this.startScrambleStep(target)) {
      this.directedSteps++;
      this.behavior?.consumeStep?.();
    }
  }

  applyTraumaStanding(dt) {
    const t = this.trauma;
    const r = this.hitReaction;
    if (!t?.active || t.groundActive || !r || this.dead || this.physiology?.unconscious) return;
    if (!["impact", "clutch", "panic", "kneel", "failing"].includes(r.phase)) return;

    const pelvis = this.body("pelvis");
    const abdomen = this.body("abdomen");
    const chest = this.body("chest");
    const head = this.body("head");
    if (!pelvis || !abdomen || !chest) return;

    const localDir = v(this.lastHit?.dir || { x: 0, y: 0, z: -1 });
    localDir.y = 0;
    if (localDir.lengthSq() < 1e-6) localDir.set(0, 0, -1);
    localDir.normalize().applyQuaternion(q(pelvis.rotation()).invert());

    const panic = t.mode === "panic" ? 1 : 0;
    const phasePanic = r.phase === "panic" ? 1 : 0;
    const acute = Math.exp(-t.age / 0.42);
    const irregular =
      Math.sin(this.age * 6.8 + t.hitSerial * 0.7) * 0.66 +
      Math.sin(this.age * 11.9 + 1.7) * 0.34;
    const slower = Math.sin(this.age * 2.9 + t.hitSerial * 0.43);

    const pitch = clamp(
      0.08 + acute * (0.08 + Math.abs(localDir.z) * 0.08) +
        phasePanic * panic * (0.08 + Math.max(0, slower) * 0.08),
      -0.05,
      0.34,
    );
    const roll = clamp(
      -localDir.x * (0.08 + acute * 0.12) +
        panic * phasePanic * irregular * 0.13,
      -0.32,
      0.32,
    );
    const yaw = clamp(
      -localDir.x * localDir.z * 0.08 + panic * phasePanic * slower * 0.1,
      -0.2,
      0.2,
    );

    this.cohere(
      pelvis,
      abdomen,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.55, yaw * 0.45, roll * 0.55)),
      panic ? 24 : 31,
      panic ? 3.8 : 4.6,
      panic ? 18 : 21,
      0.42,
      dt,
    );
    this.cohere(
      abdomen,
      chest,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll)),
      panic ? 22 : 29,
      panic ? 3.5 : 4.3,
      panic ? 17 : 20,
      0.46,
      dt,
    );

    if (head) {
      // The head lags and tries to stay roughly useful instead of moving as a
      // rigid extension of the chest.
      this.cohere(
        chest,
        head,
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(-pitch * 0.28, -yaw * 0.32, -roll * 0.24 + irregular * 0.025 * panic),
        ),
        10,
        2.1,
        8,
        0.3,
        dt,
      );
    }

    if (panic && phasePanic) {
      const freeSide = this.coping?.freeSide || "R";
      const sign = freeSide === "L" ? -1 : 1;
      const chestPos = v(chest.translation());
      const chestRot = q(chest.rotation());
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(chestRot);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(chestRot);
      const up = new THREE.Vector3(0, 1, 0);
      const armWave = Math.sin(this.age * 7.7 + sign * 0.8);
      const armWave2 = Math.sin(this.age * 4.1 + sign * 2.2);
      const goal = chestPos
        .clone()
        .addScaledVector(right, sign * (0.36 + armWave2 * 0.09))
        .addScaledVector(forward, 0.08 + armWave * 0.11)
        .addScaledVector(up, 0.03 + Math.max(-0.4, armWave2) * 0.18);
      this.pullHandTo("hand" + freeSide, goal, 0.38 + t.panicScore * 0.12, dt);
    }
  }

  startGroundReaction() {
    const t = this.trauma;
    if (!t?.active || t.groundActive || this.dead || this.physiology?.unconscious) return;
    t.groundActive = true;
    t.groundAge = 0;
    t.groundDuration = t.mode === "panic" ? 5.8 : 2.9;
    this.passiveHandoff = false;
    this.step.phase = "idle";
    if (this.hitReaction) {
      this.hitReaction.finalRagdoll = false;
      this.hitReaction.setPhase("groundPanic");
    }
    if (this.behavior) {
      this.behavior.phase = "groundGuard";
      this.behavior.phaseAge = 0;
      this.behavior.guard = Math.max(this.behavior.guard, t.mode === "panic" ? 0.58 : 0.46);
      this.behavior.retreat = 0;
    }
    if (this.coping) this.coping.groundAge = 0;
  }

  maybeStartGroundReaction() {
    const t = this.trauma;
    const r = this.hitReaction;
    if (!t?.active || t.groundActive || !r || this.dead || this.physiology?.unconscious) return;
    const pelvisY = this.body("pelvis")?.translation().y ?? 2;
    const bodyContact =
      this.contact("pelvis") ||
      this.contact("abdomen") ||
      this.contact("chest") ||
      this.contact("upperArmL") ||
      this.contact("upperArmR");
    const floorLikeState = ["brace", "collapse", "down"].includes(this.state);
    const reactionLow = ["kneel", "failing", "grounded", "ragdoll"].includes(r.phase);
    if (
      r.phase === "grounded" ||
      (t.age > 0.72 && (pelvisY < 0.46 || bodyContact) && (reactionLow || floorLikeState))
    ) {
      this.startGroundReaction();
    }
  }

  applyGroundWrithing(dt) {
    const t = this.trauma;
    if (!t?.groundActive || this.dead || this.physiology?.unconscious) return;
    t.groundAge += dt;

    const pelvis = this.body("pelvis");
    const abdomen = this.body("abdomen");
    const chest = this.body("chest");
    const head = this.body("head");
    if (!pelvis || !abdomen || !chest) return;

    const pain = clamp(this.physiology?.pain ?? this.behavior?.painFocus ?? 0.6, 0, 1);
    const panicAmp = t.mode === "panic" ? 1 : 0.46;
    const decay = Math.exp(-t.groundAge / (t.mode === "panic" ? 4.7 : 2.2));
    const amp = clamp((0.22 + pain * 0.78) * panicAmp * decay, 0.08, 1);
    const a = Math.sin(this.age * 3.15 + t.hitSerial * 0.77);
    const b = Math.sin(this.age * 5.7 + 1.2);
    const c = Math.sin(this.age * 8.9 + 2.6);

    // Uneven trunk curl/twist. Low torque limits keep this loose and heavy;
    // the floor contacts decide how much of the internal effort turns into roll.
    this.cohere(
      pelvis,
      abdomen,
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.18 + Math.max(0, a) * 0.12 * amp, b * 0.08 * amp, a * 0.13 * amp),
      ),
      16,
      3.4,
      12,
      0.48,
      dt,
    );
    this.cohere(
      abdomen,
      chest,
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.2 + Math.max(0, b) * 0.14 * amp, -a * 0.1 * amp, b * 0.16 * amp),
      ),
      15,
      3.1,
      11,
      0.5,
      dt,
    );

    if (head) {
      this.cohere(
        chest,
        head,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.04 + c * 0.06 * amp, -b * 0.05 * amp, -a * 0.08 * amp)),
        7.5,
        2.2,
        6,
        0.32,
        dt,
      );
    }

    // Independent leg flexion creates the grounded kick/curl motion without
    // applying any external launch force. The left/right frequencies and phase
    // offsets intentionally differ so it never reads as a mirrored animation.
    for (const side of ["L", "R"]) {
      const sign = side === "L" ? -1 : 1;
      const sideWave = Math.sin(this.age * (side === "L" ? 4.35 : 5.05) + sign * 1.6 + t.hitSerial * 0.31);
      const kneePulse = Math.max(-0.15, sideWave) * amp;
      const hipFlex = 0.14 + Math.max(0, kneePulse) * 0.22;
      const kneeFlex = 0.28 + Math.max(0, kneePulse) * 0.5 + Math.max(0, -c * sign) * 0.12 * amp;
      this.cohere(
        pelvis,
        this.body("thigh" + side),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-hipFlex, sign * a * 0.035 * amp, sign * b * 0.045 * amp)),
        13,
        3.2,
        10,
        0.44,
        dt,
      );
      this.cohere(
        this.body("thigh" + side),
        this.body("shin" + side),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(kneeFlex, 0, 0)),
        12,
        3,
        9,
        0.5,
        dt,
      );
    }

    const freeSide = this.coping?.freeSide || "R";
    const freeHand = this.body("hand" + freeSide);
    if (freeHand) {
      const sign = freeSide === "L" ? -1 : 1;
      const chestPos = v(chest.translation());
      const goal = chestPos.clone().add(
        new THREE.Vector3(sign * (0.28 + b * 0.08 * amp), -0.34 + Math.max(0, c) * 0.08 * amp, 0.12 + a * 0.09 * amp),
      );
      goal.y = Math.max(0.065, goal.y);
      this.pullHandTo("hand" + freeSide, goal, 0.34 + amp * 0.16, dt);

      if (this.contact("hand" + freeSide)) {
        const brace = clamp((12 + Math.max(0, b) * 24) * amp, 0, 32);
        if (brace > 0) this.forcePair(chest, freeHand, new THREE.Vector3(0, brace, 0), 32, dt);
      }
    }

    if (t.groundAge >= t.groundDuration) {
      t.groundActive = false;
      if (this.hitReaction) {
        this.hitReaction.finalRagdoll = false;
        this.hitReaction.setPhase("grounded");
      }
      if (this.behavior) {
        this.behavior.phase = "groundGuard";
        this.behavior.phaseAge = 0;
        this.behavior.guard = Math.max(this.behavior.guard, 0.34);
      }
    }
  }

  update(dt) {
    if (this.trauma?.active) this.trauma.age += dt;
    super.update(dt);
    if (!this.trauma?.active || this.dead || this.physiology?.unconscious) return;

    this.maybeStartGroundReaction();
    if (this.trauma.groundActive) this.applyGroundWrithing(dt);
    else this.applyTraumaStanding(dt);
  }

  traumaSnapshot() {
    return {
      active: this.trauma.active,
      mode: this.trauma.mode,
      age: this.trauma.age,
      hitSerial: this.trauma.hitSerial,
      panicScore: this.trauma.panicScore,
      groundActive: this.trauma.groundActive,
      groundAge: this.trauma.groundAge,
      groundDuration: this.trauma.groundDuration,
      directedSteps: this.directedSteps,
      reactionPhase: this.hitReaction?.phase ?? null,
      behaviorPhase: this.behavior?.phase ?? null,
    };
  }

  behaviorSnapshot() {
    return {
      base: super.behaviorSnapshot?.() ?? null,
      trauma: this.traumaSnapshot(),
    };
  }
}
