import { test } from "node:test";
import assert from "node:assert/strict";
import space3d, { generate } from "../../src/games/space3d.js";
import { validate } from "../../src/pipeline/validate.js";
import { THEME_IDS } from "../../src/games/themes.js";

const cfg = validate({ fireRate: 8, enemySpeed: 5, waveSize: 7, health: 3, theme: "scifi", title: "Void Run" }, space3d.schema);

test("space3d is a WebGL game type with no 2D engine", () => {
  assert.equal(space3d.type, "three");
  assert.equal(space3d.engine, undefined, "must not expose a 2D engine (kept out of arcade paths)");
  assert.equal(typeof space3d.three.generate, "function");
  assert.equal(typeof space3d.three.mount, "function");
});

test("generate is pure and deterministic from the seed", () => {
  assert.deepEqual(generate(cfg, 42), generate(cfg, 42));
  assert.notDeepEqual(generate(cfg, 1), generate(cfg, 2));
});

test("generate produces waves whose first wave uses waveSize and grows after", () => {
  const c = generate(cfg, 7);
  assert.ok(Array.isArray(c.waves) && c.waves.length >= 2, "multiple waves");
  assert.equal(c.waves[0].length, cfg.waveSize, "first wave size = waveSize");
  assert.ok(c.waves[1].length > c.waves[0].length, "later waves get bigger");
});

test("every enemy has in-range lateral spawn, a positive speed, and hp >= 1", () => {
  for (const wave of generate(cfg, 99).waves) {
    for (const e of wave) {
      assert.ok(e.x >= -1 && e.x <= 1, `x ${e.x} in [-1,1]`);
      assert.ok(e.y >= -1 && e.y <= 1, `y ${e.y} in [-1,1]`);
      assert.ok(e.z < 0, "enemies spawn ahead (negative z)");
      assert.ok(e.speed > 0, "positive speed");
      assert.ok(e.hp >= 1, "hp at least 1");
      assert.ok(e.kind === "ship" || e.kind === "asteroid", "known kind");
    }
  }
});

test("scalar tuning is carried through from cfg", () => {
  const c = generate(cfg, 3);
  assert.equal(c.health, cfg.health);
  assert.equal(c.enemySpeed, cfg.enemySpeed);
  assert.equal(c.theme, cfg.theme);
  assert.equal(c.title, cfg.title);
  assert.ok(c.fireCooldown > 0, "fire cooldown positive");
  assert.ok(THEME_IDS.includes(c.theme), "theme is a known id");
});

test("schema defaults validate to a playable config", () => {
  const d = validate({}, space3d.schema);
  const c = generate(d, 1);
  assert.equal(c.waves[0].length, space3d.schema.waveSize.default);
  assert.equal(c.health, space3d.schema.health.default);
});
