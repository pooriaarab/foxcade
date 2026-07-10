import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const BALL_R = 8;
const POWERUP_EVERY = 4;
const WIDE_TIME = 420;
const THEME_CHOICES = THEME_IDS.join("|");

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function levelSpeed(cfg, level) {
  return cfg.ballSpeed + (level - 1) * 0.7;
}

function makeBall(cfg, level, dir = 1) {
  const speed = levelSpeed(cfg, level);
  return { x:W / 2, y:H - 120, vx:speed * 0.7 * dir, vy:-speed };
}

function powerupType(score) {
  return Math.floor(score / POWERUP_EVERY) % 2 === 0 ? "wide" : "multiball";
}

function makeBricks(rows, cols, level = 1) {
  const gap = 6;
  const margin = 22;
  const bw = (W - margin * 2 - gap * (cols - 1)) / cols;
  const bh = 24;
  const bricks = [];
  const pattern = (level - 1) % 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pattern === 1 && (r + c) % 2 === 1) continue;
      if (pattern === 2 && r > 0 && c % 3 === level % 3) continue;
      bricks.push({
        x: margin + bw / 2 + c * (bw + gap),
        y: 80 + r * (bh + gap),
        w: bw,
        h: bh
      });
    }
  }
  return bricks;
}

function syncBalls(s) {
  if (!s.balls || s.balls.length === 0) {
    s.balls = [s.ball];
  } else if (s.ball && s.balls[0] !== s.ball) {
    s.balls[0] = s.ball;
  }
  s.ball = s.balls[0];
}

function paddleWidth(s) {
  return s.cfg.paddleWidth * (s.wideTimer > 0 ? 1.45 : 1);
}

function advanceLevel(s) {
  s.level++;
  const dir = s.ball && s.ball.vx < 0 ? -1 : 1;
  const ball = makeBall(s.cfg, s.level, dir);
  s.ball = ball;
  s.balls = [ball];
  s.bricks = makeBricks(Math.round(s.cfg.rows), Math.round(s.cfg.cols), s.level);
  s.powerups = [];
  s.won = false;
}

export default {
  key: "breakout",
  meta: { label: "Breakout", keywords: ["brick","paddle","ball","break","bounce","arkanoid"] },
  schema: {
    ballSpeed:   { type:"number", min:2,  max:9,   default:4 },
    paddleWidth: { type:"number", min:40, max:140, default:80 },
    rows:        { type:"number", min:2,  max:8,   default:4 },
    cols:        { type:"number", min:4,  max:12,  default:8 },
    powerups:    { type:"string", enum:["on","off"], default:"on" },
    theme:       THEME_FIELD,
    title:       { type:"string", default:"Forge Breakout" }
  },
  skill: {
    system: `Configure a breakout game. Fields: ballSpeed(2-9),paddleWidth(40-140),rows(2-8),cols(4-12),powerups(on|off),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"neon brick breaker with a fast ball", json:{ ballSpeed:7, paddleWidth:70, rows:5, cols:9, powerups:"on", theme:"neon", title:"Neon Breaker" } }]
  },
  engine: {
    init(cfg) {
      const ball = makeBall(cfg, 1);
      return {
        cfg,
        paddleX: W / 2,
        ball,
        balls: [ball],
        bricks: makeBricks(Math.round(cfg.rows), Math.round(cfg.cols), 1),
        powerups: [],
        wideTimer: 0,
        level: 1,
        score: 0,
        over: false,
        won: false
      };
    },
    step(s, input, dt) {
      if (s.over) return s;
      const c = s.cfg;
      if (typeof s.level !== "number") s.level = 1;
      if (typeof s.wideTimer !== "number") s.wideTimer = 0;
      if (!s.powerups) s.powerups = [];
      syncBalls(s);
      if (s.bricks.length === 0) {
        advanceLevel(s);
        return s;
      }
      s.wideTimer = Math.max(0, s.wideTimer - dt);
      const currentPaddleWidth = paddleWidth(s);
      const move = (input.left ? -1 : 0) + (input.right ? 1 : 0);
      s.paddleX = clamp(s.paddleX + move * 8 * dt, currentPaddleWidth / 2, W - currentPaddleWidth / 2);

      for (const p of s.powerups) p.y += 3 * dt;

      const paddleY = H - 48;
      // Sub-step every ball so no single frame moves it more than SUB px — at any
      // ball speed × level ramp × turbo dt it can never skip the paddle band (24px)
      // or a brick and tunnel through. SUB < that band guarantees a sampled hit.
      const SUB = 6;
      for (const b of s.balls) {
        const dist = Math.hypot(b.vx, b.vy) * dt;
        const parts = Math.max(1, Math.ceil(dist / SUB));
        const sdt = dt / parts;
        for (let step = 0; step < parts; step++) {
          b.x += b.vx * sdt;
          b.y += b.vy * sdt;
          if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); }
          if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); }
          if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); }

          if (b.vy > 0 && Math.abs(b.y - paddleY) < 12 && Math.abs(b.x - s.paddleX) < currentPaddleWidth / 2 + BALL_R) {
            const hit = (b.x - s.paddleX) / (currentPaddleWidth / 2);
            const speed = levelSpeed(c, s.level);
            b.vx = hit * speed;
            b.vy = -Math.abs(speed);
            b.y = paddleY - 12;
          }

          for (let i = s.bricks.length - 1; i >= 0; i--) {
            const brick = s.bricks[i];
            if (Math.abs(b.x - brick.x) <= brick.w / 2 + BALL_R && Math.abs(b.y - brick.y) <= brick.h / 2 + BALL_R) {
              s.bricks.splice(i, 1);
              s.score++;
              if (c.powerups !== "off" && s.score % POWERUP_EVERY === 0) s.powerups.push({ x:brick.x, y:brick.y, type:powerupType(s.score) });
              b.vy *= -1;
              break;
            }
          }
          if (b.y > H + 10) break; // fell past the bottom — stop sub-stepping this ball
        }
      }

      for (let i = s.powerups.length - 1; i >= 0; i--) {
        const p = s.powerups[i];
        if (Math.abs(p.y - paddleY) < 16 && Math.abs(p.x - s.paddleX) < currentPaddleWidth / 2 + 16) {
          if (p.type === "multiball") {
            const source = s.balls[0] || makeBall(c, s.level);
            const speed = levelSpeed(c, s.level);
            s.balls.push({ x:source.x, y:source.y, vx:source.vx === 0 ? speed * 0.7 : -source.vx, vy:source.vy });
          } else {
            s.wideTimer = WIDE_TIME;
          }
          s.powerups.splice(i, 1);
        } else if (p.y > H + 20) {
          s.powerups.splice(i, 1);
        }
      }

      s.balls = s.balls.filter(ball => ball.y <= H + 10);
      if (s.balls.length === 0) s.over = true;
      else s.ball = s.balls[0];
      if (!s.over && s.bricks.length === 0) advanceLevel(s);
      return s;
    },
    status(s) { return { score:s.score, over:s.over, won:false }; },
    draw(ctx, s, palette) {
      const c = s.cfg;
      const pal = palette || getPalette(c.theme);
      for (const brick of s.bricks) drawShape(ctx, "brick", brick.x, brick.y, Math.min(brick.w / 1.3, brick.h / 0.56), pal.accent);
      for (const p of s.powerups || []) drawShape(ctx, p.type === "multiball" ? "target" : "diamond", p.x, p.y, 18, pal.accent);
      drawShape(ctx, "paddle", s.paddleX, H - 37, paddleWidth(s) / 1.8, pal.fg);
      for (const ball of s.balls || [s.ball]) drawShape(ctx, "circle", ball.x, ball.y, BALL_R * 2, pal.fg);
    }
  }
};
