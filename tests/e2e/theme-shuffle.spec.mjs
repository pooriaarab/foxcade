import { test, expect } from "@playwright/test";

// Shuffling a theme changes the ART STYLE + SPRITE SOURCE, not just colors. Forge
// a representative game under one theme per art source (vector / pixel / photo) and
// assert each still paints with no console/page errors — i.e. every art source is
// safe across a space game (photo atlas), a proc-friendly game, and a plain game.
// The model mock echoes the prompt as the router key and returns a param-fill JSON
// that pins the theme, so validate honors it (unknown keys are dropped).
const CASES = [
  { key: "shooter", theme: "neon" },   // vector / glow  (space family)
  { key: "shooter", theme: "retro" },  // pixel  / pixel (procedural ship/invader)
  { key: "shooter", theme: "scifi" },  // photo  / sharp (space photo atlas)
  { key: "maze", theme: "eightbit" },  // pixel  / pixel (any game → coherent pixel)
  { key: "explore", theme: "handdrawn" }, // vector / sketch (deterministic ink)
  { key: "breakout", theme: "candy" }  // pixel  / round-skin fallback
];

for (const { key, theme } of CASES) {
  test(`forges ${key} under ${theme} and paints with no errors`, async ({ page }) => {
    const errors = [];
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", e => errors.push(String(e)));

    await page.addInitScript(([k, t]) => {
      const reply = (sys, user) =>
        /Reply with EXACTLY one of/i.test(sys) ? user.trim() : JSON.stringify({ theme: t });
      window.__FORGE_MODEL__ = {
        async generateAsync(sys, user) { return reply(sys, user); },
        generate(sys, user) { return reply(sys, user); }
      };
    }, [key, theme]);

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

    expect(painted, `${key}/${theme} should paint non-background pixels`).toBeGreaterThan(50);
    expect(errors, `${key}/${theme} should log no errors`).toEqual([]);
  });
}
