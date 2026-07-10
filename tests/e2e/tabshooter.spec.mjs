import { test, expect } from "@playwright/test";

// P0 — the real-tab-close path (feed.js wireRealTabs + showUndo). This is the most
// dangerous feature in the extension: it closes the user's REAL browser tabs. We
// mock globalThis.browser and play the tabshooter through the actual feed page,
// asserting the safety invariants hold end to end:
//   - protected tabs (pinned / active / the extension's own tab) are NEVER removed
//   - only bullet-hit closable tabs reach browser.tabs.remove
//   - each closed tab is stashed and the Undo button reopens it via sessions.restore
//
// Layout is deterministic (5 columns; a target's x is fixed by its index), so a
// stationary player parked on column 2 only ever hits the column-2 tabs; the
// protected tabs sit in other columns and are never in the line of fire — a
// second, independent guarantee on top of the engine's own protected-tab skip.
const SELF_ID = 999;
const TABS = [
  { id: 10, title: "Inbox",     url: "https://inbox.example",  pinned: false, active: false }, // col0
  { id: 11, title: "Docs",      url: "https://docs.example",   pinned: false, active: false }, // col1
  { id: 12, title: "News",      url: "https://news.example",   pinned: false, active: false }, // col2 (shot)
  { id: 13, title: "Shop",      url: "https://shop.example",   pinned: false, active: false }, // col3
  { id: 14, title: "Video",     url: "https://video.example",  pinned: false, active: false }, // col4
  { id: 15, title: "Calendar",  url: "https://cal.example",    pinned: true,  active: false }, // col0 r1 PROTECTED
  { id: 16, title: "Timeline",  url: "https://social.example", pinned: false, active: true  }, // col1 r1 PROTECTED
  { id: 17, title: "Search",    url: "https://search.example", pinned: false, active: false }, // col2 r1 (shot)
  { id: SELF_ID, title: "foxcade", url: "moz-extension://self", pinned: false, active: false } // col3 r1 PROTECTED (self)
];
const PROTECTED_IDS = [15, 16, SELF_ID];
const CLOSABLE_IDS = [10, 11, 12, 13, 14, 17];

async function mockBrowser(page) {
  await page.addInitScript((cfg) => {
    window.__removed = [];
    window.__restored = 0;
    window.__created = [];
    const tabs = cfg.tabs;
    window.browser = {
      permissions: { async request() { return true; } },
      tabs: {
        async query() { return tabs; },
        async getCurrent() { return { id: cfg.selfId }; },
        remove(id) { window.__removed.push(id); },
        create(opts) { window.__created.push(opts); }
      },
      sessions: { restore() { window.__restored++; } }
    };
    // Skip real model loading; the catalog does not need it.
    window.__FORGE_MODEL__ = {
      async generateAsync() { return "{}"; },
      generate() { return "{}"; }
    };
  }, { tabs: TABS, selfId: SELF_ID });
}

test("real-tab close path: protects pinned/active/self, closes only shot tabs, undo reopens", async ({ page }) => {
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));

  await mockBrowser(page);
  await page.goto("/feed.html");

  // The catalog renders one card per game; open the tab-shooter.
  const card = page.getByRole("button", { name: /Tab Shooter/i }).first();
  await card.click();
  await expect(page.locator("#stage")).toBeVisible();

  // Sweep the player left/right across all columns while firing, so closable tabs
  // are reliably hit regardless of the seeded layout (deterministic — protected
  // tabs are still invulnerable in the engine, so sweeping can't close them).
  await page.keyboard.down("Space");
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight");
    await page.waitForTimeout(200);
  }
  await page.keyboard.up("Space");
  await page.waitForTimeout(600); // let in-flight bullets land before snapshot

  const removed = await page.evaluate(() => window.__removed);
  expect(removed.length, "at least one closable tab was shot and closed").toBeGreaterThan(0);
  for (const id of removed) {
    expect(PROTECTED_IDS, `protected tab ${id} must never be removed`).not.toContain(id);
    expect(CLOSABLE_IDS, `only closable tabs may be removed (${id})`).toContain(id);
  }

  // Undo reopens every closed tab via sessions.restore (one call per stashed tab).
  const undo = page.locator("#tab-undo");
  await expect(undo).toBeVisible();
  await undo.click();
  const restored = await page.evaluate(() => window.__restored);
  expect(restored, "undo reopened each closed tab").toBe(removed.length);

  expect(errors, "the real-tab path logs no errors").toEqual([]);
});
