import { test, expect } from "@playwright/test";

// A forged game whose prompt carries modifier keywords still mounts, paints, and
// throws no errors — proving the modifier layer (input remap + frame transform +
// dt scale) is transparent to the game. The model mock echoes the prompt as the
// router key choice (keyword-scores to "snake") and returns "{}" for param-fill.
test("forges a modified game and paints with no errors", async ({ page }) => {
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
  await page.fill("#prompt", "mirrored fast snake");
  await page.click("#go");
  await page.waitForTimeout(300);

  const painted = await page.evaluate(() => {
    const c = document.getElementById("stage");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
    return n;
  });

  expect(painted, "modified game should paint non-background pixels").toBeGreaterThan(50);
  expect(errors, "modified game should log no errors").toEqual([]);
});
