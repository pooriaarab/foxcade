import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const TAU = Math.PI * 2;
const GOLDEN = 2.399963229728653; // golden angle (rad) — rings rotate → spiral
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

// Deterministic ring of bullets from the top emitter; each ring rotated by the
// golden angle so the pattern spirals. Pure function of cfg + emitCount → no
// Math.random, no Date.
function emitRing(s) {
  const c = s.cfg;
  const base = s.emitCount * GOLDEN;
  const ex = W / 2, ey = 70;
  for (let i = 0; i < c.waveSize; i++) {
    const a = base + (TAU * i) / c.waveSize;
    s.bullets.push({ x:ex, y:ey, vx:Math.cos(a) * c.bulletSpeed, vy:Math.sin(a) * c.bulletSpeed });
  }
  s.emitCount++;
}

export default {
  key: "bullethell",
  meta: { label: "Bullet Hell", keywords: ["bullet","dodge","danmaku","survive","twin-stick","hell"] },
  schema: {
    bulletSpeed: { type:"number", min:1, max:8,  default:3 },
    fireRate:    { type:"number", min:1, max:10, default:5 },
    waveSize:    { type:"number", min:3, max:16, default:8 },
    playerSpeed: { type:"number", min:3, max:9,  default:5 },
    theme:       THEME_FIELD,
    title:       { type:"string", default:"Forge Barrage" }
  },
  skill: {
    system: `Configure a bullet-hell dodge arena. Fields: bulletSpeed(1-8),fireRate(1-10),waveSize(3-16),playerSpeed(3-9),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"intense neon bullet hell", json:{ bulletSpeed:5, fireRate:8, waveSize:12, playerSpeed:7, theme:"neon", title:"Neon Barrage" } }]
  },
  engine: {
    init(cfg) {
      return {
        cfg,
        x: W / 2,
        y: H - 80,
        bullets: [],
        emitCount: 0,
        fireClock: 0,
        time: 0,
        seed: seedFromConfig(cfg),
        score: 0,
        dead: false
      };
    },
    step(s, input, dt) {
      if (s.dead) return s;
      const move = s.cfg.playerSpeed;
      if (input.left) s.x -= move * dt;
      if (input.right) s.x += move * dt;
      if (input.up) s.y -= move * dt;
      if (input.down) s.y += move * dt;
      s.x = clamp(s.x, 12, W - 12);
      s.y = clamp(s.y, 40, H - 12);

      s.time += dt;
      s.score = Math.floor(s.time / 10); // survival time = score

      s.fireClock += dt;
      const every = Math.max(4, 22 - s.cfg.fireRate * 2);
      if (s.fireClock >= every) {
        s.fireClock -= every;
        emitRing(s);
      }

      for (const b of s.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
      s.bullets = s.bullets.filter(b => b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20);

      for (const b of s.bullets) {
        if (Math.abs(b.x - s.x) < 9 && Math.abs(b.y - s.y) < 9) { s.dead = true; break; }
      }
      return s;
    },
    status(s) { return { score:s.score, over:s.dead, won:false }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      for (const b of s.bullets) drawShape(ctx, "dot", b.x, b.y, 12, pal.accent);
      drawShape(ctx, "ship", s.x, s.y, 26, pal.fg);
    }
  }
};
