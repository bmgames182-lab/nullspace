import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = new URL("../test-results/visual-audit-v2/", import.meta.url);
await mkdir(root, { recursive: true });

const server = spawn(
  process.execPath,
  [new URL("./serve.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  { env: { ...process.env, PORT: "8004" }, stdio: "pipe" },
);

const scenarios = [
  { id: "chest-front", part: "chest", strength: 18, dir: { x: 0, y: 0, z: -1 } },
  { id: "chest-back", part: "chest", strength: 18, dir: { x: 0, y: 0, z: 1 } },
  { id: "chest-left", part: "chest", strength: 18, dir: { x: 1, y: 0, z: 0 } },
  { id: "chest-right", part: "chest", strength: 18, dir: { x: -1, y: 0, z: 0 } },
  { id: "head-front", part: "head", strength: 14, dir: { x: 0, y: 0, z: -1 } },
  { id: "thigh-left", part: "thighL", strength: 18, dir: { x: 0, y: 0, z: -1 } },
  { id: "shin-left", part: "shinL", strength: 18, dir: { x: 0, y: 0, z: -1 } },
  { id: "arm-right", part: "upperArmR", strength: 18, dir: { x: 0, y: 0, z: -1 } },
  { id: "repeated-light-chest", part: "chest", strength: 8, dir: { x: 0, y: 0, z: -1 }, repeat: 3, repeatGap: 0.14 },
];

const checkpoints = [0, 0.08, 0.18, 0.36, 0.7, 1.2, 2.2, 3.5];
const defaultVisualCheckpoints = [0.18, 0.7];
const visualCheckpointsFor = (scenario) =>
  scenario.id === "repeated-light-chest"
    ? [0.18, 0.7, 2.2, 3.5]
    : defaultVisualCheckpoints;
const idFor = (seconds) => String(Math.round(seconds * 1000)).padStart(4, "0");

async function waitForAge(page, age) {
  await page.waitForFunction(
    (target) => window.lab?.human?.age >= target,
    age,
    { timeout: 30000 },
  );
}

async function waitStanding(page) {
  await page.waitForFunction(
    () => window.lab?.human?.age > 2 && lab.human.state === "balance",
    undefined,
    { timeout: 30000 },
  );
}

async function snapshot(page) {
  return page.evaluate(() => ({
    ...lab.snapshot(),
    directedReaction: lab.human.reactionSnapshot?.() ?? lab.human.hitReaction?.snapshot?.() ?? null,
    behaviorIntent: lab.human.behaviorSnapshot?.() ?? null,
    directedSteps: lab.human.directedSteps ?? 0,
    passiveHandoff: lab.human.passiveHandoff ?? false,
    humanAge: lab.human.age,
  }));
}

async function fireScenario(page, scenario) {
  const shoot = () =>
    page.evaluate(
      ({ part, strength, dir }) => lab.shoot(part, strength, dir),
      scenario,
    );
  await shoot();
  if (scenario.repeat) {
    for (let i = 1; i < scenario.repeat; i++) {
      const age = await page.evaluate(() => lab.human.age);
      await waitForAge(page, age + scenario.repeatGap);
      await shoot();
    }
  }
}

async function resetScenario(page) {
  await page.evaluate(() => {
    lab.clearBlood();
    lab.reset();
  });
  await waitStanding(page);
  await page.evaluate(() => {
    const chest = lab.human.body("chest").translation();
    lab.camera.position.set(2.15, 1.55, 2.9);
    lab.camera.fov = 46;
    lab.camera.lookAt(chest.x, 0.98, chest.z);
    lab.camera.updateProjectionMatrix();
    for (const child of lab.camera.children) if (child.type === "Group") child.visible = false;
  });
}

function at(entry, seconds) {
  return entry.samples.find((sample) => Math.abs(sample.targetElapsed - seconds) < 1e-6)?.snapshot;
}

function assertBehavior(entry) {
  const id = entry.scenario.id;
  const early = at(entry, 0.18);
  const mid = at(entry, 0.7);
  const late = at(entry, 2.2);
  const final = at(entry, 3.5);
  assert.ok(early && mid && late && final, `${id}: missing exact-time samples`);
  assert.ok(Math.abs(mid.actualElapsed - 0.7) < 0.08, `${id}: 700ms checkpoint drifted to ${mid.actualElapsed.toFixed(3)}s`);
  assert.ok(final.parts.pelvis.position.y > -0.03, `${id}: pelvis tunneled below ground`);
  assert.ok(
    Object.values(final.parts).every(({ position, velocity }) =>
      [position.x, position.y, position.z, velocity.x, velocity.y, velocity.z].every(Number.isFinite),
    ),
    `${id}: non-finite rigid body state`,
  );

  if (id === "arm-right") {
    assert.ok(mid.parts.pelvis.position.y > 0.58, "arm hit should stay mostly local");
    assert.ok(!["down", "collapse"].includes(mid.state), "arm hit should not topple the whole body");
  }
  if (id === "head-front") {
    assert.ok(early.parts.pelvis.position.y > 0.68, "head hit should not buckle both legs");
    assert.equal(mid.physiology?.unconscious, false, "moderate head audit is intended to stay conscious");
    assert.ok(mid.parts.pelvis.position.y > 0.61, `conscious head hit should still be fighting for support (pelvis=${mid.parts.pelvis.position.y.toFixed(3)})`);
    assert.ok(!["down", "collapse"].includes(mid.state), `conscious head hit should daze/stumble, not floor-ragdoll (state=${mid.state})`);
    assert.ok((mid.directedSteps ?? 0) <= 1, `head daze should not turn into frantic stepping (${mid.directedSteps})`);
  }
  if (id === "thigh-left" || id === "shin-left") {
    assert.ok(early.parts.pelvis.position.y > 0.5, `${id}: leg reaction collapsed too early`);
    assert.ok((early.metrics.steps ?? 0) > 0 || (early.directedSteps ?? 0) > 0, `${id}: struck leg should trigger a rescue step`);
  }
  if (id.startsWith("chest-")) {
    assert.ok(early.parts.pelvis.position.y > 0.53, `${id}: torso hit collapsed too early`);
    if (id === "chest-left" || id === "chest-right")
      assert.ok((early.metrics.steps ?? 0) > 0 || (early.directedSteps ?? 0) > 0, `${id}: lateral torso hit needs a catch step`);
  }
  if (id === "repeated-light-chest") {
    const trauma = final.behaviorIntent?.trauma;
    assert.ok(early.parts.pelvis.position.y > 0.78, `rapid light hits must not impact-frame floor the body (${early.parts.pelvis.position.y.toFixed(3)})`);
    assert.ok(mid.parts.pelvis.position.y > 0.72, `cumulative panic should build before the fall (${mid.parts.pelvis.position.y.toFixed(3)})`);
    assert.equal(final.dead, false, "cumulative light torso panic must not be treated as death");
    assert.equal(final.physiology?.unconscious, false, "cumulative light torso panic is intended to remain conscious");
    assert.equal(final.passiveHandoff, false, "cumulative panic must stay actively controlled before any passive handoff");
    assert.equal(trauma?.mode, "panic", "three rapid light torso hits should escalate into panic mode");
    assert.ok((trauma?.rapidTorsoHits ?? 0) >= 3, `rapid-hit accumulator should retain the three-hit episode (${trauma?.rapidTorsoHits})`);
    assert.notEqual(final.state, "limp", "conscious cumulative panic must never look like a dead limp ragdoll");

    const floorLike = final.parts.pelvis.position.y < 0.72 || ["collapse", "down"].includes(final.state);
    if (floorLike) {
      assert.equal(trauma?.groundActive, true, `floor transition must already be active conscious ground panic (state=${final.state})`);
      assert.ok(
        trauma?.reactionPhase === "groundPanic" || trauma?.behaviorPhase === "groundGuard",
        `floor transition must guard/writhe rather than go inert (reaction=${trauma?.reactionPhase}, behavior=${trauma?.behaviorPhase})`,
      );
    }
  }
}

async function collectTimeline(page, scenario) {
  await resetScenario(page);
  const before = await snapshot(page);
  await fireScenario(page, scenario);
  const startAge = await page.evaluate(() => lab.human.age);
  const samples = [];
  for (const targetElapsed of checkpoints) {
    if (targetElapsed > 0) await waitForAge(page, startAge + targetElapsed);
    const snap = await snapshot(page);
    snap.actualElapsed = snap.humanAge - startAge;
    samples.push({ targetElapsed, snapshot: snap });
  }
  return { scenario, before, startAge, samples };
}

async function replayScreenshot(page, scenario, elapsed) {
  await resetScenario(page);
  await fireScenario(page, scenario);
  const startAge = await page.evaluate(() => lab.human.age);
  if (elapsed > 0) await waitForAge(page, startAge + elapsed);
  const snap = await snapshot(page);
  const actualElapsed = snap.humanAge - startAge;
  await page.screenshot({
    path: new URL(`${scenario.id}-${idFor(elapsed)}.png`, root).pathname.replace(/^\/(\w:)/, "$1"),
  });
  return { targetElapsed: elapsed, actualElapsed, snapshot: snap };
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
    let seed = 0x6d2b79f5;
    Math.random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.goto("http://127.0.0.1:8004/?test");
  await waitStanding(page);

  const report = { generatedAt: new Date().toISOString(), errors, scenarios: [], visualReplays: [] };
  const reportPath = new URL("audit.json", root);
  for (const scenario of scenarios) {
    const entry = await collectTimeline(page, scenario);
    report.scenarios.push(entry);
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    assertBehavior(entry);
  }

  // Screenshots are deliberately separate replays. A slow screenshot can no
  // longer advance the simulation before the next asserted timestamp.
  for (const scenario of scenarios) {
    for (const elapsed of visualCheckpointsFor(scenario)) {
      const replay = await replayScreenshot(page, scenario, elapsed);
      report.visualReplays.push({ scenario: scenario.id, ...replay });
    }
  }

  assert.deepEqual(errors, []);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Visual audit v2 passed: ${scenarios.length} scenarios checked at exact simulation times; ${report.visualReplays.length} replayed visual frames captured.`);
} finally {
  await browser?.close();
  server.kill();
}
