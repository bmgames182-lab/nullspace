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
      ? {
          executablePath:
            "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        }
      : {}),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:8001/?test");
  await page.waitForFunction(() => window.lab?.human.age > 2);
  assert.equal(await page.evaluate(() => lab.human.state), "balance");

  // The browser test verifies targeting/raycast plumbing, not weapon-spread RNG.
  // Keep normal gameplay untouched while making exact body-part assertions repeatable.
  await page.evaluate(() => {
    Math.random = () => 0.5;
  });

  await page.screenshot({
    path: new URL("standing.png", artifacts).pathname.replace(/^\/(\w:)/, "$1"),
  });
  await page.mouse.click(640, 360);
  await page.waitForFunction(() => !!document.pointerLockElement);
  const records = [];
  for (const name of ["chest", "shinL", "upperArmR", "head"]) {
    await page.keyboard.press("r");
    await page.waitForFunction(() => lab.human.age > 2);
    await page.evaluate((name) => lab.aimAt(name), name);

    // camera.lookAt() should put the requested rigid-body centre directly on the
    // crosshair. Check that before firing so a future pointer/camera regression
    // fails with a useful assertion instead of a 30-second hit timeout.
    const aimDot = await page.evaluate((name) => {
      const p = lab.human.body(name).translation();
      const origin = lab.camera.position;
      const tx = p.x - origin.x,
        ty = p.y - origin.y,
        tz = p.z - origin.z;
      const length = Math.hypot(tx, ty, tz);
      const direction = lab.camera.getWorldDirection(origin.clone());
      return (direction.x * tx + direction.y * ty + direction.z * tz) / length;
    }, name);
    assert.ok(aimDot > 0.9999, `${name} is not centred before firing (${aimDot})`);

    // Do not call mouse.click(x, y) while pointer-lock is active: Playwright may
    // synthesize a mousemove to that coordinate and rotate the FPS camera after
    // aimAt(). down/up exercises the real LMB handler without moving the pointer.
    await page.mouse.down({ button: "left" });
    await page.mouse.up({ button: "left" });
    await page.waitForFunction(() => lab.human.hitAge < 1, undefined, {
      timeout: 5000,
    });
    const hitPart = await page.evaluate(() => lab.human.lastHit.part);
    assert.equal(hitPart, name);
    await page.waitForTimeout(240);
    await page.screenshot({
      path: new URL(name + "-reaction.png", artifacts).pathname.replace(
        /^\/(\w:)/,
        "$1",
      ),
    });
    await page.waitForTimeout(1800);
    records.push({ name, snapshot: await page.evaluate(() => lab.snapshot()) });
    await page.screenshot({
      path: new URL(name + "-later.png", artifacts).pathname.replace(
        /^\/(\w:)/,
        "$1",
      ),
    });
  }
  await page.keyboard.press("r");
  await page.waitForFunction(() => lab.human.age > 2);
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => lab.camera.fov < 70));
  await page.mouse.up({ button: "right" });
  const before = await page.evaluate(() => lab.camera.position.x);
  await page.keyboard.down("d");
  await page.waitForTimeout(250);
  await page.keyboard.up("d");
  assert.ok((await page.evaluate(() => lab.camera.position.x)) > before);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.pointerLockElement);
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("browser.json", artifacts),
    JSON.stringify({ errors, records }, null, 2),
  );
  console.log(
    "Browser passed: real pointer lock, four deterministic aimed body-part shots, ADS, D strafe, reset, ESC, no page errors.",
  );
} finally {
  await browser?.close();
  server.kill();
}
