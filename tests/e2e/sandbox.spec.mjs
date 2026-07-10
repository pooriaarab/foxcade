import { test, expect } from "@playwright/test";

// Forge the sandbox: the model returns a game-SPEC (not a flat config), which
// goes through specValidate (the crash-proof gate) before the interpreter runs.
const SPEC = JSON.stringify({
  title: "Star Sweep", theme: "neon",
  entities: [
    { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
    { role: "pickup", motion: "static", shape: "target", count: 6, speed: 0 },
    { role: "enemy", motion: "chase", shape: "invader", count: 2, speed: 3 }
  ],
  collisions: [
    { between: ["player", "pickup"], effect: "collect" },
    { between: ["player", "enemy"], effect: "lose" }
  ],
  goal: { type: "collectAll", value: 0 }
});

async function mockModel(page, fillReply) {
  await page.addInitScript((reply) => {
    const pick = (sys, user) => /Reply with EXACTLY one of/i.test(sys) ? "sandbox" : reply;
    window.__FORGE_MODEL__ = {
      async generateAsync(sys, user) { return pick(sys, user); },
      generate(sys, user) { return pick(sys, user); }
    };
  }, fillReply);
}

async function paintedPixels(page) {
  return page.evaluate(() => {
    const c = document.getElementById("stage");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
    return n;
  });
}

test("sandbox forges an assembled game-spec, paints, and logs no errors", async ({ page }) => {
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));

  await mockModel(page, SPEC);
  await page.goto("/forge.html");
  await page.fill("#prompt", "invent a game where I collect stars");
  await page.click("#go");
  await expect(page.locator("#status")).toContainText("Star Sweep");
  await page.waitForTimeout(300);

  expect(await paintedPixels(page), "sandbox should paint entities").toBeGreaterThan(50);
  expect(errors, "sandbox should log no errors").toEqual([]);
});

test("a garbage spec still renders a playable game (crash-proof gate)", async ({ page }) => {
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));

  await mockModel(page, "not even json {{{ role: dragon");
  await page.goto("/forge.html");
  await page.fill("#prompt", "sandbox");
  await page.click("#go");
  await page.waitForTimeout(300);

  // specValidate turns the garbage into the default playable game -> pixels paint.
  expect(await paintedPixels(page), "garbage spec should still paint a default game").toBeGreaterThan(50);
  expect(errors, "garbage spec should not throw").toEqual([]);
});
