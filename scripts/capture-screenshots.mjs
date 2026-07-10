// Capture store screenshots for foxcade: real gameplay pixels, composited into
// polished 1280x800 hero frames (Chrome Web Store / AMO both accept 1280x800).
//
//   node scripts/capture-screenshots.mjs
//
// Needs the static server on :8080 (npm run serve) — start it first or let the
// caller start it. Output → screenshots/*.png.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = "http://localhost:8080";
const OUT = new URL("../screenshots/", import.meta.url).pathname;
const W = 1280, H = 800;

// Model + browser mocks so feed/forge run headless without the extension host.
const MOCKS = () => {
  const echo = (sys, user) => /Reply with EXACTLY one of/i.test(sys) ? user.trim() : "{}";
  window.__FORGE_MODEL__ = { async generateAsync(s, u) { return echo(s, u); }, generate(s, u) { return echo(s, u); } };
  const tabs = [];
  window.browser = {
    permissions: { async request() { return true; }, async contains() { return true; } },
    tabs: { async query() { return tabs; }, async getCurrent() { return { id: 1 }; }, remove() {}, create() {} },
    sessions: { restore() {} },
    runtime: { getURL: (p) => `${location.origin}/${p}` }
  };
};

// The five store shots: a catalog hero + four visually strong local games.
// (worldmap/citymap needs live map tiles + extension worker — captured manually.)
const GAMES = [
  { key: "raysurvive", title: "Browser-native FPS", tag: "Survive a first-person maze — rendered by a raycaster, no plugins." },
  { key: "platformer",  title: "Endless platforming", tag: "Levels escalate forever. Every run is generated from your prompt." },
  { key: "bullethell",  title: "Bullet-hell arcade", tag: "Dodge, weave, survive — classic arcade, made on your device." },
  { key: "sandbox",     title: "Build your own game", tag: "Assemble mechanics in the sandbox — no code, just play." }
];

const frame = (imgDataUrl, title, tag) => `<!doctype html><meta charset=utf8>
<style>
  html,body{margin:0}
  .stage{width:${W}px;height:${H}px;display:flex;align-items:center;gap:64px;
    padding:0 80px;box-sizing:border-box;font-family:-apple-system,Segoe UI,Roboto,sans-serif;
    background:radial-gradient(120% 120% at 15% 10%,#3a2d6b 0%,#1a1330 55%,#0d0a1a 100%);color:#fff}
  .shot{flex:0 0 auto;border-radius:22px;overflow:hidden;
    box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08);
    background:#000}
  .shot img{display:block;height:640px;width:auto}
  .copy{flex:1 1 auto;max-width:560px}
  .brand{font-size:26px;font-weight:800;letter-spacing:.4px;opacity:.9;margin-bottom:22px}
  .brand b{color:#ff7a3d}
  h1{font-size:52px;line-height:1.05;margin:0 0 20px;font-weight:800}
  p{font-size:26px;line-height:1.4;margin:0;color:#c9c3e6}
</style>
<div class=stage>
  <div class=shot><img src="${imgDataUrl}"></div>
  <div class=copy><div class=brand>fox<b>cade</b></div><h1>${title}</h1><p>${tag}</p></div>
</div>`;

const visibleSurface = async (page) => {
  const ids = ["stagemap", "stage3d", "board", "stage"];
  for (const id of ids) {
    const el = page.locator(`#${id}`);
    if (await el.count() && await el.isVisible()) return el;
  }
  return page.locator("#stage");
};

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(MOCKS);

  // 1 — catalog hero: the real feed UI, full 1280x800.
  await page.goto(`${BASE}/feed.html`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}01-catalog.png` });
  console.log("captured 01-catalog");

  // 2..N — each game, forged and animated, composited into a hero frame.
  let n = 2;
  for (const g of GAMES) {
    await page.goto(`${BASE}/forge.html`);
    await page.fill("#prompt", g.key);
    await page.click("#go");
    await page.waitForTimeout(500);
    const surface = await visibleSurface(page);
    await surface.focus().catch(() => {});
    // A short input burst so the frame shows motion, not a title screen.
    for (const k of ["ArrowRight", "Space", "ArrowRight", "ArrowUp", "Space", "ArrowLeft"]) {
      await page.keyboard.press(k).catch(() => {});
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(300);
    const buf = await surface.screenshot();
    const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
    await page.setContent(frame(dataUrl, g.title, g.tag), { waitUntil: "load" });
    await page.waitForTimeout(150);
    const name = `${String(n).padStart(2, "0")}-${g.key}.png`;
    await page.screenshot({ path: `${OUT}${name}` });
    console.log(`captured ${name}`);
    n++;
  }
  await browser.close();
};

run().then(() => console.log(`done → ${OUT}`)).catch((e) => { console.error(e); process.exit(1); });
