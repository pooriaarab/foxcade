import { test } from "node:test";
import assert from "node:assert/strict";
import { genSprite, spriteGrid } from "../../src/games/procsprites.js";

const KINDS = ["ship", "invader", "enemy", "player", "pickup", "block", "wall", "car", "spike", "target", "flag"];
const GRID = 11;
const PALETTE = { fg: "#39ff14", accent: "#ff2fd0", bg: "#0b0033" };

test("spriteGrid is deterministic per (kind, seed)", () => {
  for (const kind of KINDS) {
    for (const seed of [1, 42, 12345, 0x7fffffff]) {
      assert.deepEqual(spriteGrid(kind, seed), spriteGrid(kind, seed), `${kind}/${seed} stable`);
    }
  }
});

test("spriteGrid returns a square, mirror-symmetric grid", () => {
  for (const kind of KINDS) {
    const cells = spriteGrid(kind, 7);
    assert.equal(cells.length, GRID);
    for (let r = 0; r < GRID; r++) {
      assert.equal(cells[r].length, GRID);
      for (let c = 0; c < GRID; c++) {
        assert.equal(cells[r][c], cells[r][GRID - 1 - c], `${kind} row ${r} col ${c} mirrored`);
      }
    }
  }
});

test("different seeds and different kinds produce different art", () => {
  const a = spriteGrid("invader", 1);
  const b = spriteGrid("invader", 2);
  const c = spriteGrid("ship", 1);
  assert.notEqual(JSON.stringify(a), JSON.stringify(b), "seed changes the sprite");
  assert.notEqual(JSON.stringify(a), JSON.stringify(c), "kind changes the sprite");
});

test("every silhouette has some body pixels (not empty)", () => {
  for (const kind of KINDS) {
    const on = spriteGrid(kind, 3).flat().filter(Boolean).length;
    assert.ok(on > 0, `${kind} should draw at least one cell`);
  }
});

test("genSprite returns null with no canvas environment, falling back to vector", () => {
  // Node has neither OffscreenCanvas nor document → vector fallback path.
  assert.equal(genSprite("ship", 1, PALETTE), null);
});

test("genSprite produces and caches a canvas when one is available", () => {
  // Minimal fake canvas so the render path is exercised deterministically without
  // a real browser. genSprite must return it and reuse it for the same key.
  class FakeCanvas {
    constructor(w, h) { this.width = w; this.height = h; this.rects = 0; }
    getContext() {
      return { fillStyle: "", clearRect() {}, fillRect: () => { this.rects++; } };
    }
  }
  const saved = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeCanvas;
  try {
    const a = genSprite("player", 99, PALETTE);
    assert.ok(a instanceof FakeCanvas, "a canvas is produced");
    assert.ok(a.width > 0 && a.height > 0, "canvas has dimensions");
    assert.ok(a.rects > 0, "sprite cells were painted");
    const b = genSprite("player", 99, PALETTE);
    assert.equal(a, b, "same (kind,seed,palette) is cached");
    const different = genSprite("player", 99, { fg: "#fff", accent: "#000", bg: "#111" });
    assert.notEqual(a, different, "a different palette is a distinct cache entry");
  } finally {
    if (saved === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = saved;
  }
});

test("the sprite cache is LRU-capped (a long remix session can't grow it forever)", () => {
  // Each distinct seed is a fresh cache entry. Rasterize far more than the cap, so
  // an unbounded Map would keep every one; the LRU cap must evict the oldest.
  class FakeCanvas {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() { return { fillStyle: "", clearRect() {}, fillRect() {} }; }
  }
  const saved = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeCanvas;
  try {
    const CACHE_MAX = 256;
    const first = genSprite("ship", 0, PALETTE);
    // Fill well past the cap with unique seeds, evicting seed 0 along the way.
    for (let seed = 1; seed <= CACHE_MAX + 5; seed++) genSprite("ship", seed, PALETTE);
    // The oldest entry (seed 0) was evicted → a re-request rebuilds a NEW canvas.
    const firstAgain = genSprite("ship", 0, PALETTE);
    assert.notEqual(first, firstAgain, "evicted entry is re-rasterized (cache was capped)");
    // A recently-touched entry is still cached (same instance returned).
    const recent = genSprite("ship", CACHE_MAX + 5, PALETTE);
    const recentAgain = genSprite("ship", CACHE_MAX + 5, PALETTE);
    assert.equal(recent, recentAgain, "a recent entry is still cached");
  } finally {
    if (saved === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = saved;
  }
});
