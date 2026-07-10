import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "../../src/pipeline/router.js";
import { HeuristicModel, MockModel } from "../../src/pipeline/model.js";

const registry = {
  runner:   { meta: { label:"Endless Runner", keywords:["run","jump","flappy","dino"] } },
  shooter:  { meta: { label:"Space Shooter",  keywords:["shoot","space","laser","invader"] } },
  breakout: { meta: { label:"Breakout",       keywords:["brick","paddle","ball","break"] } }
};

test("keyword fallback routes by content when model is silent", async () => {
  const m = new HeuristicModel();
  assert.equal(await route("a flappy bird clone", m, registry), "runner");
  assert.equal(await route("shoot the space invaders", m, registry), "shooter");
  assert.equal(await route("bounce a ball to break bricks", m, registry), "breakout");
});
test("uses model answer when it names a valid key", async () => {
  const m = new MockModel({ __default: "shooter" });
  assert.equal(await route("anything", m, registry), "shooter");
});
test("invalid model answer falls back to keywords", async () => {
  const m = new MockModel({ __default: "not-a-game" });
  assert.equal(await route("jump over gaps, dino style", m, registry), "runner");
});
test("no signal → first key", async () => {
  assert.equal(await route("zzzzz", new HeuristicModel(), registry), "runner");
});
