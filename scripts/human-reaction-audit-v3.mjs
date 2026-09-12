import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = new URL("../test-results/human-reaction-audit-v3/", import.meta.url);
await mkdir(root, { recursive: true });
const server = spawn(
  process.execPath,
  [new URL("./serve.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  { env: { ...process.env, PORT: "8005" }, stdio: "pipe" },
);

const checkpoints = [0, 0.08, 0.1, 0.18, 0.3, 0.45, 0.7, 1.0, 1.4, 2.2, 3.5, 5.0];
const screenshotTimes = new Set([0, 0.08, 0.18, 0.3, 0.45, 0.7, 1.0, 1.4, 2.2, 3.5, 5.0]);
const idFor = (seconds) => String(Math.round(seconds * 1000)).padStart(4, "0");
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function prepare(page) {
  await page.evaluate(() => {
    lab.clearBlood();
    lab.reset();
    lab.pausePhysics(true);
    lab.advance(2.4);
    lab.setGunVisible(false);
    lab.setView({ x: 2.08, y: 1.43, z: 2.62 }, { x: 0, y: 1.02, z: 0 }, 42);
  });
  const before = await page.evaluate(() => lab.snapshot());
  assert.equal(before.controllerStyle, "euphoria-human-v2-clean-physics");
  assert.ok(before.parts.pelvis.position.y > 0.78);
  return before;
}

async function collect(page) {
  const before = await prepare(page);
  await page.evaluate(() =>
    lab.shoot(
      "chest",
      18,
      { x: 0, y: 0, z: -1 },
      { x: 0.08, y: 0.055, z: 0.11 },
    ),
  );

  const samples = [];
  let current = 0;
  for (const targetElapsed of checkpoints) {
    if (targetElapsed > current) {
      await page.evaluate((dt) => lab.advance(dt), targetElapsed - current);
      current = targetElapsed;
    }
    const sample = await page.evaluate(() => lab.snapshot());
    samples.push({ targetElapsed, sample });
    if (screenshotTimes.has(targetElapsed)) {
      await page.screenshot({
        path: new URL(`chest-${idFor(targetElapsed)}.png`, root).pathname.replace(/^\/(\w:)/, "$1"),
      });
    }
  }
  return { before, samples };
}

function at(timeline, t) {
  return timeline.samples.find((x) => x.targetElapsed === t).sample;
}

function assertTimeline(timeline) {
  const s80 = at(timeline, 0.08);
  const s100 = at(timeline, 0.1);
  const s180 = at(timeline, 0.18);
  const s300 = at(timeline, 0.3);
  const s450 = at(timeline, 0.45);
  const s700 = at(timeline, 0.7);
  const s1000 = at(timeline, 1.0);
  const s1400 = at(timeline, 1.4);
  const s2200 = at(timeline, 2.2);
  const s3500 = at(timeline, 3.5);
  const s5000 = at(timeline, 5.0);

  const chestMove100 = distance(s100.parts.chest.position, timeline.before.parts.chest.position);
  const pelvisMove100 = distance(s100.parts.pelvis.position, timeline.before.parts.pelvis.position);
  assert.ok(
    chestMove100 > pelvisMove100 * 0.65,
    `reference-critical local lead missing: chest=${chestMove100.toFixed(3)} pelvis=${pelvisMove100.toFixed(3)}`,
  );
  assert.ok((s80.balance?.reactionAuthority ?? 1) < 0.65, `80ms balance authority should still be delayed (${s80.balance?.reactionAuthority})`);
  assert.ok((s180.balance?.reactionAuthority ?? 0) > (s80.balance?.reactionAuthority ?? 1), "gross correction should ramp in after the local hit beat");
  assert.ok(s180.parts.pelvis.position.y > 0.72, "impact beat should remain leg-supported");
  assert.ok(s300.controlDrive > 0.3, "person should still be actively fighting the disturbance");
  assert.equal(s450.physiology?.unconscious, false);
  assert.equal(s700.passiveHandoff, false);

  const wound = s700.reaction?.wound;
  assert.ok(wound, "chest reaction should retain a physical wound point");
  const left = distance(s700.parts.handL.position, wound);
  const right = distance(s700.parts.handR.position, wound);
  assert.ok(Math.min(left, right) < 0.65, `a protective hand should seek the chest wound (${Math.min(left, right).toFixed(2)}m)`);

  const firstStep = timeline.samples.find(({ sample }) => sample.metrics.steps > timeline.before.metrics.steps);
  if (firstStep) {
    assert.ok(firstStep.targetElapsed >= 0.18, `step started too early to be a balance consequence (${firstStep.targetElapsed}s)`);
  }

  for (const [label, s] of [["1.0s", s1000], ["1.4s", s1400], ["2.2s", s2200], ["3.5s", s3500], ["5.0s", s5000]]) {
    assert.equal(s.dead, false, `${label}: moderate chest hit became death`);
    assert.equal(s.physiology?.unconscious, false, `${label}: moderate chest hit became unconsciousness`);
    assert.equal(s.passiveHandoff, false, `${label}: conscious body handed off to passive ragdoll`);
    assert.ok(s.controlDrive > 0.18, `${label}: active motor drive vanished`);
    assert.ok(s.parts.pelvis.position.y > -0.04, `${label}: body tunneled through floor`);
  }
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
    let seed = 0x54a91b37;
    Math.random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.goto("http://127.0.0.1:8005/?test");
  await page.waitForFunction(() => window.lab?.human);
  const timeline = await collect(page);
  assertTimeline(timeline);
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("report.json", root),
    JSON.stringify({ generatedAt: new Date().toISOString(), timeline, errors }, null, 2),
  );
  console.log("Human reaction audit v3 passed: local chest response -> delayed whole-body correction -> active recovery, with no scripted panic/kneel/final-ragdoll choreography.");
} finally {
  await browser?.close();
  server.kill();
}
