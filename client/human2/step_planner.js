import * as THREE from "three";

const clamp = THREE.MathUtils.clamp;
const v = (p) => new THREE.Vector3(p.x, p.y, p.z);
const smooth = (x) => {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
};

export class StepPlanner {
  constructor(human) {
    this.h = human;
    this.sequence = 0;
    this.reset();
  }

  reset() {
    this.h.step = {
      phase: "idle",
      side: "L",
      time: 0,
      cooldown: 0.22,
      from: new THREE.Vector3(),
      target: new THREE.Vector3(),
      urgency: 0,
      swingDuration: 0.3,
      liftDuration: 0.09,
      plantDuration: 0.15,
    };
  }

  request(target, requestedSide = null, urgency = 0.5) {
    const h = this.h;
    const st = h.step;
    if (st.phase !== "idle" || st.cooldown > 0) return false;

    let side = requestedSide || this.chooseAlternatingSide();
    let other = side === "L" ? "R" : "L";
    const otherCapacity = h.legCapacity?.(other) ?? (1 - (h.injury?.[other] ?? 0));
    const sideCapacity = h.legCapacity?.(side) ?? (1 - (h.injury?.[side] ?? 0));
    if ((h.feet?.[other]?.quality ?? 0) < 0.2 || otherCapacity < 0.24) {
      if ((h.feet?.[side]?.quality ?? 0) < 0.2 || sideCapacity < 0.24) return false;
      side = other;
      other = side === "L" ? "R" : "L";
    }

    const from = v(h.body("foot" + side).translation());
    const pelvis = v(h.body("pelvis").translation());
    const goal = target.clone();
    const reach = goal.clone().sub(pelvis).setY(0);
    reach.clampLength(0.08, urgency > 0.78 ? 0.55 : 0.48);
    goal.x = pelvis.x + reach.x;
    goal.z = pelvis.z + reach.z;
    const distance = from.clone().setY(0).distanceTo(goal.clone().setY(0));
    const maxSwingSpeed = THREE.MathUtils.lerp(0.95, 1.55, clamp(urgency, 0, 1));
    const swingDuration = clamp(distance / Math.max(0.45, maxSwingSpeed), 0.22, 0.48);
    const liftDuration = clamp(0.11 - urgency * 0.025, 0.075, 0.11);
    const plantDuration = clamp(0.18 - urgency * 0.045, 0.12, 0.18);

    st.phase = "unload";
    st.side = side;
    st.time = 0;
    st.cooldown = 0;
    st.from.copy(from);
    st.target.copy(goal);
    st.urgency = clamp(urgency, 0, 1);
    st.swingDuration = swingDuration;
    st.liftDuration = liftDuration;
    st.plantDuration = plantDuration;
    h.lastStepSide = side;
    h.metrics.steps++;
    this.sequence++;
    return true;
  }

  chooseAlternatingSide() {
    return this.h.lastStepSide === "L" ? "R" : "L";
  }

  update(dt) {
    const h = this.h;
    const st = h.step;
    st.cooldown = Math.max(-0.2, st.cooldown - dt);
    if (st.phase === "idle") return;
    st.time += dt;

    if (st.phase === "unload" && st.time >= st.liftDuration) {
      st.phase = "swing";
      st.time = 0;
    } else if (st.phase === "swing" && st.time >= st.swingDuration) {
      st.phase = "plant";
      st.time = 0;
    } else if (st.phase === "plant") {
      const contact = h.feet?.[st.side]?.quality ?? 0;
      if ((st.time > 0.055 && contact > 0.42) || st.time >= st.plantDuration) {
        if (contact > 0.35) h.metrics.plants++;
        h.feet[st.side].anchor.copy(v(h.body("foot" + st.side).translation()));
        st.phase = "settle";
        st.time = 0;
      }
    } else if (st.phase === "settle" && st.time >= 0.07) {
      st.phase = "idle";
      st.time = 0;
      st.cooldown = st.urgency > 0.72 ? 0.055 : 0.12;
    }
  }

  targetFor(side) {
    const st = this.h.step;
    if (st.phase === "idle" || st.side !== side) return this.h.feet[side].anchor.clone();
    const target = new THREE.Vector3();
    let progress = 0;
    if (st.phase === "unload") progress = 0;
    else if (st.phase === "swing") progress = smooth(st.time / st.swingDuration);
    else progress = 1;
    target.lerpVectors(st.from, st.target, progress);

    const distance = st.from.clone().setY(0).distanceTo(st.target.clone().setY(0));
    const liftHeight = clamp(0.065 + distance * 0.1 + st.urgency * 0.025, 0.065, 0.125);
    let lift = 0;
    if (st.phase === "unload") lift = liftHeight * smooth(st.time / st.liftDuration);
    else if (st.phase === "swing") lift = liftHeight * (0.82 + 0.18 * (1 - Math.abs(progress * 2 - 1)));
    else if (st.phase === "plant") lift = liftHeight * (1 - smooth(st.time / st.plantDuration));
    target.y += lift;
    return target;
  }

  applySwingGuide(dt) {
    const h = this.h;
    const st = h.step;
    if (st.phase === "idle" || st.phase === "settle") return;
    const foot = h.body("foot" + st.side);
    const pelvis = h.body("pelvis");
    const target = this.targetFor(st.side);
    const pos = v(foot.translation());
    const relativeVelocity = v(foot.linvel()).sub(v(pelvis.linvel()));
    const error = target.sub(pos);
    const force = error.multiplyScalar(155 + st.urgency * 55).addScaledVector(relativeVelocity, -17);
    const capacity = h.legCapacity?.(st.side) ?? 1;
    h.forcePair(foot, pelvis, force, (82 + st.urgency * 28) * Math.max(0.25, capacity), dt);

    const maxSpeed = 1.25 + st.urgency * 0.55;
    const speed = relativeVelocity.length();
    if (speed > maxSpeed) {
      const brake = relativeVelocity.normalize().multiplyScalar(-(speed - maxSpeed) * 64);
      h.forcePair(foot, pelvis, brake, 92, dt);
    }
  }
}
