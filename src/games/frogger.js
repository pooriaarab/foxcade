import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const CELL = 40;
const COLS = W / CELL;   // 10
const ROWS = H / CELL;   // 15: row 0 = goal, row ROWS-1 = start, rows 1..ROWS-2 = traffic
const LANE_LEN = COLS * CELL;
const THEME_CHOICES = THEME_IDS.join("|");

function seedFromConfig(c) {
  const text = `${c.title}|${c.theme}`;
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed + text.charCodeAt(i) * (i + 1)) % 9973;
  return seed || 1;
}

// One deterministic lane per traffic row: direction alternates, speed + car
// count derive from the seed so the same title/theme always lays out identically.
function makeLanes(seed, cfg) {
  const lanes = [];
  for (let row = 1; row <= ROWS - 2; row++) {
    const h = (seed + row * 37) % 100;
    lanes.push({
      row,
      dir: row % 2 === 0 ? 1 : -1,
      speed: cfg.speed * (0.7 + (h % 5) * 0.12),
      cars: 2 + (h % 3),          // 2..4 cars evenly spaced along the lane
      offset: h % LANE_LEN
    });
  }
  return lanes;
}

// Car x-centers in a lane, wrapped to the lane length. Pure function of offset.
function carPositions(lane) {
  const spacing = LANE_LEN / lane.cars;
  const pos = [];
  for (let k = 0; k < lane.cars; k++) {
    pos.push((((k * spacing + lane.dir * lane.offset) % LANE_LEN) + LANE_LEN) % LANE_LEN);
  }
  return pos;
}

function hitCar(lane, frogCol) {
  const fx = frogCol * CELL + CELL / 2;
  const reach = CELL * 0.7 + CELL * 0.3; // car half-width + frog half-width
  for (const cx of carPositions(lane)) {
    let d = Math.abs(fx - cx);
    d = Math.min(d, LANE_LEN - d);       // shortest distance around the wrap
    if (d < reach) return true;
  }
  return false;
}

function resetFrog() {
  return { x: Math.floor(COLS / 2), y: ROWS - 1 };
}

export default {
  key: "frogger",
  meta: { label: "Road Hopper", keywords: ["cross","traffic","road","frog","lanes","hop","dodge"] },
  // Procedural pixel-art: the hopper becomes a themed hero sprite per card.
  proc: { runner: "player" },
  schema: {
    speed: { type:"number", min:1, max:8, default:3 },
    lives: { type:"number", min:1, max:5, default:3 },
    theme: THEME_FIELD,
    title: { type:"string", default:"Road Hopper" }
  },
  skill: {
    system: `Configure a cross-the-traffic hopper. Fields: speed(1-8),lives(1-5),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"fast neon frogger with 5 lives", json:{ speed:7, lives:5, theme:"neon", title:"Neon Crossing" } }]
  },
  engine: {
    init(cfg) {
      const seed = seedFromConfig(cfg);
      return {
        cfg,
        seed,
        lanes: makeLanes(seed, cfg),
        frog: resetFrog(),
        prev: { up:false, down:false, left:false, right:false },
        lives: Math.round(cfg.lives),
        level: 0,
        score: 0,
        over: false
      };
    },
    step(s, input, dt) {
      if (s.over) return s;
      // Edge-triggered: one grid step per fresh key press.
      const p = s.prev;
      if (input.up && !p.up) s.frog.y = Math.max(0, s.frog.y - 1);
      else if (input.down && !p.down) s.frog.y = Math.min(ROWS - 1, s.frog.y + 1);
      else if (input.left && !p.left) s.frog.x = Math.max(0, s.frog.x - 1);
      else if (input.right && !p.right) s.frog.x = Math.min(COLS - 1, s.frog.x + 1);
      s.prev = { up:!!input.up, down:!!input.down, left:!!input.left, right:!!input.right };

      const boost = 1 + s.level * 0.15;
      for (const lane of s.lanes) lane.offset += lane.speed * boost * dt;

      // Reached the top: score, ramp difficulty, drop back to the start row.
      if (s.frog.y === 0) {
        s.score++;
        s.level++;
        s.frog = resetFrog();
        return s;
      }

      const lane = s.lanes.find(l => l.row === s.frog.y);
      if (lane && hitCar(lane, s.frog.x)) {
        s.lives--;
        s.frog = resetFrog();
        if (s.lives <= 0) s.over = true;
      }
      return s;
    },
    status(s) { return { score:s.score, over:s.over, won:false }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      drawShape(ctx, "flag", W / 2, CELL / 2, CELL, pal.accent);
      for (const lane of s.lanes) {
        const cy = lane.row * CELL + CELL / 2;
        for (const cx of carPositions(lane)) drawShape(ctx, "car", cx, cy, CELL * 0.9, pal.accent);
      }
      drawShape(ctx, "runner", s.frog.x * CELL + CELL / 2, s.frog.y * CELL + CELL / 2, CELL * 0.8, pal.fg);
      ctx.fillStyle = pal.hud; ctx.font = "16px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(`Lives ${s.lives}`, 10, 34);
    }
  }
};
