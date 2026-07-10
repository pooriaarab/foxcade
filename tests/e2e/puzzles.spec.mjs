import { test, expect } from "@playwright/test";

// Model mock: the router echoes the typed prompt as its key choice; param-fill
// returns "{}" so validate() supplies schema defaults (wordle then seeds its own
// answer). Mirrors render-all.spec's mock so puzzles ride the same forge path.
async function mockModel(page) {
  await page.addInitScript(() => {
    const pick = (sys, user) => /Reply with EXACTLY one of/i.test(sys) ? user.trim() : "{}";
    window.__FORGE_MODEL__ = {
      async generateAsync(sys, user) { return pick(sys, user); },
      generate(sys, user) { return pick(sys, user); }
    };
  });
}

async function openPuzzle(page, key) {
  await mockModel(page);
  await page.goto("/forge.html");
  await page.fill("#prompt", key);
  await page.click("#go");
  // Puzzles render into #board (DOM), not the arcade #stage canvas.
  await expect(page.locator("#board")).toBeVisible();
  await expect(page.locator("#stage")).toBeHidden();
}

test("wordle mounts a 6x5 grid and an on-screen keyboard, no errors", async ({ page }) => {
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));

  await openPuzzle(page, "wordle");
  await expect(page.locator("#board .wordle-grid")).toBeVisible();
  await expect(page.locator("#board .wordle-tile")).toHaveCount(30);
  await expect(page.locator("#board .wordle-key").first()).toBeVisible();

  // Physical-keyboard input reaches the puzzle: type + submit a guess and assert
  // the first row picks up feedback classes.
  await page.locator("#board").click();
  for (const ch of "CRANE") await page.keyboard.press(ch);
  await page.keyboard.press("Enter");
  const scored = await page.locator("#board .wordle-tile.green, #board .wordle-tile.yellow, #board .wordle-tile.gray").count();
  expect(scored).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("pinpoint reveals a clue and offers category options, no errors", async ({ page }) => {
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));

  await openPuzzle(page, "pinpoint");
  await expect(page.locator("#board .pinpoint-clue")).toHaveCount(1);
  await expect(page.locator("#board .pinpoint-option").first()).toBeVisible();
  expect(await page.locator("#board .pinpoint-option").count()).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});
