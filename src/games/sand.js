import { getPalette } from "./engine-base.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

// Falling-sand cellular physics toy with a GOAL (Physics & Motion genre).
// Elements: 0 empty, 1 sand, 2 water, 3 wall. Sand falls and piles (and sinks
// through water); water falls, flows diagonally, then levels out; walls are
// static. The player paints with a brush and cycles elements via on-canvas
// swatches. Win = settle `quota` grains of sand into the target zone (the bottom
// `fillDepth` rows). Pure + deterministic: seed from title+theme, bounded grid.
const W = 400, H = 600;
const CELL = 10;
const COLS = W / CELL; // 40
const ROWS = H / CELL; // 60
const SWATCH_H = 30; // top palette strip
const BRUSH = 1;     // brush radius (→ 3×3 dab)
const THEME_CHOICES = THEME_IDS.join("|");
export const EMPTY = 0, SAND = 1, WATER = 2, WALL = 3;

function seedFromConfig(c) {
  const text = `${c.title}|${c.theme}`;
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed + text.charCodeAt(i) * (i + 1)) % 9973;
  return seed || 1;
}

function nextRand(rng) {
  return (rng * 1103515245 + 12345) & 0x7fffffff;
}

function emptyGrid() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
}

// A deterministic sprinkle of sand up top so the toy is alive on first render.
function seedGrid(seed) {
  const grid = emptyGrid();
  let rng = seed;
  for (let i = 0; i < 60; i++) {
    rng = nextRand(rng);
    const x = rng % COLS;
    rng = nextRand(rng);
    const y = 2 + (rng % 8);
    grid[y][x] = SAND;
  }
  return grid;
}

// Deterministic per-cell left/right preference — parity, never Math.random.
function bias(x, y) { return ((x + y) & 1) ? 1 : -1; }

function stepSand(g, moved, x, y) {
  if (y + 1 >= ROWS) return;
  if (g[y + 1][x] === EMPTY) { g[y + 1][x] = SAND; g[y][x] = EMPTY; moved[y + 1][x] = true; return; }
  if (g[y + 1][x] === WATER) { g[y + 1][x] = SAND; g[y][x] = WATER; moved[y + 1][x] = true; return; } // sink
  const dir = bias(x, y);
  for (const dx of [dir, -dir]) {
    const nx = x + dx;
    if (nx >= 0 && nx < COLS && g[y + 1][nx] === EMPTY) { g[y + 1][nx] = SAND; g[y][x] = EMPTY; moved[y + 1][nx] = true; return; }
  }
}

function stepWater(g, moved, x, y) {
  if (y + 1 < ROWS && g[y + 1][x] === EMPTY) { g[y + 1][x] = WATER; g[y][x] = EMPTY; moved[y + 1][x] = true; return; }
  const dir = bias(x, y);
  if (y + 1 < ROWS) {
    for (const dx of [dir, -dir]) {
      const nx = x + dx;
      if (nx >= 0 && nx < COLS && g[y + 1][nx] === EMPTY) { g[y + 1][nx] = WATER; g[y][x] = EMPTY; moved[y + 1][nx] = true; return; }
    }
  }
  for (const dx of [dir, -dir]) {
    const nx = x + dx;
    if (nx >= 0 && nx < COLS && g[y][nx] === EMPTY) { g[y][nx] = WATER; g[y][x] = EMPTY; moved[y][nx] = true; return; }
  }
}

// One physics tick. Bottom-up scan so a grain moves at most one cell per tick
// (no tunnelling); `moved` blocks a cell settled this pass from re-processing.
export function settle(grid) {
  const moved = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  for (let y = ROWS - 1; y >= 0; y--) {
    for (let x = 0; x < COLS; x++) {
      if (moved[y][x]) continue;
      const v = grid[y][x];
      if (v === SAND) stepSand(grid, moved, x, y);
      else if (v === WATER) stepWater(grid, moved, x, y);
    }
  }
  return grid;
}

function paint(g, cx, cy, el) {
  for (let dy = -BRUSH; dy <= BRUSH; dy++) {
    for (let dx = -BRUSH; dx <= BRUSH; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue;
      if (el !== WALL && g[y][x] === WALL) continue; // don't paint over walls (except walls)
      g[y][x] = el;
    }
  }
}

function zoneSand(g, goalRow) {
  let n = 0;
  for (let y = goalRow; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (g[y][x] === SAND) n++;
  return n;
}

export default {
  key: "sand",
  meta: { label: "Sandbox Physics", keywords: ["sand","physics","falling","elements","water","toy"], dailyMode: "solve" },
  schema: {
    flow:      { type:"number", min:1,  max:6,   default:4 },
    fillDepth: { type:"number", min:4,  max:30,  default:12 },
    quota:     { type:"number", min:10, max:600, default:150 },
    theme:     THEME_FIELD,
    title:     { type:"string", default:"Forge Sand" }
  },
  skill: {
    system: `Configure a falling-sand physics toy with a fill goal. Fields: flow physics speed(1-6),fillDepth target-zone rows(4-30),quota sand grains to settle(10-600),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"cozy sandbox, fill the basin", json:{ flow:5, fillDepth:16, quota:200, theme:"cozy", title:"Sand Basin" } }]
  },
  engine: {
    init(cfg) {
      const grid = seedGrid(seedFromConfig(cfg));
      const goalRow = ROWS - Math.round(cfg.fillDepth);
      return { cfg, cols:COLS, rows:ROWS, cell:CELL, grid, goalRow, brush:SAND, tick:0, score:0, won:false };
    },
    step(s, input, dt) {
      if (s.won) return s;
      // Paint on the initial tap AND every frame the pointer stays held, so a drag
      // streams a continuous stroke instead of a single dab. Element selection
      // (top strip) only fires on a fresh tap so dragging across it doesn't flip
      // the brush mid-stroke.
      if ((input.tap || input.pointerHeld) && Number.isFinite(input.px) && Number.isFinite(input.py)) {
        if (input.py < SWATCH_H) {
          if (input.tap) {
            // Top strip = element palette: pick sand / water / wall by third.
            const pick = Math.floor(input.px / (W / 3));
            s.brush = pick <= 0 ? SAND : pick === 1 ? WATER : WALL;
          }
        } else {
          paint(s.grid, Math.floor(input.px / CELL), Math.floor(input.py / CELL), s.brush);
        }
      }
      const interval = Math.max(1, 7 - s.cfg.flow);
      s.tick += dt;
      while (s.tick >= interval) { s.tick -= interval; s.grid = settle(s.grid); }
      s.score = zoneSand(s.grid, s.goalRow);
      if (s.score >= s.cfg.quota) s.won = true;
      return s;
    },
    status(s) { return { score:s.score, over:false, won:s.won }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      const colorOf = { [SAND]:pal.accent, [WATER]:pal.particles, [WALL]:pal.fg };
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const v = s.grid[y][x];
          if (v) { ctx.fillStyle = colorOf[v]; ctx.fillRect(x * CELL, y * CELL, CELL, CELL); }
        }
      }
      // Target fill line (vector, no text).
      ctx.save();
      ctx.globalAlpha = 0.5; ctx.fillStyle = pal.hud;
      ctx.fillRect(0, s.goalRow * CELL, W, 2);
      // Element palette swatches; the selected one gets a bright frame.
      const swatch = [{ el:SAND, c:pal.accent }, { el:WATER, c:pal.particles }, { el:WALL, c:pal.fg }];
      ctx.globalAlpha = 1;
      for (let i = 0; i < 3; i++) {
        const x = i * (W / 3);
        if (s.brush === swatch[i].el) { ctx.fillStyle = pal.hud; ctx.fillRect(x + 1, 1, W / 3 - 2, SWATCH_H - 2); } // selected frame
        ctx.fillStyle = swatch[i].c;
        ctx.fillRect(x + 4, 4, W / 3 - 8, SWATCH_H - 8);
      }
      ctx.restore();
    }
  }
};
