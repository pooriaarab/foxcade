import { themeForSeed } from "./games/themes.js";

function parseYmd(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError("Expected YYYY-MM-DD");
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10))
  };
}

function divFloor(n, d) {
  return Math.floor(n / d);
}

function dayNumber(value) {
  let { year, month, day } = parseYmd(value);
  year -= month <= 2 ? 1 : 0;
  const era = divFloor(year, 400);
  const yearOfEra = year - era * 400;
  const monthBase = month > 2 ? month - 3 : month + 9;
  const dayOfYear = divFloor(153 * monthBase + 2, 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + divFloor(yearOfEra, 4) - divFloor(yearOfEra, 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

export function dailySeed(dateStr) {
  let hash = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    hash ^= dateStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickDaily(dateStr, registry) {
  // Daily is the arcade "beat it" mode; only games with a 2D-canvas engine
  // play here. Turn-based puzzles (DOM) and WebGL games (need a WebGL context)
  // sit out so the shared streak/share flow — which reads #stage — stays coherent.
  const keys = Object.keys(registry).filter(key => registry[key].engine);
  if (!keys.length) throw new TypeError("Cannot pick a daily game from an empty registry");
  const seed = dailySeed(dateStr);
  const key = keys[seed % keys.length];
  // The prompt is derived from the chosen game (its label) instead of an
  // independent random flavor, so paramfill's title + pickModifiers correlate
  // with the game actually played — no more "spooky maze" text over a shooter.
  const prompt = registry[key].meta?.label || key;
  return {
    key,
    prompt,
    theme: themeForSeed(seed, 0),
    target: dailyTarget(seed),
    seed
  };
}

// Per-day score to "beat" for games that never report status.won (endless:
// shooter, dodger, snake-until-full…). Deterministic from the day seed, kept in
// a modest, broadly-reachable band so a daily is winnable across the catalog's
// very different score scales (points, ticks/10, distance, steps).
// ponytail: one flat band for every game; if a game's scale makes this trivial
// or impossible, give daily.js a per-key multiplier — not needed at this scale.
export function dailyTarget(seed) {
  return 8 + (seed >>> 12) % 15; // 8..22
}

// A daily is beaten when the game reports a genuine win OR (for endless arcade
// games that never set `won`) the player reaches the day's target score. For
// solve/goal games (game.meta.dailyMode === "solve": life/sand/rhythm/maze/…) a
// modest score target is meaningless — life starts already above it, sand only
// scores near its full quota — so those require the actual WIN. Pure — the single
// source of truth for the share/streak outcome, so the UI and tests agree.
export function isBeaten(status = {}, target = 0, solve = false) {
  if (status.won) return true;
  if (solve) return false;
  return Number.isFinite(status.score) && Number.isFinite(target) && status.score >= target;
}

// Serialize a forged game (key + validated config, which already carries theme
// + modifiers) into a URL-fragment token so a shared link replays that exact
// game. base64 of URI-encoded JSON → safe for location.hash. Robust by
// contract: decodeGame returns null for anything malformed.
export function encodeGame(key, cfg) {
  const json = JSON.stringify({ k: key, c: cfg });
  return typeof btoa === "function"
    ? btoa(encodeURIComponent(json))
    : Buffer.from(encodeURIComponent(json), "utf8").toString("base64");
}

export function decodeGame(token) {
  if (typeof token !== "string" || !token) return null;
  try {
    const json = decodeURIComponent(
      typeof atob === "function" ? atob(token) : Buffer.from(token, "base64").toString("utf8")
    );
    const obj = JSON.parse(json);
    if (!obj || typeof obj.k !== "string") return null;
    return { key: obj.k, cfg: obj.c && typeof obj.c === "object" ? obj.c : {} };
  } catch {
    return null; // bad hash → ignored
  }
}

export function dayDiff(a, b) {
  return dayNumber(b) - dayNumber(a);
}

export function nextStreak(prevState = {}, today) {
  const streak = Number.isFinite(prevState.streak) ? prevState.streak : 0;
  const best = Number.isFinite(prevState.best) ? prevState.best : 0;
  if (prevState.lastPlayed === today) {
    return { lastPlayed: prevState.lastPlayed, streak, best };
  }

  const next = prevState.lastPlayed && dayDiff(prevState.lastPlayed, today) === 1 ? streak + 1 : 1;
  return { lastPlayed: today, streak: next, best: Math.max(best, next) };
}

export function shareText(dateStr, { beaten = false, score = null, target = null, streak = 0 } = {}) {
  const scorePart =
    score == null ? "" : target == null ? ` ${score}` : ` ${score}/${target}`;
  const result = beaten ? `beaten${scorePart}` : `not beaten${scorePart}`;
  return `foxcade daily ${dateStr} -- ${result} . streak ${streak}`;
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
