import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const THEME_CHOICES = THEME_IDS.join("|");

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function seedFromConfig(c) {
  const text = `${c.title}|${c.theme}`;
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed + text.charCodeAt(i) * (i + 1)) % 9973;
  return seed || 1;
}

// Escalation is a pure function of elapsed ticks so it's testable and deterministic.
// The longer you survive, the tighter the spawn interval and the faster hazards
// fall — memorising a fixed pattern no longer carries you.
export function spawnInterval(cfg, ticks) {
  const base = Math.max(8, 70 - cfg.spawnRate * 5);
  return Math.max(6, base - Math.floor(ticks / 260));
}
export function fallSpeedAt(cfg, ticks) {
  return Math.min(cfg.fallSpeed * 2.2, cfg.fallSpeed * (1 + ticks / 1800));
}

export default {
  key: "dodger",
  meta: { label: "Dodger", keywords: ["dodge","avoid","falling","survive","rain","escape"] },
  // Procedural pixel-art: falling hazards become themed creatures, the player a
  // little hero. Deterministic per card, restyled by theme. Vector if headless.
  proc: { spike: "invader", runner: "player" },
  schema: {
    spawnRate:   { type:"number", min:1, max:10, default:4 },
    fallSpeed:   { type:"number", min:1, max:9,  default:3 },
    playerSpeed: { type:"number", min:3, max:10, default:6 },
    theme:       THEME_FIELD,
    title:       { type:"string", default:"Forge Dodger" }
  },
  skill: {
    system: `Configure a falling-hazard dodger. Fields: spawnRate(1-10),fallSpeed(1-9),playerSpeed(3-10),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"survive neon lightning rain", json:{ spawnRate:7, fallSpeed:5, playerSpeed:7, theme:"neon", title:"Storm Run" } }]
  },
  engine: {
    init(cfg) {
      return {
        cfg,
        playerX: W / 2,
        hazards: [],
        spawnClock: 0,
        spawnCount: 0,
        rng: seedFromConfig(cfg),
        ticks: 0,
        dead: false
      };
    },
    step(s, input, dt) {
      if (s.dead) return s;
      const c = s.cfg;
      const move = (input.left ? -1 : 0) + (input.right ? 1 : 0);
      s.playerX = clamp(s.playerX + move * c.playerSpeed * dt, 18, W - 18);
      s.ticks += dt;
      s.spawnClock += dt;
      if (s.spawnClock >= spawnInterval(c, s.ticks)) {
        s.spawnClock = 0;
        // Seeded x (LCG, no Math.random) → each title/theme drops a different
        // pattern instead of the old fixed sweep. Later waves drop two at once.
        s.rng = (s.rng * 1103515245 + 12345) & 0x7fffffff;
        s.hazards.push({ x:24 + (s.rng % (W - 48)), y:-20 });
        if (s.ticks > 900) {
          s.rng = (s.rng * 1103515245 + 12345) & 0x7fffffff;
          s.hazards.push({ x:24 + (s.rng % (W - 48)), y:-20 });
        }
        s.spawnCount++;
      }
      const fall = fallSpeedAt(c, s.ticks);
      for (const h of s.hazards) h.y += fall * dt;
      const playerY = H - 60;
      for (const h of s.hazards) {
        if (Math.abs(h.x - s.playerX) < 24 && Math.abs(h.y - playerY) < 30) s.dead = true;
      }
      s.hazards = s.hazards.filter(h => h.y < H + 40);
      return s;
    },
    status(s) { return { score:Math.floor(s.ticks / 10), over:s.dead, won:false }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      for (const h of s.hazards) drawShape(ctx, "spike", h.x, h.y, 30, pal.accent);
      drawShape(ctx, "runner", s.playerX, H - 60, 30, pal.fg);
    }
  }
};
