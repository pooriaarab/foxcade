// Vector entity art. drawShape(ctx, kind, cx, cy, size, color) draws one entity
// centered at (cx,cy) fitting roughly within `size`, in pure canvas ops (no
// images, no gradients — the unit-test mock ctx only implements path ops, so
// shading is done with translucent white/black overlays that stay inside each
// silhouette). setActiveSkin(skin) picks the "finish": a skin never moves the
// center or changes the silhouette, it only restyles it.
//
//   glow   strong neon bloom (shadowBlur) + bright core, no hard edge
//   round  heavy soft drop shadow + rounded joins, no hard edge
//   sketch rough hand-drawn doubled ink outline, deterministic jitter, no sheen
//   sharp  crisp thin dark edge + strongest specular highlight
//   flat   clean minimal solid, thin faint edge
//   pixel  chunky hard two-tone + thick blocky border, no smoothing

import { drawSprite } from "./atlas.js";
import { genSprite } from "./procsprites.js";

let activeSkin = "flat";

export function setActiveSkin(skin) {
  activeSkin = typeof skin === "string" && skin ? skin : "flat";
}

// Optional sprite skin: maps a shape `kind` to { atlas, frame }. When set and
// the atlas is decoded, drawShape paints the real frame instead of the vector
// body. Unmapped kinds (and unready/missing frames) always fall through to
// vector, so the game is playable before art loads and in headless tests.
let activeSprites = null;

export function setActiveSprites(spec) {
  activeSprites = spec && typeof spec === "object" ? spec : null;
}

// Optional procedural-sprite source: { map:{shapeKind->procKind}, seed, palette }.
// When set, a mapped shape kind is drawn as a code-generated pixel-art sprite
// (procsprites.genSprite) instead of vector. A third source behind this seam —
// checked after the photo atlas, before vector — so a game opts in per-kind
// without touching the space sheet or every other game. Unmapped kinds and
// headless environments (genSprite → null) always fall through to vector.
let activeProc = null;

export function setActiveProc(spec) {
  activeProc = spec && typeof spec === "object" && spec.map ? spec : null;
}

// Per-skin finish knobs. Each skin restyles EVERY kind the same way (the per-kind
// geometry below is skin-agnostic — a skin only changes the finish), so shuffling
// the theme visibly re-skins every silhouette at once:
//   SHINE/SHADE  strength of the white/black lit overlays (0 = none)
//   OUTLINE      body-edge stroke width as a fraction of size (0 = no stroke)
// glow leans on bloom + a bright core, round on a soft drop shadow, so both skip
// the hard edge; pixel is a chunky hard two-tone with a thick border; sharp is a
// crisp thin edge + strong specular; flat is a clean thin minimal solid; sketch
// is a rough doubled ink outline with deterministic jitter and no sheen.
const SHINE   = { glow: 0.34, sharp: 0.52, round: 0.28, flat: 0.14, pixel: 0.36, sketch: 0 };
const SHADE   = { glow: 0.14, sharp: 0.24, round: 0.22, flat: 0.10, pixel: 0.40, sketch: 0 };
const OUTLINE = { glow: 0,    sharp: 0.04, round: 0,    flat: 0.03, pixel: 0.15, sketch: 0.06 };

export function drawShape(ctx, kind, cx, cy, size, color) {
  const s = Math.max(1, size);
  const sprite = activeSprites?.[kind];
  if (sprite && drawSprite(ctx, sprite.atlas, sprite.frame, cx, cy, s)) return;
  const procKind = activeProc?.map[kind];
  if (procKind) {
    const canvas = genSprite(procKind, activeProc.seed, activeProc.palette);
    if (canvas) { ctx.drawImage(canvas, cx - s / 2, cy - s / 2, s, s); return; }
  }
  const shineA = SHINE[activeSkin] ?? 0.22;
  const shadeA = SHADE[activeSkin] ?? 0.16;
  const edgeW = (OUTLINE[activeSkin] ?? 0) * s;

  ctx.save();
  ctx.fillStyle = color;
  ctx.lineJoin = activeSkin === "round" ? "round" : "miter";
  ctx.lineCap = activeSkin === "round" ? "round" : "butt";
  if (activeSkin === "glow") {
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.max(8, s * 0.6); // strong neon bloom
  } else if (activeSkin === "round") {
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = s * 0.28;             // soft, heavy drop shadow
    ctx.shadowOffsetY = s * 0.1;
  } else if (activeSkin === "pixel") {
    ctx.imageSmoothingEnabled = false;     // hard, un-smoothed edges
  }

  // Deterministic per-shape jitter (NO Math.random/Date): a hash of (cx,cy,seq)
  // through Math.sin → stable every frame for a shape at a fixed spot, so the
  // sketch look never shimmers. seq advances per call for a rougher second pass.
  let seq = 0;
  const jitter = () => {
    const n = ((cx * 73856093) ^ (cy * 19349663) ^ (seq++ * 83492791)) >>> 0;
    const v = Math.sin(n) * 43758.5453;
    return (v - Math.floor(v)) * 2 - 1; // -1..1
  };
  // Stroke the CURRENT path as the body edge in the active skin's style. Called
  // from fill() while the just-built body path is still current; stroke() does
  // not consume the path, so the fill underneath is untouched.
  const outline = () => {
    if (edgeW <= 0) return;
    ctx.save();
    ctx.lineWidth = Math.max(1, edgeW);
    if (activeSkin === "sketch") {
      // Rough hand-drawn doubled ink: one clean pass, one jittered offset pass.
      ctx.strokeStyle = "rgba(20,20,20,0.72)";
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.stroke();
      ctx.translate(jitter() * s * 0.05, jitter() * s * 0.05);
      ctx.stroke();
    } else {
      ctx.strokeStyle = activeSkin === "flat" ? "rgba(0,0,0,0.28)" : "rgba(12,12,18,0.85)";
      ctx.stroke();
    }
    ctx.restore();
  };
  // Fill the current path as body, then add the skin's edge.
  const fill = () => { ctx.fill(); outline(); };
  // Translucent overlays for a lit, 3-D read. build() must stay inside the
  // silhouette (no clip available in the test mock).
  const shine = (build) => { if (shineA <= 0) return; ctx.save(); ctx.globalAlpha = shineA; ctx.fillStyle = "#fff"; build(); ctx.fill(); ctx.restore(); };
  const shade = (build) => { if (shadeA <= 0) return; ctx.save(); ctx.globalAlpha = shadeA; ctx.fillStyle = "#000"; build(); ctx.fill(); ctx.restore(); };

  const poly = (pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };
  const roundRectPath = (x, y, w, h, r) => {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  };
  const disc = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };

  if (kind === "ship") {
    poly([[cx, cy - s * 0.58], [cx + s * 0.46, cy + s * 0.5], [cx, cy + s * 0.26], [cx - s * 0.46, cy + s * 0.5]]);
    fill();
    shine(() => poly([[cx, cy - s * 0.5], [cx + s * 0.16, cy + s * 0.16], [cx - s * 0.16, cy + s * 0.16]])); // nose panel
    shine(() => disc(cx, cy - s * 0.02, s * 0.11)); // cockpit glint
    shade(() => poly([[cx, cy + s * 0.26], [cx + s * 0.18, cy + s * 0.46], [cx - s * 0.18, cy + s * 0.46]])); // thruster notch
  } else if (kind === "invader") {
    const u = s / 7;
    ctx.beginPath();
    ctx.rect(cx - 2 * u, cy - 3 * u, 4 * u, u);
    ctx.rect(cx - 3 * u, cy - 2 * u, 6 * u, 3 * u);
    ctx.rect(cx - 2 * u, cy + u, u, u);
    ctx.rect(cx + u, cy + u, u, u);
    ctx.rect(cx - 4 * u, cy - u, u, 2 * u);
    ctx.rect(cx + 3 * u, cy - u, u, 2 * u);
    fill();
    shine(() => ctx.rect(cx - 2 * u, cy - 2 * u, 6 * u, u)); // top-lit row
    shade(() => { ctx.beginPath(); ctx.rect(cx - 1.7 * u, cy - 1.4 * u, u, u); ctx.rect(cx + 0.7 * u, cy - 1.4 * u, u, u); }); // eyes
  } else if (kind === "diamond") {
    poly([[cx, cy - s * 0.5], [cx + s * 0.5, cy], [cx, cy + s * 0.5], [cx - s * 0.5, cy]]);
    fill();
    shine(() => poly([[cx, cy - s * 0.5], [cx - s * 0.5, cy], [cx, cy]])); // upper-left facet
    shade(() => poly([[cx, cy + s * 0.5], [cx + s * 0.5, cy], [cx, cy]])); // lower-right facet
  } else if (kind === "circle") {
    disc(cx, cy, s * 0.5);
    fill();
    shade(() => disc(cx + s * 0.14, cy + s * 0.15, s * 0.32)); // terminator
    shine(() => disc(cx - s * 0.14, cy - s * 0.15, s * 0.2)); // specular
  } else if (kind === "dot") {
    disc(cx, cy, s * 0.25);
    fill();
    shine(() => disc(cx - s * 0.07, cy - s * 0.07, s * 0.1));
  } else if (kind === "block" || kind === "wall") {
    ctx.beginPath();
    ctx.rect(cx - s * 0.5, cy - s * 0.5, s, s);
    fill();
    shine(() => ctx.rect(cx - s * 0.5, cy - s * 0.5, s, s * 0.18)); // top bevel
    shade(() => ctx.rect(cx - s * 0.5, cy + s * 0.34, s, s * 0.16)); // bottom bevel
    if (kind === "wall") { // mortar seams
      shade(() => { ctx.beginPath(); ctx.rect(cx - s * 0.5, cy - s * 0.02, s, s * 0.04); ctx.rect(cx - s * 0.02, cy - s * 0.5, s * 0.04, s); });
    }
  } else if (kind === "brick") {
    roundRectPath(cx - s * 0.65, cy - s * 0.28, s * 1.3, s * 0.56, s * 0.14);
    fill();
    shine(() => ctx.rect(cx - s * 0.58, cy - s * 0.22, s * 1.16, s * 0.14)); // glossy top
    shade(() => ctx.rect(cx - s * 0.02, cy - s * 0.28, s * 0.04, s * 0.56)); // center mortar
  } else if (kind === "paddle") {
    roundRectPath(cx - s * 0.9, cy - s * 0.16, s * 1.8, s * 0.32, s * 0.16);
    fill();
    shine(() => ctx.rect(cx - s * 0.82, cy - s * 0.12, s * 1.64, s * 0.1)); // highlight strip
    shade(() => ctx.rect(cx - s * 0.82, cy + s * 0.06, s * 1.64, s * 0.06));
  } else if (kind === "spike") {
    poly([[cx, cy - s * 0.55], [cx + s * 0.5, cy + s * 0.5], [cx - s * 0.5, cy + s * 0.5]]);
    fill();
    shine(() => poly([[cx, cy - s * 0.55], [cx - s * 0.18, cy + s * 0.5], [cx - s * 0.5, cy + s * 0.5]])); // lit left face
    shade(() => poly([[cx, cy - s * 0.55], [cx + s * 0.18, cy + s * 0.5], [cx + s * 0.5, cy + s * 0.5]]));
  } else if (kind === "car") {
    const w = s * 0.74, h = s * 1.15;
    const x = cx - w / 2, y = cy - h / 2, r = s * 0.12;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, cy - h * 0.16);
    ctx.lineTo(cx + w * 0.28, cy - h * 0.08);
    ctx.lineTo(cx + w * 0.28, cy + h * 0.08);
    ctx.lineTo(x + w, cy + h * 0.16);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, cy + h * 0.16);
    ctx.lineTo(cx - w * 0.28, cy + h * 0.08);
    ctx.lineTo(cx - w * 0.28, cy - h * 0.08);
    ctx.lineTo(x, cy - h * 0.16);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    fill();
    shade(() => roundRectPath(cx - w * 0.24, y + h * 0.12, w * 0.48, h * 0.2, r * 0.6)); // windshield
    shade(() => roundRectPath(cx - w * 0.24, y + h * 0.62, w * 0.48, h * 0.18, r * 0.6)); // rear window
    shine(() => { ctx.beginPath(); ctx.rect(cx - w * 0.34, y + h * 0.04, w * 0.14, h * 0.05); ctx.rect(cx + w * 0.2, y + h * 0.04, w * 0.14, h * 0.05); }); // headlights
  } else if (kind === "target") {
    disc(cx, cy, s * 0.5);
    fill();
    shade(() => disc(cx, cy, s * 0.36));
    shine(() => disc(cx, cy, s * 0.24));
    shade(() => disc(cx, cy, s * 0.1)); // bullseye
  } else if (kind === "flag") {
    ctx.beginPath();
    ctx.rect(cx - s * 0.36, cy - s * 0.5, s * 0.12, s);
    fill();
    poly([[cx - s * 0.24, cy - s * 0.48], [cx + s * 0.48, cy - s * 0.28], [cx - s * 0.24, cy - s * 0.08]]);
    fill();
    shine(() => poly([[cx - s * 0.24, cy - s * 0.48], [cx + s * 0.12, cy - s * 0.38], [cx - s * 0.24, cy - s * 0.28]])); // upper fly
    shade(() => { disc(cx - s * 0.3, cy - s * 0.5, s * 0.08); }); // pole finial shadow
  } else if (kind === "runner") {
    disc(cx, cy - s * 0.25, s * 0.22);
    fill();
    ctx.beginPath();
    ctx.rect(cx - s * 0.12, cy - s * 0.02, s * 0.24, s * 0.36); // torso
    ctx.rect(cx - s * 0.35, cy + s * 0.12, s * 0.7, s * 0.14);  // arms
    ctx.rect(cx - s * 0.32, cy + s * 0.36, s * 0.28, s * 0.14); // back leg
    ctx.rect(cx + s * 0.04, cy + s * 0.36, s * 0.34, s * 0.14); // front leg
    fill();
    shine(() => disc(cx - s * 0.07, cy - s * 0.31, s * 0.09)); // head glint
    shade(() => ctx.rect(cx - s * 0.12, cy + s * 0.22, s * 0.24, s * 0.12)); // torso shadow
  }

  ctx.restore();
}
