import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__FORGE_MODEL__ = {
      async generateAsync(system) {
        return /Reply with EXACTLY one of/i.test(system) ? "shooter" : JSON.stringify({ title: "Verify", theme: "neon" });
      },
      generate(system) {
        return /Reply with EXACTLY one of/i.test(system) ? "shooter" : JSON.stringify({ title: "Verify", theme: "neon" });
      }
    };
  });
});

test("a share hash hydrates a fresh forge load into that exact game", async ({ page, context }) => {
  await page.goto("/forge.html");
  // Grab a share token straight from the app's encoder.
  const token = await page.evaluate(async () => {
    const { encodeGame } = await import("./daily.js");
    return encodeGame("shooter", { title: "Verify", theme: "neon", modifiers: [] });
  });
  expect(token.length).toBeGreaterThan(0);

  // A shared link is opened fresh (new tab / cold load) — that is when
  // hydrateFromHash runs. No model needed: hydration decodes + validates + mounts.
  const fresh = await context.newPage();
  await fresh.goto("/forge.html#" + token);
  await expect(fresh.locator("#status")).toContainText("shared game");
  await expect(fresh.locator("#status")).toContainText("Verify");
  await fresh.waitForTimeout(250);
  const painted = await fresh.evaluate(() => {
    const c = document.getElementById("stage");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(100);
});

test("a canvas pointer tap drives a keyboard-only game without crashing", async ({ page }) => {
  await page.goto("/forge.html");
  await page.fill("#prompt", "shooter");
  await page.click("#go");
  const canvas = page.locator("#stage");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  // Tap left side then right side (drives input.left / input.right generically).
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await page.waitForTimeout(120);
  await page.mouse.up();
  await expect(canvas).toBeVisible(); // still mounted, loop alive
});

test("bad share hash is ignored, page still usable", async ({ page }) => {
  await page.goto("/forge.html#not-a-real-token@@@");
  await page.fill("#prompt", "shooter");
  await page.click("#go");
  await expect(page.locator("#status")).toContainText("Verify");
});
