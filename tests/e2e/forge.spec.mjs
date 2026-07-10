import { test, expect } from "@playwright/test";

const MOCK = {
  __default: JSON.stringify({ fireRate: 6, enemySpeed: 3, waveSize: 6, lives: 3, theme: "neon", title: "Asteroid Blitz" }),
  // route() will be forced to shooter by the model answer below when key requested:
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((mockJson) => {
    const fixtures = JSON.parse(mockJson);
    window.__FORGE_MODEL__ = {
      // route() asks for a key → return "shooter"; fill() asks for config → return the JSON
      async generateAsync(system) {
        if (/Reply with EXACTLY one of/i.test(system)) return "shooter";
        return fixtures.__default;
      },
      generate(system) { return /Reply with EXACTLY one of/i.test(system) ? "shooter" : fixtures.__default; }
    };
  }, JSON.stringify(MOCK));
});

test("prompt forges a running game with a canvas + HUD", async ({ page }) => {
  await page.goto("/forge.html");
  await page.fill("#prompt", "fast neon space shooter with asteroids");
  await page.click("#go");
  await expect(page.locator("#status")).toContainText("Asteroid Blitz");
  await expect(page.locator("#remix")).toBeVisible();
  const canvas = page.locator("#stage");
  await expect(canvas).toBeVisible();
  // game loop advances: pixels are non-blank after a few frames
  await page.waitForTimeout(300);
  const painted = await page.evaluate(() => {
    const c = document.getElementById("stage");
    const d = c.getContext("2d").getImageData(0,0,c.width,c.height).data;
    let nonBg = 0; for (let i=0;i<d.length;i+=4) if (d[i]+d[i+1]+d[i+2] > 30) nonBg++;
    return nonBg;
  });
  expect(painted).toBeGreaterThan(100);
});

test("input reaches the game (keypress does not throw, loop continues)", async ({ page }) => {
  await page.goto("/forge.html");
  await page.fill("#prompt", "shooter");
  await page.click("#go");
  const canvas = page.locator("#stage");
  await canvas.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(100);
  await expect(canvas).toBeVisible(); // no crash, still mounted
});

test("remix re-forges without full reload", async ({ page }) => {
  await page.goto("/forge.html");
  await page.fill("#prompt", "shooter");
  await page.click("#go");
  await expect(page.locator("#remix")).toBeVisible();
  await page.click('#remix button[data-nudge="make it harder"]');
  await expect(page.locator("#status")).toContainText("Asteroid Blitz");
});
