import * as THREE from "three";

const clamp = THREE.MathUtils.clamp;
const UP = new THREE.Vector3(0, 1, 0);
const v = (value) => new THREE.Vector3(value.x, value.y, value.z);
const q = (value) => new THREE.Quaternion(value.x, value.y, value.z, value.w);

function familyOf(part) {
  if (part === "head") return "head";
  if (/pelvis|abdomen|chest/.test(part)) return "torso";
  if (/thigh|shin|foot/.test(part)) return "leg";
  if (/Arm|hand/.test(part)) return "arm";
  return "other";
}

function randomUnit() {
  const out = new THREE.Vector3(
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
  );
  return out.lengthSq() < 1e-6 ? out.set(0, 1, 0) : out.normalize();
}

export class BloodSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.groundY = options.groundY ?? 0.012;
    this.maxDroplets = options.maxDroplets ?? 320;
    this.maxStreams = options.maxStreams ?? 150;
    this.maxPools = options.maxPools ?? 90;
    this.maxSmears = options.maxSmears ?? 120;
    this.maxSplats = options.maxSplats ?? 180;

    this.droplets = [];
    this.streams = [];
    this.pools = [];
    this.smears = [];
    this.splats = [];
    this.wounds = new Map();

    this.dropletGeometry = new THREE.SphereGeometry(0.018, 6, 5);
    this.streamGeometry = new THREE.CylinderGeometry(1, 0.7, 1, 6, 1, true);
    this.poolGeometry = new THREE.CircleGeometry(1, 28);
    this.smearGeometry = new THREE.PlaneGeometry(1, 1);
    this.splatGeometry = new THREE.CircleGeometry(1, 10);

    this.dropletMaterial = new THREE.MeshStandardMaterial({
      color: 0x6d0000,
      roughness: 0.58,
      metalness: 0.02,
    });
    this.streamMaterial = new THREE.MeshStandardMaterial({
      color: 0x760000,
      roughness: 0.5,
      metalness: 0.02,
    });
    this.poolMaterial = new THREE.MeshStandardMaterial({
      color: 0x350000,
      roughness: 0.44,
      metalness: 0.03,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.smearMaterial = new THREE.MeshStandardMaterial({
      color: 0x430000,
      roughness: 0.52,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.splatMaterial = new THREE.MeshStandardMaterial({
      color: 0x520000,
      roughness: 0.5,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  }

  stats() {
    let wounds = 0;
    for (const list of this.wounds.values()) wounds += list.length;
    return {
      wounds,
      droplets: this.droplets.length,
      streams: this.streams.length,
      pools: this.pools.length,
      smears: this.smears.length,
      splats: this.splats.length,
      effects:
        this.droplets.length +
        this.streams.length +
        this.pools.length +
        this.smears.length +
        this.splats.length,
    };
  }

  impact({ human, part, position, direction, strength = 18, fatal = false }) {
    const family = familyOf(part);
    const factor =
      family === "head"
        ? 1.12
        : family === "torso"
          ? 1
          : family === "leg"
            ? 0.82
            : family === "arm"
              ? 0.7
              : 0.65;
    const severity = clamp((strength / 22) * factor + (fatal ? 0.25 : 0), 0.18, 1.35);
    this.addWound(human, part, position, direction, severity);
    this.spawnBurst(position, direction, severity, human.body(part)?.linvel?.());
    this.spawnSplat(v(position), 0.055 + severity * 0.045);
  }

  addWound(human, part, worldPoint, direction, severity) {
    const rb = human.body(part) || human.body("chest");
    if (!rb) return;
    const point = v(worldPoint);
    const bodyPosition = v(rb.translation());
    const inv = q(rb.rotation()).invert();
    const localPoint = point.sub(bodyPosition).applyQuaternion(inv);
    const list = this.wounds.get(human) || [];
    list.push({
      part,
      family: familyOf(part),
      localPoint,
      direction: v(direction).normalize(),
      severity,
      age: 0,
      duration: 9 + severity * 18,
      dripBudget: 0,
      streamBudget: 0,
      poolBudget: 0,
      smearBudget: 0,
      lastWorld: v(worldPoint),
      lastSmear: null,
    });
    while (list.length > 24) list.shift();
    this.wounds.set(human, list);
  }

  woundWorld(human, wound) {
    const rb = human.body(wound.part) || human.body("chest");
    if (!rb) return null;
    return wound.localPoint
      .clone()
      .applyQuaternion(q(rb.rotation()))
      .add(v(rb.translation()));
  }

  spawnBurst(position, direction, severity, inheritedVelocity) {
    const origin = v(position);
    const dir = v(direction).normalize();
    const inherited = inheritedVelocity ? v(inheritedVelocity) : new THREE.Vector3();
    const count = Math.round(9 + severity * 19);
    for (let i = 0; i < count; i++) {
      const spread = randomUnit().multiplyScalar(0.35 + Math.random() * 0.8);
      const speed = 0.9 + Math.random() * (1.7 + severity * 2.4);
      const velocity = dir
        .clone()
        .multiplyScalar(speed)
        .add(spread)
        .addScaledVector(inherited, 0.28)
        .add(new THREE.Vector3(0, Math.random() * 0.8, 0));
      this.spawnDroplet(origin, velocity, 0.012 + Math.random() * 0.016);
    }
    if (severity > 0.62) {
      const streamVelocity = dir
        .clone()
        .multiplyScalar(1.7 + severity)
        .addScaledVector(inherited, 0.22)
        .add(new THREE.Vector3(0, -0.5, 0));
      this.spawnStreamlet(origin, streamVelocity, 0.16 + severity * 0.08);
    }
  }

  spawnDroplet(position, velocity, radius = 0.018) {
    const mesh = new THREE.Mesh(this.dropletGeometry, this.dropletMaterial);
    mesh.position.copy(position);
    mesh.scale.setScalar(radius / 0.018);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.droplets.push({
      mesh,
      velocity: velocity.clone(),
      age: 0,
      ttl: 2.8,
      radius,
    });
    this.trim(this.droplets, this.maxDroplets, (item) => this.scene.remove(item.mesh));
  }

  spawnStreamlet(position, velocity, ttl = 0.18) {
    if (velocity.lengthSq() < 1e-5) return;
    const length = clamp(velocity.length() * 0.075, 0.05, 0.22);
    const direction = velocity.clone().normalize();
    const mesh = new THREE.Mesh(this.streamGeometry, this.streamMaterial);
    mesh.position.copy(position).addScaledVector(direction, length * 0.5);
    mesh.quaternion.setFromUnitVectors(UP, direction);
    mesh.scale.set(0.009, length, 0.009);
    this.scene.add(mesh);
    this.streams.push({ mesh, age: 0, ttl });
    this.trim(this.streams, this.maxStreams, (item) => this.scene.remove(item.mesh));
  }

  spawnSplat(position, radius = 0.06) {
    const mesh = new THREE.Mesh(this.splatGeometry, this.splatMaterial);
    mesh.position.set(position.x, this.groundY + 0.0015, position.z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    const sx = radius * (0.75 + Math.random() * 0.7);
    const sy = radius * (0.55 + Math.random() * 0.8);
    mesh.scale.set(sx, sy, 1);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.splats.push({ mesh, age: 0 });
    this.trim(this.splats, this.maxSplats, (item) => this.scene.remove(item.mesh));
  }

  addPool(position, amount = 0.03) {
    const p = new THREE.Vector3(position.x, this.groundY + 0.002, position.z);
    let nearest = null;
    let nearestDistance = Infinity;
    for (const pool of this.pools) {
      const distance = Math.hypot(pool.position.x - p.x, pool.position.z - p.z);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = pool;
      }
    }
    if (nearest && nearestDistance < Math.max(0.28, nearest.radius * 0.9)) {
      nearest.amount = clamp(nearest.amount + amount, 0, 3);
      nearest.radius = clamp(
        Math.sqrt(nearest.radius * nearest.radius + amount * 0.075),
        0.08,
        1.25,
      );
      nearest.mesh.scale.set(nearest.radius, nearest.radius * 0.78, 1);
      nearest.mesh.position.x = THREE.MathUtils.lerp(nearest.mesh.position.x, p.x, 0.05);
      nearest.mesh.position.z = THREE.MathUtils.lerp(nearest.mesh.position.z, p.z, 0.05);
      return;
    }

    const radius = clamp(0.065 + Math.sqrt(amount) * 0.17, 0.07, 0.22);
    const mesh = new THREE.Mesh(this.poolGeometry, this.poolMaterial);
    mesh.position.copy(p);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.scale.set(radius, radius * (0.68 + Math.random() * 0.35), 1);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.pools.push({ mesh, position: p, radius, amount, age: 0 });
    this.trim(this.pools, this.maxPools, (item) => this.scene.remove(item.mesh));
  }

  addSmear(from, to, width = 0.06) {
    const delta = to.clone().sub(from);
    delta.y = 0;
    const length = delta.length();
    if (length < 0.035) return;
    const mesh = new THREE.Mesh(this.smearGeometry, this.smearMaterial);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.position.y = this.groundY + 0.0025;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.atan2(delta.z, delta.x);
    mesh.scale.set(length, width * (0.7 + Math.random() * 0.65), 1);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.smears.push({ mesh, age: 0 });
    this.trim(this.smears, this.maxSmears, (item) => this.scene.remove(item.mesh));
  }

  update(dt) {
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const drop = this.droplets[i];
      drop.age += dt;
      drop.velocity.y -= 9.81 * dt;
      drop.velocity.multiplyScalar(Math.exp(-dt * 0.22));
      drop.mesh.position.addScaledVector(drop.velocity, dt);
      if (drop.mesh.position.y <= this.groundY || drop.age >= drop.ttl) {
        if (drop.mesh.position.y <= this.groundY + 0.05) {
          const hit = drop.mesh.position.clone();
          hit.y = this.groundY;
          this.spawnSplat(hit, clamp(drop.radius * 2.2, 0.028, 0.075));
          if (Math.random() < 0.34) this.addPool(hit, drop.radius * 0.55);
        }
        this.scene.remove(drop.mesh);
        this.droplets.splice(i, 1);
      }
    }

    for (let i = this.streams.length - 1; i >= 0; i--) {
      const stream = this.streams[i];
      stream.age += dt;
      stream.mesh.scale.x *= Math.exp(-dt * 3.5);
      stream.mesh.scale.z = stream.mesh.scale.x;
      if (stream.age >= stream.ttl) {
        this.scene.remove(stream.mesh);
        this.streams.splice(i, 1);
      }
    }

    for (const pool of this.pools) pool.age += dt;
    for (const smear of this.smears) smear.age += dt;
    for (const splat of this.splats) splat.age += dt;

    for (const [human, list] of [...this.wounds.entries()]) {
      if (!human?.parts) {
        this.wounds.delete(human);
        continue;
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const wound = list[i];
        wound.age += dt;
        if (wound.age >= wound.duration) {
          list.splice(i, 1);
          continue;
        }
        const world = this.woundWorld(human, wound);
        const rb = human.body(wound.part) || human.body("chest");
        if (!world || !rb) {
          list.splice(i, 1);
          continue;
        }

        const velocity = v(rb.linvel());
        const decay = Math.exp(-wound.age / (5.5 + wound.severity * 4));
        const activity = wound.severity * decay;
        const downOrDead =
          human.dead || human.state === "down" || human.state === "collapse";
        const grounded = world.y < 0.2 || !!human.contact?.(wound.part);
        const horizontalSpeed = Math.hypot(velocity.x, velocity.z);

        wound.dripBudget += dt * (0.8 + activity * 5.5);
        if (wound.dripBudget >= 1) {
          wound.dripBudget -= 1;
          const out = wound.direction
            .clone()
            .multiplyScalar(0.2 + activity * 0.75)
            .addScaledVector(randomUnit(), 0.18)
            .addScaledVector(velocity, 0.42)
            .add(new THREE.Vector3(0, -0.45 - Math.random() * 0.55, 0));
          this.spawnDroplet(world, out, 0.011 + activity * 0.011);
        }

        if (activity > 0.48 && wound.age < 4.5) {
          wound.streamBudget += dt * (activity * 8.5);
          if (wound.streamBudget >= 1) {
            wound.streamBudget -= 1;
            const out = wound.direction
              .clone()
              .multiplyScalar(0.6 + activity * 1.15)
              .addScaledVector(velocity, 0.35)
              .add(new THREE.Vector3(0, -0.7, 0));
            this.spawnStreamlet(world, out, 0.1 + activity * 0.1);
          }
        }

        if ((downOrDead || grounded) && activity > 0.08) {
          wound.poolBudget += dt * activity * (downOrDead ? 1.9 : 0.55);
          if (wound.poolBudget >= 0.42) {
            const amount = wound.poolBudget * 0.045;
            wound.poolBudget = 0;
            this.addPool(world, amount);
          }
        }

        if (grounded && horizontalSpeed > 0.18 && activity > 0.12) {
          wound.smearBudget += dt * horizontalSpeed * activity * 2.4;
          if (wound.smearBudget >= 0.16) {
            wound.smearBudget = 0;
            const here = new THREE.Vector3(world.x, this.groundY, world.z);
            if (wound.lastSmear && wound.lastSmear.distanceTo(here) < 0.75)
              this.addSmear(wound.lastSmear, here, 0.045 + activity * 0.07);
            wound.lastSmear = here;
          }
        } else if (wound.lastSmear && horizontalSpeed < 0.08) {
          wound.lastSmear = null;
        }

        wound.lastWorld.copy(world);
      }
      if (!list.length) this.wounds.delete(human);
    }
  }

  removeHuman(human) {
    this.wounds.delete(human);
  }

  clear() {
    for (const item of this.droplets) this.scene.remove(item.mesh);
    for (const item of this.streams) this.scene.remove(item.mesh);
    for (const item of this.pools) this.scene.remove(item.mesh);
    for (const item of this.smears) this.scene.remove(item.mesh);
    for (const item of this.splats) this.scene.remove(item.mesh);
    this.droplets.length = 0;
    this.streams.length = 0;
    this.pools.length = 0;
    this.smears.length = 0;
    this.splats.length = 0;
    this.wounds.clear();
  }

  trim(array, limit, remove) {
    while (array.length > limit) {
      const item = array.shift();
      remove(item);
    }
  }
}
