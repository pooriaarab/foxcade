import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";
import {
  W, H, hashSeed, makeRand, isWall, moveWithSlide,
  floorCells, pickSpread, renderScene, crosshair
} from "./raycast-core.js";

const THEME_CHOICES = THEME_IDS.join("|");

// Feel constants (cells/frame, radians/frame) — off the schema on purpose.
const MOVE = 0.04, TURN = 0.03;
// Enemy chase speed as a fraction of the player's own move, so pursuers are a real
// threat at any moveSpeed (was a flat ~9x-too-slow crawl); still escapable through
// the maze corridors since the player is faster.
const ENEMY_FRAC = 0.55;
const PICKUP_R = 0.5;   // how close counts as collected / at the exit

// Recursive-backtracker maze on odd cells → a PERFECT maze: every floor cell is
// reachable from every other, so pickups/exit are always navigable by
// construction (no flood-fill needed). n is forced odd so the border stays solid.
function makeMaze(n, rand) {
  const grid = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push(true);
    grid.push(row);
  }
  const dirs = [{ x:0, y:-2 }, { x:2, y:0 }, { x:0, y:2 }, { x:-2, y:0 }];
  grid[1][1] = false;
  const stack = [{ x:1, y:1 }];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const nbrs = [];
    for (const d of dirs) {
      const nx = cur.x + d.x, ny = cur.y + d.y;
      if (nx > 0 && ny > 0 && nx < n - 1 && ny < n - 1 && grid[ny][nx]) {
        nbrs.push({ nx, ny, mx: cur.x + d.x / 2, my: cur.y + d.y / 2 });
      }
    }
    if (!nbrs.length) { stack.pop(); continue; }
    const pick = nbrs[rand(nbrs.length)];
    grid[pick.my][pick.mx] = false;
    grid[pick.ny][pick.nx] = false;
    stack.push({ x: pick.nx, y: pick.ny });
  }
  return grid;
}

function center(cell) { return { x: cell.x + 0.5, y: cell.y + 0.5 }; }

export default {
  key: "raymaze",
  meta: { label: "Maze Hunt", keywords: ["3d","first-person","maze","hunt","collect","dungeon","raycaster"] },
  schema: {
    fov:         { type:"number", min:45, max:100, default:66 },
    moveSpeed:   { type:"number", min:1,  max:8,   default:4 },
    turnSpeed:   { type:"number", min:1,  max:8,   default:4 },
    mapSize:     { type:"number", min:9,  max:21,  default:15 },
    pickupCount: { type:"number", min:3,  max:12,  default:6 },
    enemyCount:  { type:"number", min:0,  max:6,   default:3 },
    health:      { type:"number", min:1,  max:9,   default:3 },
    theme:       THEME_FIELD,
    title:       { type:"string", default:"Maze Hunt" }
  },
  skill: {
    system: `Configure a pseudo-3D first-person maze hunt: navigate a seeded 3D maze, collect every pickup, then reach the exit while roaming enemies chase you. Fields: fov(45-100),moveSpeed(1-8),turnSpeed(1-8),mapSize(9-21),pickupCount(3-12),enemyCount(0-6),health(1-9),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"neon 3d dungeon maze, collect the loot and escape", json:{ fov:70, moveSpeed:5, turnSpeed:5, mapSize:15, pickupCount:6, enemyCount:3, health:3, theme:"neon", title:"Neon Labyrinth" } }]
  },
  engine: {
    init(cfg) {
      const n = Math.round(cfg.mapSize) | 1;      // force odd
      const seed = hashSeed(`${cfg.title}|${cfg.theme}`);
      const rand = makeRand(seed);
      const grid = makeMaze(n, rand);
      grid[1][2] = false;   // always open the cell east of the start so the
                            // player spawns facing down an open corridor (+x)
      const start = { x:1, y:1 };
      const exit = { x:n - 2, y:n - 2 };           // far corner, always floor
      // Pickups + enemies on distinct floor cells away from the start.
      const cells = floorCells(grid, start, 2).filter(c => !(c.x === exit.x && c.y === exit.y));
      const picks = pickSpread(cells, seed, Math.round(cfg.pickupCount) + Math.round(cfg.enemyCount));
      const pickCells = picks.slice(0, Math.round(cfg.pickupCount));
      const enemyCells = picks.slice(Math.round(cfg.pickupCount));
      return {
        cfg, seed, grid, n,
        player: { x:1.5, y:1.5, angle:0 },
        exit,
        pickups: pickCells.map(center),
        enemies: enemyCells.map(c => ({ ...center(c), home: center(c), alive:true })),
        health: Math.round(cfg.health),
        collected: 0,
        over: false,
        won: false
      };
    },
    step(s, input, dt) {
      if (s.over || s.won) return s;
      const c = s.cfg, p = s.player;

      if (input.left) p.angle -= c.turnSpeed * TURN * dt;
      if (input.right) p.angle += c.turnSpeed * TURN * dt;
      const dir = input.up ? 1 : input.down ? -1 : 0;
      if (dir) {
        const step = c.moveSpeed * MOVE * dt * dir;
        moveWithSlide(s.grid, p, Math.cos(p.angle) * step, Math.sin(p.angle) * step);
      }

      // Collect any pickup within reach.
      s.pickups = s.pickups.filter(pk => {
        const hit = Math.hypot(pk.x - p.x, pk.y - p.y) < PICKUP_R;
        if (hit) s.collected++;
        return !hit;
      });

      // Enemies chase; on contact they knock you back to their spawn and cost a life.
      const espeed = c.moveSpeed * MOVE * ENEMY_FRAC;
      for (const e of s.enemies) {
        if (!e.alive) continue;
        const vx = p.x - e.x, vy = p.y - e.y;
        const d = Math.hypot(vx, vy) || 1;
        if (d < PICKUP_R) {
          s.health--;
          e.x = e.home.x; e.y = e.home.y;   // reset so it can't drain every frame
          continue;
        }
        moveWithSlide(s.grid, e, (vx / d) * espeed * dt, (vy / d) * espeed * dt);
      }

      if (s.health <= 0) s.over = true;
      // Win: everything collected AND standing on the exit cell.
      if (!s.over && s.pickups.length === 0 &&
          Math.hypot((s.exit.x + 0.5) - p.x, (s.exit.y + 0.5) - p.y) < PICKUP_R) {
        s.won = true;
      }
      return s;
    },
    status(s) { return { score: s.collected, over: s.over, won: s.won }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      const sprites = [
        // The exit is only "lit" (fg) once the maze is cleared; dim until then.
        { x:s.exit.x + 0.5, y:s.exit.y + 0.5, kind:"flag", color:s.pickups.length ? pal.accent : pal.fg, scale:0.9 },
        ...s.pickups.map(pk => ({ x:pk.x, y:pk.y, kind:"target", color:pal.fg, scale:0.6 })),
        ...s.enemies.filter(e => e.alive).map(e => ({ x:e.x, y:e.y, kind:"invader", color:pal.accent, scale:0.7 }))
      ];
      renderScene(ctx, s, pal, sprites);
      crosshair(ctx, pal);

      ctx.font = "16px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.fillStyle = pal.hud;
      ctx.fillText(`Lives ${s.health}`, W - 10, 10);
      // Pickups left: bare number beside a target icon (HUD, not entity art).
      drawShape(ctx, "target", W - 60, 40, 16, pal.fg);
      ctx.fillStyle = pal.hud;
      ctx.fillText(`${s.pickups.length}`, W - 10, 32);
    }
  }
};
