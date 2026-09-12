import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

const clamp = THREE.MathUtils.clamp;
const UP = new THREE.Vector3(0, 1, 0);
const v = (p) => new THREE.Vector3(p.x, p.y, p.z);
const q = (r) => new THREE.Quaternion(r.x, r.y, r.z, r.w);

function cross2(a, b, c) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function hullXZ(points) {
  if (points.length <= 2) return points.map((p) => p.clone());
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross2(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross2(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function pointSegmentDistanceXZ(p, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const d = abx * abx + abz * abz;
  const t = d > 1e-8 ? clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / d, 0, 1) : 0;
  const x = a.x + abx * t;
  const z = a.z + abz * t;
  return Math.hypot(p.x - x, p.z - z);
}

function signedDistanceToHullXZ(p, hull) {
  if (!hull.length) return Infinity;
  if (hull.length === 1) return p.distanceTo(hull[0]);
  if (hull.length === 2) return pointSegmentDistanceXZ(p, hull[0], hull[1]);
  let inside = true;
  let min = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    if (cross2(a, b, p) < -1e-5) inside = false;
    min = Math.min(min, pointSegmentDistanceXZ(p, a, b));
  }
  return inside ? -min : min;
}

function smooth01(x) {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
}

export class EuphoriaBalanceController {
  constructor(human) {
    this.h = human;
    this.state = "stable";
    this.stateAge = 0;
    this.risk = 0;
    this.supportHull = [];
    this.supportCenter = new THREE.Vector3();
    this.com = new THREE.Vector3();
    this.comVelocity = new THREE.Vector3();
    this.capture = new THREE.Vector3();
    this.projectedCom = new THREE.Vector3();
    this.escape = new THREE.Vector3();
    this.recoveryFoot = null;
    this.stepTarget = null;
    this.stepNeed = 0;
    this.fallAge = 0;
    this.stableAge = 0;
    this.variation = { L: -0.013, R: 0.011 };
    this.debugEnabled = false;
    this.debug = null;
    this.last = null;
  }

  footCorners(side) {
    const h = this.h;
    const rb = h.body("foot" + side);
    if (!rb) return [];
    const quality = h.feet?.[side]?.quality ?? h.footQuality(rb);
    if (quality < 0.08) return [];
    const pos = v(rb.translation());
    const rot = q(rb.rotation());
    const corners = [];
    for (const x of [-0.088, 0.088]) {
      for (const z of [-0.158, 0.158]) {
        corners.push(new THREE.Vector3(x, -0.04, z).applyQuaternion(rot).add(pos));
      }
    }
    return corners;
  }

  sample() {
    const h = this.h;
    const pelvis = h.body("pelvis");
    const chest = h.body("chest");
    const com = h.centreOfMass();
    this.com.copy(com.position);
    this.comVelocity.copy(com.velocity);

    const corners = [...this.footCorners("L"), ...this.footCorners("R")];
    this.supportHull = hullXZ(corners);
    this.supportCenter.set(0, 0, 0);
    if (this.supportHull.length) {
      for (const p of this.supportHull) this.supportCenter.add(p);
      this.supportCenter.multiplyScalar(1 / this.supportHull.length);
    } else {
      this.supportCenter.copy(v(pelvis.translation())).setY(0);
    }

    const groundY = this.supportHull.length
      ? this.supportHull.reduce((s, p) => s + p.y, 0) / this.supportHull.length
      : 0;
    this.supportCenter.y = groundY;
    this.projectedCom.copy(this.com).setY(groundY);

    const height = Math.max(0.25, this.com.y - groundY);
    const tau = clamp(Math.sqrt(height / 9.81), 0.15, 0.38);
    const pelvisAng = v(pelvis.angvel());
    const chestAng = v(chest.angvel());
    const angularPrediction = new THREE.Vector3(
      (pelvisAng.z * 0.7 + chestAng.z * 0.3) * height * 0.045,
      0,
      -(pelvisAng.x * 0.7 + chestAng.x * 0.3) * height * 0.045,
    );
    this.capture
      .copy(this.com)
      .addScaledVector(this.comVelocity, tau)
      .add(angularPrediction)
      .setY(groundY);

    const outside = signedDistanceToHullXZ(this.capture, this.supportHull);
    this.escape.copy(this.capture).sub(this.supportCenter).setY(0);
    if (this.escape.lengthSq() < 1e-6) this.escape.set(0, 0, 1);
    else this.escape.normalize();

    const pelvisUp = UP.clone().applyQuaternion(q(pelvis.rotation()));
    const chestUp = UP.clone().applyQuaternion(q(chest.rotation()));
    const lean = Math.max(0, 1 - pelvisUp.y, 1 - chestUp.y);
    const speed = Math.hypot(this.comVelocity.x, this.comVelocity.z);
    const angular = Math.hypot(pelvisAng.x, pelvisAng.z, chestAng.x, chestAng.z);
    const noSupport = this.supportHull.length === 0;
    const outsideRisk = noSupport ? 1 : clamp((outside + 0.02) / 0.28, 0, 1.3);
    const speedRisk = clamp((speed - 0.08) / 2.0, 0, 1);
    const leanRisk = clamp((lean - 0.015) / 0.55, 0, 1);
    const angularRisk = clamp((angular - 0.2) / 7.0, 0, 1);
    this.risk = clamp(
      outsideRisk * 0.52 + speedRisk * 0.2 + leanRisk * 0.18 + angularRisk * 0.1,
      0,
      1.25,
    );
    this.stepNeed = clamp(Math.max(0, outside) * 2.8 + speed * 0.22 + lean * 0.45, 0, 1.2);

    this.last = {
      outside,
      speed,
      lean,
      angular,
      pelvisUp: pelvisUp.y,
      chestUp: chestUp.y,
      supportCount: this.supportHull.length,
    };
    return this.last;
  }

  classify(dt) {
    const h = this.h;
    const previous = this.state;
    const conscious = !h.dead && !h.physiology?.unconscious && !h.passiveHandoff;
    const pelvisY = h.body("pelvis").translation().y;
    const torsoContact = h.contact("pelvis") || h.contact("abdomen") || h.contact("chest");

    let next;
    if (!conscious) next = "passive";
    else if (torsoContact || pelvisY < 0.38) next = "downed";
    else if (this.risk < 0.16) next = "stable";
    else if (this.risk < 0.34) next = "disturbed";
    else if (this.risk < 0.57) next = "recovering";
    else if (this.risk < 0.82) next = "stumbling";
    else if (this.risk < 1.02) next = "critical";
    else next = "falling";

    if (next !== previous) {
      // Hysteresis: a body has to earn both escalation and recovery. This keeps
      // the controller from visually flickering between named modes.
      const escalation = ["stable", "disturbed", "recovering", "stumbling", "critical", "falling"].indexOf(next) >
        ["stable", "disturbed", "recovering", "stumbling", "critical", "falling"].indexOf(previous);
      if (escalation || this.stateAge > 0.14 || next === "downed" || next === "passive") {
        this.state = next;
        this.stateAge = 0;
      }
    } else {
      this.stateAge += dt;
    }

    if (this.state === "stable") this.stableAge += dt;
    else this.stableAge = 0;
    if (this.state === "falling") this.fallAge += dt;
    else this.fallAge = Math.max(0, this.fallAge - dt * 2);
    return this.state;
  }

  chooseRecoveryFoot() {
    const h = this.h;
    const pelvis = v(h.body("pelvis").translation());
    const lateral = new THREE.Vector3(-this.escape.z, 0, this.escape.x);
    const scores = {};
    for (const side of ["L", "R"]) {
      const other = side === "L" ? "R" : "L";
      const foot = v(h.body("foot" + side).translation());
      const supportOther = h.feet?.[other]?.quality ?? 0;
      const injury = h.injury?.[side] ?? 0;
      const localSide = side === "L" ? -1 : 1;
      const escapeLateral = this.escape.x * localSide;
      const useful = foot.distanceTo(this.capture);
      scores[side] =
        supportOther * 0.72 + useful * 0.75 + escapeLateral * 0.18 - injury * 0.9 +
        (side === h.lastStepSide ? -0.035 : 0.035);
    }
    let side = scores.L > scores.R ? "L" : "R";
    const other = side === "L" ? "R" : "L";
    if ((h.feet?.[other]?.quality ?? 0) < 0.18) side = other;

    const speed = this.last?.speed ?? 0;
    const outside = Math.max(0, this.last?.outside ?? 0);
    const yawAssist = Math.abs(h.body("pelvis").angvel().y) * 0.025;
    const distance = clamp(0.11 + outside * 1.1 + speed * 0.16 + yawAssist, 0.11, 0.52);
    const sign = side === "L" ? -1 : 1;
    const stance = lateral.multiplyScalar(sign * (0.13 + Math.min(0.05, distance * 0.08)));
    const target = pelvis.clone().addScaledVector(this.escape, distance).add(stance);

    // Sideways emergencies may cross-step. It happens only when the escape is
    // already well outside the stance, so normal walking never looks tangled.
    if (Math.abs(this.escape.x) > 0.72 && this.risk > 0.62) {
      target.x += this.escape.x * 0.07;
      target.z += this.variation[side] + Math.sin(h.age * 2.7 + (side === "L" ? 0 : 1.7)) * 0.012;
    }

    const ray = new RAPIER.Ray(
      { x: target.x, y: pelvis.y + 0.32, z: target.z },
      { x: 0, y: -1, z: 0 },
    );
    const ground = h.world.castRay(ray, 1.9, true, undefined, 0x00010001);
    if (!ground) return null;
    target.y = pelvis.y + 0.32 - ground.timeOfImpact + 0.055;
    return { side, target };
  }

  maybeRequestRecoveryStep() {
    const h = this.h;
    if (!["recovering", "stumbling", "critical"].includes(this.state)) return false;
    if (h.step.phase !== "idle" || h.step.cooldown > 0) return false;
    if (h.body("pelvis").translation().y < 0.62) return false;
    if (this.stepNeed < 0.22 && this.risk < 0.42) return false;
    const choice = this.chooseRecoveryFoot();
    if (!choice) return false;
    this.recoveryFoot = choice.side;
    this.stepTarget = choice.target.clone();
    return h.startScrambleStep(choice.target, choice.side);
  }

  applyPlantedFootControl(dt) {
    const h = this.h;
    const swing = h.step.phase !== "idle" ? h.step.side : null;
    const pelvis = h.body("pelvis");
    for (const side of ["L", "R"]) {
      if (side === swing) continue;
      const foot = h.body("foot" + side);
      const data = h.feet?.[side];
      if (!foot || !data || data.quality < 0.38) continue;
      const pos = v(foot.translation());
      const relVel = v(foot.linvel()).sub(v(pelvis.linvel()));
      const error = data.anchor.clone().sub(pos);
      error.y = 0;
      const slip = Math.hypot(error.x, error.z);
      // Friction-like active foot lock. Large disturbances deliberately release
      // instead of welding the foot to the floor.
      const release = smooth01((this.risk - 0.48) / 0.34);
      const force = error.multiplyScalar(220 * (1 - release)).addScaledVector(relVel, -24 * (1 - release));
      force.y = 0;
      h.forcePair(foot, pelvis, force, 72 * (1 - release) + 8, dt);
      if (slip > 0.115 || release > 0.82) data.anchor.lerp(pos, clamp(dt * 7, 0, 1));
    }
  }

  applyWholeBodyBalance(dt) {
    const h = this.h;
    if (this.state === "passive" || this.state === "downed") return;
    const pelvis = h.body("pelvis");
    const abdomen = h.body("abdomen");
    const chest = h.body("chest");
    const risk = this.risk;
    const drive = h.controlDrive?.() ?? 1;
    const pelvisQ = q(pelvis.rotation());
    const localEscape = this.escape.clone().applyQuaternion(pelvisQ.clone().invert());

    // Ankle/hip strategy first. These torques are intentionally modest; if they
    // fail, the capture-point step system gets a chance instead of brute force.
    const pelvisUp = UP.clone().applyQuaternion(pelvisQ);
    const uprightAxis = pelvisUp.cross(UP);
    const angularDamping = v(pelvis.angvel()).multiplyScalar(-10 - risk * 12);
    const correction = uprightAxis.multiplyScalar(55 + risk * 48).add(angularDamping);
    const planted = ["L", "R"].filter((s) => (h.feet?.[s]?.quality ?? 0) > 0.28 && h.step.side !== s);
    for (const side of planted) {
      h.torquePair(h.body("foot" + side), pelvis, correction.clone().multiplyScalar(drive / Math.max(1, planted.length)), 72 + risk * 36, dt);
    }

    // The pelvis yields toward the disturbance while chest/head counter-rotate.
    // This creates the loose delayed chain visible in the reference clip.
    const kneeBend = clamp(risk * 0.34 + Math.max(0, this.last.speed - 0.5) * 0.045, 0, 0.42);
    const pelvisToAbdomen = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        clamp(localEscape.z * (0.05 + risk * 0.18), -0.2, 0.2),
        clamp(-h.body("pelvis").angvel().y * 0.035, -0.16, 0.16),
        clamp(-localEscape.x * (0.04 + risk * 0.14), -0.18, 0.18),
      ),
    );
    const abdomenToChest = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        clamp(-localEscape.z * (0.04 + risk * 0.15), -0.18, 0.18),
        clamp(h.body("pelvis").angvel().y * 0.05, -0.2, 0.2),
        clamp(localEscape.x * (0.04 + risk * 0.12), -0.16, 0.16),
      ),
    );
    h.cohere(pelvis, abdomen, pelvisToAbdomen, 52, 7.5, 32, drive * (0.58 + risk * 0.25), dt);
    h.cohere(abdomen, chest, abdomenToChest, 46, 6.8, 29, drive * (0.55 + risk * 0.22), dt);

    for (const side of ["L", "R"]) {
      const sign = side === "L" ? -1 : 1;
      if ((h.feet?.[side]?.quality ?? 0) > 0.18 && h.step.side !== side) {
        const kneeTarget = new THREE.Quaternion().setFromEuler(new THREE.Euler(kneeBend, 0, 0));
        h.cohere(h.body("thigh" + side), h.body("shin" + side), kneeTarget, 34, 5.5, 28, drive * (0.55 + risk * 0.32), dt);
      }

      const independent = Math.sin(h.age * (side === "L" ? 3.9 : 4.25) + sign * 0.9) * 0.055 * risk;
      const armTarget = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          clamp(-localEscape.z * (0.2 + risk * 0.42) - 0.08 * risk, -0.72, 0.42),
          clamp(sign * h.body("chest").angvel().y * -0.045, -0.22, 0.22),
          sign * (0.12 + risk * 0.38) + independent - localEscape.x * 0.22,
        ),
      );
      h.cohere(chest, h.body("upperArm" + side), armTarget, 22, 3.7, 19, drive * (0.42 + risk * 0.38), dt);
    }
  }

  limitSwingFootSpeed(dt) {
    const h = this.h;
    if (h.step.phase === "idle") return;
    const foot = h.body("foot" + h.step.side);
    const pelvis = h.body("pelvis");
    const relative = v(foot.linvel()).sub(v(pelvis.linvel()));
    const speed = relative.length();
    const maxSpeed = this.state === "critical" ? 2.0 : this.state === "stumbling" ? 1.75 : 1.55;
    if (speed <= maxSpeed) return;
    const brake = relative.normalize().multiplyScalar(-(speed - maxSpeed) * 58);
    h.forcePair(foot, pelvis, brake, 95, dt);
  }

  update(dt) {
    this.sample();
    this.classify(dt);
    this.maybeRequestRecoveryStep();
    this.applyPlantedFootControl(dt);
    this.applyWholeBodyBalance(dt);
    this.limitSwingFootSpeed(dt);
    this.updateDebug();
  }

  muscleScale() {
    if (this.state === "passive") return 0.03;
    if (this.state === "falling") return clamp(0.88 - this.fallAge * 0.34, 0.32, 0.88);
    if (this.state === "critical") return 0.96;
    if (this.state === "stumbling") return 1.0;
    return 1;
  }

  setupDebug() {
    if (this.debug) return;
    const scene = this.h.scene;
    const group = new THREE.Group();
    group.visible = false;
    const material = new THREE.LineBasicMaterial();
    const support = new THREE.LineLoop(new THREE.BufferGeometry(), material);
    const makePoint = (radius) => new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), new THREE.MeshBasicMaterial());
    const com = makePoint(0.045);
    const projection = makePoint(0.035);
    const capture = makePoint(0.038);
    const target = makePoint(0.042);
    group.add(support, com, projection, capture, target);
    scene.add(group);
    this.debug = { group, support, com, projection, capture, target };
  }

  setDebug(enabled) {
    this.setupDebug();
    this.debugEnabled = !!enabled;
    this.debug.group.visible = this.debugEnabled;
  }

  toggleDebug() {
    this.setDebug(!this.debugEnabled);
    return this.debugEnabled;
  }

  updateDebug() {
    if (!this.debugEnabled) return;
    this.setupDebug();
    const d = this.debug;
    const points = this.supportHull.map((p) => new THREE.Vector3(p.x, p.y + 0.025, p.z));
    d.support.geometry.dispose();
    d.support.geometry = new THREE.BufferGeometry().setFromPoints(points.length >= 2 ? points : [this.supportCenter, this.supportCenter.clone().add(new THREE.Vector3(0.001, 0, 0))]);
    d.com.position.copy(this.com);
    d.projection.position.copy(this.projectedCom).add(new THREE.Vector3(0, 0.025, 0));
    d.capture.position.copy(this.capture).add(new THREE.Vector3(0, 0.035, 0));
    if (this.stepTarget) d.target.position.copy(this.stepTarget).add(new THREE.Vector3(0, 0.035, 0));
    else d.target.position.copy(this.supportCenter).add(new THREE.Vector3(0, -5, 0));
  }

  snapshot() {
    return {
      state: this.state,
      stateAge: this.stateAge,
      risk: this.risk,
      supportCenter: { x: this.supportCenter.x, y: this.supportCenter.y, z: this.supportCenter.z },
      supportPolygon: this.supportHull.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      com: { x: this.com.x, y: this.com.y, z: this.com.z },
      projectedCom: { x: this.projectedCom.x, y: this.projectedCom.y, z: this.projectedCom.z },
      predictedCom: { x: this.capture.x, y: this.capture.y, z: this.capture.z },
      velocity: { x: this.comVelocity.x, y: this.comVelocity.y, z: this.comVelocity.z },
      recoveryFoot: this.recoveryFoot,
      stepTarget: this.stepTarget && { x: this.stepTarget.x, y: this.stepTarget.y, z: this.stepTarget.z },
      muscleScale: this.muscleScale(),
      detail: this.last,
    };
  }
}
