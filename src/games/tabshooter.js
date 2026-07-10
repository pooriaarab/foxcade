import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const COLS = 5;
const THEME_CHOICES = THEME_IDS.join("|");

// Fallback targets so the game always plays — feed preview, e2e, or no "tabs"
// permission. Fake tab titles only; NO emoji (labels are plain text UI).
const DEMO_TARGETS = [
  { id: "demo-inbox",   title: "Inbox (12)",     protected: false },
  { id: "demo-docs",    title: "Design Doc",     protected: false },
  { id: "demo-news",    title: "Hacker News",    protected: false },
  { id: "demo-video",   title: "Cat video",      protected: false },
  { id: "demo-shop",    title: "Cart (3)",       protected: false },
  { id: "demo-pinned",  title: "Calendar",       protected: true  },
  { id: "demo-social",  title: "Timeline",       protected: false },
  { id: "demo-search",  title: "Search",         protected: false },
  { id: "demo-self",    title: "foxcade",        protected: true  }
];

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// Lay targets out as invader rows, purely from index (deterministic).
function layout(src) {
  const cols = Math.min(COLS, Math.max(1, src.length));
  return src.map((t, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    return {
      id: t.id,
      title: typeof t.title === "string" && t.title ? t.title : "tab",
      protected: Boolean(t.protected),
      x: (W / (cols + 1)) * (col + 1),
      y: 70 + row * 48,
      dead: false
    };
  });
}

export default {
  key: "tabshooter",
  meta: { label: "Tab Shooter", keywords: ["tab","browser","invader","shoot","close","space"] },
  schema: {
    fireRate: { type:"number", min:1, max:10, default:6 },
    speed:    { type:"number", min:0, max:4,  default:1 },
    lives:    { type:"number", min:1, max:5,  default:3 },
    theme:    THEME_FIELD,
    title:    { type:"string", default:"Tab Shooter" }
  },
  skill: {
    system: `Configure a shooter where the player's open browser tabs are the invaders — shoot one to close it. Fields: fireRate(1-10),speed(0-4 target descent),lives(1-5),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"neon tab blaster", json:{ fireRate:8, speed:1, lives:3, theme:"neon", title:"Tab Blaster" } }]
  },
  engine: {
    init(cfg) {
      const src = Array.isArray(cfg.targets) && cfg.targets.length ? cfg.targets : DEMO_TARGETS;
      return {
        cfg,
        targets: layout(src),
        playerX: W / 2,
        bullets: [],
        cooldown: 0,
        score: 0,
        lives: cfg.lives,
        closedIds: [], // ids the caller drains → closes the matching real tab
        won: false,
        over: false
      };
    },
    step(s, input, dt) {
      if (s.over) return s;
      const c = s.cfg;
      const move = (input.left ? -1 : 0) + (input.right ? 1 : 0);
      s.playerX = clamp(s.playerX + move * 7 * dt, 18, W - 18);
      s.cooldown = Math.max(0, s.cooldown - dt);
      if (input.fire && s.cooldown <= 0) {
        s.bullets.push({ x: s.playerX, y: H - 70 });
        s.cooldown = Math.max(3, 16 - c.fireRate);
      }

      for (const b of s.bullets) b.y -= 10 * dt;
      // Protected targets are locked in place; only closable ones advance.
      for (const t of s.targets) if (!t.dead && !t.protected) t.y += c.speed * dt;

      for (let bi = s.bullets.length - 1; bi >= 0; bi--) {
        const b = s.bullets[bi];
        let consumed = false;
        for (const t of s.targets) {
          if (t.dead) continue;
          if (Math.abs(b.x - t.x) >= 24 || Math.abs(b.y - t.y) >= 18) continue;
          // SAFETY: protected tabs are invulnerable — the shot passes through,
          // never marks them dead and never enqueues a close.
          if (t.protected) continue;
          t.dead = true;
          s.closedIds.push(t.id);
          s.score++;
          s.bullets.splice(bi, 1);
          consumed = true;
          break;
        }
        if (!consumed && b.y < -20) s.bullets.splice(bi, 1);
      }

      // A closable target reaching the player is missed (costs a life) — but it
      // is NEVER closed: only a bullet hit ever pushes to closedIds.
      for (const t of s.targets) {
        if (t.dead || t.protected) continue;
        if (t.y > H - 56) { t.dead = true; s.lives--; }
      }

      // Won only when every closable tab was actually shot. Both a hit and a
      // life-losing escape mark a target dead, so gate the win on score (which
      // only a shot bumps) rather than on `dead`.
      const closable = s.targets.filter(t => !t.protected).length;
      s.won = closable > 0 && s.score >= closable;
      if (s.won || s.lives <= 0) s.over = true;
      return s;
    },
    status(s) { return { score: s.score, over: s.over, won: s.won }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const b of s.bullets) drawShape(ctx, "dot", b.x, b.y, 12, pal.fg);
      for (const t of s.targets) {
        if (t.dead) continue;
        drawShape(ctx, "invader", t.x, t.y, 28, t.protected ? pal.hud : pal.accent);
        if (t.protected) drawShape(ctx, "block", t.x, t.y, 9, pal.bg); // lock marker
        ctx.fillStyle = pal.hud;
        ctx.font = "10px monospace";
        ctx.fillText(t.title.slice(0, 12), t.x, t.y + 24); // truncated label (UI text)
      }
      drawShape(ctx, "ship", s.playerX, H - 44, 32, pal.fg);
      ctx.fillStyle = pal.hud;
      ctx.font = "16px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.fillText(`Lives ${s.lives}`, W - 10, 10);
    }
  }
};
