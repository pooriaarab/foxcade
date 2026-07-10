import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const THEME_CHOICES = THEME_IDS.join("|");

function makeHoles(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const holes = [];
  const startY = rows <= 2 ? 210 : 155;
  const yStep = rows <= 1 ? 0 : 290 / (rows - 1);
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    holes.push({
      x: ((col + 1) * W) / (cols + 1),
      y: startY + row * yStep,
      r: 34
    });
  }
  return holes;
}

function holeAt(state, x, y) {
  for (let i = 0; i < state.holes.length; i++) {
    const h = state.holes[i];
    if (Math.hypot(x - h.x, y - h.y) <= h.r) return i;
  }
  return -1;
}

export default {
  key: "whack",
  meta: { label: "Whack", keywords: ["whack","mole","tap","reaction","hit","click"] },
  schema: {
    moleTime: { type:"number", min:20,  max:120,  default:50 },
    holes:    { type:"number", min:4,   max:12,   default:9 },
    duration: { type:"number", min:300, max:1200, default:600 },
    theme:    THEME_FIELD,
    title:    { type:"string", default:"Forge Whack" }
  },
  skill: {
    system: `Configure a whack-a-target reaction game. Fields: moleTime(20-120),holes(4-12),duration(300-1200),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"quick neon whack a mole", json:{ moleTime:30, holes:9, duration:500, theme:"neon", title:"Neon Whack" } }]
  },
  engine: {
    init(cfg) {
      return {
        cfg,
        holes: makeHoles(Math.round(cfg.holes)),
        active: 0,
        timer: cfg.moleTime,
        score: 0,
        timeLeft: cfg.duration
      };
    },
    step(s, input, dt) {
      if (s.timeLeft <= 0) return s;
      if (input.tap && Number.isFinite(input.px) && Number.isFinite(input.py)) {
        const idx = holeAt(s, input.px, input.py);
        if (idx === s.active) {
          s.score++;
          s.active = (s.active + 1 + s.score) % s.holes.length;
          s.timer = s.cfg.moleTime;
        }
      }
      s.timer -= dt;
      s.timeLeft -= dt;
      if (s.timer <= 0 && s.timeLeft > 0) {
        s.active = (s.active + 3) % s.holes.length;
        s.timer = s.cfg.moleTime;
      }
      if (s.timeLeft < 0) s.timeLeft = 0;
      return s;
    },
    status(s) {
      const over = s.timeLeft <= 0;
      // win only if you actually hit enough targets (one full ring of holes)
      return { score:s.score, over, won:over && s.score >= s.holes.length };
    },
    holeAt,
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      for (let i = 0; i < s.holes.length; i++) {
        const h = s.holes[i];
        drawShape(ctx, "circle", h.x, h.y + 8, h.r, pal.accent);
        if (i === s.active && s.timeLeft > 0) drawShape(ctx, "target", h.x, h.y - 8, h.r, pal.fg);
      }
      ctx.fillStyle = pal.hud;
      ctx.font = "16px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.fillText(`Time ${Math.ceil(s.timeLeft)}`, W - 10, 34);
    }
  }
};
