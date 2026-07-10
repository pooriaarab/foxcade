import { test } from "node:test";
import assert from "node:assert/strict";
import wordle, { ANSWERS, scoreGuess, pickAnswer } from "../../src/games/wordle.js";

test("scoreGuess marks all green for an exact match", () => {
  assert.deepEqual(scoreGuess("CRANE", "CRANE"), ["green", "green", "green", "green", "green"]);
});

test("scoreGuess marks position (green) vs presence (yellow) vs absence (gray)", () => {
  // answer APPLE, guess PAPER: index2 P is green; leading P and A are yellow; R absent.
  assert.deepEqual(scoreGuess("PAPER", "APPLE"), ["yellow", "yellow", "green", "yellow", "gray"]);
});

test("scoreGuess respects duplicate-letter counts", () => {
  // CRANE has a single E: the green at index4 consumes it, so EERIE's two leading
  // E's cannot also be yellow — they stay gray. R is present-but-misplaced (yellow).
  assert.deepEqual(scoreGuess("EERIE", "CRANE"), ["gray", "gray", "yellow", "gray", "green"]);
});

test("scoreGuess is case-insensitive", () => {
  assert.deepEqual(scoreGuess("crane", "CRANE"), ["green", "green", "green", "green", "green"]);
});

test("pickAnswer is deterministic and in-list for any seed", () => {
  for (const seed of [0, 1, 7, 42, 123456, -5, 2 ** 31]) {
    assert.equal(pickAnswer(seed), pickAnswer(seed), "same seed -> same answer");
    assert.ok(ANSWERS.includes(pickAnswer(seed)), `${seed} -> answer in list`);
  }
});

test("ANSWERS is a curated list of unique 5-letter uppercase words", () => {
  assert.ok(ANSWERS.length >= 150 && ANSWERS.length <= 300, `list size ${ANSWERS.length} in range`);
  assert.ok(ANSWERS.every(w => /^[A-Z]{5}$/.test(w)), "all words are 5 uppercase letters");
  assert.equal(new Set(ANSWERS).size, ANSWERS.length, "no duplicates");
});

test("generate picks the seeded answer when the config answer is off-list", () => {
  const state = wordle.puzzle.generate({ theme: "neon", title: "T", answer: "ZZZZZ" }, 42);
  assert.equal(state.answer, pickAnswer(42));
  assert.ok(ANSWERS.includes(state.answer), "generated answer is always in the list");
  assert.equal(state.rows, 6);
  assert.equal(state.cols, 5);
});

test("generate honors a valid model-picked answer (validator gate)", () => {
  const chosen = ANSWERS[3];
  const state = wordle.puzzle.generate({ theme: "neon", title: "T", answer: chosen }, 42);
  assert.equal(state.answer, chosen);
});
