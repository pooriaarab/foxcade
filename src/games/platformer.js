import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const PLAYER_W = 24, PLAYER_H = 32;
const CENTER_MIN = 60, CENTER_MAX = W - 60; // fixed so platform spacing never exceeds the jump reach
const THEME_CHOICES = THEME_IDS.join("|");

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// Horizontal reach still available from a single jump AFTER also rising `vGap`.
// A jump has upward speed jumpForce; the arc crosses height vGap again on the way
// DOWN (landing requires vy>=0) at t = (jumpForce + sqrt(jumpForce^2 - 2*g*vGap))/g,
// so horizontal reach = moveSpeed * t. At vGap=0 this is the full 2*jumpForce/g*
// moveSpeed; at the apex (vGap=maxRise) it halves. Rolling hGap against THIS budget
// (not the flat vGap=0 reach) is the fix for the old bug where a platform could
// demand near-max height AND near-max horizontal at once — physically unreachable.
function hReachAt(cfg, vGap) {
  const disc = Math.max(0, cfg.jumpForce * cfg.jumpForce - 2 * cfg.gravity * vGap);
  return (cfg.moveSpeed / cfg.gravity) * (cfg.jumpForce + Math.sqrt(disc));
}

// Space platforms so each is reachable from the one below, given THIS config's
// jump, for EVERY level. Vertical gap is rolled first (< maxRise); the horizontal
// gap is then clamped under the reach STILL LEFT for that vertical gap (joint
// budget above), so the jump arc always covers both together. Higher levels add
// platforms, push gaps toward the ceilings (via `ramp`), and seed a different
// layout — longer and tighter but never impossible. Deterministic (seed from the
// level, no RNG/Date) so tests and remixes are stable.
function makePlatforms(cfg, level) {
  const maxRise = (cfg.jumpForce * cfg.jumpForce) / (2 * cfg.gravity);
  const diff = 1 - 1 / (1 + (level - 1) * cfg.ramp); // 0..1, grows and saturates with level
  const n = Math.round(cfg.platformCount) + Math.min(6, level - 1);
  const vLo = Math.min(24, maxRise * 0.5);
  const vHi = maxRise * (0.55 + 0.35 * diff); // <= 0.9 * maxRise < maxRise

  // Deterministic LCG seeded by level (matches snake/tetris style; no Math.random).
  let seed = (level * 2654435761) & 0x7fffffff || 1;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const platforms = [];
  let cx = W / 2;
  let y = H - 56;
  for (let i = 0; i < n; i++) {
    const w = 118 - (i % 3) * 10;
    if (i > 0) {
      const vGap = vLo + (vHi - vLo) * rand();
      // Clamp the horizontal gap under the reach LEFT after rising vGap (<= 0.8x
      // of the joint budget, margin for variable frame dt). Depends on vGap, so a
      // tall gap forces a short sideways step — the two can't max out at once.
      const hMax = hReachAt(cfg, vGap) * (0.5 + 0.3 * diff);
      const dir = rand() < 0.5 ? -1 : 1;
      cx = clamp(cx + dir * hMax * (0.6 + 0.4 * rand()), CENTER_MIN, CENTER_MAX);
      y -= vGap;
    }
    platforms.push({ x: cx - w / 2, y, w, h: 14 });
  }
  return platforms;
}

export { hReachAt };

function spawnLevel(s) {
  s.platforms = makePlatforms(s.cfg, s.level);
  const start = s.platforms[0];
  const last = s.platforms[s.platforms.length - 1];
  s.x = start.x + start.w / 2;
  s.y = start.y - PLAYER_H / 2;
  s.vy = 0;
  s.grounded = true;
  s.reached = 0;
  s.score = s.cleared;
  s.goal = { x:last.x + last.w / 2, y:last.y - 24 };
}

export default {
  key: "platformer",
  meta: { label: "Platformer", keywords: ["platform","jump","mario","climb","ledge","gravity","endless"] },
  schema: {
    gravity:       { type:"number", min:0.4, max:1.5, default:1 },
    moveSpeed:     { type:"number", min:2,   max:8,   default:4 },
    jumpForce:     { type:"number", min:9,   max:16,  default:12 },
    platformCount: { type:"number", min:3,   max:8,   default:5 },
    ramp:          { type:"number", min:0,   max:1,   default:0.15 },
    theme:         THEME_FIELD,
    title:         { type:"string", default:"Forge Climb" }
  },
  skill: {
    system: `Configure an endless platformer that adds a harder level each time you reach the flag. Fields: gravity(0.4-1.5),moveSpeed(2-8),jumpForce(9-16),platformCount(3-8),ramp(0-1 difficulty growth),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"retro mario climb that keeps getting harder", json:{ gravity:1, moveSpeed:4, jumpForce:12, platformCount:5, ramp:0.2, theme:"retro", title:"Forge Climb" } }]
  },
  engine: {
    init(cfg) {
      const s = { cfg, level:1, cleared:0, reached:0, score:0, vy:0, grounded:true, dead:false, won:false };
      spawnLevel(s);
      return s;
    },
    step(s, input, dt) {
      if (s.dead) return s;
      const c = s.cfg;
      const move = (input.left ? -1 : 0) + (input.right ? 1 : 0);
      s.x = clamp(s.x + move * c.moveSpeed * dt, PLAYER_W / 2, W - PLAYER_W / 2);
      if ((input.up || input.tap) && s.grounded) {
        s.vy = -c.jumpForce;
        s.grounded = false;
      }

      const prevBottom = s.y + PLAYER_H / 2;
      s.vy += c.gravity * dt;
      s.y += s.vy * dt;
      s.grounded = false;

      if (s.vy >= 0) {
        const nextBottom = s.y + PLAYER_H / 2;
        for (let i = 0; i < s.platforms.length; i++) {
          const p = s.platforms[i];
          const overlaps = s.x + PLAYER_W / 2 > p.x && s.x - PLAYER_W / 2 < p.x + p.w;
          if (overlaps && prevBottom <= p.y && nextBottom >= p.y) {
            s.y = p.y - PLAYER_H / 2;
            s.vy = 0;
            s.grounded = true;
            s.reached = Math.max(s.reached, i);
            s.score = s.cleared + s.reached;
            break;
          }
        }
      }

      // Reaching the flag clears the level: bank points and spawn the next, harder
      // layout. Endless — never a terminal win.
      if (Math.abs(s.x - s.goal.x) < 24 && Math.abs(s.y - s.goal.y) < 28) {
        s.cleared += s.platforms.length;
        s.level++;
        spawnLevel(s);
        return s;
      }
      if (s.y - PLAYER_H / 2 > H) s.dead = true;
      return s;
    },
    status(s) { return { score:s.score, over:s.dead, won:false }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      for (const p of s.platforms) drawShape(ctx, "paddle", p.x + p.w / 2, p.y + p.h / 2, p.w / 1.8, pal.accent);
      drawShape(ctx, "flag", s.goal.x, s.goal.y, 36, pal.accent);
      drawShape(ctx, "runner", s.x, s.y, 32, pal.fg);
      ctx.fillStyle = pal.hud; ctx.font = "16px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.fillText(`Level ${s.level}`, W - 10, 10);
    }
  }
};
