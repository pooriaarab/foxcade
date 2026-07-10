// Rule modifiers: orthogonal, game-agnostic transforms layered over ANY game by
// engine-base.makeLoop. Games never know they exist — a modifier only touches
// the three generic seams every game shares (the input handed to step, the dt
// scalar, and the rendered frame), so the same eight modifiers combine with all
// 23 games without editing a single game schema or engine.
//
// cfg.modifiers is a validated array of these ids, attached to the config by the
// pipeline AFTER validate() (validate strips unknown keys, so it is set on the
// returned object). makeLoop reads it, defaults to [], and pays zero cost when
// empty: every helper here early-returns on an empty / irrelevant array.

export const MODIFIER_IDS = ["invert", "mirror", "flipv", "fog", "turbo", "slowmo", "zoom", "timeattack"];

const MAX_MODIFIERS = 3;      // keep combinations sane + crash-proof
const TIME_ATTACK_MS = 45000; // ~45s countdown
const ZOOM_SCALE = 1.4;

// Prompt keyword → modifier id. One entry per id; first regex that hits wins.
const KEYWORDS = [
  [/invert|reversed? control/, "invert"],
  [/mirror/, "mirror"],
  [/upside[ -]?down|vertical(ly)? flip|flip(ped)? vertical/, "flipv"],
  [/fog|foggy|fog of war|\bdark\b/, "fog"],
  [/turbo|faster|\bfast\b|speedy|hyper/, "turbo"],
  [/slow[ -]?mo|slow motion|\bslow\b|sluggish/, "slowmo"],
  [/zoom|close[ -]?up/, "zoom"],
  [/time[ -]?attack|\btimed\b|time limit|countdown|beat the clock/, "timeattack"]
];

// Heuristic: map a free-text prompt to modifier ids. Backend-agnostic (works with
// any model or none), so it is the robust path for setting cfg.modifiers.
export function pickModifiers(text) {
  const t = String(text || "").toLowerCase();
  const out = [];
  for (const [re, id] of KEYWORDS) if (re.test(t)) out.push(id);
  return validateModifiers(out);
}

// Keep only known ids, de-duped, capped. Never throws — the trust boundary
// between whatever produced the array (model / heuristic / storage) and makeLoop.
export function validateModifiers(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const id of arr) {
    if (MODIFIER_IDS.includes(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_MODIFIERS) break;
  }
  return out;
}

const has = (mods, id) => mods.includes(id);

// Input remap. Returns the SAME object (zero alloc) when nothing swaps, else a
// shallow copy with the direction flags swapped — the real input keeps its raw
// state so the keydown/keyup handlers and the tap one-shot still work.
// invert swaps both axes; mirror swaps left/right so controls match the flipped
// view. Both present → left/right cancels (XOR), up/down still inverted.
// Positional px/py are inverse-transformed separately (pointerToGame below) so a
// tap on a mirrored/zoomed/flipped board lands on the cell the player sees.
export function applyInput(input, mods) {
  if (!has(mods, "invert") && !has(mods, "mirror")) return input;
  let swapLR = false, swapUD = false;
  if (has(mods, "invert")) { swapLR = !swapLR; swapUD = !swapUD; }
  if (has(mods, "mirror")) { swapLR = !swapLR; }
  const out = { ...input };
  if (swapLR) { out.left = input.right; out.right = input.left; }
  if (swapUD) { out.up = input.down; out.down = input.up; }
  return out;
}

// Inverse of preRender's geometric transform: map a RAW screen tap (px,py) back
// into game/world space for the active modifiers, so positional tap games
// (life/sand/rhythm/whack) hit what the player sees. preRender scales about the
// canvas centre by (sx·zoom, sy·zoom); this undoes it. Pure — no mods → identity.
export function pointerToGame(px, py, W, H, mods) {
  const sx = has(mods, "mirror") ? -1 : 1;
  const sy = has(mods, "flipv") ? -1 : 1;
  const zoom = has(mods, "zoom") ? ZOOM_SCALE : 1;
  if (sx === 1 && sy === 1 && zoom === 1) return { x: px, y: py };
  return {
    x: (px - W / 2) / (sx * zoom) + W / 2,
    y: (py - H / 2) / (sy * zoom) + H / 2
  };
}

// dt scaling. turbo accelerates with elapsed time; slowmo is a constant drag.
// Output is clamped so no modifier can hand a game a step big enough to tunnel.
export function scaleDt(dt, mods, elapsedMs) {
  if (!mods.length) return dt;
  let k = 1;
  if (has(mods, "turbo")) k *= Math.min(2.5, 1 + elapsedMs / 30000);
  if (has(mods, "slowmo")) k *= 0.6;
  return Math.min(4, dt * k);
}

// Pre-draw geometric transform of the world (mirror / flipv / zoom), scaled
// about the canvas center. Caller wraps this in ctx.save()/restore().
export function preRender(ctx, W, H, mods) {
  const sx = has(mods, "mirror") ? -1 : 1;
  const sy = has(mods, "flipv") ? -1 : 1;
  const zoom = has(mods, "zoom") ? ZOOM_SCALE : 1;
  if (sx === 1 && sy === 1 && zoom === 1) return;
  ctx.translate(W / 2, H / 2);
  ctx.scale(sx * zoom, sy * zoom);
  ctx.translate(-W / 2, -H / 2);
}

// Screen-space overlays drawn AFTER the world, upright (never mirrored): the
// fog-of-war darkness and the time-attack countdown. Returns true once the
// countdown has expired so makeLoop can force game-over.
export function postRender(ctx, W, H, mods, elapsedMs) {
  if (!mods.length) return false;
  if (has(mods, "fog")) {
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, H * 0.55);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.92)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (has(mods, "timeattack")) {
    const left = Math.max(0, Math.ceil((TIME_ATTACK_MS - elapsedMs) / 1000));
    ctx.save();
    ctx.fillStyle = left <= 5 ? "#ff5555" : "#ffffff";
    ctx.font = "20px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`${left}s`, W - 10, 10);
    ctx.restore();
  }
  return timeAttackOver(mods, elapsedMs);
}

// Has the time-attack countdown run out? Used to freeze the game step + to label
// the end overlay "TIME UP" instead of "GAME OVER".
export function timeAttackOver(mods, elapsedMs) {
  return has(mods, "timeattack") && elapsedMs >= TIME_ATTACK_MS;
}
