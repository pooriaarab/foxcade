// TexturePacker-XML sprite atlas. A sheet (one PNG) plus a set of named frames
// carved from it. loadAtlas kicks off the async image load and returns an atlas
// object immediately; its `.ready` flag flips true once the image decodes.
// Callers (drawSprite) treat an unready or unknown frame as a no-op so the
// vector fallback stays in charge until real art is on screen.

// Resolve a packaged-asset path to a loadable URL. Inside an extension the
// runtime rewrites it to moz-extension://…/path; served as a plain page (e2e,
// `npm run serve`) runtime is absent, so the raw relative path is used as-is.
export function assetUrl(path) {
  const runtime = (globalThis.browser ?? globalThis.chrome)?.runtime;
  return runtime?.getURL ? runtime.getURL(path) : path;
}

export function loadAtlas(pngUrl, xmlText) {
  const frames = {};
  for (const m of xmlText.matchAll(
    /<SubTexture\s+name="([^"]+)"\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"/g
  )) {
    frames[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5] };
  }
  const atlas = { frames, img: null, ready: false };
  // Headless Node (unit tests) has no Image constructor — stay vector, never crash.
  if (typeof Image === "undefined") return atlas;
  const img = new Image();
  img.onload = () => { atlas.img = img; atlas.ready = true; };
  // A failed PNG would otherwise leave the atlas silently un-ready forever; log
  // once so a broken sheet is diagnosable while the vector fallback carries on.
  img.onerror = () => {
    if (atlas.failed) return;
    atlas.failed = true;
    console.error("atlas: sprite sheet failed to load, staying vector", pngUrl);
  };
  img.src = assetUrl(pngUrl);
  return atlas;
}

// Draw one frame centered at (cx,cy), scaled to fit `size` while keeping the
// frame's aspect ratio. No-op until the sheet is decoded or if the frame name
// is unknown — the caller falls back to vector art in that window.
export function drawSprite(ctx, atlas, frameName, cx, cy, size) {
  if (!atlas || !atlas.ready) return false;
  const f = atlas.frames[frameName];
  if (!f) return false;
  const scale = size / Math.max(f.w, f.h);
  const w = f.w * scale, h = f.h * scale;
  ctx.drawImage(atlas.img, f.x, f.y, f.w, f.h, cx - w / 2, cy - h / 2, w, h);
  return true;
}
