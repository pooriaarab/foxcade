import { test, expect } from "@playwright/test";

// The 3D game is WebGL + a lazy-imported three.js. Headless browsers may have no
// WebGL context, so this test tolerates that: it asserts the canvas mounts and no
// uncaught error fires, and accepts EITHER a live game (HUD) OR the graceful
// "WebGL unavailable" notice. It never depends on a real GL context, so it is not
// flaky on GL-less CI.
test("opening the 3D space shooter mounts a WebGL canvas without crashing", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(String(e)));

  // A mock model keeps feed startup instant; the catalog itself is model-free.
  await page.addInitScript(() => {
    window.__FORGE_MODEL__ = {
      async generateAsync() { return "{}"; },
      generate() { return "{}"; }
    };
  });

  await page.goto("/feed.html");

  const card = page.locator(".game-card", { hasText: "3D Space Shooter" });
  await expect(card).toBeVisible();
  await card.click();

  await expect(page.locator("#overlay")).toBeVisible();
  await expect(page.locator("#stage3d")).toBeVisible();

  // Lazy three.js import + setup resolves into either the HUD (GL available) or
  // the notice (GL missing). Waiting for one avoids a brittle fixed timeout.
  await page.locator(".three-hud, .three-notice").first().waitFor({ timeout: 5000 });

  const outcome = await page.evaluate(() => ({
    hud: Boolean(document.querySelector(".three-hud")),
    notice: Boolean(document.querySelector(".three-notice"))
  }));
  expect(outcome.hud || outcome.notice, "3D game shows a HUD or a graceful notice").toBeTruthy();
  expect(pageErrors, "no uncaught errors").toEqual([]);
});
