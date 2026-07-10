import { test, expect } from "@playwright/test";

// Forge each archetype and assert its canvas actually paints and its draw()
// path throws no console/page errors. The model mock echoes the prompt as the
// router's key choice and returns "{}" for param-fill (→ validate fills defaults),
// so every schema renders a valid default game.
const KEYS = ["runner", "shooter", "breakout", "dodger", "whack", "platformer", "maze", "topdown", "driver", "explore", "snake", "tetris", "bullethell", "frogger", "twenty48", "pong", "raycaster", "tabshooter", "raymaze", "raysurvive", "sandbox", "citymap", "life", "sand", "rhythm"];

for (const key of KEYS) {
  test(`forges ${key} and paints with no errors`, async ({ page }) => {
    const errors = [];
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", e => errors.push(String(e)));

    await page.addInitScript(() => {
      const pick = (sys, user) => /Reply with EXACTLY one of/i.test(sys) ? user.trim() : "{}";
      window.__FORGE_MODEL__ = {
        async generateAsync(sys, user) { return pick(sys, user); },
        generate(sys, user) { return pick(sys, user); }
      };
    });

    await page.goto("/forge.html");
    await page.fill("#prompt", key);
    await page.click("#go");
    await page.waitForTimeout(300);

    const painted = await page.evaluate(() => {
      const c = document.getElementById("stage");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
      return n;
    });

    expect(painted, `${key} should paint non-background pixels`).toBeGreaterThan(50);
    expect(errors, `${key} should log no errors`).toEqual([]);
  });
}
