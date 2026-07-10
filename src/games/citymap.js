import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const CELL = 48;
const THEME_CHOICES = THEME_IDS.join("|");
// ponytail: driving-feel knobs. Tune here; the physics is intentionally minimal
// (per-axis point collision, no steering inertia), upgrade to real car dynamics
// only if the arcade feel isn't enough.
const DRIVE = 2.2;        // px/step per carSpeed unit
const EDGE = CELL * 0.3;  // nose offset used for wall collision
const REACH = CELL * 0.55; // how close counts as "arrived" at a pickup/dropoff
const REFUEL = 50;        // fuel restored per completed delivery
const DRAIN = 0.08;       // fuel burned per step while moving

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// LCG advanced through state.rng so seeded job generation stays pure + replayable.
function nextRand(s) {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng;
}

// A regular street lattice: every cell is road EXCEPT interior odd/odd blocks,
// which hold buildings. Because all even rows and even columns stay road, every
// road cell is connected — the map is always drivable by construction. A seeded
// 1-in-8 of the block cells opens as a plaza (still road), which only adds
// connectivity, so drivability holds while the map still varies by seed.
function makeCity(cfg) {
  const n = Math.round(cfg.citySize);
  const seed = hashSeed(`${cfg.title}|${cfg.theme}`);
  let r = seed || 1;
  const grid = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) {
      const interior = x > 0 && x < n - 1 && y > 0 && y < n - 1;
      const block = interior && x % 2 === 1 && y % 2 === 1;
      r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
      row.push(block && r % 8 !== 0); // ~1/8 blocks open as plazas
    }
    grid.push(row);
  }
  const roadCells = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!grid[y][x]) roadCells.push({ x, y });
  return { n, seed, grid, roadCells };
}

function centerOf(cell) { return { x: (cell.x + 0.5) * CELL, y: (cell.y + 0.5) * CELL }; }

function isRoad(grid, n, px, py) {
  const x = Math.floor(px / CELL), y = Math.floor(py / CELL);
  return x >= 0 && x < n && y >= 0 && y < n && !grid[y][x];
}

function pickCell(s, exclude) {
  const cells = s.roadCells;
  let cell = cells[0];
  for (let i = 0; i < 12; i++) {
    cell = cells[nextRand(s) % cells.length];
    if (!exclude.some(e => e.x === cell.x && e.y === cell.y)) break;
  }
  return { x: cell.x, y: cell.y };
}

function newJob(s) {
  const carCell = { x: Math.floor(s.car.x / CELL), y: Math.floor(s.car.y / CELL) };
  s.pickup = pickCell(s, [carCell]);
  s.dropoff = pickCell(s, [carCell, s.pickup]);
  s.phase = "pickup";
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

export default {
  key: "citymap",
  meta: { label: "City Run", keywords: ["city","map","drive","streets","taxi","delivery","explore","gps"] },
  schema: {
    citySize: { type:"number", min:9, max:19, default:13 },
    carSpeed: { type:"number", min:2, max:8,  default:4 },
    fuel:     { type:"number", min:60, max:240, default:120 },
    theme:    THEME_FIELD,
    title:    { type:"string", default:"City Run" }
  },
  skill: {
    system: `Configure a top-down procedural city delivery driving game: drive a taxi/car through seeded streets to a pickup then a dropoff, over and over, before fuel runs out. Fields: citySize(9-19),carSpeed(2-8),fuel(60-240),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"neon taxi delivery run through a big city", json:{ citySize:15, carSpeed:5, fuel:140, theme:"neon", title:"Taxi Run" } }]
  },
  engine: {
    init(cfg) {
      const city = makeCity(cfg);
      // Start on a guaranteed road cell near the center (even/even is always road).
      let sc = Math.floor(city.n / 2); sc -= sc % 2;
      const start = centerOf({ x: sc, y: sc });
      const s = {
        cfg,
        n: city.n,
        seed: city.seed,
        rng: city.seed || 1,
        grid: city.grid,
        roadCells: city.roadCells,
        car: { x: start.x, y: start.y, fx: 0, fy: -1 },
        pickup: null,
        dropoff: null,
        phase: "pickup",
        score: 0,
        maxFuel: Math.round(cfg.fuel),
        fuel: Math.round(cfg.fuel),
        over: false
      };
      newJob(s);
      return s;
    },
    step(s, input, dt) {
      if (s.over) return s;
      const c = s.cfg;
      const world = s.n * CELL;
      let dx = 0, dy = 0;
      if (input.left) dx = -1; else if (input.right) dx = 1;
      if (input.up) dy = -1; else if (input.down) dy = 1;

      const spd = c.carSpeed * DRIVE * dt;
      let moved = false;
      if (dx) {
        const nx = clamp(s.car.x + dx * spd, 2, world - 2);
        if (isRoad(s.grid, s.n, nx + dx * EDGE, s.car.y)) { s.car.x = nx; moved = true; }
      }
      if (dy) {
        const ny = clamp(s.car.y + dy * spd, 2, world - 2);
        if (isRoad(s.grid, s.n, s.car.x, ny + dy * EDGE)) { s.car.y = ny; moved = true; }
      }
      if (dx || dy) { s.car.fx = dx; s.car.fy = dy; }

      if (moved) s.fuel = Math.max(0, s.fuel - DRAIN * dt);
      if (s.fuel <= 0) { s.over = true; return s; }

      const target = s.phase === "pickup" ? s.pickup : s.dropoff;
      if (dist(s.car, centerOf(target)) < REACH) {
        if (s.phase === "pickup") {
          s.phase = "dropoff";
        } else {
          s.score++;
          s.fuel = Math.min(s.maxFuel, s.fuel + REFUEL);
          newJob(s);
        }
      }
      return s;
    },
    status(s) { return { score: s.score, over: s.over, won: false }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      const world = s.n * CELL;
      const cam = {
        x: clamp(s.car.x - W / 2, 0, Math.max(0, world - W)),
        y: clamp(s.car.y - H / 2, 0, Math.max(0, world - H))
      };
      // Streets are the base layer; buildings sit on top so the road lattice reads
      // as the gaps between blocks.
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = pal.hud;
      ctx.fillRect(-cam.x, -cam.y, world, world);
      ctx.restore();

      const x0 = Math.max(0, Math.floor(cam.x / CELL));
      const x1 = Math.min(s.n - 1, Math.floor((cam.x + W) / CELL));
      const y0 = Math.max(0, Math.floor(cam.y / CELL));
      const y1 = Math.min(s.n - 1, Math.floor((cam.y + H) / CELL));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (s.grid[y][x]) drawShape(ctx, "block", (x + 0.5) * CELL - cam.x, (y + 0.5) * CELL - cam.y, CELL, pal.accent);
        }
      }

      const pc = centerOf(s.pickup), dc = centerOf(s.dropoff);
      drawShape(ctx, "flag", dc.x - cam.x, dc.y - cam.y, CELL * 0.8, pal.accent);
      if (s.phase === "pickup") drawShape(ctx, "target", pc.x - cam.x, pc.y - cam.y, CELL * 0.7, pal.fg);

      // Car, rotated to face its heading (0 = up).
      const angle = Math.atan2(s.car.fx, -s.car.fy);
      ctx.save();
      ctx.translate(s.car.x - cam.x, s.car.y - cam.y);
      ctx.rotate(angle);
      drawShape(ctx, "car", 0, 0, CELL * 0.62, pal.fg);
      ctx.restore();

      // Fuel gauge (top-right) — a bar, never text, to stay within the no-emoji /
      // no-text-as-sprite rendering invariant.
      const fw = 120, fh = 8, fx = W - fw - 10, fy = 16;
      ctx.save();
      ctx.globalAlpha = 0.25; ctx.fillStyle = pal.hud; ctx.fillRect(fx, fy, fw, fh);
      ctx.globalAlpha = 1; ctx.fillStyle = pal.accent;
      ctx.fillRect(fx, fy, fw * clamp(s.fuel / s.maxFuel, 0, 1), fh);
      ctx.restore();
    }
  }
};
