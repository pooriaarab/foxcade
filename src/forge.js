import { probe } from "./pipeline/capability.js";
import { route } from "./pipeline/router.js";
import { fill } from "./pipeline/paramfill.js";
import { validate } from "./pipeline/validate.js";
import { HeuristicModel } from "./pipeline/model.js";
import { registry } from "./games/registry.js";
import { makeLoop } from "./games/engine-base.js";
import { pickModifiers, validateModifiers } from "./games/modifiers.js";
import { dailySeed, decodeGame, encodeGame } from "./daily.js";
import { isMuted, setMuted } from "./games/audio.js";

const $ = id => document.getElementById(id);
const MUTE_KEY = "foxcade.muted";
// probe lazily on first forge: the extension permission request needs a user gesture,
// so it must run inside the click handler, not at module load.
let modelP = null;
const getModel = () => (modelP ??= probe(p => {
  const pct = typeof p?.progress === "number" ? Math.min(100, Math.round(p.progress)) : null;
  $("status").textContent = pct == null ? "Loading local model…" : `Loading local model… ${pct}%`;
}));
let current = null, lastPrompt = "", lastKey = null, mounted = null;

function mount(game, cfg, note) {
  if (current) current.destroy();
  mounted = { game, cfg }; // remembered so "Copy link" can serialize it
  const stage = $("stage"); stage.dataset.gameover = "";
  const stage3d = $("stage3d"); stage3d.hidden = true;
  const stagemap = $("stagemap"); stagemap.hidden = true;
  const board = $("board");

  // The real-map game renders into a plain div and lazy-imports MapLibre GL only
  // here. It is the one game that fetches live vector map tiles over the network;
  // mount() degrades to a notice if the import/WebGL/tiles fail.
  if (game.type === "map") {
    board.hidden = true;
    stage.hidden = true;
    stagemap.hidden = false;
    const seed = dailySeed(lastPrompt || game.key);
    current = game.map.mount(stagemap, game.map.generate(cfg, seed), {
      onDone({ solved, score }) {
        $("status").textContent = `${game.meta.label} - ${solved ? "cleared" : "over"}${score == null ? "" : ` (score ${score})`}.`;
      }
    });
    stagemap.focus();
    $("remix").hidden = false;
    $("status").textContent = `${game.meta.label} - ${cfg.title}. Drive with the arrow keys. ${note || ""}`;
    return;
  }

  if (game.type === "three") {
    // WebGL games render to a dedicated canvas (2D and WebGL contexts cannot
    // share one canvas). mount() feature-detects WebGL and shows a notice if it
    // is unavailable — never crashing the forge.
    board.hidden = true;
    stage.hidden = true;
    stage3d.hidden = false;
    const seed = dailySeed(lastPrompt || game.key);
    current = game.three.mount(stage3d, game.three.generate(cfg, seed), {
      onDone({ solved, score }) {
        $("status").textContent = `${game.meta.label} — ${solved ? "cleared" : "over"}${score == null ? "" : ` (score ${score})`}.`;
      }
    });
    stage3d.focus();
    $("remix").hidden = false;
    $("status").textContent = `${game.meta.label} — ${cfg.title}. Aim with the mouse or arrows, Space to fire. ${note || ""}`;
    return;
  }

  if (game.type === "puzzle") {
    stage.hidden = true;
    board.hidden = false;
    board.textContent = "";
    // Seed from the prompt so the same request is reproducible; dailySeed is a
    // plain string hash, reused here for arbitrary text.
    const puzzleState = game.puzzle.generate(cfg, dailySeed(lastPrompt || game.key));
    current = game.puzzle.mount(board, puzzleState, {
      onDone({ solved, score }) {
        $("status").textContent = `${game.meta.label} — ${solved ? "solved" : "no luck"}${score == null ? "" : ` (score ${score})`}.`;
      }
    });
    board.focus();
    $("remix").hidden = false;
    $("status").textContent = `${game.meta.label} — ${cfg.title}. Type or tap to play. ${note || ""}`;
    return;
  }

  board.hidden = true;
  stage.hidden = false;
  current = makeLoop(stage, game, cfg);
  stage.focus();
  $("remix").hidden = false;
  $("status").textContent = `${game.meta.label} — ${cfg.title}. Arrows/Space or tap. ${note || ""}`;
}

async function forge(nudge = "") {
  const prompt = $("prompt").value.trim() || "surprise me";
  const { model, mode } = await getModel();
  $("mode").textContent = mode === "local-ai" ? "local AI" : mode === "heuristic" ? "offline picks" : "";
  $("status").textContent = "Forging…";
  lastPrompt = nudge ? lastPrompt : prompt;
  try {
    const key = nudge ? lastKey : await route(lastPrompt, model, registry);
    lastKey = key;
    const game = registry[key];
    const raw = await fill(lastPrompt, game, model, nudge);
    // Sandbox assembles a full game-spec behind its own crash-proof gate; every
    // other game validates its flat schema. Neither ever throws.
    const cfg = game.specValidate ? game.specValidate(raw) : validate(raw, game.schema);
    // Rule modifiers ride alongside the schema-validated config: derived from the
    // prompt heuristically (backend-agnostic) and set post-validate so validate()
    // does not strip them. makeLoop reads cfg.modifiers.
    cfg.modifiers = validateModifiers(pickModifiers(lastPrompt));
    mount(game, cfg);
  } catch (e) {
    // Model call failed (download/engine/OOM). Never leave the UI stuck:
    // fall back to a heuristic pick so a game still appears.
    console.error("forge: model path failed, falling back to heuristic", e);
    $("mode").textContent = "offline picks";
    const hm = new HeuristicModel();
    const key = nudge && lastKey ? lastKey : await route(lastPrompt, hm, registry);
    lastKey = key;
    const game = registry[key];
    const raw = await fill(lastPrompt, game, hm, nudge);
    const cfg = game.specValidate ? game.specValidate(raw) : validate(raw, game.schema);
    cfg.modifiers = validateModifiers(pickModifiers(lastPrompt));
    mount(game, cfg, "(local AI unavailable — offline pick)");
  }
}

// Share-as-URL: serialize the mounted game (key + validated cfg, which already
// carries theme + modifiers) into location.hash and copy the link. Opening it
// replays that exact game via hydrateFromHash below.
async function copyLink() {
  if (!mounted) return;
  const token = encodeGame(mounted.game.key, mounted.cfg);
  const url = `${location.origin}${location.pathname}#${token}`;
  const clip = globalThis.navigator?.clipboard;
  if (clip?.writeText) {
    try {
      await clip.writeText(url);
      $("status").textContent = "Link copied.";
      return;
    } catch (e) {
      console.error("forge: copy link failed", e);
    }
  }
  // No clipboard → drop the token in the address bar so it's still shareable.
  location.hash = token;
  $("status").textContent = "Link ready in the address bar.";
}

// Replay a shared game from location.hash. Bad/absent hash → ignored (returns
// false) so the page falls through to its normal empty state.
function hydrateFromHash() {
  const decoded = decodeGame(location.hash.slice(1));
  if (!decoded || !registry[decoded.key]) return false;
  const game = registry[decoded.key];
  try {
    const cfg = game.specValidate ? game.specValidate(decoded.cfg) : validate(decoded.cfg, game.schema);
    cfg.modifiers = validateModifiers(decoded.cfg.modifiers || []);
    lastKey = decoded.key;
    lastPrompt = cfg.title || decoded.key;
    mount(game, cfg, "(shared game)");
    return true;
  } catch (e) {
    console.error("forge: bad share hash, ignoring", e);
    return false;
  }
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

$("go").addEventListener("click", () => forge());
$("prompt").addEventListener("keydown", e => { if (e.key === "Enter") forge(); });
document.querySelectorAll("#remix button:not(#copy-link)").forEach(b =>
  b.addEventListener("click", () => forge(b.dataset.nudge)));
$("copy-link").addEventListener("click", copyLink);
$("mute").addEventListener("click", () => {
  setMuted(!isMuted());
  try { localStorage.setItem(MUTE_KEY, isMuted() ? "1" : "0"); } catch { /* storage denied */ }
  renderMute();
});

initMute();
hydrateFromHash();
