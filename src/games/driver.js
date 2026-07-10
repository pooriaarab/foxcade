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
  for (let i = 0; i < text.length; i++) seed = (seed + text.charCodeAt(i) * (i + 3)) % 7919;
  return seed;
}

function laneX(lane, laneCount) {
  const roadLeft = 48;
  const roadWidth = W - roadLeft * 2;
  return roadLeft + roadWidth * ((lane + 0.5) / laneCount);
}

function spawnObstacle(seed, count, laneCount) {
  return {
    lane: (seed + count * 2 + Math.floor(count / 2)) % laneCount,
    y: -36
  };
}

export default {
  key: "driver",
  meta: { label: "Lane Racer", keywords: ["drive","car","lane","traffic","race","dodge","road"] },
  schema: {
    laneCount: { type:"number", min:3, max:6,  default:4 },
    speed:     { type:"number", min:2, max:9,  default:4 },
    spawnRate: { type:"number", min:1, max:10, default:4 },
    theme:     THEME_FIELD,
    title:     { type:"string", default:"Lane Racer" }
  },
  skill: {
    system: `Configure a top-down lane dodge driving game. Fields: laneCount(3-6),speed(2-9),spawnRate(1-10),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"lane racer at night with traffic cones", json:{ laneCount:4, speed:6, spawnRate:7, theme:"neon", title:"Night Lanes" } }]
  },
  engine: {
    init(cfg) {
      const laneCount = Math.round(cfg.laneCount);
      const seed = seedFromConfig(cfg);
      return {
        cfg,
        laneCount,
        lane: Math.floor((laneCount - 1) / 2),
        obstacles: [spawnObstacle(seed, 0, laneCount)],
        spawnClock: 0,
        spawnCount: 1,
        distance: 0,
        seed,
        prev: { left:false, right:false },
        dead: false
      };
    },
    step(s, input, dt) {
      if (s.dead) return s;
      const c = s.cfg;
      if (input.left && !s.prev.left) s.lane = clamp(s.lane - 1, 0, s.laneCount - 1);
      else if (input.right && !s.prev.right) s.lane = clamp(s.lane + 1, 0, s.laneCount - 1);
      s.prev = { left:!!input.left, right:!!input.right };

      const roadSpeed = c.speed + Math.floor(s.distance / 300) * 0.4;
      s.distance += roadSpeed * dt;
      s.spawnClock += dt;
      const every = Math.max(14, 72 - c.spawnRate * 5);
      if (s.spawnClock >= every) {
        s.spawnClock = 0;
        s.obstacles.push(spawnObstacle(s.seed, s.spawnCount, s.laneCount));
        s.spawnCount++;
      }

      const playerY = H - 78;
      // Sub-step the descent so a fast obstacle can't skip the player's ±36px
      // contact band and tunnel through. SUB < the band guarantees a sampled hit.
      const adv = roadSpeed * dt;
      const SUB = 12;
      const parts = Math.max(1, Math.ceil(adv / SUB));
      const sadv = adv / parts;
      for (let step = 0; step < parts && !s.dead; step++) {
        for (const o of s.obstacles) o.y += sadv;
        for (const o of s.obstacles) {
          if (o.lane === s.lane && Math.abs(o.y - playerY) < 36) s.dead = true;
        }
      }
      s.obstacles = s.obstacles.filter(o => o.y < H + 44);
      return s;
    },
    status(s) { return { score:Math.floor(s.distance), over:s.dead, won:false }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      const roadLeft = 48;
      const roadWidth = W - roadLeft * 2;
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = pal.hud;
      ctx.fillRect(roadLeft, 40, roadWidth, H - 70);
      ctx.restore();
      ctx.strokeStyle = pal.hud;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2;
      for (let i = 1; i < s.laneCount; i++) {
        const x = roadLeft + roadWidth * (i / s.laneCount);
        for (let y = 56; y < H - 40; y += 38) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 18); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      for (const o of s.obstacles) drawShape(ctx, "spike", laneX(o.lane, s.laneCount), o.y, 34, pal.accent);
      drawShape(ctx, "car", laneX(s.lane, s.laneCount), H - 78, 38, pal.fg);
    }
  }
};
