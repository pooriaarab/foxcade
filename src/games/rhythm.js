import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

// Beat-tap rhythm game (Sound & Music genre). Notes fall down 3 lanes toward a
// hit line on a seeded, deterministic beatmap; hit the matching lane key (or
// tap that third of the screen) as a note crosses the line. Timing accuracy
// scores (perfect = 2, good = 1). A missed note costs health; health out = over;
// clearing the whole song = won. Hit/miss/win/lose audio is played by the
// engine-base render loop (gated on visibility) off score / over / win — so the
// engine here stays pure and node-testable, with no Math.random/Date.
const W = 400, H = 600;
const LANES = 3;
const LANE_W = W / LANES;
const HIT_Y = H - 90;   // the judgement line
const TOP = -20;        // notes spawn just above the canvas
const LEAD = 90;        // ticks a note takes to fall from TOP to the hit line
const WINDOW = 12;      // ticks either side of the beat that still counts as a hit
const PERFECT = 5;      // tighter window scores double
const THEME_CHOICES = THEME_IDS.join("|");

function seedFromConfig(c) {
  const text = `${c.title}|${c.theme}`;
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed + text.charCodeAt(i) * (i + 1)) % 9973;
  return seed || 1;
}

function nextRand(rng) {
  return (rng * 1103515245 + 12345) & 0x7fffffff;
}

function buildChart(seed, beats, interval) {
  const notes = [];
  let rng = seed;
  for (let i = 0; i < beats; i++) {
    rng = nextRand(rng);
    notes.push({ lane: rng % LANES, hitTime: LEAD + i * interval, judged: false, hit: false });
  }
  return notes;
}

// Lanes pressed THIS frame. Keyboard left/up/right map to lanes 0/1/2 — but ONLY
// when the input source is the keyboard (input._pointer false). A pointer tap
// maps to the third of the width it landed in, via px alone. This split stops a
// single tap firing two lanes: engine-base synthesizes direction flags from a
// pointer (e.g. a top-right tap sets both `up` and `right`), so reading those on
// a tap would register two lanes. Empty-lane presses find no note and are ignored
// (no penalty), so a stray press never hurts.
function pressedLanes(input) {
  const kb = !input._pointer;
  const p = [Boolean(kb && input.left), Boolean(kb && input.up), Boolean(kb && input.right)];
  if (input.tap && Number.isFinite(input.px)) {
    const lane = Math.max(0, Math.min(LANES - 1, Math.floor(input.px / LANE_W)));
    p[lane] = true;
  }
  return p;
}

export default {
  key: "rhythm",
  meta: { label: "Beat Tap", keywords: ["rhythm","beat","music","tap","notes","tempo"], dailyMode: "solve" },
  schema: {
    tempo:  { type:"number", min:1, max:10, default:5 },
    beats:  { type:"number", min:8, max:60, default:24 },
    health: { type:"number", min:1, max:9,  default:5 },
    theme:  THEME_FIELD,
    title:  { type:"string", default:"Forge Beat" }
  },
  skill: {
    system: `Configure a falling-note rhythm game. Fields: tempo note speed(1-10),beats song length(8-60),health misses allowed(1-9),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"fast neon rhythm track", json:{ tempo:9, beats:40, health:4, theme:"neon", title:"Neon Beat" } }]
  },
  engine: {
    init(cfg) {
      const interval = Math.max(14, 50 - Math.round(cfg.tempo) * 4);
      const notes = buildChart(seedFromConfig(cfg), Math.round(cfg.beats), interval);
      return {
        cfg, lanes:LANES, hitY:HIT_Y, interval,
        notes, time:0, prev:[false,false,false],
        score:0, health:Math.round(cfg.health), misses:0, hits:0,
        over:false, won:false, flash:0
      };
    },
    step(s, input, dt) {
      if (s.over || s.won) return s;
      s.time += dt;
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);

      // Judge fresh lane presses (rising edge) against the nearest note in range.
      const pressed = pressedLanes(input);
      for (let lane = 0; lane < LANES; lane++) {
        if (pressed[lane] && !s.prev[lane]) {
          let best = -1, bestDist = Infinity;
          for (let i = 0; i < s.notes.length; i++) {
            const n = s.notes[i];
            if (n.judged || n.lane !== lane) continue;
            const d = Math.abs(n.hitTime - s.time);
            if (d < bestDist) { bestDist = d; best = i; }
          }
          if (best >= 0 && bestDist <= WINDOW) {
            const n = s.notes[best];
            n.judged = true; n.hit = true;
            s.hits++;
            s.score += bestDist <= PERFECT ? 2 : 1;
            s.flash = 6;
          }
        }
      }
      s.prev = pressed;

      // Notes that fall past the window unhit are misses — each costs health.
      for (const n of s.notes) {
        if (!n.judged && s.time > n.hitTime + WINDOW) { n.judged = true; s.misses++; s.health--; }
      }
      if (s.health <= 0) { s.health = 0; s.over = true; return s; }

      // Song complete (all notes resolved and past) with health left = a win.
      const last = s.notes.length ? s.notes[s.notes.length - 1].hitTime : 0;
      if (s.notes.every(n => n.judged) && s.time > last + WINDOW) s.won = true;
      return s;
    },
    status(s) { return { score:s.score, over:s.over, won:s.won }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      ctx.save();
      // Lane dividers.
      ctx.globalAlpha = 0.18; ctx.fillStyle = pal.hud;
      for (let i = 1; i < LANES; i++) ctx.fillRect(i * LANE_W - 1, 0, 2, H);
      // Judgement line.
      ctx.globalAlpha = s.flash > 0 ? 1 : 0.6; ctx.fillStyle = pal.accent;
      ctx.fillRect(0, HIT_Y - 2, W, 4);
      ctx.restore();
      // Falling notes.
      for (const n of s.notes) {
        if (n.judged) continue;
        const y = HIT_Y - ((n.hitTime - s.time) / LEAD) * (HIT_Y - TOP);
        if (y < TOP || y > H) continue;
        drawShape(ctx, "target", n.lane * LANE_W + LANE_W / 2, y, LANE_W * 0.6, pal.fg);
      }
      // Health pips (vector, no text).
      ctx.save();
      ctx.fillStyle = pal.accent;
      for (let i = 0; i < s.health; i++) ctx.fillRect(W - 14 - i * 14, H - 12, 10, 8);
      ctx.restore();
    }
  }
};
