import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__FORGE_MODEL__ = {
      async generateAsync(system) {
        if (/Reply with EXACTLY one of/i.test(system)) return "shooter";
        return JSON.stringify({ title: "Daily Test", theme: "neon" });
      },
      generate(system) {
        return /Reply with EXACTLY one of/i.test(system)
          ? "shooter"
          : JSON.stringify({ title: "Daily Test", theme: "neon" });
      }
    };
  });
});

test("daily banner opens a painted overlay game and shows streak text", async ({ page }) => {
  await page.goto("/feed.html");

  await expect(page.locator("#daily")).toBeVisible();
  await expect(page.locator("#daily-title")).toContainText("Today's foxcade");
  await expect(page.locator("#daily-streak")).toContainText("Streak");

  await page.click("#daily-play");
  await expect(page.locator("#overlay")).toBeVisible();
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#daily-streak")).toContainText("Streak 1");

  await page.waitForTimeout(300);
  const painted = await page.evaluate(() => {
    const c = document.getElementById("stage");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let nonBg = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] > 30) nonBg++;
    }
    return nonBg;
  });

  expect(painted).toBeGreaterThan(100);
});
