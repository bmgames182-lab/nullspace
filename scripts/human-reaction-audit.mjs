import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = new URL("../test-results/human-reaction-audit/", import.meta.url);
await mkdir(root, { recursive: true });

const server = spawn(
  process.execPath,
  [new URL("./serve.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  { env: { ...process.env, PORT: "8003" }, stdio: "pipe" },
);

const frames = [
  { id: "0100", elapsed: 0.10 },
  { id: "0450", elapsed: 0.45 },
  { id: "0800", elapsed: 0.80 },
  { id: "1600", elapsed: 1.60 },
  { id: "2800", elapsed: 2.80 },
  { id: "4200", elapsed: 4.20 },
  { id: "5200", elapsed: 5.20 },
  { id: "6400", elapsed: 6.40 },
];

async function waitForSimAge(page, targetAge) {
  await page.waitForFunction(
    (target) => window.lab?.human?.age >= target,
    targetAge,
    { timeout: 30000 },
  );
}

async function capture(page) {
  return page.evaluate(() => {
    const h = lab.human;
    const wound = h.woundWorld?.() ?? null;
    const dist = (name) => {
      if (!wound || !h.body(name)) return null;
      const p = h.body(name).translation();
      return Math.hypot(p.x - wound.x, p.y - wound.y, p.z - wound.z);
    };
    return {
      age: h.age,
      state: h.state,
      controllerStyle: h.controllerStyle,
      reaction: h.reactionSnapshot?.() ?? h.hitReaction?.snapshot?.() ?? null,
      behavior: h.behaviorSnapshot?.() ?? null,
      physiology: h.physiology?.snapshot?.() ?? null,
      directedSteps: h.directedSteps ?? 0,
      passiveHandoff: h.passiveHandoff ?? false,
      handDistanceL: dist("handL"),
      handDistanceR: dist("handR"),
      pelvisY: h.body("pelvis")?.translation().y ?? null,
      chestY: h.body("chest")?.translation().y ?? null,
      dead: h.dead,
    };
  });
}

function nearestHand(sample) {
  return Math.min(sample.handDistanceL ?? Infinity, sample.handDistanceR ?? Infinity);
}

let browser;
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => reject(Error("server exit " + code)));
  });

  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32"
      ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" }
      : {}),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let seed = 0x54a91b37;
    Math.random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });

  await page.goto("http://127.0.0.1:8003/?test");
  await page.waitForFunction(() => window.lab?.human?.age > 2 && lab.human.state === "balance");
  await page.evaluate(() => {
    lab.clearBlood();
    const chest = lab.human.body("chest").translation();
    lab.camera.position.set(2.05, 1.45, 2.65);
    lab.camera.fov = 43;
    lab.camera.lookAt(chest.x, 1.02, chest.z);
    lab.camera.updateProjectionMatrix();
    for (const child of lab.camera.children) if (child.type === "Group") child.visible = false;
  });

  const before = await page.evaluate(() => {
    const h = lab.human;
    const chest = h.body("chest").translation();
    const distance = (name) => {
      const p = h.body(name).translation();
      return Math.hypot(p.x - chest.x, p.y - chest.y, p.z - chest.z);
    };
    return { left: distance("handL"), right: distance("handR") };
  });

  await page.evaluate(() => lab.shoot("chest", 18, { x: 0, y: 0, z: -1 }));
  const startAge = await page.evaluate(() => lab.human.age);
  const samples = [];

  for (const frame of frames) {
    await waitForSimAge(page, startAge + frame.elapsed);
    const sample = await capture(page);
    samples.push({ frame: frame.id, elapsed: frame.elapsed, ...sample });
    await page.screenshot({
      path: new URL(`chest-${frame.id}.png`, root).pathname.replace(/^\/(\w:)/, "$1"),
    });
  }

  const at = (id) => samples.find((sample) => sample.frame === id);
  const s450 = at("0450");
  const s800 = at("0800");
  const s1600 = at("1600");
  const s2800 = at("2800");
  const s4200 = at("4200");
  const s5200 = at("5200");
  const s6400 = at("6400");
  const initialNearest = Math.min(before.left, before.right);

  assert.ok(nearestHand(s450) < initialNearest - 0.08, "chest shot should cause an immediate visible hand-to-wound reach");
  assert.ok(nearestHand(s800) < initialNearest - 0.12, "chest clutch should strengthen rather than fade immediately");
  assert.ok(["clutch", "panic"].includes(s800.reaction?.phase), `0.8s should still be clutch/panic, got ${s800.reaction?.phase}`);
  assert.ok(s1600.directedSteps >= 1, "panic phase should physically move the feet");
  assert.equal(s1600.reaction?.finalRagdoll, false, "panic must not be a disguised ragdoll");
  assert.ok(["kneel", "failing", "panic"].includes(s2800.reaction?.phase), `2.8s should be a hurt active phase, got ${s2800.reaction?.phase}`);
  assert.equal(s2800.physiology?.unconscious, false, "pain sequence should remain conscious before any physiological failure");
  assert.ok(["kneel", "failing", "grounded"].includes(s4200.reaction?.phase), `4.2s should be kneeling/failing/grounded, got ${s4200.reaction?.phase}`);
  assert.ok(["failing", "grounded", "ragdoll"].includes(s5200.reaction?.phase), `5.2s should be late pain-collapse sequence, got ${s5200.reaction?.phase}`);
  assert.equal(s6400.passiveHandoff, true, "strong chest sequence should only become passive after the readable coping sequence");
  assert.equal(s6400.reaction?.phase, "ragdoll", "late sandbox handoff should be one-way once it finally happens");
  assert.deepEqual(errors, []);

  await writeFile(
    new URL("report.json", root),
    JSON.stringify({ generatedAt: new Date().toISOString(), before, samples, errors }, null, 2),
  );
  console.log("Human reaction audit passed: chest hit visibly progresses through clutch, panic movement, pain-kneel/ground coping, then delayed passive handoff.");
} finally {
  await browser?.close();
  server.kill();
}
