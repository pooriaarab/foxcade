import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const N = 4;
const WIN = 2048;
const THEME_CHOICES = THEME_IDS.join("|");

function seedFromConfig(c) {
  const text = `${c.title}|${c.theme}`;
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed + text.charCodeAt(i) * (i + 1)) % 9973;
  return seed || 1;
}

function nextRand(s) {
  s.rng = (s.rng * 1103515245 + 12345) & 0x7fffffff;
  return s.rng;
}

// Deterministic spawn on the k-th free cell; value is 2 (usually) or 4 (1-in-10).
function spawnTile(s) {
  const empties = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (s.grid[y][x] === 0) empties.push([x, y]);
  if (empties.length === 0) return;
  const [x, y] = empties[nextRand(s) % empties.length];
  s.grid[y][x] = nextRand(s) % 10 === 0 ? 4 : 2;
}

// Slide a 4-line toward index 0, merging equal neighbours once. Merges add their
// resulting value to the score.
function slideLine(line, s) {
  const nums = line.filter(v => v !== 0);
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
      const merged = nums[i] * 2;
      out.push(merged);
      s.score += merged;
      i++;
    } else out.push(nums[i]);
  }
  while (out.length < N) out.push(0);
  return out;
}

// Apply a move in a direction; returns true if the board changed.
function move(s, dir) {
  const g = s.grid;
  const before = g.map(r => r.slice());
  for (let i = 0; i < N; i++) {
    let line;
    if (dir === "left") line = g[i].slice();
    else if (dir === "right") line = g[i].slice().reverse();
    else if (dir === "up") line = [g[0][i], g[1][i], g[2][i], g[3][i]];
    else line = [g[3][i], g[2][i], g[1][i], g[0][i]]; // down
    const slid = slideLine(line, s);
    for (let j = 0; j < N; j++) {
      const val = slid[j];
      if (dir === "left") g[i][j] = val;
      else if (dir === "right") g[i][N - 1 - j] = val;
      else if (dir === "up") g[j][i] = val;
      else g[N - 1 - j][i] = val;
    }
  }
  return before.some((r, i) => r.some((v, j) => v !== g[i][j]));
}

function hasMoves(s) {
  const g = s.grid;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (g[y][x] === 0) return true;
    if (x + 1 < N && g[y][x] === g[y][x + 1]) return true;
    if (y + 1 < N && g[y][x] === g[y + 1][x]) return true;
  }
  return false;
}

export default {
  key: "twenty48",
  meta: { label: "2048", keywords: ["2048","merge","slide","tiles","numbers","puzzle"] },
  schema: {
    theme: THEME_FIELD,
    title: { type:"string", default:"Forge 2048" }
  },
  skill: {
    system: `Configure a 2048 slide-merge tile puzzle. Fields: theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"neon 2048 number merge", json:{ theme:"neon", title:"Neon Merge" } }]
  },
  engine: {
    init(cfg) {
      const s = {
        cfg,
        grid: Array.from({ length: N }, () => new Array(N).fill(0)),
        rng: seedFromConfig(cfg),
        prev: { up:false, down:false, left:false, right:false },
        score: 0,
        won: false,
        over: false
      };
      spawnTile(s);
      spawnTile(s);
      return s;
    },
    step(s, input, dt) {
      if (s.over || s.won) return s;
      const p = s.prev;
      let dir = null;
      if (input.up && !p.up) dir = "up";
      else if (input.down && !p.down) dir = "down";
      else if (input.left && !p.left) dir = "left";
      else if (input.right && !p.right) dir = "right";
      s.prev = { up:!!input.up, down:!!input.down, left:!!input.left, right:!!input.right };

      if (dir && move(s, dir)) {
        spawnTile(s);
        if (s.grid.some(r => r.some(v => v >= WIN))) s.won = true;
      }
      if (!hasMoves(s)) s.over = true;
      return s;
    },
    status(s) { return { score:s.score, over:s.over, won:s.won }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      const CELL = 88, GAP = 8;
      const board = N * CELL;
      const ox = (W - board) / 2, oy = (H - board) / 2;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const v = s.grid[y][x];
        const cx = ox + x * CELL + CELL / 2, cy = oy + y * CELL + CELL / 2;
        drawShape(ctx, "block", cx, cy, CELL - GAP, v ? pal.fg : pal.accent);
        if (v) {
          ctx.fillStyle = pal.bg;
          ctx.font = `bold ${v >= 1024 ? 22 : 30}px monospace`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(String(v), cx, cy);
        }
      }
    }
  }
};
