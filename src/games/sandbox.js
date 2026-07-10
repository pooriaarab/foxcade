import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

// COMPOSABLE GAME KIT — a generic interpreter that plays a game ASSEMBLED by the
// model from safe primitives (a "game-spec"). The spec is PURE DATA behind
// specValidate; the ONLY code that ever runs is this fixed interpreter, so no
// model-written logic is executed and nothing can crash or hang.
//
// Spec (all fields bounded — this IS the sandbox game's config):
//   { title, theme,
//     entities:   [ { role, motion, shape, count, speed, hp } ]   // 1..8 kinds
//     collisions: [ { between:[roleA,roleB], effect } ]
//     goal:       { type, value } }
//
// Every enum below is closed, so the interpreter has a fixed case for each value
// and NOTHING in a spec can express infinite or unsafe behavior.

const W = 400, H = 600;
const ROLES   = ["player", "enemy", "pickup", "obstacle", "goal", "projectile"];
const MOTIONS = ["input4", "inputLR", "faller", "patrol", "chase", "static", "spawner", "shooter", "orbit", "wander", "homing"];
const EFFECTS = ["lose", "damage", "bounce", "collect", "win", "push", "teleport", "spawnOnDeath", "shield", "slow"];
const GOALS   = ["collectAll", "survive", "score", "reachGoal", "defend", "escort", "combo"];
// The subset of drawShape kinds the DSL exposes (all are pure vector art).
const SHAPES  = ["ship", "invader", "dot", "circle", "block", "diamond", "spike", "target", "flag", "runner", "car", "wall", "brick", "paddle"];

const MAX_ENTITIES = 8;   // distinct entity kinds
const MAX_SPRITES  = 40;  // total live instances at rest (caps work per frame)
const START_LIVES  = 3;

// Timed power-up windows (ticks) and tuning knobs for the new effects/motions.
const SHIELD_TICKS = 300; // invulnerability granted by a shield pickup
const SLOW_TICKS   = 180; // how long a slow trap hampers the player
const SLOW_FACTOR  = 0.4; // player speed multiplier while slowed
const PUSH_DIST    = 26;  // knockback distance for a push hit
const SPLIT_MIN    = 18;  // spawnOnDeath only splits sprites larger than this (bounds recursion)

const THEME_CHOICES = THEME_IDS.join("|");

const SIZE = { player: 28, enemy: 24, obstacle: 30, pickup: 16, goal: 30, projectile: 10 };
const sizeFor = role => SIZE[role] ?? 24;

// Effects that remove the pickup they hit (so a collectAll/escort goal can clear
// it). A pickup wired ONLY to a non-removing effect (slow/push/teleport/bounce)
// is never cleared → unwinnable.
const PICKUP_REMOVERS = new Set(["collect", "shield", "spawnOnDeath", "damage"]);

// Points a single body yields when destroyed, including spawnOnDeath splits
// (mirrors the engine: a body larger than SPLIT_MIN splits into two on death,
// and each child can be destroyed for a point too).
function killPoints(size) {
  return size > SPLIT_MIN ? 1 + 2 * killPoints(size * 0.6) : 1;
}
// Upper bound on the score/combo a spec can actually produce: collectable pickups
// (+1 each) plus smashable bodies (spawnOnDeath, incl. their splits). Both collect
// and spawnOnDeath bump score AND combo. 0 → no scoring source exists at all, so a
// score/combo goal can never be met.
function achievableScore(entities, collisions) {
  const collectRoles = new Set(), smashRoles = new Set();
  for (const c of collisions) {
    if (c.effect === "collect") { collectRoles.add(c.between[0]); collectRoles.add(c.between[1]); }
    if (c.effect === "spawnOnDeath") { smashRoles.add(c.between[0]); smashRoles.add(c.between[1]); }
  }
  let total = 0;
  for (const e of entities) {
    if (e.role === "player") continue;
    if (collectRoles.has(e.role)) total += e.count;
    if (smashRoles.has(e.role)) total += e.count * killPoints(sizeFor(e.role));
  }
  return total;
}

// --- coercion helpers (pure, no throw) ----------------------------------
function coerceObject(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  const m = raw.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : raw); } catch { return {}; }
}
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
function clampNum(v, min, max, dflt) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function coerceEntity(e) {
  const o = e && typeof e === "object" ? e : {};
  return {
    role:   oneOf(o.role, ROLES, "obstacle"),
    motion: oneOf(o.motion, MOTIONS, "static"),
    shape:  oneOf(o.shape, SHAPES, "block"),
    count:  Math.round(clampNum(o.count, 1, 12, 1)),
    speed:  clampNum(o.speed, 0, 8, 3),
    hp:     Math.round(clampNum(o.hp, 1, 20, 1))
  };
}
function coerceCollision(c) {
  if (!c || typeof c !== "object") return null;
  const b = Array.isArray(c.between) ? c.between : [];
  const a0 = oneOf(b[0], ROLES, null), a1 = oneOf(b[1], ROLES, null);
  const effect = oneOf(c.effect, EFFECTS, null);
  return a0 && a1 && effect ? { between: [a0, a1], effect } : null;
}
function coerceGoal(g, roles) {
  const o = g && typeof g === "object" ? g : {};
  const hasPickups = roles.has("pickup"), hasGoal = roles.has("goal");
  let type = oneOf(o.type, GOALS, null);
  // Coherence: a goal that references entities the spec lacks can never be met.
  if (type === "collectAll" && !hasPickups) type = null;
  if (type === "combo" && !hasPickups) type = null;
  if (type === "reachGoal" && !hasGoal) type = null;
  if (type === "defend" && !hasGoal) type = null;
  if (type === "escort" && !(hasPickups && hasGoal)) type = null;
  if (!type) type = hasPickups && hasGoal ? "escort" : hasPickups ? "collectAll" : hasGoal ? "reachGoal" : "survive";
  let value = 0;
  if (type === "survive" || type === "defend") value = Math.round(clampNum(o.value, 100, 3000, 600)); // ticks
  else if (type === "score") value = Math.round(clampNum(o.value, 1, 99, 10));
  else if (type === "combo") value = Math.round(clampNum(o.value, 2, 20, 5));
  return { type, value };
}

// Reduce the largest non-player counts until the live-instance budget holds.
function capSprites(entities) {
  const total = () => entities.reduce((s, e) => s + (e.role === "player" ? 1 : e.count), 0);
  for (let guard = 0; total() > MAX_SPRITES && guard < 400; guard++) {
    let idx = -1, max = 1;
    entities.forEach((e, i) => { if (e.role !== "player" && e.count > max) { max = e.count; idx = i; } });
    if (idx < 0) break;
    entities[idx] = { ...entities[idx], count: entities[idx].count - 1 };
  }
  return entities;
}

// --- default templates (heuristic variety) ------------------------------
// When a spec names no entities, one of these playable templates is chosen by a
// seed derived from title|theme, so even the model-less path yields varied
// games that exercise the richer primitives. A bare {} always gets template 0
// (the canonical collect game) so callers keep a stable default.
const TEMPLATES = [
  { // 0 — classic collect-and-dodge
    entities: [
      { role: "player", motion: "input4", shape: "ship",    count: 1, speed: 5 },
      { role: "pickup", motion: "static", shape: "dot",     count: 6, speed: 0 },
      { role: "enemy",  motion: "patrol", shape: "invader", count: 2, speed: 3 }
    ]
  },
  { // 1 — dodge a turret's fire
    entities: [
      { role: "player", motion: "inputLR", shape: "ship",    count: 1, speed: 6 },
      { role: "enemy",  motion: "shooter", shape: "invader", count: 2, speed: 4 },
      { role: "enemy",  motion: "patrol",  shape: "spike",   count: 2, speed: 3 }
    ],
    goal: { type: "survive", value: 600 }
  },
  { // 2 — thread the orbiting hazards to grab the loot
    entities: [
      { role: "player", motion: "input4", shape: "runner", count: 1, speed: 5 },
      { role: "enemy",  motion: "orbit",  shape: "spike",  count: 4, speed: 4 },
      { role: "pickup", motion: "static", shape: "target", count: 5, speed: 0 }
    ]
  },
  { // 3 — smash drifting rocks; they split apart
    entities: [
      { role: "player", motion: "input4",  shape: "ship",    count: 1, speed: 5 },
      { role: "enemy",  motion: "wander",  shape: "diamond", count: 3, speed: 2, hp: 1 },
      { role: "enemy",  motion: "shooter", shape: "invader", count: 1, speed: 4 }
    ],
    collisions: [{ between: ["player", "enemy"], effect: "spawnOnDeath" }],
    goal: { type: "score", value: 8 }
  },
  { // 4 — hold the line: defend the base
    entities: [
      { role: "player", motion: "input4", shape: "paddle",  count: 1, speed: 6 },
      { role: "goal",   motion: "static", shape: "wall",    count: 1, speed: 0, hp: 6 },
      { role: "enemy",  motion: "faller", shape: "spike",   count: 4, speed: 3 },
      { role: "enemy",  motion: "homing", shape: "invader", count: 2, speed: 3 }
    ],
    goal: { type: "defend", value: 700 }
  }
];
function pickTemplate(src) {
  const hasHint = (typeof src.title === "string" && src.title.trim()) || THEME_IDS.includes(src.theme);
  if (!hasHint) return TEMPLATES[0]; // stable canonical default for a bare {}
  const text = `${src.title || ""}|${src.theme || ""}`;
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h + text.charCodeAt(i) * (i + 1)) % 9973;
  return TEMPLATES[h % TEMPLATES.length];
}

// THE CRASH-PROOF GATE. Parse anything (string/obj/garbage), coerce to a
// well-formed, playable spec, and NEVER throw. Guarantees: exactly one player,
// at least one threat + one lose condition, a coherent goal, <=8 kinds and
// <=~40 sprites. From {} it yields a simple default collect game.
export function specValidate(raw) {
  const src = coerceObject(raw);
  const theme = THEME_IDS.includes(src.theme) ? src.theme : THEME_FIELD.default;
  const title = typeof src.title === "string" && src.title.trim()
    ? src.title.trim().slice(0, 40)
    : "Sandbox Game";

  let template = null;
  // Coerce the SLICED input, not the whole array — a hostile spec can name a huge
  // entities list and we only ever keep MAX_ENTITIES kinds.
  let entities = Array.isArray(src.entities) ? src.entities.slice(0, MAX_ENTITIES).map(coerceEntity) : [];
  if (entities.length === 0) {
    template = pickTemplate(src);
    entities = template.entities.map(coerceEntity);
  }

  // Exactly one player: keep the first, demote any extras to enemies, and force
  // a controllable motion so "the player" is always the one you drive.
  let seenPlayer = false;
  entities = entities.map(e => {
    if (e.role !== "player") return e;
    if (seenPlayer) return { ...e, role: "enemy" };
    seenPlayer = true;
    const motion = e.motion === "inputLR" ? "inputLR" : "input4";
    return { ...e, motion, count: 1, speed: Math.max(1, e.speed) }; // a player is singular and must move
  });
  if (!seenPlayer) entities.unshift({ role: "player", motion: "input4", shape: "ship", count: 1, speed: 5, hp: 1 });

  entities = entities.slice(0, MAX_ENTITIES);

  // Guarantee a threat so a lose condition can actually fire.
  if (!entities.some(e => e.role === "enemy" || e.role === "obstacle")) {
    const threat = { role: "enemy", motion: "patrol", shape: "invader", count: 3, speed: 3, hp: 1 };
    if (entities.length < MAX_ENTITIES) entities.push(threat);
    else entities[entities.length - 1] = threat;
  }
  entities = capSprites(entities);

  const roles = new Set(entities.map(e => e.role));
  let goal = coerceGoal(src.goal ?? template?.goal, roles);

  // ACHIEVABILITY (a): a reach-type goal is met by TOUCHING the goal entity, which
  // is placed off the player's row (y=60 vs y=H-60). An inputLR player is frozen
  // in y and could never reach it → force input4 so the goal stays reachable.
  if (goal.type === "reachGoal" || goal.type === "escort") {
    entities = entities.map(e => (e.role === "player" ? { ...e, motion: "input4" } : e));
  }

  // Coerce the SLICED input collisions, not the whole array (hostile specs can be
  // arbitrarily long); the final cap is applied again after the auto-added rules.
  const rawCollisions = Array.isArray(src.collisions ?? template?.collisions) ? (src.collisions ?? template.collisions) : [];
  let collisions = rawCollisions.slice(0, 10).map(coerceCollision).filter(Boolean);

  // At least one lose condition against the player.
  if (!collisions.some(c => (c.effect === "lose" || c.effect === "damage") && c.between.includes("player"))) {
    collisions.push({ between: ["player", roles.has("enemy") ? "enemy" : "obstacle"], effect: "lose" });
  }
  // ACHIEVABILITY (c): a pickup a goal must CLEAR (collectAll/escort) or CHAIN
  // (combo) needs a removing/scoring path; a pickup wired only to a non-removing
  // effect (slow/push/…) is never cleared → unwinnable. A pickup with no rule at
  // all also gets collect.
  if (roles.has("pickup")) {
    const pickupCols = collisions.filter(c => c.between.includes("pickup"));
    const hasRemove = pickupCols.some(c => PICKUP_REMOVERS.has(c.effect));
    const hasCollect = pickupCols.some(c => c.effect === "collect");
    const mustClear = goal.type === "collectAll" || goal.type === "escort";
    const mustChain = goal.type === "combo"; // combo only rises on collect
    if (pickupCols.length === 0 || (mustClear && !hasRemove) || (mustChain && !hasCollect)) {
      collisions.push({ between: ["player", "pickup"], effect: "collect" });
    }
  }
  // A shooter's projectiles must be able to hurt the player, else the fire is inert.
  if (entities.some(e => e.motion === "shooter") &&
      !collisions.some(c => c.between.includes("projectile") && (c.effect === "lose" || c.effect === "damage"))) {
    collisions.push({ between: ["player", "projectile"], effect: "lose" });
  }
  // reachGoal wins by touching the goal; defend needs the goal to be destructible.
  if (goal.type === "reachGoal" && roles.has("goal") && !collisions.some(c => c.effect === "win")) {
    collisions.push({ between: ["player", "goal"], effect: "win" });
  }
  if (goal.type === "defend" && roles.has("goal") &&
      !collisions.some(c => c.between.includes("goal") && (c.effect === "damage" || c.effect === "lose"))) {
    collisions.push({ between: [roles.has("enemy") ? "enemy" : "obstacle", "goal"], effect: "damage" });
  }

  // ACHIEVABILITY (d)+(e): make sure a lose can ACTUALLY fire. A player-lose rule
  // is "shadowed" (never fires) when the player destroys that same threat first
  // via an earlier removing effect on the same pair — spawnOnDeath/collect consume
  // it in the same frame, so a spawnOnDeath-only game is invincible. Ensure a lose
  // targets a threat the player does NOT auto-destroy; if every threat is smashable
  // (or the only threat is static with no lose), add a plain static hazard to lose
  // on. This also breaks the static-threat + score-goal idle soft-lock.
  const otherOf = c => (c.between[0] === "player" ? c.between[1] : c.between[0]);
  const smashedByPlayer = new Set();
  for (const c of collisions) {
    if (c.between.includes("player") && (c.effect === "spawnOnDeath" || c.effect === "collect")) smashedByPlayer.add(otherOf(c));
  }
  const canLose = collisions.some(c =>
    (c.effect === "lose" || c.effect === "damage") && c.between.includes("player") && !smashedByPlayer.has(otherOf(c)));
  if (!canLose) {
    const threat = ["projectile", "obstacle", "enemy"].find(r => roles.has(r) && !smashedByPlayer.has(r));
    if (threat) {
      collisions.push({ between: ["player", threat], effect: "lose" });
    } else {
      const hazard = coerceEntity({ role: "obstacle", motion: "static", shape: "spike", count: 2, speed: 0, hp: 1 });
      if (entities.length < MAX_ENTITIES) entities.push(hazard); else entities[entities.length - 1] = hazard;
      entities = capSprites(entities);
      roles.add("obstacle");
      collisions.push({ between: ["player", "obstacle"], effect: "lose" });
    }
  }

  // ACHIEVABILITY (b): a score/combo target above what the spec can yield is
  // unwinnable. Clamp to the achievable total; with no scoring source at all, fall
  // back to a survivable objective (survive is always winnable + losable here).
  if (goal.type === "score" || goal.type === "combo") {
    const cap = achievableScore(entities, collisions);
    if (cap <= 0) goal = { type: "survive", value: 600 };
    else if (goal.type === "combo") goal = cap < 2 ? { type: "collectAll", value: 0 } : { type: "combo", value: Math.min(goal.value, cap) };
    else goal.value = Math.min(goal.value, cap);
  }

  collisions = collisions.slice(0, 10);
  return { title, theme, entities, collisions, goal };
}

// --- deterministic RNG (seed from title|theme; no Math.random / Date) ----
function seedFrom(spec) {
  const text = `${spec.title}|${spec.theme}`;
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed + text.charCodeAt(i) * (i + 1)) % 9973;
  return seed || 1;
}
function makeRng(state) {
  return () => { state.rng = (state.rng * 1103515245 + 12345) & 0x7fffffff; return state.rng; };
}

// Build one live instance. Placement (x,y) is decided by the caller; this seeds
// the per-motion state (velocity, orbit center, wander heading) deterministically.
function makeInstance(o, rand) {
  const inst = {
    id: 0, role: o.role, motion: o.motion, shape: o.shape, speed: o.speed,
    size: o.size, hp: o.hp ?? 1, alive: true, vx: 0, vy: 0,
    spawnClock: 0, wanderClock: 0, angle: 0, orbitCx: 0, orbitCy: 0, orbitR: 0,
    x: o.x, y: o.y, px: o.x, py: o.y
  };
  const index = o.index ?? 0;
  const half = inst.size / 2;
  switch (inst.motion) {
    case "patrol": inst.vx = (index % 2 ? -1 : 1) * inst.speed; break;
    case "faller": inst.vy = inst.speed; break;
    case "wander": { const a = (rand() % 628) / 100; inst.vx = Math.cos(a) * inst.speed; inst.vy = Math.sin(a) * inst.speed; break; }
    case "orbit": {
      const R = clamp(40 + (index * 17) % 90, 20, Math.min(W, H) / 2 - half);
      inst.orbitR = R;
      inst.orbitCx = clamp(inst.x, R + half, W - R - half);
      inst.orbitCy = clamp(inst.y, R + half, H - R - half);
      inst.angle = (rand() % 628) / 100;
      break;
    }
    default: break;
  }
  // Model-declared projectiles with no heading default to travelling downward.
  if (inst.role === "projectile" && inst.vx === 0 && inst.vy === 0) inst.vy = Math.max(2, inst.speed);
  return inst;
}

function placeInstance(e, index, rand) {
  const size = sizeFor(e.role);
  let x, y;
  if (e.role === "player") { x = W / 2; y = H - 60; }
  else if (e.role === "goal") { x = W / 2 + (index === 0 ? 0 : (rand() % 200) - 100); y = 60; }
  else { x = 30 + (rand() % (W - 60)); y = 60 + (rand() % 300); }
  return makeInstance({ role: e.role, motion: e.motion, shape: e.shape, speed: e.speed, size, hp: e.hp, x, y, index }, rand);
}

function moveEntity(e, input, dt, player, rand, slowFactor) {
  e.px = e.x; e.py = e.y;
  const half = e.size / 2;
  // Projectiles always travel by their heading and expire off-screen.
  if (e.role === "projectile") {
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (e.x < -e.size || e.x > W + e.size || e.y < -e.size || e.y > H + e.size) e.alive = false;
    return;
  }
  switch (e.motion) {
    case "input4":
    case "inputLR": {
      const spd = e.speed * slowFactor;
      const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      e.x = clamp(e.x + dx * spd * dt, half, W - half);
      if (e.motion === "input4") {
        const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        e.y = clamp(e.y + dy * spd * dt, half, H - half);
      }
      break;
    }
    case "faller":
      e.y += e.speed * dt;
      if (e.y > H + e.size) {
        // Pickups that fall past the floor are gone; hazards rain endlessly.
        if (e.role === "pickup") e.alive = false;
        else { e.y = -e.size; e.x = 30 + (rand() % (W - 60)); }
      }
      break;
    case "patrol":
      e.x += e.vx * dt;
      if (e.x < half || e.x > W - half) { e.vx *= -1; e.x = clamp(e.x, half, W - half); }
      break;
    case "chase": {
      if (!player) break;
      const dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt;
      break;
    }
    case "homing": {
      // Slow seek: steer toward the player with momentum, capped below chase speed.
      if (!player) break;
      const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy) || 1;
      const accel = e.speed * 0.05;
      e.vx += (dx / d) * accel; e.vy += (dy / d) * accel;
      const v = Math.hypot(e.vx, e.vy), cap = e.speed * 0.6;
      if (v > cap) { e.vx = e.vx / v * cap; e.vy = e.vy / v * cap; }
      e.x = clamp(e.x + e.vx * dt, half, W - half);
      e.y = clamp(e.y + e.vy * dt, half, H - half);
      break;
    }
    case "orbit":
      e.angle += (e.speed * 0.03 + 0.01) * dt;
      e.x = e.orbitCx + Math.cos(e.angle) * e.orbitR;
      e.y = e.orbitCy + Math.sin(e.angle) * e.orbitR;
      break;
    case "wander": {
      // Deterministic pseudo-random walk: re-roll a heading on a cadence, bounce walls.
      e.wanderClock += dt;
      if (e.wanderClock >= 45) { e.wanderClock = 0; const a = (rand() % 628) / 100; e.vx = Math.cos(a) * e.speed; e.vy = Math.sin(a) * e.speed; }
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.x < half || e.x > W - half) { e.vx *= -1; e.x = clamp(e.x, half, W - half); }
      if (e.y < half || e.y > H - half) { e.vy *= -1; e.y = clamp(e.y, half, H - half); }
      break;
    }
    case "static":
    case "spawner":
    case "shooter":
    default:
      break; // spawner / shooter emission handled separately
  }
}

function overlap(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) < (a.size + b.size) * 0.45;
}

// The "protected" side of a non-player collision (goal/pickup/obstacle) takes
// the hit; the enemy/projectile is the attacker.
function victimOf(a, b) {
  const attackerRank = r => (r === "enemy" || r === "projectile") ? 0 : 1;
  return attackerRank(a.role) >= attackerRank(b.role) ? a : b;
}

function spawnChild(state, parent, rand) {
  const child = makeInstance({
    role: parent.role, motion: parent.motion, shape: parent.shape, speed: parent.speed,
    size: parent.size * 0.6, hp: 1, x: parent.x, y: parent.y, index: state.nextId
  }, rand);
  child.id = state.nextId++;
  state.ents.push(child);
}

function applyEffect(effect, a, b, state, rand) {
  const player = a.role === "player" ? a : b.role === "player" ? b : null;
  const other = a === player ? b : a;
  const shielded = player && state.ticks < state.shieldUntil;
  switch (effect) {
    case "lose":
      if (shielded) { other.alive = false; break; } // the shield eats the hit
      state.over = true; state.won = false; break;
    case "win":  state.over = true; state.won = true;  break;
    case "collect":
      if (other.alive) { other.alive = false; state.score++; state.combo++; }
      break;
    case "damage":
      if (player) {
        other.alive = false;          // the threat is consumed on contact
        if (shielded) break;          // shield absorbs it: no life lost
        state.combo = 0;
        if (--state.lives <= 0) { state.over = true; state.won = false; }
      } else {                        // e.g. an enemy chipping the defended goal
        const victim = victimOf(a, b), attacker = victim === a ? b : a;
        if (--victim.hp <= 0) victim.alive = false;
        attacker.alive = false;
      }
      break;
    case "bounce":
      if (player) { player.x = player.px; player.y = player.py; }
      for (const e of [a, b]) if (e !== player) { e.vx *= -1; e.vy *= -1; }
      break;
    case "push":
      if (player) {
        const dx = player.x - other.x, dy = player.y - other.y, d = Math.hypot(dx, dy) || 1;
        player.x = clamp(player.x + (dx / d) * PUSH_DIST, player.size / 2, W - player.size / 2);
        player.y = clamp(player.y + (dy / d) * PUSH_DIST, player.size / 2, H - player.size / 2);
        player.px = player.x; player.py = player.y;
      }
      break;
    case "teleport":
      if (player) {
        player.x = 30 + (rand() % (W - 60));
        player.y = 60 + (rand() % (H - 120));
        player.px = player.x; player.py = player.y;
      }
      break;
    case "shield":
      if (player && other.alive) { other.alive = false; state.shieldUntil = state.ticks + SHIELD_TICKS; }
      break;
    case "slow":
      if (player) state.slowUntil = state.ticks + SLOW_TICKS;
      break;
    case "spawnOnDeath":
      if (other && other.alive && other.role !== "player") {
        other.alive = false; state.score++; state.combo++;
        if (other.size > SPLIT_MIN && state.ents.filter(e => e.alive).length + 2 <= MAX_SPRITES) {
          spawnChild(state, other, rand); spawnChild(state, other, rand);
        }
      }
      break;
    default: break;
  }
}

function resolveCollisions(state, rand) {
  const alive = state.ents.filter(e => e.alive);
  for (const rule of state.cfg.collisions) {
    const [ra, rb] = rule.between;
    for (const a of alive) {
      if (!a.alive || a.role !== ra) continue;
      for (const b of alive) {
        if (b === a || !b.alive || b.role !== rb) continue;
        if (overlap(a, b)) { applyEffect(rule.effect, a, b, state, rand); if (state.over) return; }
      }
    }
  }
}

function evaluateGoal(state, player) {
  const g = state.cfg.goal;
  if (g.type === "collectAll") {
    if (state.pickupTotal > 0 && !state.ents.some(e => e.alive && e.role === "pickup")) { state.over = true; state.won = true; }
  } else if (g.type === "survive") {
    if (state.ticks >= g.value) { state.over = true; state.won = true; }
  } else if (g.type === "score") {
    if (state.score >= g.value) { state.over = true; state.won = true; }
  } else if (g.type === "combo") {
    if (state.combo >= g.value) { state.over = true; state.won = true; }
  } else if (g.type === "reachGoal" && player) {
    if (state.ents.some(e => e.alive && e.role === "goal" && overlap(e, player))) { state.over = true; state.won = true; }
  } else if (g.type === "defend") {
    // Win by keeping the guarded entity alive to the deadline; lose if it falls.
    if (!state.ents.some(e => e.alive && e.role === "goal")) { state.over = true; state.won = false; }
    else if (state.ticks >= g.value) { state.over = true; state.won = true; }
  } else if (g.type === "escort" && player) {
    // Deliver: gather every pickup, then reach the drop-off (goal entity).
    const cargoLeft = state.ents.some(e => e.alive && e.role === "pickup");
    const atGoal = state.ents.some(e => e.alive && e.role === "goal" && overlap(e, player));
    if (state.pickupTotal > 0 && !cargoLeft && atGoal) { state.over = true; state.won = true; }
  }
}

export default {
  key: "sandbox",
  meta: { label: "Sandbox", keywords: ["make", "build", "custom", "sandbox", "invent", "mix"] },
  schema: {
    theme: THEME_FIELD,
    title: { type: "string", default: "Sandbox Game" }
  },
  skill: {
    system:
`Assemble a game from safe primitives. Return ONLY a JSON object with these fields:
- title: string; theme(${THEME_CHOICES}).
- entities: 1-8 of { role, motion, shape, count(1-12), speed(0-8), hp(1-20 optional) }.
    role: ${ROLES.join("|")}. motion: ${MOTIONS.join("|")}. shape: ${SHAPES.join("|")}.
    input4/inputLR = the player (exactly one player). faller drops; patrol bounces
    side to side; chase homes on the player; homing slowly drifts toward the player;
    orbit circles a point; wander walks a random path; static holds; spawner emits
    falling copies; shooter fires projectiles at the player. projectile = a bullet.
    hp = hits a destructible entity takes before it dies (default 1).
- collisions: role pairs -> effect. between:[roleA,roleB], effect: ${EFFECTS.join("|")}.
    collect = remove + score; win/lose end the game; damage costs a life (or chips an
    entity's hp); bounce repels; push knocks the player back; teleport relocates the
    player; slow briefly slows the player; shield grants brief invulnerability;
    spawnOnDeath destroys the target and splits it into smaller copies.
- goal: { type(${GOALS.join("|")}), value }. collectAll = clear all pickups; survive =
    last value ticks; score = reach value points; reachGoal = touch the goal entity;
    defend = keep the goal entity alive value ticks; escort = collect every pickup then
    reach the goal; combo = chain value collects without taking a hit.
Example: {"title":"Star Sweep","theme":"neon","entities":[{"role":"player","motion":"input4","shape":"ship","count":1,"speed":5},{"role":"pickup","motion":"static","shape":"target","count":6,"speed":0},{"role":"enemy","motion":"chase","shape":"invader","count":2,"speed":3}],"collisions":[{"between":["player","pickup"],"effect":"collect"},{"between":["player","enemy"],"effect":"lose"}],"goal":{"type":"collectAll","value":0}}`,
    examples: [
      {
        prompt: "collect all the coins while ghosts chase you",
        json: {
          title: "Coin Chase", theme: "retro",
          entities: [
            { role: "player", motion: "input4", shape: "runner", count: 1, speed: 5 },
            { role: "pickup", motion: "static", shape: "target", count: 8, speed: 0 },
            { role: "enemy", motion: "chase", shape: "invader", count: 3, speed: 3 }
          ],
          collisions: [
            { between: ["player", "pickup"], effect: "collect" },
            { between: ["player", "enemy"], effect: "lose" }
          ]
        }
      },
      {
        prompt: "dodge the falling spikes and survive",
        json: {
          title: "Spike Storm", theme: "neon",
          entities: [
            { role: "player", motion: "inputLR", shape: "ship", count: 1, speed: 6 },
            { role: "enemy", motion: "spawner", shape: "spike", count: 1, speed: 4 }
          ],
          collisions: [
            { between: ["player", "enemy"], effect: "lose" }
          ]
        }
      },
      {
        prompt: "a turret fires at me, weave through its bullets",
        json: {
          title: "Turret Run", theme: "scifi",
          entities: [
            { role: "player", motion: "inputLR", shape: "ship", count: 1, speed: 6 },
            { role: "enemy", motion: "shooter", shape: "invader", count: 2, speed: 4 }
          ],
          collisions: [
            { between: ["player", "projectile"], effect: "lose" }
          ]
        }
      },
      {
        prompt: "smash the drifting rocks so they split apart",
        json: {
          title: "Rock Splitter", theme: "eightbit",
          entities: [
            { role: "player", motion: "input4", shape: "ship", count: 1, speed: 5 },
            { role: "enemy", motion: "wander", shape: "diamond", count: 3, speed: 2 },
            { role: "enemy", motion: "orbit", shape: "spike", count: 3, speed: 4 }
          ],
          collisions: [
            { between: ["player", "enemy"], effect: "spawnOnDeath" },
            { between: ["player", "enemy"], effect: "lose" }
          ]
        }
      },
      {
        prompt: "grab a shield then outlast the swarm",
        json: {
          title: "Shield Wall", theme: "vaporwave",
          entities: [
            { role: "player", motion: "input4", shape: "runner", count: 1, speed: 5 },
            { role: "pickup", motion: "static", shape: "circle", count: 3, speed: 0 },
            { role: "enemy", motion: "homing", shape: "invader", count: 4, speed: 3 }
          ],
          collisions: [
            { between: ["player", "pickup"], effect: "shield" },
            { between: ["player", "enemy"], effect: "lose" }
          ]
        }
      }
    ]
  },
  engine: {
    init(cfg) {
      // Self-heal: always run through the gate so a raw / bare config can never
      // crash the interpreter (init may be handed just { theme, title }).
      const spec = specValidate(cfg);
      const state = {
        cfg: spec, ents: [], score: 0, over: false, won: false,
        lives: START_LIVES, ticks: 0, rng: seedFrom(spec), nextId: 0, pickupTotal: 0,
        combo: 0, shieldUntil: 0, slowUntil: 0
      };
      const rand = makeRng(state);
      for (const e of spec.entities) {
        const n = e.role === "player" ? 1 : e.count;
        for (let i = 0; i < n; i++) {
          const inst = placeInstance(e, i, rand);
          inst.id = state.nextId++;
          state.ents.push(inst);
        }
      }
      // A defended base sits at the bottom with the player guarding in front of it,
      // so descending threats actually converge on the thing you protect.
      if (spec.goal.type === "defend") {
        for (const e of state.ents) {
          if (e.role === "goal") { e.x = W / 2; e.y = H - 50; e.px = e.x; e.py = e.y; }
          else if (e.role === "player") { e.y = H - 120; e.px = e.x; e.py = e.y; }
        }
      }
      state.pickupTotal = state.ents.filter(e => e.role === "pickup").length;
      return state;
    },
    step(s, input, dt) {
      if (s.over) return s;
      const rand = makeRng(s);
      const inp = input || {};
      s.ticks += dt;
      const player = s.ents.find(e => e.role === "player" && e.alive) || null;
      const slowFactor = s.ticks < s.slowUntil ? SLOW_FACTOR : 1;

      for (const e of s.ents) if (e.alive) moveEntity(e, inp, dt, player, rand, slowFactor);

      // Emitters: spawners rain a falling child; shooters fire a projectile at the
      // player. Both fire on a seeded cadence and are capped by the sprite budget.
      for (const e of s.ents) {
        if (!e.alive) continue;
        if (e.motion === "spawner") {
          e.spawnClock += dt;
          const interval = Math.max(15, 90 - e.speed * 8);
          if (e.spawnClock >= interval && s.ents.filter(x => x.alive).length < MAX_SPRITES) {
            e.spawnClock = 0;
            s.ents.push({
              id: s.nextId++, role: e.role, motion: "faller", shape: e.shape, speed: e.speed,
              size: sizeFor(e.role), hp: 1, alive: true, vx: 0, vy: e.speed, spawnClock: 0,
              wanderClock: 0, angle: 0, orbitCx: 0, orbitCy: 0, orbitR: 0,
              x: e.x, y: e.y + e.size, px: e.x, py: e.y
            });
          }
        } else if (e.motion === "shooter") {
          e.spawnClock += dt;
          const interval = Math.max(20, 100 - e.speed * 8);
          if (e.spawnClock >= interval && s.ents.filter(x => x.alive).length < MAX_SPRITES) {
            e.spawnClock = 0;
            const pv = e.speed + 3;
            let dx = 0, dy = 1;
            if (player) { const ax = player.x - e.x, ay = player.y - e.y, d = Math.hypot(ax, ay) || 1; dx = ax / d; dy = ay / d; }
            const shot = makeInstance({ role: "projectile", motion: "static", shape: "dot", speed: pv, size: sizeFor("projectile"), hp: 1, x: e.x, y: e.y, index: 0 }, rand);
            shot.vx = dx * pv; shot.vy = dy * pv; shot.id = s.nextId++;
            s.ents.push(shot);
          }
        }
      }

      resolveCollisions(s, rand);
      if (!s.over) evaluateGoal(s, player);
      s.ents = s.ents.filter(e => e.alive);
      return s;
    },
    status(s) { return { score: s.score, over: s.over, won: s.won }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      const colorFor = role =>
        role === "player" ? pal.fg
        : role === "pickup" ? pal.hud
        : role === "goal" ? pal.fg
        : pal.accent; // enemy + obstacle + projectile
      for (const e of s.ents) {
        if (e.alive) drawShape(ctx, e.shape, e.x, e.y, e.size, colorFor(e.role));
      }
    }
  }
};
