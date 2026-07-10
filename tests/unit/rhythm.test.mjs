import { test } from "node:test";
import assert from "node:assert/strict";
import rhythm from "../../src/games/rhythm.js";
import { validate } from "../../src/pipeline/validate.js";

const cfg = validate({ theme: "neon", title: "Beat Test" }, rhythm.schema);
const LANE_W = 400 / 3;

// Place two notes, one in lane 1 and one in lane 2, both exactly on the clock so
// either could be hit. A pointer tap in the right third lands in lane 2 — but
// engine-base ALSO synthesizes direction flags from that pointer (a top-right tap
// sets up=lane1 and right=lane2). One tap must fire exactly ONE lane.
test("a single tap in one lane region registers exactly one lane", () => {
  const s = rhythm.engine.init(cfg);
  s.time = 100;
  s.notes = [
    { lane: 1, hitTime: 100, judged: false, hit: false },
    { lane: 2, hitTime: 100, judged: false, hit: false }
  ];
  s.prev = [false, false, false];

  // Exactly what engine-base hands a game on a pointer tap in the right third:
  // px in lane 2, plus pointer-synthesized up (lane 1) + right (lane 2), flagged
  // as pointer-sourced.
  const input = { tap: true, px: 2 * LANE_W + 5, up: true, right: true, _pointer: true };
  rhythm.engine.step(s, input, 0);

  assert.equal(s.hits, 1, "one tap = one hit");
  assert.equal(s.notes[0].hit, false, "the synthesized 'up' did NOT fire lane 1");
  assert.equal(s.notes[0].judged, false, "lane-1 note left untouched by the tap");
  assert.equal(s.notes[1].hit, true, "the px lane (lane 2) is the one that fired");
});

// Keyboard play is untouched: a real key press (no _pointer flag) still hits.
test("keyboard lanes still work: a left key press hits lane 0", () => {
  const s = rhythm.engine.init(cfg);
  s.time = 100;
  s.notes = [{ lane: 0, hitTime: 100, judged: false, hit: false }];
  s.prev = [false, false, false];

  rhythm.engine.step(s, { left: true }, 0);
  assert.equal(s.hits, 1, "left key hits lane 0");
  assert.equal(s.notes[0].hit, true);
});
