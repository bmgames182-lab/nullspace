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
    repeatGap: 140,
  },
];

const frames = [
  { id: "000", wait: 0 },
  { id: "120", wait: 120 },
  { id: "350", wait: 230 },
  { id: "900", wait: 550 },
  { id: "1800", wait: 900 },
  { id: "3500", wait: 1700 },
];

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
    lab.camera.position.set(3.35, 1.72, 4.35);
    lab.camera.fov = 58;
    lab.camera.updateProjectionMatrix();
    for (const child of lab.camera.children) {
      if (child.type === "Group") child.visible = false;
    }
  });

  const report = { generatedAt: new Date().toISOString(), errors, scenarios: [] };

  for (const scenario of scenarios) {
    await page.evaluate(() => lab.reset());
    await page.waitForFunction(() => lab.human.age > 2 && lab.human.state === "balance");
    await page.evaluate(() => {
      const chest = lab.human.body("chest").translation();
      lab.camera.position.set(3.35, 1.72, 4.35);
      lab.camera.lookAt(chest.x, 1.03, chest.z);
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
        await page.waitForTimeout(scenario.repeatGap);
        await shot();
      }
    }

    const samples = [];
    for (const frame of frames) {
      if (frame.wait) await page.waitForTimeout(frame.wait);
      const snapshot = await page.evaluate(() => lab.snapshot());
      samples.push({ t: frame.id, snapshot });
      await page.screenshot({
        path: new URL(`${scenario.id}-${frame.id}.png`, root).pathname.replace(/^\/(\w:)/, "$1"),
      });
    }

    const final = samples.at(-1).snapshot;
    assert.ok(final.parts.pelvis.position.y > -0.03, `${scenario.id}: pelvis tunneled below ground`);
    assert.ok(
      Object.values(final.parts).every(({ position, velocity }) =>
        [position.x, position.y, position.z, velocity.x, velocity.y, velocity.z].every(Number.isFinite),
      ),
      `${scenario.id}: non-finite rigid body state`,
    );
    report.scenarios.push({ scenario, before, samples });
  }

  assert.deepEqual(errors, []);
  await writeFile(
    new URL("audit.json", root),
    JSON.stringify(report, null, 2),
  );
  console.log(`Visual audit passed: ${scenarios.length} deterministic impact scenarios captured.`);
} finally {
  await browser?.close();
  server.kill();
}
