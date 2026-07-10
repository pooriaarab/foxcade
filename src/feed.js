import { probe } from "./pipeline/capability.js";
import { route } from "./pipeline/router.js";
import { fill } from "./pipeline/paramfill.js";
import { validate } from "./pipeline/validate.js";
import { HeuristicModel } from "./pipeline/model.js";
import { registry } from "./games/registry.js";
import { makeLoop } from "./games/engine-base.js";
import { pickModifiers, validateModifiers } from "./games/modifiers.js";
import { drawBackground, getTheme, themeForSeed, preloadScenes, onSceneReady } from "./games/themes.js";
import { dailySeed, encodeGame, isBeaten, nextStreak, pickDaily, shareText, todayStr } from "./daily.js";
import { isMuted, setMuted } from "./games/audio.js";

const W = 400, H = 600;
const PREVIEW_W = 168, PREVIEW_H = 252;
const DAILY_STORAGE_KEY = "foxcade.daily";
const DAILY_REMINDER_KEY = "foxcade.dailyReminder";
const DAILY_ALARM_NAME = "foxcade-daily-reminder";
const MUTE_KEY = "foxcade.muted";
const $ = id => document.getElementById(id);
let model = new HeuristicModel();
let mode = "heuristic";
let shuffle = 0;
let current = null;
let opened = null; // { game, cfg } for the game in the overlay — powers "Copy link"
const dailyDate = todayStr();
const dailyPick = pickDaily(dailyDate, registry);
const feedSeed = dailySeed(dailyDate);

function setMode(nextMode) {
  mode = nextMode;
  $("mode").textContent = mode === "local-ai" ? "local AI" : "offline picks";
}

function puzzleThumb(game) {
  // Static, never-crash card art: a small empty grid + the puzzle label.
  const thumb = document.createElement("div");
  thumb.className = "puzzle-thumb";
  const grid = document.createElement("div");
  grid.className = "puzzle-thumb-grid";
  for (let i = 0; i < 25; i++) grid.append(document.createElement("span"));
  const label = document.createElement("span");
  label.className = "puzzle-thumb-label";
  label.textContent = game.meta.label;
  thumb.append(grid, label);
  return thumb;
}

// Static card art for a WebGL game: a gradient + the label, drawn on a plain 2D
// canvas. Never touches WebGL, so previews stay cheap and never fail.
function threeThumb(game, cfg) {
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_W;
  canvas.height = PREVIEW_H;
  const ctx = canvas.getContext("2d");
  const pal = getTheme(cfg.theme).palette;
  const g = ctx.createLinearGradient(0, 0, 0, PREVIEW_H);
  g.addColorStop(0, pal.bg);
  g.addColorStop(1, pal.particles || pal.accent);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  ctx.fillStyle = pal.hud;
  ctx.font = "16px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(game.meta.label, PREVIEW_W / 2, PREVIEW_H / 2);
  return canvas;
}

// Static card art for the real-map game: a gradient + a stylized route line and
// two stops. Never initialises MapLibre (perf + no network for previews).
function mapThumb(game, cfg) {
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_W;
  canvas.height = PREVIEW_H;
  const ctx = canvas.getContext("2d");
  const pal = getTheme(cfg.theme).palette;
  const g = ctx.createLinearGradient(0, 0, PREVIEW_W, PREVIEW_H);
  g.addColorStop(0, pal.bg);
  g.addColorStop(1, pal.particles || pal.accent);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  // A winding route between two stops.
  ctx.strokeStyle = pal.fg;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(30, PREVIEW_H - 40);
  ctx.lineTo(70, PREVIEW_H - 90);
  ctx.lineTo(100, PREVIEW_H - 70);
  ctx.lineTo(PREVIEW_W - 30, 60);
  ctx.stroke();
  ctx.fillStyle = pal.accent;
  ctx.beginPath(); ctx.arc(30, PREVIEW_H - 40, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.hud;
  ctx.beginPath(); ctx.arc(PREVIEW_W - 30, 60, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.hud;
  ctx.font = "16px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(game.meta.label, PREVIEW_W / 2, PREVIEW_H / 2);
  return canvas;
}

function drawPreview(game, cfg) {
  if (game.type === "puzzle") return puzzleThumb(game);
  if (game.type === "three") return threeThumb(game, cfg);
  if (game.type === "map") return mapThumb(game, cfg);
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_W;
  canvas.height = PREVIEW_H;
  const ctx = canvas.getContext("2d");
  ctx.scale(PREVIEW_W / W, PREVIEW_H / H);
  const theme = getTheme(cfg.theme);
  const pal = theme.palette;
  drawBackground(ctx, theme, W, H);
  ctx.fillStyle = pal.fg;
  try {
    game.engine.draw(ctx, game.engine.init(cfg), pal);
  } catch (e) {
    console.error("feed: preview draw failed", e);
    ctx.fillStyle = pal.hud;
    ctx.font = theme.font.replace(/^\d+px/, "28px");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(game.meta.label, W / 2, H / 2);
  }
  return canvas;
}

async function makeConfig(prompt, activeModel, fixedKey = null) {
  // When the caller already fixed the game (daily mode), skip the routing LLM
  // round-trip entirely — it would only be discarded.
  const key = fixedKey && registry[fixedKey]
    ? fixedKey
    : await route(prompt, activeModel, registry);
  const game = registry[key] || registry[Object.keys(registry)[0]];
  const raw = await fill(prompt, game, activeModel);
  // Sandbox composes a full game-spec behind its own crash-proof gate; every
  // other game validates its flat schema. Both never throw.
  const cfg = game.specValidate ? game.specValidate(raw) : validate(raw, game.schema);
  // Prompt-driven rule modifiers, set post-validate (validate strips unknown keys).
  // The catalog leaves these empty; daily / prompted games vary by their text.
  cfg.modifiers = validateModifiers(pickModifiers(prompt));
  return { game, cfg, prompt };
}

async function safeConfig(prompt, fixedKey = null) {
  try {
    return await makeConfig(prompt, model, fixedKey);
  } catch (e) {
    console.error("feed: model path failed, falling back to heuristic", e);
    model = new HeuristicModel();
    setMode("heuristic");
    try {
      return await makeConfig(prompt, model, fixedKey);
    } catch (e2) {
      // Even the heuristic path failed — never wedge the feed. Emit a guaranteed
      // valid default game (validate() never throws; registry is always non-empty).
      console.error("feed: heuristic path failed, using defaults", e2);
      const game = fixedKey && registry[fixedKey] ? registry[fixedKey] : registry[Object.keys(registry)[0]];
      return { game, cfg: game.specValidate ? game.specValidate({}) : validate({}, game.schema), prompt };
    }
  }
}

// Guarded browser-tabs adapter — the ONLY place browser.* is touched for a
// game. The tabshooter engine stays pure: it only ever reads cfg.targets and
// pushes ids to state.closedIds; every real-tab side effect lives here.
// Returns true if real tabs were wired, false → engine falls back to demo mode.
async function wireRealTabs(cfg) {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.tabs?.query) return false; // no API → demo mode
  try {
    // "tabs" is optional — request it on this user gesture. Denied → demo mode.
    if (api.permissions?.request) {
      const granted = await api.permissions.request({ permissions: ["tabs"] });
      if (!granted) return false;
    }
    const tabs = await api.tabs.query({ currentWindow: true });
    let selfId;
    try { selfId = (await api.tabs.getCurrent?.())?.id; } catch { /* not addressable here */ }
    // SAFETY: pinned, the active tab, and the extension's own page are protected
    // → the engine draws them locked and never closes them.
    const isProtected = t => Boolean(t.pinned || t.active || t.id === selfId);
    const byId = new Map(tabs.map(t => [t.id, t]));
    const reopen = []; // {url} stashed BEFORE removal, drained by the undo button
    cfg.targets = tabs.map(t => ({ id: t.id, title: t.title || t.url || "tab", protected: isProtected(t) }));
    cfg.onClose = id => {
      const tab = byId.get(id);
      if (!tab || isProtected(tab)) return; // never close a protected tab
      reopen.push({ url: tab.url }); // capture for undo BEFORE removing
      showUndo(api, reopen);
      try { api.tabs.remove(id); } catch (e) { console.error("feed: tab close failed", e); }
    };
    return true;
  } catch (e) {
    console.error("feed: real-tab wiring failed, playing demo", e);
    return false;
  }
}

// Undo affordance: reveal a button once a tab has been closed. Reopens closed
// tabs via sessions.restore (fallback tabs.create with the stashed url).
function showUndo(api, reopen) {
  let btn = $("tab-undo");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "tab-undo";
    btn.type = "button";
    btn.className = "close-button";
    btn.textContent = "Undo — reopen closed tabs";
    btn.addEventListener("click", () => {
      for (const it of reopen.splice(0)) {
        try {
          if (api.sessions?.restore) api.sessions.restore();
          else if (it.url && api.tabs?.create) api.tabs.create({ url: it.url, active: false });
        } catch (e) { console.error("feed: reopen failed", e); }
      }
      btn.remove();
    });
    // Insert in the top button row (before the canvas) — the shell is a vertical
    // grid, so appending after the full-height canvas would push it off-screen.
    const shell = document.querySelector("#overlay .play-shell");
    shell.insertBefore(btn, shell.querySelector("#stage"));
  }
  btn.hidden = false;
}

async function openGame(game, cfg, seed = feedSeed) {
  if (current) current.destroy();
  opened = { game, cfg };
  const overlay = $("overlay");
  const stage = $("stage");
  const stage3d = $("stage3d");
  const stagemap = $("stagemap");
  const board = $("board");
  // Daily share reads results off #stage.dataset regardless of game type.
  stage.dataset.gameover = "";
  stage.dataset.won = "";
  stage.dataset.score = "";
  stage3d.hidden = true;
  stagemap.hidden = true;
  $("tab-undo")?.remove();
  overlay.hidden = false;

  if (game.type === "puzzle") {
    stage.hidden = true;
    board.hidden = false;
    board.textContent = "";
    const puzzleState = game.puzzle.generate(cfg, seed);
    current = game.puzzle.mount(board, puzzleState, {
      onDone({ solved, score }) {
        stage.dataset.gameover = "1";
        stage.dataset.won = solved ? "1" : "";
        stage.dataset.score = score == null ? "" : String(score);
      }
    });
    board.focus();
    return;
  }

  // WebGL games render to a dedicated canvas — a canvas cannot switch between
  // 2D and WebGL contexts, so #stage3d stays WebGL-only and #stage stays 2D.
  // mount() feature-detects WebGL and shows a graceful notice if it is missing.
  if (game.type === "three") {
    board.hidden = true;
    stage.hidden = true;
    stage3d.hidden = false;
    current = game.three.mount(stage3d, game.three.generate(cfg, seed), {
      onDone({ solved, score }) {
        stage.dataset.gameover = "1";
        stage.dataset.won = solved ? "1" : "";
        stage.dataset.score = score == null ? "" : String(score);
      }
    });
    stage3d.focus();
    return;
  }

  // The real-map game renders into a plain div; MapLibre GL fills it with a WebGL
  // canvas and is lazy-imported only here. It is the one game that fetches live
  // vector tiles over the network — mount() degrades to a notice if that fails.
  if (game.type === "map") {
    board.hidden = true;
    stage.hidden = true;
    stagemap.hidden = false;
    current = game.map.mount(stagemap, game.map.generate(cfg, seed), {
      onDone({ solved, score }) {
        stage.dataset.gameover = "1";
        stage.dataset.won = solved ? "1" : "";
        stage.dataset.score = score == null ? "" : String(score);
      }
    });
    stagemap.focus();
    return;
  }

  board.hidden = true;
  stage.hidden = false;
  const theme = getTheme(cfg.theme);
  stage.width = W;
  stage.height = H;
  drawBackground(stage.getContext("2d"), theme, W, H);
  // The signature feature: play against your real open tabs. If tabs can't be
  // wired (no API / permission denied), the engine uses its demo targets.
  if (game.key === "tabshooter") await wireRealTabs(cfg);
  current = makeLoop(stage, game, cfg);
  stage.focus();
}

function closeGame() {
  if (current) {
    current.destroy();
    current = null;
  }
  $("tab-undo")?.remove();
  $("overlay").hidden = true;
}

function addCard(game, cfg, seed = feedSeed) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "game-card";
  card.append(drawPreview(game, cfg));

  const label = document.createElement("strong");
  label.textContent = game.meta.label;
  const title = document.createElement("span");
  title.textContent = cfg.title;
  card.append(label, title);
  card.addEventListener("click", () => openGame(game, cfg, seed));
  $("grid").append(card);
}

function readStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error("feed: failed to read storage", e);
    return fallback;
  }
}

function loadDailyState() {
  const raw = readStorageJson(DAILY_STORAGE_KEY, {});
  return {
    lastPlayed: typeof raw.lastPlayed === "string" ? raw.lastPlayed : undefined,
    streak: Number.isFinite(raw.streak) ? raw.streak : 0,
    best: Number.isFinite(raw.best) ? raw.best : 0
  };
}

function saveDailyState(state) {
  try {
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("feed: failed to save daily state", e);
  }
}

function loadReminderEnabled() {
  try {
    return localStorage.getItem(DAILY_REMINDER_KEY) === "1";
  } catch {
    return false;
  }
}

function saveReminderEnabled(enabled) {
  try {
    localStorage.setItem(DAILY_REMINDER_KEY, enabled ? "1" : "0");
  } catch (e) {
    console.error("feed: failed to save reminder state", e);
  }
}

function renderDailyState(state = loadDailyState()) {
  $("daily-streak").textContent = `Streak ${state.streak} | Best ${state.best}`;
}

function renderReminderButton() {
  const enabled = loadReminderEnabled();
  const button = $("daily-reminder");
  button.textContent = enabled ? "Daily reminder on" : "Remind me daily";
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
}

function renderDaily() {
  const game = registry[dailyPick.key];
  // Show the game that will actually be played (pickDaily's key), not the
  // uncorrelated seed prompt.
  $("daily-prompt").textContent = `Today's game: ${game.meta.label}`;
  $("daily-meta").textContent = `${dailyDate} | target ${dailyPick.target} | seed ${dailyPick.seed}`;
  renderDailyState();
  renderReminderButton();
}

function minutesUntilNextReminder() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 60000));
}

function createReminderAlarm(api) {
  api.alarms.create(DAILY_ALARM_NAME, {
    delayInMinutes: minutesUntilNextReminder(),
    periodInMinutes: 24 * 60
  });
}

async function openDailyGame() {
  $("daily-play").disabled = true;
  $("status").textContent = "Generating today's foxcade...";
  try {
    const { game, cfg } = await safeConfig(dailyPick.prompt, dailyPick.key);
    cfg.theme = dailyPick.theme;
    const state = nextStreak(loadDailyState(), dailyDate);
    saveDailyState(state);
    renderDailyState(state);
    openGame(game, cfg, dailyPick.seed);
  } finally {
    $("daily-play").disabled = false;
    $("status").textContent = "";
  }
}

async function copyDailyResult() {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) {
    $("status").textContent = "Clipboard unavailable.";
    return;
  }

  const state = loadDailyState();
  const stage = $("stage");
  // "Beaten" = a genuine win OR reaching the day's target score, so endless
  // games (which never set won) still have a real daily outcome to share.
  const played = !$("overlay").hidden && stage.dataset.gameover === "1";
  const won = stage.dataset.won === "1";
  const score = stage.dataset.score ? Number(stage.dataset.score) : null;
  const solve = registry[dailyPick.key]?.meta?.dailyMode === "solve";
  const beaten = played && isBeaten({ won, score }, dailyPick.target, solve);
  const text = shareText(dailyDate, { beaten, score, target: dailyPick.target, streak: state.streak });
  try {
    await clipboard.writeText(text);
    $("daily-copy").textContent = "Copied";
    $("status").textContent = "Daily result copied.";
    setTimeout(() => { $("daily-copy").textContent = "Copy result"; }, 1200);
  } catch (e) {
    console.error("feed: copy failed", e);
    $("status").textContent = "Copy failed.";
  }
}

async function toggleReminder() {
  const api = globalThis.browser ?? globalThis.chrome;
  if (loadReminderEnabled()) {
    try {
      if (api?.alarms?.clear) await api.alarms.clear(DAILY_ALARM_NAME);
    } catch (e) {
      console.error("feed: reminder clear failed", e);
    }
    saveReminderEnabled(false);
    renderReminderButton();
    $("status").textContent = "Daily reminder off.";
    return;
  }

  if (!api?.permissions?.request || !api?.alarms?.create) {
    $("status").textContent = "Daily reminders are unavailable here.";
    return;
  }

  try {
    // "alarms" is a required permission (Firefox forbids it as optional), so it is
    // already granted at install — only "notifications" needs a runtime request.
    const granted = await api.permissions.request({ permissions: ["notifications"] });
    if (!granted) {
      $("status").textContent = "Daily reminder permission not granted.";
      return;
    }
    createReminderAlarm(api);
    saveReminderEnabled(true);
    renderReminderButton();
    $("status").textContent = "Daily reminder on.";
  } catch (e) {
    console.error("feed: reminder setup failed", e);
    $("status").textContent = "Daily reminders are unavailable here.";
  }
}

// Show the FULL catalog: one card per registered game, each in a distinct mood.
// Model-independent + instant, so every game type is always visible (the model
// is only used for "prompt your own" on the forge page and the daily game).
// "Shuffle" re-rolls the moods across the same games.
function renderCatalog() {
  $("more").disabled = true;
  $("grid").textContent = "";
  const keys = Object.keys(registry);
  keys.forEach((key, i) => {
    const game = registry[key];
    const seed = feedSeed + shuffle * 997 + i * 31;
    const cfg = validate({ theme: themeForSeed(seed, i) }, game.schema);
    addCard(game, cfg, seed);
  });
  $("status").textContent = `${keys.length} games`;
  $("more").disabled = false;
}

async function start() {
  setMode("heuristic");
  try {
    const found = await probe(p => {
      const pct = typeof p?.progress === "number" ? Math.min(100, Math.round(p.progress)) : null;
      $("status").textContent = pct == null ? "Loading local model…" : `Loading local model… ${pct}%`;
    });
    model = found.model;
    setMode(found.mode);
  } catch (e) {
    console.error("feed: probe failed, using heuristic", e);
    model = new HeuristicModel();
    setMode("heuristic");
  }
  renderCatalog();
  // Scene images decode async; redraw the cards once each lands so the feed
  // shows real scenery (not just the palette fallback). Throttled to one repaint.
  preloadScenes();
  let queued = false;
  onSceneReady(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderCatalog(); });
  });
}

$("more").addEventListener("click", () => { shuffle++; renderCatalog(); });
$("daily").addEventListener("click", e => {
  if (e.target.closest("button")) return;
  openDailyGame();
});
$("daily").addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openDailyGame();
  }
});
$("daily-play").addEventListener("click", e => {
  e.stopPropagation();
  openDailyGame();
});
$("daily-copy").addEventListener("click", e => {
  e.stopPropagation();
  copyDailyResult();
});
$("daily-reminder").addEventListener("click", e => {
  e.stopPropagation();
  toggleReminder();
});
// Share-as-URL: encode the open game and copy a forge.html link that replays it.
async function shareGame() {
  if (!opened) return;
  const token = encodeGame(opened.game.key, opened.cfg);
  const url = `${new URL("forge.html", location.href).href}#${token}`;
  const clip = globalThis.navigator?.clipboard;
  const share = $("share");
  if (clip?.writeText) {
    try {
      await clip.writeText(url);
      share.textContent = "Link copied";
      setTimeout(() => { share.textContent = "Copy link"; }, 1200);
      return;
    } catch (e) {
      console.error("feed: copy link failed", e);
    }
  }
  $("status").textContent = url; // no clipboard → surface it so it's still copyable
}

function renderMute() {
  const b = $("mute");
  b.textContent = isMuted() ? "Sound off" : "Sound on";
  b.setAttribute("aria-pressed", isMuted() ? "true" : "false");
}

function initMute() {
  let m = false;
  try { m = localStorage.getItem(MUTE_KEY) === "1"; } catch { /* storage denied */ }
  setMuted(m);
  renderMute();
}

$("close").addEventListener("click", closeGame);
$("share").addEventListener("click", shareGame);
$("mute").addEventListener("click", () => {
  setMuted(!isMuted());
  try { localStorage.setItem(MUTE_KEY, isMuted() ? "1" : "0"); } catch { /* storage denied */ }
  renderMute();
});
$("overlay").addEventListener("click", e => { if (e.target === $("overlay")) closeGame(); });
window.addEventListener("keydown", e => { if (e.key === "Escape" && !$("overlay").hidden) closeGame(); });

initMute();
renderDaily();
start();
