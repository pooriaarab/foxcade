// Procedural pixel-art sprites. genSprite(kind, seed, palette) draws a small
// mirror-symmetric NxN pixel creature/ship/pickup onto an offscreen canvas,
// deterministically from (kind, seed) — the classic "random invader" generator.
// No Math.random / Date: the same inputs always yield the same art, so tests and
// remixed cards are stable. Colored from the palette (fg body, accent details),
// so every theme restyles the same silhouette for free.
//
// This is a THIRD sprite source behind the drawShape seam (after the space photo
// atlas, before the vector fallback). Where no canvas exists — headless Node unit
// tests — genSprite returns null and drawShape falls through to vector art.

const GRID = 11;              // odd → a true mirror axis down the center column
const HALF = (GRID - 1) / 2;  // 5: left columns 0..5 computed, mirrored to the right
const SCALE = 6;              // px per cell → a crisp 66px sprite, scaled at blit time

// Deterministic 32-bit stream seeded from (kind, seed): FNV-1a init, xorshift32
// pump. Keyed by kind so a "ship" and an "invader" from the same seed differ.
function seedStream(kind, seed) {
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < kind.length; i++) {
    h = (h ^ kind.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  const state = { h: h || 1 };
  return () => {
    let x = state.h;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    state.h = x >>> 0;
    return state.h / 0x100000000; // 0..1
  };
}

// Per-kind template. For a left-half cell at (dx, row) — dx = distance from the
// center column (0..HALF), row 0 (top) .. GRID-1 (bottom) — return how to fill it:
//   { off }   never on (outside the silhouette)
//   { on }    always body
//   { on, acc } always accent (eyes, cockpit, sparkle)
//   { p, acc? } hash-decided with probability p (carves organic edges → variety)
// Everything routes through here so each kind reads as itself while the hash still
// gives infinite per-seed variation inside the silhouette.
function template(kind, dx, row) {
  switch (kind) {
    case "ship": {
      // Nose at top, fuselage down the center, wings flaring toward the bottom.
      if (row === 0) return dx === 0 ? { on: true } : { off: true };
      if (dx === 0) return row >= 8 ? { on: true, acc: true } : { on: true }; // spine + engine glow
      if (dx === 1 && row >= 1) return { on: true };
      const wingSpan = Math.min(HALF, Math.max(0, row - 3)); // wings widen going down
      if (dx <= wingSpan && row >= 4) return { p: 0.85 };
      return { off: true };
    }
    case "player": {
      // Little humanoid: round head, torso, arms mid, two legs at the base.
      if (row <= 1) return dx <= 1 ? { on: true } : { off: true };        // head
      if (row === 2) return dx === 0 ? { on: true, acc: true } : { off: true }; // neck/face
      if (row <= 5) { // torso + arms
        if (dx <= 1) return { on: true };
        if (row === 4) return dx <= 3 ? { p: 0.9 } : { off: true };       // outstretched arms
        return { off: true };
      }
      if (row <= 8) return dx === 1 ? { on: true } : { off: true };        // two legs
      return { off: true };
    }
    case "invader": {
      // Blocky bug: antennae up top, a wide body, splayed legs at the base.
      if (row <= 1) return dx === 2 ? { p: 0.6 } : { off: true };          // antennae
      if (row >= 2 && row <= 4) { // head/body
        if (row === 3 && dx === 1) return { on: true, acc: true };         // eyes
        return dx <= 2 ? { on: true } : { off: true };
      }
      if (row === 5) return dx <= 3 ? { p: 0.7 } : { off: true };          // arms out
      if (row === 6) return (dx === 1 || dx === 3) ? { on: true } : { off: true }; // legs
      if (row === 7) return (dx === 1 || dx === 3) ? { p: 0.8 } : { off: true };   // feet
      return { off: true };
    }
    case "enemy": {
      // Diamond-bodied menace: a rhombus core, horns on top, accent eyes.
      const half = row < HALF ? row : GRID - 1 - row; // 0..HALF..0
      if (row <= 1) return dx <= 1 ? { p: 0.5, acc: true } : { off: true }; // horns
      if (row === 4 && dx === 1) return { on: true, acc: true };            // eyes
      if (dx <= half) return { p: 0.9 };                                    // diamond body
      return { off: true };
    }
    case "pickup": {
      // Small bright gem: a compact diamond, accent-heavy so it pops as loot.
      const r = Math.abs(row - HALF);
      if (r >= 4) return { off: true };
      if (dx <= HALF - 1 - r) return { on: true, acc: (r <= 1 && dx === 0) }; // core sparkle
      if (dx === HALF - r) return { p: 0.7, acc: true };                      // faceted edge
      return { off: true };
    }
    case "block": {
      // Full themed tile; spriteGrid sprinkles an accent speckle over the body
      // (below) so each seed textures the brick/wall differently. Lit top row.
      return row === 0 ? { on: true, acc: true } : { on: true };
    }
    case "wall": {
      // Solid stone tile with an accent mortar line every few rows — a coarser,
      // more built read than a plain block, no speckle.
      return { on: true, acc: row % 3 === 0 };
    }
    case "car": {
      // Vertical car: slim bumpers top+bottom, wide body, accent window bands.
      if (row === 0 || row === GRID - 1) return dx <= 1 ? { on: true } : { off: true };
      if (dx > 3) return { off: true }; // 7-wide body, 2-cell margin each side
      if ((row === 2 || row === 3 || row === 7 || row === 8) && dx <= 2) return { on: true, acc: true }; // windows
      return { on: true };
    }
    case "spike": {
      // Triangle: a point at the top widening to a full base, accent along the base.
      const width = Math.floor((row / (GRID - 1)) * HALF); // 0 at top → HALF at bottom
      if (dx <= width) return { on: true, acc: row >= GRID - 2 };
      return { off: true };
    }
    case "target": {
      // Concentric bullseye: alternating body/accent rings out to a full disc.
      const r = Math.round(Math.hypot(dx, row - HALF));
      if (r > HALF) return { off: true };
      return { on: true, acc: r % 2 === 0 };
    }
    case "flag": {
      // Symmetric pennant on a central pole (the generator mirrors left→right, so
      // a one-sided flag can't exist — a centered banner reads as a goal marker).
      if (dx === 0) return { on: true };                                   // pole
      if (row >= 1 && row <= 4 && dx <= HALF - 1) return { on: true, acc: true }; // banner
      return { off: true };
    }
    default:
      return { off: true };
  }
}

// Build the mirror-symmetric grid of cell states (0 empty, 1 body, 2 accent).
// Pure and deterministic — exported for the determinism unit test.
export function spriteGrid(kind, seed) {
  const rand = seedStream(kind, seed);
  const cells = Array.from({ length: GRID }, () => new Array(GRID).fill(0));
  const speckle = kind === "block";
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col <= HALF; col++) {
      const dx = HALF - col;
      const t = template(kind, dx, row);
      let v = 0;
      if (t.off) v = 0;
      else if (t.on) v = t.acc ? 2 : 1;
      else if (rand() < t.p) v = t.acc ? 2 : 1;
      // A block is a solid tile with an accent speckle sprinkled across it.
      if (speckle && v === 1 && row > 0 && rand() < 0.2) v = 2;
      cells[row][col] = v;
      cells[row][GRID - 1 - col] = v; // mirror across the center column
    }
  }
  return cells;
}

// Try to make an offscreen canvas in whatever environment we're in. Real browsers
// (extension + e2e) have OffscreenCanvas or document; headless Node has neither →
// null, and drawShape keeps its vector fallback.
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined" && document.createElement) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  return null;
}

// Cache by (kind, seed, palette colors): the same card re-renders the identical
// sprite every frame instead of re-rasterizing. Palette id is just its color
// triple — no theme-id plumbing needed. LRU-capped so a long remix session (many
// distinct kind/seed/palette combos) can't grow the Map without bound; a Map
// preserves insertion order, so the oldest key is its first key.
const CACHE_MAX = 256;
const cache = new Map();

export function genSprite(kind, seed, palette) {
  const pid = `${palette.fg}|${palette.accent}|${palette.bg}`;
  const key = `${kind}|${seed}|${pid}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; } // touch → most-recent

  const px = GRID * SCALE;
  const canvas = makeCanvas(px, px);
  if (!canvas) return null; // headless → vector fallback
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const cells = spriteGrid(kind, seed);
  const color = [null, palette.fg, palette.accent];
  ctx.clearRect(0, 0, px, px);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const v = cells[row][col];
      if (!v) continue;
      ctx.fillStyle = color[v];
      ctx.fillRect(col * SCALE, row * SCALE, SCALE, SCALE);
    }
  }
  cache.set(key, canvas);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); // evict oldest
  return canvas;
}

// --- self-check (node --test or run directly) ---------------------------
export function _demo() {
  const a = spriteGrid("invader", 42);
  const b = spriteGrid("invader", 42);
  console.assert(JSON.stringify(a) === JSON.stringify(b), "deterministic per (kind,seed)");
  console.assert(a.length === GRID && a[0].length === GRID, "square grid");
  // mirror symmetry
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      console.assert(a[r][c] === a[r][GRID - 1 - c], "mirror-symmetric");
  const c1 = spriteGrid("ship", 1), c2 = spriteGrid("ship", 2);
  console.assert(JSON.stringify(c1) !== JSON.stringify(c2), "different seeds differ");
}
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) _demo();
