import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../../src/pipeline/validate.js";

const schema = {
  speed: { type: "number", min: 1, max: 10, default: 5 },
  theme: { type: "string", enum: ["neon","retro","mono"], default: "retro" },
  title: { type: "string", default: "Game" }
};

test("clamps out-of-range numbers", () => {
  assert.equal(validate({ speed: 99 }, schema).speed, 10);
  assert.equal(validate({ speed: -3 }, schema).speed, 1);
});
test("defaults missing + non-numeric", () => {
  assert.equal(validate({}, schema).speed, 5);
  assert.equal(validate({ speed: "fast" }, schema).speed, 5);
});
test("enum reject falls back to default", () => {
  assert.equal(validate({ theme: "sparkle" }, schema).theme, "retro");
  assert.equal(validate({ theme: "neon" }, schema).theme, "neon");
});
test("repairs malformed json string, never throws", () => {
  assert.equal(validate('{"speed": 7 trailing garbage', schema).speed, 5); // unparseable → defaults
  assert.equal(validate('{"speed": 7}', schema).speed, 7);
  assert.equal(validate(null, schema).title, "Game");
});
test("drops unknown keys", () => {
  assert.deepEqual(Object.keys(validate({ speed:5, evil:1 }, schema)).sort(), ["speed","theme","title"]);
});
