import * as THREE from "three";
import { BiologicalArtagdollHumanV8 } from "./biological_human_v8.js";

const clamp = THREE.MathUtils.clamp;
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);
const q = (value) => new THREE.Quaternion(value.x, value.y, value.z, value.w);

// v9 keeps a conscious injured person active after the impact frame. The intent
// is not a canned "shot animation": hands protect the painful area, one arm is
// freed when balance is threatened, the feet make finite guarded retreat steps,
// and severe pain can become a controlled kneel/ground-guard while awareness is
// still present. Unconsciousness remains a separate physiology-driven collapse.
export class BiologicalArtagdollHumanV9 extends BiologicalArtagdollHumanV8 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v9-persistent-coping";
    this.coping = {
      groundAge: 0,
      guardSide: "L",
      freeSide: "R",
      reachedWound: false,
    };
  }

  hit(part, dir, strength = 12, point) {
    const event = super.hit(part, dir, strength, point);
    if (!event || event.immediateMotorLoss || this.physiology?.unconscious) return event;

    const b = this.behavior;
    if (!b) return event;

    const localX = this.guardWound?.localPoint?.x ?? 0;
    let guardSide = localX < -0.025 ? "L" : localX > 0.025 ? "R" : b.hitCount % 2 ? "L" : "R";
    if (b.family === "arm" && b.side) guardSide = b.side === "L" ? "R" : "L";
    this.coping.guardSide = guardSide;
    this.coping.freeSide = guardSide === "L" ? "R" : "L";
    this.coping.groundAge = 0;
    this.coping.reachedWound = false;

    if (b.family === "torso") {
      b.guard = Math.max(b.guard, strength >= 16 ? 0.78 : 0.58);
      b.painFocus = Math.max(b.painFocus, event.painSpike ?? 0.4);
      if (strength >= 16) {
        // Enough movement to read as panic/retreat, but explicitly finite.
        b.maxGuardSteps = Math.max(b.maxGuardSteps, 3);
        b.retreat = Math.max(b.retreat, 0.56);
        b.panic = Math.max(b.panic, 0.58);
      }
    } else if (b.family === "head") {
      b.guard = Math.max(b.guard, 0.54);
    } else if (b.family === "arm") {
      b.guard = Math.max(b.guard, 0.6);
    } else if (b.family === "leg") {
      // Keep both hands available during the initial hop/catch step. Grabbing the
      // leg starts after the centre of mass has already lowered.
      b.guard = Math.max(b.guard, 0.48);
    }

    return event;
  }

  localOffset(body, x, y, z) {
    return new THREE.Vector3(x, y, z).applyQuaternion(q(body.rotation()));
  }

  applyTorsoGuarding(dt) {
    const b = this.behavior;
    const p = this.physiology;
    const wound = this.woundWorld();
    const chest = this.body("chest");
    const pelvis = this.body("pelvis");
    if (!b?.wantsGuard() || !p || p.unconscious || this.dead || !wound || !chest || !pelvis)
      return;

    const chestPos = v(chest.translation());
    const pelvisPos = v(pelvis.translation());
    const speed = Math.hypot(chest.linvel().x, chest.linvel().z);
    const intensity = clamp(b.guard * (0.72 + b.painFocus * 0.42), 0, 1.1);
    const unstable =
      this.support < 0.62 ||
      speed > 0.72 ||
      ["scramble", "brace", "collapse", "down"].includes(this.state);
    const groundedCoping = b.phase === "groundGuard" || pelvisPos.y < 0.62;
    const firstClutch = b.injuryAge < 0.72 && !unstable;
    const tremor = Math.sin(this.age * (12 + b.panic * 6)) * 0.008 * (0.3 + b.panic);

    const guardSide = this.coping.guardSide;
    const freeSide = this.coping.freeSide;
    const guardSign = guardSide === "L" ? -1 : 1;
    const freeSign = -guardSign;

    // The guarding hand stays with the painful point for the whole conscious
    // sequence. At first both hands clutch it; when balance becomes difficult,
    // one hand releases and becomes a real balance/bracing limb.
    const guardGoal = wound.clone().add(this.localOffset(pelvis, guardSign * 0.035, tremor, 0.055));
    this.pullHandTo("hand" + guardSide, guardGoal, intensity * 0.9, dt);

    if (firstClutch) {
      const secondGoal = wound.clone().add(this.localOffset(pelvis, freeSign * 0.05, -tremor, 0.06));
      this.pullHandTo("hand" + freeSide, secondGoal, intensity * 0.72, dt);
    } else if (groundedCoping || (unstable && chestPos.y < 1.05)) {
      const braceGoal = chestPos
        .clone()
        .add(this.localOffset(pelvis, freeSign * 0.3, -0.5, 0.12));
      braceGoal.y = Math.max(0.075, braceGoal.y);
      this.pullHandTo("hand" + freeSide, braceGoal, intensity * 0.58, dt);
    } else if (unstable || b.phase === "panic") {
      const balanceGoal = chestPos
        .clone()
        .add(this.localOffset(pelvis, freeSign * (0.3 + b.panic * 0.08), -0.12, 0.08));
      this.pullHandTo("hand" + freeSide, balanceGoal, intensity * 0.42, dt);
    } else {
      const secondGoal = wound.clone().add(this.localOffset(pelvis, freeSign * 0.055, -tremor, 0.065));
      this.pullHandTo("hand" + freeSide, secondGoal, intensity * 0.56, dt);
    }

    const guardDistance = v(this.body("hand" + guardSide).translation()).distanceTo(wound);
    if (guardDistance < 0.19) this.coping.reachedWound = true;

    // Pain curl + fast shallow-breathing motion. These are deliberately small;
    // the large visible movement still comes from the articulated body and feet.
    const breath = Math.sin(this.age * (5.1 + b.panic * 1.8)) * 0.018 * (0.35 + b.painFocus);
    const curl = clamp(0.07 + intensity * 0.15 + (b.phase === "kneel" || groundedCoping ? 0.08 : 0), 0.06, 0.3);
    this.cohere(
      pelvis,
      this.body("abdomen"),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(curl * 0.52, 0, 0)),
      42,
      4.8,
      24,
      0.42,
      dt,
    );
    this.cohere(
      this.body("abdomen"),
      chest,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(curl + breath, 0, 0)),
      38,
      4.2,
      22,
      0.44,
      dt,
    );
  }

  applyGuarding(dt) {
    if (this.behavior?.family === "torso") {
      this.applyTorsoGuarding(dt);
      return;
    }

    // Reuse v7/v8's already good head/arm/leg protection, then add a more
    // legible cradling posture for an injured arm.
    super.applyGuarding(dt);
    const b = this.behavior;
    if (!b?.wantsGuard() || this.physiology?.unconscious || this.dead) return;

    if (b.family === "arm" && this.guardWound?.side) {
      const side = this.guardWound.side;
      const sign = side === "L" ? -1 : 1;
      const chest = this.body("chest");
      const upper = this.body("upperArm" + side);
      const lower = this.body("lowerArm" + side);
      if (chest && upper && lower) {
        // The hurt arm is tucked toward the body while the opposite hand holds it.
        this.cohere(
          chest,
          upper,
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.22, -sign * 0.16, sign * 0.2)),
          16,
          2.2,
          11,
          0.28,
          dt,
        );
        this.cohere(
          upper,
          lower,
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.82, 0, 0)),
          15,
          2,
          10,
          0.3,
          dt,
        );
      }
    }
  }

  applyPainKneel(dt) {
    const b = this.behavior;
    const p = this.physiology;
    if (!b || b.phase !== "kneel" || !p || p.unconscious || this.dead) return;

    if (!["down", "collapse", "limp"].includes(this.state)) this.setState("brace");
    const amount = clamp(b.kneelIntent, 0, 1);
    const pelvis = this.body("pelvis");
    const abdomen = this.body("abdomen");
    const chest = this.body("chest");
    if (!pelvis) return;

    // Do not drop both knees symmetrically. One knee yields first while the
    // other leg continues to carry more weight, which reads much more like a
    // conscious person giving in to pain than a powered-down robot.
    const kneeSide = this.coping.guardSide;
    for (const side of ["L", "R"]) {
      const primary = side === kneeSide;
      const hipFlex = primary ? 0.2 + amount * 0.2 : 0.08 + amount * 0.1;
      const kneeFlex = primary ? 0.46 + amount * 0.5 : 0.2 + amount * 0.24;
      this.cohere(
        pelvis,
        this.body("thigh" + side),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-hipFlex, 0, 0)),
        32,
        3.8,
        22,
        primary ? 0.46 : 0.32,
        dt,
      );
      this.cohere(
        this.body("thigh" + side),
        this.body("shin" + side),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(kneeFlex, 0, 0)),
        30,
        3.2,
        21,
        primary ? 0.48 : 0.34,
        dt,
      );

      const foot = this.body("foot" + side);
      const quality = this.feet?.[side]?.quality ?? 0;
      if (foot && quality > 0.16) {
        const settle = new THREE.Vector3(0, -(55 + amount * (primary ? 120 : 75)) * quality, 0);
        this.forcePair(pelvis, foot, settle, 180, dt);
      }
    }

    if (abdomen && chest) {
      const smallRoll = (kneeSide === "L" ? -1 : 1) * 0.035 * amount;
      this.cohere(
        pelvis,
        abdomen,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12 + amount * 0.13, 0, smallRoll)),
        34,
        4,
        20,
        0.42,
        dt,
      );
      this.cohere(
        abdomen,
        chest,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.16 + amount * 0.18, 0, smallRoll)),
        30,
        3.6,
        18,
        0.44,
        dt,
      );
    }

    if (pelvis.translation().y < 0.58 && b.injuryAge > 2.7) {
      b.phase = "groundGuard";
      b.phaseAge = 0;
      b.guard = Math.max(b.guard, 0.48);
      this.coping.groundAge = 0;
    }
  }

  applyConsciousGroundCoping(dt) {
    const b = this.behavior;
    const p = this.physiology;
    if (!b || b.phase !== "groundGuard" || !p || p.unconscious || this.dead) return;
    this.coping.groundAge += dt;
    b.guard = Math.max(b.guard, 0.34);

    const chest = this.body("chest");
    const abdomen = this.body("abdomen");
    const pelvis = this.body("pelvis");
    if (!chest || !abdomen || !pelvis) return;

    // Keep a little purposeful muscle tone and protective curl on the floor.
    // This is intentionally not a "get up" routine: the person is hurt, aware,
    // guarding the wound and trying to support some body weight with a free hand.
    const pain = clamp(p.pain ?? b.painFocus, 0, 1);
    const slowSway = Math.sin(this.age * 2.1) * 0.035 * pain;
    this.cohere(
      abdomen,
      chest,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18 + pain * 0.1, 0, slowSway)),
      20,
      3.2,
      13,
      0.3,
      dt,
    );

    const freeHand = this.body("hand" + this.coping.freeSide);
    if (freeHand && this.contact("hand" + this.coping.freeSide)) {
      const support = clamp((0.82 - chest.translation().y) * 180 - chest.linvel().y * 24, 0, 80);
      if (support > 0) this.forcePair(chest, freeHand, new THREE.Vector3(0, support, 0), 80, dt);
    }

    // If the physiology genuinely improves, guarding can eventually relax. If
    // circulation/CNS deteriorates, PhysiologyModel will independently move the
    // character into unconscious collapse instead.
    if (
      this.coping.groundAge > 6 &&
      p.pain < 0.48 &&
      p.motorDrive > 0.76 &&
      p.perfusion > 0.82
    ) {
      b.phase = "recover";
      b.phaseAge = 0;
    }
  }

  update(dt) {
    super.update(dt);
    if (this.dead || this.physiology?.unconscious) return;
    this.applyConsciousGroundCoping(dt);
  }

  behaviorSnapshot() {
    return {
      ...(super.behaviorSnapshot?.() || {}),
      coping: { ...this.coping },
    };
  }
}
