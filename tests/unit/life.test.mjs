import { test } from "node:test";
import assert from "node:assert/strict";
import life from "../../src/games/life.js";
import { validate } from "../../src/pipeline/validate.js";

// Invariant: a fresh colony is ALWAYS short of the win target, so the daily/level
// is winnable by play but never an instant win from a dense RNG seed.
test("life never starts already won: start population is strictly below target", () => {
  for (const title of ["A", "Neon Bloom", "x", "garden", "zzz", "Forge Life"]) {
    for (const theme of ["neon", "cozy"]) {
      const cfg = validate({ theme, title }, life.schema);
      const s = life.engine.init(cfg);
      assert.ok(s.pop < s.target, `${title}/${theme}: pop ${s.pop} must be < target ${s.target}`);
      assert.equal(s.won, false, "not won at init");
      assert.equal(life.engine.status(s).won, false, "status reports not won at init");
    }
  }
});

test("target lifts a clear margin above a dense seed, but honours a higher request", () => {
  // Lowest requested target (20) is well under the seeded count, so it is lifted
  // to at least pop + 10.
  const low = validate({ theme: "neon", title: "A", target: 20 }, life.schema);
  const s = life.engine.init(low);
  assert.ok(s.target >= s.pop + 10, "target sits a margin above the seeded population");

  // A high requested target already clears the seed + margin, so it is honoured.
  const high = validate({ theme: "neon", title: "A", target: 200 }, life.schema);
  const s2 = life.engine.init(high);
  assert.equal(s2.target, 200, "a target above seed+margin is used as-is");
});
