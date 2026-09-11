import * as THREE from "three";
import { ActiveHuman } from "./active_human.js";

const clamp = THREE.MathUtils.clamp;
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);
const q = (value) => new THREE.Quaternion(value.x, value.y, value.z, value.w);

// Original controller inspired by the visible behaviour of active-ragdoll systems:
// local reactions are allowed to happen first, then balance tries to rescue them.
// This does not contain Artagdoll code or assets.
export class ArtagdollHuman extends ActiveHuman {
  initializeControl() {
    super.initializeControl();
    this.controllerStyle = "artagdoll-inspired";
    this.state = "balance";
    this.history = ["balance"];
    this.reaction = {
      age: 99,
      strength: 0,
      part: "chest",
      dir: new THREE.Vector3(0, 0, -1),
      point: new THREE.Vector3(),
      headStun: 0,
    };
    this.downTime = 0;
    this.balanceTime = 0;
  }

  setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.stateTime = 0;
    this.history.push(next);
    if (this.history.length > 48) this.history.shift();
  }

  hit(part, dir, strength = 12, point) {
    const rb = this.body(part) || this.body("chest");
    const direction = v(dir);
    if (direction.lengthSq() < 1e-10) return;
    direction.normalize();
    const impulse = direction.clone().multiplyScalar(clamp(strength, 0, 28));
    const hitPoint = v(point || rb.translation());
    rb.applyImpulseAtPoint(impulse, hitPoint, true);

    if (this.dead) return;

    this.lastHit = { part, dir: direction.clone(), point: hitPoint.clone() };
    this.hitAge = 0;
    this.shock = Math.min(1, this.shock + strength / 34);
    this.reaction.age = 0;
    this.reaction.strength = clamp(strength / 18, 0.15, 1.5);
    this.reaction.part = part;
    this.reaction.dir.copy(direction);
    this.reaction.point.copy(hitPoint);

    const side = part.endsWith("L") ? "L" : part.endsWith("R") ? "R" : null;
    if (side && /thigh|shin|foot/.test(part))
      this.injury[side] = clamp(this.injury[side] + strength / 68, 0, 1);
    if (side && /Arm/.test(part))
      this.injury["arm" + side] = clamp(
        this.injury["arm" + side] + strength / 72,
        0,
        1,
      );

    if (part === "head")
      this.reaction.headStun = clamp(
        this.reaction.headStun + strength / 24,
        0,
        1.25,
      );

    this.health -=
      strength *
      (part === "head" ? 0.038 : /chest|abdomen/.test(part) ? 0.011 : 0.0025);

    if (this.health <= 0 || (this.injury.L > 0.96 && this.injury.R > 0.96)) {
      this.dead = true;
      this.step.phase = "idle";
      this.setState("limp");
      return;
    }

    // The impact owns the first few frames. Balance is allowed to respond after it.
    this.setState("react");
  }

  beginScrambleStep(capture) {
    if (this.step.phase !== "idle" || this.step.cooldown > 0) return;
    super.beginStep(capture);
    if (this.step.phase !== "idle") {
      this.step.time = 0;
      this.step.from.copy(v(this.body("foot" + this.step.side).translation()));
      // Artagdoll-like stumbling looks better when the rescue step slightly
      // exaggerates momentum instead of always aiming directly under the COM.
      const lateral = this.step.side === "L" ? -0.025 : 0.025;
      this.step.target.x += lateral;
      this.step.target.addScaledVector(this.reaction.dir, -0.035 * this.reaction.strength);
    }
  }

  update(dt) {
    this.age += dt;
    this.hitAge += dt;
    this.stateTime += dt;
    this.reaction.age += dt;
    this.metrics.activeImpulse = 0;

    for (const muscle of this.muscles) this.passiveLimit(muscle, dt);
    if (this.dead) return;

    this.shock *= Math.exp(-dt * 1.8);
    this.reaction.headStun *= Math.exp(-dt * 1.15);
    this.step.cooldown -= dt;

    const pelvis = this.body("pelvis");
    const chest = this.body("chest");
    const pp = v(pelvis.translation());
    const pv = v(pelvis.linvel());
    const cp = v(chest.translation());
    const cv = v(chest.linvel());
    const com = this.centreOfMass();
    const chestUp = v(UP).applyQuaternion(q(chest.rotation())).y;
    const pelvisUp = v(UP).applyQuaternion(q(pelvis.rotation())).y;

    let supportQuality = 0;
    let supportCenter = new THREE.Vector3();
    for (const side of ["L", "R"]) {
      const foot = this.body("foot" + side);
      const quality = this.footQuality(foot);
      const data = this.feet[side];
      if (quality > 0.38 && data.quality <= 0.38)
        data.anchor.copy(v(foot.translation()));
      data.quality = quality;
      supportQuality += quality;
      supportCenter.addScaledVector(v(foot.translation()), quality);
    }
    if (supportQuality > 0.001) supportCenter.multiplyScalar(1 / supportQuality);
    else supportCenter.copy(pp).setY(0);
    this.support = supportQuality;

    const capture = com.position
      .clone()
      .addScaledVector(
        com.velocity,
        Math.sqrt(Math.max(0.22, com.position.y - supportCenter.y) / 9.81),
      );
    capture.y = supportCenter.y;
    const balanceVector = new THREE.Vector3(
      capture.x - supportCenter.x,
      0,
      capture.z - supportCenter.z,
    );
    const balanceError = balanceVector.length();
    const horizontalSpeed = Math.hypot(com.velocity.x, com.velocity.z);
    const grounded = supportQuality > 0.2;
    const low = pp.y < 0.48 || cp.y < 0.72;
    const falling = !grounded && pv.y < -0.65;

    if (low) {
      this.downTime += dt;
      this.balanceTime = 0;
      this.setState("down");
    } else {
      this.downTime = 0;
      const freshReaction = this.reaction.age < 0.42;
      const unstable =
        balanceError > 0.105 ||
        horizontalSpeed > 0.58 ||
        chestUp < 0.72 ||
        pelvisUp < 0.7 ||
        falling;
      if (freshReaction) {
        this.balanceTime = 0;
        this.setState("react");
      } else if (unstable) {
        this.balanceTime = 0;
        this.setState(falling || chestUp < 0.45 ? "fall" : "stumble");
      } else {
        this.balanceTime += dt;
        if (this.balanceTime > 0.18) this.setState("balance");
      }
    }

    const activeStanding =
      this.state === "balance" || this.state === "react" || this.state === "stumble";
    const reactionEnvelope =
      Math.exp(-this.reaction.age * 5.5) * this.reaction.strength;
    const headInhibition = clamp(1 - this.reaction.headStun * 0.62, 0.25, 1);
    const shockInhibition = clamp(1 - this.shock * 0.38, 0.48, 1);
    const activity = headInhibition * shockInhibition;

    if (!activeStanding && this.step.phase !== "idle") {
      this.step.phase = "idle";
      this.step.cooldown = 0.18;
    }

    // The rescue system is intentionally eager: several imperfect steps look
    // more human than one huge perfect catch step.
    if (
      activeStanding &&
      grounded &&
      this.step.phase === "idle" &&
      this.step.cooldown <= 0 &&
      pp.y > 0.62 &&
      (balanceError > 0.072 ||
        horizontalSpeed > 0.42 ||
        (this.state === "react" && this.reaction.strength > 0.55))
    )
      this.beginScrambleStep(capture);

    if (this.step.phase !== "idle") {
      this.step.time += dt;
      if (this.step.phase === "lift" && this.step.time > 0.075) {
        this.step.phase = "travel";
        this.step.time = 0;
      } else if (this.step.phase === "travel" && this.step.time > 0.18) {
        this.step.phase = "plant";
        this.step.time = 0;
      } else if (
        this.step.phase === "plant" &&
        (this.feet[this.step.side].quality > 0.42 || this.step.time > 0.2)
      ) {
        if (this.feet[this.step.side].quality > 0.42) this.metrics.plants++;
        this.feet[this.step.side].anchor.copy(
          v(this.body("foot" + this.step.side).translation()),
        );
        this.step.phase = "idle";
        this.step.cooldown = balanceError > 0.09 ? 0.045 : 0.13;
      }
    }

    const targets = {};
    const swing = this.step.phase !== "idle" ? this.step.side : null;

    for (const side of ["L", "R"]) {
      const foot = this.body("foot" + side);
      const fp = v(foot.translation());
      const fv = v(foot.linvel());
      const injured = this.injury[side];
      let target = this.feet[side].anchor.clone();

      if (side === swing) {
        const step = this.step;
        const progress =
          step.phase === "lift"
            ? 0
            : step.phase === "travel"
              ? clamp(step.time / 0.18, 0, 1)
              : 1;
        const smooth = progress * progress * (3 - 2 * progress);
        target.lerpVectors(step.from, step.target, smooth);
        const lift =
          step.phase === "lift"
            ? 0.095 * clamp(step.time / 0.075, 0, 1)
            : step.phase === "travel"
              ? 0.095 + Math.sin(progress * Math.PI) * 0.025
              : 0.095 * (1 - clamp(step.time / 0.14, 0, 1));
        target.y += lift;
        const force = target
          .clone()
          .sub(fp)
          .multiplyScalar(215)
          .addScaledVector(fv, -18);
        this.forcePair(foot, pelvis, force, 92 * (1 - injured * 0.58), dt);
      } else if (this.feet[side].quality > 0.2 && activeStanding) {
        // Keep planted feet from ice-skating, but allow them to break free when
        // the body genuinely pulls hard enough.
        const anchorError = this.feet[side].anchor.clone().sub(fp);
        anchorError.y = 0;
        const footHorizontalVelocity = new THREE.Vector3(fv.x, 0, fv.z);
        const traction = anchorError
          .multiplyScalar(125)
          .addScaledVector(footHorizontalVelocity, -14);
        this.forcePair(foot, pelvis, traction, 52 * (1 - injured * 0.5), dt);
      }

      this.legTargets(side, target, targets);
    }

    // Weight support is gentle and compliant. It should not turn every shot
    // into an automatic crouch or forcibly restore a perfect pose.
    if (activeStanding && grounded) {
      const available = ["L", "R"].map((side) => ({
        side,
        q: this.feet[side].quality,
        strength: 1 - this.injury[side] * 0.78,
      }));
      const totalLoad = available.reduce((sum, item) => sum + item.q * item.strength, 0);
      for (const item of available) {
        if (item.q <= 0.1 || item.side === swing || totalLoad <= 0.05) continue;
        const share = (item.q * item.strength) / totalLoad;
        const supportFoot = this.body("foot" + item.side);
        const nominalHeight = 0.94;
        const correction = clamp(
          (nominalHeight - pp.y) * 430 - pv.y * 72,
          -90,
          260,
        );
        const force = new THREE.Vector3(
          clamp((supportCenter.x - com.position.x) * 150 - com.velocity.x * 42, -85, 85),
          Math.max(0, this.mass * 9.81 * share + correction * share * activity),
          clamp((supportCenter.z - com.position.z) * 150 - com.velocity.z * 42, -85, 85),
        );
        this.forcePair(pelvis, supportFoot, force, 510, dt);
      }

      const uprightError = v(UP)
        .applyQuaternion(q(pelvis.rotation()))
        .cross(UP)
        .multiplyScalar(175)
        .addScaledVector(v(pelvis.angvel()), -22);
      for (const side of ["L", "R"])
        if (this.feet[side].quality > 0.2 && side !== swing)
          this.torquePair(
            this.body("foot" + side),
            pelvis,
            uprightError.clone().multiplyScalar(activity / Math.max(1, supportQuality)),
            68,
            dt,
          );
    }

    // Local hit response. The struck body segment leads; the rest of the body
    // catches up through the joints and balance controller.
    const hitDir = this.reaction.dir;
    const sideSign = this.reaction.point.x < pp.x ? -1 : 1;
    const torsoPitch = clamp(-hitDir.z * reactionEnvelope * 0.42, -0.48, 0.48);
    const torsoYaw = clamp(hitDir.x * reactionEnvelope * 0.32, -0.36, 0.36);
    const torsoRoll = clamp(-sideSign * reactionEnvelope * 0.12, -0.18, 0.18);

    targets.abdomen = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(torsoPitch * 0.52, torsoYaw * 0.42, torsoRoll * 0.35),
    );
    targets.chest = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(torsoPitch, torsoYaw, torsoRoll),
    );

    const headHit = this.reaction.part === "head";
    targets.head = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        clamp((headHit ? -hitDir.z * 0.78 : -torsoPitch * 0.4) * reactionEnvelope, -0.75, 0.75),
        clamp((headHit ? hitDir.x * 0.72 : -torsoYaw * 0.3) * reactionEnvelope, -0.7, 0.7),
        clamp((headHit ? -sideSign * 0.32 : 0) * reactionEnvelope, -0.35, 0.35),
      ),
    );

    const fallVector = new THREE.Vector3(com.velocity.x, 0, com.velocity.z);
    if (fallVector.lengthSq() < 0.04) fallVector.copy(hitDir).setY(0).multiplyScalar(-1);
    if (fallVector.lengthSq() > 0.001) fallVector.normalize();

    for (const side of ["L", "R"]) {
      const sign = side === "L" ? -1 : 1;
      const struckArm = this.reaction.part === "upperArm" + side || this.reaction.part === "lowerArm" + side;
      const loose = this.state === "stumble" || this.state === "fall" || this.state === "down";
      let shoulderPitch = -0.08;
      let shoulderRoll = sign * 0.1;
      let elbow = -0.16;

      if (struckArm && this.reaction.age < 0.65) {
        shoulderPitch = clamp(-0.42 - hitDir.z * reactionEnvelope * 0.65, -1.05, 0.45);
        shoulderRoll = sign * clamp(0.45 + reactionEnvelope * 0.55, 0.35, 1.15);
        elbow = -0.82;
      } else if (headHit && this.reaction.age < 0.7) {
        shoulderPitch = -0.55;
        shoulderRoll = sign * 0.48;
        elbow = -1.05;
      } else if (loose) {
        shoulderPitch = clamp(-0.18 - fallVector.z * 0.28, -0.62, 0.2);
        shoulderRoll = sign * (0.42 + Math.min(horizontalSpeed, 2) * 0.18);
        elbow = -0.35;
      }

      targets["upperArm" + side] = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(shoulderPitch, 0, shoulderRoll),
      );
      targets["lowerArm" + side] = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(elbow, 0, 0),
      );
    }

    // On the floor we deliberately stop trying to stand. Artagdoll's appeal is
    // the physical collapse itself; a separate get-up controller can come later.
    if (this.state === "down" || this.state === "fall") {
      const floorActivity = this.state === "down" ? 0.13 : 0.22;
      for (const muscle of this.muscles) {
        const [a, b, , , gain, damping, cap] = muscle;
        let strength = floorActivity * headInhibition;
        if (/Arm/.test(b)) strength *= 1 - this.injury["arm" + b.slice(-1)] * 0.8;
        if (/thigh|shin|foot/.test(b)) strength *= 1 - this.injury[b.slice(-1)] * 0.8;
        this.cohere(
          this.body(a),
          this.body(b),
          targets[b] || IDENTITY,
          gain * 0.55,
          damping * 0.65,
          cap * 0.52,
          strength,
          dt,
        );
      }
      return;
    }

    for (const muscle of this.muscles) {
      const [a, b, , , gain, damping, cap] = muscle;
      let strength = activity;
      if (/Arm/.test(b))
        strength *= (0.62 - (this.state === "react" ? 0.16 : 0)) *
          (1 - this.injury["arm" + b.slice(-1)] * 0.82);
      else if (/thigh|shin|foot/.test(b)) {
        const side = b.slice(-1);
        const supportBias = side === swing ? 0.52 : 0.82;
        strength *= supportBias * (1 - this.injury[side] * 0.82);
      } else if (b === "head") {
        strength *= headHit && this.reaction.age < 0.45 ? 0.32 : 0.68;
      } else {
        // Let the spine visibly give under an impact instead of acting like a pole.
        strength *= this.state === "react" ? 0.5 : this.state === "stumble" ? 0.66 : 0.76;
      }

      this.cohere(
        this.body(a),
        this.body(b),
        targets[b] || IDENTITY,
        gain,
        damping,
        cap,
        clamp(strength, 0.05, 1),
        dt,
      );
    }
  }
}
