import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const PICKUP_SCORE = 2;
const THEME_CHOICES = THEME_IDS.join("|");

function speedFor(s) {
  return s.cfg.speed + Math.min(4, (s.distance || 0) / 700);
}

function pickupY(index) {
  return 100 + (index * 113 % (H - 200));
}

export default {
  key: "runner",
  meta: { label: "Endless Runner", keywords: ["run","jump","flappy","dino","gap","bird"] },
  // Procedural pixel-art: hero + collectible gem generated per card, themed.
  proc: { runner: "player", target: "pickup" },
  schema: {
    gravity:  { type:"number", min:0.3, max:2.5, default:1 },
    jump:     { type:"number", min:5,   max:14,  default:9 },
    gap:      { type:"number", min:90,  max:260, default:160 }, // vertical gap px
    speed:    { type:"number", min:2,   max:8,   default:4 },
    theme:    THEME_FIELD,
    title:    { type:"string", default:"Forge Runner" }
  },
  skill: {
    system: `Configure an endless flapping runner. Fields: gravity(0.3-2.5),jump(5-14),gap(90-260),speed(2-8),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"hard fast neon flappy bird", json:{ gravity:1.6, jump:8, gap:110, speed:7, theme:"neon", title:"Neon Flap" } }]
  },
  engine: {
    init(cfg) {
      return {
        cfg,
        x:80,
        y:H/2,
        vy:0,
        obstacles:[{ x:W+40, gapY:H/2 }],
        pickups:[{ x:W+120, y:H/2 }],
        spawnDist:0,
        pickupDist:0,
        pickupCount:1,
        distance:0,
        score:0,
        dead:false
      };
    },
    step(s, input, dt) {
      if (s.dead) return s;
      const c = s.cfg;
      if (!s.pickups) s.pickups = [];
      if (typeof s.distance !== "number") s.distance = 0;
      if (typeof s.pickupDist !== "number") s.pickupDist = 0;
      if (typeof s.pickupCount !== "number") s.pickupCount = s.pickups.length;
      const speed = speedFor(s);
      if (input.up || input.tap) s.vy = -c.jump;
      s.vy += c.gravity * dt;
      s.y += s.vy * dt;
      const adv = speed * dt;   // horizontal world advance this frame
      s.distance += adv;
      s.spawnDist += adv;
      s.pickupDist += adv;
      // Sub-step the horizontal scroll so a fast obstacle/pickup can never skip its
      // narrow collision band (±18 / ±22 px around the player) and tunnel past. SUB
      // < both bands guarantees a sampled overlap at any speed × turbo dt.
      const SUB = 12;
      const parts = Math.max(1, Math.ceil(adv / SUB));
      const sadv = adv / parts;
      for (let step = 0; step < parts && !s.dead; step++) {
        for (const o of s.obstacles) o.x -= sadv;
        for (const p of s.pickups) p.x -= sadv;
        for (let i = s.pickups.length - 1; i >= 0; i--) {
          const p = s.pickups[i];
          if (Math.abs(p.x - s.x) < 22 && Math.abs(p.y - s.y) < 22) {
            s.pickups.splice(i, 1);
            s.score += PICKUP_SCORE;
          }
        }
        for (const o of s.obstacles) {
          if (o.x < s.x+18 && o.x > s.x-18) {
            if (s.y < o.gapY - c.gap/2 || s.y > o.gapY + c.gap/2) s.dead = true;
            if (!o.scored && o.x < s.x) { o.scored = true; s.score++; }
          }
        }
      }
      if (s.spawnDist >= 220) { s.spawnDist = 0; s.obstacles.push({ x:W+40, gapY: 120 + (s.obstacles.length*97 % (H-240)) }); }
      if (s.pickupDist >= 180) {
        s.pickupDist = 0;
        s.pickupCount++;
        s.pickups.push({ x:W+80, y:pickupY(s.pickupCount) });
      }
      s.obstacles = s.obstacles.filter(o => o.x > -60);
      s.pickups = s.pickups.filter(p => p.x > -30);
      if (s.y > H-10 || s.y < 0) s.dead = true;
      return s;
    },
    status(s) { return { score:s.score, over:s.dead, won:false }; },
    draw(ctx, s, palette) {
      const c = s.cfg;
      const pal = palette || getPalette(c.theme);
      // background from theme handled by engine-base; here draw entities
      for (const o of s.obstacles) {
        for (let y=0; y<o.gapY - c.gap/2; y+=28) drawShape(ctx, "block", o.x, y, 28, pal.accent);
        for (let y=o.gapY + c.gap/2; y<H; y+=28) drawShape(ctx, "block", o.x, y, 28, pal.accent);
      }
      for (const p of s.pickups || []) drawShape(ctx, "target", p.x, p.y, 20, pal.fg);
      drawShape(ctx, "runner", s.x, s.y, 28, pal.fg);
    }
  }
};
