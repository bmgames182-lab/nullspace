import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = new URL("../test-results/visual-audit-v3/", import.meta.url);
await mkdir(root, { recursive: true });
const server = spawn(
  process.execPath,
  [new URL("./serve.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  { env: { ...process.env, PORT: "8004" }, stdio: "pipe" },
);

const scenarios = [
  { id: "chest-front", part: "chest", strength: 18, dir: { x: 0, y: 0, z: -1 }, offset: { x: 0.07, y: 0.04, z: 0.11 } },
  { id: "chest-back", part: "chest", strength: 18, dir: { x: 0, y: 0, z: 1 }, offset: { x: -0.06, y: 0.03, z: -0.11 } },
  { id: "chest-left", part: "chest", strength: 18, dir: { x: 1, y: 0, z: 0 }, offset: { x: -0.18, y: 0.05, z: 0.03 } },
  { id: "chest-right", part: "chest", strength: 18, dir: { x: -1, y: 0, z: 0 }, offset: { x: 0.18, y: 0.04, z: -0.02 } },
  { id: "head-front", part: "head", strength: 14, dir: { x: 0, y: 0, z: -1 }, offset: { x: 0.04, y: 0.03, z: 0.11 } },
  { id: "thigh-left", part: "thighL", strength: 18, dir: { x: 0, y: 0, z: -1 }, offset: { x: 0, y: 0.05, z: 0.06 } },
  { id: "shin-left", part: "shinL", strength: 18, dir: { x: 0, y: 0, z: -1 }, offset: { x: 0, y: 0.03, z: 0.05 } },
  { id: "arm-right", part: "upperArmR", strength: 18, dir: { x: 0, y: 0, z: -1 }, offset: { x: 0.02, y: 0.05, z: 0.04 } },
  { id: "repeated-light-chest", part: "chest", strength: 8, dir: { x: 0, y: 0, z: -1 }, offset: { x: 0.05, y: 0.02, z: 0.1 }, repeatAt: [0.14, 0.28] },
];
const checkpoints = [0, 0.1, 0.18, 0.36, 0.7, 1.2, 2.2, 3.5];
const screenshotTimes = new Set([0, 0.1, 0.36, 0.7, 1.2, 2.2, 3.5]);
const idFor = (seconds) => String(Math.round(seconds * 1000)).padStart(4, "0");

const position = (snapshot, name) => snapshot.parts[name].position;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function settle(page) {
  await page.evaluate(() => {
    lab.pausePhysics(true);
    lab.advance(2.4);
  });
  const s = await page.evaluate(() => lab.snapshot());
  assert.equal(s.controllerStyle, "euphoria-human-v2-clean-physics");
  assert.ok(s.parts.pelvis.position.y > 0.78, `failed to settle (${s.parts.pelvis.position.y})`);
  return s;
}

async function resetScenario(page) {
  await page.evaluate(() => {
    lab.clearBlood();
    lab.reset();
    lab.pausePhysics(true);
    lab.advance(2.4);
    lab.setGunVisible(false);
    lab.setView({ x: 2.25, y: 1.5, z: 2.95 }, { x: 0, y: 1.03, z: 0 }, 45);
  });
  return page.evaluate(() => lab.snapshot());
}

async function shoot(page, scenario) {
  return page.evaluate(
    ({ part, strength, dir, offset }) => lab.shoot(part, strength, dir, offset),
    scenario,
  );
}

async function capture(page, scenario, elapsed) {
  const snapshot = await page.evaluate(() => lab.snapshot());
  if (screenshotTimes.has(elapsed)) {
    await page.screenshot({
      path: new URL(`${scenario.id}-${idFor(elapsed)}.png`, root).pathname.replace(/^\/(\w:)/, "$1"),
    });
  }
  return { targetElapsed: elapsed, snapshot };
}

function assertFinite(id, snap) {
  for (const [name, part] of Object.entries(snap.parts)) {
    const nums = [
      part.position.x, part.position.y, part.position.z,
      part.velocity.x, part.velocity.y, part.velocity.z,
      part.angularVelocity.x, part.angularVelocity.y, part.angularVelocity.z,
    ];
    assert.ok(nums.every(Number.isFinite), `${id}: ${name} became non-finite`);
    assert.ok(Math.hypot(part.velocity.x, part.velocity.y, part.velocity.z) < 15, `${id}: ${name} numerically launched`);
  }
  assert.ok(snap.parts.pelvis.position.y > -0.04, `${id}: pelvis tunneled below ground`);
}

function sample(entry, t) {
  return entry.samples.find((x) => x.targetElapsed === t).snapshot;
}

function assertScenario(entry) {
  const id = entry.scenario.id;
  const s100 = sample(entry, 0.1);
  const s180 = sample(entry, 0.18);
  const s360 = sample(entry, 0.36);
  const s700 = sample(entry, 0.7);
  const s1200 = sample(entry, 1.2);
  const s3500 = sample(entry, 3.5);
  for (const { snapshot } of entry.samples) assertFinite(id, snapshot);

  assert.equal(s3500.dead, false, `${id}: moderate audit hit should not be death`);
  assert.equal(s3500.physiology?.unconscious, false, `${id}: moderate audit hit should remain conscious`);
  assert.equal(s3500.passiveHandoff, false, `${id}: moderate audit hit should retain active control`);

  if (id.startsWith("chest-")) {
    assert.ok(s180.parts.pelvis.position.y > 0.68, `${id}: torso hit collapsed on the impact beat`);
    assert.ok(s360.controlDrive > 0.25, `${id}: torso hit switched muscles off instead of fighting`);
  }

  if (id === "chest-front") {
    const chestMove = distance(position(s100, "chest"), position(entry.before, "chest"));
    const pelvisMove = distance(position(s100, "pelvis"), position(entry.before, "pelvis"));
    assert.ok(chestMove > pelvisMove * 0.65, `chest must lead pelvis at 100ms (${chestMove.toFixed(3)} vs ${pelvisMove.toFixed(3)})`);
    assert.ok((s100.balance?.reactionAuthority ?? 1) < 1, "gross balance correction should still be ramping at 100ms");
  }

  if (id === "arm-right") {
    const armMove = distance(position(s180, "upperArmR"), position(entry.before, "upperArmR"));
    const pelvisMove = distance(position(s180, "pelvis"), position(entry.before, "pelvis"));
    assert.ok(armMove > pelvisMove * 0.7, `arm hit should remain local first (${armMove.toFixed(3)} vs ${pelvisMove.toFixed(3)})`);
    assert.ok(s700.parts.pelvis.position.y > 0.62, "arm hit toppled a healthy body");
  }

  if (id === "head-front") {
    assert.ok(s180.parts.pelvis.position.y > 0.68, "moderate head hit buckled both legs too early");
    assert.ok(s700.controlDrive > 0.2, "conscious head hit should retain gross motor drive");
  }

  if (id === "thigh-left" || id === "shin-left") {
    assert.ok(s360.injury.L > 0, `${id}: struck leg should have a local capacity deficit`);
    assert.ok(s700.parts.pelvis.position.y > 0.5, `${id}: leg hit caused torso-first limp collapse`);
  }

  if (id === "repeated-light-chest") {
    assert.ok(s360.reaction?.activeEpisodes >= 3, "rapid light hits should remain separate local reaction episodes");
    assert.ok(s700.parts.pelvis.position.y > 0.58, "rapid light hits should build instability, not impact-frame floor the body");
    assert.ok(s1200.controlDrive > 0.2, "rapid light trauma should remain actively controlled while conscious");
  }
}

async function runScenario(page, scenario) {
  const before = await resetScenario(page);
  await shoot(page, scenario);
  let current = 0;
  let repeatIndex = 0;
  const samples = [];

  for (const targetElapsed of checkpoints) {
    while (repeatIndex < (scenario.repeatAt?.length ?? 0) && scenario.repeatAt[repeatIndex] <= targetElapsed + 1e-9) {
      const at = scenario.repeatAt[repeatIndex];
      if (at > current) await page.evaluate((dt) => lab.advance(dt), at - current);
      current = at;
      await shoot(page, scenario);
      repeatIndex++;
    }
    if (targetElapsed > current) {
      await page.evaluate((dt) => lab.advance(dt), targetElapsed - current);
      current = targetElapsed;
    }
    samples.push(await capture(page, scenario, targetElapsed));
  }
  return { scenario, before, samples };
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
    ...(process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : {}),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let seed = 0x735a2c41;
    Math.random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.goto("http://127.0.0.1:8004/?test");
  await page.waitForFunction(() => window.lab?.human);
  await settle(page);

  const report = {
    generatedAt: new Date().toISOString(),
    controller: "euphoria-human-v2-clean-physics",
    errors,
    scenarios: [],
  };
  const reportPath = new URL("audit.json", root);
  for (const scenario of scenarios) {
    const entry = await runScenario(page, scenario);
    assertScenario(entry);
    report.scenarios.push(entry);
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  }

  assert.deepEqual(errors, []);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Visual audit v3 passed: ${scenarios.length} clean-controller hit scenarios captured at exact 240 Hz simulation times.`);
} finally {
  await browser?.close();
  server.kill();
}
