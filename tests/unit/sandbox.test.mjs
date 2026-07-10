import { test } from "node:test";
import assert from "node:assert/strict";
import sandbox, { specValidate } from "../../src/games/sandbox.js";

const { engine } = sandbox;
const GOALS = ["collectAll", "survive", "score", "reachGoal", "defend", "escort", "combo"];
const countRole = (s, role) => s.ents.filter(e => e.alive && e.role === role).length;
const players = spec => spec.entities.filter(e => e.role === "player");
const sprites = spec => spec.entities.reduce((n, e) => n + (e.role === "player" ? 1 : e.count), 0);

// --- specValidate: the crash-proof gate -------------------------------------
test("specValidate never throws on garbage, empty, or hostile input", () => {
  for (const raw of [null, undefined, "", "not json", "{ oops", 42, [], {}, { entities: "boom" },
    { entities: [{ role: "wizard", motion: "teleport", shape: "hydra", count: 9e9, speed: -50 }] },
    '{"title":"x","entities":[{"role":"player"}]}']) {
    const spec = specValidate(raw);
    assert.equal(players(spec).length, 1, "exactly one player");
    assert.ok(spec.entities.length >= 1 && spec.entities.length <= 8, "1..8 entity kinds");
    assert.ok(GOALS.includes(spec.goal.type), "coherent goal type");
    assert.ok(spec.collisions.some(c => (c.effect === "lose" || c.effect === "damage")), "has a lose condition");
    assert.ok(sprites(spec) <= 40, "sprite budget held");
    assert.ok(engine.init(spec), "the gated spec is playable");
  }
});

test("specValidate builds a playable default collect game from {}", () => {
  const spec = specValidate({});
  assert.equal(players(spec).length, 1);
  assert.ok(spec.entities.some(e => e.role === "pickup"), "default has pickups");
  assert.equal(spec.goal.type, "collectAll", "default objective is collect");
});

test("specValidate clamps counts and speeds, drops unknown enums to defaults", () => {
  const spec = specValidate({
    theme: "banana", title: "  Trim Me  ",
    entities: [{ role: "player", motion: "input4", shape: "ship", count: 999, speed: 99 },
               { role: "enemy", motion: "nope", shape: "ufo", count: 0, speed: -5 }]
  });
  assert.equal(spec.theme, "retro", "unknown theme -> default");
  assert.equal(spec.title, "Trim Me");
  const enemy = spec.entities.find(e => e.role === "enemy");
  assert.equal(enemy.motion, "static", "unknown motion -> static default");
  assert.equal(enemy.shape, "block", "unknown shape -> block default");
  assert.ok(enemy.count >= 1 && enemy.speed >= 0);
  assert.equal(players(spec)[0].count, 1, "player is singular");
});

test("specValidate keeps exactly one player, demoting extras", () => {
  const spec = specValidate({
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "player", motion: "inputLR", shape: "car", count: 1, speed: 5 },
      { role: "player", motion: "input4", shape: "runner", count: 1, speed: 5 }
    ]
  });
  assert.equal(players(spec).length, 1);
  assert.equal(spec.entities.filter(e => e.role === "enemy").length >= 1, true, "extra players become enemies / a threat exists");
});

test("specValidate caps entity kinds at 8 and total sprites at 40", () => {
  const many = Array.from({ length: 20 }, () => ({ role: "enemy", motion: "patrol", shape: "invader", count: 12, speed: 3 }));
  const spec = specValidate({ entities: many });
  assert.ok(spec.entities.length <= 8, "<=8 kinds");
  assert.ok(sprites(spec) <= 40, "<=40 sprites");
  assert.equal(players(spec).length, 1, "player injected even amid a crowd");
});

test("specValidate makes the goal coherent with the entities present", () => {
  // Ask for collectAll but provide no pickups -> falls back to a reachable goal.
  const noPickups = specValidate({ entities: [{ role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 }], goal: { type: "collectAll" } });
  assert.notEqual(noPickups.goal.type, "collectAll");
  // reachGoal is honored when a goal entity exists.
  const withGoal = specValidate({ entities: [{ role: "goal", motion: "static", shape: "flag", count: 1, speed: 0 }], goal: { type: "reachGoal" } });
  assert.equal(withGoal.goal.type, "reachGoal");
  assert.ok(withGoal.collisions.some(c => c.effect === "win"), "goal role gets a win collision");
});

// --- interpreter -----------------------------------------------------------
const collectSpec = {
  title: "Test Collect", theme: "neon",
  entities: [
    { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
    { role: "pickup", motion: "static", shape: "dot", count: 3, speed: 0 }
  ],
  collisions: [
    { between: ["player", "pickup"], effect: "collect" },
    { between: ["player", "enemy"], effect: "lose" }
  ],
  goal: { type: "collectAll", value: 0 }
};

test("player moves with input", () => {
  let s = engine.init(collectSpec);
  const p = s.ents.find(e => e.role === "player");
  const x0 = p.x, y0 = p.y;
  s = engine.step(s, { right: true }, 1);
  assert.ok(s.ents.find(e => e.role === "player").x > x0, "right increases x");
  s = engine.step(s, { up: true }, 1);
  assert.ok(s.ents.find(e => e.role === "player").y < y0, "up decreases y");
});

test("pickup collision collects and scores", () => {
  let s = engine.init(collectSpec);
  const p = s.ents.find(e => e.role === "player");
  const pk = s.ents.find(e => e.role === "pickup");
  p.x = pk.x; p.y = pk.y; // stand on it
  const before = countRole(s, "pickup");
  s = engine.step(s, {}, 1);
  assert.equal(s.score, 1, "collecting scores");
  assert.equal(countRole(s, "pickup"), before - 1, "the pickup is removed");
});

test("collectAll wins once every pickup is gone", () => {
  let s = engine.init(collectSpec);
  // Teleport the player onto each pickup in turn.
  for (let guard = 0; guard < 20 && !engine.status(s).won; guard++) {
    const pk = s.ents.find(e => e.role === "pickup");
    if (!pk) break;
    const p = s.ents.find(e => e.role === "player");
    p.x = pk.x; p.y = pk.y;
    s = engine.step(s, {}, 1);
  }
  assert.equal(engine.status(s).won, true, "clearing all pickups wins");
});

test("enemy collision loses the game (lose effect)", () => {
  const spec = {
    title: "Danger", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "enemy", motion: "static", shape: "invader", count: 1, speed: 0 }
    ],
    collisions: [{ between: ["player", "enemy"], effect: "lose" }],
    goal: { type: "survive", value: 600 }
  };
  let s = engine.init(spec);
  const p = s.ents.find(e => e.role === "player");
  const en = s.ents.find(e => e.role === "enemy");
  p.x = en.x; p.y = en.y;
  s = engine.step(s, {}, 1);
  assert.equal(engine.status(s).over, true);
  assert.equal(engine.status(s).won, false, "a lose is not a win");
});

test("damage drains lives before ending the game", () => {
  const spec = {
    title: "Chip", theme: "neon",
    entities: [
      { role: "player", motion: "static", shape: "ship", count: 1, speed: 1 },
      { role: "enemy", motion: "static", shape: "invader", count: 3, speed: 0 }
    ],
    collisions: [{ between: ["player", "enemy"], effect: "damage" }],
    goal: { type: "survive", value: 600 }
  };
  let s = engine.init(spec);
  const p = s.ents.find(e => e.role === "player");
  // Stack all enemies onto the player: three damage hits from lives 3 -> over.
  for (const en of s.ents.filter(e => e.role === "enemy")) { en.x = p.x; en.y = p.y; }
  s = engine.step(s, {}, 1);
  assert.equal(engine.status(s).over, true, "three damage hits end the run at 0 lives");
});

test("survive goal wins at the tick threshold", () => {
  const spec = {
    title: "Endure", theme: "mono",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "enemy", motion: "static", shape: "invader", count: 1, speed: 0 }
    ],
    collisions: [{ between: ["player", "enemy"], effect: "lose" }],
    goal: { type: "survive", value: 100 } // survive is clamped to a floor of 100 ticks
  };
  let s = engine.init(spec);
  assert.equal(s.cfg.goal.value, 100, "survive value clamps to its floor");
  s.ents.find(e => e.role === "enemy").x = -999; // keep it clear of the player
  for (let i = 0; i < 120 && !engine.status(s).won; i++) s = engine.step(s, {}, 1);
  assert.equal(engine.status(s).won, true);
});

test("interpreter is deterministic for identical configs and inputs", () => {
  const spec = specValidate({
    title: "Det Sandbox", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "enemy", motion: "spawner", shape: "spike", count: 1, speed: 4 },
      { role: "pickup", motion: "faller", shape: "dot", count: 4, speed: 3 }
    ],
    collisions: [
      { between: ["player", "enemy"], effect: "lose" },
      { between: ["player", "pickup"], effect: "collect" }
    ],
    goal: { type: "survive", value: 3000 }
  });
  const run = () => {
    let s = engine.init(spec);
    const seq = [{ left: true }, {}, { right: true }, { up: true }, {}, { down: true }];
    for (let i = 0; i < 120; i++) s = engine.step(s, seq[i % seq.length], 1);
    return s;
  };
  assert.deepEqual(run(), run());
});

test("init self-heals a bare { theme, title } config into a playable game", () => {
  const s = engine.init({ theme: "retro", title: "Bare" });
  assert.ok(s.ents.some(e => e.role === "player"), "a player is present");
  assert.ok(s.ents.length > 1, "a full game is materialised");
  assert.doesNotThrow(() => engine.step(s, { right: true }, 1));
});

test("step is bounded: sprite count never exceeds the cap under a busy spawner", () => {
  const spec = specValidate({
    title: "Swarm", theme: "neon",
    entities: [
      { role: "player", motion: "static", shape: "ship", count: 1, speed: 1 },
      { role: "enemy", motion: "spawner", shape: "spike", count: 1, speed: 8 }
    ],
    collisions: [{ between: ["player", "enemy"], effect: "damage" }],
    goal: { type: "survive", value: 3000 }
  });
  let s = engine.init(spec);
  for (let i = 0; i < 500 && !s.over; i++) s = engine.step(s, {}, 1);
  assert.ok(s.ents.length <= 40, `live sprites stay <=40 (got ${s.ents.length})`);
});

// --- new primitives: specValidate clamping ---------------------------------
test("specValidate clamps hp and drops unknown new enums to defaults", () => {
  const spec = specValidate({
    title: "Clamp", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "enemy", motion: "warp", shape: "invader", count: 1, speed: 3, hp: 999 }, // warp -> static
      { role: "enemy", motion: "orbit", shape: "spike", count: 1, speed: 3, hp: 0 }
    ]
  });
  assert.equal(spec.entities.find(e => e.motion === "static").hp, 20, "hp clamps to 20");
  assert.equal(spec.entities.find(e => e.motion === "orbit").hp, 1, "hp floors to 1");
});

test("specValidate keeps the new motions, effects, and projectile role", () => {
  const spec = specValidate({
    title: "New", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "enemy", motion: "shooter", shape: "invader", count: 1, speed: 4 },
      { role: "projectile", motion: "faller", shape: "dot", count: 1, speed: 5 }
    ],
    collisions: [
      { between: ["player", "projectile"], effect: "push" },
      { between: ["player", "enemy"], effect: "slow" }
    ]
  });
  assert.ok(spec.entities.some(e => e.motion === "shooter"), "shooter motion kept");
  assert.ok(spec.entities.some(e => e.role === "projectile"), "projectile role kept");
  assert.ok(spec.collisions.some(c => c.effect === "push"), "push effect kept");
});

test("a shooter always gets a projectile threat against the player", () => {
  const spec = specValidate({
    title: "Fire", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "enemy", motion: "shooter", shape: "invader", count: 2, speed: 4 }
    ]
  });
  assert.ok(
    spec.collisions.some(c => c.between.includes("projectile") && (c.effect === "lose" || c.effect === "damage")),
    "a projectile can hurt the player"
  );
});

test("new goals stay coherent with the entities present", () => {
  const noGoal = specValidate({ entities: [{ role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 }], goal: { type: "defend" } });
  assert.notEqual(noGoal.goal.type, "defend", "defend needs a goal entity");
  const escortOk = specValidate({
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "pickup", motion: "static", shape: "dot", count: 3, speed: 0 },
      { role: "goal", motion: "static", shape: "flag", count: 1, speed: 0 }
    ], goal: { type: "escort" }
  });
  assert.equal(escortOk.goal.type, "escort", "escort honored with pickup + goal");
  const escortBad = specValidate({
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "goal", motion: "static", shape: "flag", count: 1, speed: 0 }
    ], goal: { type: "escort" }
  });
  assert.notEqual(escortBad.goal.type, "escort", "escort needs pickups too");
  const comboBad = specValidate({ entities: [{ role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 }], goal: { type: "combo" } });
  assert.notEqual(comboBad.goal.type, "combo", "combo needs pickups");
});

test("heuristic default templates vary by seed but a bare {} stays a collect game", () => {
  assert.equal(specValidate({}).goal.type, "collectAll", "bare {} is the canonical collect default");
  const seen = new Set();
  for (const theme of ["neon", "retro", "mono", "horror", "cozy", "scifi", "eightbit", "candy", "nature", "pastel"]) {
    seen.add(specValidate({ theme }).goal.type);
  }
  assert.ok(seen.size >= 2, `seeded defaults produce varied objectives (got ${[...seen].join(",")})`);
  for (const theme of ["neon", "retro", "mono"]) assert.ok(engine.init(specValidate({ theme })), "seeded default is playable");
});

// --- new motions -----------------------------------------------------------
test("shooter emits projectiles aimed at the player, bounded by the cap", () => {
  const spec = specValidate({
    title: "Turret", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "enemy", motion: "shooter", shape: "invader", count: 2, speed: 8 }
    ],
    collisions: [{ between: ["player", "projectile"], effect: "lose" }],
    goal: { type: "survive", value: 3000 }
  });
  let s = engine.init(spec);
  let sawProjectile = false;
  for (let i = 0; i < 200 && !s.over; i++) {
    s = engine.step(s, { left: i % 2 === 0, right: i % 2 === 1 }, 1);
    if (s.ents.some(e => e.role === "projectile")) sawProjectile = true;
    assert.ok(s.ents.length <= 40, "projectiles stay within the sprite cap");
  }
  assert.ok(sawProjectile, "a shooter fired at least one projectile");
});

test("orbit circles a fixed point and stays on-screen", () => {
  const spec = specValidate({
    title: "Ring", theme: "neon",
    entities: [
      { role: "player", motion: "static", shape: "ship", count: 1, speed: 1 },
      { role: "enemy", motion: "orbit", shape: "spike", count: 2, speed: 5 }
    ],
    collisions: [{ between: ["player", "enemy"], effect: "damage" }],
    goal: { type: "survive", value: 3000 }
  });
  let s = engine.init(spec);
  s.ents.find(e => e.role === "player").x = -999; // keep clear of the orbiters
  const positions = new Set();
  for (let i = 0; i < 60; i++) {
    s = engine.step(s, {}, 1);
    for (const en of s.ents.filter(e => e.role === "enemy")) {
      positions.add(`${Math.round(en.x)},${Math.round(en.y)}`);
      assert.ok(en.x >= 0 && en.x <= 400 && en.y >= 0 && en.y <= 600, "orbiter stays on-screen");
    }
  }
  assert.ok(positions.size > 5, "orbiter sweeps through many positions");
});

test("wander walks deterministically and stays on-screen", () => {
  const mk = () => {
    const spec = specValidate({
      title: "Roam", theme: "mono",
      entities: [
        { role: "player", motion: "static", shape: "ship", count: 1, speed: 1 },
        { role: "enemy", motion: "wander", shape: "invader", count: 3, speed: 4 }
      ],
      collisions: [{ between: ["player", "enemy"], effect: "damage" }],
      goal: { type: "survive", value: 3000 }
    });
    let s = engine.init(spec);
    for (let i = 0; i < 80; i++) s = engine.step(s, {}, 1);
    return s;
  };
  const a = mk(), b = mk();
  assert.deepEqual(a.ents, b.ents, "wander is deterministic");
  for (const e of a.ents) assert.ok(e.x >= -1 && e.x <= 401 && e.y >= -1 && e.y <= 601, "wanderers stay on-screen");
});

test("homing drifts toward the player", () => {
  const spec = specValidate({
    title: "Seek", theme: "neon",
    entities: [
      { role: "player", motion: "static", shape: "ship", count: 1, speed: 1 },
      { role: "enemy", motion: "homing", shape: "invader", count: 1, speed: 6 }
    ],
    collisions: [{ between: ["player", "enemy"], effect: "damage" }],
    goal: { type: "survive", value: 3000 }
  });
  let s = engine.init(spec);
  const p = s.ents.find(e => e.role === "player"); p.x = 200; p.y = 500;
  const en = s.ents.find(e => e.role === "enemy"); en.x = 200; en.y = 100;
  const d0 = Math.hypot(en.x - p.x, en.y - p.y);
  for (let i = 0; i < 20 && !s.over; i++) s = engine.step(s, {}, 1);
  const en2 = s.ents.find(e => e.role === "enemy");
  const d1 = en2 ? Math.hypot(en2.x - p.x, en2.y - p.y) : 0; // gone = it reached the player
  assert.ok(d1 < d0, "homing enemy closes on the player");
});

// --- new effects -----------------------------------------------------------
test("push knocks the player back without ending the game", () => {
  const spec = specValidate({
    title: "Bump", theme: "neon",
    entities: [
      { role: "player", motion: "static", shape: "ship", count: 1, speed: 1 },
      { role: "obstacle", motion: "static", shape: "block", count: 1, speed: 0 }
    ],
    collisions: [{ between: ["player", "obstacle"], effect: "push" }, { between: ["player", "enemy"], effect: "lose" }],
    goal: { type: "survive", value: 3000 }
  });
  let s = engine.init(spec);
  const p = s.ents.find(e => e.role === "player");
  const o = s.ents.find(e => e.role === "obstacle"); o.x = p.x + 2; o.y = p.y;
  const x0 = p.x;
  s = engine.step(s, {}, 1);
  assert.equal(engine.status(s).over, false, "push does not end the game");
  assert.ok(s.ents.find(e => e.role === "player").x < x0, "player is pushed away from the obstacle");
});

test("teleport relocates the player", () => {
  const spec = specValidate({
    title: "Warp", theme: "neon",
    entities: [
      { role: "player", motion: "static", shape: "ship", count: 1, speed: 1 },
      { role: "obstacle", motion: "static", shape: "block", count: 1, speed: 0 }
    ],
    collisions: [{ between: ["player", "obstacle"], effect: "teleport" }, { between: ["player", "enemy"], effect: "lose" }],
    goal: { type: "survive", value: 3000 }
  });
  let s = engine.init(spec);
  const p = s.ents.find(e => e.role === "player");
  const o = s.ents.find(e => e.role === "obstacle"); o.x = p.x; o.y = p.y;
  const x0 = p.x, y0 = p.y;
  s = engine.step(s, {}, 1);
  const p2 = s.ents.find(e => e.role === "player");
  assert.ok(p2.x !== x0 || p2.y !== y0, "player is teleported to a new spot");
  assert.equal(engine.status(s).over, false, "teleport does not end the game");
});

test("shield absorbs a lethal hit and destroys the threat", () => {
  const spec = specValidate({
    title: "Aegis", theme: "neon",
    entities: [
      { role: "player", motion: "static", shape: "ship", count: 1, speed: 1 },
      { role: "pickup", motion: "static", shape: "circle", count: 1, speed: 0 },
      { role: "enemy", motion: "static", shape: "invader", count: 1, speed: 0 }
    ],
    collisions: [{ between: ["player", "pickup"], effect: "shield" }, { between: ["player", "enemy"], effect: "lose" }],
    goal: { type: "survive", value: 3000 }
  });
  let s = engine.init(spec);
  const p = s.ents.find(e => e.role === "player");
  const pk = s.ents.find(e => e.role === "pickup"); pk.x = p.x; pk.y = p.y;
  s.ents.find(e => e.role === "enemy").x = -999; // keep the enemy clear for now
  s = engine.step(s, {}, 1);
  assert.ok(s.shieldUntil > s.ticks, "shield is active after the pickup");
  const p2 = s.ents.find(e => e.role === "player");
  const en = s.ents.find(e => e.role === "enemy"); en.x = p2.x; en.y = p2.y;
  s = engine.step(s, {}, 1);
  assert.equal(engine.status(s).over, false, "shielded player survives the lethal hit");
  assert.equal(s.ents.some(e => e.role === "enemy"), false, "the shield destroys the threat");
});

test("slow reduces the player's movement for a window", () => {
  const spec = specValidate({
    title: "Mud", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 6 },
      { role: "obstacle", motion: "static", shape: "block", count: 1, speed: 0 }
    ],
    collisions: [{ between: ["player", "obstacle"], effect: "slow" }, { between: ["player", "enemy"], effect: "lose" }],
    goal: { type: "survive", value: 3000 }
  });
  let s = engine.init(spec);
  const p = s.ents.find(e => e.role === "player");
  const o = s.ents.find(e => e.role === "obstacle"); o.x = p.x; o.y = p.y;
  s = engine.step(s, {}, 1); // triggers slow
  assert.ok(s.slowUntil > s.ticks, "player is slowed");
  const before = s.ents.find(e => e.role === "player").x;
  s = engine.step(s, { right: true }, 1);
  const moved = s.ents.find(e => e.role === "player").x - before;
  assert.ok(moved > 0 && moved < 6, `slowed movement is below full speed 6 (got ${moved})`);
});

test("spawnOnDeath splits the target and stays bounded", () => {
  const spec = specValidate({
    title: "Split", theme: "neon",
    entities: [
      { role: "player", motion: "static", shape: "ship", count: 1, speed: 1 },
      { role: "enemy", motion: "wander", shape: "diamond", count: 1, speed: 2 }
    ],
    collisions: [{ between: ["player", "enemy"], effect: "spawnOnDeath" }],
    goal: { type: "score", value: 99 }
  });
  let s = engine.init(spec);
  const p = s.ents.find(e => e.role === "player");
  const en = s.ents.find(e => e.role === "enemy"); en.x = p.x; en.y = p.y;
  s = engine.step(s, {}, 1);
  assert.equal(s.score, 1, "smashing the target scores");
  assert.ok(countRole(s, "enemy") >= 2, "the enemy split into smaller copies");
  for (let i = 0; i < 400 && !s.over; i++) s = engine.step(s, {}, 1);
  assert.ok(s.ents.length <= 40, `splits stay within the sprite cap (got ${s.ents.length})`);
});

// --- new goals -------------------------------------------------------------
test("defend is lost if the guarded entity falls", () => {
  const spec = specValidate({
    title: "Hold", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "paddle", count: 1, speed: 5 },
      { role: "goal", motion: "static", shape: "wall", count: 1, speed: 0, hp: 2 },
      { role: "enemy", motion: "static", shape: "invader", count: 3, speed: 0 }
    ],
    goal: { type: "defend", value: 300 }
  });
  let s = engine.init(spec);
  assert.equal(s.cfg.goal.type, "defend");
  const g = s.ents.find(e => e.role === "goal");
  for (const en of s.ents.filter(e => e.role === "enemy")) { en.x = g.x; en.y = g.y; } // storm the base
  s = engine.step(s, {}, 1);
  assert.equal(engine.status(s).over, true, "the base fell");
  assert.equal(engine.status(s).won, false, "losing the base is a loss");
});

test("defend is won by keeping the guarded entity alive to the deadline", () => {
  const spec = specValidate({
    title: "Endure Base", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "paddle", count: 1, speed: 5 },
      { role: "goal", motion: "static", shape: "wall", count: 1, speed: 0, hp: 5 },
      { role: "enemy", motion: "static", shape: "invader", count: 1, speed: 0 }
    ],
    goal: { type: "defend", value: 100 }
  });
  let s = engine.init(spec);
  assert.equal(s.cfg.goal.value, 100, "defend value clamps to its floor");
  s.ents.filter(e => e.role === "enemy").forEach(en => { en.x = -999; en.y = -999; });
  for (let i = 0; i < 120 && !s.over; i++) s = engine.step(s, {}, 1);
  assert.equal(engine.status(s).won, true, "the base held; defend won");
});

test("escort wins only after collecting all cargo then reaching the goal", () => {
  const spec = specValidate({
    title: "Deliver", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "pickup", motion: "static", shape: "dot", count: 2, speed: 0 },
      { role: "goal", motion: "static", shape: "flag", count: 1, speed: 0 }
    ],
    goal: { type: "escort", value: 0 }
  });
  let s = engine.init(spec);
  assert.equal(s.cfg.goal.type, "escort");
  s.ents.filter(e => e.role === "enemy").forEach(en => { en.alive = false; }); // injected threat, keep it out of the way
  const gl = s.ents.find(e => e.role === "goal"); gl.x = 200; gl.y = 60;
  // Park the cargo well away from the drop-off so collecting it can't also reach the goal.
  s.ents.filter(e => e.role === "pickup").forEach((pk, i) => { pk.x = 80 + i * 40; pk.y = 480; });
  for (let g = 0; g < 10; g++) {
    const pk = s.ents.find(e => e.role === "pickup"); if (!pk) break;
    const p = s.ents.find(e => e.role === "player"); p.x = pk.x; p.y = pk.y;
    s = engine.step(s, {}, 1);
  }
  assert.equal(s.ents.some(e => e.role === "pickup"), false, "all cargo collected");
  assert.equal(engine.status(s).over, false, "collecting cargo alone does not win escort");
  const p = s.ents.find(e => e.role === "player"); p.x = gl.x; p.y = gl.y;
  s = engine.step(s, {}, 1);
  assert.equal(engine.status(s).won, true, "reaching the drop-off after cargo wins");
});

test("combo raises on a chain and resets on a hit, winning at the target length", () => {
  const spec = specValidate({
    title: "Chain", theme: "neon",
    entities: [
      { role: "player", motion: "static", shape: "ship", count: 1, speed: 1 },
      { role: "pickup", motion: "static", shape: "dot", count: 5, speed: 0 },
      { role: "enemy", motion: "static", shape: "invader", count: 1, speed: 0 }
    ],
    collisions: [{ between: ["player", "pickup"], effect: "collect" }, { between: ["player", "enemy"], effect: "damage" }],
    goal: { type: "combo", value: 3 }
  });
  let s = engine.init(spec);
  assert.equal(s.cfg.goal.type, "combo");
  assert.equal(s.cfg.goal.value, 3);
  const p = s.ents.find(e => e.role === "player");
  const pk = s.ents.find(e => e.role === "pickup"); p.x = pk.x; p.y = pk.y;
  s = engine.step(s, {}, 1);
  assert.equal(s.combo, 1, "a collect raises the combo");
  const p2 = s.ents.find(e => e.role === "player");
  const en = s.ents.find(e => e.role === "enemy"); en.x = p2.x; en.y = p2.y;
  s = engine.step(s, {}, 1);
  assert.equal(s.combo, 0, "a hit resets the combo");

  let s2 = engine.init(spec);
  s2.ents.filter(e => e.role === "enemy").forEach(e => { e.alive = false; }); // no hits, clean chain
  for (let i = 0; i < 5 && !engine.status(s2).won; i++) {
    const q = s2.ents.find(e => e.role === "player");
    const nx = s2.ents.find(e => e.role === "pickup"); if (!nx) break;
    q.x = nx.x; q.y = nx.y;
    s2 = engine.step(s2, {}, 1);
  }
  assert.equal(engine.status(s2).won, true, "a 3-collect chain wins combo");
});

// --- ACHIEVABILITY: every gated spec must be winnable AND losable --------------
const otherOf = c => (c.between[0] === "player" ? c.between[1] : c.between[0]);
// A lose that can actually fire = a lose/damage vs the player against a threat the
// player does NOT auto-destroy first (spawnOnDeath/collect on the same pair).
function hasRealLose(spec) {
  const smashed = new Set();
  for (const c of spec.collisions)
    if (c.between.includes("player") && (c.effect === "spawnOnDeath" || c.effect === "collect")) smashed.add(otherOf(c));
  return spec.collisions.some(c =>
    (c.effect === "lose" || c.effect === "damage") && c.between.includes("player") && !smashed.has(otherOf(c)));
}

test("(a) reach-type goal forces an input4 player so the goal is reachable in y", () => {
  // An inputLR player is frozen in y; a reachGoal placed at the top would be
  // unreachable. specValidate must promote the player to input4.
  for (const type of ["reachGoal", "escort"]) {
    const spec = specValidate({
      title: "Reach", theme: "neon",
      entities: [
        { role: "player", motion: "inputLR", shape: "ship", count: 1, speed: 5 },
        { role: "pickup", motion: "static", shape: "dot", count: 2, speed: 0 },
        { role: "goal", motion: "static", shape: "flag", count: 1, speed: 0 }
      ],
      goal: { type }
    });
    assert.equal(spec.entities.find(e => e.role === "player").motion, "input4", `${type} player can move in y`);
  }
  // A non-reach goal leaves an explicit inputLR player alone.
  const lr = specValidate({
    title: "Weave", theme: "neon",
    entities: [
      { role: "player", motion: "inputLR", shape: "ship", count: 1, speed: 6 },
      { role: "enemy", motion: "shooter", shape: "invader", count: 1, speed: 4 }
    ],
    goal: { type: "survive", value: 600 }
  });
  assert.equal(lr.entities.find(e => e.role === "player").motion, "inputLR", "survive keeps inputLR");
});

test("(b) score target is clamped to the achievable total", () => {
  // Only 3 collectable pickups + no other scoring source → a score:99 is impossible.
  const spec = specValidate({
    title: "Greedy", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "pickup", motion: "static", shape: "dot", count: 3, speed: 0 },
      { role: "enemy", motion: "chase", shape: "invader", count: 1, speed: 3 }
    ],
    collisions: [{ between: ["player", "pickup"], effect: "collect" }, { between: ["player", "enemy"], effect: "lose" }],
    goal: { type: "score", value: 99 }
  });
  assert.equal(spec.goal.type, "score");
  assert.ok(spec.goal.value <= 3, `score clamped to <=3 achievable (got ${spec.goal.value})`);
  assert.ok(spec.goal.value >= 1, "still a positive, winnable target");
});

test("(b) a score goal with NO scoring source falls back to a survivable objective", () => {
  const spec = specValidate({
    title: "Nowin", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "enemy", motion: "static", shape: "invader", count: 1, speed: 0 }
    ],
    collisions: [{ between: ["player", "enemy"], effect: "lose" }],
    goal: { type: "score", value: 10 }
  });
  assert.notEqual(spec.goal.type, "score", "an unscorable score goal is replaced");
  assert.equal(spec.goal.type, "survive", "→ survive, which is winnable by outlasting the timer");
  assert.ok(hasRealLose(spec), "still losable");
});

test("(b) combo target is clamped, and an unchainable combo folds to collectAll", () => {
  const clamped = specValidate({
    title: "Chain5", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "pickup", motion: "static", shape: "dot", count: 4, speed: 0 },
      { role: "enemy", motion: "chase", shape: "invader", count: 1, speed: 3 }
    ],
    collisions: [{ between: ["player", "pickup"], effect: "collect" }, { between: ["player", "enemy"], effect: "damage" }],
    goal: { type: "combo", value: 20 }
  });
  assert.equal(clamped.goal.type, "combo");
  assert.ok(clamped.goal.value <= 4, `combo clamped to collectable count (got ${clamped.goal.value})`);
  // Only ONE collectable pickup → a chain of >=2 is impossible → collectAll.
  const folded = specValidate({
    title: "Lonely", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "pickup", motion: "static", shape: "dot", count: 1, speed: 0 }
    ],
    goal: { type: "combo", value: 5 }
  });
  assert.equal(folded.goal.type, "collectAll", "a single pickup cannot chain → clear it instead");
  assert.ok(folded.collisions.some(c => c.between.includes("pickup") && c.effect === "collect"), "pickup is collectable");
});

test("(c) a slow-only pickup gets a collect path so collectAll is winnable", () => {
  const spec = specValidate({
    title: "Sticky", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "pickup", motion: "static", shape: "dot", count: 3, speed: 0 },
      { role: "enemy", motion: "chase", shape: "invader", count: 1, speed: 3 }
    ],
    // Pickup wired ONLY to a non-removing effect — never cleared without a fix.
    collisions: [{ between: ["player", "pickup"], effect: "slow" }, { between: ["player", "enemy"], effect: "lose" }],
    goal: { type: "collectAll", value: 0 }
  });
  assert.equal(spec.goal.type, "collectAll");
  assert.ok(
    spec.collisions.some(c => c.between.includes("pickup") &&
      ["collect", "shield", "spawnOnDeath", "damage"].includes(c.effect)),
    "a removing pickup path now exists"
  );
  // Prove it: clearing every pickup actually wins.
  let s = engine.init(spec);
  for (let guard = 0; guard < 30 && !engine.status(s).won; guard++) {
    const pk = s.ents.find(e => e.role === "pickup"); if (!pk) break;
    const p = s.ents.find(e => e.role === "player"); p.x = pk.x; p.y = pk.y;
    s = engine.step(s, {}, 1);
  }
  assert.equal(engine.status(s).won, true, "collectAll is now reachable");
});

test("(d) a spawnOnDeath-only game gains a real (non-shadowed) lose path", () => {
  // spawnOnDeath destroys the enemy on contact, so a same-pair lose is shadowed →
  // the player would be invincible. specValidate must add a lose that can fire.
  const spec = specValidate({
    title: "Smash", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "enemy", motion: "wander", shape: "diamond", count: 2, speed: 2 }
    ],
    collisions: [{ between: ["player", "enemy"], effect: "spawnOnDeath" }],
    goal: { type: "score", value: 5 }
  });
  assert.ok(hasRealLose(spec), "an unshadowed lose exists (player can die)");
  assert.ok(engine.init(spec), "still playable");
  // Drive the losing threat onto the player and confirm the run can end in a loss.
  // Pick the REAL (non-shadowed) lose — not a spawnOnDeath'd pair.
  let s = engine.init(spec);
  const smashed = new Set();
  for (const c of spec.collisions)
    if (c.between.includes("player") && (c.effect === "spawnOnDeath" || c.effect === "collect")) smashed.add(otherOf(c));
  const loseRule = spec.collisions.find(c =>
    (c.effect === "lose" || c.effect === "damage") && c.between.includes("player") && !smashed.has(otherOf(c)));
  const threatRole = otherOf(loseRule);
  const p = s.ents.find(e => e.role === "player");
  for (const t of s.ents.filter(e => e.role === threatRole)) { t.x = p.x; t.y = p.y; }
  s = engine.step(s, {}, 1);
  assert.equal(engine.status(s).over, true, "the threat can actually kill the player");
  assert.equal(engine.status(s).won, false, "and it is a loss, not a win");
});

test("(e) static-threat + score idle game becomes winnable + losable", () => {
  // A lone static enemy with a score goal has no scoring source → idle soft-lock.
  const spec = specValidate({
    title: "Idle", theme: "neon",
    entities: [
      { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
      { role: "enemy", motion: "static", shape: "invader", count: 2, speed: 0 }
    ],
    goal: { type: "score", value: 8 }
  });
  assert.equal(spec.goal.type, "survive", "no scoring source → survive (winnable by outlasting)");
  assert.ok(hasRealLose(spec), "and losable by touching a threat");
});

test("EVERY gated goal type yields a spec that is both winnable and losable", () => {
  // Broad guard: for each goal type the interpreter must expose a way to win and a
  // way to lose after specValidate. Winnability is asserted structurally per type;
  // losability is the shared hasRealLose invariant.
  const base = {
    player: { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
    pickup: { role: "pickup", motion: "static", shape: "dot", count: 3, speed: 0 },
    enemy: { role: "enemy", motion: "chase", shape: "invader", count: 2, speed: 3 },
    goal: { role: "goal", motion: "static", shape: "flag", count: 1, speed: 0 }
  };
  const cases = {
    collectAll: [base.player, base.pickup, base.enemy],
    survive: [base.player, base.enemy],
    score: [base.player, base.pickup, base.enemy],
    reachGoal: [base.player, base.goal, base.enemy],
    defend: [base.player, base.goal, base.enemy],
    escort: [base.player, base.pickup, base.goal, base.enemy],
    combo: [base.player, base.pickup, base.enemy]
  };
  for (const [type, entities] of Object.entries(cases)) {
    const spec = specValidate({ title: type, theme: "neon", entities, goal: { type, value: 6 } });
    assert.ok(hasRealLose(spec), `${spec.goal.type} spec is losable`);
    // Winnability: a numeric objective must have a positive, achievable target; a
    // structural objective must have the collision/entity that ends it.
    if (spec.goal.type === "score" || spec.goal.type === "combo" || spec.goal.type === "survive" || spec.goal.type === "defend") {
      assert.ok(spec.goal.value > 0, `${spec.goal.type} has a positive target`);
    }
    if (spec.goal.type === "reachGoal") assert.ok(spec.collisions.some(c => c.effect === "win"), "reachGoal has a win");
    if (spec.goal.type === "collectAll" || spec.goal.type === "escort") {
      assert.ok(spec.collisions.some(c => c.between.includes("pickup") &&
        ["collect", "shield", "spawnOnDeath", "damage"].includes(c.effect)), `${spec.goal.type} can clear pickups`);
    }
    assert.ok(engine.init(spec), `${spec.goal.type} is playable`);
  }
});
