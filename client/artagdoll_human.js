import * as THREE from "three";
import { ActiveHuman } from "./active_human.js";

const clamp = THREE.MathUtils.clamp;
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);
const q = (value) => new THREE.Quaternion(value.x, value.y, value.z, value.w);

// Original active-ragdoll controller inspired by the visible behaviour of
// Artagdoll-style systems: local impact response first, imperfect scrambling
// balance second. No Artagdoll code or assets are used here.
export class ArtagdollHuman extends ActiveHuman {
  initializeControl() {
    super.initializeControl();
    this.controllerStyle = "artagdoll-inspired-v3";
    this.state = "balance";
    this.history = ["balance"];
    this.reaction = {
      age: 99,
      strength: 0,
      part: "chest",
      dir: new THREE.Vector3(0, 0, -1),
      point: new THREE.Vector3(),
      headStun: 0,
      legStun: { L: 0, R: 0 },
      armStun: { L: 0, R: 0 },
    };
    this.balanceTime = 0;
    this.downTime = 0;
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

    const torso = /pelvis|abdomen|chest/.test(part);
    const leg = /thigh|shin|foot/.test(part);
    const arm = /Arm/.test(part);
    const head = part === "head";
    const impulseScale = head ? 0.52 : torso ? 0.52 : leg ? 0.56 : arm ? 0.4 : 0.52;
    const impulse = direction
      .clone()
      .multiplyScalar(clamp(strength, 0, 28) * impulseScale);
    const hitPoint = v(point || rb.translation());
    rb.applyImpulseAtPoint(impulse, hitPoint, true);

    if (this.dead) return;

    this.lastHit = { part, dir: direction.clone(), point: hitPoint.clone() };
    this.hitAge = 0;
    this.shock = Math.min(1, this.shock + strength / 42);
    this.reaction.age = 0;
    this.reaction.strength = clamp(strength / 18, 0.12, 1.45);
    this.reaction.part = part;
    this.reaction.dir.copy(direction);
    this.reaction.point.copy(hitPoint);

    const side = part.endsWith("L") ? "L" : part.endsWith("R") ? "R" : null;
    if (side && leg) {
      this.injury[side] = clamp(this.injury[side] + strength / 92, 0, 1);
      this.reaction.legStun[side] = clamp(
        Math.max(this.reaction.legStun[side], strength / 23),
        0,
        1,
      );
    }
    if (side && arm) {
      this.injury["arm" + side] = clamp(
        this.injury["arm" + side] + strength / 110,
        0,
        1,
      );
      this.reaction.armStun[side] = clamp(
        Math.max(this.reaction.armStun[side], strength / 26),
        0,
        1,
      );
    }
    if (head)
      this.reaction.headStun = clamp(
        Math.max(this.reaction.headStun, strength / 24),
        0,
        1.2,
      );

    this.health -=
      strength * (head ? 0.038 : torso ? 0.011 : leg || arm ? 0.0025 : 0.003);

    if (this.health <= 0 || (this.injury.L > 0.97 && this.injury.R > 0.97)) {
      this.dead = true;
      this.step.phase = "idle";
      this.setState("limp");
      return;
    }

    this.setState("react");
  }

  beginScrambleStep(capture) {
    if (this.step.phase !== "idle" || this.step.cooldown > 0) return;
    super.beginStep(capture);
    if (this.step.phase === "idle") return;
    this.step.time = 0;
    this.step.from.copy(v(this.body("foot" + this.step.side).translation()));
    const lateral = this.step.side === "L" ? -0.02 : 0.02;
    this.step.target.x += lateral;
    if (this.reaction.age < 0.55)
      this.step.target.addScaledVector(
        this.reaction.dir,
        -0.025 * this.reaction.strength,
      );
  }

  update(dt) {
    this.age += dt;
    this.hitAge += dt;
    this.stateTime += dt;
    this.reaction.age += dt;
    this.metrics.activeImpulse = 0;

    for (const muscle of this.muscles) this.passiveLimit(muscle, dt);
    if (this.dead) return;

    this.shock *= Math.exp(-dt * 1.9);
    this.reaction.headStun *= Math.exp(-dt * 1.25);
    for (const side of ["L", "R"]) {
      this.reaction.legStun[side] *= Math.exp(-dt * 1.55);
      this.reaction.armStun[side] *= Math.exp(-dt * 1.7);
    }
    this.step.cooldown -= dt;

    const pelvis = this.body("pelvis");
    const chest = this.body("chest");
    const pp = v(pelvis.translation());
    const pv = v(pelvis.linvel());
    const cp = v(chest.translation());
    const com = this.centreOfMass();
    const chestUp = v(UP).applyQuaternion(q(chest.rotation())).y;
    const pelvisUp = v(UP).applyQuaternion(q(pelvis.rotation())).y;

    let supportQuality = 0;
    const supportCenter = new THREE.Vector3();
    for (const side of ["L", "R"]) {
      const foot = this.body("foot" + side);
      const quality = this.footQuality(foot);
      const data = this.feet[side];
      if (quality > 0.4 && data.quality <= 0.4)
        data.anchor.copy(v(foot.translation()));
      data.quality = quality;
      supportQuality += quality;
      supportCenter.addScaledVector(v(foot.translation()), quality);
    }
    if (supportQuality > 1e-4) supportCenter.multiplyScalar(1 / supportQuality);
    else supportCenter.copy(pp).setY(0);
    this.support = supportQuality;

    const capture = com.position
      .clone()
      .addScaledVector(
        com.velocity,
        Math.sqrt(Math.max(0.22, com.position.y - supportCenter.y) / 9.81),
      );
    capture.y = supportCenter.y;
    const balanceError = Math.hypot(
      capture.x - supportCenter.x,
      capture.z - supportCenter.z,
    );
    const horizontalSpeed = Math.hypot(com.velocity.x, com.velocity.z);
    const grounded = supportQuality > 0.18;
    const torsoGround =
      this.contact("pelvis") || this.contact("abdomen") || this.contact("chest");
    const trulyDown =
      torsoGround || (pp.y < 0.42 && cp.y < 0.72) || (pp.y < 0.3 && cp.y < 0.9);
    const freshReaction = this.reaction.age < 0.5;
    const falling =
      (!grounded && pv.y < -1.25) ||
      chestUp < 0.26 ||
      pelvisUp < 0.3 ||
      pp.y < 0.54;
    const unstable =
      balanceError > 0.12 || horizontalSpeed > 0.65 || chestUp < 0.72 || pelvisUp < 0.7;

    if (trulyDown) {
      this.downTime += dt;
      this.balanceTime = 0;
      this.setState("down");
    } else if (this.state === "collapse") {
      this.balanceTime = 0;
    } else if (freshReaction) {
      this.downTime = 0;
      this.balanceTime = 0;
      this.setState("react");
    } else if (falling) {
      this.downTime = 0;
      this.balanceTime = 0;
      this.setState("fall");
    } else if (unstable) {
      this.downTime = 0;
      this.balanceTime = 0;
      this.setState("stumble");
    } else {
      this.downTime = 0;
      this.balanceTime += dt;
      if (this.balanceTime > 0.22) this.setState("balance");
    }

    // Give a bad fall a short rescue window. If the torso is still folded after
    // that window, stop doing the endless running-at-90-degrees thing and let
    // the body complete the ragdoll fall.
    if (
      this.state === "fall" &&
      this.stateTime > 1.05 &&
      (cp.y < 0.95 || chestUp < 0.52)
    )
      this.setState("collapse");

    const rescuing =
      this.state !== "down" && this.state !== "collapse" && this.state !== "limp";
    const reactionEnvelope =
      Math.exp(-this.reaction.age * 4.8) * this.reaction.strength;
    const headActivity = clamp(1 - this.reaction.headStun * 0.48, 0.42, 1);
    const shockActivity = clamp(1 - this.shock * 0.28, 0.62, 1);
    const activity = headActivity * shockActivity;

    if (!rescuing && this.step.phase !== "idle") {
      this.step.phase = "idle";
      this.step.cooldown = 0.2;
    }

    const wantsStep =
      this.state === "react" ||
      this.state === "stumble" ||
      this.state === "fall" ||
      balanceError > 0.145 ||
      horizontalSpeed > 0.62;
    if (
      rescuing &&
      grounded &&
      wantsStep &&
      this.step.phase === "idle" &&
      this.step.cooldown <= 0 &&
      pp.y > 0.55 &&
      (balanceError > 0.068 || horizontalSpeed > 0.3 || freshReaction)
    )
      this.beginScrambleStep(capture);

    if (this.step.phase !== "idle") {
      this.step.time += dt;
      if (this.step.phase === "lift" && this.step.time > 0.09) {
        this.step.phase = "travel";
        this.step.time = 0;
      } else if (this.step.phase === "travel" && this.step.time > 0.22) {
        this.step.phase = "plant";
        this.step.time = 0;
      } else if (
        this.step.phase === "plant" &&
        (this.feet[this.step.side].quality > 0.42 || this.step.time > 0.22)
      ) {
        if (this.feet[this.step.side].quality > 0.42) this.metrics.plants++;
        this.feet[this.step.side].anchor.copy(
          v(this.body("foot" + this.step.side).translation()),
        );
        this.step.phase = "idle";
        this.step.cooldown = balanceError > 0.1 ? 0.07 : 0.16;
      }
    }

    const targets = {};
    const swing = this.step.phase !== "idle" ? this.step.side : null;

    for (const side of ["L", "R"]) {
      const foot = this.body("foot" + side);
      const fp = v(foot.translation());
      const fv = v(foot.linvel());
      const injured = this.injury[side];
      const stunned = this.reaction.legStun[side];
      let target = this.feet[side].anchor.clone();

      if (side === swing) {
        const step = this.step;
        const progress =
          step.phase === "lift"
            ? 0
            : step.phase === "travel"
              ? clamp(step.time / 0.22, 0, 1)
              : 1;
        const smooth = progress * progress * (3 - 2 * progress);
        target.lerpVectors(step.from, step.target, smooth);
        target.y +=
          step.phase === "lift"
            ? 0.095 * clamp(step.time / 0.09, 0, 1)
            : step.phase === "travel"
              ? 0.095 + Math.sin(progress * Math.PI) * 0.025
              : 0.095 * (1 - clamp(step.time / 0.16, 0, 1));
        const force = target
          .clone()
          .sub(fp)
          .multiplyScalar(225)
          .addScaledVector(fv, -19);
        this.forcePair(
          foot,
          pelvis,
          force,
          105 * (1 - injured * 0.55) * (1 - stunned * 0.25),
          dt,
        );
      } else if (rescuing && this.feet[side].quality > 0.2) {
        const anchorError = this.feet[side].anchor.clone().sub(fp);
        anchorError.y = 0;
        const traction = anchorError
          .multiplyScalar(150)
          .addScaledVector(new THREE.Vector3(fv.x, 0, fv.z), -17);
        this.forcePair(
          foot,
          pelvis,
          traction,
          68 * (1 - injured * 0.45) * (1 - stunned * 0.35),
          dt,
        );
      }

      this.legTargets(side, target, targets);
    }

    if (rescuing && grounded) {
      const available = ["L", "R"].map((side) => ({
        side,
        q: this.feet[side].quality,
        strength:
          (1 - this.injury[side] * 0.72) *
          (1 - this.reaction.legStun[side] * 0.58),
      }));
      const supportLoad = available.reduce(
        (sum, item) =>
          sum + (item.side === swing ? 0 : item.q * Math.max(0.12, item.strength)),
        0,
      );

      for (const item of available) {
        if (item.side === swing || item.q <= 0.1 || supportLoad <= 0.02) continue;
        const share =
          (item.q * Math.max(0.12, item.strength)) / supportLoad;
        const supportFoot = this.body("foot" + item.side);
        const heightTarget = 0.94 - this.injury[item.side] * 0.035;
        const heightCorrection = clamp(
          (heightTarget - pp.y) * 920 - pv.y * 135,
          -120,
          520,
        );
        const reactionSoftness =
          this.state === "react" ? 0.86 : this.state === "fall" ? 0.72 : 1;
        const force = new THREE.Vector3(
          clamp(
            (supportCenter.x - com.position.x) * 210 - com.velocity.x * 58,
            -120,
            120,
          ),
          Math.max(
            0,
            (this.mass * 9.81 + heightCorrection * reactionSoftness) * share,
          ),
          clamp(
            (supportCenter.z - com.position.z) * 210 - com.velocity.z * 58,
            -120,
            120,
          ),
        );
        this.forcePair(pelvis, supportFoot, force, 760, dt);
      }

      const upright = v(UP)
        .applyQuaternion(q(pelvis.rotation()))
        .cross(UP)
        .multiplyScalar(this.state === "react" ? 210 : 275)
        .addScaledVector(v(pelvis.angvel()), this.state === "react" ? -25 : -34);
      for (const side of ["L", "R"])
        if (side !== swing && this.feet[side].quality > 0.2)
          this.torquePair(
            this.body("foot" + side),
            pelvis,
            upright.clone().multiplyScalar(activity / Math.max(1, supportQuality)),
            this.state === "react" ? 78 : 105,
            dt,
          );

      // During the rescue window, actively try to unfold the torso through the
      // skeleton instead of only holding the pelvis upright.
      if (this.state === "fall" && this.stateTime < 1.05) {
        const chestUpright = v(UP)
          .applyQuaternion(q(chest.rotation()))
          .cross(UP)
          .multiplyScalar(145)
          .addScaledVector(v(chest.angvel()).sub(v(pelvis.angvel())), -18);
        this.torquePair(pelvis, chest, chestUpright, 62, dt);
      }
    }

    const part = this.reaction.part;
    const hitDir = this.reaction.dir;
    const torsoHit = /pelvis|abdomen|chest/.test(part);
    const headHit = part === "head";
    const sideOffset = clamp(
      (this.reaction.point.x - pp.x) * 2.2,
      -0.45,
      0.45,
    );

    const torsoScale = torsoHit ? 1 : headHit ? 0.42 : 0.18;
    targets.abdomen = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        clamp(hitDir.z * reactionEnvelope * 0.16 * torsoScale, -0.22, 0.22),
        clamp(-hitDir.x * reactionEnvelope * 0.12 * torsoScale, -0.18, 0.18),
        clamp(-hitDir.x * reactionEnvelope * 0.18 * torsoScale, -0.22, 0.22),
      ),
    );
    targets.chest = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        clamp(hitDir.z * reactionEnvelope * 0.3 * torsoScale, -0.36, 0.36),
        clamp(sideOffset * reactionEnvelope * 0.28, -0.28, 0.28),
        clamp(-hitDir.x * reactionEnvelope * 0.3 * torsoScale, -0.36, 0.36),
      ),
    );
    targets.head = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        clamp(
          (headHit ? hitDir.z * 0.62 : -hitDir.z * 0.08) * reactionEnvelope,
          -0.65,
          0.65,
        ),
        clamp(
          (headHit ? -hitDir.x * 0.48 : sideOffset * 0.08) * reactionEnvelope,
          -0.52,
          0.52,
        ),
        clamp(
          (headHit ? -sideOffset * 0.5 : 0) * reactionEnvelope,
          -0.42,
          0.42,
        ),
      ),
    );

    const fallDirection = new THREE.Vector3(com.velocity.x, 0, com.velocity.z);
    if (fallDirection.lengthSq() < 0.03) fallDirection.copy(hitDir).setY(0);
    if (fallDirection.lengthSq() > 1e-4) fallDirection.normalize();

    for (const side of ["L", "R"]) {
      const sign = side === "L" ? -1 : 1;
      const struckArm = part === "upperArm" + side || part === "lowerArm" + side;
      let shoulderPitch = -0.08;
      let shoulderRoll = sign * 0.1;
      let elbow = -0.16;

      if (struckArm && this.reaction.age < 0.7) {
        shoulderPitch = clamp(-0.28 + hitDir.z * reactionEnvelope * 0.38, -0.82, 0.35);
        shoulderRoll = sign * clamp(0.35 + reactionEnvelope * 0.48, 0.3, 0.95);
        elbow = -0.72;
      } else if (headHit && this.reaction.age < 0.65) {
        shoulderPitch = -0.45;
        shoulderRoll = sign * 0.42;
        elbow = -0.9;
      } else if (this.state === "fall" || this.state === "collapse") {
        const chaos = clamp(horizontalSpeed / 1.4 + (1 - Math.max(chestUp, 0)), 0, 1);
        shoulderPitch = clamp(
          -0.2 - fallDirection.z * 0.2 + Math.sin(this.age * 11 + sign) * 0.12 * chaos,
          -0.58,
          0.12,
        );
        shoulderRoll = sign * (0.44 + chaos * 0.18);
        elbow = -0.42 - chaos * 0.12;
      } else if (this.state === "stumble") {
        const chaos = clamp(horizontalSpeed / 1.2 + balanceError * 2, 0, 1);
        shoulderPitch = Math.sin(this.age * 10 + sign) * 0.1 * chaos;
        shoulderRoll = sign * (0.22 + chaos * 0.22);
        elbow = -0.26;
      }

      targets["upperArm" + side] = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(shoulderPitch, 0, shoulderRoll),
      );
      targets["lowerArm" + side] = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(elbow, 0, 0),
      );

      // Soft procedural brace: when a fall is really happening, reach the
      // forearms toward the floor in the direction of travel. Equal/opposite
      // forces keep this physical rather than teleporting the limb.
      if ((this.state === "fall" || this.state === "collapse") && cp.y < 1.15) {
        const arm = this.body("lowerArm" + side);
        const goal = cp
          .clone()
          .addScaledVector(fallDirection, 0.32)
          .add(new THREE.Vector3(sign * 0.24, -0.48, 0));
        goal.y = Math.max(0.12, goal.y);
        const braceForce = goal
          .sub(v(arm.translation()))
          .multiplyScalar(75)
          .addScaledVector(v(arm.linvel()).sub(v(chest.linvel())), -8);
        this.forcePair(
          arm,
          chest,
          braceForce,
          55 * (1 - this.injury["arm" + side] * 0.72),
          dt,
        );
      }
    }

    if (this.state === "down" || this.state === "collapse") {
      const floorActivity =
        this.state === "collapse" ? 0.12 : this.reaction.age < 0.9 ? 0.18 : 0.08;
      for (const muscle of this.muscles) {
        const [a, b, , , gain, damping, cap] = muscle;
        let strength = floorActivity * headActivity;
        if (/Arm/.test(b))
          strength *= 1 - this.injury["arm" + b.slice(-1)] * 0.75;
        if (/thigh|shin|foot/.test(b))
          strength *= 1 - this.injury[b.slice(-1)] * 0.75;
        this.cohere(
          this.body(a),
          this.body(b),
          targets[b] || IDENTITY,
          gain * 0.55,
          damping * 0.7,
          cap * 0.55,
          strength,
          dt,
        );
      }
      return;
    }

    for (const muscle of this.muscles) {
      const [a, b, , , gain, damping, cap] = muscle;
      let strength = activity;

      if (/Arm/.test(b)) {
        const side = b.slice(-1);
        strength *=
          (this.state === "react" ? 0.46 : 0.62) *
          (1 - this.injury["arm" + side] * 0.78) *
          (1 - this.reaction.armStun[side] * 0.5);
      } else if (/thigh|shin|foot/.test(b)) {
        const side = b.slice(-1);
        strength *=
          (side === swing ? 0.55 : 0.9) *
          (1 - this.injury[side] * 0.78) *
          (1 - this.reaction.legStun[side] * 0.55);
      } else if (b === "head") {
        strength *= headHit && this.reaction.age < 0.45 ? 0.24 : 0.66;
      } else {
        strength *=
          this.state === "react" ? 0.48 : this.state === "fall" ? 0.6 : 0.74;
      }

      this.cohere(
        this.body(a),
        this.body(b),
        targets[b] || IDENTITY,
        gain,
        damping,
        cap,
        clamp(strength, 0.04, 1),
        dt,
      );
    }
  }
}
