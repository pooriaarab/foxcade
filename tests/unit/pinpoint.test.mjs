import { test } from "node:test";
import assert from "node:assert/strict";
import pinpoint, { CONTENT, pickPuzzle, pinpointScore } from "../../src/games/pinpoint.js";

test("every content entry has 5 clues and options that contain the answer", () => {
  assert.ok(CONTENT.length > 0);
  for (const p of CONTENT) {
    assert.equal(p.clues.length, 5, `${p.category} has 5 clues`);
    assert.ok(p.options.length >= 2, `${p.category} has multiple options`);
    assert.ok(p.options.includes(p.category), `${p.category} is among its options`);
  }
});

test("pickPuzzle is deterministic and in-set for any seed", () => {
  for (const seed of [0, 1, 3, 42, 999, -2]) {
    assert.equal(pickPuzzle(seed), pickPuzzle(seed), "same seed -> same puzzle");
    assert.ok(CONTENT.includes(pickPuzzle(seed)), `${seed} -> puzzle in set`);
  }
});

test("pinpointScore rewards fewer clues used", () => {
  assert.equal(pinpointScore(1), 5, "first-clue guess scores highest");
  assert.equal(pinpointScore(5), 1, "last-clue guess scores lowest positive");
  assert.ok(pinpointScore(1) > pinpointScore(2), "monotonic: 1 > 2");
  assert.ok(pinpointScore(2) > pinpointScore(3), "monotonic: 2 > 3");
  assert.ok(pinpointScore(3) > pinpointScore(4), "monotonic: 3 > 4");
  assert.ok(pinpointScore(4) > pinpointScore(5), "monotonic: 4 > 5");
});

test("pinpointScore floors out-of-range input to 0", () => {
  assert.equal(pinpointScore(0), 0);
  assert.equal(pinpointScore(6), 0);
  assert.equal(pinpointScore(NaN), 0);
});

test("generate returns a deterministic puzzle whose answer is a valid option", () => {
  const a = pinpoint.puzzle.generate({ theme: "neon", title: "T" }, 3);
  const b = pinpoint.puzzle.generate({ theme: "neon", title: "T" }, 3);
  assert.deepEqual(a, b, "same seed -> same generated state");
  assert.equal(a.answer, a.category);
  assert.ok(a.options.includes(a.answer), "answer is selectable");
  assert.equal(a.clues.length, 5);
  assert.equal(a.maxClues, 5);
});
