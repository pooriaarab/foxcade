import { test, expect } from "@playwright/test";

// The real-map game renders with a lazy-imported, vendored MapLibre GL **CSP
// build** and is the one game that fetches live vector tiles from OpenFreeMap.
// MapLibre needs WebGL + a same-origin tile worker, and CI may have no network
// (or a headless GL stack that MapLibre refuses), so this test tolerates all of
// that: it asserts the map container mounts and no uncaught error fires, and
// accepts EITHER a live map (MapLibre adds the .maplibregl-map class to
// #stagemap) OR the graceful "unavailable" notice. It never depends on the tile
// network or WebGL succeeding, so it is not flaky.
test("opening World Run mounts the map container without crashing", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(String(e)));

  // Router mock: echo the prompt as the chosen key, "{}" for param-fill
  // (→ validate fills schema defaults). Mirrors render-all.spec.
  await page.addInitScript(() => {
    const pick = (sys, user) => /Reply with EXACTLY one of/i.test(sys) ? user.trim() : "{}";
    window.__FORGE_MODEL__ = {
      async generateAsync(sys, user) { return pick(sys, user); },
      generate(sys, user) { return pick(sys, user); }
    };
  });

  await page.goto("/forge.html");
  await page.fill("#prompt", "worldmap");
  await page.click("#go");

  await expect(page.locator("#stagemap")).toBeVisible();

  // Lazy MapLibre import + init resolves into either a live map
  // (.maplibregl-map) or the notice (engine/WebGL unavailable). Wait for one so
  // the test doesn't race a fixed timeout; tolerate neither appearing (e.g. the
  // worker/import never resolving in a locked-down environment) without failing.
  await page.locator("#stagemap.maplibregl-map, .three-notice").first()
    .waitFor({ timeout: 10000 })
    .catch(() => { /* neither surfaced in this environment — still must not crash */ });

  const outcome = await page.evaluate(() => ({
    map: Boolean(document.querySelector("#stagemap.maplibregl-map")),
    notice: Boolean(document.querySelector(".three-notice")),
    mounted: Boolean(document.querySelector("#stagemap") && !document.getElementById("stagemap").hidden)
  }));

  expect(outcome.mounted, "map container is shown").toBeTruthy();
  expect(pageErrors, "no uncaught errors from the map game").toEqual([]);
});
