import { test } from "node:test";
import assert from "node:assert/strict";
import sand, { SAND } from "../../src/games/sand.js";
import { validate } from "../../src/pipeline/validate.js";

const cfg = validate({ theme: "cozy", title: "Sand Test" }, sand.schema);
const countSand = grid => grid.reduce((n, row) => n + row.filter(v => v === SAND).length, 0);

// dt:0 keeps the physics frozen (interval > 0) so we can attribute every new
// grain to painting, not to settling — deterministic and isolating.
test("a held, moving pointer paints a continuous stroke, not just the initial tap", () => {
  const s = sand.engine.init(cfg);
  const before = countSand(s.grid);

  // Initial tap paints one dab in a clear area below the swatch strip.
  sand.engine.step(s, { tap: true, px: 100, py: 300 }, 0);
  const afterTap = countSand(s.grid);
  assert.ok(afterTap > before, "the initial tap paints a dab");

  // A HELD pointer (no fresh tap) moved to a new spot keeps painting — the drag fix.
  sand.engine.step(s, { pointerHeld: true, px: 300, py: 420 }, 0);
  const afterHeld = countSand(s.grid);
  assert.ok(afterHeld > afterTap, "holding + moving paints additional cells");

  // Another held frame at yet another spot streams still more.
  sand.engine.step(s, { pointerHeld: true, px: 180, py: 500 }, 0);
  assert.ok(countSand(s.grid) > afterHeld, "the stroke keeps painting while held");
});

test("dragging over the swatch strip does not flip the brush mid-stroke", () => {
  const s = sand.engine.init(cfg);
  s.brush = SAND;
  // Held (not a fresh tap) over the WATER swatch region must leave the brush alone.
  sand.engine.step(s, { pointerHeld: true, px: 200, py: 10 }, 0);
  assert.equal(s.brush, SAND, "held drag across the palette keeps the current brush");
});
