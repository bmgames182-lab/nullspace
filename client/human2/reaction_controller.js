import * as THREE from "three";
import { familyOf, sideOf } from "../physiology.js";

const clamp = THREE.MathUtils.clamp;
const v = (p) => new THREE.Vector3(p.x, p.y, p.z);
const q = (r) => new THREE.Quaternion(r.x, r.y, r.z, r.w);
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

function mul(targets, name, euler) { targets[name]?.multiply(new THREE.Quaternion().setFromEuler(euler)); }
function localPoint(body, point) { return v(point).sub(v(body.translation())).applyQuaternion(q(body.rotation()).invert()); }
function worldPoint(body, local) { return local.clone().applyQuaternion(q(body.rotation())).add(v(body.translation())); }

// Hits create local protective intent and temporary motor inhibition only.
// They never order a step or a fall; those emerge from balance and contacts.
export class ReactionController {
  constructor(human) { this.h = human; this.episodes = []; this.serial = 0; this.stress = 0; this.last = null; }

  onHit(part, direction, strength, point, event) {
    const body = this.h.body(part) || this.h.body("chest");
    const family = event?.family || familyOf(part), side = event?.side || sideOf(part);
    const dir = v(direction); if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1); dir.normalize();
    const hitPoint = v(point || body.translation());
    const severity = clamp(event?.severity ?? strength / 18, 0.08, 1.65), pain = clamp(event?.painSpike ?? severity * 0.55, 0, 1), startle = clamp(event?.startle ?? severity * 0.45, 0, 1);
    let guardSide = null;
    if (family === "torso" || family === "head") {
      const dl = v(this.h.body("handL").translation()).distanceTo(hitPoint), dr = v(this.h.body("handR").translation()).distanceTo(hitPoint);
      guardSide = dl <= dr ? "L" : "R";
    } else if (family === "arm" && side) guardSide = side === "L" ? "R" : "L";
    const episode = { id: ++this.serial, age: 0, part, family, side, strength, severity, pain, startle, localDir: dir.clone().applyQuaternion(q(body.rotation()).invert()), localHitPoint: localPoint(body, hitPoint), guardSide, secondGuard: family === "torso" && severity > 0.92 && pain > 0.58, event };
    this.episodes.push(episode); if (this.episodes.length > 6) this.episodes.shift();
    this.stress = clamp(Math.max(this.stress, pain * 0.55 + startle * 0.65 + severity * 0.12), 0, 1.25); this.last = episode; return episode;
  }

  update(dt) { this.stress *= Math.exp(-dt / 3.8); for (const e of this.episodes) e.age += dt; this.episodes = this.episodes.filter((e) => e.age < 7.5); }
  woundWorld(episode = this.last) { if (!episode) return null; const body = this.h.body(episode.part) || this.h.body("chest"); return body ? worldPoint(body, episode.localHitPoint) : null; }
  activeEpisode() { let best = null, score = -Infinity; for (const e of this.episodes) { const s = e.severity * 0.62 + e.pain * 0.38 + Math.exp(-e.age / 1.8) * 0.35; if (s > score) { best = e; score = s; } } return best; }

  motorScale(name) {
    let scale = 1;
    for (const e of this.episodes) {
      if (e.age > 1.2) continue;
      const acute = Math.exp(-e.age / 0.32);
      if (e.family === "arm" && e.side && name.endsWith(e.side) && /Arm|hand/.test(name)) scale *= 1 - clamp((e.event?.motorShock ?? e.severity * 0.38) * acute, 0, 0.7);
      if (e.family === "leg" && e.side && name.endsWith(e.side) && /thigh|shin|foot/.test(name)) scale *= 1 - clamp((e.event?.motorShock ?? e.severity * 0.42) * acute, 0, 0.78);
      if (e.family === "head" && name === "head") scale *= 1 - clamp((e.event?.motorShock ?? e.severity * 0.34) * acute, 0, 0.62);
    }
    return clamp(scale, 0.12, 1);
  }

  torso(e, targets, handGoals, balance) {
    const t = e.age, acute = Math.exp(-t / 0.2) * e.severity, follow = smooth((t - 0.075) / 0.24) * Math.exp(-Math.max(0, t - 1.25) / 2.2), d = e.localDir;
    const pitch = clamp(d.z * acute * 0.28 + d.z * follow * e.pain * 0.13, -0.4, 0.4), roll = clamp(-d.x * acute * 0.31 - d.x * follow * 0.13, -0.4, 0.4), yaw = clamp(-d.x * acute * 0.1, -0.15, 0.15), lag = smooth((t - 0.11) / 0.28);
    mul(targets, "chest", new THREE.Euler(pitch, yaw, roll));
    mul(targets, "abdomen", new THREE.Euler(pitch * 0.42 * lag, 0, roll * 0.38 * lag));
    mul(targets, "head", new THREE.Euler(-pitch * 0.16, -yaw * 0.25, -roll * 0.12));
    const wound = this.woundWorld(e), guard = smooth((t - 0.11) / 0.25) * Math.exp(-Math.max(0, t - 4.2) / 5);
    if (wound && e.guardSide && guard > 0.02) {
      const toward = wound.clone().add(new THREE.Vector3(0, 0.015, 0.025).applyQuaternion(q(this.h.body("chest").rotation())));
      handGoals.set(e.guardSide, { point: toward, strength: 0.36 + e.pain * 0.24, priority: 0.72 + guard * 0.2, source: "wound" });
      const other = e.guardSide === "L" ? "R" : "L";
      if (e.secondGuard && t > 0.34 && (balance?.risk ?? 1) < 0.4) handGoals.set(other, { point: toward.clone().add(new THREE.Vector3(other === "L" ? -0.045 : 0.045, -0.02, 0)), strength: 0.31 + e.pain * 0.17, priority: 0.58, source: "wound" });
    }
  }

  head(e, targets, handGoals) {
    const t = e.age, acute = Math.exp(-t / 0.19) * e.severity, delayed = smooth((t - 0.12) / 0.3) * Math.exp(-Math.max(0, t - 0.9) / 1.6), d = e.localDir;
    mul(targets, "head", new THREE.Euler(clamp(d.z * acute * 0.56, -0.66, 0.66), clamp(-d.x * acute * 0.2, -0.32, 0.32), clamp(-d.x * acute * 0.52, -0.6, 0.6)));
    mul(targets, "chest", new THREE.Euler(-d.z * delayed * 0.055, 0, d.x * delayed * 0.05));
    const wound = this.woundWorld(e); if (wound && e.guardSide && t > 0.18 && t < 3.8) handGoals.set(e.guardSide, { point: wound, strength: 0.3 + e.pain * 0.16, priority: 0.54, source: "headGuard" });
  }

  arm(e, targets, handGoals) {
    if (!e.side) return; const t = e.age, acute = Math.exp(-t / 0.24) * e.severity, sign = e.side === "L" ? -1 : 1;
    mul(targets, "upperArm" + e.side, new THREE.Euler(clamp(-e.localDir.z * acute * 0.38, -0.55, 0.55), clamp(e.localDir.x * acute * 0.13, -0.22, 0.22), sign * clamp(acute * 0.24, 0, 0.38)));
    mul(targets, "lowerArm" + e.side, new THREE.Euler(clamp(acute * 0.34, 0, 0.5), 0, 0));
    const wound = this.woundWorld(e); if (wound && e.guardSide && t > 0.16 && t < 4.6) handGoals.set(e.guardSide, { point: wound, strength: 0.27 + e.pain * 0.2, priority: 0.56, source: "cradle" });
  }

  leg(e, targets) {
    if (!e.side) return; const acute = Math.exp(-e.age / 0.31) * e.severity, sign = e.side === "L" ? -1 : 1;
    mul(targets, "thigh" + e.side, new THREE.Euler(clamp(acute * 0.12, 0, 0.2), 0, sign * clamp(acute * 0.07, 0, 0.12)));
    mul(targets, "shin" + e.side, new THREE.Euler(clamp(acute * 0.34, 0, 0.62), 0, 0));
  }

  apply(targets, handGoals, balance) { for (const e of this.episodes) { if (e.age > 4.8) continue; if (e.family === "torso") this.torso(e, targets, handGoals, balance); else if (e.family === "head") this.head(e, targets, handGoals); else if (e.family === "arm") this.arm(e, targets, handGoals); else if (e.family === "leg") this.leg(e, targets); } }
  snapshot() { const e = this.activeEpisode(); return e ? { age: e.age, part: e.part, family: e.family, side: e.side, severity: e.severity, pain: e.pain, stress: this.stress, wound: this.woundWorld(e), activeEpisodes: this.episodes.length } : { age: 99, part: null, family: null, side: null, severity: 0, pain: 0, stress: this.stress, wound: null, activeEpisodes: 0 }; }
}
