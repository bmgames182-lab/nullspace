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
    await page.mouse.click(640, 360);
    await page.waitForFunction(() => lab.human.hitAge < 1);
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
    "Browser passed: real pointer lock, four aimed body-part shots, ADS, D strafe, reset, ESC, no page errors.",
  );
} finally {
  await browser?.close();
  server.kill();
}
