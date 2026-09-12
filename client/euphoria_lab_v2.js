import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { EuphoriaHuman } from "./human2/euphoria_human.js";
import { BloodSystem } from "./blood_fx.js";

await RAPIER.init();

const TEST_MODE = new URLSearchParams(location.search).has("test");
const FIXED_DT = 1 / 240;
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111315);
scene.fog = new THREE.FogExp2(0x111315, 0.025);

const camera = new THREE.PerspectiveCamera(82, innerWidth / innerHeight, 0.03, 120);
camera.position.set(0, 1.68, 3.6);
camera.lookAt(0, 1.25, 0);
scene.add(camera);
const viewLight = new THREE.PointLight(0xcbdbe4, 1.2, 3);
viewLight.position.set(-0.4, 0.5, 0);
camera.add(viewLight);

scene.add(new THREE.HemisphereLight(0xc8d5dc, 0x26221e, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.position.set(-4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
scene.add(sun);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = FIXED_DT;
world.numSolverIterations = 12;
const groundBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.12, 0),
);
world.createCollider(
  RAPIER.ColliderDesc.cuboid(20, 0.12, 20).setFriction(1.0),
  groundBody,
);
const ground = new THREE.Mesh(
  new THREE.BoxGeometry(40, 0.24, 40),
  new THREE.MeshStandardMaterial({ color: 0x24282a, roughness: 0.96 }),
);
ground.position.y = -0.12;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(40, 40, 0x3b4144, 0x292e30);
grid.position.y = 0.005;
scene.add(grid);

function addCover(x, y, z, sx, sy, sz, color = 0x34393b) {
  const rb = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setFriction(0.9),
    rb,
  );
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { rb, mesh };
}

addCover(-3, 0.75, -2, 2.4, 1.5, 0.55);
addCover(3, 0.55, -3, 1.6, 1.1, 1.2);
// Close obstacles for genuine hand/shoulder bracing tests without cluttering the shooting lane.
addCover(-1.45, 0.9, -0.45, 0.16, 1.8, 1.8, 0x303537);
addCover(1.35, 0.42, 0.55, 0.65, 0.84, 0.65, 0x303537);

const blood = new BloodSystem(scene, {
  groundY: 0.012,
  maxDroplets: 320,
  maxStreams: 150,
  maxPools: 90,
  maxSmears: 120,
  maxSplats: 180,
});

let human = new EuphoriaHuman(world, scene, 0, 0);
const controls = new PointerLockControls(camera, document.body);
const keys = new Set();
const moveForward = new THREE.Vector3();
const moveRight = new THREE.Vector3();
let aiming = false;
let lastShot = 0;
let recoil = 0;
let hitTimer = null;
let accumulator = 0;
let last = performance.now();
let testPaused = false;

const gun = new THREE.Group();
camera.add(gun);
gun.position.set(0.25, -0.22, -0.48);
const gunMat = new THREE.MeshStandardMaterial({
  color: 0x465053,
  roughness: 0.55,
  metalness: 0.25,
});
const polymer = new THREE.MeshStandardMaterial({ color: 0x333b3d, roughness: 0.8 });
function gunBox(size, position, material = gunMat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  gun.add(mesh);
  return mesh;
}
const receiver = gunBox([0.12, 0.12, 0.48], [0, 0, -0.18]);
const barrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.018, 0.018, 0.52, 12),
  gunMat,
);
barrel.rotation.x = Math.PI / 2;
barrel.position.set(0, 0.015, -0.63);
gun.add(barrel);
gunBox([0.11, 0.15, 0.28], [0, -0.03, 0.16]).rotation.x = -0.1;
gunBox([0.075, 0.2, 0.09], [0.01, -0.14, -0.05]).rotation.x = -0.3;
gunBox([0.085, 0.22, 0.13], [0, -0.17, -0.28], polymer).rotation.x = 0.14;
gunBox([0.115, 0.09, 0.26], [0, 0.012, -0.48], polymer);
gunBox([0.04, 0.055, 0.05], [0, 0.086, 0.01]);
gunBox([0.012, 0.07, 0.025], [0, 0.094, -0.52]);
for (let i = 0; i < 6; i++)
  gunBox([0.12, 0.012, 0.018], [0, 0.068, -0.36 - i * 0.038]);
const muzzle = new THREE.PointLight(0xffb873, 0, 2);
muzzle.position.set(0, 0, -0.92);
gun.add(muzzle);
void receiver;

const rayDir = new THREE.Vector3();
const rayOrigin = new THREE.Vector3();
const tracerMat = new THREE.LineBasicMaterial({
  color: 0xffd7a0,
  transparent: true,
  opacity: 0.85,
});

function flashHitMarker() {
  document.body.classList.add("hit");
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => document.body.classList.remove("hit"), 110);
}

function addTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const line = new THREE.Line(geo, tracerMat.clone());
  scene.add(line);
  setTimeout(() => {
    scene.remove(line);
    geo.dispose();
    line.material.dispose();
  }, 45);
}

function damageAt(partName, direction, strength, point) {
  const event = human.hit(partName, direction, strength, point);
  blood.impact({
    human,
    part: partName,
    position: point,
    direction,
    strength,
    fatal: human.dead,
  });
  return event;
}

function fire() {
  const now = performance.now();
  if (!controls.isLocked || now - lastShot < 105) return;
  lastShot = now;
  camera.getWorldPosition(rayOrigin);
  camera.getWorldDirection(rayDir);
  rayDir.x += (Math.random() - 0.5) * (aiming ? 0.0015 : 0.005);
  rayDir.y += (Math.random() - 0.5) * (aiming ? 0.0015 : 0.005);
  rayDir.z += (Math.random() - 0.5) * (aiming ? 0.0015 : 0.005);
  rayDir.normalize();

  const hit = world.castRay(new RAPIER.Ray(rayOrigin, rayDir), 60, true);
  let end = rayOrigin.clone().addScaledVector(rayDir, 60);
  if (hit) {
    end = rayOrigin.clone().addScaledVector(rayDir, hit.timeOfImpact);
    for (const [name, part] of human.parts) {
      if (part.collider.handle !== hit.collider.handle) continue;
      damageAt(name, rayDir, 18, end);
      flashHitMarker();
      break;
    }
  }
  addTracer(rayOrigin, end);
  recoil = Math.min(0.16, recoil + (aiming ? 0.035 : 0.07));
  muzzle.intensity = 8;
  setTimeout(() => (muzzle.intensity = 0), 28);
}

function reset() {
  blood.removeHuman(human);
  human.destroy();
  human = new EuphoriaHuman(world, scene, 0, 0);
  accumulator = 0;
  last = performance.now();
}

function simulateStep() {
  human.update(FIXED_DT);
  world.step();
}

function advance(seconds, updateBlood = true) {
  const steps = Math.max(0, Math.round(seconds / FIXED_DT));
  for (let i = 0; i < steps; i++) {
    simulateStep();
    if (updateBlood) blood.update(FIXED_DT);
  }
  human.sync();
  renderer.render(scene, camera);
  return steps * FIXED_DT;
}

function render() {
  human.sync();
  renderer.render(scene, camera);
}

document.addEventListener("pointerdown", (event) => {
  if (!controls.isLocked) {
    if (event.button === 0) controls.lock();
    return;
  }
  if (event.button === 0) fire();
  if (event.button === 2) aiming = true;
});
document.addEventListener("pointerup", (event) => {
  if (event.button === 2) aiming = false;
});
document.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "Escape") controls.unlock();
  if (event.code === "KeyR" && !event.repeat) reset();
  if (event.code === "KeyK" && !event.repeat) blood.clear();
});
document.addEventListener("keyup", (event) => keys.delete(event.code));

const status = document.getElementById("status");
controls.addEventListener("lock", () => {
  status.textContent = "LMB SHOOT · RMB AIM · WASD MOVE · R RESET · K CLEAN BLOOD · F3 PHYSICS";
});
controls.addEventListener("unlock", () => {
  status.textContent = "CLICK TO ENTER";
  keys.clear();
  aiming = false;
});

function updateCameraMovement(dt) {
  if (!controls.isLocked) return;
  camera.getWorldDirection(moveForward);
  moveForward.y = 0;
  if (moveForward.lengthSq() > 1e-8) moveForward.normalize();
  moveRight.set(-moveForward.z, 0, moveForward.x);
  let x = 0;
  let z = 0;
  if (keys.has("KeyW")) { x += moveForward.x; z += moveForward.z; }
  if (keys.has("KeyS")) { x -= moveForward.x; z -= moveForward.z; }
  if (keys.has("KeyA")) { x -= moveRight.x; z -= moveRight.z; }
  if (keys.has("KeyD")) { x += moveRight.x; z += moveRight.z; }
  const len = Math.hypot(x, z);
  if (len > 0) {
    camera.position.x += (x / len) * dt * 3.2;
    camera.position.z += (z / len) * dt * 3.2;
  }
  camera.position.y = 1.68;
}

function updateWeapon(dt) {
  recoil = THREE.MathUtils.lerp(recoil, 0, 1 - Math.exp(-dt * 16));
  camera.fov = THREE.MathUtils.lerp(camera.fov, aiming ? 68 : 82, 1 - Math.exp(-dt * 12));
  camera.updateProjectionMatrix();
  gun.position.x = THREE.MathUtils.lerp(gun.position.x, aiming ? 0.02 : 0.25, 1 - Math.exp(-dt * 14));
  gun.position.y = THREE.MathUtils.lerp(gun.position.y, aiming ? -0.105 : -0.22, 1 - Math.exp(-dt * 14));
  gun.position.z = THREE.MathUtils.lerp(gun.position.z, -0.48 + recoil * 0.16, 1 - Math.exp(-dt * 18));
  gun.rotation.x = -recoil * 0.65;
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  updateCameraMovement(dt);
  if (!testPaused) {
    accumulator = Math.min(accumulator + dt, 0.05);
    while (accumulator >= FIXED_DT) {
      simulateStep();
      accumulator -= FIXED_DT;
    }
    blood.update(dt);
  }
  human.sync();
  updateWeapon(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});
addEventListener("blur", () => {
  keys.clear();
  aiming = false;
});
document.addEventListener("visibilitychange", () => {
  last = performance.now();
  accumulator = 0;
  keys.clear();
  aiming = false;
});

function partSnapshot() {
  return Object.fromEntries(
    [...human.parts].map(([name, { rb }]) => [
      name,
      {
        position: { ...rb.translation() },
        velocity: { ...rb.linvel() },
        angularVelocity: { ...rb.angvel() },
        rotation: { ...rb.rotation() },
      },
    ]),
  );
}

function snapshot() {
  return {
    controllerStyle: human.controllerStyle,
    state: human.state,
    history: [...human.history],
    step: {
      phase: human.step.phase,
      side: human.step.side,
      time: human.step.time,
      cooldown: human.step.cooldown,
      urgency: human.step.urgency,
      target: { ...human.step.target },
    },
    metrics: { ...human.metrics },
    injury: { ...human.injury },
    physiology: human.physiology?.snapshot?.() ?? null,
    behavior: human.behaviorSnapshot?.() ?? null,
    balance: human.balanceSnapshot?.() ?? null,
    reaction: human.reactionSnapshot?.() ?? null,
    controlDrive: human.controlDrive?.() ?? null,
    passiveHandoff: !!human.passiveHandoff,
    feet: {
      L: { quality: human.feet?.L?.quality ?? 0, anchor: { ...human.feet?.L?.anchor } },
      R: { quality: human.feet?.R?.quality ?? 0, anchor: { ...human.feet?.R?.anchor } },
    },
    blood: blood.stats(),
    dead: human.dead,
    parts: partSnapshot(),
  };
}

if (TEST_MODE) {
  window.lab = {
    get human() { return human; },
    world,
    scene,
    camera,
    renderer,
    reset,
    render,
    snapshot,
    bloodStats: () => blood.stats(),
    clearBlood: () => blood.clear(),
    pausePhysics(paused = true) {
      testPaused = !!paused;
      accumulator = 0;
      last = performance.now();
      return testPaused;
    },
    advance(seconds) {
      testPaused = true;
      return advance(seconds, true);
    },
    setGunVisible(visible) {
      gun.visible = !!visible;
      render();
    },
    setView(position, target, fov = 46) {
      camera.position.set(position.x, position.y, position.z);
      camera.fov = fov;
      camera.updateProjectionMatrix();
      camera.lookAt(target.x, target.y, target.z);
      render();
    },
    aimAt(name) {
      const p = human.body(name).translation();
      camera.lookAt(p.x, p.y, p.z);
      render();
    },
    shoot(name, strength = 12, dir = { x: 0, y: 0, z: -1 }, offset = null) {
      const rb = human.body(name);
      const base = rb.translation();
      const point = offset
        ? { x: base.x + (offset.x || 0), y: base.y + (offset.y || 0), z: base.z + (offset.z || 0) }
        : base;
      return damageAt(name, dir, strength, point);
    },
    impulse(name, impulse, offset = null) {
      const rb = human.body(name);
      const base = rb.translation();
      const point = offset
        ? { x: base.x + (offset.x || 0), y: base.y + (offset.y || 0), z: base.z + (offset.z || 0) }
        : base;
      rb.applyImpulseAtPoint(impulse, point, true);
    },
  };
}
