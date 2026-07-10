import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

// Conway's Game of Life as a GOAL game (Simulation genre). A seeded colony
// evolves by Conway's rules; the player taps cells to toggle life. Win = grow
// the live population to `target` before `lifespan` generations elapse; lose =
// run out of generations or let the colony go extinct. Fully pure and
// deterministic — the seed comes from title+theme, never Math.random/Date.
const W = 400, H = 600;
const CELL = 20;
const COLS = W / CELL; // 20
const ROWS = H / CELL; // 30
const THEME_CHOICES = THEME_IDS.join("|");

function seedFromConfig(c) {
  const text = `${c.title}|${c.theme}`;
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed + text.charCodeAt(i) * (i + 1)) % 9973;
  return seed || 1;
}

// Deterministic LCG advancing a scalar — no Math.random.
function nextRand(rng) {
  return (rng * 1103515245 + 12345) & 0x7fffffff;
}

function emptyGrid() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

// Scatter a deterministic starting colony: a spread of live cells dense enough
// to sustain oscillators/gliders but well short of the win target.
function seedGrid(seed) {
  const grid = emptyGrid();
  let rng = seed;
  const cells = 70 + (seed % 40);
  for (let i = 0; i < cells; i++) {
    rng = nextRand(rng);
    const x = rng % COLS;
    rng = nextRand(rng);
    const y = rng % ROWS;
    grid[y][x] = 1;
  }
  return grid;
}

function population(grid) {
  let n = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) n += grid[y][x];
  return n;
}

// One generation of Conway's rules on a bounded board (out-of-bounds = dead).
// Pure: returns a fresh grid, never mutates the input.
export function evolve(grid) {
  const next = emptyGrid();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) n += grid[ny][nx];
        }
      }
      next[y][x] = grid[y][x] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
    }
  }
  return next;
}

export default {
  key: "life",
  meta: { label: "Life Garden", keywords: ["life","cells","automata","sim","grow","evolve","conway"], dailyMode: "solve" },
  schema: {
    target:   { type:"number", min:20, max:200, default:70 },
    lifespan: { type:"number", min:20, max:400, default:150 },
    speed:    { type:"number", min:1,  max:10,  default:5 },
    theme:    THEME_FIELD,
    title:    { type:"string", default:"Forge Life" }
  },
  skill: {
    system: `Configure a Conway's Game of Life growth goal. Fields: target live-cell goal(20-200),lifespan max generations(20-400),speed(1-10),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"neon cellular garden, grow it big", json:{ target:120, lifespan:200, speed:7, theme:"neon", title:"Neon Bloom" } }]
  },
  engine: {
    init(cfg) {
      const grid = seedGrid(seedFromConfig(cfg));
      const pop = population(grid);
      // Invariant: the win target is ALWAYS strictly above the starting
      // population, so the colony must be grown by play — never an instant win
      // from a dense RNG seed. If the requested target is already met (or nearly)
      // by the seed, lift it a clear margin above the seeded count.
      const target = Math.max(Math.round(cfg.target), pop + 10);
      return { cfg, target, cols:COLS, rows:ROWS, grid, gen:0, tick:0, pop, won:false, dead:false };
    },
    step(s, input, dt) {
      if (s.won || s.dead) return s;
      // Toggle a cell on tap — the player seeds life to steer toward the goal.
      if (input.tap && Number.isFinite(input.px) && Number.isFinite(input.py)) {
        const cx = Math.floor(input.px / CELL), cy = Math.floor(input.py / CELL);
        if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) s.grid[cy][cx] = s.grid[cy][cx] ? 0 : 1;
      }
      const interval = Math.max(3, 22 - s.cfg.speed * 2);
      s.tick += dt;
      while (s.tick >= interval) {
        s.tick -= interval;
        s.grid = evolve(s.grid);
        s.gen++;
      }
      s.pop = population(s.grid);
      if (s.pop >= s.target) { s.won = true; return s; }
      if (s.pop === 0 || s.gen >= s.cfg.lifespan) s.dead = true;
      return s;
    },
    status(s) { return { score:s.pop, over:s.dead, won:s.won }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (s.grid[y][x]) drawShape(ctx, "block", x * CELL + CELL / 2, y * CELL + CELL / 2, CELL - 2, pal.fg);
        }
      }
      // Progress-to-goal bar (vector, no text): fills as the colony approaches target.
      const frac = Math.min(1, s.pop / s.target);
      ctx.save();
      ctx.globalAlpha = 0.25; ctx.fillStyle = pal.hud;
      ctx.fillRect(10, H - 16, W - 20, 8);
      ctx.globalAlpha = 0.9; ctx.fillStyle = pal.accent;
      ctx.fillRect(10, H - 16, (W - 20) * frac, 8);
      ctx.restore();
    }
  }
};
