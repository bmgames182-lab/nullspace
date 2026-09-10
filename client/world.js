import * as THREE from "three";

export const WORLD = Object.freeze({
  KEYCARD: new THREE.Vector3(-16, 0, 14),
  TERMINAL: new THREE.Vector3(14, 0, 13),
  GATE: new THREE.Vector3(17, 0, -14),
  SEAL: new THREE.Vector3(12.5, 0, -14),
  ARMORY: new THREE.Vector3(-17, 0, -4),
  MED: new THREE.Vector3(4, 0, -17),
  HUMAN_SPAWN: new THREE.Vector3(-14, 0, -14),
  ANOMALY_SPAWN: new THREE.Vector3(14, 0, 14)
});

function seeded(text) {
  let s = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    s ^= text.charCodeAt(i);
    s = Math.imul(s, 16777619);
  }
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(draw, size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d", { alpha: false });
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function concreteTexture(rand, base, seam) {
  return canvasTexture((ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, "rgba(255,255,255,.07)");
    g.addColorStop(.55, "rgba(0,0,0,.015)");
    g.addColorStop(1, "rgba(0,0,0,.12)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 420; i++) {
      const bright = rand() > .56;
      const v = bright ? 235 : 22;
      ctx.fillStyle = `rgba(${v},${v},${v},${.018 + rand() * .05})`;
      ctx.fillRect(rand() * s, rand() * s, 1 + rand() * 5, 1 + rand() * 2);
    }
    ctx.strokeStyle = seam;
    ctx.globalAlpha = .26;
    ctx.lineWidth = 2;
    for (let y = 0; y <= s; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

function floorTexture(rand) {
  return canvasTexture((ctx, s) => {
    ctx.fillStyle = "#59615c";
    ctx.fillRect(0, 0, s, s);
    const tile = 32;
    for (let y = 0; y < s; y += tile) {
      for (let x = 0; x < s; x += tile) {
        const shade = 71 + Math.floor(rand() * 13);
        ctx.fillStyle = `rgb(${shade},${shade + 7},${shade + 3})`;
        ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);
      }
    }
    ctx.strokeStyle = "rgba(12,18,15,.48)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= s; i += tile) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
    }
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(8,12,10,${.02 + rand() * .06})`;
      ctx.fillRect(rand() * s, rand() * s, 1 + rand() * 7, 1 + rand() * 2);
    }
  });
}

function hazardTexture() {
  return canvasTexture((ctx, s) => {
    ctx.fillStyle = "#161a17";
    ctx.fillRect(0, 0, s, s);
    ctx.save();
    ctx.translate(-s * .25, 0);
    ctx.rotate(-Math.PI / 4);
    for (let x = -s; x < s * 2; x += 44) {
      ctx.fillStyle = "#d0ae47";
      ctx.fillRect(x, -s, 20, s * 3);
    }
    ctx.restore();
  });
}

function makeSign(text, accent) {
  const c = document.createElement("canvas");
  c.width = 768;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#08100d";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(5, 5, c.width - 10, c.height - 10);
  ctx.fillStyle = "#dce7e1";
  ctx.font = "700 42px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false
  }));
}

export function createWorld(scene, seed = "NULL") {
  const rand = seeded(seed);
  const colliders = [];
  const objects = {};
  const flickers = [];
  const geometryCache = new Map();

  scene.background = new THREE.Color(0x0b100e);
  scene.fog = new THREE.FogExp2(0x111914, .0145);

  const wallTex = concreteTexture(rand, "#69736d", "#3a433e");
  wallTex.repeat.set(2.2, 1.15);
  const floorTex = floorTexture(rand);
  floorTex.repeat.set(7, 7);
  const hazardTex = hazardTexture();
  hazardTex.repeat.set(3, 1);

  // Cheap materials for the huge static surfaces; Standard only where metal/emissive matters.
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, color: 0xc6d0ca });
  const lowerWallMat = new THREE.MeshLambertMaterial({ color: 0x4e5b55 });
  const floorMat = new THREE.MeshLambertMaterial({ map: floorTex, color: 0xa2aaa6 });
  const ceilingMat = new THREE.MeshLambertMaterial({ color: 0x46514c });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a4540, roughness: .48, metalness: .52 });
  const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x171d1a, roughness: .64, metalness: .48 });
  const blackMat = new THREE.MeshLambertMaterial({ color: 0x151a17 });
  const hazardMat = new THREE.MeshBasicMaterial({ map: hazardTex });
  const amber = new THREE.MeshBasicMaterial({ color: 0xc0a048 });
  const green = new THREE.MeshBasicMaterial({ color: 0x739d88 });
  const red = new THREE.MeshBasicMaterial({ color: 0x91423d });

  scene.add(new THREE.HemisphereLight(0xcbe0d5, 0x18211b, 1.22));
  scene.add(new THREE.AmbientLight(0x80958a, .62));

  function geo(w, h, d) {
    const key = `${w}|${h}|${d}`;
    let g = geometryCache.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      geometryCache.set(key, g);
    }
    return g;
  }

  function box(x, y, z, w, h, d, mat, collide = false) {
    const m = new THREE.Mesh(geo(w, h, d), mat);
    m.position.set(x, y, z);
    scene.add(m);
    if (collide) colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minZ: z - d / 2, maxZ: z + d / 2
    });
    return m;
  }

  function sign(x, y, z, text, accent, width = 4.3) {
    const s = makeSign(text, accent);
    s.scale.set(width, width / 6, 1);
    s.position.set(x, y, z);
    scene.add(s);
    return s;
  }

  function beacon(x, y, z, color, intensity = 10, distance = 4.5) {
    const l = new THREE.PointLight(color, intensity, distance, 2);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  }

  box(0, -.09, 0, 42, .18, 42, floorMat);
  box(0, 3.3, 0, 42, .2, 42, ceilingMat);

  const walls = [
    [0,1.55,-20.5,41,3.1,.5],[0,1.55,20.5,41,3.1,.5],[-20.5,1.55,0,.5,3.1,41],[20.5,1.55,0,.5,3.1,41],
    [-10,1.55,-14,.4,3.1,13],[-10,1.55,6,.4,3.1,17],[10,1.55,-6,.4,3.1,28],
    [0,1.55,-8,12,3.1,.4],[-4,1.55,8,12,3.1,.4],[15,1.55,5,10,3.1,.4],
    [-15,1.55,1,10,3.1,.4],[-3,1.55,15,14,3.1,.4],[4,1.55,-15,12,3.1,.4],
    [2,1.55,1,.4,3.1,10],[-4,1.55,-3,.4,3.1,10],[15,1.55,-4,.4,3.1,7],
    [-15,1.55,12,.4,3.1,6],[6,1.55,12,.4,3.1,7]
  ];

  walls.forEach(v => {
    box(...v, wallMat, true);
    const [x,,z,w,,d] = v;
    box(x, .33, z, w + .012, .66, d + .012, lowerWallMat);
  });

  // Structural columns, caps and ceiling beams.
  for (const [x,z] of [[-18,-18],[-2,-18],[18,-18],[-18,18],[18,18],[0,5],[8,-10],[-12,-5]]) {
    box(x, 1.55, z, .68, 3.1, .68, metalMat, true);
    box(x, 2.97, z, 1.08, .13, 1.08, blackMat);
    box(x, .09, z, 1.02, .12, 1.02, darkMetalMat);
  }
  for (let z = -18; z <= 18; z += 6) box(0, 3.08, z, 40, .12, .16, darkMetalMat);

  // Twenty-five visible fixtures in ONE draw call.
  const fixtureGeo = new THREE.BoxGeometry(2.55, .045, .20);
  const fixtureMat = new THREE.MeshBasicMaterial({ color: 0xd8e8df });
  const fixtures = new THREE.InstancedMesh(fixtureGeo, fixtureMat, 25);
  const dummy = new THREE.Object3D();
  let index = 0;
  for (let x = -16; x <= 16; x += 8) {
    for (let z = -16; z <= 16; z += 8) {
      dummy.position.set(x, 3.135, z);
      dummy.updateMatrix();
      fixtures.setMatrixAt(index++, dummy.matrix);
    }
  }
  fixtures.instanceMatrix.needsUpdate = true;
  scene.add(fixtures);

  // Only nine real overhead lights instead of twenty-five.
  const lights = [
    [-16,-16],[0,-16],[16,-16],
    [-16,0],[0,0],[16,0],
    [-16,16],[0,16],[16,16]
  ];
  lights.forEach(([x,z], i) => {
    const broken = i === 5 || i === 7;
    const light = new THREE.PointLight(broken ? 0xb8cdbf : 0xd5e5dc, broken ? 32 : 54, 15, 1.75);
    light.position.set(x, 2.9, z);
    scene.add(light);
    flickers.push({ light, base: light.intensity, phase: rand() * 20, rate: .65 + rand() * 1.35, broken });
  });

  // Wall-mounted pipe clusters for industrial depth.
  const pipeGeo = new THREE.CylinderGeometry(.055, .055, 7.5, 8);
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x5d6963, roughness: .46, metalness: .58 });
  for (const [x,z] of [[-19.45,-8],[-19.45,6],[19.45,-10],[19.45,8]]) {
    const p = new THREE.Mesh(pipeGeo, pipeMat);
    p.rotation.z = Math.PI / 2;
    p.position.set(x, 2.45, z);
    scene.add(p);
    const p2 = p.clone();
    p2.position.y -= .2;
    scene.add(p2);
  }

  // Wayfinding strips stay readable in darker wings.
  for (let x = -18; x <= 18; x += 4) box(x, .012, -17.72, 2.15, .018, .075, amber);
  for (let z = -18; z <= 18; z += 3.2) box(18.08, .014, z, .08, .018, 1.65, red);
  for (let z = -18; z <= 18; z += 3.2) box(-18.08, .014, z, .08, .018, 1.65, green);

  // Security locker.
  objects.armory = box(WORLD.ARMORY.x, 1.0, WORLD.ARMORY.z, 1.0, 2.0, .68, metalMat, true);
  box(WORLD.ARMORY.x, 1.22, WORLD.ARMORY.z - .355, .56, .18, .025, new THREE.MeshBasicMaterial({ color: 0xe2b84f }));
  box(WORLD.ARMORY.x, .25, WORLD.ARMORY.z - .36, .74, .05, .03, hazardMat);
  sign(WORLD.ARMORY.x, 2.3, WORLD.ARMORY.z - .37, "SECURITY LOCKER", "#d2ae58", 3.45);

  // Medical station.
  objects.med = box(WORLD.MED.x, .85, WORLD.MED.z, .92, 1.7, .62, metalMat, true);
  box(WORLD.MED.x, 1.12, WORLD.MED.z - .325, .5, .31, .025, new THREE.MeshBasicMaterial({ color: 0x77d6a5 }));
  beacon(WORLD.MED.x, 1.6, WORLD.MED.z, 0x65b98e, 7, 4);
  sign(WORLD.MED.x, 2.06, WORLD.MED.z - .34, "FIELD MEDICAL", "#8fd2ae", 3.2);

  // Threshold keycard pedestal.
  objects.keycardBase = box(WORLD.KEYCARD.x, .45, WORLD.KEYCARD.z, .86, .9, .86, darkMetalMat, true);
  box(WORLD.KEYCARD.x, .91, WORLD.KEYCARD.z, .64, .05, .64, hazardMat);
  objects.keycard = new THREE.Mesh(
    new THREE.BoxGeometry(.52, .045, .32),
    new THREE.MeshStandardMaterial({ color: 0xe7ca68, emissive: 0x7a5a15, emissiveIntensity: 1.15, metalness: .16, roughness: .32 })
  );
  objects.keycard.position.set(WORLD.KEYCARD.x, 1.08, WORLD.KEYCARD.z);
  scene.add(objects.keycard);
  beacon(WORLD.KEYCARD.x, 1.35, WORLD.KEYCARD.z, 0xdfbd55, 11, 4.5);

  // Threshold terminal.
  objects.terminal = box(WORLD.TERMINAL.x, 1.05, WORLD.TERMINAL.z, 1.0, 2.1, .66, metalMat, true);
  objects.terminalScreen = box(WORLD.TERMINAL.x, 1.45, WORLD.TERMINAL.z - .345, .62, .46, .025,
    new THREE.MeshStandardMaterial({ color: 0x0c1a14, emissive: 0x49b57e, emissiveIntensity: 2.0, roughness: .45 }));
  box(WORLD.TERMINAL.x, .22, WORLD.TERMINAL.z - .35, .76, .055, .03, hazardMat);
  beacon(WORLD.TERMINAL.x, 2.1, WORLD.TERMINAL.z, 0x5fc18d, 9, 5);
  sign(WORLD.TERMINAL.x, 2.42, WORLD.TERMINAL.z - .36, "THRESHOLD CONTROL", "#72cca0", 3.65);

  // Extraction gate and quarantine seal station.
  box(WORLD.GATE.x - 1.85, 1.55, WORLD.GATE.z, .58, 3.1, .7, metalMat, true);
  box(WORLD.GATE.x + 1.85, 1.55, WORLD.GATE.z, .58, 3.1, .7, metalMat, true);
  box(WORLD.GATE.x, 3.02, WORLD.GATE.z, 4.3, .3, .7, metalMat);
  objects.gateDoor = box(WORLD.GATE.x, 1.5, WORLD.GATE.z - .02, 3.12, 2.8, .3, blackMat);
  box(WORLD.GATE.x, .06, WORLD.GATE.z - .28, 3.5, .055, .1, hazardMat);
  beacon(WORLD.GATE.x, 2.2, WORLD.GATE.z, 0xe3bd5a, 11, 5.2);

  objects.seal = box(WORLD.SEAL.x, .85, WORLD.SEAL.z, .78, 1.7, .65, metalMat, true);
  box(WORLD.SEAL.x, 1.2, WORLD.SEAL.z - .34, .5, .29, .025,
    new THREE.MeshStandardMaterial({ color: 0x210b0a, emissive: 0xb83a31, emissiveIntensity: 1.65, roughness: .45 }));

  // Cheap observation glass; transmission/refraction was unnecessarily expensive here.
  const glass = new THREE.MeshStandardMaterial({ color: 0x80a79d, transparent: true, opacity: .18, roughness: .22, depthWrite: false });
  box(10.15, 1.45, 15, .055, 2.5, 6.3, glass, true);
  box(10.08, .18, 15, .16, .18, 6.45, darkMetalMat);
  box(10.08, 2.73, 15, .16, .18, 6.45, darkMetalMat);

  sign(-16, 2.28, -20.15, "SECTOR C // RESEARCH", "#b9d0c4", 4.6);
  sign(10.2, 2.22, 11.58, "ANOMALOUS HOLDING", "#e16f68", 4.25);
  sign(17.6, 2.28, -20.15, "THRESHOLD / EXIT", "#dbc164", 4.1);
  sign(-10.23, 2.22, -12, "DECONTAMINATION", "#8fc7ad", 3.95);

  // Deterministic clutter: everyone sees the same cover and props.
  for (let i = 0; i < 16; i++) {
    const x = -18 + rand() * 36;
    const z = -18 + rand() * 36;
    if (colliders.some(c => x > c.minX - .95 && x < c.maxX + .95 && z > c.minZ - .95 && z < c.maxZ + .95)) continue;
    const h = .38 + rand() * .45;
    const w = .48 + rand() * .55;
    const d = .48 + rand() * .55;
    const crate = box(x, h / 2, z, w, h, d, rand() > .45 ? darkMetalMat : metalMat, true);
    crate.rotation.y = Math.round(rand() * 3) * Math.PI / 2;
  }

  let lastLightUpdate = 0;
  function update(time, round) {
    // Flicker at 12.5 Hz, not every render frame.
    if (time - lastLightUpdate > 80) {
      lastLightUpdate = time;
      for (const f of flickers) {
        const wave = Math.sin(time * .0013 * f.rate + f.phase);
        const dropout = f.broken && Math.sin(time * .021 + f.phase) > .80;
        f.light.intensity = dropout ? 2.5 : f.base * (.96 + wave * .035);
      }
    }

    if (objects.keycard) {
      objects.keycard.visible = !round?.keycardTaken;
      if (objects.keycard.visible) {
        objects.keycard.rotation.y = time * .0011;
        objects.keycard.position.y = 1.08 + Math.sin(time * .0023) * .045;
      }
    }

    if (objects.terminalScreen) {
      objects.terminalScreen.material.emissiveIntensity = 1.85 + Math.sin(time * .003) * .2;
    }

    if (objects.gateDoor) {
      const open = round?.phase === "extraction" || round?.phase === "sealed" || round?.phase === "ended";
      objects.gateDoor.position.y = THREE.MathUtils.lerp(objects.gateDoor.position.y, open ? 3.65 : 1.5, .075);
    }
  }

  return { colliders, objects, update };
}

export function resolveMovement(from, to, colliders, radius = .34) {
  const result = to.clone();
  const testX = new THREE.Vector3(result.x, from.y, from.z);
  if (collides(testX, colliders, radius)) result.x = from.x;
  const testZ = new THREE.Vector3(result.x, from.y, result.z);
  if (collides(testZ, colliders, radius)) result.z = from.z;
  result.x = THREE.MathUtils.clamp(result.x, -19.7, 19.7);
  result.z = THREE.MathUtils.clamp(result.z, -19.7, 19.7);
  return result;
}

function collides(p, colliders, r) {
  return colliders.some(c => p.x + r > c.minX && p.x - r < c.maxX && p.z + r > c.minZ && p.z - r < c.maxZ);
}

export function nearestInteraction(position, round, self) {
  if (!self || self.dead || self.escaped) return null;
  const checks = [];
  if (round?.phase === "active" && self.role !== "anomaly" && !self.weapon && (round.armoryCharges ?? 0) > 0) checks.push({ kind: "armory", label: "OPEN SECURITY LOCKER", pos: WORLD.ARMORY, range: 2 });
  if (round?.phase === "active" && self.hp < self.maxHp && (round.medCharges ?? 0) > 0) checks.push({ kind: "med", label: "USE FIELD MEDICAL", pos: WORLD.MED, range: 2 });
  if (!round?.keycardTaken) checks.push({ kind: "keycard", label: "RECOVER THRESHOLD KEYCARD", pos: WORLD.KEYCARD, range: 1.8 });
  if (round?.keycardTaken && round?.phase === "active") checks.push({ kind: "terminal", label: "INITIATE THRESHOLD EXTRACTION", pos: WORLD.TERMINAL, range: 2 });
  if (round?.phase === "extraction") {
    checks.push({ kind: "extract", label: "CROSS THRESHOLD", pos: WORLD.GATE, range: 2.4 });
    if (self.role === "quarantine" || self.role === "security") checks.push({ kind: "seal", label: "SEAL THRESHOLD", pos: WORLD.SEAL, range: 2 });
  }

  let best = null;
  let bestD = 999;
  for (const c of checks) {
    const d = position.distanceTo(c.pos);
    if (d < c.range && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
