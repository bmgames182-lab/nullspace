import * as THREE from "three";
import { BiologicalArtagdollHumanV9 } from "./biological_human_v9.js";
import { HitReactionDirector } from "./hit_reaction_profiles.js";
import { sideOf } from "./physiology.js";

const clamp = THREE.MathUtils.clamp;
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);

// v10 separates three jobs cleanly:
//   physiology -> what still works,
//   reaction director -> what the person is trying to do over time,
//   active ragdoll -> physically performs that intent.
// A strong chest hit therefore does not call setState("collapse") on impact.
export class BiologicalArtagdollHumanV10 extends BiologicalArtagdollHumanV9 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v10-directed-reactions";
    this.hitReaction = new HitReactionDirector();
    this.directedSteps = 0;
  }

  controlDrive() {
    const base = super.controlDrive();
    const r = this.hitReaction;
    const p = this.physiology;

    // A moderate conscious head injury should primarily disturb the head/neck,
    // attention and coordination. Do not turn that local daze into whole-body
    // weakness while gross motor pathways are still available. Head-specific
    // looseness is already produced by headStun and the regional muscle targets.
    const consciousSupportedHead =
      r?.zone === "head" &&
      r.phase !== "ragdoll" &&
      !r.finalRagdoll &&
      !p?.unconscious &&
      !p?.dead &&
      (p?.brainFunction ?? 1) > 0.5 &&
      (p?.consciousness ?? 1) > 0.45;
    if (consciousSupportedHead) return clamp(Math.max(base, 0.82), 0, 1);

    const directed = r?.activeDriveScale?.() ?? 1;
    return clamp(base * directed, 0, 1);
  }

  hit(part, dir, strength = 12, point) {
    const event = super.hit(part, dir, strength, point);
    if (!event || !this.hitReaction) return event;
    this.directedSteps = 0;
    this.hitReaction.onHit({
      part,
      side: sideOf(part),
      strength,
      event,
      physiology: this.physiology,
    });
    return event;
  }

  directedLimbCapacity() {
    const r = this.hitReaction;
    if (!r || !r.side || !["arm", "leg"].includes(r.zone)) return 1;
    return this.physiology?.localLimbCapacity?.(r.zone, r.side) ?? 1;
  }

  // V9 already has excellent physical wound guarding. This method only makes
  // sure the intent stays alive during V10's longer directed sequence.
  applyGuarding(dt) {
    const r = this.hitReaction;
    if (
      r &&
      ["clutch", "guard", "panic", "dazed", "kneel", "failing"].includes(r.phase) &&
      this.behavior &&
      !this.physiology?.unconscious &&
      !this.dead
    ) {
      this.behavior.guard = Math.max(this.behavior.guard, r.zone === "chest" ? 0.62 : 0.45);
      this.behavior.painFocus = Math.max(this.behavior.painFocus, r.pain * 0.8);
    }
    super.applyGuarding(dt);
  }

  // Override the generic panic step with zone-aware foot placement. These are
  // real active-ragdoll steps: no root translation or canned locomotion.
  applyPanicMovement() {
    const r = this.hitReaction;
    const p = this.physiology;
    if (!r || this.dead || p?.unconscious) return super.applyPanicMovement();

    // Moderate conscious head trauma gets one small rescue step only when the
    // body is genuinely losing support. Never hand the same head hit back to the
    // legacy panic-step loop afterwards; that stacking was producing six frantic
    // steps and a fake collapse while consciousness was actually recovering.
    if (r.zone === "head" && !r.finalRagdoll && r.phase !== "ragdoll") {
      if (this.directedSteps >= 1) return;
      if (!["impact", "clutch", "dazed", "recover"].includes(r.phase)) return;
      if (this.step.phase !== "idle" || this.step.cooldown > 0 || this.support < 0.18) return;

      const pelvisBody = this.body("pelvis");
      const chestBody = this.body("chest");
      const pelvis = v(pelvisBody.translation());
      const pv = v(pelvisBody.linvel());
      const cv = v(chestBody.linvel());
      const horizontalSpeed = Math.max(
        Math.hypot(pv.x, pv.z),
        Math.hypot(cv.x, cv.z),
      );
      const physicallyUnstable =
        ["scramble", "brace"].includes(this.state) ||
        this.support < 0.52 ||
        pelvis.y < 0.78 ||
        horizontalSpeed > 0.52;
      if (!physicallyUnstable) return;

      const travel = v(this.lastHit?.dir || { x: 0, y: 0, z: -1 });
      travel.y = 0;
      if (travel.lengthSq() < 1e-6) travel.set(0, 0, -1);
      travel.normalize();
      const lateral = new THREE.Vector3(-travel.z, 0, travel.x);
      const weave = Math.sin(this.age * 2.6) * 0.055;
      const target = pelvis
        .clone()
        .addScaledVector(travel, 0.075)
        .addScaledVector(lateral, weave);
      if (this.startScrambleStep(target)) {
        this.directedSteps++;
        this.behavior?.consumeStep?.();
      }
      return;
    }

    if (!["panic", "hop", "dazed"].includes(r.phase)) return super.applyPanicMovement();
    if (this.step.phase !== "idle" || this.step.cooldown > 0 || this.support < 0.18) return;

    const maxSteps = r.zone === "chest" ? 3 : r.zone === "abdomen" ? 2 : r.zone === "leg" ? 3 : 2;
    if (this.directedSteps >= maxSteps) return;

    const pelvis = v(this.body("pelvis").translation());
    const travel = v(this.lastHit?.dir || { x: 0, y: 0, z: -1 });
    travel.y = 0;
    if (travel.lengthSq() < 1e-6) travel.set(0, 0, -1);
    travel.normalize();
    const lateral = new THREE.Vector3(-travel.z, 0, travel.x);
    const weave = Math.sin((this.age + this.directedSteps * 0.73) * 3.1) *
      (r.zone === "chest" ? 0.12 : 0.09);

    const target = pelvis
      .clone()
      .addScaledVector(travel, 0.2 + r.startle * 0.1)
      .addScaledVector(lateral, weave);

    const requestedSide = r.zone === "leg" && r.side ? r.side : null;
    if (this.startScrambleStep(target, requestedSide)) {
      this.directedSteps++;
      this.behavior?.consumeStep?.();
    }
  }

  applyPainKneel(dt) {
    // Let V9 run its asymmetric voluntary pain-kneel whenever legacy behaviour
    // requests it.
    super.applyPainKneel(dt);

    const r = this.hitReaction;
    if (!r || !["kneel", "failing"].includes(r.phase)) return;
    if (this.dead || this.physiology?.unconscious) return;

    if (this.behavior) {
      this.behavior.kneelIntent = Math.max(
        this.behavior.kneelIntent,
        r.phase === "failing" ? 0.92 : 0.68,
      );
      // Keep V9's wound-grabbing and asymmetric knee logic active.
      if (!["groundGuard", "collapse"].includes(this.behavior.phase))
        this.behavior.phase = "kneel";
    }

    if (!["down", "collapse", "limp"].includes(this.state)) this.setState("brace");
    const amount = r.phase === "failing"
      ? clamp(0.78 + r.phaseAge * 0.22, 0.78, 1)
      : clamp(0.52 + r.phaseAge * 0.12, 0.52, 0.78);

    const pelvis = this.body("pelvis");
    for (const side of ["L", "R"]) {
      const foot = this.body("foot" + side);
      const quality = this.feet?.[side]?.quality ?? 0;
      if (!pelvis || !foot || quality < 0.16) continue;
      // Gradually give up vertical support while still reacting through the feet.
      const settle = new THREE.Vector3(0, -(32 + amount * 82) * quality, 0);
      this.forcePair(pelvis, foot, settle, 140, dt);
    }
  }

  applyDirectedFailingBrace(dt) {
    const r = this.hitReaction;
    if (!r || r.phase !== "failing" || this.dead || this.physiology?.unconscious) return;
    const chest = this.body("chest");
    if (!chest || r.phaseAge < 0.28) return;

    // One hand stays on the wound; the free hand that V9 already tracks is
    // allowed to search for the floor as support disappears.
    const freeSide = this.coping?.freeSide || "R";
    const hand = this.body("hand" + freeSide);
    if (!hand) return;

    const chestPos = v(chest.translation());
    if (chestPos.y > 1.18) return;
    const velocity = v(chest.linvel());
    const fallDir = new THREE.Vector3(velocity.x, 0, velocity.z);
    if (fallDir.lengthSq() < 0.015) {
      fallDir.copy(v(this.lastHit?.dir || { x: 0, y: 0, z: -1 }));
      fallDir.y = 0;
    }
    if (fallDir.lengthSq() > 1e-6) fallDir.normalize();
    const sign = freeSide === "L" ? -1 : 1;
    const goal = chestPos
      .clone()
      .addScaledVector(fallDir, 0.28)
      .add(new THREE.Vector3(sign * 0.27, -0.5, 0));
    goal.y = Math.max(0.075, goal.y);
    this.pullHandTo("hand" + freeSide, goal, 0.58, dt);
  }

  update(dt) {
    if (this.hitReaction && this.physiology) {
      this.hitReaction.update(dt, this.physiology, this.directedLimbCapacity());
    }

    super.update(dt);
    const r = this.hitReaction;
    if (!r) return;

    this.applyDirectedFailingBrace(dt);

    if (r.phase === "ragdoll") {
      // The passive body takes over only at the END of the reaction sequence or
      // immediately for genuine physiological unconsciousness/CNS failure.
      this.step.phase = "idle";
      if (this.behavior) {
        this.behavior.phase = "collapse";
        this.behavior.guard *= 0.25;
      }
      if (!this.dead) this.setState("collapse");
    }
  }

  reactionSnapshot() {
    return this.hitReaction?.snapshot?.() ?? null;
  }

  behaviorSnapshot() {
    return {
      base: super.behaviorSnapshot?.() ?? null,
      reaction: this.reactionSnapshot(),
    };
  }
}
