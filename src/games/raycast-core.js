// Shared pseudo-3D raycaster primitives. All functions here are pure/deterministic
// (no Math.random, no Date) EXCEPT the draw helpers, which touch the canvas only.
// raymaze.js and raysurvive.js build on this; raycaster.js predates it and stays
// self-contained (kept untouched to avoid regressing a shipped game).
import { drawShape } from "./shapes.js";

export const W = 400, H = 600;

// FNV-1a over "title|theme" → the one seed every engine derives its world from.
export function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Seeded LCG → rand(max) gives an int in [0,max). Deterministic, no globals.
export function makeRand(seed) {
  let value = (seed >>> 0) || 1;
  return max => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return max > 0 ? value % max : 0;
  };
}

// Grid is a square array of booleans; true = solid wall (borders included).
export function isWall(grid, x, y) {
  const gx = Math.floor(x), gy = Math.floor(y);
  if (gy < 0 || gy >= grid.length || gx < 0 || gx >= grid[gy].length) return true;
  return grid[gy][gx];
}

export function angDiff(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Per-axis wall-sliding move: slide along a wall instead of sticking to it.
export function moveWithSlide(grid, p, dx, dy) {
  if (!isWall(grid, p.x + dx, p.y)) p.x += dx;
  if (!isWall(grid, p.x, p.y + dy)) p.y += dy;
}

// Sample the segment for any wall cell between two points (hitscan LOS).
export function losClear(grid, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) / 0.1);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWall(grid, x0 + dx * t, y0 + dy * t)) return false;
  }
  return true;
}

// Interior floor cells at least `minDist` (Manhattan) from `start`.
export function floorCells(grid, start, minDist) {
  const n = grid.length, out = [];
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      if (!grid[y][x] && Math.abs(x - start.x) + Math.abs(y - start.y) >= minDist) out.push({ x, y });
    }
  }
  return out;
}

// Deterministic spread: seed-derived indices across the candidate cells, skipping
// dupes. Same recipe raycaster.js uses for enemy placement.
export function pickSpread(cells, seed, count) {
  const out = [], used = new Set();
  for (let i = 0; i < count && cells.length; i++) {
    let idx = ((seed * (i + 1) * 97 + i * 53) % cells.length + cells.length) % cells.length;
    for (let t = 0; used.has(idx) && t < cells.length; t++) idx = (idx + 1) % cells.length;
    used.add(idx);
    out.push(cells[idx]);
  }
  return out;
}

// The whole first-person view: shaded floor, DDA wall columns with a depth buffer,
// then depth-tested billboards. `sprites` = [{x,y,kind,color,scale}]. Canvas-only.
export function renderScene(ctx, s, pal, sprites) {
  const p = s.player;
  const n = s.grid.length;
  const fov = (s.cfg.fov * Math.PI) / 180;
  const NUM = 200;             // columns cast across the FOV
  const COL = W / NUM;
  const horizon = H * 0.44;
  const zbuf = new Array(NUM);

  // Floor: a darker band under the horizon (ceiling keeps the theme bg).
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, horizon, W, H - horizon);

  for (let col = 0; col < NUM; col++) {
    const rayA = p.angle - fov / 2 + ((col + 0.5) / NUM) * fov;
    const ca = Math.cos(rayA), sa = Math.sin(rayA);
    let mapX = Math.floor(p.x), mapY = Math.floor(p.y);
    const deltaX = Math.abs(1 / ca), deltaY = Math.abs(1 / sa);
    let stepX, stepY, sideX, sideY;
    if (ca < 0) { stepX = -1; sideX = (p.x - mapX) * deltaX; }
    else { stepX = 1; sideX = (mapX + 1 - p.x) * deltaX; }
    if (sa < 0) { stepY = -1; sideY = (p.y - mapY) * deltaY; }
    else { stepY = 1; sideY = (mapY + 1 - p.y) * deltaY; }

    let side = 0;
    for (let guard = 0; guard < 256; guard++) {
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
      else { sideY += deltaY; mapY += stepY; side = 1; }
      if (mapX < 0 || mapY < 0 || mapX >= n || mapY >= n || s.grid[mapY][mapX]) break;
    }
    let dist = (side === 0 ? sideX - deltaX : sideY - deltaY) * Math.cos(rayA - p.angle);
    if (dist < 0.0001) dist = 0.0001;
    zbuf[col] = dist;

    const lineH = Math.min(H * 2, (H * 0.9) / dist);
    const y0 = horizon - lineH / 2;
    // X-facing walls in fg, Y-facing in accent → a flat-shaded depth cue.
    ctx.fillStyle = side === 1 ? pal.accent : pal.fg;
    ctx.fillRect(col * COL, y0, COL + 1, lineH);
    // Distance fog: darken far slices.
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.82, dist / 12)})`;
    ctx.fillRect(col * COL, y0, COL + 1, lineH);
  }

  // Billboards far→near, depth-tested against the wall buffer.
  const ordered = sprites
    .map(sp => ({ sp, d: Math.hypot(sp.x - p.x, sp.y - p.y) }))
    .sort((a, b) => b.d - a.d);
  for (const { sp, d } of ordered) {
    const ang = angDiff(Math.atan2(sp.y - p.y, sp.x - p.x) - p.angle);
    if (Math.abs(ang) > fov / 2 + 0.35) continue;
    const screenX = (0.5 + ang / fov) * W;
    const col = Math.floor(screenX / COL);
    if (col >= 0 && col < NUM && d > zbuf[col]) continue; // behind a wall
    const size = Math.min(H, (H * (sp.scale ?? 0.7)) / d);
    drawShape(ctx, sp.kind, screenX, horizon, size, sp.color);
  }
}

// Center crosshair — every FPS view draws it the same way.
export function crosshair(ctx, pal) {
  ctx.fillStyle = pal.hud;
  ctx.fillRect(W / 2 - 1, H / 2 - 8, 2, 16);
  ctx.fillRect(W / 2 - 8, H / 2 - 1, 16, 2);
}
