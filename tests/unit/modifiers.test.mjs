import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODIFIER_IDS,
  pickModifiers,
  validateModifiers,
  applyInput,
  pointerToGame,
  scaleDt,
  timeAttackOver
} from "../../src/games/modifiers.js";

test("pickModifiers maps keywords to ids", () => {
  assert.deepEqual(pickModifiers("inverted controls snake"), ["invert"]);
  assert.deepEqual(pickModifiers("a mirrored maze"), ["mirror"]);
  assert.deepEqual(pickModifiers("upside down runner"), ["flipv"]);
  assert.deepEqual(pickModifiers("foggy dungeon crawler"), ["fog"]);
  assert.deepEqual(pickModifiers("turbo racer"), ["turbo"]);
  assert.deepEqual(pickModifiers("slow motion pong"), ["slowmo"]);
  assert.deepEqual(pickModifiers("zoomed in shooter"), ["zoom"]);
  assert.deepEqual(pickModifiers("time attack tetris"), ["timeattack"]);
});

test("pickModifiers combines and de-dupes, empty when no keyword", () => {
  assert.deepEqual(pickModifiers("mirrored fast snake"), ["mirror", "turbo"]);
  assert.deepEqual(pickModifiers("just a normal game"), []);
  assert.deepEqual(pickModifiers(""), []);
  assert.deepEqual(pickModifiers(null), []);
  // every produced id is valid
  for (const id of pickModifiers("foggy turbo mirrored timed zoomed inverted")) {
    assert.ok(MODIFIER_IDS.includes(id));
  }
});

test("validateModifiers drops junk, de-dupes, and caps length", () => {
  assert.deepEqual(validateModifiers(["invert", "nonsense", "mirror"]), ["invert", "mirror"]);
  assert.deepEqual(validateModifiers(["fog", "fog", "fog"]), ["fog"]);
  assert.equal(validateModifiers(["invert", "mirror", "flipv", "fog", "turbo"]).length, 3);
  assert.deepEqual(validateModifiers("not an array"), []);
  assert.deepEqual(validateModifiers(undefined), []);
});

test("applyInput swaps directions for invert without mutating the source", () => {
  const raw = { left: true, right: false, up: true, down: false, fire: true };
  const out = applyInput(raw, ["invert"]);
  assert.equal(out.left, false);
  assert.equal(out.right, true);
  assert.equal(out.up, false);
  assert.equal(out.down, true);
  assert.equal(out.fire, true, "non-direction input passes through");
  assert.equal(raw.left, true, "source input is untouched");
});

test("applyInput flips only left/right for mirror; invert+mirror cancels LR", () => {
  const raw = { left: true, right: false, up: true, down: false };
  const mir = applyInput(raw, ["mirror"]);
  assert.equal(mir.left, false);
  assert.equal(mir.right, true);
  assert.equal(mir.up, true, "mirror leaves vertical alone");

  const both = applyInput(raw, ["invert", "mirror"]);
  assert.equal(both.left, true, "invert+mirror cancels left/right");
  assert.equal(both.right, false);
  assert.equal(both.down, true, "up/down still inverted");
});

test("applyInput returns the same object (zero alloc) when nothing swaps", () => {
  const raw = { left: true };
  assert.equal(applyInput(raw, []), raw);
  assert.equal(applyInput(raw, ["fog", "turbo"]), raw);
});

test("scaleDt: turbo accelerates over time, slowmo shrinks, empty is a passthrough", () => {
  assert.equal(scaleDt(1, [], 10000), 1);
  assert.ok(scaleDt(1, ["turbo"], 30000) > scaleDt(1, ["turbo"], 0), "turbo grows with elapsed time");
  assert.ok(scaleDt(1, ["turbo"], 30000) > 1);
  assert.ok(scaleDt(1, ["slowmo"], 0) < 1);
  assert.ok(Math.abs(scaleDt(1, ["slowmo"], 0) - 0.6) < 1e-9);
  assert.ok(scaleDt(2, ["turbo"], 10_000_000) <= 4, "clamped so it never tunnels");
});

test("pointerToGame inverse-transforms a tap into game space for geometric modifiers", () => {
  const W = 400, H = 600;
  // No modifiers → identity (a raw tap is already in game space).
  assert.deepEqual(pointerToGame(120, 200, W, H, []), { x: 120, y: 200 });
  // mirror flips x about the centre: a tap on the right (300) maps to the left (100).
  const m = pointerToGame(300, 200, W, H, ["mirror"]);
  assert.ok(Math.abs(m.x - 100) < 1e-9, "mirror maps a right-side tap to a left game-x");
  assert.equal(m.y, 200, "mirror leaves y alone");
  // flipv flips y about the centre.
  const f = pointerToGame(120, 450, W, H, ["flipv"]);
  assert.ok(Math.abs(f.y - 150) < 1e-9, "flipv maps a low tap to a high game-y");
  assert.equal(f.x, 120);
  // zoom scales about the centre by 1.4 (preRender's ZOOM_SCALE).
  const z = pointerToGame(340, 300, W, H, ["zoom"]);
  assert.ok(Math.abs(z.x - ((340 - 200) / 1.4 + 200)) < 1e-9, "zoom un-scales about the centre");
});

test("timeAttackOver flips at the 0 mark and is false without the modifier", () => {
  assert.equal(timeAttackOver(["timeattack"], 0), false);
  assert.equal(timeAttackOver(["timeattack"], 44999), false);
  assert.equal(timeAttackOver(["timeattack"], 45000), true);
  assert.equal(timeAttackOver(["timeattack"], 99999), true);
  assert.equal(timeAttackOver(["turbo"], 99999), false);
  assert.equal(timeAttackOver([], 99999), false);
});
