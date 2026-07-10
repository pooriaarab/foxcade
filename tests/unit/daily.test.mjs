import { test } from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../src/games/registry.js";
import { THEME_IDS } from "../../src/games/themes.js";
import { dailySeed, dailyTarget, dayDiff, decodeGame, encodeGame, isBeaten, nextStreak, pickDaily, shareText } from "../../src/daily.js";

test("dailySeed is stable for one date and varies across dates", () => {
  assert.equal(dailySeed("2026-07-08"), dailySeed("2026-07-08"));
  assert.notEqual(dailySeed("2026-07-08"), dailySeed("2026-07-09"));
});

test("pickDaily is deterministic and returns a registered key", () => {
  const first = pickDaily("2026-07-08", registry);
  const second = pickDaily("2026-07-08", registry);

  assert.deepEqual(first, second);
  assert.ok(registry[first.key], `${first.key} should exist in the registry`);
  assert.equal(typeof first.prompt, "string");
  assert.ok(first.prompt.length > 0);
  assert.equal(typeof first.seed, "number");
  assert.equal(typeof first.target, "number");
  assert.ok(first.target > 0);
  assert.ok(THEME_IDS.includes(first.theme), `${first.theme} should be a known theme id`);
});

test("pickDaily prompt is correlated with the chosen game's label", () => {
  const pick = pickDaily("2026-07-08", registry);
  assert.equal(pick.prompt, registry[pick.key].meta.label);
});

test("pickDaily varies across a week", () => {
  const picks = new Set(
    ["2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14"]
      .map(dateStr => JSON.stringify(pickDaily(dateStr, registry)))
  );

  assert.ok(picks.size > 1);
});

test("nextStreak leaves same-day state unchanged", () => {
  const prev = { lastPlayed: "2026-07-08", streak: 3, best: 5 };

  assert.deepEqual(nextStreak(prev, "2026-07-08"), prev);
});

test("nextStreak increments consecutive days and tracks best", () => {
  assert.deepEqual(
    nextStreak({ lastPlayed: "2026-07-08", streak: 3, best: 3 }, "2026-07-09"),
    { lastPlayed: "2026-07-09", streak: 4, best: 4 }
  );
});

test("nextStreak resets after a gap and preserves higher best", () => {
  assert.deepEqual(
    nextStreak({ lastPlayed: "2026-07-08", streak: 3, best: 5 }, "2026-07-12"),
    { lastPlayed: "2026-07-12", streak: 1, best: 5 }
  );
});

test("dayDiff is correct across a month boundary", () => {
  assert.equal(dayDiff("2026-01-31", "2026-02-01"), 1);
  assert.equal(dayDiff("2026-02-01", "2026-01-31"), -1);
});

test("dailyTarget is deterministic, positive, and in a reachable band", () => {
  const seed = dailySeed("2026-07-08");
  assert.equal(dailyTarget(seed), dailyTarget(seed));
  const t = dailyTarget(seed);
  assert.ok(t >= 8 && t <= 22, `target ${t} should be in 8..22`);
});

test("isBeaten: a win beats regardless of score; else score must reach target", () => {
  assert.equal(isBeaten({ won: true, score: 0 }, 20), true);
  assert.equal(isBeaten({ won: false, score: 25 }, 20), true);
  assert.equal(isBeaten({ won: false, score: 20 }, 20), true);
  assert.equal(isBeaten({ won: false, score: 19 }, 20), false);
  assert.equal(isBeaten({ won: false }, 20), false); // no score → not beaten
});

test("isBeaten: solve/goal games require the actual win, not a score target", () => {
  // A dense start (life) or a low score (sand/rhythm) must NOT count as beaten —
  // only a genuine win does when the game is a solve game.
  assert.equal(isBeaten({ won: false, score: 100 }, 20, true), false);
  assert.equal(isBeaten({ won: false, score: 8 }, 20, true), false);
  assert.equal(isBeaten({ won: true, score: 0 }, 20, true), true);
  // Endless arcade (default) still uses the score target.
  assert.equal(isBeaten({ won: false, score: 25 }, 20, false), true);
  assert.equal(isBeaten({ won: false, score: 25 }, 20), true);
});

test("goal games carry meta.dailyMode 'solve'; endless arcade games do not", () => {
  for (const k of ["life", "sand", "rhythm", "maze", "explore"]) {
    assert.equal(registry[k].meta.dailyMode, "solve", `${k} should be a solve game`);
  }
  assert.notEqual(registry.shooter.meta.dailyMode, "solve", "shooter is endless arcade");
  assert.notEqual(registry.snake.meta.dailyMode, "solve", "snake stays score-target");
});

test("shareText reflects the real outcome with score/target and no emoji", () => {
  const beat = shareText("2026-07-08", { beaten: true, score: 21, target: 15, streak: 4 });
  assert.match(beat, /2026-07-08/);
  assert.match(beat, /beaten 21\/15/);
  assert.match(beat, /streak 4/);

  const miss = shareText("2026-07-08", { beaten: false, score: 9, target: 15, streak: 0 });
  assert.match(miss, /not beaten 9\/15/);

  assert.equal(/\p{Extended_Pictographic}/u.test(beat), false);
});

test("encodeGame/decodeGame round-trips key + config", () => {
  const cfg = { title: "Neon Blitz", theme: "neon", modifiers: [{ id: "mirror" }], speed: 4 };
  const token = encodeGame("shooter", cfg);
  assert.equal(typeof token, "string");
  const decoded = decodeGame(token);
  assert.deepEqual(decoded, { key: "shooter", cfg });
});

test("decodeGame returns null for malformed input", () => {
  assert.equal(decodeGame(""), null);
  assert.equal(decodeGame("not-base64-@@@"), null);
  assert.equal(decodeGame(encodeGame(undefined, {})), null); // no key
  assert.equal(decodeGame(null), null);
});
