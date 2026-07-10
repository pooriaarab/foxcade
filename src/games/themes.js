import { assetUrl } from "./atlas.js";

export const PALETTES = {
  neon:  { bg:"#0b0033", fg:"#39ff14", accent:"#ff2fd0", hud:"#f8f8f8" },
  retro: { bg:"#1a1a2e", fg:"#e94560", accent:"#ffd166", hud:"#f5f5f5" },
  mono:  { bg:"#111", fg:"#eee", accent:"#777", hud:"#aaa" }
};

// A THEME is a superset of the old palette record. Games still read only
// {bg,fg,accent,hud} off the object the renderer hands to engine.draw(), so a
// theme drops in with ZERO per-game code. The extra fields are consumed
// centrally by the renderer (bg + font + hud) and by the shape seam (skin).
//
//   palette : { bg, fg, accent, hud, particles }   // particles = new 5th role
//   skin    : vector-shape FINISH id (shapes.drawShape reads it): glow/sharp/
//             round/flat/pixel/sketch — restyles every silhouette dramatically
//   art     : sprite SOURCE id the renderer picks per theme (engine-base):
//               "vector" pure drawShape vectors in the theme skin
//               "pixel"  procedural pixel-art (procsprites) for mapped kinds,
//                        vector+pixel-skin for the rest → coherent for ANY game
//               "photo"  photo atlas where it fits (space/platformer sheets),
//                        vector+skin elsewhere — the pre-shuffle default look
//   sprites : null today; future sprite-atlas ref { sheet, frames } (see §4)
//   bg      : background style id -> drawBackground()
//   audio   : audio-set id (sfx pack) — data only until an audio layer exists
//   font    : canvas font string for HUD/overlay text
//
// neon/retro/mono keep their original colors (PALETTES) so nothing regresses.
// skin + art are chosen so shuffling a theme changes both the SHAPE STYLE and
// the SPRITE SOURCE — every mood reads as a distinct look, not just a recolor.
// `scene` names a real background image (assets/backgrounds/<scene>.png) drawn
// dimmed behind the game by drawBackground; the palette/gradient below stays the
// headless-safe fallback when the image isn't loaded. Scene is chosen to match
// the mood: space themes → nebula/starfield, nature/cozy → forest, etc.
export const THEMES = {
  neon:      { id:"neon",      mood:"Neon arcade",   palette:{ ...PALETTES.neon,  particles:"#00e5ff" }, skin:"glow",   art:"vector", sprites:null, bg:"grid",      scene:"starfield",     audio:"synth",   font:"20px monospace" },
  retro:     { id:"retro",     mood:"Retro CRT",     palette:{ ...PALETTES.retro, particles:"#ff8c42" }, skin:"pixel",  art:"pixel",  sprites:null, bg:"scanlines", scene:"starfield",     audio:"arcade",  font:"20px monospace" },
  mono:      { id:"mono",      mood:"Minimal mono",  palette:{ ...PALETTES.mono,  particles:"#555555" }, skin:"flat",   art:"vector", sprites:null, bg:"flat",      scene:"hills",         audio:"silent",  font:"20px monospace" },
  horror:    { id:"horror",    mood:"Horror",        palette:{ bg:"#0a0a0a", fg:"#8b0000", accent:"#b22222", hud:"#d0d0d0", particles:"#400000" }, skin:"sketch", art:"vector", sprites:null, bg:"vignette", scene:"talltrees",     audio:"drone",  font:"20px Georgia, serif" },
  cozy:      { id:"cozy",      mood:"Cozy",          palette:{ bg:"#2b2118", fg:"#f2c078", accent:"#e07a5f", hud:"#f4e9d8", particles:"#f2cc8f" }, skin:"round",  art:"vector", sprites:null, bg:"gradient", scene:"forest",        audio:"ambient", font:"20px 'Trebuchet MS', sans-serif" },
  vaporwave: { id:"vaporwave", mood:"Vaporwave",     palette:{ bg:"#2d1b4e", fg:"#ff71ce", accent:"#01cdfe", hud:"#fff5ff", particles:"#b967ff" }, skin:"glow",   art:"vector", sprites:null, bg:"gradient", scene:"nebula_purple", audio:"synth",   font:"20px 'Courier New', monospace" },
  pastel:    { id:"pastel",    mood:"Pastel",        palette:{ bg:"#fdf6f0", fg:"#6b5b95", accent:"#ff9aa2", hud:"#4a4a4a", particles:"#b5ead7" }, skin:"round",  art:"vector", sprites:null, bg:"flat",     scene:"forest",        audio:"soft",    font:"20px 'Trebuchet MS', sans-serif" },
  eightbit:  { id:"eightbit",  mood:"8-bit",         palette:{ bg:"#1c1c1c", fg:"#fce0a2", accent:"#d82800", hud:"#ffffff", particles:"#6f4f28" }, skin:"pixel",  art:"pixel",  sprites:null, bg:"flat",     scene:"starfield",     audio:"chip",    font:"18px monospace" },
  handdrawn: { id:"handdrawn", mood:"Hand-drawn",    palette:{ bg:"#fffef2", fg:"#2b2b2b", accent:"#d1495b", hud:"#2b2b2b", particles:"#8d99ae" }, skin:"sketch", art:"vector", sprites:null, bg:"paper",    scene:"hills",         audio:"foley",   font:"20px 'Comic Sans MS', cursive" },
  scifi:     { id:"scifi",     mood:"Sci-fi",        palette:{ bg:"#05141f", fg:"#7fdbff", accent:"#ffdc00", hud:"#e6f7ff", particles:"#39cccc" }, skin:"sharp",  art:"photo",  sprites:null, bg:"grid",     scene:"nebula_blue",   audio:"hum",     font:"20px monospace" },
  nature:    { id:"nature",    mood:"Nature",        palette:{ bg:"#14342b", fg:"#a3d9a5", accent:"#f6ae2d", hud:"#eaf4e0", particles:"#8fbf7f" }, skin:"round",  art:"vector", sprites:null, bg:"gradient", scene:"forest",        audio:"ambient", font:"20px 'Trebuchet MS', sans-serif" },
  candy:     { id:"candy",     mood:"Candy",         palette:{ bg:"#fff0f6", fg:"#ff4d9d", accent:"#4dd0ff", hud:"#5a2a4a", particles:"#ffd166" }, skin:"round",  art:"pixel",  sprites:null, bg:"gradient", scene:"desert",        audio:"bubbly",  font:"20px 'Trebuchet MS', sans-serif" }
};

// Known scene ids (background images under assets/backgrounds/). SEAMLESS scenes
// tile on both axes (the space set); the rest are single landscape backdrops
// anchored to the bottom. Exported so the renderer + tests share one gate.
export const SCENES = ["forest", "talltrees", "desert", "hills", "nebula_purple", "nebula_blue", "starfield"];
const SEAMLESS = new Set(["nebula_purple", "nebula_blue", "starfield"]);

// Valid sprite-source ids. Exported so the renderer + tests share one gate.
export const ART_SOURCES = ["vector", "pixel", "photo"];

export const THEME_IDS = Object.keys(THEMES);

export function getTheme(id) {
  return THEMES[id] || THEMES.retro;
}

// The palette object the renderer hands to engine.draw() — same 4 legacy keys
// every game already reads, plus `particles`. Games never see the rest.
export function getPalette(id) {
  return getTheme(id).palette;
}

// Deterministic per-card theme: decorrelate from the game-type pick so the same
// game type shows up in different skins across the feed. Mixing constant is an
// odd number coprime-ish with 12 so consecutive cards rotate through moods.
export function themeForSeed(seed, index = 0) {
  const n = THEME_IDS.length;
  return THEME_IDS[(((seed >>> 4) + index * 7) % n + n) % n];
}

// Schema field every game reuses — one import, one line. validate() already
// gates any unknown value back to the default, so this IS the validator gate.
export const THEME_FIELD = { type: "string", enum: THEME_IDS, default: "retro" };

// Lazy scene-image loader. One Image per scene id, decoded once; until it's
// ready (and in headless Node, where Image is undefined) sceneImage returns an
// unready/null record and drawScene is a no-op, so the palette/gradient stays in
// charge. Same vector-until-ready contract as loadAtlas.
const sceneCache = {};
const sceneReadyCbs = [];
function sceneImage(id) {
  if (!id) return null;
  if (id in sceneCache) return sceneCache[id];
  if (typeof Image === "undefined") { sceneCache[id] = null; return null; } // headless
  const rec = { img: null, ready: false };
  const img = new Image();
  img.onload = () => { rec.img = img; rec.ready = true; sceneReadyCbs.forEach(f => f(id)); };
  img.onerror = () => {}; // missing asset → stay on palette fallback
  img.src = assetUrl(`assets/backgrounds/${id}.png`);
  sceneCache[id] = rec;
  return rec;
}

// Kick off every theme's scene image so static one-shot renders (feed cards) can
// redraw once decoded. `onSceneReady` fires per scene as it loads.
export function preloadScenes() { for (const t of Object.values(THEMES)) sceneImage(t.scene); }
export function onSceneReady(cb) { if (typeof cb === "function") sceneReadyCbs.push(cb); }

// Draw the themed scenery image behind the game, dimmed so it never fights the
// entities for readability. Seamless space tiles cover the canvas with a slow
// vertical parallax drift; landscape backdrops are scaled to slightly overscan
// the width, anchored to the bottom (ground low, themed sky above), and panned a
// few px within the overscan. `t` is elapsed ms — the only state hint needed.
// No-op until the image decodes, so headless/missing-asset renders stay safe.
function drawScene(ctx, theme, W, H, t) {
  const rec = sceneImage(theme.scene);
  if (!rec || !rec.ready) return;
  const img = rec.img, iw = img.width, ih = img.height;
  ctx.save();
  ctx.globalAlpha = 0.32;
  if (SEAMLESS.has(theme.scene)) {
    const off = ((t * 0.006) % ih + ih) % ih; // slow downward drift, wrapped
    for (let y = -ih + off; y < H; y += ih)
      for (let x = 0; x < W; x += iw) ctx.drawImage(img, x, y, iw, ih);
  } else {
    const scale = (W * 1.15) / iw;
    const dw = iw * scale, dh = ih * scale;
    const overscan = dw - W;
    const pan = Math.sin(t * 0.0004) * overscan * 0.5; // ping-pong, no wrap seam
    ctx.drawImage(img, -overscan / 2 + pan, H - dh, dw, dh);
  }
  ctx.restore();
}

// Central background renderer: palette fill, then the themed scenery image (a
// no-op until it loads), then the per-theme style overlay. `t` (elapsed ms)
// drives subtle scene parallax; passing nothing just freezes the scene.
export function drawBackground(ctx, theme, W, H, t = 0) {
  const p = theme.palette;
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  drawScene(ctx, theme, W, H, t);
  ctx.save();
  if (theme.bg === "grid") {
    ctx.globalAlpha = 0.15; ctx.strokeStyle = p.particles; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } else if (theme.bg === "scanlines") {
    ctx.globalAlpha = 0.08; ctx.fillStyle = "#000";
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  } else if (theme.bg === "gradient") {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, p.bg); g.addColorStop(1, p.particles);
    ctx.globalAlpha = 0.5; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (theme.bg === "vignette") {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (theme.bg === "paper" || theme.bg === "flat") {
    /* flat fill already applied */
  }
  ctx.restore();
}

// --- self-check (node --test or run directly) ---------------------------
export function _demo() {
  console.assert(THEME_IDS.length === 12, "expect 12 moods");
  console.assert(getTheme("nope").id === "retro", "unknown theme -> retro");
  console.assert(THEME_IDS.every(id => ART_SOURCES.includes(getTheme(id).art)), "every theme has a valid art source");
  console.assert(THEME_IDS.every(id => SCENES.includes(getTheme(id).scene)), "every theme maps to a known scene");
  console.assert("bg" in getPalette("neon") && "particles" in getPalette("neon"), "palette keeps legacy roles + particles");
  // decorrelation: same seed, different card index -> can differ; deterministic
  console.assert(themeForSeed(123, 0) === themeForSeed(123, 0), "deterministic");
  const spread = new Set(Array.from({ length: 12 }, (_, i) => themeForSeed(100, i)));
  console.assert(spread.size >= 6, "consecutive cards rotate moods");
  console.assert(THEME_FIELD.enum === THEME_IDS && THEME_FIELD.default === "retro", "field gated to known ids");
}
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) _demo();
