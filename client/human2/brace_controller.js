import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

const clamp = THREE.MathUtils.clamp;
const v = (p) => new THREE.Vector3(p.x, p.y, p.z);

export class BraceController {
  constructor(human) {
    this.h = human;
    this.braces = {
      L: { active: false, target: new THREE.Vector3(), age: 0, contactAge: 0 },
      R: { active: false, target: new THREE.Vector3(), age: 0, contactAge: 0 },
    };
  }

  clear(side) { const b = this.braces[side]; b.active = false; b.age = 0; b.contactAge = 0; }

  findTarget(side) {
    const h = this.h, shoulder = h.body("upperArm" + side); if (!shoulder) return null;
    const origin = v(shoulder.translation()), sign = side === "L" ? -1 : 1;
    const escape = h.balance.escape.clone().setY(0); if (escape.lengthSq() < 1e-6) escape.set(0, 0, 1); escape.normalize();
    const lateral = new THREE.Vector3(-escape.z, 0, escape.x).multiplyScalar(sign);
    const dirs = [
      escape.clone().multiplyScalar(0.52).addScaledVector(lateral, 0.28).add(new THREE.Vector3(0, -0.8, 0)),
      escape.clone().multiplyScalar(0.72).addScaledVector(lateral, 0.16).add(new THREE.Vector3(0, -0.52, 0)),
      lateral.clone().multiplyScalar(0.62).addScaledVector(escape, 0.25).add(new THREE.Vector3(0, -0.52, 0)),
    ];
    let best = null;
    for (const d of dirs) {
      d.normalize(); const hit = h.world.castRay(new RAPIER.Ray(origin, d), 0.82, true, undefined, 0x00010001); if (!hit) continue;
      const target = origin.clone().addScaledVector(d, Math.max(0.08, hit.timeOfImpact - 0.055)), score = hit.timeOfImpact + Math.max(0, target.y - origin.y) * 0.5;
      if (!best || score < best.score) best = { target, score };
    }
    return best?.target ?? null;
  }

  maybeStart(side) {
    const b = this.braces[side]; if (b.active) return true;
    const target = this.findTarget(side); if (!target) return false;
    b.active = true; b.target.copy(target); b.age = b.contactAge = 0; return true;
  }

  update(dt, handGoals) {
    const h = this.h, balance = h.balance;
    if (h.dead || h.physiology?.unconscious || h.passiveHandoff || !["critical", "falling"].includes(balance.state)) { this.clear("L"); this.clear("R"); return; }
    const primary = balance.escape.x < -0.08 ? "L" : balance.escape.x > 0.08 ? "R" : h.lastStepSide === "L" ? "R" : "L", secondary = primary === "L" ? "R" : "L";
    this.maybeStart(primary); if (balance.risk > 0.86 || balance.fallAge > 0.18) this.maybeStart(secondary);
    for (const side of ["L", "R"]) {
      const b = this.braces[side]; if (!b.active) continue; b.age += dt;
      const hand = h.body("hand" + side), chest = h.body("chest"); if (!hand || !chest || b.age > 0.95) { this.clear(side); continue; }
      const distance = v(hand.translation()).distanceTo(b.target); if (distance > 0.8) { this.clear(side); continue; }
      handGoals.set(side, { point: b.target.clone(), strength: 0.38 + clamp(balance.risk, 0, 1) * 0.2, priority: 1.05, source: "brace" });
      if (h.contact("hand" + side)) {
        b.contactAge += dt;
        const rel = v(chest.linvel()).sub(v(hand.linvel()));
        const up = clamp(34 + Math.max(0, -rel.y) * 28 + balance.risk * 24, 18, 78);
        const oppose = balance.escape.clone().setY(0).multiplyScalar(-clamp(rel.length() * 8, 0, 22));
        h.forcePair(chest, hand, new THREE.Vector3(oppose.x, up, oppose.z), 82, dt);
        if (b.contactAge > 0.42 && (distance > 0.16 || Math.random() < dt * 0.8)) this.clear(side);
      }
    }
  }

  snapshot() { return Object.fromEntries(Object.entries(this.braces).map(([side, b]) => [side, { active: b.active, target: b.active ? { x: b.target.x, y: b.target.y, z: b.target.z } : null, age: b.age, contactAge: b.contactAge }])); }
}
