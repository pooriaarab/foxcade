import { test } from "node:test";
import assert from "node:assert/strict";
import runner from "../../src/games/runner.js";
import shooter from "../../src/games/shooter.js";
import breakout from "../../src/games/breakout.js";
import dodger from "../../src/games/dodger.js";
import whack from "../../src/games/whack.js";
import platformer, { hReachAt } from "../../src/games/platformer.js";
import maze from "../../src/games/maze.js";
import { spawnInterval, fallSpeedAt } from "../../src/games/dodger.js";
import { guess, initProgress, MAX_WRONG } from "../../src/games/pinpoint.js";
import { registry } from "../../src/games/registry.js";
import { validate } from "../../src/pipeline/validate.js";
import { drawShape, setActiveSkin } from "../../src/games/shapes.js";
import { getTheme, THEME_FIELD, THEME_IDS } from "../../src/games/themes.js";
import { LEVEL_START, levelSpeed, stepLevel } from "../../src/games/engine-base.js";
import { evolve } from "../../src/games/life.js";
import { settle, SAND, WATER, EMPTY, WALL } from "../../src/games/sand.js";

const cfg = validate({ gravity:1, jump:10, gap:200, speed:4 }, runner.schema);
const shooterCfg = validate({ fireRate:10, enemySpeed:1, waveSize:3, lives:3 }, shooter.schema);
const breakoutCfg = validate({ ballSpeed:4, paddleWidth:80, rows:2, cols:4 }, breakout.schema);
const dodgerCfg = validate({ spawnRate:4, fallSpeed:3, playerSpeed:6 }, dodger.schema);
const whackCfg = validate({ moleTime:50, holes:9, duration:10 }, whack.schema);
const platformerCfg = validate({ gravity:1, moveSpeed:4, jumpForce:12, platformCount:5 }, platformer.schema);
const mazeCfg = validate({ size:10 }, maze.schema);
const ENTITY_TEXT_FIELDS = new Set(["player", "enemy", "obstacle", "mole", "car", "hazard", "brick", "goal", "exit"]);
const SHAPE_KINDS = ["ship", "invader", "diamond", "circle", "dot", "block", "brick", "paddle", "spike", "car", "wall", "target", "flag", "runner"];

function makeCtx() {
  const calls = { fillText: [] };
  const ctx = {
    fillStyle: "#fff",
    strokeStyle: "#fff",
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    calls,
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    ellipse() {},
    rect() {},
    fillRect() {},
    roundRect() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    fillText(text) { calls.fillText.push(String(text)); }
  };
  return ctx;
}

function gameFromRegistry(key) {
  const game = registry[key];
  assert.ok(game, `${key} should be registered`);
  return game;
}

function reachableCells(grid, start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const cell = queue.shift();
    const id = `${cell.x},${cell.y}`;
    if (seen.has(id)) continue;
    if (cell.y < 0 || cell.y >= grid.length || cell.x < 0 || cell.x >= grid[cell.y].length) continue;
    if (grid[cell.y][cell.x]) continue;
    seen.add(id);
    queue.push(
      { x:cell.x + 1, y:cell.y },
      { x:cell.x - 1, y:cell.y },
      { x:cell.x, y:cell.y + 1 },
      { x:cell.x, y:cell.y - 1 }
    );
  }
  return seen;
}

// Generic level progression (engine-base.stepLevel): the pure decision that
// turns any terminal win into a fresh, harder level. makeLoop drives it per
// frame; here we exercise the decision in isolation.
test("stepLevel advances on a win: level++, cumulative score, ramped speed, non-terminal", () => {
  const next = stepLevel({ level:1, scoreBase:0, speed:1 }, { score:7, over:true, won:true }, false);
  assert.equal(next.advanced, true, "a win advances");
  assert.equal(next.level, 2);
  assert.equal(next.scoreBase, 7, "banks the cleared stage's score");
  assert.ok(next.speed > 1, "difficulty ramps");
  assert.equal(next.speed, levelSpeed(2));
});
test("stepLevel carries cumulative score across successive levels", () => {
  let p = { ...LEVEL_START };
  p = stepLevel(p, { score:5, over:true, won:true }, false);
  p = stepLevel(p, { score:3, over:false, won:true }, false);
  assert.equal(p.level, 3);
  assert.equal(p.scoreBase, 8, "each cleared stage adds to the running total");
});
test("stepLevel ends the run on a loss (over && !won) — no advance", () => {
  const p = { level:4, scoreBase:20, speed:1.5 };
  const next = stepLevel(p, { score:2, over:true, won:false }, false);
  assert.equal(next.advanced, false);
  assert.deepEqual({ level:next.level, scoreBase:next.scoreBase, speed:next.speed }, p, "progression is untouched by a loss");
});
test("stepLevel never advances endless games (won always false)", () => {
  const next = stepLevel({ ...LEVEL_START }, { score:99, over:false, won:false }, false);
  assert.equal(next.advanced, false);
  assert.equal(next.level, 1);
});
test("stepLevel treats a time-attack expiry as terminal even on a win", () => {
  const next = stepLevel({ ...LEVEL_START }, { score:9, over:true, won:true }, true);
  assert.equal(next.advanced, false, "time-up ends the run, not a level-up");
});
test("levelSpeed ramps then caps at 2.2", () => {
  assert.equal(levelSpeed(1), 1);
  assert.ok(levelSpeed(2) > levelSpeed(1) && levelSpeed(3) > levelSpeed(2), "monotonic ramp");
  assert.equal(levelSpeed(100), 2.2, "capped so it never becomes unplayable");
  assert.ok(levelSpeed(50) <= 2.2);
});

// Integration: reproduce makeLoop's advance step against a REAL terminal-win
// engine (maze). A win must loop into a fresh, non-terminal level — not freeze —
// banking the cleared stage's score. This is the whole point of the feature.
test("a terminal-win engine (maze) loops into a fresh level instead of freezing", () => {
  const baseTitle = mazeCfg.title || "maze";
  let prog = { ...LEVEL_START };
  let s = maze.engine.init(mazeCfg);
  s.player = { x:s.exit.x, y:s.exit.y };
  s = maze.engine.step(s, {}, 1);
  const won = maze.engine.status(s);
  assert.equal(won.won, true, "reaching the exit is a terminal win pre-feature");

  const adv = stepLevel(prog, won, false);
  assert.equal(adv.advanced, true);
  prog = adv;
  s = maze.engine.init({ ...mazeCfg, baseTitle, title:`${baseTitle}#L${prog.level}` });
  const fresh = maze.engine.status(s);
  assert.equal(fresh.won, false, "the fresh level is not already won");
  assert.equal(fresh.over, false, "the run keeps going — no freeze");
  assert.equal(prog.level, 2, "HUD would now show Level 2");
  assert.equal(prog.scoreBase, won.score, "the cleared stage's score is banked");
});

// A title-seeded engine yields a genuinely different (harder) layout on level-up,
// because makeLoop bumps cfg.title → a new seed, with no per-game code.
test("title-seeded engines get a fresh board when the level bumps the title", () => {
  const explore = gameFromRegistry("explore");
  const base = validate({ worldSize:12, pickups:5, hazards:2, theme:"retro", title:"Explorer" }, explore.schema);
  const l1 = explore.engine.init(base);
  const l2 = explore.engine.init({ ...base, title:"Explorer#L2" });
  assert.notEqual(l1.seed, l2.seed, "the bumped title reseeds the map");
  assert.notDeepEqual(l1.grid, l2.grid, "level 2 is a different layout");
});

test("shape helper supports every vector entity kind", () => {
  for (const kind of SHAPE_KINDS) {
    assert.doesNotThrow(() => drawShape(makeCtx(), kind, 20, 20, 16, "#fff"), `${kind} should draw`);
  }
});

// Every skin's finish appliers (bloom, drop-shadow, hard two-tone, deterministic
// sketch ink) must restyle every kind without throwing on the path-only mock ctx
// (no gradients/clip/Path2D). This is the invariant that keeps shuffle safe.
const SKINS = ["glow", "sharp", "round", "flat", "pixel", "sketch"];
test("every skin restyles every kind without throwing on the mock ctx", () => {
  for (const skin of SKINS) {
    setActiveSkin(skin);
    for (const kind of SHAPE_KINDS) {
      assert.doesNotThrow(() => drawShape(makeCtx(), kind, 20, 20, 16, "#39ff14"), `${skin}/${kind} should draw`);
    }
  }
  setActiveSkin("flat"); // restore the module default for later tests
});

// The sketch skin's jitter must be deterministic (derived from cx,cy — NO
// Math.random/Date): the same shape at the same spot issues the identical
// sequence of canvas ops every call, so the hand-drawn look never shimmers.
test("sketch skin jitter is deterministic (no Math.random)", () => {
  setActiveSkin("sketch");
  const trace = () => {
    const ops = [];
    const ctx = makeCtx();
    ctx.translate = (x, y) => ops.push(`t:${x.toFixed(6)},${y.toFixed(6)}`);
    ctx.stroke = () => ops.push("s");
    drawShape(ctx, "ship", 137, 211, 24, "#8b0000");
    return ops.join("|");
  };
  assert.equal(trace(), trace(), "identical (kind,cx,cy) → identical stroke/offset sequence");
  setActiveSkin("flat");
});

test("schemas expose theme as the only cosmetic entity control", () => {
  for (const [key, game] of Object.entries(registry)) {
    for (const field of Object.keys(game.schema)) {
      assert.equal(ENTITY_TEXT_FIELDS.has(field), false, `${key}.${field} should not be an emoji/string asset field`);
    }
    assert.equal(game.schema.palette, undefined, `${key} should not expose the old palette field`);
    assert.equal(game.schema.theme, THEME_FIELD, `${key} should reuse THEME_FIELD`);
    assert.equal(game.skill.system.includes("emoji"), false, `${key} skill system should not mention emoji`);
    assert.equal(game.skill.system.includes("palette("), false, `${key} skill system should not mention palette choices`);
    assert.ok(game.skill.system.includes("theme("), `${key} skill system should mention theme choices`);
    for (const id of THEME_IDS) {
      assert.ok(game.skill.system.includes(id), `${key} skill system should list ${id}`);
    }
    for (const example of game.skill.examples) {
      assert.equal(example.json.palette, undefined, `${key} example should not include palette`);
      assert.ok(THEME_IDS.includes(example.json.theme), `${key} example should include a known theme`);
      for (const field of Object.keys(example.json)) {
        assert.equal(ENTITY_TEXT_FIELDS.has(field), false, `${key} example should not include ${field}`);
      }
    }
  }
});

test("engine draw methods do not use text as entity assets", () => {
  // Arcade-only invariant: puzzles are DOM-rendered and WebGL games are
  // three.js-rendered — neither carries an engine.draw(). Only engine games apply.
  for (const [key, game] of Object.entries(registry)) {
    if (!game.engine) continue;
    const ctx = makeCtx();
    const state = game.engine.init(validate({}, game.schema));
    game.engine.draw(ctx, state, getTheme(state.cfg.theme).palette);
    // No engine ever draws emoji — vector art only, everywhere.
    for (const text of ctx.calls.fillText) {
      assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${key} draw should never emit emoji, got ${text}`);
    }
    // tabshooter legitimately labels each target with its tab title (UI text),
    // so it is exempt from the text-as-sprite rule below but still no-emoji above.
    if (key === "tabshooter") continue;
    // HUD text (Lives/Time/Level) and pure-numeric tile labels (2048) are UI,
    // not entity art. Emoji/word sprites are never bare digits, so this stays a
    // guard against text-as-sprite.
    const disallowed = ctx.calls.fillText.filter(text => !/^(Lives|Time|Level) /.test(text) && !/^\d+$/.test(text));
    assert.deepEqual(disallowed, [], `${key} draw should reserve fillText for HUD text`);
  }
});

test("gravity pulls player down over time", () => {
  let s = runner.engine.init(cfg);
  const y0 = s.y;
  for (let i=0;i<5;i++) s = runner.engine.step(s, {}, 1);
  assert.ok(s.y > y0, "player should fall");
});
test("jump gives upward velocity", () => {
  let s = runner.engine.init(cfg);
  s = runner.engine.step(s, { up:true }, 1);
  assert.ok(s.vy < 0, "vy negative after jump");
});
test("falling off bottom ends the game", () => {
  let s = runner.engine.init(cfg);
  for (let i=0;i<1000;i++) s = runner.engine.step(s, {}, 1);
  assert.equal(runner.engine.status(s).over, true);
});
test("surviving accrues score", () => {
  let s = runner.engine.init(cfg);
  for (let i=0;i<30;i++) s = runner.engine.step(s, { up:true }, 1); // flap to stay alive
  assert.ok(runner.engine.status(s).score >= 0);
});
test("runner pickup collection increments score", () => {
  let s = runner.engine.init(cfg);
  const score = s.score;
  s.pickups = [{ x:s.x, y:s.y }];
  s = runner.engine.step(s, {}, 0);
  assert.ok(s.score > score, "collecting a pickup should add score");
  assert.deepEqual(s.pickups, []);
});
test("runner speed ramps up with distance traveled", () => {
  let slow = runner.engine.init(cfg);
  slow.obstacles = [{ x:300, gapY:300 }];
  slow = runner.engine.step(slow, {}, 1);
  const slowMove = 300 - slow.obstacles[0].x;

  let fast = runner.engine.init(cfg);
  fast.obstacles = [{ x:300, gapY:300 }];
  fast.distance = 2000;
  fast = runner.engine.step(fast, {}, 1);
  const fastMove = 300 - fast.obstacles[0].x;

  assert.ok(fastMove > slowMove, `expected ${fastMove} to exceed ${slowMove}`);
});

test("shooter firing reduces enemy count after enough steps", () => {
  let s = shooter.engine.init(shooterCfg);
  const initial = s.enemies.length;
  s = shooter.engine.step(s, { fire:true }, 1);
  for (let i=0;i<80;i++) s = shooter.engine.step(s, {}, 1);
  assert.ok(s.enemies.length < initial, "a bullet should remove an enemy");
  assert.ok(shooter.engine.status(s).score > 0, "score should increase on hit");
});
test("shooter enemy reaching bottom costs a life", () => {
  let s = shooter.engine.init(shooterCfg);
  s.enemies = [{ x:s.playerX, y:590 }];
  s = shooter.engine.step(s, {}, 1);
  assert.equal(s.lives, shooterCfg.lives - 1);
});

test("breakout ball moving into a brick removes it and scores", () => {
  let s = breakout.engine.init(breakoutCfg);
  const initial = s.bricks.length;
  const brick = s.bricks[0];
  s.ball = { x:brick.x, y:brick.y + 18, vx:0, vy:-breakoutCfg.ballSpeed };
  s = breakout.engine.step(s, {}, 1);
  assert.equal(s.bricks.length, initial - 1);
  assert.equal(breakout.engine.status(s).score, 1);
});
test("breakout ball past bottom sets over", () => {
  let s = breakout.engine.init(breakoutCfg);
  s.ball.y = 620;
  s = breakout.engine.step(s, {}, 1);
  assert.equal(breakout.engine.status(s).over, true);
});

test("dodger hazard on the player column at contact sets over", () => {
  let s = dodger.engine.init(dodgerCfg);
  s.hazards = [{ x:s.playerX, y:540 }];
  s = dodger.engine.step(s, {}, 1);
  assert.equal(dodger.engine.status(s).over, true);
});
test("dodger surviving increases score", () => {
  let s = dodger.engine.init(dodgerCfg);
  for (let i=0;i<25;i++) s = dodger.engine.step(s, {}, 1);
  assert.ok(dodger.engine.status(s).score > 0);
});

test("whack tapping the active hole increments score", () => {
  let s = whack.engine.init(whackCfg);
  const active = s.holes[s.active];
  assert.equal(whack.engine.holeAt(s, active.x, active.y), s.active);
  s = whack.engine.step(s, { tap:true, px:active.x, py:active.y }, 1);
  assert.equal(whack.engine.status(s).score, 1);
});
test("whack duration expiry sets over", () => {
  let s = whack.engine.init(whackCfg);
  s.timeLeft = 2;
  for (let i=0;i<3;i++) s = whack.engine.step(s, {}, 1);
  assert.equal(whack.engine.status(s).over, true);
  assert.equal(whack.engine.status(s).won, false, "no hits → not a win");
});

test("platformer jump gives upward velocity", () => {
  let s = platformer.engine.init(platformerCfg);
  s.grounded = true;
  s = platformer.engine.step(s, { up:true }, 1);
  assert.ok(s.vy < 0, "vy negative after jump");
});
test("platformer falling off bottom ends the game", () => {
  let s = platformer.engine.init(platformerCfg);
  s.y = 620;
  s = platformer.engine.step(s, {}, 1);
  assert.equal(platformer.engine.status(s).over, true);
});
test("platformer landing on a platform stops the fall", () => {
  let s = platformer.engine.init(platformerCfg);
  const p = s.platforms[0];
  s.x = p.x + p.w / 2;
  s.y = p.y - 24;
  s.vy = 8;
  s.grounded = false;
  s = platformer.engine.step(s, {}, 1);
  assert.equal(s.vy, 0);
  assert.equal(s.grounded, true);
});

// Regression for the "unwinnable at default" bug, now per endless level: every
// consecutive platform of EVERY generated level must sit within this config's
// achievable jump (vertical rise + horizontal reach). If not, the flag on top can
// never be reached. We drive the game across several successive levels (reaching
// the flag regenerates a harder layout) and assert the guarantee holds each time.
function assertLayoutReachable(platforms, maxRise, hReach, label) {
  for (let i = 1; i < platforms.length; i++) {
    const dv = platforms[i - 1].y - platforms[i].y; // upward gap (px)
    const dh = Math.abs(
      (platforms[i].x + platforms[i].w / 2) - (platforms[i - 1].x + platforms[i - 1].w / 2)
    );
    assert.ok(dv > 0 && dv <= maxRise, `${label} platform ${i}: vgap ${dv.toFixed(1)} vs maxRise ${maxRise.toFixed(1)}`);
    assert.ok(dh <= hReach, `${label} platform ${i}: hgap ${dh.toFixed(1)} vs hReach ${hReach.toFixed(1)}`);
  }
}
function assertAllPlatformsReachable(raw, levels = 5) {
  const c = validate(raw, platformer.schema);
  let s = platformer.engine.init(c);
  const maxRise = (c.jumpForce * c.jumpForce) / (2 * c.gravity);
  const hReach = ((2 * c.jumpForce) / c.gravity) * c.moveSpeed;
  for (let lvl = 1; lvl <= levels; lvl++) {
    assert.equal(s.level, lvl, "levels advance in order");
    assertLayoutReachable(s.platforms, maxRise, hReach, `L${lvl}`);
    s.x = s.goal.x; s.y = s.goal.y; // teleport to the flag → clears level, spawns the next layout
    s = platformer.engine.step(s, {}, 1);
  }
}
test("platformer platforms are reachable across default + clamped extremes, for levels 1..5", () => {
  assertAllPlatformsReachable({ gravity:1,   moveSpeed:4, jumpForce:12, platformCount:5 }); // default
  assertAllPlatformsReachable({ gravity:2,   moveSpeed:2, jumpForce:8,  platformCount:3 }); // hardest clamp
  assertAllPlatformsReachable({ gravity:0.4, moveSpeed:8, jumpForce:16, platformCount:8 }); // easiest clamp
  assertAllPlatformsReachable({ gravity:99,  moveSpeed:99, jumpForce:99, platformCount:99 }); // out-of-range → clamped
  assertAllPlatformsReachable({ gravity:1,   moveSpeed:4, jumpForce:12, platformCount:5, ramp:1 }); // steepest ramp
});
test("platformer reaching the flag advances the level without winning, banking score", () => {
  let s = platformer.engine.init(platformerCfg);
  const beforeLevel = s.level, beforeScore = s.score;
  s.x = s.goal.x; s.y = s.goal.y;
  s = platformer.engine.step(s, {}, 1);
  assert.equal(s.level, beforeLevel + 1, "flag advances the level");
  assert.equal(platformer.engine.status(s).won, false, "endless: never a terminal win");
  assert.equal(platformer.engine.status(s).over, false, "clearing a level does not end the game");
  assert.ok(s.score > beforeScore, "each cleared level banks points");
});
test("platformer gets harder each level (more platforms)", () => {
  let s = platformer.engine.init(platformerCfg);
  const first = s.platforms.length;
  for (let l = 0; l < 3; l++) { s.x = s.goal.x; s.y = s.goal.y; s = platformer.engine.step(s, {}, 1); }
  assert.ok(s.platforms.length > first, `later levels add platforms (${s.platforms.length} vs ${first})`);
});
test("platformer can actually climb off the starting platform by playing", () => {
  let s = platformer.engine.init(platformerCfg);
  for (let f = 0; f < 3000 && s.score < 1 && !s.dead; f++) {
    const target = s.platforms[Math.min(s.score + 1, s.platforms.length - 1)];
    const tx = target.x + target.w / 2;
    const input = {};
    if (s.grounded) input.up = true;
    if (tx > s.x + 1) input.right = true;
    else if (tx < s.x - 1) input.left = true;
    s = platformer.engine.step(s, input, 1);
  }
  assert.ok(s.score >= 1, `should reach platform 1 by playing (got score ${s.score}, dead=${s.dead})`);
});

test("maze moving into an open adjacent cell changes player position", () => {
  let s = maze.engine.init(mazeCfg);
  const start = { x:s.player.x, y:s.player.y };
  s = maze.engine.step(s, { right:true }, 1);
  assert.notDeepEqual(s.player, start);
});
test("maze reaching the exit cell sets won", () => {
  let s = maze.engine.init(mazeCfg);
  s.player = { x:s.exit.x, y:s.exit.y };
  s = maze.engine.step(s, {}, 1);
  assert.equal(maze.engine.status(s).won, true);
});
test("maze moving into a wall does not change player position", () => {
  let s = maze.engine.init(mazeCfg);
  const start = { x:s.player.x, y:s.player.y };
  s = maze.engine.step(s, { left:true }, 1);
  assert.deepEqual(s.player, start);
});

test("explore generates reachable pickups and exit", () => {
  const explore = gameFromRegistry("explore");
  const c = validate({ worldSize:12, pickups:5, hazards:2, theme:"retro", title:"Explorer" }, explore.schema);
  const s = explore.engine.init(c);
  const seen = reachableCells(s.grid, s.player);

  assert.equal(s.size, c.worldSize);
  assert.equal(s.pickups.length, c.pickups);
  assert.equal(s.hazards.length, c.hazards);
  for (const pickup of s.pickups) assert.ok(seen.has(`${pickup.x},${pickup.y}`), "pickup should be reachable");
  assert.ok(seen.has(`${s.exit.x},${s.exit.y}`), "exit should be reachable");
});
test("explore pickup collection gates exit win", () => {
  const explore = gameFromRegistry("explore");
  const c = validate({ worldSize:10, pickups:3, hazards:0, theme:"mono", title:"Explorer" }, explore.schema);
  let s = explore.engine.init(c);
  s.player = { ...s.pickups[0] };
  s = explore.engine.step(s, {}, 0);
  assert.equal(s.pickups.length, c.pickups - 1);

  s.pickups = [];
  s.player = { ...s.exit };
  s = explore.engine.step(s, {}, 0);
  assert.equal(explore.engine.status(s).won, true);
});

test("topdown bullet reaches and removes an enemy", () => {
  const topdown = gameFromRegistry("topdown");
  const c = validate({ fireRate:10, enemySpeed:1, spawnRate:1, lives:3 }, topdown.schema);
  let s = topdown.engine.init(c);
  s.enemies = [{ x:s.playerX, y:s.playerY - 84 }];
  s = topdown.engine.step(s, { fire:true }, 1);
  for (let i = 0; i < 12; i++) s = topdown.engine.step(s, {}, 1);
  assert.equal(s.enemies.length, 0);
  assert.equal(topdown.engine.status(s).score, 1);
});
test("topdown enemy reaching the player costs a life and can end the game", () => {
  const topdown = gameFromRegistry("topdown");
  const c = validate({ lives:1, enemySpeed:1, spawnRate:1 }, topdown.schema);
  let s = topdown.engine.init(c);
  s.enemies = [{ x:s.playerX, y:s.playerY + 4 }];
  s = topdown.engine.step(s, {}, 1);
  assert.equal(s.lives, 0);
  assert.equal(topdown.engine.status(s).over, true);
});

test("driver left/right edge presses change lane by one", () => {
  const driver = gameFromRegistry("driver");
  const c = validate({ laneCount:4, speed:4, spawnRate:4 }, driver.schema);
  let s = driver.engine.init(c);
  assert.equal(s.lane, 1);
  s = driver.engine.step(s, { right:true }, 1);
  assert.equal(s.lane, 2);
  s = driver.engine.step(s, { right:true }, 1);
  assert.equal(s.lane, 2, "held right should not keep changing lanes");
  s = driver.engine.step(s, { right:false }, 1);
  s = driver.engine.step(s, { left:true }, 1);
  assert.equal(s.lane, 1);
});
test("driver obstacle in the player lane at contact sets over", () => {
  const driver = gameFromRegistry("driver");
  const c = validate({ laneCount:4, speed:4, spawnRate:4 }, driver.schema);
  let s = driver.engine.init(c);
  s.obstacles = [{ lane:s.lane, y:520 }];
  s = driver.engine.step(s, {}, 1);
  assert.equal(driver.engine.status(s).over, true);
});
test("driver surviving increases score", () => {
  const driver = gameFromRegistry("driver");
  const c = validate({ laneCount:4, speed:4, spawnRate:4 }, driver.schema);
  let s = driver.engine.init(c);
  for (let i = 0; i < 25; i++) s = driver.engine.step(s, {}, 1);
  assert.ok(driver.engine.status(s).score > 0);
});

test("shooter schema includes configurable boss cadence", () => {
  assert.deepEqual(shooter.schema.bossEvery, { type:"number", min:3, max:10, default:5 });
});
test("shooter powerup collection activates a temporary mode", () => {
  const c = { ...shooterCfg, bossEvery:5 };
  let s = shooter.engine.init(c);
  s.powerups = [{ x:s.playerX, y:552, type:"rapid" }];
  s = shooter.engine.step(s, {}, 1);
  assert.equal(s.powerType, "rapid");
  assert.ok(s.powerTimer > 0);
  assert.deepEqual(s.powerups, []);
});
test("shooter boss requires multiple hits before it dies", () => {
  const c = { ...shooterCfg, bossEvery:3 };
  let s = shooter.engine.init(c);
  s.wave = 3;
  s.enemies = [{ x:s.playerX, y:320, hp:3, boss:true }];
  s.bullets = [{ x:s.playerX, y:320 }];
  s = shooter.engine.step(s, {}, 0);
  assert.equal(s.enemies.length, 1);
  assert.equal(s.enemies[0].hp, 2);
  s.bullets = [{ x:s.playerX, y:s.enemies[0].y }];
  s = shooter.engine.step(s, {}, 0);
  assert.equal(s.enemies[0].hp, 1);
  s.bullets = [{ x:s.playerX, y:s.enemies[0].y }];
  s = shooter.engine.step(s, {}, 0);
  assert.equal(s.wave, 4);
  assert.equal(s.enemies.some(e => e.boss), false);
  assert.ok(s.score >= 5);
});
test("snake advances one cell in its heading after a full tick", () => {
  const snake = gameFromRegistry("snake");
  const c = validate({ speed:10, growth:1 }, snake.schema); // interval = 2
  let s = snake.engine.init(c);
  const head0 = { ...s.snake[0] };
  s.food = { x:-9, y:-9 }; // keep food out of the way
  for (let i = 0; i < 2; i++) s = snake.engine.step(s, {}, 1);
  assert.deepEqual(s.snake[0], { x:head0.x + 1, y:head0.y }, "moves right one cell");
  assert.equal(s.snake.length, 3, "length unchanged without food");
});
test("snake eating food grows the body and scores", () => {
  const snake = gameFromRegistry("snake");
  const c = validate({ speed:10, growth:1 }, snake.schema);
  let s = snake.engine.init(c);
  const len0 = s.snake.length;
  s.food = { x:s.snake[0].x + 1, y:s.snake[0].y }; // directly ahead
  for (let i = 0; i < 2; i++) s = snake.engine.step(s, {}, 1);
  assert.equal(snake.engine.status(s).score, 1);
  assert.equal(s.snake.length, len0 + 1, "eating adds a segment");
});
test("snake running into the wall ends the game", () => {
  const snake = gameFromRegistry("snake");
  const c = validate({ speed:10, growth:1 }, snake.schema);
  let s = snake.engine.init(c);
  s.food = { x:-9, y:-9 };
  s.snake = [{ x:s.cols - 1, y:5 }, { x:s.cols - 2, y:5 }];
  s.dir = { x:1, y:0 }; s.pending = { x:1, y:0 };
  for (let i = 0; i < 2; i++) s = snake.engine.step(s, {}, 1);
  assert.equal(snake.engine.status(s).over, true);
});
test("snake colliding with its own body ends the game", () => {
  const snake = gameFromRegistry("snake");
  const c = validate({ speed:10, growth:1 }, snake.schema);
  let s = snake.engine.init(c);
  s.food = { x:-9, y:-9 };
  // U-turn body so heading down collides with an existing segment.
  s.snake = [{ x:5, y:5 }, { x:5, y:6 }, { x:6, y:6 }, { x:6, y:5 }];
  s.dir = { x:0, y:0 }; s.pending = { x:0, y:1 };
  for (let i = 0; i < 2; i++) s = snake.engine.step(s, { down:true }, 1);
  assert.equal(snake.engine.status(s).over, true);
});
test("snake is deterministic for identical inputs", () => {
  const snake = gameFromRegistry("snake");
  const c = validate({ speed:8, growth:2, theme:"neon", title:"Det Snake" }, snake.schema);
  const run = () => {
    let s = snake.engine.init(c);
    for (let i = 0; i < 60; i++) s = snake.engine.step(s, i % 20 < 10 ? { down:true } : { right:true }, 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

test("tetris gravity drops the active piece after a tick", () => {
  const tetris = gameFromRegistry("tetris");
  const c = validate({ speed:10 }, tetris.schema); // interval = 4
  let s = tetris.engine.init(c);
  const y0 = s.piece.y;
  for (let i = 0; i < 4; i++) s = tetris.engine.step(s, {}, 1);
  assert.equal(s.piece.y, y0 + 1, "piece falls one row per gravity tick");
});
test("tetris clears a completed line and scores", () => {
  const tetris = gameFromRegistry("tetris");
  const c = validate({ speed:10 }, tetris.schema);
  let s = tetris.engine.init(c);
  // Fill the bottom row so the next lock clears it.
  s.board[s.rows - 1] = new Array(s.cols).fill(1);
  s.piece = { type:"O", rot:0, x:0, y:0 };
  for (let i = 0; i < 200 && s.score === 0 && !s.dead; i++) s = tetris.engine.step(s, { down:true }, 1);
  assert.equal(s.score, 1, "one full row cleared → score 1");
  assert.equal(s.board[s.rows - 1].every(c => c), false, "bottom row no longer full");
});
test("tetris tops out when a new piece cannot spawn", () => {
  const tetris = gameFromRegistry("tetris");
  const c = validate({ speed:10 }, tetris.schema);
  let s = tetris.engine.init(c);
  // Fill rows near the top but leave column 0 empty so nothing clears; the
  // stack reaches the spawn zone, so the next respawn tops out.
  for (let y = 1; y < s.rows; y++) { s.board[y] = new Array(s.cols).fill(1); s.board[y][0] = 0; }
  s.piece = { type:"O", rot:0, x:0, y:0 };
  for (let i = 0; i < 50 && !s.dead; i++) s = tetris.engine.step(s, {}, 1);
  assert.equal(tetris.engine.status(s).over, true);
});
test("tetris piece sequence is deterministic from the seed", () => {
  const tetris = gameFromRegistry("tetris");
  const c = validate({ speed:5, theme:"retro", title:"Det Blocks" }, tetris.schema);
  const run = () => {
    let s = tetris.engine.init(c);
    for (let i = 0; i < 300; i++) s = tetris.engine.step(s, {}, 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

test("bullethell player moves in all four directions", () => {
  const bullethell = gameFromRegistry("bullethell");
  const c = validate({ playerSpeed:9 }, bullethell.schema);
  let s = bullethell.engine.init(c);
  const x0 = s.x, y0 = s.y;
  s = bullethell.engine.step(s, { left:true }, 1);
  assert.ok(s.x < x0, "left decreases x");
  s = bullethell.engine.step(s, { right:true }, 1);
  s = bullethell.engine.step(s, { right:true }, 1);
  assert.ok(s.x > x0, "right increases x");
  s = bullethell.engine.step(s, { up:true }, 1);
  assert.ok(s.y < y0, "up decreases y");
});
test("bullethell surviving accrues score", () => {
  const bullethell = gameFromRegistry("bullethell");
  const c = validate({}, bullethell.schema);
  let s = bullethell.engine.init(c);
  for (let i = 0; i < 30; i++) s = bullethell.engine.step(s, {}, 1);
  assert.ok(bullethell.engine.status(s).score > 0, "survival time becomes score");
  assert.equal(bullethell.engine.status(s).over, false);
});
test("bullethell taking a bullet ends the game", () => {
  const bullethell = gameFromRegistry("bullethell");
  const c = validate({}, bullethell.schema);
  let s = bullethell.engine.init(c);
  s.bullets = [{ x:s.x, y:s.y, vx:0, vy:0 }];
  s = bullethell.engine.step(s, {}, 1);
  assert.equal(bullethell.engine.status(s).over, true);
});
test("bullethell is deterministic for identical inputs", () => {
  const bullethell = gameFromRegistry("bullethell");
  const c = validate({ bulletSpeed:4, fireRate:8, waveSize:10, theme:"neon", title:"Det Barrage" }, bullethell.schema);
  const run = () => {
    let s = bullethell.engine.init(c);
    for (let i = 0; i < 80; i++) s = bullethell.engine.step(s, i % 4 === 0 ? { left:true } : { right:true }, 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

test("breakout multiball powerup collection adds another ball", () => {
  let s = breakout.engine.init({ ...breakoutCfg, powerups:"on" });
  const initial = s.balls?.length ?? 1;
  s.powerups = [{ x:s.paddleX, y:552, type:"multiball" }];
  s = breakout.engine.step(s, {}, 1);
  assert.ok(s.balls.length > initial);
  assert.deepEqual(s.powerups, []);
});
test("breakout advances to the next level once all bricks are cleared", () => {
  let s = breakout.engine.init({ ...breakoutCfg, powerups:"on" });
  s.score = 7;
  s.bricks = [];
  s = breakout.engine.step(s, {}, 1);
  assert.equal(s.level, 2);
  assert.equal(s.score, 7);
  assert.equal(breakout.engine.status(s).won, false);
  assert.ok(s.bricks.length > 0);
  assert.ok(Math.abs(s.ball.vy) > breakoutCfg.ballSpeed);
});

test("frogger moves one grid cell per fresh press and ignores a held key", () => {
  const frogger = gameFromRegistry("frogger");
  const c = validate({ speed:3, lives:3 }, frogger.schema);
  let s = frogger.engine.init(c);
  const { x, y } = s.frog;
  s = frogger.engine.step(s, { up:true }, 1);
  assert.deepEqual(s.frog, { x, y:y - 1 }, "up press hops one row toward the goal");
  s = frogger.engine.step(s, { up:true }, 1);
  assert.deepEqual(s.frog, { x, y:y - 1 }, "held up does not keep hopping");
});
test("frogger reaching the top scores a point and resets to the start row", () => {
  const frogger = gameFromRegistry("frogger");
  const c = validate({ speed:3, lives:3 }, frogger.schema);
  let s = frogger.engine.init(c);
  s.frog = { x:4, y:1 };
  s = frogger.engine.step(s, { up:true }, 1); // moves to row 0 → goal
  assert.equal(frogger.engine.status(s).score, 1);
  assert.equal(s.frog.y, 14, "frog reset to the bottom start row");
});
test("frogger hitting traffic costs a life; last life ends the game", () => {
  const frogger = gameFromRegistry("frogger");
  const c = validate({ speed:3, lives:2 }, frogger.schema);
  let s = frogger.engine.init(c);
  // One stationary car sitting exactly on the frog's cell.
  s.frog = { x:0, y:3 };
  s.lanes = [{ row:3, dir:1, speed:0, cars:1, offset:0 }];
  s = frogger.engine.step(s, {}, 1);
  assert.equal(s.lives, 1, "collision drops a life");
  assert.equal(frogger.engine.status(s).over, false);
  s.frog = { x:0, y:3 };
  s = frogger.engine.step(s, {}, 1);
  assert.equal(s.lives, 0);
  assert.equal(frogger.engine.status(s).over, true);
});
test("frogger is deterministic for identical inputs", () => {
  const frogger = gameFromRegistry("frogger");
  const c = validate({ speed:5, lives:3, theme:"neon", title:"Det Hop" }, frogger.schema);
  const run = () => {
    let s = frogger.engine.init(c);
    const seq = [{ up:true }, {}, { left:true }, {}, { up:true }, {}, { right:true }, {}];
    for (let i = 0; i < 80; i++) s = frogger.engine.step(s, seq[i % seq.length], 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

test("twenty48 slides and merges a row on a fresh press, scoring the merge", () => {
  const twenty48 = gameFromRegistry("twenty48");
  const c = validate({ theme:"retro", title:"Merge" }, twenty48.schema);
  let s = twenty48.engine.init(c);
  s.grid = [[2,2,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  s.score = 0;
  s = twenty48.engine.step(s, { left:true }, 1);
  assert.equal(s.grid[0][0], 4, "two 2s merge into a 4 at the edge");
  assert.equal(s.score, 4, "score is the merged value");
});
test("twenty48 applies one move per press (held key does nothing)", () => {
  const twenty48 = gameFromRegistry("twenty48");
  const c = validate({ theme:"retro", title:"Merge" }, twenty48.schema);
  let s = twenty48.engine.init(c);
  s.grid = [[2,0,0,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  s = twenty48.engine.step(s, { left:true }, 1);
  const after = s.grid.map(r => r.slice());
  s = twenty48.engine.step(s, { left:true }, 1); // still held → ignored
  assert.deepEqual(s.grid, after, "held left does not trigger a second slide");
});
test("twenty48 reaching 2048 wins", () => {
  const twenty48 = gameFromRegistry("twenty48");
  const c = validate({ theme:"retro", title:"Merge" }, twenty48.schema);
  let s = twenty48.engine.init(c);
  s.grid = [[1024,1024,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  s = twenty48.engine.step(s, { left:true }, 1);
  assert.equal(twenty48.engine.status(s).won, true);
});
test("twenty48 ends when the board is locked with no moves", () => {
  const twenty48 = gameFromRegistry("twenty48");
  const c = validate({ theme:"retro", title:"Merge" }, twenty48.schema);
  let s = twenty48.engine.init(c);
  s.grid = [[2,4,2,4],[4,2,4,2],[2,4,2,4],[4,2,4,2]];
  s = twenty48.engine.step(s, {}, 1);
  assert.equal(twenty48.engine.status(s).over, true);
});
test("twenty48 tile spawns are deterministic from the seed", () => {
  const twenty48 = gameFromRegistry("twenty48");
  const c = validate({ theme:"neon", title:"Det Merge" }, twenty48.schema);
  const run = () => {
    let s = twenty48.engine.init(c);
    const seq = [{ left:true }, {}, { up:true }, {}, { right:true }, {}, { down:true }, {}];
    for (let i = 0; i < 80; i++) s = twenty48.engine.step(s, seq[i % seq.length], 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

test("pong player paddle follows left/right input", () => {
  const pong = gameFromRegistry("pong");
  const c = validate({ winScore:5, ballSpeed:4, paddleWidth:70, aiSpeed:4 }, pong.schema);
  let s = pong.engine.init(c);
  const x0 = s.playerX;
  s = pong.engine.step(s, { left:true }, 1);
  assert.ok(s.playerX < x0, "left moves the paddle left");
  s = pong.engine.step(s, { right:true }, 1);
  s = pong.engine.step(s, { right:true }, 1);
  assert.ok(s.playerX > x0, "right moves the paddle right");
});
test("pong ball reflects off the player paddle", () => {
  const pong = gameFromRegistry("pong");
  const c = validate({ winScore:5, ballSpeed:4, paddleWidth:70, aiSpeed:4 }, pong.schema);
  let s = pong.engine.init(c);
  s.playerX = 200;
  s.ball = { x:200, y:556, vx:0, vy:4 }; // heading into the bottom paddle
  s = pong.engine.step(s, {}, 1);
  assert.ok(s.ball.vy < 0, "ball bounces back up off the player paddle");
});
test("pong scores when the ball passes a paddle", () => {
  const pong = gameFromRegistry("pong");
  const c = validate({ winScore:5, ballSpeed:4, paddleWidth:70, aiSpeed:4 }, pong.schema);
  let s = pong.engine.init(c);
  s.ball = { x:200, y:-5, vx:0, vy:0 }; // already past the AI's edge
  s = pong.engine.step(s, {}, 1);
  assert.equal(s.playerScore, 1, "ball past the top scores for the player");
  s.ball = { x:200, y:605, vx:0, vy:0 }; // past the player's edge
  s = pong.engine.step(s, {}, 1);
  assert.equal(s.aiScore, 1, "ball past the bottom scores for the AI");
});
test("pong reaching winScore ends the game with the right winner", () => {
  const pong = gameFromRegistry("pong");
  const c = validate({ winScore:3, ballSpeed:4, paddleWidth:70, aiSpeed:4 }, pong.schema);
  let s = pong.engine.init(c);
  s.playerScore = 2;
  s.ball = { x:200, y:-5, vx:0, vy:0 };
  s = pong.engine.step(s, {}, 1);
  assert.deepEqual(pong.engine.status(s), { score:3, over:true, won:true });

  s = pong.engine.init(c);
  s.aiScore = 2;
  s.ball = { x:200, y:605, vx:0, vy:0 };
  s = pong.engine.step(s, {}, 1);
  const st = pong.engine.status(s);
  assert.equal(st.over, true);
  assert.equal(st.won, false, "AI reaching winScore is a loss");
});
test("pong is deterministic for identical inputs", () => {
  const pong = gameFromRegistry("pong");
  const c = validate({ winScore:11, ballSpeed:5, paddleWidth:60, aiSpeed:4, theme:"neon", title:"Det Rally" }, pong.schema);
  const run = () => {
    let s = pong.engine.init(c);
    for (let i = 0; i < 300; i++) s = pong.engine.step(s, i % 20 < 10 ? { left:true } : { right:true }, 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

const raycasterCfg = validate({ fov:66, moveSpeed:4, turnSpeed:4, enemyCount:5, mapSize:12, health:3 }, gameFromRegistry("raycaster").schema);
test("raycaster up moves the player forward along its facing angle", () => {
  const raycaster = gameFromRegistry("raycaster");
  let s = raycaster.engine.init(raycasterCfg);
  const x0 = s.player.x; // angle 0 → faces +x into open floor
  s = raycaster.engine.step(s, { up:true }, 1);
  assert.ok(s.player.x > x0, "forward advances along +x when facing angle 0");
  assert.equal(s.player.y, 1.5, "no drift on the perpendicular axis");
});
test("raycaster turning changes the player angle without moving", () => {
  const raycaster = gameFromRegistry("raycaster");
  let s = raycaster.engine.init(raycasterCfg);
  s = raycaster.engine.step(s, { left:true }, 1);
  assert.ok(s.player.angle < 0, "left turns counter-clockwise");
  const a = s.player.angle;
  s = raycaster.engine.step(s, { right:true }, 1);
  assert.ok(s.player.angle > a, "right turns back clockwise");
});
test("raycaster firing at an enemy in the line of sight kills it and scores", () => {
  const raycaster = gameFromRegistry("raycaster");
  let s = raycaster.engine.init(raycasterCfg);
  // Target dead ahead down the clear row; a spare off to the side keeps the
  // wave alive so the endless respawn does not replace the array mid-assert.
  s.enemies = [{ x:s.player.x + 3, y:s.player.y, alive:true }, { x:s.player.x, y:s.player.y + 3, alive:true }];
  s = raycaster.engine.step(s, { fire:true }, 1);
  assert.equal(s.enemies[0].alive, false, "hitscan ray downs the enemy in front");
  assert.equal(s.enemies[1].alive, true, "the off-beam enemy is untouched");
  assert.equal(raycaster.engine.status(s).score, 1);
});
test("raycaster does not shoot an enemy off to the side", () => {
  const raycaster = gameFromRegistry("raycaster");
  let s = raycaster.engine.init(raycasterCfg);
  s.enemies = [{ x:s.player.x, y:s.player.y + 3, alive:true }]; // 90° off the aim
  s = raycaster.engine.step(s, { fire:true }, 1);
  assert.equal(s.enemies[0].alive, true, "enemy outside the aim beam survives");
  assert.equal(raycaster.engine.status(s).score, 0);
});
test("raycaster an enemy reaching the player drains health and can end the game", () => {
  const raycaster = gameFromRegistry("raycaster");
  let s = raycaster.engine.init(raycasterCfg);
  s.health = 1;
  s.enemies = [{ x:s.player.x + 0.3, y:s.player.y, alive:true }]; // touching
  s = raycaster.engine.step(s, {}, 1);
  assert.equal(s.health, 0);
  assert.equal(raycaster.engine.status(s).over, true);
});
test("raycaster map is navigable and identical across two identical seeds", () => {
  const raycaster = gameFromRegistry("raycaster");
  const c = validate({ mapSize:14, enemyCount:6, theme:"neon", title:"Det Corridor" }, raycaster.schema);
  const a = raycaster.engine.init(c);
  const b = raycaster.engine.init(c);
  assert.deepEqual(a, b, "same config → identical initial state");
  // Every floor cell is reachable from the player start.
  const floor = a.grid.flatMap((row, y) => row.map((wall, x) => (wall ? null : `${x},${y}`)).filter(Boolean));
  const seen = reachableCells(a.grid, { x:Math.floor(a.player.x), y:Math.floor(a.player.y) });
  for (const cell of floor) assert.ok(seen.has(cell), `floor cell ${cell} should be reachable`);
});
test("raycaster is deterministic across a played sequence", () => {
  const raycaster = gameFromRegistry("raycaster");
  const c = validate({ fov:75, moveSpeed:5, turnSpeed:5, enemyCount:6, mapSize:12, theme:"retro", title:"Det Play" }, raycaster.schema);
  const seq = [{ up:true }, { left:true }, { fire:true }, {}, { up:true }, { right:true }, { fire:true }, {}];
  const run = () => {
    let s = raycaster.engine.init(c);
    for (let i = 0; i < 120; i++) s = raycaster.engine.step(s, seq[i % seq.length], 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

const tabshooterCfg = validate({ fireRate:10, speed:0, lives:3 }, gameFromRegistry("tabshooter").schema);
test("tabshooter shooting a non-protected tab kills it, scores, and enqueues its id to close", () => {
  const tab = gameFromRegistry("tabshooter");
  let s = tab.engine.init({ ...tabshooterCfg, targets:[{ id:"tab-1", title:"Inbox (12)", protected:false }] });
  const t = s.targets[0];
  s.bullets = [{ x:t.x, y:t.y }]; // bullet already on the target
  s = tab.engine.step(s, {}, 0);
  assert.equal(s.targets[0].dead, true, "a hit tab is marked dead");
  assert.deepEqual(s.closedIds, ["tab-1"], "the tab's id is pushed for the caller to close");
  assert.equal(tab.engine.status(s).score, 1, "closing a tab scores");
});
test("tabshooter never kills or closes a protected tab — bullets pass through", () => {
  const tab = gameFromRegistry("tabshooter");
  let s = tab.engine.init({ ...tabshooterCfg, targets:[{ id:"pin-1", title:"Calendar", protected:true }] });
  const t = s.targets[0];
  for (let i = 0; i < 25; i++) { s.bullets.push({ x:t.x, y:t.y }); s = tab.engine.step(s, {}, 0); }
  assert.equal(s.targets[0].dead, false, "a protected tab is invulnerable");
  assert.deepEqual(s.closedIds, [], "a protected tab is never enqueued for close");
  assert.equal(tab.engine.status(s).score, 0, "shooting a protected tab does not score");
});
test("tabshooter never closes a tab that reaches the player — it only costs a life", () => {
  const tab = gameFromRegistry("tabshooter");
  const c = validate({ speed:1, lives:2 }, tab.schema);
  let s = tab.engine.init({ ...c, targets:[{ id:"escapee", title:"News", protected:false }] });
  s.targets[0].y = 560; // already at the player's row
  s = tab.engine.step(s, {}, 1);
  assert.equal(s.targets[0].dead, true, "an escaped tab leaves play");
  assert.equal(s.lives, 1, "an escaped tab costs a life");
  assert.deepEqual(s.closedIds, [], "an escaped tab is NEVER closed (no player shot)");
});
test("tabshooter falls back to demo targets when cfg.targets is missing or empty", () => {
  const tab = gameFromRegistry("tabshooter");
  const noTargets = tab.engine.init(validate({}, tab.schema));
  const empty = tab.engine.init({ ...tabshooterCfg, targets:[] });
  for (const s of [noTargets, empty]) {
    assert.ok(s.targets.length > 0, "demo targets always populate the field");
    assert.ok(s.targets.some(x => !x.protected), "demo has closable targets");
    assert.ok(s.targets.some(x => x.protected), "demo marks some targets protected");
  }
});
test("tabshooter is deterministic for identical inputs", () => {
  const tab = gameFromRegistry("tabshooter");
  const c = validate({ fireRate:6, speed:1, lives:3, theme:"neon", title:"Det Tabs" }, tab.schema);
  const run = () => {
    let s = tab.engine.init(c);
    for (let i = 0; i < 120; i++) s = tab.engine.step(s, i % 3 === 0 ? { fire:true } : (i % 2 ? { left:true } : { right:true }), 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

// A perfect maze connects every floor cell, so a plain 4-neighbour flood fill
// from the player's start cell must reach every pickup, every enemy, and the exit.
function raycastReachable(grid, start) {
  return reachableCells(grid, { x:Math.floor(start.x), y:Math.floor(start.y) });
}
const raymazeCfg = validate({ mapSize:15, pickupCount:6, enemyCount:3, health:3 }, gameFromRegistry("raymaze").schema);
test("raymaze up moves the player forward along its facing angle", () => {
  const raymaze = gameFromRegistry("raymaze");
  let s = raymaze.engine.init(raymazeCfg);
  const x0 = s.player.x; // angle 0 → faces +x into open floor
  s = raymaze.engine.step(s, { up:true }, 1);
  assert.ok(s.player.x > x0, "forward advances along +x when facing angle 0");
  assert.equal(s.player.y, 1.5, "no drift on the perpendicular axis");
});
test("raymaze turning changes the player angle without moving", () => {
  const raymaze = gameFromRegistry("raymaze");
  let s = raymaze.engine.init(raymazeCfg);
  const pos = { ...s.player };
  s = raymaze.engine.step(s, { left:true }, 1);
  assert.ok(s.player.angle < 0, "left turns counter-clockwise");
  assert.equal(s.player.x, pos.x, "turning does not move x");
  assert.equal(s.player.y, pos.y, "turning does not move y");
});
test("raymaze walking onto a pickup collects it and scores", () => {
  const raymaze = gameFromRegistry("raymaze");
  let s = raymaze.engine.init(raymazeCfg);
  const before = s.pickups.length;
  s.player.x = s.pickups[0].x; s.player.y = s.pickups[0].y; // stand on it
  s = raymaze.engine.step(s, {}, 1);
  assert.equal(s.pickups.length, before - 1, "the pickup is removed");
  assert.equal(raymaze.engine.status(s).score, 1, "collecting scores");
});
test("raymaze wins only after all pickups are collected AND the exit is reached", () => {
  const raymaze = gameFromRegistry("raymaze");
  let s = raymaze.engine.init(raymazeCfg);
  s.enemies = []; // keep the run clean
  // Standing on the exit with pickups outstanding does NOT win.
  s.player.x = s.exit.x + 0.5; s.player.y = s.exit.y + 0.5;
  s = raymaze.engine.step(s, {}, 1);
  assert.equal(raymaze.engine.status(s).won, false, "exit is inert while loot remains");
  // Clear the loot, return to the exit → win.
  s.pickups = [];
  s.player.x = s.exit.x + 0.5; s.player.y = s.exit.y + 0.5;
  s = raymaze.engine.step(s, {}, 1);
  assert.equal(raymaze.engine.status(s).won, true, "cleared + on exit → win");
});
test("raymaze an enemy reaching the player drains health and can end the game", () => {
  const raymaze = gameFromRegistry("raymaze");
  let s = raymaze.engine.init(raymazeCfg);
  s.health = 1;
  s.enemies = [{ x:s.player.x + 0.3, y:s.player.y, home:{ x:s.player.x + 0.3, y:s.player.y }, alive:true }];
  s = raymaze.engine.step(s, {}, 1);
  assert.equal(s.health, 0);
  assert.equal(raymaze.engine.status(s).over, true);
});
test("raymaze map is a connected maze: every pickup, enemy, and the exit is reachable", () => {
  const raymaze = gameFromRegistry("raymaze");
  const c = validate({ mapSize:15, pickupCount:8, enemyCount:4, theme:"neon", title:"Det Maze" }, raymaze.schema);
  const a = raymaze.engine.init(c);
  const b = raymaze.engine.init(c);
  assert.deepEqual(a, b, "same config → identical initial state");
  const seen = raycastReachable(a.grid, a.player);
  for (const pk of a.pickups) assert.ok(seen.has(`${Math.floor(pk.x)},${Math.floor(pk.y)}`), "pickup reachable");
  for (const e of a.enemies) assert.ok(seen.has(`${Math.floor(e.x)},${Math.floor(e.y)}`), "enemy reachable");
  assert.ok(seen.has(`${a.exit.x},${a.exit.y}`), "exit reachable");
});
test("raymaze is deterministic across a played sequence", () => {
  const raymaze = gameFromRegistry("raymaze");
  const c = validate({ mapSize:15, pickupCount:6, enemyCount:3, theme:"retro", title:"Det Hunt" }, raymaze.schema);
  const seq = [{ up:true }, { left:true }, {}, { up:true }, { right:true }, {}];
  const run = () => {
    let s = raymaze.engine.init(c);
    for (let i = 0; i < 120; i++) s = raymaze.engine.step(s, seq[i % seq.length], 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

const raysurviveCfg = validate({ fov:72, moveSpeed:4, turnSpeed:4, mapSize:12, health:5, ammo:12, enemyCount:4 }, gameFromRegistry("raysurvive").schema);
test("raysurvive up moves the player forward along its facing angle", () => {
  const raysurvive = gameFromRegistry("raysurvive");
  let s = raysurvive.engine.init(raysurviveCfg);
  const x0 = s.player.x;
  s = raysurvive.engine.step(s, { up:true }, 1);
  assert.ok(s.player.x > x0, "forward advances along +x when facing angle 0");
  assert.equal(s.player.y, 1.5, "no drift on the perpendicular axis");
});
test("raysurvive firing spends ammo and a hit in the aim beam scores a kill", () => {
  const raysurvive = gameFromRegistry("raysurvive");
  let s = raysurvive.engine.init(raysurviveCfg);
  const ammo0 = s.ammo;
  // A 1-hp target dead ahead, plus a spare off-beam so the wave does not respawn.
  s.enemies = [
    { x:s.player.x + 3, y:s.player.y, kind:"invader", speed:0, hp:1, scale:0.7, colorKey:"accent", alive:true },
    { x:s.player.x, y:s.player.y + 3, kind:"invader", speed:0, hp:1, scale:0.7, colorKey:"accent", alive:true }
  ];
  s = raysurvive.engine.step(s, { fire:true }, 1);
  assert.equal(s.ammo, ammo0 - 1, "a shot spends one round");
  assert.equal(s.enemies[0].alive, false, "the enemy in front is downed");
  assert.equal(s.enemies[1].alive, true, "the off-beam enemy survives");
  assert.equal(raysurvive.engine.status(s).score, 1, "a kill scores");
});
test("raysurvive cannot fire with no ammo", () => {
  const raysurvive = gameFromRegistry("raysurvive");
  let s = raysurvive.engine.init(raysurviveCfg);
  s.ammo = 0;
  s.enemies = [{ x:s.player.x + 3, y:s.player.y, kind:"invader", speed:0, hp:1, scale:0.7, colorKey:"accent", alive:true }];
  s = raysurvive.engine.step(s, { fire:true }, 1);
  assert.equal(s.enemies[0].alive, true, "no ammo → no shot");
  assert.equal(raysurvive.engine.status(s).score, 0);
});
test("raysurvive a brute survives one hit and dies on the third", () => {
  const raysurvive = gameFromRegistry("raysurvive");
  let s = raysurvive.engine.init(raysurviveCfg);
  s.ammo = 9;
  s.enemies = [
    { x:s.player.x + 3, y:s.player.y, kind:"block", speed:0, hp:3, scale:0.9, colorKey:"accent", alive:true },
    { x:s.player.x, y:s.player.y + 3, kind:"invader", speed:0, hp:1, scale:0.7, colorKey:"accent", alive:true }
  ];
  s = raysurvive.engine.step(s, { fire:true }, 1);
  assert.equal(s.enemies[0].hp, 2); assert.equal(s.enemies[0].alive, true);
  s = raysurvive.engine.step(s, {}, 1);               // release
  s = raysurvive.engine.step(s, { fire:true }, 1);
  assert.equal(s.enemies[0].hp, 1); assert.equal(s.enemies[0].alive, true);
  s = raysurvive.engine.step(s, {}, 1);
  s = raysurvive.engine.step(s, { fire:true }, 1);
  assert.equal(s.enemies[0].alive, false, "third hit downs the brute");
  assert.equal(raysurvive.engine.status(s).score, 1);
});
test("raysurvive clearing a wave escalates the next and tops up ammo", () => {
  const raysurvive = gameFromRegistry("raysurvive");
  let s = raysurvive.engine.init(raysurviveCfg);
  const firstWaveSize = s.enemies.length;
  s.ammo = 0;
  for (const e of s.enemies) e.alive = false;   // wave cleared
  s = raysurvive.engine.step(s, {}, 1);
  assert.equal(s.wave, 2, "next wave begins");
  assert.ok(s.enemies.length > firstWaveSize, "the wave escalates");
  assert.ok(s.ammo > 0, "ammo is topped up between waves");
});
test("raysurvive an enemy reaching the player drains health and can end the game", () => {
  const raysurvive = gameFromRegistry("raysurvive");
  let s = raysurvive.engine.init(raysurviveCfg);
  s.health = 1;
  s.enemies = [{ x:s.player.x + 0.3, y:s.player.y, kind:"invader", speed:0.02, hp:1, scale:0.7, colorKey:"accent", alive:true }];
  s = raysurvive.engine.step(s, {}, 1);
  assert.equal(s.health, 0);
  assert.equal(raysurvive.engine.status(s).over, true);
});
test("raysurvive is deterministic across a played sequence", () => {
  const raysurvive = gameFromRegistry("raysurvive");
  const c = validate({ fov:75, moveSpeed:5, turnSpeed:5, mapSize:12, health:5, ammo:16, enemyCount:4, theme:"neon", title:"Det Onslaught" }, raysurvive.schema);
  const seq = [{ up:true }, { left:true }, { fire:true }, {}, { up:true }, { right:true }, { fire:true }, {}];
  const run = () => {
    let s = raysurvive.engine.init(c);
    for (let i = 0; i < 160; i++) s = raysurvive.engine.step(s, seq[i % seq.length], 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

// citymap uses a 48px street grid; the cell a world coord falls in is floor(coord/48).
const CITY_CELL = 48;
const citymapCfg = validate({ citySize:13, carSpeed:4, fuel:120, theme:"retro", title:"City Run" }, gameFromRegistry("citymap").schema);
function cityCell(px) { return Math.floor(px / CITY_CELL); }
function firstBuilding(grid) {
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) if (grid[y][x]) return { x, y };
  return null;
}
test("citymap car drives along an open street but is blocked by a building", () => {
  const citymap = gameFromRegistry("citymap");
  let s = citymap.engine.init(citymapCfg);
  // Open street: the cell right of an even/even road cell is always road.
  s.car = { x:(2 + 0.5) * CITY_CELL, y:(2 + 0.5) * CITY_CELL, fx:0, fy:-1 };
  const x0 = s.car.x;
  s = citymap.engine.step(s, { right:true }, 1);
  assert.ok(s.car.x > x0, "car rolls forward onto open road");

  // Building wall: sit in the road cell just left of a building and push into it.
  const b = firstBuilding(s.grid);
  assert.ok(b, "the city has at least one building");
  s.car = { x:(b.x - 1 + 0.5) * CITY_CELL, y:(b.y + 0.5) * CITY_CELL, fx:0, fy:-1 };
  for (let i = 0; i < 40; i++) s = citymap.engine.step(s, { right:true }, 1);
  assert.equal(cityCell(s.car.x), b.x - 1, "the car never crosses into the building cell");
});
test("citymap reaching the pickup then the dropoff scores and issues a fresh job", () => {
  const citymap = gameFromRegistry("citymap");
  let s = citymap.engine.init(citymapCfg);
  assert.equal(s.phase, "pickup");
  const firstPickup = { ...s.pickup }, firstDropoff = { ...s.dropoff };

  s.car.x = (s.pickup.x + 0.5) * CITY_CELL; s.car.y = (s.pickup.y + 0.5) * CITY_CELL;
  s = citymap.engine.step(s, {}, 1);
  assert.equal(s.phase, "dropoff", "arriving at the pickup switches to the dropoff leg");
  assert.equal(citymap.engine.status(s).score, 0, "the pickup itself does not score");

  s.car.x = (s.dropoff.x + 0.5) * CITY_CELL; s.car.y = (s.dropoff.y + 0.5) * CITY_CELL;
  s = citymap.engine.step(s, {}, 1);
  assert.equal(citymap.engine.status(s).score, 1, "completing the delivery scores");
  assert.equal(s.phase, "pickup", "a new job begins at the pickup phase");
  assert.notDeepEqual({ p:s.pickup, d:s.dropoff }, { p:firstPickup, d:firstDropoff }, "a fresh job is generated");
});
test("citymap runs out of fuel and ends the game", () => {
  const citymap = gameFromRegistry("citymap");
  let s = citymap.engine.init(citymapCfg);
  s.fuel = 0.05;
  s = citymap.engine.step(s, { right:true }, 1); // driving burns the last drop
  assert.equal(citymap.engine.status(s).over, true);
});
test("citymap map is deterministic from its seed", () => {
  const citymap = gameFromRegistry("citymap");
  const c = validate({ citySize:15, carSpeed:5, fuel:140, theme:"neon", title:"Det City" }, citymap.schema);
  assert.deepEqual(citymap.engine.init(c), citymap.engine.init(c));
});
test("citymap streets connect: every road cell, the pickup and the dropoff are reachable from the start", () => {
  const citymap = gameFromRegistry("citymap");
  const s = citymap.engine.init(citymapCfg);
  const start = { x:cityCell(s.car.x), y:cityCell(s.car.y) };
  const seen = reachableCells(s.grid, start);
  for (const cell of s.roadCells) assert.ok(seen.has(`${cell.x},${cell.y}`), `road cell ${cell.x},${cell.y} should be reachable`);
  assert.ok(seen.has(`${s.pickup.x},${s.pickup.y}`), "pickup is reachable");
  assert.ok(seen.has(`${s.dropoff.x},${s.dropoff.y}`), "dropoff is reachable");
});
test("citymap is deterministic across a played sequence", () => {
  const citymap = gameFromRegistry("citymap");
  const c = validate({ citySize:13, carSpeed:6, fuel:200, theme:"retro", title:"Det Drive" }, citymap.schema);
  const seq = [{ right:true }, { down:true }, {}, { up:true }, { left:true }, {}];
  const run = () => {
    let s = citymap.engine.init(c);
    for (let i = 0; i < 120; i++) s = citymap.engine.step(s, seq[i % seq.length], 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

// ---------------------------------------------------------------------------
// Audit fixes: real fail states, difficulty, and no soft-locks / tunneling.
// ---------------------------------------------------------------------------

// FIX 1 — platformer: gaps are rolled from a JOINT reachability budget. The old
// proof checked vgap <= maxRise and hgap <= flat-reach INDEPENDENTLY, so a
// platform could demand near-max height AND near-max horizontal at once —
// unreachable. Here every consecutive gap must fit the horizontal reach STILL
// LEFT after rising that exact vgap (hReachAt), across levels 1..8, hardest cfgs.
function assertJointReachable(raw, levels = 8) {
  const c = validate(raw, platformer.schema);
  let s = platformer.engine.init(c);
  const maxRise = (c.jumpForce * c.jumpForce) / (2 * c.gravity);
  for (let lvl = 1; lvl <= levels; lvl++) {
    for (let i = 1; i < s.platforms.length; i++) {
      const dv = s.platforms[i - 1].y - s.platforms[i].y; // upward gap (px)
      const dh = Math.abs(
        (s.platforms[i].x + s.platforms[i].w / 2) - (s.platforms[i - 1].x + s.platforms[i - 1].w / 2)
      );
      assert.ok(dv > 0 && dv <= maxRise, `L${lvl} p${i}: vgap ${dv.toFixed(1)} vs maxRise ${maxRise.toFixed(1)}`);
      assert.ok(dh <= hReachAt(c, dv),
        `L${lvl} p${i}: hgap ${dh.toFixed(1)} exceeds JOINT reach ${hReachAt(c, dv).toFixed(1)} at vgap ${dv.toFixed(1)}`);
    }
    s.x = s.goal.x; s.y = s.goal.y; // clear the level → spawn the next, harder layout
    s = platformer.engine.step(s, {}, 1);
  }
}
test("platformer every level is reachable under the JOINT jump budget (levels 1..8)", () => {
  assertJointReachable({ gravity:1,  moveSpeed:4, jumpForce:12, platformCount:5 });            // default
  assertJointReachable({ gravity:2,  moveSpeed:2, jumpForce:8,  platformCount:3 });            // hardest clamp
  assertJointReachable({ gravity:0.4,moveSpeed:8, jumpForce:16, platformCount:8 });            // easiest clamp
  assertJointReachable({ gravity:99, moveSpeed:99,jumpForce:99, platformCount:99 });           // out-of-range → clamped
  assertJointReachable({ gravity:1,  moveSpeed:4, jumpForce:12, platformCount:5, ramp:1 });    // steepest ramp
});

// FIX 2 — raysurvive: a 0-ammo mag no longer soft-locks. With the wave un-cleared
// (so no wave-clear top-up) and no shots fired, the dry-mag regen still restores
// ammo, so the run can always progress or end — never stall forever.
test("raysurvive never soft-locks at 0 ammo — a dry mag regenerates rounds", () => {
  const raysurvive = gameFromRegistry("raysurvive");
  let s = raysurvive.engine.init(raysurviveCfg);
  s.ammo = 0;
  // A lone, stationary, distant enemy keeps the wave alive (no clear-refill) and
  // never contacts the player, isolating the dry-mag regen path.
  s.enemies = [{ x:s.player.x + 8, y:s.player.y + 8, kind:"invader", speed:0, hp:1, scale:0.7, colorKey:"accent", alive:true }];
  let regained = false;
  for (let i = 0; i < 600 && !regained; i++) { s = raysurvive.engine.step(s, {}, 1); if (s.ammo > 0) regained = true; }
  assert.ok(regained, "a 0-ammo run regains ammo instead of stalling unresolvable");
  assert.equal(raysurvive.engine.status(s).over, false, "and the run is still going");
});

// FIX 3 — pinpoint: the puzzle can be LOST. Four options / five clues used to force
// the answer by elimination (finish-unsolved was dead code). Now MAX_WRONG wrong
// guesses ends the run as a loss.
test("pinpoint can be LOST after MAX_WRONG wrong guesses (unsolved finish is reachable)", () => {
  const puzzle = { answer:"Planets", maxClues:5 };
  let pr = initProgress();
  assert.equal(pr.done, false, "a fresh puzzle is not already decided");
  for (let i = 0; i < MAX_WRONG; i++) pr = guess(puzzle, pr, "Wrong");
  assert.equal(pr.done, true, "the run ends after MAX_WRONG wrong guesses");
  assert.equal(pr.solved, false, "and it is a loss");
  assert.equal(pr.score, 0, "a lost run scores 0");
  const win = guess(puzzle, initProgress(), "Planets");
  assert.ok(win.solved && win.score > 0, "the correct option still wins and scores");
});

// FIX 4 — maze: a real seeded recursive-backtracker maze (varies by seed,
// solvable, non-trivial) with a chasing hunter for a genuine losing path.
test("maze is a genuine seeded maze: solvable, non-trivial, and varies by seed", () => {
  const a  = maze.engine.init(validate({ size:11, theme:"retro", title:"Maze A" }, maze.schema));
  const b  = maze.engine.init(validate({ size:11, theme:"retro", title:"Maze B" }, maze.schema));
  const a2 = maze.engine.init(validate({ size:11, theme:"retro", title:"Maze A" }, maze.schema));
  assert.notDeepEqual(a.grid, b.grid, "different titles → different mazes (was identical every level)");
  assert.deepEqual(a.grid, a2.grid, "same title → identical maze (deterministic)");
  const seen = reachableCells(a.grid, a.player);
  assert.ok(seen.has(`${a.exit.x},${a.exit.y}`), "the exit is reachable from the start");
  const rowOneInteriorWalls = a.grid[1].slice(1, a.size - 1).filter(Boolean).length;
  assert.ok(rowOneInteriorWalls > 0, "row 1 has interior walls — not the old cleared freeway");
});
test("maze can be LOST — the hunter catches a player who never moves", () => {
  let s = maze.engine.init(validate({ size:11, theme:"retro", title:"Chase Me" }, maze.schema));
  assert.equal(maze.engine.status(s).over, false, "not over at the start");
  for (let i = 0; i < 3000 && !s.dead; i++) s = maze.engine.step(s, {}, 1); // stand still
  const st = maze.engine.status(s);
  assert.equal(s.dead, true, "the hunter reaches an idle player");
  assert.equal(st.over, true);
  assert.equal(st.won, false, "being caught is a loss, not a win");
});

// FIX 5 — breakout/pong: swept sub-stepping stops the ball tunnelling through the
// paddle at high speed × turbo dt.
test("breakout ball cannot tunnel through the paddle at extreme speed", () => {
  let s = breakout.engine.init(validate({ ballSpeed:9, paddleWidth:120, rows:2, cols:4 }, breakout.schema));
  s.level = 20;               // ramp the ball speed far past the old 12px band
  s.paddleX = 200;
  const ball = { x:200, y:520, vx:0, vy:140 }; // absurd downward speed
  s.balls = [ball]; s.ball = ball;
  s = breakout.engine.step(s, {}, 4);          // big turbo dt
  assert.equal(s.balls.length, 1, "the ball did not fall past the paddle (no tunnel)");
  assert.equal(breakout.engine.status(s).over, false, "run continues — the ball bounced");
  assert.ok(s.balls[0].vy < 0, "the ball is heading back up after the paddle hit");
});
test("pong ball cannot tunnel through the player paddle at extreme speed", () => {
  const pong = gameFromRegistry("pong");
  let s = pong.engine.init(validate({ winScore:11, ballSpeed:8, paddleWidth:120, aiSpeed:4 }, pong.schema));
  s.playerX = 200;
  s.ball = { x:200, y:520, vx:0, vy:160 };
  s = pong.engine.step(s, {}, 4);
  assert.equal(s.aiScore, 0, "the ball did not slip past the player paddle for an AI point");
  assert.ok(s.ball.vy < 0, "the ball bounced back up off the player paddle");
});

// FIX 6 — tetris: edge-triggered horizontal move (one move per press), so a held
// or single-frame-tapped key can't slam the piece to the wall.
test("tetris moves once per tap and ignores a held key (edge-triggered)", () => {
  const tetris = gameFromRegistry("tetris");
  const c = validate({ speed:1 }, tetris.schema); // interval 13 → no gravity lock in these steps
  let s = tetris.engine.init(c);
  const x0 = s.piece.x;
  s = tetris.engine.step(s, { right:true }, 1);
  assert.equal(s.piece.x, x0 + 1, "one tap moves exactly one column");
  s = tetris.engine.step(s, { right:true }, 1);
  assert.equal(s.piece.x, x0 + 1, "a held key does not keep sliding");
  s = tetris.engine.step(s, { right:false }, 1); // release
  s = tetris.engine.step(s, { right:true }, 1);
  assert.equal(s.piece.x, x0 + 2, "a fresh press moves again");
});

// FIX 7 — raycaster/raymaze/raysurvive: enemies chase at a threatening fraction of
// the player's speed, so contact actually reaches and damages the player (they were
// ~9-25x too slow to ever be a threat).
test("raycaster enemies close in fast enough to reach and damage the player", () => {
  const raycaster = gameFromRegistry("raycaster");
  let s = raycaster.engine.init(raycasterCfg);
  s.health = 3;
  s.enemies = [{ x:s.player.x + 4, y:s.player.y, alive:true }]; // down the open row
  const h0 = s.health;
  for (let i = 0; i < 400 && s.health === h0; i++) s = raycaster.engine.step(s, {}, 1);
  assert.ok(s.health < h0, "the enemy reaches the player and drains health");
});
test("raymaze enemies chase fast enough to reach the player", () => {
  const raymaze = gameFromRegistry("raymaze");
  let s = raymaze.engine.init(raymazeCfg);
  s.health = 3; s.pickups = []; // player is not on the exit, so this cannot win
  s.enemies = [{ x:s.player.x + 2, y:s.player.y, home:{ x:s.player.x + 2, y:s.player.y }, alive:true }];
  const h0 = s.health;
  for (let i = 0; i < 400 && s.health === h0; i++) s = raymaze.engine.step(s, {}, 1);
  assert.ok(s.health < h0, "a maze enemy reaches the player through the corridor");
});
test("raysurvive enemies advance at spawn speed fast enough to reach the player", () => {
  const raysurvive = gameFromRegistry("raysurvive");
  let s = raysurvive.engine.init(raysurviveCfg);
  s.health = 3;
  const spawnedSpeed = s.enemies[0].speed;
  assert.ok(spawnedSpeed > raysurviveCfg.moveSpeed * 0.04 * 0.3, "spawn speed is a real fraction of the player's move");
  s.enemies = [{ x:s.player.x + 4, y:s.player.y, kind:"invader", speed:spawnedSpeed, hp:1, scale:0.7, colorKey:"accent", alive:true }];
  const h0 = s.health;
  for (let i = 0; i < 600 && s.health === h0; i++) s = raysurvive.engine.step(s, {}, 1);
  assert.ok(s.health < h0, "a spawned-speed enemy reaches the player");
});

// FIX 8 — dodger: seed-varied drop patterns + escalation over time (was a fixed,
// fully memorizable cycle with no ramp).
test("dodger escalates difficulty over time", () => {
  const c = validate({ spawnRate:4, fallSpeed:3, playerSpeed:6 }, dodger.schema);
  assert.ok(spawnInterval(c, 2000) < spawnInterval(c, 0), "spawns get tighter over time");
  assert.ok(fallSpeedAt(c, 2000) > fallSpeedAt(c, 0), "hazards fall faster over time");
});
test("dodger drops seed-varied patterns (not a fixed memorizable cycle)", () => {
  const firstX = title => {
    let s = dodger.engine.init(validate({ spawnRate:10, fallSpeed:3, playerSpeed:6, theme:"retro", title }, dodger.schema));
    for (let i = 0; i < 200 && s.hazards.length === 0; i++) s = dodger.engine.step(s, {}, 1);
    return s.hazards[0]?.x;
  };
  const a = firstX("Storm A"), b = firstX("Storm B");
  assert.ok(a != null && b != null, "both runs spawn a hazard");
  assert.notEqual(a, b, "different titles → different drop patterns");
});

// --- life (Conway's Game of Life — Simulation) ---------------------------
function lifeGrid() { return Array.from({ length: 30 }, () => new Array(20).fill(0)); }

test("life: a 2x2 block is a still life under evolve()", () => {
  const g = lifeGrid();
  g[10][10] = g[10][11] = g[11][10] = g[11][11] = 1;
  const next = evolve(g);
  assert.deepEqual(next, g, "the block is stable across a generation");
});
test("life: a blinker oscillates with period 2 under evolve()", () => {
  const g = lifeGrid();
  g[9][10] = g[10][10] = g[11][10] = 1; // vertical bar
  const horiz = evolve(g);
  assert.equal(horiz[10][9], 1); assert.equal(horiz[10][10], 1); assert.equal(horiz[10][11], 1);
  assert.equal(horiz[9][10], 0); assert.equal(horiz[11][10], 0);
  const back = evolve(horiz);
  assert.deepEqual(back, g, "two generations return to the vertical bar");
});
test("life: reaching the target population wins", () => {
  const life = gameFromRegistry("life");
  const c = validate({ target:20, lifespan:150, speed:5, theme:"neon", title:"Grow" }, life.schema);
  let s = life.engine.init(c);
  s.grid = lifeGrid();
  s.target = 20; // win threshold under test (init lifts target above the seed; here we pin it)
  for (let i = 0; i < 20; i++) s.grid[0][i] = 1; // exactly the target, no neighbours to count yet
  s = life.engine.step(s, {}, 0); // dt 0 → no evolution, just re-count + win check
  assert.equal(life.engine.status(s).won, true);
  assert.equal(life.engine.status(s).score, 20);
});
test("life: an extinct colony loses (over, not won)", () => {
  const life = gameFromRegistry("life");
  const c = validate({ target:200, lifespan:150, speed:10, theme:"mono", title:"Fade" }, life.schema);
  let s = life.engine.init(c);
  s.grid = lifeGrid();
  s.grid[15][10] = 1; // a lone cell — dies next generation
  s = life.engine.step(s, {}, 100); // advance many generations at once
  assert.equal(life.engine.status(s).over, true);
  assert.equal(life.engine.status(s).won, false);
  assert.equal(s.pop, 0, "the colony died out");
});
test("life: a tap toggles the cell under the pointer", () => {
  const life = gameFromRegistry("life");
  const c = validate({ theme:"retro", title:"Toggle" }, life.schema);
  let s = life.engine.init(c);
  const before = s.grid[5][1];
  s = life.engine.step(s, { tap:true, px:30, py:110 }, 0); // cell (col1,row5) at CELL=20
  assert.equal(s.grid[5][1], before ? 0 : 1, "tap flips the cell state");
});
test("life is deterministic for identical inputs", () => {
  const life = gameFromRegistry("life");
  const c = validate({ target:200, lifespan:400, speed:6, theme:"neon", title:"Det Life" }, life.schema);
  const run = () => {
    let s = life.engine.init(c);
    for (let i = 0; i < 120; i++) s = life.engine.step(s, {}, 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

// --- sand (falling-sand physics toy — Physics & Motion) ------------------
function sandGrid() { return Array.from({ length: 60 }, () => new Array(40).fill(EMPTY)); }

test("sand: a grain falls one cell per settle() tick", () => {
  const g = sandGrid();
  g[5][10] = SAND;
  settle(g);
  assert.equal(g[6][10], SAND, "the grain moved down");
  assert.equal(g[5][10], EMPTY, "its old cell is empty");
});
test("sand: grains pile up when diagonals are blocked", () => {
  const g = sandGrid();
  for (let y = 57; y <= 59; y++) { g[y][9] = WALL; g[y][11] = WALL; } // a one-wide well
  g[59][10] = SAND; g[58][10] = SAND; // two stacked grains on the floor
  settle(g);
  assert.equal(g[59][10], SAND, "bottom grain rests on the floor");
  assert.equal(g[58][10], SAND, "top grain piles on it (no diagonal escape)");
});
test("sand: a grain sinks through trapped water (swap)", () => {
  const g = sandGrid();
  for (let y = 58; y <= 59; y++) { g[y][9] = WALL; g[y][11] = WALL; } // well so the water can't flow off
  g[59][10] = WATER; g[58][10] = SAND; // water pooled on the floor, sand resting above
  settle(g);
  assert.equal(g[59][10], SAND, "sand sinks to the lower cell");
  assert.equal(g[58][10], WATER, "the displaced water rises into the vacated cell");
});
test("sand: filling the target zone to quota wins", () => {
  const sand = gameFromRegistry("sand");
  const c = validate({ flow:4, fillDepth:12, quota:10, theme:"cozy", title:"Fill" }, sand.schema);
  let s = sand.engine.init(c);
  s.grid = sandGrid();
  for (let i = 0; i < 10; i++) s.grid[59][i] = SAND; // 10 grains in the bottom (target) zone
  s = sand.engine.step(s, {}, 0); // dt 0 → no physics, just re-count + win check
  assert.equal(sand.engine.status(s).won, true);
  assert.ok(sand.engine.status(s).score >= 10);
});
test("sand is deterministic for identical inputs", () => {
  const sand = gameFromRegistry("sand");
  const c = validate({ flow:5, fillDepth:16, quota:600, theme:"neon", title:"Det Sand" }, sand.schema);
  const run = () => {
    let s = sand.engine.init(c);
    for (let i = 0; i < 80; i++) s = sand.engine.step(s, {}, 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

// --- rhythm (beat-tap — Sound & Music) -----------------------------------
function pressLane(lane) { return lane === 0 ? { left:true } : lane === 1 ? { up:true } : { right:true }; }

test("rhythm: an on-time lane hit scores and consumes the note", () => {
  const rhythm = gameFromRegistry("rhythm");
  const c = validate({ tempo:5, beats:24, health:5, theme:"neon", title:"Hit" }, rhythm.schema);
  let s = rhythm.engine.init(c);
  const note = s.notes[0];
  s.time = note.hitTime; // land exactly on the beat
  s = rhythm.engine.step(s, pressLane(note.lane), 0);
  assert.ok(rhythm.engine.status(s).score > 0, "a timed hit scores");
  assert.equal(s.notes[0].hit, true);
  assert.equal(s.hits, 1);
});
test("rhythm: a note that falls past unhit is a penalised miss", () => {
  const rhythm = gameFromRegistry("rhythm");
  const c = validate({ tempo:5, beats:24, health:5, theme:"retro", title:"Miss" }, rhythm.schema);
  let s = rhythm.engine.init(c);
  const h0 = s.health;
  for (let i = 0; i < 200 && s.misses === 0; i++) s = rhythm.engine.step(s, {}, 1);
  assert.equal(s.misses, 1, "the first note becomes a miss");
  assert.equal(s.health, h0 - 1, "a miss costs one health");
});
test("rhythm: clearing the whole song wins with health to spare", () => {
  const rhythm = gameFromRegistry("rhythm");
  const c = validate({ tempo:6, beats:16, health:5, theme:"neon", title:"Clear" }, rhythm.schema);
  let s = rhythm.engine.init(c);
  for (let i = 0; i < 5000 && !s.won && !s.over; i++) {
    let input = {};
    for (const n of s.notes) if (!n.judged && Math.abs(n.hitTime - s.time) <= 1) input = pressLane(n.lane);
    s = rhythm.engine.step(s, input, 1);
  }
  assert.equal(rhythm.engine.status(s).won, true, "perfect play wins");
  assert.equal(rhythm.engine.status(s).over, false);
  assert.equal(s.hits, 16, "every beat was hit");
});
test("rhythm is deterministic for identical inputs", () => {
  const rhythm = gameFromRegistry("rhythm");
  const c = validate({ tempo:9, beats:40, health:4, theme:"neon", title:"Det Beat" }, rhythm.schema);
  const seq = [{ left:true }, {}, { up:true }, {}, { right:true }, {}, {}, {}];
  const run = () => {
    let s = rhythm.engine.init(c);
    for (let i = 0; i < 200; i++) s = rhythm.engine.step(s, seq[i % seq.length], 1);
    return s;
  };
  assert.deepEqual(run(), run());
});
