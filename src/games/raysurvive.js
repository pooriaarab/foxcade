import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";
import {
  W, H, hashSeed, isWall, angDiff, moveWithSlide, losClear,
  floorCells, pickSpread, renderScene, crosshair
} from "./raycast-core.js";

const THEME_CHOICES = THEME_IDS.join("|");

const MOVE = 0.04, TURN = 0.03;
const RANGE = 22;   // hitscan reach, in cells
const AIM = 0.2;    // half-beam the crosshair forgives, in radians
const HIT_R = 0.5;  // enemy-touches-player distance
// Empty-mag safety valve: if ammo hits 0 the run can't stall — this many ticks
// later a few rounds regenerate, so a kited player is never soft-locked (contact-
// kill drains the wave too, but this guarantees offence remains possible).
const AMMO_REGEN = 220;

// Three enemy archetypes. Speed is a FRACTION of the player's own move speed
// (resolved per config at spawn), so enemies stay a real threat at any moveSpeed —
// the sprinter nearly matches the player; the brute is slow but takes three hits.
const TYPES = [
  { kind:"invader", frac:0.55, hp:1, scale:0.7,  color:"accent" }, // grunt
  { kind:"diamond", frac:0.85, hp:1, scale:0.55, color:"fg"     }, // sprinter
  { kind:"block",   frac:0.40, hp:3, scale:0.9,  color:"accent" }  // brute
];

// Pillar-grid arena: solid border + pillars on even/even cells only. Even/even
// cells are never 4-adjacent, so the floor is always one connected space for any
// seed (navigability by construction — same trick raycaster.js uses).
function makeArena(n, seed) {
  const grid = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) {
      const border = x === 0 || y === 0 || x === n - 1 || y === n - 1;
      const pillar = x % 2 === 0 && y % 2 === 0 && ((seed + x * 31 + y * 17) % 4 !== 0);
      row.push(border || pillar);
    }
    grid.push(row);
  }
  return grid;
}

// Deterministic wave: count grows with the wave, and both count AND per-enemy
// speed escalate (speed scales with the wave, capped) so late waves genuinely
// press. Speed is `moveSpeed` (player units/tick) × the type fraction × waveScale.
function spawnWave(grid, seed, wave, base, start, moveSpeed) {
  const count = base + (wave - 1);
  const unit = moveSpeed * MOVE;                       // player distance per tick
  const waveScale = Math.min(1.6, 1 + 0.1 * (wave - 1));
  const cells = pickSpread(floorCells(grid, start, 3), seed + wave * 131, count);
  return cells.map((c, i) => {
    const t = TYPES[(seed + i * 7 + wave * 3) % TYPES.length];
    return { x:c.x + 0.5, y:c.y + 0.5, kind:t.kind, speed:unit * t.frac * waveScale, hp:t.hp, scale:t.scale, colorKey:t.color, alive:true };
  });
}

// Nearest alive enemy in the aim beam, within range, with a clear line of sight
// takes one point of damage. Mutates state; called from step on a fresh trigger.
function shoot(s) {
  const p = s.player;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < s.enemies.length; i++) {
    const e = s.enemies[i];
    if (!e.alive) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > RANGE || Math.abs(angDiff(Math.atan2(dy, dx) - p.angle)) > AIM) continue;
    if (!losClear(s.grid, p.x, p.y, e.x, e.y)) continue;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0 && --s.enemies[best].hp <= 0) { s.enemies[best].alive = false; s.score++; }
}

export default {
  key: "raysurvive",
  meta: { label: "Wave Survival", keywords: ["3d","fps","survival","waves","first-person","shooter","raycaster"] },
  schema: {
    fov:        { type:"number", min:45, max:100, default:72 },
    moveSpeed:  { type:"number", min:1,  max:8,   default:4 },
    turnSpeed:  { type:"number", min:1,  max:8,   default:4 },
    mapSize:    { type:"number", min:8,  max:20,  default:12 },
    health:     { type:"number", min:1,  max:9,   default:5 },
    ammo:       { type:"number", min:5,  max:40,  default:12 },
    enemyCount: { type:"number", min:1,  max:8,   default:4 },
    theme:      THEME_FIELD,
    title:      { type:"string", default:"Wave Survival" }
  },
  skill: {
    system: `Configure a pseudo-3D first-person wave-survival shooter: hold an arena against escalating waves of enemy types (fast/weak sprinters, tough slow brutes, grunts), managing limited ammo and health. Fields: fov(45-100),moveSpeed(1-8),turnSpeed(1-8),mapSize(8-20),health(1-9),ammo(5-40),enemyCount(1-8 base wave size),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"neon 3d fps horde survival with waves and ammo", json:{ fov:75, moveSpeed:5, turnSpeed:5, mapSize:12, health:5, ammo:16, enemyCount:4, theme:"neon", title:"Neon Onslaught" } }]
  },
  engine: {
    init(cfg) {
      const n = Math.round(cfg.mapSize);
      const seed = hashSeed(`${cfg.title}|${cfg.theme}`);
      const grid = makeArena(n, seed);
      const start = { x:1, y:1 };
      return {
        cfg, seed, grid,
        player: { x:1.5, y:1.5, angle:0 },
        enemies: spawnWave(grid, seed, 1, Math.round(cfg.enemyCount), start, cfg.moveSpeed),
        health: Math.round(cfg.health),
        ammo: Math.round(cfg.ammo),
        dry: 0,
        wave: 1,
        score: 0,
        prevFire: false,
        over: false
      };
    },
    step(s, input, dt) {
      if (s.over) return s;
      const c = s.cfg, p = s.player;

      if (input.left) p.angle -= c.turnSpeed * TURN * dt;
      if (input.right) p.angle += c.turnSpeed * TURN * dt;
      const dir = input.up ? 1 : input.down ? -1 : 0;
      if (dir) {
        const step = c.moveSpeed * MOVE * dt * dir;
        moveWithSlide(s.grid, p, Math.cos(p.angle) * step, Math.sin(p.angle) * step);
      }

      // Fire on a fresh trigger, only while ammo remains.
      if (input.fire && !s.prevFire && s.ammo > 0) { s.ammo--; shoot(s); }
      s.prevFire = !!input.fire;

      // No soft-lock: an empty mag slowly regenerates a few rounds so a run can
      // never stall with 0 ammo and unkillable enemies. Resets the moment you fire.
      if (s.ammo <= 0) {
        s.dry += dt;
        if (s.dry >= AMMO_REGEN) { s.ammo += 3; s.dry = 0; }
      } else s.dry = 0;

      // Enemies close in; contact kills the enemy and drains a life.
      for (const e of s.enemies) {
        if (!e.alive) continue;
        const vx = p.x - e.x, vy = p.y - e.y;
        const d = Math.hypot(vx, vy) || 1;
        if (d < HIT_R) { e.alive = false; s.health--; continue; }
        moveWithSlide(s.grid, e, (vx / d) * e.speed * dt, (vy / d) * e.speed * dt);
      }

      if (s.health <= 0) { s.over = true; return s; }
      // Wave cleared → next, harder wave spawns and ammo is topped up.
      if (!s.enemies.some(e => e.alive)) {
        s.wave++;
        s.ammo += Math.round(c.ammo * 0.75);
        s.dry = 0;
        s.enemies = spawnWave(s.grid, s.seed, s.wave, Math.round(c.enemyCount), { x:1, y:1 }, c.moveSpeed);
      }
      return s;
    },
    status(s) { return { score: s.score, over: s.over, won: false }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      const sprites = s.enemies
        .filter(e => e.alive)
        .map(e => ({ x:e.x, y:e.y, kind:e.kind, color:pal[e.colorKey] || pal.accent, scale:e.scale }));
      renderScene(ctx, s, pal, sprites);
      crosshair(ctx, pal);

      ctx.font = "16px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.fillStyle = pal.hud;
      ctx.fillText(`Lives ${s.health}`, W - 10, 10);
      ctx.fillText(`Level ${s.wave}`, W - 10, 30);
      // Ammo: bare number beside a round icon (HUD, not entity art).
      drawShape(ctx, "dot", W - 70, 60, 16, pal.fg);
      ctx.fillStyle = pal.hud;
      ctx.fillText(`${s.ammo}`, W - 10, 52);
    }
  }
};
