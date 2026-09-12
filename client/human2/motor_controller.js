import * as THREE from "three";

const clamp = THREE.MathUtils.clamp;
const v = (p) => new THREE.Vector3(p.x, p.y, p.z);
const q = (r) => new THREE.Quaternion(r.x, r.y, r.z, r.w);

function signedTwistAngle(twist, axis) {
  const s = new THREE.Vector3(twist.x, twist.y, twist.z).dot(axis);
  let angle = 2 * Math.atan2(s, twist.w);
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function swingTwist(relative, axis) {
  const a = axis.clone().normalize();
  const rv = new THREE.Vector3(relative.x, relative.y, relative.z);
  const projection = a.clone().multiplyScalar(rv.dot(a));
  let twist = new THREE.Quaternion(projection.x, projection.y, projection.z, relative.w);
  if (twist.lengthSq() < 1e-10) twist = new THREE.Quaternion();
  else twist.normalize();
  const swing = relative.clone().multiply(twist.clone().invert()).normalize();
  return { swing, twist, axis: a };
}

function axisAngle(qr) {
  const qq = qr.clone().normalize();
  if (qq.w < 0) qq.set(-qq.x, -qq.y, -qq.z, -qq.w);
  const sinHalf = Math.hypot(qq.x, qq.y, qq.z);
  if (sinHalf < 1e-8) return { axis: new THREE.Vector3(1, 0, 0), angle: 0 };
  return {
    axis: new THREE.Vector3(qq.x, qq.y, qq.z).multiplyScalar(1 / sinHalf),
    angle: 2 * Math.atan2(sinHalf, clamp(qq.w, -1, 1)),
  };
}

export class MotorController {
  constructor(human) {
    this.h = human;
    this.maxObservedRelativeAngularSpeed = 0;
  }

  drive(parent, child, target, profile, strength, dt) {
    if (!parent || !child || strength <= 0.001) return;
    const relativeSpeed = v(child.angvel()).sub(v(parent.angvel())).length();
    this.maxObservedRelativeAngularSpeed = Math.max(this.maxObservedRelativeAngularSpeed, relativeSpeed);
    const governor = relativeSpeed <= profile.softSpeed
      ? 1
      : clamp(1 - (relativeSpeed - profile.softSpeed) / Math.max(1, profile.hardSpeed - profile.softSpeed), 0.18, 1);
    const kp = profile.kp * (0.72 + governor * 0.28);
    const kd = profile.kd * (1 + (1 - governor) * 0.8);
    const maxTorque = profile.maxTorque * governor;
    this.h.cohere(parent, child, target, kp, kd, maxTorque, strength, dt);
  }

  applySwingTwistLimit(parent, child, limit, dt) {
    if (!parent || !child) return;
    const parentQ = q(parent.rotation());
    const relative = parentQ.clone().invert().multiply(q(child.rotation())).normalize();
    const { swing, twist, axis } = swingTwist(relative, limit.axis || new THREE.Vector3(0, 1, 0));
    const swingAA = axisAngle(swing);
    const swingAngle = Math.min(swingAA.angle, Math.PI);
    const twistAngle = signedTwistAngle(twist, axis);
    const clampedSwing = new THREE.Quaternion().setFromAxisAngle(swingAA.axis, Math.min(swingAngle, limit.swingMax));
    const clampedTwist = new THREE.Quaternion().setFromAxisAngle(axis, clamp(twistAngle, limit.twistMin, limit.twistMax));
    const target = clampedSwing.multiply(clampedTwist).normalize();
    const swingError = Math.max(0, swingAngle - limit.swingMax);
    const twistError = Math.abs(twistAngle - clamp(twistAngle, limit.twistMin, limit.twistMax));
    if (swingError + twistError < 1e-4) return;
    this.h.cohere(parent, child, target, limit.kp ?? 48, limit.kd ?? 5.5, limit.maxTorque ?? 34, 1, dt);
  }
}

export const MOTOR_PROFILES = Object.freeze({
  spineLower: { kp: 58, kd: 7.5, maxTorque: 42, softSpeed: 4.3, hardSpeed: 9.2 },
  spineUpper: { kp: 52, kd: 7.0, maxTorque: 38, softSpeed: 4.5, hardSpeed: 9.5 },
  neck: { kp: 15, kd: 2.7, maxTorque: 12, softSpeed: 5.2, hardSpeed: 11.0 },
  hip: { kp: 62, kd: 7.2, maxTorque: 50, softSpeed: 5.0, hardSpeed: 10.2 },
  knee: { kp: 54, kd: 6.5, maxTorque: 44, softSpeed: 5.0, hardSpeed: 10.5 },
  ankle: { kp: 30, kd: 4.6, maxTorque: 24, softSpeed: 5.2, hardSpeed: 11.0 },
  shoulder: { kp: 21, kd: 3.5, maxTorque: 19, softSpeed: 6.0, hardSpeed: 12.0 },
  elbow: { kp: 15, kd: 2.6, maxTorque: 13, softSpeed: 6.4, hardSpeed: 13.0 },
  wrist: { kp: 7, kd: 1.3, maxTorque: 6, softSpeed: 7.0, hardSpeed: 14.0 },
});
