import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const artifacts = new URL("../test-results/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const server = spawn(
  process.execPath,
  [new URL("./serve.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  { env: { ...process.env, PORT: "8001" }, stdio: "pipe" },
);

async function deterministicReset(page) {
  await page.evaluate(() => {
    lab.reset();
    lab.pausePhysics(true);
    lab.advance(2.4);
  });
  const snapshot = await page.evaluate(() => lab.snapshot());
  assert.equal(snapshot.controllerStyle, "euphoria-human-v2-clean-physics");
  assert.ok(snapshot.parts.pelvis.position.y > 0.78, "settled pelvis must remain upright");
  assert.ok((snapshot.balance?.supportPolygon?.length ?? 0) >= 4, "settled body must have a real foot support polygon");
  assert.ok((snapshot.balance?.risk ?? 1) < 0.55, `settled body should not remain critical (${snapshot.balance?.risk})`);
  assert.equal(snapshot.physiology?.unconscious, false, "settled body must remain conscious");
  assert.equal(snapshot.passiveHandoff, false, "settled body must retain active control");
  assert.ok(snapshot.controlDrive > 0.5, `settled body needs active motor drive (${snapshot.controlDrive})`);
  return snapshot;
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
  const consoleErrors = [];
  const requestFailures = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    requestFailures.push(`${request.url()} :: ${request.failure()?.errorText ?? "failed"}`);
  });
  await page.goto("http://127.0.0.1:8001/?test");
  try {
    await page.waitForFunction(() => window.lab?.human, undefined, { timeout: 6000 });
  } catch (error) {
    const startup = {
      pageErrors: errors,
      consoleErrors,
      requestFailures,
      html: (await page.locator("body").innerText()).slice(0, 3000),
    };
    await writeFile(new URL("browser-startup-error.json", artifacts), JSON.stringify(startup, null, 2));
    console.error("CLEAN RUNTIME STARTUP FAILURE", JSON.stringify(startup, null, 2));
    throw error;
  }

  // Exact body targeting, while ordinary gameplay retains normal spread RNG.
  await page.evaluate(() => {
    Math.random = () => 0.5;
  });
  await deterministicReset(page);

  await page.screenshot({
    path: new URL("standing.png", artifacts).pathname.replace(/^\/(\w:)/, "$1"),
  });
  await page.mouse.click(640, 360);
  await page.waitForFunction(() => !!document.pointerLockElement);

  const records = [];
  for (const name of ["chest", "shinL", "upperArmR", "head"]) {
    await page.keyboard.press("r");
    await page.evaluate(() => {
      lab.pausePhysics(true);
      lab.advance(2.4);
    });
    await page.waitForTimeout(115);

    const shot = await page.evaluate((part) => {
      const p = lab.human.body(part).translation();
      // Keep placement, aim and the real pointer event in one JS task. The normal
      // FPS loop pins player eye height to 1.68 m every animation frame; allowing
      // a frame between these operations would move the camera and make an exact
      // collider assertion depend on whichever limb happens to cross that ray.
      lab.setView(
        { x: p.x, y: p.y, z: p.z + 2.8 },
        { x: p.x, y: p.y, z: p.z },
        50,
      );
      lab.aimAt(part);

      const origin = lab.camera.position;
      const tx = p.x - origin.x;
      const ty = p.y - origin.y;
      const tz = p.z - origin.z;
      const length = Math.hypot(tx, ty, tz);
      const direction = lab.camera.getWorldDirection(origin.clone());
      const aimDot = (direction.x * tx + direction.y * ty + direction.z * tz) / length;

      document.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
      document.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
      return { aimDot, hitPart: lab.human.lastHit?.part ?? null };
    }, name);

    assert.ok(shot.aimDot > 0.9999, `${name} is not centred before firing (${shot.aimDot})`);
    assert.equal(shot.hitPart, name, `real raycast should hit ${name}`);

    const bloodNow = await page.evaluate(() => lab.bloodStats());
    assert.ok(bloodNow.wounds > 0 && bloodNow.effects > 0, `${name}: real gunshot should create blood FX`);

    await page.evaluate(() => lab.advance(0.24));
    await page.screenshot({
      path: new URL(`${name}-reaction.png`, artifacts).pathname.replace(/^\/(\w:)/, "$1"),
    });
    const reaction = await page.evaluate(() => lab.snapshot());
    assert.equal(reaction.passiveHandoff, false, `${name}: moderate shot should not instant-ragdoll`);

    await page.evaluate(() => lab.advance(1.8));
    records.push({
      name,
      snapshot: await page.evaluate(() => lab.snapshot()),
      blood: await page.evaluate(() => lab.bloodStats()),
    });
    await page.screenshot({
      path: new URL(`${name}-later.png`, artifacts).pathname.replace(/^\/(\w:)/, "$1"),
    });
  }

  const beforeCleanup = await page.evaluate(() => lab.bloodStats());
  assert.ok(beforeCleanup.effects > 0, "blood should persist across human resets");
  await page.keyboard.press("k");
  await page.waitForFunction(() => {
    const b = lab.bloodStats();
    return b.wounds === 0 && b.effects === 0;
  });

  await page.keyboard.press("r");
  await page.evaluate(() => {
    lab.pausePhysics(true);
    lab.advance(2.4);
  });

  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => lab.camera.fov < 70), "ADS should narrow FOV");
  await page.mouse.up({ button: "right" });

  const before = await page.evaluate(() => ({ x: lab.camera.position.x, z: lab.camera.position.z }));
  await page.keyboard.down("d");
  await page.waitForTimeout(250);
  await page.keyboard.up("d");
  const after = await page.evaluate(() => ({ x: lab.camera.position.x, z: lab.camera.position.z }));
  assert.ok(
    Math.hypot(after.x - before.x, after.z - before.z) > 0.2,
    "D strafe should move the camera horizontally",
  );

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.pointerLockElement);
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(requestFailures, []);
  await writeFile(
    new URL("browser.json", artifacts),
    JSON.stringify({ errors, consoleErrors, requestFailures, records, beforeCleanup }, null, 2),
  );
  console.log(
    "Browser passed: clean EuphoriaHuman runtime, real pointer-lock raycasts, exact 240 Hz reactions, persistent blood FX, cleanup, ADS, movement, reset and ESC.",
  );
} finally {
  await browser?.close();
  server.kill();
}
