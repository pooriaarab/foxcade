import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const THEME_CHOICES = THEME_IDS.join("|");

// Tuning constants (cells/frame, radians/frame). dt is the loop's normalized
// frame delta (~1). Kept off the schema — they set feel, not difficulty.
const MOVE = 0.04, TURN = 0.03;
const ENEMY_FRAC = 0.55; // enemy chase speed as a fraction of the player's own move
const RANGE = 20;   // hitscan reach, in cells
const AIM = 0.2;    // half-beam the crosshair forgives, in radians

// Enemy chase speed: a threatening fraction of the player's move, escalating with
// the wave (capped) so contact is a real danger — not the old ~8x-too-slow crawl.
function enemySpeed(cfg, wave) {
  return cfg.moveSpeed * MOVE * ENEMY_FRAC * Math.min(1.8, 1 + 0.12 * (wave - 1));
}

function seedFromConfig(c) {
  const text = `${c.title}|${c.theme}`;
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed + text.charCodeAt(i) * (i + 1)) % 9973;
  return seed;
}

// Pillar-grid map: solid border + interior pillars placed only on even/even
// cells. Even/even cells are never 4-adjacent, so no pillar can ever wall off
// a region — the floor stays one connected space for any seed (navigability by
// construction, no flood-fill needed). The seed just picks WHICH pillars stand.
function makeGrid(n, seed) {
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

function isWall(grid, x, y) {
  const gx = Math.floor(x), gy = Math.floor(y);
  if (gy < 0 || gy >= grid.length || gx < 0 || gx >= grid[gy].length) return true;
  return grid[gy][gx];
}

function angDiff(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Sample the segment for any wall cell between two points.
function losClear(grid, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) / 0.1);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWall(grid, x0 + dx * t, y0 + dy * t)) return false;
  }
  return true;
}

// Deterministic enemy placement: spread seed-derived indices across the floor
// cells that sit at least 3 cells from the player start.
function placeEnemies(grid, seed, count, start) {
  const n = grid.length;
  const cells = [];
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      if (!grid[y][x] && Math.abs(x - start.cx) + Math.abs(y - start.cy) >= 3) cells.push({ x, y });
    }
  }
  const enemies = [];
  const used = new Set();
  for (let i = 0; i < count && cells.length; i++) {
    let idx = ((seed * (i + 1) * 97 + i * 53) % cells.length + cells.length) % cells.length;
    for (let tries = 0; used.has(idx) && tries < cells.length; tries++) idx = (idx + 1) % cells.length;
    used.add(idx);
    enemies.push({ x: cells[idx].x + 0.5, y: cells[idx].y + 0.5, alive: true });
  }
  return enemies;
}

// Nearest alive enemy inside the aim beam, within range, with clear line of
// sight → dies. Mutates state; called from step.
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
  if (best >= 0) { s.enemies[best].alive = false; s.score++; }
}

export default {
  key: "raycaster",
  meta: { label: "Raycaster", keywords: ["fps","3d","doom","raycaster","shooter","first-person","corridor"] },
  schema: {
    fov:        { type:"number", min:45, max:100, default:66 },
    moveSpeed:  { type:"number", min:1,  max:8,   default:4 },
    turnSpeed:  { type:"number", min:1,  max:8,   default:4 },
    enemyCount: { type:"number", min:1,  max:12,  default:5 },
    mapSize:    { type:"number", min:8,  max:20,  default:12 },
    health:     { type:"number", min:1,  max:9,   default:3 },
    theme:      THEME_FIELD,
    title:      { type:"string", default:"Forge Raycaster" }
  },
  skill: {
    system: `Configure a pseudo-3D first-person raycaster shooter. Fields: fov(45-100),moveSpeed(1-8),turnSpeed(1-8),enemyCount(1-12),mapSize(8-20),health(1-9),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"neon doom-style corridor fps", json:{ fov:75, moveSpeed:5, turnSpeed:5, enemyCount:6, mapSize:14, health:3, theme:"neon", title:"Neon Corridor" } }]
  },
  engine: {
    init(cfg) {
      const n = Math.round(cfg.mapSize);
      const seed = seedFromConfig(cfg);
      const grid = makeGrid(n, seed);
      return {
        cfg,
        seed,
        grid,
        player: { x:1.5, y:1.5, angle:0 },
        enemies: placeEnemies(grid, seed, Math.round(cfg.enemyCount), { cx:1, cy:1 }),
        health: Math.round(cfg.health),
        score: 0,
        wave: 1,
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
        const nx = p.x + Math.cos(p.angle) * c.moveSpeed * MOVE * dt * dir;
        const ny = p.y + Math.sin(p.angle) * c.moveSpeed * MOVE * dt * dir;
        if (!isWall(s.grid, nx, p.y)) p.x = nx;
        if (!isWall(s.grid, p.x, ny)) p.y = ny;
      }

      if (input.fire && !s.prevFire) shoot(s);
      s.prevFire = !!input.fire;

      const espeed = enemySpeed(c, s.wave);
      for (const e of s.enemies) {
        if (!e.alive) continue;
        const vx = p.x - e.x, vy = p.y - e.y;
        const d = Math.hypot(vx, vy) || 1;
        if (d < 0.5) { e.alive = false; s.health--; continue; }
        const nx = e.x + (vx / d) * espeed * dt;
        const ny = e.y + (vy / d) * espeed * dt;
        if (!isWall(s.grid, nx, e.y)) e.x = nx;
        if (!isWall(s.grid, e.x, ny)) e.y = ny;
      }

      if (s.health <= 0) s.over = true;
      // Endless: clear the wave → a fresh, LARGER wave spawns (count grows too).
      if (!s.over && !s.enemies.some(e => e.alive)) {
        s.wave++;
        s.enemies = placeEnemies(s.grid, s.seed + s.wave, Math.round(c.enemyCount) + (s.wave - 1), { cx:1, cy:1 });
      }
      return s;
    },
    status(s) { return { score:s.score, over:s.over, won:false }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      const p = s.player;
      const n = s.grid.length;
      const fov = (s.cfg.fov * Math.PI) / 180;
      const NUM = 200;             // columns cast across the FOV
      const COL = W / NUM;
      const horizon = H * 0.44;
      const zbuf = new Array(NUM);

      // Floor: a darker shade under the horizon (ceiling keeps the theme bg).
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, horizon, W, H - horizon);

      // One DDA ray per column → nearest wall distance → vertical slice.
      for (let col = 0; col < NUM; col++) {
        const rayA = p.angle - fov / 2 + ((col + 0.5) / NUM) * fov;
        const ca = Math.cos(rayA), sa = Math.sin(rayA);
        let mapX = Math.floor(p.x), mapY = Math.floor(p.y);
        const deltaX = Math.abs(1 / ca), deltaY = Math.abs(1 / sa);
        let stepX, stepY, sideX, sideY;
        if (ca < 0) { stepX = -1; sideX = (p.x - mapX) * deltaX; }
        else { stepX = 1; sideX = (mapX + 1 - p.x) * deltaX; }
        if (sa < 0) { stepY = -1; sideY = (p.y - mapY) * deltaY; }
        else { stepY = 1; sideY = (mapY + 1 - p.y) * deltaY; }

        let side = 0;
        for (let guard = 0; guard < 256; guard++) {
          if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
          else { sideY += deltaY; mapY += stepY; side = 1; }
          if (mapX < 0 || mapY < 0 || mapX >= n || mapY >= n || s.grid[mapY][mapX]) break;
        }
        let dist = (side === 0 ? sideX - deltaX : sideY - deltaY) * Math.cos(rayA - p.angle);
        if (dist < 0.0001) dist = 0.0001;
        zbuf[col] = dist;

        const lineH = Math.min(H * 2, (H * 0.9) / dist);
        const y0 = horizon - lineH / 2;
        // X-facing walls in fg, Y-facing in accent → a flat-shaded depth cue.
        ctx.fillStyle = side === 1 ? pal.accent : pal.fg;
        ctx.fillRect(col * COL, y0, COL + 1, lineH);
        // Distance fog: darken far slices.
        ctx.fillStyle = `rgba(0,0,0,${Math.min(0.82, dist / 12)})`;
        ctx.fillRect(col * COL, y0, COL + 1, lineH);
      }

      // Enemies as billboards, far→near, depth-tested against the wall buffer.
      const sprites = s.enemies
        .filter(e => e.alive)
        .map(e => ({ e, d: Math.hypot(e.x - p.x, e.y - p.y) }))
        .sort((a, b) => b.d - a.d);
      for (const { e, d } of sprites) {
        const ang = angDiff(Math.atan2(e.y - p.y, e.x - p.x) - p.angle);
        if (Math.abs(ang) > fov / 2 + 0.35) continue;
        const screenX = (0.5 + ang / fov) * W;
        const col = Math.floor(screenX / COL);
        if (col >= 0 && col < NUM && d > zbuf[col]) continue; // behind a wall
        const size = Math.min(H, (H * 0.7) / d);
        drawShape(ctx, "invader", screenX, horizon, size, pal.accent);
      }

      // HUD: crosshair + health (labelled Lives to match the HUD-text invariant).
      ctx.fillStyle = pal.hud;
      ctx.fillRect(W / 2 - 1, H / 2 - 8, 2, 16);
      ctx.fillRect(W / 2 - 8, H / 2 - 1, 16, 2);
      ctx.font = "16px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.fillText(`Lives ${s.health}`, W - 10, 10);
    }
  }
};
