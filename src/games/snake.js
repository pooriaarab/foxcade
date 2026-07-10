import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

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

// Deterministic LCG — advances s.rng, returns a non-negative int. No Math.random.
function nextRand(s) {
  s.rng = (s.rng * 1103515245 + 12345) & 0x7fffffff;
  return s.rng;
}

// Place food on the k-th free cell: guaranteed to terminate and fully
// deterministic even when the board is nearly full.
function placeFood(s) {
  const occupied = new Set(s.snake.map(p => p.y * COLS + p.x));
  const free = COLS * ROWS - occupied.size;
  if (free <= 0) { s.food = null; return; }
  let k = nextRand(s) % free;
  for (let idx = 0; idx < COLS * ROWS; idx++) {
    if (occupied.has(idx)) continue;
    if (k-- === 0) { s.food = { x: idx % COLS, y: Math.floor(idx / COLS) }; return; }
  }
}

export default {
  key: "snake",
  meta: { label: "Snake", keywords: ["snake","grid","tail","food","classic","nokia"] },
  schema: {
    speed:  { type:"number", min:1, max:10, default:6 },
    growth: { type:"number", min:1, max:5,  default:1 },
    theme:  THEME_FIELD,
    title:  { type:"string", default:"Forge Snake" }
  },
  skill: {
    system: `Configure a grid snake. Fields: speed(1-10),growth(1-5),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"fast neon snake", json:{ speed:9, growth:1, theme:"neon", title:"Neon Serpent" } }]
  },
  engine: {
    init(cfg) {
      const cx = Math.floor(COLS / 2), cy = Math.floor(ROWS / 2);
      const s = {
        cfg,
        cols: COLS, rows: ROWS,
        snake: [{ x:cx, y:cy }, { x:cx - 1, y:cy }, { x:cx - 2, y:cy }],
        dir: { x:1, y:0 },
        pending: { x:1, y:0 },
        rng: seedFromConfig(cfg),
        tick: 0,
        score: 0,
        dead: false,
        won: false
      };
      placeFood(s);
      return s;
    },
    step(s, input, dt) {
      if (s.dead || s.won) return s;
      const interval = Math.max(2, 12 - s.cfg.speed);
      // Queue a turn; block 180° reversals into the neck.
      if (input.up && s.dir.y === 0) s.pending = { x:0, y:-1 };
      else if (input.down && s.dir.y === 0) s.pending = { x:0, y:1 };
      else if (input.left && s.dir.x === 0) s.pending = { x:-1, y:0 };
      else if (input.right && s.dir.x === 0) s.pending = { x:1, y:0 };

      s.tick += dt;
      if (s.tick < interval) return s;
      s.tick -= interval;

      s.dir = s.pending;
      const head = s.snake[0];
      const nx = head.x + s.dir.x, ny = head.y + s.dir.y;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) { s.dead = true; return s; }

      const eating = s.food && nx === s.food.x && ny === s.food.y;
      // The tail cell vacates this tick unless we grow, so it is not a collision.
      const body = eating ? s.snake : s.snake.slice(0, -1);
      if (body.some(p => p.x === nx && p.y === ny)) { s.dead = true; return s; }

      s.snake.unshift({ x:nx, y:ny });
      if (eating) {
        s.score++;
        const tail = s.snake[s.snake.length - 1];
        for (let i = 1; i < s.cfg.growth; i++) s.snake.push({ ...tail });
        if (s.snake.length >= COLS * ROWS) { s.won = true; s.food = null; return s; }
        placeFood(s);
      } else {
        s.snake.pop();
      }
      return s;
    },
    status(s) { return { score:s.score, over:s.dead, won:s.won }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      if (s.food) drawShape(ctx, "target", s.food.x * CELL + CELL / 2, s.food.y * CELL + CELL / 2, CELL, pal.accent);
      s.snake.forEach((p, i) => {
        drawShape(ctx, "block", p.x * CELL + CELL / 2, p.y * CELL + CELL / 2, CELL - (i === 0 ? 1 : 3), pal.fg);
      });
    }
  }
};
