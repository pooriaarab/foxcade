import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAtlas, drawSprite } from "../../src/games/atlas.js";

const XML = `<SubTexture name="ship.png" x="0" y="0" width="32" height="48"/>`;

test("loadAtlas never throws under headless Node (no Image constructor)", () => {
  assert.equal(typeof Image, "undefined", "the Node test env has no Image");
  let atlas;
  assert.doesNotThrow(() => { atlas = loadAtlas("assets/space/sheet.png", XML); });
  assert.equal(atlas.ready, false, "stays un-ready → vector fallback");
  assert.ok(atlas.frames["ship.png"], "frames still parse from the XML");
  // drawSprite on an un-ready atlas is a no-op (returns false), never throws.
  assert.equal(drawSprite({}, atlas, "ship.png", 0, 0, 10), false);
});

test("onload flips ready true; onerror logs once and stays vector", () => {
  const built = [];
  class FakeImage { set src(v) { this._src = v; built.push(this); } }
  const savedImage = globalThis.Image;
  const savedErr = console.error;
  const logs = [];
  globalThis.Image = FakeImage;
  console.error = (...a) => logs.push(a.join(" "));
  try {
    // Success path: firing onload makes the atlas ready.
    const good = loadAtlas("assets/space/sheet.png", XML);
    const goodImg = built.at(-1);
    assert.equal(good.ready, false, "not ready until the image decodes");
    goodImg.onload();
    assert.equal(good.ready, true, "onload marks the atlas ready");
    assert.equal(good.img, goodImg, "the decoded image is attached");

    // Failure path: onerror logs exactly once and leaves the atlas vector.
    const bad = loadAtlas("assets/space/missing.png", XML);
    const badImg = built.at(-1);
    badImg.onerror();
    badImg.onerror(); // a repeat must not log again
    assert.equal(bad.ready, false, "a failed sheet never becomes ready");
    assert.equal(logs.length, 1, "the failure is logged exactly once");
    assert.match(logs[0], /missing\.png/, "the log names the failed sheet");
  } finally {
    if (savedImage === undefined) delete globalThis.Image; else globalThis.Image = savedImage;
    console.error = savedErr;
  }
});
