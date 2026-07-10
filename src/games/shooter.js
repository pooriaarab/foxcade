import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const POWERUP_EVERY = 3;
const POWERUP_TIME = 360;
const THEME_CHOICES = THEME_IDS.join("|");

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function makeWave(size, wave = 1) {
  const cols = Math.min(size, 6);
  const enemies = [];
  for (let i = 0; i < size; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    enemies.push({
      x: (W / (cols + 1)) * (col + 1),
      y: 70 + row * 42 + (wave - 1) * 8,
      hp: 1,
      boss: false
    });
  }
  return enemies;
}

function makeBoss(wave) {
  return [{
    x: W / 2,
    y: 94 + (wave % 2) * 18,
    hp: 4 + Math.floor(wave / 2),
    boss: true
  }];
}

function makeEnemies(cfg, wave) {
  const bossEvery = cfg.bossEvery || 5;
  return wave > 0 && wave % bossEvery === 0 ? makeBoss(wave) : makeWave(cfg.waveSize, wave);
}

function powerupType(kills) {
  return Math.floor(kills / POWERUP_EVERY) % 2 === 0 ? "spread" : "rapid";
}

export default {
  key: "shooter",
  meta: { label: "Space Shooter", keywords: ["shoot","space","laser","invader","asteroid","ship"] },
  schema: {
    fireRate:   { type:"number", min:1, max:10, default:4 },
    enemySpeed: { type:"number", min:1, max:8,  default:3 },
    waveSize:   { type:"number", min:3, max:12, default:6 },
    lives:      { type:"number", min:1, max:5,  default:3 },
    bossEvery:  { type:"number", min:3, max:10, default:5 },
    theme:      THEME_FIELD,
    title:      { type:"string", default:"Forge Shooter" }
  },
  skill: {
    system: `Configure a space shooter. Fields: fireRate(1-10),enemySpeed(1-8),waveSize(3-12),lives(1-5),bossEvery(3-10),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"fast neon space shooter with asteroids", json:{ fireRate:8, enemySpeed:4, waveSize:7, lives:3, bossEvery:5, theme:"neon", title:"Asteroid Blitz" } }]
  },
  engine: {
    init(cfg) {
      return {
        cfg,
        playerX: W / 2,
        bullets: [],
        enemies: makeEnemies(cfg, 1),
        cooldown: 0,
        lives: cfg.lives,
        score: 0,
        wave: 1,
        kills: 0,
        powerups: [],
        powerType: "",
        powerTimer: 0,
        dead: false
      };
    },
    step(s, input, dt) {
      if (s.dead) return s;
      const c = s.cfg;
      if (!s.powerups) s.powerups = [];
      if (typeof s.kills !== "number") s.kills = 0;
      if (typeof s.powerTimer !== "number") s.powerTimer = 0;
      if (typeof s.powerType !== "string") s.powerType = "";
      const move = (input.left ? -1 : 0) + (input.right ? 1 : 0);
      s.playerX = clamp(s.playerX + move * 7 * dt, 18, W - 18);
      s.cooldown = Math.max(0, s.cooldown - dt);
      if (s.powerTimer > 0) {
        s.powerTimer = Math.max(0, s.powerTimer - dt);
        if (s.powerTimer === 0) s.powerType = "";
      }
      if (input.fire && s.cooldown <= 0) {
        const spread = s.powerType === "spread" ? [-3, 0, 3] : [0];
        for (const vx of spread) s.bullets.push({ x:s.playerX, y:H - 70, vx });
        const baseCooldown = Math.max(3, 16 - c.fireRate);
        s.cooldown = s.powerType === "rapid" ? Math.max(2, baseCooldown / 2) : baseCooldown;
      }

      for (const b of s.bullets) {
        b.x += (b.vx || 0) * dt;
        b.y -= 10 * dt;
      }
      for (const e of s.enemies) e.y += c.enemySpeed * dt;
      for (const p of s.powerups) p.y += 2.5 * dt;

      for (let bi = s.bullets.length - 1; bi >= 0; bi--) {
        const b = s.bullets[bi];
        let hit = false;
        for (let ei = s.enemies.length - 1; ei >= 0; ei--) {
          const e = s.enemies[ei];
          if (Math.abs(b.x - e.x) < 20 && Math.abs(b.y - e.y) < 24) {
            e.hp = (e.hp || 1) - 1;
            s.bullets.splice(bi, 1);
            if (e.hp <= 0) {
              s.enemies.splice(ei, 1);
              s.kills++;
              s.score += e.boss ? 5 : 1;
              if (s.kills % POWERUP_EVERY === 0) s.powerups.push({ x:e.x, y:e.y, type:powerupType(s.kills) });
            }
            hit = true;
            break;
          }
        }
        if (!hit && b.y < -20) s.bullets.splice(bi, 1);
      }

      for (let i = s.powerups.length - 1; i >= 0; i--) {
        const p = s.powerups[i];
        if (Math.abs(p.x - s.playerX) < 26 && Math.abs(p.y - (H - 44)) < 30) {
          s.powerType = p.type;
          s.powerTimer = POWERUP_TIME;
          s.powerups.splice(i, 1);
        } else if (p.y > H + 20) {
          s.powerups.splice(i, 1);
        }
      }

      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        const touchesPlayer = Math.abs(e.x - s.playerX) < 28 && Math.abs(e.y - (H - 48)) < 30;
        if (e.y > H - 30 || touchesPlayer) {
          s.enemies.splice(i, 1);
          s.lives--;
        }
      }
      if (s.lives <= 0) s.dead = true;
      if (!s.dead && s.enemies.length === 0) {
        s.wave++;
        s.enemies = makeEnemies(c, s.wave);
      }
      return s;
    },
    status(s) { return { score:s.score, over:s.dead, won:false }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const b of s.bullets) drawShape(ctx, "dot", b.x, b.y, 12, pal.fg);
      for (const p of s.powerups || []) drawShape(ctx, "target", p.x, p.y, 20, p.type === "rapid" ? pal.fg : pal.accent);
      for (const e of s.enemies) drawShape(ctx, "invader", e.x, e.y, e.boss ? 48 : 28, pal.accent);
      drawShape(ctx, "ship", s.playerX, H - 44, 32, pal.fg);
      ctx.fillStyle = pal.hud;
      ctx.font = "16px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.fillText(`Lives ${s.lives}`, W - 10, 10);
    }
  }
};
