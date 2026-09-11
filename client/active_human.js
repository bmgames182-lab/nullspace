import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
const GROUP = (0x0002 << 16) | 0x0003;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const vec = (v) => new THREE.Vector3(v.x, v.y, v.z);
const quat = (q) => new THREE.Quaternion(q.x, q.y, q.z, q.w);
const identity = new THREE.Quaternion();
export class ActiveHuman {
  constructor(world, scene, x = 0, z = 0) {
    this.world = world;
    this.scene = scene;
    this.parts = new Map();
    this.joints = [];
    this.hitMeshes = [];
    this.age = 0;
    this.shock = 0;
    this.lastHit = { part: "torso", dir: new THREE.Vector3(0, 0, -1) };

    const skin = new THREE.MeshStandardMaterial({
      color: 0x9b7159,
      roughness: 0.9,
    });
    const cloth = new THREE.MeshStandardMaterial({
      color: 0x586571,
      roughness: 0.92,
    });
    const vest = new THREE.MeshStandardMaterial({
      color: 0x34414b,
      roughness: 0.82,
    });
    const boot = new THREE.MeshStandardMaterial({
      color: 0x0d0f10,
      roughness: 0.9,
    });
    const add = (name, px, py, pz, shape, size, mat, mass = 1) => {
      const rb = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x + px, py, z + pz)
          .setLinearDamping(0.06)
          .setAngularDamping(0.18)
          .setCcdEnabled(true)
          .setAdditionalSolverIterations(4),
      );
      let cd, geo;
      if (shape === "sphere") {
        cd = RAPIER.ColliderDesc.ball(size[0]);
        geo = new THREE.SphereGeometry(size[0], 18, 12);
      } else if (shape === "capsule") {
        cd = RAPIER.ColliderDesc.capsule(size[1], size[0]);
        geo = new THREE.CapsuleGeometry(size[0], size[1] * 2, 6, 10);
      } else {
        cd = RAPIER.ColliderDesc.cuboid(size[0], size[1], size[2]);
        geo = new THREE.BoxGeometry(size[0] * 2, size[1] * 2, size[2] * 2);
      }
      cd.setMass(mass)
        .setFriction(name.startsWith("foot") ? 1.45 : 0.92)
        .setRestitution(0.002)
        .setCollisionGroups(GROUP);
      const collider = world.createCollider(cd, rb);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.part = name;
      scene.add(mesh);
      this.parts.set(name, { rb, mesh, collider });
      this.hitMeshes.push(mesh);
      return rb;
    };
    const pelvis = add(
      "pelvis",
      0,
      1.0,
      0,
      "box",
      [0.19, 0.14, 0.135],
      vest,
      11,
    );
    const abdomen = add(
      "abdomen",
      0,
      1.24,
      0,
      "box",
      [0.2, 0.14, 0.125],
      cloth,
      8,
    );
    const chest = add(
      "chest",
      0,
      1.51,
      0,
      "box",
      [0.235, 0.21, 0.14],
      vest,
      19,
    );
    const head = add("head", 0, 1.84, 0, "sphere", [0.15], skin, 5);
    const uaL = add(
        "upperArmL",
        -0.29,
        1.45,
        0,
        "capsule",
        [0.068, 0.17],
        cloth,
        2.3,
      ),
      uaR = add(
        "upperArmR",
        0.29,
        1.45,
        0,
        "capsule",
        [0.068, 0.17],
        cloth,
        2.3,
      );
    const laL = add(
        "lowerArmL",
        -0.29,
        1.1,
        0,
        "capsule",
        [0.058, 0.16],
        skin,
        1.5,
      ),
      laR = add("lowerArmR", 0.29, 1.1, 0, "capsule", [0.058, 0.16], skin, 1.5);
    const thL = add(
        "thighL",
        -0.13,
        0.66,
        0,
        "capsule",
        [0.082, 0.17],
        cloth,
        8,
      ),
      thR = add("thighR", 0.13, 0.66, 0, "capsule", [0.082, 0.17], cloth, 8);
    const shL = add(
        "shinL",
        -0.13,
        0.26,
        0,
        "capsule",
        [0.07, 0.13],
        cloth,
        3.5,
      ),
      shR = add("shinR", 0.13, 0.26, 0, "capsule", [0.07, 0.13], cloth, 3.5);
    const ftL = add(
        "footL",
        -0.13,
        0.065,
        0.06,
        "box",
        [0.095, 0.045, 0.17],
        boot,
        1.2,
      ),
      ftR = add(
        "footR",
        0.13,
        0.065,
        0.06,
        "box",
        [0.095, 0.045, 0.17],
        boot,
        1.2,
      );
    const keep = (j) => {
      try {
        j?.setContactsEnabled?.(false);
      } catch {}
      if (j) this.joints.push(j);
      return j;
    };
    const ball = (a, b, aa, bb) =>
      keep(
        world.createImpulseJoint(
          RAPIER.JointData.spherical(aa, bb),
          a,
          b,
          true,
        ),
      );
    const hinge = (a, b, aa, bb, min, max) => {
      const j = keep(
        world.createImpulseJoint(
          RAPIER.JointData.revolute(aa, bb, { x: 1, y: 0, z: 0 }),
          a,
          b,
          true,
        ),
      );
      j?.setLimits?.(min, max);
      return j;
    };
    ball(pelvis, abdomen, { x: 0, y: 0.12, z: 0 }, { x: 0, y: -0.12, z: 0 });
    ball(abdomen, chest, { x: 0, y: 0.12, z: 0 }, { x: 0, y: -0.15, z: 0 });
    ball(chest, head, { x: 0, y: 0.2, z: 0 }, { x: 0, y: -0.13, z: 0 });
    ball(chest, uaL, { x: -0.29, y: 0.12, z: 0 }, { x: 0, y: 0.18, z: 0 });
    ball(chest, uaR, { x: 0.29, y: 0.12, z: 0 }, { x: 0, y: 0.18, z: 0 });
    hinge(
      uaL,
      laL,
      { x: 0, y: -0.18, z: 0 },
      { x: 0, y: 0.17, z: 0 },
      -2.45,
      0.04,
    );
    hinge(
      uaR,
      laR,
      { x: 0, y: -0.18, z: 0 },
      { x: 0, y: 0.17, z: 0 },
      -2.45,
      0.04,
    );
    ball(pelvis, thL, { x: -0.13, y: -0.13, z: 0 }, { x: 0, y: 0.21, z: 0 });
    ball(pelvis, thR, { x: 0.13, y: -0.13, z: 0 }, { x: 0, y: 0.21, z: 0 });
    hinge(
      thL,
      shL,
      { x: 0, y: -0.21, z: 0 },
      { x: 0, y: 0.19, z: 0 },
      -0.04,
      2.35,
    );
    hinge(
      thR,
      shR,
      { x: 0, y: -0.21, z: 0 },
      { x: 0, y: 0.19, z: 0 },
      -0.04,
      2.35,
    );
    hinge(
      shL,
      ftL,
      { x: 0, y: -0.15, z: 0 },
      { x: 0, y: 0.045, z: -0.06 },
      -0.42,
      0.5,
    );
    hinge(
      shR,
      ftR,
      { x: 0, y: -0.15, z: 0 },
      { x: 0, y: 0.045, z: -0.06 },
      -0.42,
      0.5,
    );
    const face = this.parts.get("head").mesh;
    for (const x of [-0.052, 0.052]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), boot);
      eye.position.set(x, 0.025, 0.139);
      face.add(eye);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.027, 0.07, 6), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -0.015, 0.158);
    face.add(nose);
    for (const side of ["L", "R"]) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), skin);
      hand.scale.set(0.72, 1.25, 0.65);
      hand.position.y = -0.205;
      this.parts.get("lowerArm" + side).mesh.add(hand);
    }
    this.initializeControl();
    this.sync();
  }
  body(name) {
    return this.parts.get(name)?.rb;
  }

  initializeControl() {
    this.state = "balance";
    this.stateTime = 0;
    this.health = 1;
    this.dead = false;
    this.injury = { L: 0, R: 0, armL: 0, armR: 0 };
    this.hitAge = 99;
    this.support = 0;
    this.step = {
      phase: "idle",
      side: "L",
      time: 0,
      cooldown: 0.3,
      from: new THREE.Vector3(),
      target: new THREE.Vector3(),
    };
    this.feet = {
      L: { quality: 0, anchor: vec(this.body("footL").translation()) },
      R: { quality: 0, anchor: vec(this.body("footR").translation()) },
    };
    this.mass = 0;
    for (const { rb } of this.parts.values()) this.mass += rb.mass();
    this.metrics = {
      steps: 0,
      plants: 0,
      maxForce: 0,
      maxTorque: 0,
      activeImpulse: 0,
    };
    this.history = ["balance"];
    // Rapier 0.19 exposes native hinge limits, but no spherical angular-limit API.
    // These finite, passive tissue stops also operate on a limp body.
    this.muscles = [
      [
        "pelvis",
        "abdomen",
        [-0.48, -0.35, -0.32],
        [0.48, 0.35, 0.32],
        300,
        22,
        110,
      ],
      [
        "abdomen",
        "chest",
        [-0.4, -0.45, -0.32],
        [0.5, 0.45, 0.32],
        250,
        18,
        100,
      ],
      ["chest", "head", [-0.6, -0.85, -0.5], [0.65, 0.85, 0.5], 22, 2, 13],
      ...["L", "R"].flatMap((s) => [
        [
          "pelvis",
          "thigh" + s,
          [-1.65, -0.55, -0.65],
          [0.65, 0.55, 0.65],
          105,
          8,
          80,
        ],
        [
          "thigh" + s,
          "shin" + s,
          [-0.04, -0.03, -0.03],
          [2.35, 0.03, 0.03],
          85,
          6,
          65,
        ],
        [
          "shin" + s,
          "foot" + s,
          [-0.42, -0.03, -0.03],
          [0.5, 0.03, 0.03],
          35,
          3,
          28,
        ],
        [
          "chest",
          "upperArm" + s,
          [-2.6, -1.1, -1.9],
          [1.1, 1.1, 1.9],
          18,
          2,
          18,
        ],
        [
          "upperArm" + s,
          "lowerArm" + s,
          [-2.45, -0.03, -0.03],
          [0.04, 0.03, 0.03],
          13,
          1.3,
          11,
        ],
      ]),
    ];
  }
  setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.stateTime = 0;
    this.history.push(next);
    if (this.history.length > 32) this.history.shift();
  }
  centreOfMass() {
    const position = new THREE.Vector3(),
      velocity = new THREE.Vector3();
    for (const { rb } of this.parts.values()) {
      position.addScaledVector(vec(rb.translation()), rb.mass());
      velocity.addScaledVector(vec(rb.linvel()), rb.mass());
    }
    return {
      position: position.multiplyScalar(1 / this.mass),
      velocity: velocity.multiplyScalar(1 / this.mass),
    };
  }
  contact(name) {
    const part = this.parts.get(name);
    let quality = 0;
    this.world.contactPairsWith(part.collider, (other) => {
      if (other.parent()?.isDynamic()) return;
      this.world.contactPair(part.collider, other, (m) => {
        if (Math.abs(m.normal().y) < 0.65) return;
        for (let i = 0; i < m.numSolverContacts(); i++)
          if (
            m.solverContactDist(i) < 0.008 &&
            m.solverContactPoint(i).y < part.rb.translation().y
          )
            quality = 1;
      });
    });
    return quality;
  }
  footQuality(body) {
    const name = body === this.body("footL") ? "footL" : "footR";
    return (
      this.contact(name) *
      clamp(
        (vec(UP).applyQuaternion(quat(body.rotation())).y - 0.3) / 0.6,
        0,
        1,
      )
    );
  }
  // Force pairs transmit muscle forces through the skeleton. No unopposed lift.
  forcePair(a, b, force, cap, dt) {
    if (this.dead) return;
    force.clampLength(0, cap);
    this.metrics.maxForce = Math.max(this.metrics.maxForce, force.length());
    this.metrics.activeImpulse += force.length() * dt;
    a.applyImpulse(force.clone().multiplyScalar(dt), true);
    b.applyImpulse(force.clone().multiplyScalar(-dt), true);
  }
  torquePair(parent, child, torque, cap, dt, active = true) {
    torque.clampLength(0, cap);
    this.metrics.maxTorque = Math.max(this.metrics.maxTorque, torque.length());
    if (active) this.metrics.activeImpulse += torque.length() * dt;
    child.applyTorqueImpulse(torque.clone().multiplyScalar(dt), true);
    parent.applyTorqueImpulse(torque.clone().multiplyScalar(-dt), true);
  }
  cohere(parent, child, target, gain, damping, cap, activity, dt) {
    const qp = quat(parent.rotation()),
      qc = quat(child.rotation());
    const error = qp
      .clone()
      .multiply(target)
      .multiply(qc.clone().invert())
      .normalize();
    if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w);
    const axis = new THREE.Vector3(error.x, error.y, error.z),
      len = axis.length();
    if (len > 1e-6) axis.multiplyScalar((2 * Math.atan2(len, error.w)) / len);
    const relative = vec(child.angvel()).sub(vec(parent.angvel()));
    this.torquePair(
      parent,
      child,
      axis
        .multiplyScalar(gain * activity)
        .addScaledVector(relative, -damping * activity),
      cap * activity,
      dt,
    );
  }
  passiveLimit(m, dt) {
    const [a, b, lo, hi] = m,
      parent = this.body(a),
      child = this.body(b);
    const relative = quat(parent.rotation())
      .invert()
      .multiply(quat(child.rotation()));
    const e = new THREE.Euler().setFromQuaternion(relative, "XYZ");
    const angles = [e.x, e.y, e.z],
      error = angles.map((x, i) => clamp(x, lo[i], hi[i]) - x);
    if (Math.hypot(...error) < 1e-5) return;
    const av = vec(child.angvel())
      .sub(vec(parent.angvel()))
      .applyQuaternion(quat(parent.rotation()).invert());
    const t = new THREE.Vector3(...error).multiplyScalar(95);
    for (const [i, key] of ["x", "y", "z"].entries())
      if (error[i] * av[key] < 0) t[key] -= av[key] * 2.5;
    t.applyQuaternion(quat(parent.rotation()));
    this.torquePair(parent, child, t, 38, dt, false);
  }
  hit(part, dir, strength = 12, point) {
    const rb = this.body(part) || this.body("chest");
    const impulse = vec(dir);
    if (impulse.lengthSq() < 1e-10) return;
    impulse.normalize().multiplyScalar(clamp(strength, 0, 28));
    rb.applyImpulseAtPoint(impulse, point || rb.translation(), true);
    if (this.dead) return;
    this.lastHit = {
      part,
      dir: vec(dir).normalize(),
      point: vec(point || rb.translation()),
    };
    this.hitAge = 0;
    this.shock = Math.min(1, this.shock + strength / 25);
    const side = part.endsWith("L") ? "L" : "R";
    if (/thigh|shin|foot/.test(part))
      this.injury[side] = clamp(this.injury[side] + strength / 30, 0, 1);
    if (/Arm/.test(part))
      this.injury["arm" + side] = clamp(
        this.injury["arm" + side] + strength / 40,
        0,
        1,
      );
    this.health -=
      strength *
      (part === "head" ? 0.045 : /chest|abdomen/.test(part) ? 0.015 : 0.003);
    if (this.health <= 0 || (this.injury.L > 0.95 && this.injury.R > 0.95)) {
      this.dead = true;
      this.step.phase = "idle";
      this.setState("limp");
      return;
    }
    this.setState("stumble");
  }
  beginStep(capture) {
    const scores = ["L", "R"].map((s) => ({
      s,
      score:
        vec(this.body("foot" + s).translation()).distanceTo(capture) -
        this.injury[s] * 0.18,
    }));
    scores.sort((a, b) => b.score - a.score);
    const s = scores[0].s,
      other = s === "L" ? "R" : "L";
    if (this.feet[other].quality < 0.35 || this.injury[other] > 0.85) return;
    const pelvis = vec(this.body("pelvis").translation()),
      from = vec(this.body("foot" + s).translation());
    const target = capture.clone();
    target.x += s === "L" ? -0.15 : 0.15;
    const reach = target.clone().sub(pelvis);
    reach.y = 0;
    reach.clampLength(0, 0.45);
    target.x = pelvis.x + reach.x;
    target.z = pelvis.z + reach.z;
    target.x =
      s === "L"
        ? Math.min(target.x, pelvis.x - 0.075)
        : Math.max(target.x, pelvis.x + 0.075);
    const ray = new RAPIER.Ray(
      { x: target.x, y: pelvis.y + 0.1, z: target.z },
      { x: 0, y: -1, z: 0 },
    );
    const ground = this.world.castRay(ray, 1.5, true, undefined, 0x00010001);
    if (!ground) return;
    target.y = pelvis.y + 0.1 - ground.timeOfImpact + 0.055;
    this.step = { phase: "lift", side: s, time: 0, cooldown: 0, from, target };
    this.metrics.steps++;
  }
  legTargets(side, target, targets) {
    const pelvis = this.body("pelvis"),
      qp = quat(pelvis.rotation());
    const hip = new THREE.Vector3(side === "L" ? -0.13 : 0.13, -0.13, 0)
      .applyQuaternion(qp)
      .add(vec(pelvis.translation()));
    const ankle = target.clone().add(new THREE.Vector3(0, 0.045, -0.06));
    const delta = ankle.clone().sub(hip),
      d = clamp(delta.length(), 0.15, 0.755),
      axis = delta.normalize();
    const along = (0.42 * 0.42 - 0.34 * 0.34 + d * d) / (2 * d);
    let pole = new THREE.Vector3(0, 0, 1).applyQuaternion(qp);
    pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    const knee = hip
      .clone()
      .addScaledVector(axis, along)
      .addScaledVector(
        pole,
        Math.sqrt(Math.max(0, 0.42 * 0.42 - along * along)),
      );
    const upper = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      knee.clone().sub(hip).normalize(),
    );
    const lower = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      ankle.clone().sub(knee).normalize(),
    );
    targets["thigh" + side] = qp.clone().invert().multiply(upper);
    targets["shin" + side] = upper.clone().invert().multiply(lower);
    targets["foot" + side] = lower.clone().invert();
  }
  update(dt) {
    this.age += dt;
    this.hitAge += dt;
    this.stateTime += dt;
    this.metrics.activeImpulse = 0;
    for (const m of this.muscles) this.passiveLimit(m, dt);
    if (this.dead) return;
    this.shock *= Math.exp(-dt * 1.4);
    const pelvis = this.body("pelvis"),
      chest = this.body("chest"),
      pp = vec(pelvis.translation()),
      pv = vec(pelvis.linvel());
    const com = this.centreOfMass(),
      up = vec(UP).applyQuaternion(quat(chest.rotation())).y;
    const targets = {},
      activity = clamp(1 - this.shock * 0.68, 0.25, 1);
    let quality = 0,
      center = new THREE.Vector3();
    for (const s of ["L", "R"]) {
      const f = this.feet[s],
        q = this.footQuality(this.body("foot" + s));
      if (q > 0.4 && f.quality < 0.4)
        f.anchor.copy(vec(this.body("foot" + s).translation()));
      f.quality = q;
      quality += q;
      center.addScaledVector(vec(this.body("foot" + s).translation()), q);
    }
    this.support = quality;
    if (quality) center.multiplyScalar(1 / quality);
    else center.copy(pp);
    const capture = com.position
      .clone()
      .addScaledVector(
        com.velocity,
        Math.sqrt(Math.max(0.2, com.position.y - center.y) / 9.81),
      );
    capture.y = center.y;
    const error = new THREE.Vector3(
      capture.x - center.x,
      0,
      capture.z - center.z,
    ).length();
    if (
      this.state !== "brace" &&
      this.state !== "kneel" &&
      this.state !== "stand" &&
      (pp.y < 0.57 || up < 0.48 || (quality === 0 && pv.y < -0.8))
    )
      this.setState("brace");
    if (this.state === "balance" && (error > 0.13 || this.shock > 0.2))
      this.setState("stumble");
    if (
      this.state === "stumble" &&
      error < 0.1 &&
      up > 0.88 &&
      this.stateTime > 0.7 &&
      quality > 0.7
    )
      this.setState("balance");
    const calm = com.velocity.length() < 1.2;
    if (
      this.state === "brace" &&
      this.stateTime > 1.0 &&
      calm &&
      (this.contact("shinL") || this.contact("shinR") || quality > 0.4)
    )
      this.setState("kneel");
    if (
      this.state === "kneel" &&
      this.stateTime > 1.4 &&
      quality > 0.6 &&
      up > 0.65 &&
      pp.y > 0.48
    )
      this.setState("stand");
    if (
      this.state === "stand" &&
      pp.y > 0.87 &&
      up > 0.82 &&
      this.stateTime > 0.8
    )
      this.setState("balance");
    if (
      (this.state === "stand" || this.state === "kneel") &&
      this.stateTime > 4
    )
      this.setState("brace");
    const recovering = this.state === "kneel" || this.state === "stand",
      standing =
        this.state === "balance" ||
        this.state === "stumble" ||
        this.state === "stand";
    if (!standing && this.step.phase !== "idle") {
      this.step.phase = "idle";
      this.step.cooldown = 0.4;
    }
    this.step.cooldown -= dt;
    if (
      standing &&
      this.step.phase === "idle" &&
      this.step.cooldown <= 0 &&
      error > 0.095 &&
      pp.y > 0.65 &&
      up > 0.5
    )
      this.beginStep(capture);
    if (this.step.phase !== "idle") {
      const st = this.step;
      st.time += dt;
      if (st.phase === "lift" && st.time > 0.1) {
        st.phase = "travel";
        st.time = 0;
      } else if (st.phase === "travel" && st.time > 0.23) {
        st.phase = "plant";
        st.time = 0;
      } else if (
        st.phase === "plant" &&
        (st.time > 0.25 ||
          (st.time > 0.055 && this.feet[st.side].quality > 0.4))
      ) {
        if (this.feet[st.side].quality > 0.4) this.metrics.plants++;
        st.phase = "idle";
        st.cooldown = 0.2;
        this.feet[st.side].anchor.copy(
          vec(this.body("foot" + st.side).translation()),
        );
      }
    }
    const swing = this.step.phase !== "idle" ? this.step.side : null;
    for (const s of ["L", "R"]) {
      const foot = this.body("foot" + s),
        fp = vec(foot.translation()),
        fv = vec(foot.linvel()),
        injury = this.injury[s];
      let target = this.feet[s].anchor.clone();
      if (s === swing) {
        const st = this.step,
          t =
            st.phase === "lift"
              ? 0
              : st.phase === "travel"
                ? clamp(st.time / 0.23, 0, 1)
                : 1;
        target.lerpVectors(st.from, st.target, t * t * (3 - 2 * t));
        target.y +=
          st.phase === "lift"
            ? 0.12 * clamp(st.time / 0.1, 0, 1)
            : st.phase === "travel"
              ? 0.12
              : 0.12 * (1 - clamp(st.time / 0.18, 0, 1));
        const force = target
          .clone()
          .sub(fp)
          .multiplyScalar(250)
          .addScaledVector(fv, -22);
        this.forcePair(foot, pelvis, force, 110 * (1 - injury * 0.6), dt);
      }
      if (!standing) {
        target.set(pp.x + (s === "L" ? -0.17 : 0.17), 0.055, pp.z + 0.18);
        if (!recovering) target.z += 0.12;
      }
      this.legTargets(s, target, targets);
      if (standing && this.feet[s].quality > 0.1 && s !== swing) {
        const load = (1 - injury * 0.85) / Math.max(1, quality),
          height =
            this.state === "stand"
              ? 0.64 + 0.32 * clamp(this.stateTime / 1.3, 0, 1)
              : 0.96 - injury * 0.08;
        const force = new THREE.Vector3(
          (center.x - com.position.x) * 650 - com.velocity.x * 190,
          clamp(
            this.mass * 9.81 + (height - pp.y) * 1300 - pv.y * 170,
            0,
            1100,
          ),
          (center.z - com.position.z) * 650 - com.velocity.z * 190,
        ).multiplyScalar(load * activity);
        force.x = clamp(force.x, -200, 200);
        force.z = clamp(force.z, -200, 200);
        this.forcePair(pelvis, foot, force, 850, dt);
      }
    }
    // Root balance torque reacts against grounded feet, so it cannot right a body in midair.
    if (standing && quality > 0.1) {
      const axis = vec(UP)
        .applyQuaternion(quat(pelvis.rotation()))
        .cross(UP)
        .multiplyScalar(600)
        .addScaledVector(vec(pelvis.angvel()), -65);
      for (const s of ["L", "R"])
        if (this.feet[s].quality > 0.1 && s !== swing)
          this.torquePair(
            this.body("foot" + s),
            pelvis,
            axis.clone().multiplyScalar(activity / Math.max(1, quality)),
            180,
            dt,
          );
    }
    const flinch = Math.exp(-this.hitAge * 5) * this.shock;
    targets.abdomen = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        clamp(this.lastHit.dir.z * flinch * 0.3, -0.25, 0.25),
        this.lastHit.dir.x * flinch * 0.22,
        0,
      ),
    );
    targets.chest = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(flinch * 0.22, -this.lastHit.dir.x * flinch * 0.3, 0),
    );
    targets.head = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-flinch * 0.3, 0, 0),
    );
    const fallDirection = new THREE.Vector3(com.velocity.x, 0, com.velocity.z);
    if (fallDirection.length() < 0.15)
      fallDirection.copy(this.lastHit.dir).setY(0);
    fallDirection.normalize();
    for (const s of ["L", "R"]) {
      const arm = this.body("lowerArm" + s),
        shoulder = this.body("upperArm" + s),
        sign = s === "L" ? -1 : 1;
      targets["upperArm" + s] = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-0.09, 0, sign * 0.1),
      );
      targets["lowerArm" + s] = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-0.16, 0, 0),
      );
      const bracing = this.state === "brace" || recovering || up < 0.72;
      if (bracing || this.hitAge < 0.65) {
        const cp = vec(chest.translation());
        let goal;
        if (bracing) {
          goal = cp.clone().addScaledVector(fallDirection, 0.45);
          goal.x += sign * 0.29;
          goal.y = Math.max(0.12, cp.y - 0.58);
          const origin = vec(shoulder.translation()),
            direction = goal.clone().sub(origin),
            distance = direction.length();
          direction.normalize();
          const surface = this.world.castRay(
            new RAPIER.Ray(origin, direction),
            distance + 0.2,
            true,
            undefined,
            0x00010001,
          );
          if (surface)
            goal = origin.addScaledVector(
              direction,
              Math.max(0.05, surface.timeOfImpact - 0.08),
            );
        } else {
          goal = vec(
            this.body(
              this.lastHit.part === "head" ? "head" : "abdomen",
            ).translation(),
          );
          goal.x += sign * 0.13;
          goal.z += 0.18;
        }
        const force = goal
          .sub(vec(arm.translation()))
          .multiplyScalar(100)
          .addScaledVector(vec(arm.linvel()).sub(vec(chest.linvel())), -10);
        this.forcePair(
          arm,
          chest,
          force,
          75 * (1 - this.injury["arm" + s] * 0.8),
          dt,
        );
      }
      if (recovering) {
        // Try to lift only against actual hands, knees or feet. Failed attempts yield back to bracing.
        const supportName = this.contact("foot" + s)
          ? "foot" + s
          : this.contact("shin" + s)
            ? "shin" + s
            : this.contact("lowerArm" + s)
              ? "lowerArm" + s
              : null;
        if (supportName) {
          const anchor = this.body(supportName),
            goalHeight = this.state === "kneel" ? 0.65 : 0.9;
          this.forcePair(
            pelvis,
            anchor,
            new THREE.Vector3(
              0,
              clamp((goalHeight - pp.y) * 950 - pv.y * 90 + 250, 0, 480),
              0,
            ),
            480 * (1 - this.injury[s] * 0.7),
            dt,
          );
          const torque = vec(UP)
            .applyQuaternion(quat(pelvis.rotation()))
            .cross(UP)
            .multiplyScalar(90)
            .addScaledVector(vec(pelvis.angvel()), -12);
          this.torquePair(anchor, pelvis, torque, 65, dt);
          const cp = vec(chest.translation()),
            cv = vec(chest.linvel());
          this.forcePair(
            chest,
            anchor,
            new THREE.Vector3(
              0,
              clamp((goalHeight + 0.42 - cp.y) * 650 - cv.y * 90, 0, 330),
              0,
            ),
            330,
            dt,
          );
          const chestTorque = vec(UP)
            .applyQuaternion(quat(chest.rotation()))
            .cross(UP)
            .multiplyScalar(160)
            .addScaledVector(vec(chest.angvel()), -18);
          this.torquePair(anchor, chest, chestTorque, 85, dt);
        }
      }
    }
    for (const m of this.muscles) {
      const [a, b, , , gain, damping, cap] = m;
      let strength = activity;
      if (/Arm/.test(b))
        strength *= 1 - this.injury["arm" + b.slice(-1)] * 0.85;
      if (/thigh|shin|foot/.test(b))
        strength *= 1 - this.injury[b.slice(-1)] * 0.85;
      if (this.state === "brace") strength *= 0.28;
      this.cohere(
        this.body(a),
        this.body(b),
        targets[b] || identity,
        gain,
        damping,
        cap,
        strength,
        dt,
      );
    }
  }

  sync() {
    for (const { rb, mesh } of this.parts.values()) {
      const p = rb.translation(),
        r = rb.rotation();
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
  destroy() {
    for (const j of this.joints) this.world.removeImpulseJoint(j, true);
    const materials = new Set();
    for (const { rb, mesh } of this.parts.values()) {
      this.scene.remove(mesh);
      mesh.traverse((object) => {
        object.geometry?.dispose();
        if (object.material) materials.add(object.material);
      });
      this.world.removeRigidBody(rb);
    }
    for (const material of materials) material.dispose();
    this.parts.clear();
    this.joints.length = 0;
    this.hitMeshes.length = 0;
  }
}
