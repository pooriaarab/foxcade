import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const BALL_R = 8;
const PLAYER_Y = H - 40;   // player paddle: bottom, moves left/right
const AI_Y = 40;           // AI paddle: top
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

// Serve from center; serveDir alternates so play does not favour one side, and
// the vertical direction points at whoever must return it next.
function serve(s, toward) {
  const speed = s.cfg.ballSpeed;
  s.serveDir *= -1;
  s.ball = {
    x: W / 2,
    y: H / 2,
    vx: speed * 0.6 * s.serveDir,
    vy: toward === "player" ? speed : -speed
  };
}

export default {
  key: "pong",
  meta: { label: "Pong", keywords: ["pong","paddle","ball","tennis","classic","bounce"] },
  schema: {
    winScore:    { type:"number", min:3,  max:11,  default:5 },
    ballSpeed:   { type:"number", min:2,  max:8,   default:4 },
    paddleWidth: { type:"number", min:40, max:120, default:70 },
    aiSpeed:     { type:"number", min:1,  max:8,   default:4 },
    theme:       THEME_FIELD,
    title:       { type:"string", default:"Forge Pong" }
  },
  skill: {
    system: `Configure a classic pong duel vs an AI paddle. Fields: winScore(3-11),ballSpeed(2-8),paddleWidth(40-120),aiSpeed(1-8),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"fast neon pong first to 7", json:{ winScore:7, ballSpeed:7, paddleWidth:60, aiSpeed:6, theme:"neon", title:"Neon Rally" } }]
  },
  engine: {
    init(cfg) {
      const s = {
        cfg,
        playerX: W / 2,
        aiX: W / 2,
        serveDir: seedFromConfig(cfg) % 2 === 0 ? 1 : -1,
        ball: null,
        playerScore: 0,
        aiScore: 0
      };
      serve(s, "player");
      return s;
    },
    step(s, input, dt) {
      const c = s.cfg;
      if (s.playerScore >= c.winScore || s.aiScore >= c.winScore) return s;
      const pw = c.paddleWidth;

      const move = (input.left ? -1 : 0) + (input.right ? 1 : 0);
      s.playerX = clamp(s.playerX + move * 8 * dt, pw / 2, W - pw / 2);

      // AI tracks the ball only while it approaches, else drifts to center.
      const target = s.ball.vy < 0 ? s.ball.x : W / 2;
      s.aiX = clamp(s.aiX + clamp(target - s.aiX, -c.aiSpeed * dt, c.aiSpeed * dt), pw / 2, W - pw / 2);

      // Sub-step the ball so no frame moves it more than SUB px — at any ballSpeed
      // × turbo dt it can never skip a paddle band (24px) and tunnel through.
      const b = s.ball;
      const SUB = 6;
      const dist = Math.hypot(b.vx, b.vy) * dt;
      const parts = Math.max(1, Math.ceil(dist / SUB));
      const sdt = dt / parts;
      let scored = false;
      for (let step = 0; step < parts && !scored; step++) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
        if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); }
        if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); }

        // Player paddle (moving down): reflect up, add spin from contact offset.
        if (b.vy > 0 && Math.abs(b.y - PLAYER_Y) < 12 && Math.abs(b.x - s.playerX) < pw / 2 + BALL_R) {
          b.vy = -Math.abs(c.ballSpeed);
          b.vx = ((b.x - s.playerX) / (pw / 2)) * c.ballSpeed;
          b.y = PLAYER_Y - 12;
        }
        // AI paddle (moving up).
        if (b.vy < 0 && Math.abs(b.y - AI_Y) < 12 && Math.abs(b.x - s.aiX) < pw / 2 + BALL_R) {
          b.vy = Math.abs(c.ballSpeed);
          b.vx = ((b.x - s.aiX) / (pw / 2)) * c.ballSpeed;
          b.y = AI_Y + 12;
        }

        if (b.y < 0) { s.playerScore++; if (s.playerScore < c.winScore) serve(s, "ai"); scored = true; }
        else if (b.y > H) { s.aiScore++; if (s.aiScore < c.winScore) serve(s, "player"); scored = true; }
      }
      return s;
    },
    status(s) {
      const c = s.cfg;
      return {
        score: s.playerScore,
        over: s.playerScore >= c.winScore || s.aiScore >= c.winScore,
        won: s.playerScore >= c.winScore
      };
    },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      const pw = s.cfg.paddleWidth;
      // center net
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.strokeStyle = pal.hud; ctx.lineWidth = 2;
      for (let x = 12; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, H / 2); ctx.lineTo(x + 14, H / 2); ctx.stroke(); }
      ctx.restore();
      drawShape(ctx, "paddle", s.aiX, AI_Y, pw / 1.8, pal.accent);
      drawShape(ctx, "paddle", s.playerX, PLAYER_Y, pw / 1.8, pal.fg);
      drawShape(ctx, "circle", s.ball.x, s.ball.y, BALL_R * 2, pal.fg);
    }
  }
};
