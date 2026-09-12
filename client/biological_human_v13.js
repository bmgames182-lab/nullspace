import * as THREE from "three";
import { BiologicalArtagdollHumanV12 } from "./biological_human_v12.js";
import { EuphoriaBalanceController } from "./euphoria_balance_controller.js";

const clamp = THREE.MathUtils.clamp;
const v = (p) => new THREE.Vector3(p.x, p.y, p.z);

// V13 keeps the mature physiology + localized reaction stack from V12, but
// changes the way the living body tries to remain upright. The old controller
// is now the low-level pose/joint layer; this whole-body controller supplies
// support-polygon balance, compliant ankle/hip strategy, finite-speed capture
// steps, anti-slide foot control, torso lag/counter-rotation and arm momentum.
export class BiologicalArtagdollHumanV13 extends BiologicalArtagdollHumanV12 {
  constructor(world, scene, x = 0, z = 0) {
    super(world, scene, x, z);
    this.controllerStyle = "artagdoll-biological-v13-whole-body-active-balance";
    this.balance2 = new EuphoriaBalanceController(this);
    this._bodyNames = new Map([...this.parts].map(([name, part]) => [part.rb, name]));
    this._balanceOverlayApplying = false;
    this._debugKey = null;
    this._debugPanel = null;
    this.installDebugMode();
  }

  installDebugMode() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const panel = document.createElement("div");
    panel.style.cssText = [
      "position:fixed", "left:12px", "bottom:12px", "z-index:40", "display:none",
      "padding:9px 11px", "background:rgba(0,0,0,.72)", "color:#d9f7ff",
      "font:12px/1.35 monospace", "white-space:pre", "pointer-events:none",
      "border:1px solid rgba(180,235,255,.25)", "border-radius:6px",
    ].join(";");
    document.body.appendChild(panel);
    this._debugPanel = panel;
    this._debugKey = (event) => {
      if (event.code !== "F3") return;
      event.preventDefault();
      this.setDebug(!this.balance2.debugEnabled);
    };
    window.addEventListener("keydown", this._debugKey);
  }

  setDebug(enabled) {
    this.balance2?.setDebug(enabled);
    if (this._debugPanel) this._debugPanel.style.display = enabled ? "block" : "none";
    return !!enabled;
  }

  toggleDebug() {
    return this.setDebug(!this.balance2?.debugEnabled);
  }

  updateDebugPanel() {
    if (!this._debugPanel || !this.balance2?.debugEnabled) return;
    const b = this.balance2.snapshot();
    const pv = this.body("pelvis").linvel();
    const step = this.step.phase === "idle" ? "none" : `${this.step.side}:${this.step.phase}`;
    this._debugPanel.textContent =
      `ACTIVE RAGDOLL V13  [F3]\n` +
      `balance: ${b.state}  risk:${b.risk.toFixed(2)}  drive:${b.muscleScale.toFixed(2)}\n` +
      `COM: ${b.com.x.toFixed(2)},${b.com.y.toFixed(2)},${b.com.z.toFixed(2)}\n` +
      `pred: ${b.predictedCom.x.toFixed(2)},${b.predictedCom.z.toFixed(2)}  support:${b.supportPolygon.length}pts\n` +
      `pelvis v: ${pv.x.toFixed(2)},${pv.y.toFixed(2)},${pv.z.toFixed(2)}\n` +
      `recovery foot: ${b.recoveryFoot ?? "-"}  step:${step}`;
  }

  // The legacy root controller was intentionally very strong. V13 leaves its
  // vertical support intact, but softens always-on horizontal correction. The
  // new risk-aware controller then adds force only when the COM actually needs
  // it, producing displacement -> wobble -> correction rather than statue-like
  // rejection of every shove.
  forcePair(a, b, force, cap, dt) {
    let f = force;
    let c = cap;
    if (this._bodyNames && !this._balanceOverlayApplying) {
      const an = this._bodyNames.get(a);
      const bn = this._bodyNames.get(b);
      const pelvisFoot =
        (an === "pelvis" && bn?.startsWith("foot")) ||
        (bn === "pelvis" && an?.startsWith("foot"));
      if (pelvisFoot) {
        f = force.clone();
        f.x *= 0.74;
        f.z *= 0.74;
        c *= 0.9;
      }
    }
    return super.forcePair(a, b, f, c, dt);
  }

  torquePair(parent, child, torque, cap, dt, active = true) {
    let t = torque;
    let c = cap;
    if (this._bodyNames && !this._balanceOverlayApplying) {
      const pn = this._bodyNames.get(parent);
      const cn = this._bodyNames.get(child);
      if (pn?.startsWith("foot") && cn === "pelvis") {
        t = torque.clone().multiplyScalar(0.7);
        c *= 0.72;
      }
    }
    return super.torquePair(parent, child, t, c, dt, active);
  }

  // PD motors remain compliant when a limb is already rotating quickly. This
  // is a physical speed governor, not an animation clamp: it lowers available
  // corrective torque rather than teleporting orientation or velocity.
  cohere(parent, child, target, gain, damping, cap, activity, dt) {
    const relativeSpeed = v(child.angvel()).sub(v(parent.angvel())).length();
    const governor = relativeSpeed <= 5.2
      ? 1
      : clamp(1 - (relativeSpeed - 5.2) / 7.5, 0.34, 1);
    return super.cohere(
      parent,
      child,
      target,
      gain * (0.88 + governor * 0.12),
      damping * (1 + (1 - governor) * 0.55),
      cap * governor,
      activity,
      dt,
    );
  }

  controlDrive() {
    const base = super.controlDrive();
    const balanceScale = this.balance2?.muscleScale?.() ?? 1;
    return clamp(base * balanceScale, 0, 1);
  }

  // Preserve a real recovery attempt before entering a floor state. True CNS
  // failure, death and V12's deliberate final passive handoff still bypass this.
  setState(next) {
    if (
      this.balance2 &&
      ["brace", "collapse", "down"].includes(next) &&
      !this.dead &&
      !this.passiveHandoff &&
      !this.physiology?.unconscious
    ) {
      const pelvisY = this.body("pelvis")?.translation().y ?? 0;
      const chestY = this.body("chest")?.translation().y ?? 0;
      if (pelvisY > 0.58 && chestY > 0.86 && this.balance2.risk < 0.92) {
        next = this.balance2.risk > 0.52 ? "scramble" : "react";
      }
    }
    return super.setState(next);
  }

  // Re-target all recovery steps from the real capture direction. We preserve
  // the base phase machine/joint IK but avoid double stance offsets and limit
  // reach so the leg never snaps metres across the body.
  startScrambleStep(capture, requestedSide = null) {
    const desired = capture.clone();
    const ok = super.startScrambleStep(capture, requestedSide);
    if (!ok) return false;
    const side = this.step.side;
    const pelvis = v(this.body("pelvis").translation());
    const sign = side === "L" ? -1 : 1;
    const local = desired.clone().sub(pelvis);
    local.y = 0;
    local.clampLength(0.1, this.balance2?.state === "critical" ? 0.54 : 0.47);
    desired.x = pelvis.x + local.x;
    desired.z = pelvis.z + local.z;
    const alreadyHasStance = sign * (desired.x - pelvis.x) > 0.075;
    if (!alreadyHasStance) desired.x += sign * 0.105;
    this.step.target.x = desired.x;
    this.step.target.z = desired.z;
    if (Number.isFinite(desired.y)) this.step.target.y = desired.y;
    return true;
  }

  update(dt) {
    super.update(dt);
    if (!this.balance2 || this.dead) return;

    this._balanceOverlayApplying = true;
    try {
      this.balance2.update(dt);
    } finally {
      this._balanceOverlayApplying = false;
    }

    // Once the capture point has remained safely inside the support polygon for
    // a sustained window, finish recovery cleanly instead of snapping upright.
    if (
      this.balance2.stableAge > 0.65 &&
      !this.physiology?.unconscious &&
      !this.passiveHandoff &&
      this.step.phase === "idle" &&
      ["react", "scramble", "stumble"].includes(this.state) &&
      (this.hitReaction?.phase === "idle" || this.hitReaction?.phase === "recover")
    ) {
      super.setState("balance");
    }
  }

  sync() {
    super.sync();
    this.updateDebugPanel();
  }

  balanceSnapshot() {
    return this.balance2?.snapshot?.() ?? null;
  }

  behaviorSnapshot() {
    return {
      ...super.behaviorSnapshot?.(),
      wholeBodyBalance: this.balanceSnapshot(),
    };
  }

  destroy() {
    if (this._debugKey && typeof window !== "undefined") window.removeEventListener("keydown", this._debugKey);
    this._debugPanel?.remove?.();
    if (this.balance2?.debug?.group) this.scene.remove(this.balance2.debug.group);
    super.destroy();
  }
}
