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
  return seed;
}

function spawnEnemy(seed, count) {
  const edge = (seed + count) % 4;
  const px = 30 + ((seed + count * 73) % (W - 60));
  const py = 40 + ((seed + count * 97) % (H - 80));
  if (edge === 0) return { x:px, y:-24 };
  if (edge === 1) return { x:W + 24, y:py };
  if (edge === 2) return { x:px, y:H + 24 };
  return { x:-24, y:py };
}

export default {
  key: "topdown",
  meta: { label: "Top Gunner", keywords: ["top-down","twin-stick","arena","chase","gunner","survive"] },
  schema: {
    fireRate:   { type:"number", min:1, max:10, default:5 },
    enemySpeed: { type:"number", min:1, max:6,  default:2 },
    spawnRate:  { type:"number", min:1, max:10, default:4 },
    lives:      { type:"number", min:1, max:5,  default:3 },
    theme:      THEME_FIELD,
    title:      { type:"string", default:"Top Gunner" }
  },
  skill: {
    system: `Configure a top-down chase shooter. Fields: fireRate(1-10),enemySpeed(1-6),spawnRate(1-10),lives(1-5),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"neon arena gunner survive aliens", json:{ fireRate:8, enemySpeed:3, spawnRate:7, lives:3, theme:"neon", title:"Neon Gunner" } }]
  },
  engine: {
    init(cfg) {
      const seed = seedFromConfig(cfg);
      return {
        cfg,
        playerX: W / 2,
        playerY: H / 2,
        dirX: 0,
        dirY: -1,
        bullets: [],
        enemies: [spawnEnemy(seed, 0)],
        cooldown: 0,
        spawnClock: 0,
        spawnCount: 1,
        seed,
        lives: cfg.lives,
        score: 0,
        dead: false
      };
    },
    step(s, input, dt) {
      if (s.dead) return s;
      const c = s.cfg;
      let dx = 0, dy = 0;
      if (input.up) dy = -1;
      else if (input.down) dy = 1;
      else if (input.left) dx = -1;
      else if (input.right) dx = 1;

      if (dx || dy) {
        s.dirX = dx;
        s.dirY = dy;
        s.playerX = clamp(s.playerX + dx * 5.5 * dt, 20, W - 20);
        s.playerY = clamp(s.playerY + dy * 5.5 * dt, 50, H - 34);
      }

      s.cooldown = Math.max(0, s.cooldown - dt);
      if (s.cooldown <= 0) {
        s.bullets.push({
          x: s.playerX + s.dirX * 20,
          y: s.playerY + s.dirY * 20,
          dx: s.dirX,
          dy: s.dirY
        });
        s.cooldown = Math.max(4, 16 - c.fireRate);
      }

      s.spawnClock += dt;
      const every = Math.max(12, 82 - c.spawnRate * 7);
      if (s.spawnClock >= every) {
        s.spawnClock = 0;
        s.enemies.push(spawnEnemy(s.seed, s.spawnCount));
        s.spawnCount++;
      }

      for (const b of s.bullets) {
        b.x += b.dx * 10 * dt;
        b.y += b.dy * 10 * dt;
      }

      for (const e of s.enemies) {
        const vx = s.playerX - e.x;
        const vy = s.playerY - e.y;
        const len = Math.max(1, Math.hypot(vx, vy));
        e.x += (vx / len) * c.enemySpeed * dt;
        e.y += (vy / len) * c.enemySpeed * dt;
      }

      for (let bi = s.bullets.length - 1; bi >= 0; bi--) {
        const b = s.bullets[bi];
        let hit = false;
        for (let ei = s.enemies.length - 1; ei >= 0; ei--) {
          const e = s.enemies[ei];
          if (Math.abs(b.x - e.x) < 22 && Math.abs(b.y - e.y) < 24) {
            s.enemies.splice(ei, 1);
            s.bullets.splice(bi, 1);
            s.score++;
            hit = true;
            break;
          }
        }
        if (!hit && (b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30)) s.bullets.splice(bi, 1);
      }

      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        if (Math.abs(e.x - s.playerX) < 28 && Math.abs(e.y - s.playerY) < 30) {
          s.enemies.splice(i, 1);
          s.lives--;
        }
      }
      if (s.lives <= 0) s.dead = true;
      return s;
    },
    status(s) { return { score:s.score, over:s.dead, won:false }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeStyle = "#ffffff33";
      for (let x = 40; x < W; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x, H - 30); ctx.stroke();
      }
      for (let y = 80; y < H; y += 40) {
        ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(W - 20, y); ctx.stroke();
      }
      for (const b of s.bullets) drawShape(ctx, "dot", b.x, b.y, 16, pal.fg);
      for (const e of s.enemies) drawShape(ctx, "invader", e.x, e.y, 30, pal.accent);
      drawShape(ctx, "ship", s.playerX, s.playerY, 32, pal.fg);
      ctx.fillStyle = pal.hud;
      ctx.font = "16px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.fillText(`Lives ${s.lives}`, W - 10, 10);
    }
  }
};
