import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

const clamp = THREE.MathUtils.clamp;
const UP = new THREE.Vector3(0, 1, 0);
const v = (p) => new THREE.Vector3(p.x, p.y, p.z);
const q = (r) => new THREE.Quaternion(r.x, r.y, r.z, r.w);
const ORDER = ["stable", "disturbed", "recovering", "stumbling", "critical", "falling"];
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

function cross2(a, b, c) { return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x); }
function hullXZ(points) {
  if (points.length <= 2) return points.map((p) => p.clone());
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z), lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross2(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross2(hi.at(-2), hi.at(-1), p) <= 0) hi.pop(); hi.push(p); }
  lo.pop(); hi.pop(); return lo.concat(hi);
}
function segDist(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, d = dx * dx + dz * dz;
  const t = d > 1e-9 ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / d, 0, 1) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}
function signedDistance(p, hull) {
  if (!hull.length) return Infinity;
  if (hull.length === 1) return Math.hypot(p.x - hull[0].x, p.z - hull[0].z);
  if (hull.length === 2) return segDist(p, hull[0], hull[1]);
  let inside = true, d = Infinity;
  for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; if (cross2(a, b, p) < -1e-5) inside = false; d = Math.min(d, segDist(p, a, b)); }
  return inside ? -d : d;
}

export class BalanceController {
  constructor(human) {
    this.h = human;
    this.state = this.candidate = "stable";
    this.stateAge = this.candidateAge = this.stableAge = this.fallAge = 0;
    this.risk = this.geometricRisk = this.disturbanceRisk = 0;
    this.disturbanceDirection = new THREE.Vector3(0, 0, 1);
    this.supportHull = [];
    this.supportCenter = new THREE.Vector3();
    this.com = new THREE.Vector3();
    this.comVelocity = new THREE.Vector3();
    this.capture = new THREE.Vector3();
    this.projectedCom = new THREE.Vector3();
    this.escape = new THREE.Vector3(0, 0, 1);
    this.outside = Infinity; this.speed = this.lean = this.angular = 0;
    this.recoveryFoot = null; this.stepTarget = null;
    this._prevChest = v(human.body("chest").linvel());
    this._prevPelvis = v(human.body("pelvis").linvel());
    this._prevCom = human.centreOfMass().velocity.clone();
    this._velocityReady = false;
    this._selfMotionQuiet = 0;
    this.debugEnabled = false; this.debug = null;
  }

  footCorners(side) {
    const rb = this.h.body("foot" + side), quality = this.h.feet?.[side]?.quality ?? 0;
    if (!rb || quality < 0.08) return [];
    const pos = v(rb.translation()), rot = q(rb.rotation()), out = [];
    for (const x of [-0.09, 0.09]) for (const z of [-0.16, 0.16]) out.push(new THREE.Vector3(x, -0.043, z).applyQuaternion(rot).add(pos));
    return out;
  }

  registerDisturbance(direction, amount) {
    const d = v(direction).setY(0);
    if (d.lengthSq() > 1e-8) this.disturbanceDirection.copy(d.normalize());
    this.disturbanceRisk = Math.max(this.disturbanceRisk, clamp(amount, 0, 1.15));
  }

  // Reference footage shows a short neuromuscular delay: the struck segment
  // yields first while the stance continues carrying body weight. Keep vertical
  // support immediately, then ramp gross horizontal/rotational authority in
  // after the local response has had roughly 100 ms to develop.
  reactionAuthority() {
    const age = this.h.hitAge ?? 99;
    if (age >= 0.12) return 1;
    return smooth((age - 0.045) / 0.075);
  }

  updateFootAnchors() {
    for (const side of ["L", "R"]) {
      const foot = this.h.body("foot" + side), quality = this.h.footQuality(foot), data = this.h.feet[side];
      if (quality > 0.38 && data.quality <= 0.38) data.anchor.copy(v(foot.translation()));
      data.quality = quality;
    }
  }

  detectDisturbance(dt) {
    const chest = v(this.h.body("chest").linvel()), pelvis = v(this.h.body("pelvis").linvel()), com = this.h.centreOfMass().velocity;
    const stepActive = !!this.h.step && this.h.step.phase !== "idle";
    if (stepActive) this._selfMotionQuiet = 0.2;
    else this._selfMotionQuiet = Math.max(0, this._selfMotionQuiet - dt);
    const shielded = stepActive || this._selfMotionQuiet > 0;

    if (this._velocityReady && this.h.age > 0.8) {
      const cd = chest.clone().sub(this._prevChest).setY(0), pd = pelvis.clone().sub(this._prevPelvis).setY(0), md = com.clone().sub(this._prevCom).setY(0);
      // Active recovery generates large but expected segment accelerations. Treat
      // those as self-motion for a short window around each step so the observer
      // cannot recursively classify its own correction as a fresh shove. A truly
      // large new impulse can still punch through the shield.
      const rawKick = Math.max(
        clamp((cd.length() - 0.1) / 0.55, 0, 1.05) * 0.7,
        clamp((pd.length() - 0.075) / 0.46, 0, 1.05) * 0.68,
        clamp((md.length() - 0.038) / 0.23, 0, 1.05) * 0.9,
      );
      const kick = shielded ? clamp((rawKick - 0.7) / 0.3, 0, 1) * 0.78 : rawKick;
      if (kick > 0.045) {
        this.disturbanceRisk = Math.max(this.disturbanceRisk, kick);
        const d = md.lengthSq() > 1e-5 ? md : cd.lengthSq() > pd.lengthSq() ? cd : pd;
        if (d.lengthSq() > 1e-6) this.disturbanceDirection.copy(d.normalize());
      }
    }
    this._prevChest.copy(chest); this._prevPelvis.copy(pelvis); this._prevCom.copy(com); this._velocityReady = true;
    this.disturbanceRisk *= Math.exp(-dt * (shielded ? 3.4 : 2.8));
  }

  sample(dt) {
    this.detectDisturbance(dt);
    const pelvis = this.h.body("pelvis"), chest = this.h.body("chest"), com = this.h.centreOfMass();
    this.com.copy(com.position); this.comVelocity.copy(com.velocity);
    this.supportHull = hullXZ([...this.footCorners("L"), ...this.footCorners("R")]);
    this.supportCenter.set(0, 0, 0);
    if (this.supportHull.length) { for (const p of this.supportHull) this.supportCenter.add(p); this.supportCenter.multiplyScalar(1 / this.supportHull.length); }
    else this.supportCenter.copy(v(pelvis.translation())).setY(0);
    const groundY = this.supportHull.length ? this.supportHull.reduce((s, p) => s + p.y, 0) / this.supportHull.length : 0;
    this.supportCenter.y = groundY; this.projectedCom.copy(this.com).setY(groundY);
    const height = Math.max(0.24, this.com.y - groundY), tau = clamp(Math.sqrt(height / 9.81), 0.16, 0.38);
    const pa = v(pelvis.angvel()), ca = v(chest.angvel());
    const angularLead = new THREE.Vector3((pa.z * 0.68 + ca.z * 0.32) * height * 0.046, 0, -(pa.x * 0.68 + ca.x * 0.32) * height * 0.046);
    this.capture.copy(this.com).addScaledVector(this.comVelocity, tau).add(angularLead).setY(groundY);
    if (this.disturbanceRisk > 0.17) this.capture.addScaledVector(this.disturbanceDirection, 0.045 + this.disturbanceRisk * 0.17);
    this.outside = signedDistance(this.capture, this.supportHull);
    this.escape.copy(this.capture).sub(this.supportCenter).setY(0);
    if (this.escape.lengthSq() < 1e-7) this.escape.copy(this.disturbanceDirection);
    if (this.escape.lengthSq() < 1e-7) this.escape.set(0, 0, 1); else this.escape.normalize();
    const pu = UP.clone().applyQuaternion(q(pelvis.rotation())), cu = UP.clone().applyQuaternion(q(chest.rotation()));
    this.lean = Math.max(0, 1 - pu.y, 1 - cu.y); this.speed = Math.hypot(this.comVelocity.x, this.comVelocity.z); this.angular = Math.hypot(pa.x, pa.z, ca.x, ca.z);
    const outsideRisk = !this.supportHull.length ? 1 : clamp((this.outside + 0.018) / 0.27, 0, 1.2);
    this.geometricRisk = clamp(outsideRisk * 0.54 + clamp((this.speed - 0.08) / 1.9, 0, 1) * 0.2 + clamp((this.lean - 0.015) / 0.54, 0, 1) * 0.17 + clamp((this.angular - 0.18) / 6.5, 0, 1) * 0.09, 0, 1.2);
    this.risk = Math.max(this.geometricRisk, this.disturbanceRisk);
  }

  desiredState() {
    const h = this.h;
    if (h.dead || h.physiology?.unconscious || h.passiveHandoff) return "passive";
    const py = h.body("pelvis").translation().y, cy = h.body("chest").translation().y;
    if (h.contact("pelvis") || h.contact("abdomen") || h.contact("chest") || (py < 0.39 && cy < 0.72)) return "downed";
    if (this.risk < 0.15) return "stable"; if (this.risk < 0.31) return "disturbed"; if (this.risk < 0.52) return "recovering"; if (this.risk < 0.75) return "stumbling"; if (this.risk < 0.98) return "critical"; return "falling";
  }

  classify(dt) {
    const desired = this.desiredState();
    if (desired === this.state) { this.stateAge += dt; this.candidate = desired; this.candidateAge = 0; }
    else if (desired === "passive" || desired === "downed") { this.state = desired; this.stateAge = 0; this.candidate = desired; this.candidateAge = 0; }
    else {
      const escalating = ORDER.indexOf(desired) > ORDER.indexOf(this.state);
      if (escalating) { this.state = desired; this.stateAge = 0; this.candidate = desired; this.candidateAge = 0; }
      else { if (this.candidate !== desired) { this.candidate = desired; this.candidateAge = 0; } else this.candidateAge += dt; const hold = this.state === "falling" ? 0.18 : this.state === "critical" ? 0.14 : 0.11; if (this.candidateAge >= hold) { this.state = desired; this.stateAge = this.candidateAge = 0; } }
    }
    this.stableAge = this.state === "stable" ? this.stableAge + dt : 0;
    this.fallAge = this.state === "falling" ? this.fallAge + dt : Math.max(0, this.fallAge - dt * 1.6);
  }

  chooseStep() {
    const h = this.h, pelvis = v(h.body("pelvis").translation()), candidates = [];
    for (const side of ["L", "R"]) { const other = side === "L" ? "R" : "L", foot = v(h.body("foot" + side).translation()); const score = (h.feet[other].quality * h.legCapacity(other)) * 0.78 + h.legCapacity(side) * 0.18 + foot.clone().setY(0).distanceTo(this.capture.clone().setY(0)) * 0.62 + this.escape.x * (side === "L" ? -1 : 1) * 0.16 - (side === h.lastStepSide ? 0.04 : 0); candidates.push({ side, score }); }
    candidates.sort((a, b) => b.score - a.score);
    let side = candidates[0].side, other = side === "L" ? "R" : "L";
    if (h.feet[other].quality < 0.18 || h.legCapacity(other) < 0.22) { side = other; other = side === "L" ? "R" : "L"; }
    if (h.feet[other].quality < 0.14 || h.legCapacity(other) < 0.15) return null;
    const outside = Math.max(0, Number.isFinite(this.outside) ? this.outside : 0.22), distance = clamp(0.105 + outside * 1.05 + this.speed * 0.15 + this.angular * 0.012, 0.105, 0.54);
    const lateral = new THREE.Vector3(-this.escape.z, 0, this.escape.x), sign = side === "L" ? -1 : 1;
    const target = pelvis.clone().addScaledVector(this.escape, distance).addScaledVector(lateral, sign * (0.11 + Math.min(0.055, distance * 0.11)));
    if (Math.abs(this.escape.x) > 0.68 && this.risk > 0.58) { target.x += this.escape.x * 0.065; target.z += sign * 0.012; }
    const hit = h.world.castRay(new RAPIER.Ray({ x: target.x, y: pelvis.y + 0.32, z: target.z }, { x: 0, y: -1, z: 0 }), 1.9, true, undefined, 0x00010001);
    if (!hit) return null;
    target.y = pelvis.y + 0.32 - hit.timeOfImpact + 0.055;
    return { side, target, urgency: clamp((this.risk - 0.25) / 0.72, 0.2, 1) };
  }

  maybeRequestStep() {
    const h = this.h;
    if (h.hitAge < 0.095) return false;
    const normalStepState = ["recovering", "stumbling", "critical"].includes(this.state);
    const outside = Math.max(0, Number.isFinite(this.outside) ? this.outside : 0);
    const disturbedNeedsStep = this.state === "disturbed" && (
      outside > 0.012 ||
      (this.speed > 0.22 && this.disturbanceRisk > 0.12)
    );
    if (!(normalStepState || disturbedNeedsStep) || h.step.phase !== "idle" || h.step.cooldown > 0 || h.body("pelvis").translation().y < 0.59) return false;
    const demand = Math.max(outside * 3, (this.risk - 0.18) * 0.9, this.speed * 0.32, this.disturbanceRisk * 0.65);
    if (demand < 0.12) return false;
    const choice = this.chooseStep(); if (!choice) return false;
    this.recoveryFoot = choice.side; this.stepTarget = choice.target.clone();
    return h.startRecoveryStep(choice.target, choice.side, choice.urgency);
  }

  applySupport(dt) {
    const h = this.h; if (["passive", "downed"].includes(this.state)) return;
    const grossAuthority = 0.1 + 0.9 * this.reactionAuthority();
    const pelvis = h.body("pelvis"), pp = v(pelvis.translation()), pv = v(pelvis.linvel()), swing = h.step.phase !== "idle" ? h.step.side : null, drive = h.controlDrive(), supports = [];
    for (const side of ["L", "R"]) {
      const foot = h.body("foot" + side), data = h.feet[side]; if (side === swing || data.quality < 0.14) continue;
      const capacity = h.legCapacity(side); if (capacity < 0.08) continue; supports.push({ side, foot, data, capacity });
      const pos = v(foot.translation()), rel = v(foot.linvel()).sub(v(pelvis.linvel())), err = data.anchor.clone().sub(pos).setY(0), release = smooth((this.risk - 0.46) / 0.34);
      const traction = err.multiplyScalar(240 * (1 - release)).addScaledVector(new THREE.Vector3(rel.x, 0, rel.z), -32 * (1 - release)).multiplyScalar(grossAuthority);
      h.forcePair(foot, pelvis, traction, (92 * capacity * (1 - release) + 9) * grossAuthority, dt);
      if (err.length() > 0.11 || release > 0.82) data.anchor.lerp(pos, clamp(dt * 7, 0, 1));
    }
    const total = supports.reduce((s, x) => s + x.data.quality * x.capacity, 0);
    for (const s of supports) {
      if (total <= 1e-5) continue;
      const share = s.data.quality * s.capacity / total, targetHeight = 0.97 - clamp(this.risk, 0, 1) * 0.105, hf = clamp((targetHeight - pp.y) * 900 - pv.y * 140, -130, 580);
      // Enough ground reaction to stand as an inverted pendulum, but not enough
      // to erase the displacement that should precede a capture step.
      const horizontalX = clamp((this.supportCenter.x - this.com.x) * 720 - this.comVelocity.x * 140, -200, 200) * grossAuthority * share;
      const horizontalZ = clamp((this.supportCenter.z - this.com.z) * 720 - this.comVelocity.z * 140, -200, 200) * grossAuthority * share;
      const vertical = Math.max(0, (h.mass * 9.81 + hf) * share);
      const force = new THREE.Vector3(horizontalX, vertical, horizontalZ).multiplyScalar(drive);
      h.forcePair(pelvis, s.foot, force, 900, dt);
    }
    if (supports.length) {
      const corr = UP.clone().applyQuaternion(q(pelvis.rotation())).cross(UP).multiplyScalar(360 + this.risk * 95).addScaledVector(v(pelvis.angvel()), -(50 + this.risk * 20)).multiplyScalar(grossAuthority);
      for (const s of supports) h.torquePair(s.foot, pelvis, corr.clone().multiplyScalar(drive / supports.length), (160 + this.risk * 38) * grossAuthority, dt);
    }
  }

  pose(targets) {
    const h = this.h; if (["passive", "downed"].includes(this.state)) return;
    const authority = this.reactionAuthority();
    const inv = q(h.body("pelvis").rotation()).invert(), local = this.escape.clone().applyQuaternion(inv), risk = clamp(this.risk, 0, 1) * authority, knee = clamp(risk * 0.28 + Math.max(0, this.speed - 0.45) * 0.055 * authority, 0, 0.4);
    targets.abdomen.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(clamp(local.z * (0.035 + risk * 0.16) * authority, -0.2, 0.2), clamp(-h.body("pelvis").angvel().y * 0.026 * authority, -0.14, 0.14), clamp(-local.x * (0.035 + risk * 0.13) * authority, -0.17, 0.17))));
    targets.chest.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(clamp(-local.z * (0.035 + risk * 0.14) * authority, -0.18, 0.18), clamp(h.body("pelvis").angvel().y * 0.04 * authority, -0.18, 0.18), clamp(local.x * (0.035 + risk * 0.11) * authority, -0.15, 0.15))));
    targets.head.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(clamp(local.z * risk * 0.05, -0.08, 0.08), 0, clamp(-local.x * risk * 0.06, -0.1, 0.1))));
    for (const side of ["L", "R"]) { const sign = side === "L" ? -1 : 1; if (h.step.side !== side && h.feet[side].quality > 0.15) targets["shin" + side].multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(knee, 0, 0))); const independent = (side === "L" ? -0.028 : 0.036) * risk + Math.sin(h.age * (side === "L" ? 2.1 : 2.35) + sign) * 0.018 * risk; targets["upperArm" + side].multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(clamp((-local.z * (0.13 + risk * 0.3) - 0.045 * risk) * authority, -0.58, 0.32), clamp(sign * h.body("chest").angvel().y * -0.032 * authority, -0.17, 0.17), (sign * (0.09 + risk * 0.31) + independent - local.x * 0.17) * authority))); }
  }

  muscleScale() { if (this.state === "passive") return 0.02; if (this.state === "downed") return 0.46; if (this.state === "falling") return clamp(0.92 - this.fallAge * 0.28, 0.38, 0.92); return 1; }
  update(dt) { this.updateFootAnchors(); this.sample(dt); this.classify(dt); this.maybeRequestStep(); this.applySupport(dt); this.updateDebug(); }

  setupDebug() {
    if (this.debug) return;
    const group = new THREE.Group(); group.visible = false;
    const support = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    const point = (r) => new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial());
    const com = point(0.045), projection = point(0.035), capture = point(0.038), target = point(0.04); group.add(support, com, projection, capture, target); this.h.scene.add(group); this.debug = { group, support, com, projection, capture, target };
  }
  setDebug(enabled) { this.setupDebug(); this.debugEnabled = !!enabled; this.debug.group.visible = this.debugEnabled; }
  toggleDebug() { this.setDebug(!this.debugEnabled); return this.debugEnabled; }
  updateDebug() {
    if (!this.debugEnabled) return; this.setupDebug(); const d = this.debug, points = this.supportHull.map((p) => new THREE.Vector3(p.x, p.y + 0.025, p.z));
    d.support.geometry.dispose(); d.support.geometry = new THREE.BufferGeometry().setFromPoints(points.length >= 2 ? points : [this.supportCenter, this.supportCenter.clone().add(new THREE.Vector3(0.001, 0, 0))]); d.com.position.copy(this.com); d.projection.position.copy(this.projectedCom).add(new THREE.Vector3(0, 0.025, 0)); d.capture.position.copy(this.capture).add(new THREE.Vector3(0, 0.035, 0)); if (this.stepTarget) d.target.position.copy(this.stepTarget).add(new THREE.Vector3(0, 0.035, 0)); else d.target.position.copy(this.supportCenter).setY(-5);
  }
  snapshot() { return { state: this.state, stateAge: this.stateAge, risk: this.risk, geometricRisk: this.geometricRisk, disturbanceRisk: this.disturbanceRisk, reactionAuthority: this.reactionAuthority(), supportCenter: { x: this.supportCenter.x, y: this.supportCenter.y, z: this.supportCenter.z }, supportPolygon: this.supportHull.map((p) => ({ x: p.x, y: p.y, z: p.z })), com: { x: this.com.x, y: this.com.y, z: this.com.z }, projectedCom: { x: this.projectedCom.x, y: this.projectedCom.y, z: this.projectedCom.z }, predictedCom: { x: this.capture.x, y: this.capture.y, z: this.capture.z }, velocity: { x: this.comVelocity.x, y: this.comVelocity.y, z: this.comVelocity.z }, recoveryFoot: this.recoveryFoot, stepTarget: this.stepTarget && { x: this.stepTarget.x, y: this.stepTarget.y, z: this.stepTarget.z }, muscleScale: this.muscleScale(), outside: this.outside, speed: this.speed, lean: this.lean, angular: this.angular, selfMotionQuiet: this._selfMotionQuiet }; }
}