import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = new URL("../test-results/visual-audit/", import.meta.url);
await mkdir(root, { recursive: true });

const server = spawn(
  process.execPath,
  [new URL("./serve.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  { env: { ...process.env, PORT: "8002" }, stdio: "pipe" },
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
  {
    id: "repeated-light-chest",
    part: "chest",
    strength: 8,
    dir: { x: 0, y: 0, z: -1 },
    repeat: 3,
    repeatGap: 0.14,
  },
];

// These are elapsed *simulation* times after the final shot, not wall-clock waits.
// Software rendering can slow dramatically when lots of FX are visible, while the
// fixed-step loop intentionally clamps catch-up. Sampling human.age keeps the audit
// about physics behavior instead of runner/rendering speed.
const frames = [
  { id: "000", elapsed: 0 },
  { id: "080", elapsed: 0.08 },
  { id: "180", elapsed: 0.18 },
  { id: "360", elapsed: 0.36 },
  { id: "700", elapsed: 0.7 },
  { id: "1200", elapsed: 1.2 },
  { id: "2200", elapsed: 2.2 },
  { id: "3500", elapsed: 3.5 },
];

function sampleAt(entry, id) {
  return entry.samples.find((sample) => sample.t === id)?.snapshot;
}

function assertBehavior(entry) {
  const id = entry.scenario.id;
  const early = sampleAt(entry, "180");
  const mid = sampleAt(entry, "700");
  const late = sampleAt(entry, "2200");
  const final = sampleAt(entry, "3500");

  assert.ok(early && mid && late && final, `${id}: missing audit samples`);
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
    assert.ok(!["down", "collapse"].includes(mid.state), "head hit should preserve standing support");
  }

  if (id === "thigh-left" || id === "shin-left") {
    assert.ok(early.parts.pelvis.position.y > 0.5, `${id}: leg reaction collapsed too early`);
    assert.ok(early.metrics.steps > 0, `${id}: struck leg should trigger a rescue step`);
  }

  if (id.startsWith("chest-")) {
    assert.ok(early.parts.pelvis.position.y > 0.53, `${id}: torso hit collapsed too early`);
    if (id === "chest-left" || id === "chest-right")
      assert.ok(early.metrics.steps > 0, `${id}: lateral torso hit needs a lateral catch step`);
  }

  if (id === "repeated-light-chest") {
    assert.ok(
      final.parts.pelvis.position.y > 0.72,
      `three light torso hits should be recoverable (pelvis=${final.parts.pelvis.position.y.toFixed(3)}, state=${final.state}, history=${final.history.join(",")})`,
    );
    assert.ok(
      !["down", "collapse"].includes(final.state),
      `light hits should not leave a floor ragdoll (state=${final.state}, pelvis=${final.parts.pelvis.position.y.toFixed(3)})`,
    );
  }
}

async function waitForSimAge(page, targetAge) {
  await page.waitForFunction(
    (target) => window.lab?.human?.age >= target,
    targetAge,
    { timeout: 20000 },
  );
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
    let seed = 0x6d2b79f5;
    Math.random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });

  await page.goto("http://127.0.0.1:8002/?test");
  await page.waitForFunction(() => window.lab?.human.age > 2 && lab.human.state === "balance");

  await page.evaluate(() => {
    lab.camera.position.set(2.15, 1.55, 2.9);
    lab.camera.fov = 46;
    lab.camera.updateProjectionMatrix();
    for (const child of lab.camera.children) {
      if (child.type === "Group") child.visible = false;
    }
  });

  const report = { generatedAt: new Date().toISOString(), errors, scenarios: [] };
  const reportPath = new URL("audit.json", root);

  for (const scenario of scenarios) {
    // Physics scenarios must start from the same render load. Persistent blood is
    // tested separately in browser-test.mjs; carrying old FX between audit cases
    // would make one scenario more expensive to render than another.
    await page.evaluate(() => {
      lab.clearBlood();
      lab.reset();
    });
    await page.waitForFunction(() => lab.human.age > 2 && lab.human.state === "balance");
    await page.evaluate(() => {
      const chest = lab.human.body("chest").translation();
      lab.camera.position.set(2.15, 1.55, 2.9);
      lab.camera.lookAt(chest.x, 0.98, chest.z);
    });

    const before = await page.evaluate(() => lab.snapshot());
    const shot = async () =>
      page.evaluate(
        ({ part, strength, dir }) => lab.shoot(part, strength, dir),
        scenario,
      );

    await shot();
    if (scenario.repeat) {
      for (let i = 1; i < scenario.repeat; i++) {
        const previousShotAge = await page.evaluate(() => lab.human.age);
        await waitForSimAge(page, previousShotAge + scenario.repeatGap);
        await shot();
      }
    }

    // Start the audit clock after the final repeated hit, matching the old test's
    // semantics while making every timestamp refer to actual simulated time.
    const startAge = await page.evaluate(() => lab.human.age);
    const samples = [];
    for (const frame of frames) {
      if (frame.elapsed > 0) await waitForSimAge(page, startAge + frame.elapsed);
      const snapshot = await page.evaluate(() => lab.snapshot());
      samples.push({
        t: frame.id,
        simulatedElapsed: snapshot.parts ? snapshot.reaction?.age ?? null : null,
        humanAge: await page.evaluate(() => lab.human.age),
        snapshot,
      });
      await page.screenshot({
        path: new URL(`${scenario.id}-${frame.id}.png`, root).pathname.replace(/^\/(\w:)/, "$1"),
      });
    }

    const entry = { scenario, before, startAge, samples };
    report.scenarios.push(entry);
    // Persist diagnostics before asserting so a red CI run still uploads the exact
    // state that failed instead of leaving us with screenshots only.
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    assertBehavior(entry);
  }

  assert.deepEqual(errors, []);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(
    `Visual audit passed: ${scenarios.length} deterministic close-framed impact scenarios captured at simulation-time checkpoints and behavior-checked.`,
  );
} finally {
  await browser?.close();
  server.kill();
}
