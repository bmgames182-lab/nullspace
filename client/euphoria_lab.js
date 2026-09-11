import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import RAPIER from "@dimforge/rapier3d-compat";

import { ArtagdollHuman } from "./artagdoll_human.js";
import { BloodSystem } from "./blood_fx.js";
await RAPIER.init();

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
const camera = new THREE.PerspectiveCamera(
  82,
  innerWidth / innerHeight,
  0.03,
  120,
);
camera.position.set(0, 1.68, 3.6);
camera.lookAt(0, 1.25, 0);
scene.add(camera);
const viewLight = new THREE.PointLight(0xcbdbe4, 1.2, 3);
viewLight.position.set(-0.4, 0.5, 0);
camera.add(viewLight);

const hemi = new THREE.HemisphereLight(0xc8d5dc, 0x26221e, 1.7);
scene.add(hemi);
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
world.timestep = 1 / 240;
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
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
}
addCover(-3, 0.75, -2, 2.4, 1.5, 0.55);
addCover(3, 0.55, -3, 1.6, 1.1, 1.2);

const blood = new BloodSystem(scene, {
  groundY: 0.012,
  maxDroplets: 320,
  maxStreams: 150,
  maxPools: 90,
  maxSmears: 120,
  maxSplats: 180,
});

const v0 = new THREE.Vector3(),
  v1 = new THREE.Vector3();

let human = new ArtagdollHuman(world, scene, 0, 0);
const controls = new PointerLockControls(camera, document.body);
const keys = new Set();
let aiming = false,
  lastShot = 0,
  recoil = 0,
  hitTimer;

const gun = new THREE.Group();
camera.add(gun);
gun.position.set(0.25, -0.22, -0.48);
const polymer = new THREE.MeshStandardMaterial({
  color: 0x333b3d,
  roughness: 0.8,
});
function gunBox(size, position, material = gunMat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  gun.add(mesh);
  return mesh;
}
const gunMat = new THREE.MeshStandardMaterial({
  color: 0x465053,
  roughness: 0.55,
  metalness: 0.25,
});
const receiver = new THREE.Mesh(
  new THREE.BoxGeometry(0.12, 0.12, 0.48),
  gunMat,
);
receiver.position.z = -0.18;
gun.add(receiver);
const barrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.018, 0.018, 0.52, 12),
  gunMat,
);
barrel.rotation.x = Math.PI / 2;
barrel.position.set(0, 0.015, -0.63);
gun.add(barrel);
const stock = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, 0.28), gunMat);
stock.position.set(0, -0.03, 0.16);
stock.rotation.x = -0.1;
gun.add(stock);
const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.2, 0.09), gunMat);
grip.position.set(0.01, -0.14, -0.05);
grip.rotation.x = -0.3;
gun.add(grip);
gunBox([0.085, 0.22, 0.13], [0, -0.17, -0.28], polymer).rotation.x = 0.14;
gunBox([0.115, 0.09, 0.26], [0, 0.012, -0.48], polymer);
gunBox([0.04, 0.055, 0.05], [0, 0.086, 0.01]);
gunBox([0.012, 0.07, 0.025], [0, 0.094, -0.52]);
for (let i = 0; i < 6; i++)
  gunBox([0.12, 0.012, 0.018], [0, 0.068, -0.36 - i * 0.038]);
const muzzle = new THREE.PointLight(0xffb873, 0, 2);
muzzle.position.set(0, 0, -0.92);
gun.add(muzzle);

const rayDir = new THREE.Vector3(),
  rayOrigin = new THREE.Vector3();
const tracerMat = new THREE.LineBasicMaterial({
  color: 0xffd7a0,
  transparent: true,
  opacity: 0.85,
});
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
      if (part.collider.handle === hit.collider.handle) {
        human.hit(name, rayDir, 18, end);
        blood.impact({
          human,
          part: name,
          position: end,
          direction: rayDir,
          strength: 18,
          fatal: human.dead,
        });
        document.body.classList.add("hit");
        clearTimeout(hitTimer);
        hitTimer = setTimeout(() => document.body.classList.remove("hit"), 110);
        break;
      }
    }
  }
  const geo = new THREE.BufferGeometry().setFromPoints([
    rayOrigin.clone(),
    end,
  ]);
  const line = new THREE.Line(geo, tracerMat.clone());
  scene.add(line);
  setTimeout(() => {
    scene.remove(line);
    geo.dispose();
    line.material.dispose();
  }, 45);
  recoil = Math.min(0.16, recoil + (aiming ? 0.035 : 0.07));
  muzzle.intensity = 8;
  setTimeout(() => (muzzle.intensity = 0), 28);
}

function reset() {
  blood.removeHuman(human);
  human.destroy();
  human = new ArtagdollHuman(world, scene, 0, 0);
  accumulator = 0;
}

document.addEventListener("pointerdown", (e) => {
  if (!controls.isLocked) {
    if (e.button === 0) controls.lock();
    return;
  }
  if (e.button === 0) fire();
  if (e.button === 2) aiming = true;
});
document.addEventListener("pointerup", (e) => {
  if (e.button === 2) aiming = false;
});
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "Escape") controls.unlock();
  if (e.code === "KeyR" && !e.repeat) reset();
  if (e.code === "KeyK" && !e.repeat) blood.clear();
});
document.addEventListener("keyup", (e) => keys.delete(e.code));

const status = document.getElementById("status");
controls.addEventListener(
  "lock",
  () =>
    (status.textContent =
      "LMB SHOOT · RMB AIM · WASD MOVE · R RESET · K CLEAN BLOOD"),
);
controls.addEventListener("unlock", () => {
  status.textContent = "CLICK TO ENTER";
  keys.clear();
  aiming = false;
});

const FIXED_DT = 1 / 240;
let accumulator = 0;
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  const step = dt * 3.2;
  if (controls.isLocked) {
    camera.getWorldDirection(v0);
    v0.y = 0;
    v0.normalize();
    v1.set(-v0.z, 0, v0.x);
    let mx = 0,
      mz = 0;
    if (keys.has("KeyW")) {
      mx += v0.x;
      mz += v0.z;
    }
    if (keys.has("KeyS")) {
      mx -= v0.x;
      mz -= v0.z;
    }
    if (keys.has("KeyA")) {
      mx -= v1.x;
      mz -= v1.z;
    }
    if (keys.has("KeyD")) {
      mx += v1.x;
      mz += v1.z;
    }
    const len = Math.hypot(mx, mz);
    if (len) {
      camera.position.x += (mx / len) * step;
      camera.position.z += (mz / len) * step;
    }
    camera.position.y = 1.68;
  }
  accumulator = Math.min(accumulator + dt, 0.05);
  while (accumulator >= FIXED_DT) {
    human.update(FIXED_DT);
    world.step();
    accumulator -= FIXED_DT;
  }
  human.sync();
  blood.update(dt);
  recoil = THREE.MathUtils.lerp(recoil, 0, 1 - Math.exp(-dt * 16));
  camera.fov = THREE.MathUtils.lerp(
    camera.fov,
    aiming ? 68 : 82,
    1 - Math.exp(-dt * 12),
  );
  camera.updateProjectionMatrix();
  gun.position.x = THREE.MathUtils.lerp(
    gun.position.x,
    aiming ? 0.02 : 0.25,
    1 - Math.exp(-dt * 14),
  );
  gun.position.y = THREE.MathUtils.lerp(
    gun.position.y,
    aiming ? -0.105 : -0.22,
    1 - Math.exp(-dt * 14),
  );
  gun.position.z = THREE.MathUtils.lerp(
    gun.position.z,
    -0.48 + recoil * 0.16,
    1 - Math.exp(-dt * 18),
  );
  gun.rotation.x = -recoil * 0.65;
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
// Explicit local test interface; absent in normal play.
if (new URLSearchParams(location.search).has("test"))
  window.lab = {
    get human() {
      return human;
    },
    world,
    camera,
    reset,
    bloodStats() {
      return blood.stats();
    },
    clearBlood() {
      blood.clear();
    },
    aimAt(name) {
      const p = human.body(name).translation();
      camera.lookAt(p.x, p.y, p.z);
    },
    shoot(name, strength = 12, dir = { x: 0, y: 0, z: -1 }) {
      const rb = human.body(name);
      const point = rb.translation();
      human.hit(name, dir, strength, point);
      blood.impact({
        human,
        part: name,
        position: point,
        direction: dir,
        strength,
        fatal: human.dead,
      });
    },
    snapshot() {
      return {
        controllerStyle: human.controllerStyle,
        state: human.state,
        history: human.history,
        step: { ...human.step },
        metrics: { ...human.metrics },
        injury: { ...human.injury },
        blood: blood.stats(),
        reaction: human.reaction
          ? {
              age: human.reaction.age,
              strength: human.reaction.strength,
              part: human.reaction.part,
              headStun: human.reaction.headStun,
            }
          : null,
        dead: human.dead,
        parts: Object.fromEntries(
          [...human.parts].map(([name, { rb }]) => [
            name,
            {
              position: rb.translation(),
              velocity: rb.linvel(),
              rotation: rb.rotation(),
            },
          ]),
        ),
      };
    },
  };
