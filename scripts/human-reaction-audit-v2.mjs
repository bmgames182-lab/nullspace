import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = new URL("../test-results/human-reaction-audit-v2/", import.meta.url);
await mkdir(root, { recursive: true });
const server = spawn(
  process.execPath,
  [new URL("./serve.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  { env: { ...process.env, PORT: "8005" }, stdio: "pipe" },
);

const checkpoints = [0.1, 0.45, 0.8, 1.6, 2.8, 4.2, 5.2, 6.4, 8.0, 10.0];
const replayCheckpoints = [0.1, 0.45, 0.8, 1.6, 2.8, 4.2, 6.4, 8.0, 10.0];
const idFor = (seconds) => String(Math.round(seconds * 1000)).padStart(4, "0");

async function waitForAge(page, target) {
  await page.waitForFunction((age) => window.lab?.human?.age >= age, target, { timeout: 30000 });
}
async function waitStanding(page) {
  await page.waitForFunction(() => window.lab?.human?.age > 2 && lab.human.state === "balance", undefined, { timeout: 30000 });
}
async function reset(page) {
  await page.evaluate(() => { lab.clearBlood(); lab.reset(); });
  await waitStanding(page);
  await page.evaluate(() => {
    // This audit deliberately exercises the panic branch. The general visual
    // audit still covers the normal deterministic calm single-shot response.
    lab.human.setReactionModeForDebug?.("panic");
    const chest = lab.human.body("chest").translation();
    lab.camera.position.set(2.05, 1.45, 2.65);
    lab.camera.fov = 43;
    lab.camera.lookAt(chest.x, 1.02, chest.z);
    lab.camera.updateProjectionMatrix();
    for (const child of lab.camera.children) if (child.type === "Group") child.visible = false;
  });
}
async function snap(page) {
  return page.evaluate(() => {
    const h = lab.human;
    const wound = h.woundWorld?.() ?? null;
    const dist = (name) => {
      if (!wound || !h.body(name)) return null;
      const p = h.body(name).translation();
      return Math.hypot(p.x - wound.x, p.y - wound.y, p.z - wound.z);
    };
    return {
      humanAge: h.age,
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
function nearest(s) { return Math.min(s.handDistanceL ?? Infinity, s.handDistanceR ?? Infinity); }

async function shootChest(page) {
  await page.evaluate(() => lab.shoot("chest", 18, { x: 0, y: 0, z: -1 }));
  return page.evaluate(() => lab.human.age);
}

async function collectTimeline(page) {
  await reset(page);
  const before = await page.evaluate(() => {
    const h = lab.human;
    const chest = h.body("chest").translation();
    const d = (name) => {
      const p = h.body(name).translation();
      return Math.hypot(p.x - chest.x, p.y - chest.y, p.z - chest.z);
    };
    return { left: d("handL"), right: d("handR") };
  });
  const startAge = await shootChest(page);
  const samples = [];
  for (const targetElapsed of checkpoints) {
    await waitForAge(page, startAge + targetElapsed);
    const sample = await snap(page);
    sample.actualElapsed = sample.humanAge - startAge;
    samples.push({ targetElapsed, sample });
  }

  // V22 deliberately keeps a conscious panicked body active on the ground for
  // much longer than the old 6.4-second audit. Wait for the *actual* handoff
  // instead of hard-coding an early ragdoll switch, then bound that delay.
  await page.waitForFunction(
    () => window.lab?.human?.passiveHandoff === true,
    undefined,
    { timeout: 9000 },
  );
  const handoff = await snap(page);
  handoff.actualElapsed = handoff.humanAge - startAge;
  await page.screenshot({
    path: new URL(`chest-handoff-${idFor(handoff.actualElapsed)}.png`, root).pathname.replace(/^\/(\w:)/, "$1"),
  });
  return { before, startAge, samples, handoff };
}

async function replayFrame(page, elapsed) {
  await reset(page);
  const startAge = await shootChest(page);
  await waitForAge(page, startAge + elapsed);
  const sample = await snap(page);
  sample.actualElapsed = sample.humanAge - startAge;
  await page.screenshot({
    path: new URL(`chest-${idFor(elapsed)}.png`, root).pathname.replace(/^\/(\w:)/, "$1"),
  });
  return { targetElapsed: elapsed, sample };
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
  await waitStanding(page);

  const timeline = await collectTimeline(page);
  const by = (t) => timeline.samples.find((x) => x.targetElapsed === t).sample;
  const s100 = by(0.1), s450 = by(0.45), s800 = by(0.8), s1600 = by(1.6);
  const s2800 = by(2.8), s4200 = by(4.2), s5200 = by(5.2), s6400 = by(6.4);
  const s8000 = by(8.0), s10000 = by(10.0), handoff = timeline.handoff;
  const initialNearest = Math.min(timeline.before.left, timeline.before.right);

  for (const { targetElapsed, sample } of timeline.samples)
    assert.ok(Math.abs(sample.actualElapsed - targetElapsed) < 0.08, `${targetElapsed}s checkpoint drifted to ${sample.actualElapsed.toFixed(3)}s`);
  assert.ok(nearest(s450) < initialNearest - 0.08, "chest shot should cause an immediate visible hand-to-wound reach");
  assert.ok(nearest(s800) < initialNearest - 0.12, "chest clutch should strengthen rather than fade immediately");
  assert.ok(["clutch", "panic"].includes(s800.reaction?.phase), `0.8s should be clutch/panic, got ${s800.reaction?.phase}`);
  assert.ok(s1600.directedSteps >= 1, "panic should physically move the feet");
  assert.equal(s1600.reaction?.finalRagdoll, false, "panic must not be a disguised ragdoll");
  assert.equal(s1600.physiology?.unconscious, false, "panic phase should remain conscious");
  assert.ok(["kneel", "panic"].includes(s2800.reaction?.phase), `2.8s should be panic/kneel, got ${s2800.reaction?.phase}`);
  assert.equal(s2800.physiology?.unconscious, false);
  assert.ok(["kneel", "failing", "grounded", "groundPanic"].includes(s4200.reaction?.phase), `4.2s should be kneeling/failing/grounded, got ${s4200.reaction?.phase}`);
  assert.ok(["failing", "grounded", "groundPanic"].includes(s5200.reaction?.phase), `5.2s should be late pain-collapse/ground coping, got ${s5200.reaction?.phase}`);

  for (const [label, sample] of [["6.4s", s6400], ["8.0s", s8000]]) {
    assert.equal(sample.dead, false, `${label} ground panic should not be death`);
    assert.equal(sample.physiology?.unconscious, false, `${label} ground panic should remain conscious`);
    assert.equal(sample.passiveHandoff, false, `${label} should still have active muscle control`);
    assert.equal(sample.behavior?.trauma?.mode, "panic", `${label} should remain the panic episode`);
    assert.equal(sample.behavior?.trauma?.groundActive, true, `${label} should still be active ground coping`);
    assert.equal(sample.reaction?.phase, "groundPanic", `${label} should be groundPanic, got ${sample.reaction?.phase}`);
  }

  // By ten seconds the response may still be writhing or may be approaching its
  // handoff window, but it must never have silently become a dead/unconscious body.
  assert.equal(s10000.dead, false);
  assert.equal(s10000.physiology?.unconscious, false);
  assert.ok(handoff.actualElapsed > 8.0, `passive handoff happened too early (${handoff.actualElapsed.toFixed(2)}s)`);
  assert.ok(handoff.actualElapsed < 16.0, `panic never settled into passive ragdoll (${handoff.actualElapsed.toFixed(2)}s)`);
  assert.equal(handoff.passiveHandoff, true);
  assert.equal(handoff.reaction?.phase, "ragdoll");
  assert.deepEqual(errors, []);

  const replays = [];
  for (const elapsed of replayCheckpoints) replays.push(await replayFrame(page, elapsed));
  await writeFile(
    new URL("report.json", root),
    JSON.stringify({ generatedAt: new Date().toISOString(), timeline, replays, errors }, null, 2),
  );
  console.log(`Human reaction audit v2 passed: clutch -> panic -> fall -> extended conscious ground coping -> passive handoff at ${handoff.actualElapsed.toFixed(2)}s.`);
} finally {
  await browser?.close();
  server.kill();
}
