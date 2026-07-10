import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLoop, pointerToInput } from "../../src/games/engine-base.js";
import snake from "../../src/games/snake.js";
import { validate } from "../../src/pipeline/validate.js";

const W = 400, H = 600;

test("pointerToInput maps position to directional + fire intent", () => {
  // Left edge → left only; a held pointer always fires.
  const l = pointerToInput(20, 300, W, H);
  assert.equal(l.left, true);
  assert.equal(l.right, false);
  assert.equal(l.fire, true);

  // Right edge → right only.
  const r = pointerToInput(380, 300, W, H);
  assert.equal(r.right, true);
  assert.equal(r.left, false);

  // Centre dead zone → no horizontal intent.
  const c = pointerToInput(200, 300, W, H);
  assert.equal(c.left, false);
  assert.equal(c.right, false);

  // Top band → up (not down); bottom band → down (not up).
  assert.equal(pointerToInput(200, 40, W, H).up, true);
  assert.equal(pointerToInput(200, 40, W, H).down, false);
  assert.equal(pointerToInput(200, 560, W, H).down, true);
  assert.equal(pointerToInput(200, 560, W, H).up, false);
});

// Repeated mount→destroy must not accumulate listeners (feed re-mounts a game
// per card click), and a destroyed game must leave no listener behind that
// could bleed input into the next one. We prove it by balancing every
// addEventListener with a removeEventListener on both window and the canvas.
test("makeLoop.destroy removes every listener it added, across many remounts", () => {
  const tracker = map => ({
    addEventListener(type) { map.set(type, (map.get(type) || 0) + 1); },
    removeEventListener(type) { map.set(type, (map.get(type) || 0) - 1); }
  });
  const winCounts = new Map();
  const prev = {
    window: globalThis.window,
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame
  };
  globalThis.window = tracker(winCounts);
  globalThis.requestAnimationFrame = () => 1; // never invoke the frame → no draw
  globalThis.cancelAnimationFrame = () => {};

  const cfg = validate({}, snake.schema);
  try {
    for (let i = 0; i < 25; i++) {
      const canvasCounts = new Map();
      const canvas = {
        ...tracker(canvasCounts),
        width: 0, height: 0, dataset: {}, style: {},
        getContext: () => ({}),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
        focus() {}
      };
      const loop = makeLoop(canvas, snake, cfg);
      // Every listener added this mount is removed by destroy → net zero.
      loop.destroy();
      for (const [type, n] of canvasCounts) assert.equal(n, 0, `canvas ${type} unbalanced`);
    }
    // After 25 mount/destroy cycles no window listener has accumulated.
    for (const [type, n] of winCounts) assert.equal(n, 0, `window ${type} accumulated`);
  } finally {
    globalThis.window = prev.window;
    globalThis.requestAnimationFrame = prev.raf;
    globalThis.cancelAnimationFrame = prev.caf;
  }
});
