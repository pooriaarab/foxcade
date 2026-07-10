import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400;
const H = 600;
const THEME_CHOICES = THEME_IDS.join("|");
const DIRS = [
  { x:1, y:0 },
  { x:-1, y:0 },
  { x:0, y:1 },
  { x:0, y:-1 }
];

function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRand(seed) {
  let value = seed || 1;
  return max => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return max > 0 ? value % max : 0;
  };
}

function makeWallGrid(size) {
  const grid = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) row.push(true);
    grid.push(row);
  }
  return grid;
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function carve(grid, x, y) {
  if (y > 0 && y < grid.length - 1 && x > 0 && x < grid.length - 1) grid[y][x] = false;
}

function carveCorridor(grid, from, to, verticalFirst) {
  let x = from.x;
  let y = from.y;
  carve(grid, x, y);
  const walkX = () => {
    while (x !== to.x) {
      x += x < to.x ? 1 : -1;
      carve(grid, x, y);
    }
  };
  const walkY = () => {
    while (y !== to.y) {
      y += y < to.y ? 1 : -1;
      carve(grid, x, y);
    }
  };
  if (verticalFirst) {
    walkY();
    walkX();
  } else {
    walkX();
    walkY();
  }
}

function chooseCells(size, count, rand, reserved) {
  const cells = [];
  let attempts = 0;
  while (cells.length < count && attempts < size * size * 4) {
    const cell = { x:1 + rand(size - 2), y:1 + rand(size - 2) };
    const key = cellKey(cell);
    if (!reserved.has(key)) {
      reserved.add(key);
      cells.push(cell);
    }
    attempts++;
  }
  for (let y = 1; y < size - 1 && cells.length < count; y++) {
    for (let x = 1; x < size - 1 && cells.length < count; x++) {
      const cell = { x, y };
      const key = cellKey(cell);
      if (!reserved.has(key)) {
        reserved.add(key);
        cells.push(cell);
      }
    }
  }
  return cells;
}

function addExtraFloors(grid, seed) {
  const size = grid.length;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const value = (Math.imul(x + seed, 31) + Math.imul(y + seed, 17) + x * y) >>> 0;
      if (value % 7 === 0 || value % 11 === 0) grid[y][x] = false;
    }
  }
}

function makeMap(cfg) {
  const size = Math.round(cfg.worldSize);
  const seed = hashSeed(`${cfg.title}|${cfg.theme}`);
  const rand = makeRand(seed);
  const start = { x:1, y:1 };
  const exit = { x:size - 2, y:size - 2 };
  const reserved = new Set([cellKey(start), cellKey(exit)]);
  const pickups = chooseCells(size, Math.round(cfg.pickups), rand, reserved);
  const grid = makeWallGrid(size);
  const route = [start, ...pickups, exit];

  for (let i = 1; i < route.length; i++) carveCorridor(grid, route[i - 1], route[i], ((seed + i) & 1) === 0);
  addExtraFloors(grid, seed);
  carve(grid, start.x, start.y);
  carve(grid, exit.x, exit.y);
  for (const pickup of pickups) carve(grid, pickup.x, pickup.y);

  return { size, seed, grid, start, exit, pickups };
}

function placeHazards(grid, count, seed, reservedCells) {
  const cells = [];
  for (let y = 1; y < grid.length - 1; y++) {
    for (let x = 1; x < grid.length - 1; x++) {
      const key = `${x},${y}`;
      if (!grid[y][x] && !reservedCells.has(key)) cells.push({ x, y });
    }
  }
  const hazards = [];
  let cursor = seed % Math.max(1, cells.length);
  for (let i = 0; i < count && cells.length > 0; i++) {
    cursor = (cursor + 5 + i * 3) % cells.length;
    const cell = cells.splice(cursor, 1)[0];
    const dir = DIRS[(seed + i) % DIRS.length];
    hazards.push({ x:cell.x, y:cell.y, dx:dir.x, dy:dir.y });
  }
  return hazards;
}

function canEnter(grid, x, y) {
  return y >= 0 && y < grid.length && x >= 0 && x < grid.length && !grid[y][x];
}

function touchesHazard(player, hazards) {
  return hazards.some(hazard => hazard.x === player.x && hazard.y === player.y);
}

function moveHazards(grid, hazards) {
  return hazards.map(hazard => {
    let dx = hazard.dx;
    let dy = hazard.dy;
    let x = hazard.x + dx;
    let y = hazard.y + dy;
    if (!canEnter(grid, x, y)) {
      dx *= -1;
      dy *= -1;
      x = hazard.x + dx;
      y = hazard.y + dy;
    }
    if (!canEnter(grid, x, y)) {
      x = hazard.x;
      y = hazard.y;
    }
    return { x, y, dx, dy };
  });
}

function collectPickups(s) {
  const pickups = s.pickups.filter(pickup => pickup.x !== s.player.x || pickup.y !== s.player.y);
  return {
    pickups,
    collected:s.collected + (s.pickups.length - pickups.length)
  };
}

export default {
  key: "explore",
  meta: { label: "Explorer", keywords: ["explore","adventure","world","dungeon","collect","top-down","zelda"], dailyMode: "solve" },
  // Procedural pixel-art: hero, loot gems, and hazard creatures per card, themed.
  proc: { runner: "player", target: "pickup", spike: "invader" },
  schema: {
    worldSize: { type:"number", min:8,  max:16, default:12 },
    pickups:   { type:"number", min:3,  max:10, default:5 },
    hazards:   { type:"number", min:0,  max:4,  default:2 },
    theme:     THEME_FIELD,
    title:     { type:"string", default:"Explorer" }
  },
  skill: {
    system: `Configure a deterministic top-down exploration dungeon. Fields: worldSize(8-16),pickups(3-10),hazards(0-4),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"retro dungeon adventure with five treasures", json:{ worldSize:12, pickups:5, hazards:2, theme:"retro", title:"Explorer" } }]
  },
  engine: {
    init(cfg) {
      const map = makeMap(cfg);
      const reserved = new Set([cellKey(map.start), cellKey(map.exit), ...map.pickups.map(cellKey)]);
      return {
        cfg,
        size:map.size,
        seed:map.seed,
        grid:map.grid,
        player:{ ...map.start },
        exit:{ ...map.exit },
        pickups:map.pickups.map(pickup => ({ ...pickup })),
        hazards:placeHazards(map.grid, Math.round(cfg.hazards), map.seed, reserved),
        prev:{ up:false, down:false, left:false, right:false },
        hazardClock:0,
        collected:0,
        steps:0,
        dead:false,
        won:false
      };
    },
    step(s, input, dt) {
      if (s.dead || s.won) return s;
      const next = {
        ...s,
        player:{ ...s.player },
        exit:{ ...s.exit },
        pickups:s.pickups.map(pickup => ({ ...pickup })),
        hazards:s.hazards.map(hazard => ({ ...hazard })),
        prev:{ ...s.prev }
      };
      let dx = 0;
      let dy = 0;
      if (input.up && !s.prev.up) dy = -1;
      else if (input.down && !s.prev.down) dy = 1;
      else if (input.left && !s.prev.left) dx = -1;
      else if (input.right && !s.prev.right) dx = 1;

      if (dx || dy) {
        const x = next.player.x + dx;
        const y = next.player.y + dy;
        if (canEnter(next.grid, x, y)) {
          next.player = { x, y };
          next.steps++;
        }
      }

      let collected = collectPickups(next);
      next.pickups = collected.pickups;
      next.collected = collected.collected;

      if (touchesHazard(next.player, next.hazards)) next.dead = true;
      next.hazardClock += dt;
      const moves = Math.min(4, Math.floor(next.hazardClock / 18));
      next.hazardClock -= moves * 18;
      for (let i = 0; i < moves && !next.dead; i++) {
        next.hazards = moveHazards(next.grid, next.hazards);
        if (touchesHazard(next.player, next.hazards)) next.dead = true;
      }

      collected = collectPickups(next);
      next.pickups = collected.pickups;
      next.collected = collected.collected;
      next.prev = { up:!!input.up, down:!!input.down, left:!!input.left, right:!!input.right };
      if (!next.dead && next.pickups.length === 0 && next.player.x === next.exit.x && next.player.y === next.exit.y) next.won = true;
      return next;
    },
    status(s) { return { score:s.collected, over:s.dead, won:s.won }; },
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
      for (const pickup of s.pickups) drawShape(ctx, "target", ox + pickup.x * cell + cell / 2, oy + pickup.y * cell + cell / 2, cell * 0.7, pal.fg);
      for (const hazard of s.hazards) drawShape(ctx, "spike", ox + hazard.x * cell + cell / 2, oy + hazard.y * cell + cell / 2, cell * 0.8, pal.accent);
      drawShape(ctx, "runner", ox + s.player.x * cell + cell / 2, oy + s.player.y * cell + cell / 2, cell * 0.85, pal.fg);
    }
  }
};
