import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";
import { hashSeed, makeRand } from "./raycast-core.js";

const W = 400, H = 600;
const THEME_CHOICES = THEME_IDS.join("|");
// Hunter cadence: it takes one maze step every HUNT_PERIOD dt-units, so a moving
// player (one cell per key press) easily outpaces it toward the exit, but a player
// who dawdles gets caught — a genuine losing path. Higher = easier.
const HUNT_PERIOD = 14;

// Recursive-backtracker on odd cells → a PERFECT maze: every floor cell reaches
// every other, so the exit is always solvable, and the layout is genuinely
// branching (not the old row-1 + last-col freeway). `rand` is the seeded LCG from
// raycast-core, so the maze varies by seed/title and is fully deterministic.
function makeMaze(n, rand) {
  const grid = Array.from({ length: n }, () => new Array(n).fill(true));
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

// One BFS step from `from` toward `to` over floor cells (fixed neighbour order →
// deterministic). Returns the next cell on a shortest path, or `from` if blocked.
function nextStep(grid, from, to) {
  const n = grid.length;
  const key = (x, y) => y * n + x;
  const prev = new Map();
  const seen = new Set([key(from.x, from.y)]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur.x === to.x && cur.y === to.y) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || grid[ny][nx]) continue;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      seen.add(k); prev.set(k, cur); queue.push({ x: nx, y: ny });
    }
  }
  let cur = to;
  while (prev.has(key(cur.x, cur.y))) {
    const p = prev.get(key(cur.x, cur.y));
    if (p.x === from.x && p.y === from.y) return cur;
    cur = p;
  }
  return from;
}

export { makeMaze, nextStep };

export default {
  key: "maze",
  meta: { label: "Maze", keywords: ["maze","labyrinth","navigate","path","escape","wall","chase"], dailyMode: "solve" },
  schema: {
    size:    { type:"number", min:6, max:16, default:10 },
    theme:   THEME_FIELD,
    title:   { type:"string", default:"Forge Maze" }
  },
  skill: {
    system: `Configure a seeded grid maze with a chasing hunter — reach the exit before it catches you. Fields: size(6-16),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"retro escape maze with a chaser", json:{ size:10, theme:"retro", title:"Forge Maze" } }]
  },
  engine: {
    init(cfg) {
      const size = Math.round(cfg.size) | 1;   // force odd so the perfect maze fits
      const seed = hashSeed(`${cfg.title}|${cfg.theme}`);
      const grid = makeMaze(size, makeRand(seed));
      grid[1][2] = false;                       // always open east of the start
      return {
        cfg,
        size,
        seed,
        grid,
        player: { x:1, y:1 },
        exit: { x:size - 2, y:size - 2 },
        hunter: { x:size - 2, y:1 },            // far corner floor cell (odd,odd)
        hunterAcc: 0,
        prev: { up:false, down:false, left:false, right:false },
        steps: 0,
        won: false,
        dead: false
      };
    },
    step(s, input, dt) {
      if (s.won || s.dead) return s;
      let dx = 0, dy = 0;
      if (input.up && !s.prev.up) dy = -1;
      else if (input.down && !s.prev.down) dy = 1;
      else if (input.left && !s.prev.left) dx = -1;
      else if (input.right && !s.prev.right) dx = 1;

      if (dx || dy) {
        const x = s.player.x + dx;
        const y = s.player.y + dy;
        if (x >= 0 && x < s.size && y >= 0 && y < s.size && !s.grid[y][x]) {
          s.player = { x, y };
          s.steps++;
        }
      }
      s.prev = { up:!!input.up, down:!!input.down, left:!!input.left, right:!!input.right };

      // Reaching the exit is a terminal win (engine-base loops it into a fresh,
      // harder level) — it beats the hunter regardless of where the hunter is.
      if (s.player.x === s.exit.x && s.player.y === s.exit.y) { s.won = true; return s; }

      // The hunter pursues on its slower cadence; catching the player is the loss.
      s.hunterAcc += dt;
      while (s.hunterAcc >= HUNT_PERIOD) {
        s.hunterAcc -= HUNT_PERIOD;
        s.hunter = nextStep(s.grid, s.hunter, s.player);
        if (s.hunter.x === s.player.x && s.hunter.y === s.player.y) { s.dead = true; break; }
      }
      return s;
    },
    status(s) { return { score:s.steps, over:s.won || s.dead, won:s.won }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      const cell = Math.floor((W - 40) / s.size);
      const ox = Math.floor((W - cell * s.size) / 2);
      const oy = 96;
      for (let y = 0; y < s.size; y++) {
        for (let x = 0; x < s.size; x++) {
          if (s.grid[y][x]) drawShape(ctx, "wall", ox + x * cell + cell / 2, oy + y * cell + cell / 2, cell, pal.accent);
        }
      }
      drawShape(ctx, "flag", ox + s.exit.x * cell + cell / 2, oy + s.exit.y * cell + cell / 2, cell * 0.9, pal.accent);
      drawShape(ctx, "invader", ox + s.hunter.x * cell + cell / 2, oy + s.hunter.y * cell + cell / 2, cell, pal.accent);
      drawShape(ctx, "dot", ox + s.player.x * cell + cell / 2, oy + s.player.y * cell + cell / 2, cell, pal.fg);
    }
  }
};
