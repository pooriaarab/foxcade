import { test } from "node:test";
import assert from "node:assert/strict";
import { fill } from "../../src/pipeline/paramfill.js";
import { validate } from "../../src/pipeline/validate.js";
import { MockModel, HeuristicModel } from "../../src/pipeline/model.js";

const game = {
  schema: { speed: { type:"number", min:1, max:10, default:5 }, title: { type:"string", default:"Game" } },
  skill: { system: "Output JSON {speed,title}.", examples: [{ prompt:"fast", json:{ speed:9, title:"Zoom" } }] }
};

test("passes model json through to validate → clamped config", async () => {
  const m = new MockModel({ __default: '{"speed": 8, "title": "Blaze"}' });
  const cfg = validate(await fill("fast blaze", game, m), game.schema);
  assert.equal(cfg.speed, 8);
  assert.equal(cfg.title, "Blaze");
});
test("heuristic (empty) → all defaults, still valid", async () => {
  const cfg = validate(await fill("whatever", game, new HeuristicModel()), game.schema);
  assert.deepEqual(cfg, { speed:5, title:"Game" });
});
test("nudge is appended to the request", async () => {
  let seen = "";
  const m = { async generateAsync(sys, user){ seen = user; return "{}"; } };
  await fill("base", game, m, "make it harder");
  assert.match(seen, /make it harder/i);
});
