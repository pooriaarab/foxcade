import { drawBackground, getPalette as getThemePalette, getTheme, PALETTES } from "./themes.js";
import { setActiveProc, setActiveSkin, setActiveSprites } from "./shapes.js";
import { assetUrl, loadAtlas } from "./atlas.js";
import { makeJuice } from "./juice.js";
import { applyInput, pointerToGame, postRender, preRender, scaleDt, timeAttackOver, validateModifiers } from "./modifiers.js";
import { playSfx, unlockAudio } from "./audio.js";

export function getPalette(name) {
  return getThemePalette(name);
}

export { PALETTES };

// Real sprite art for the space-shooter family (Kenney's Space Shooter Redux,
// CC0). The atlas loads once, lazily, the first time a space game runs; other
// games never touch it and keep their vector art. `dot`/`invader`/`spike` are
// also used by non-space games, so the mapping is applied per-space-game (below)
// rather than globally — leaving every other game vector.
const SPACE_KEYS = new Set(["shooter", "tabshooter", "bullethell", "topdown", "dodger"]);
let spaceMapping = null; // { kind -> {atlas, frame} }, built once the sheet loads
let spaceLoading = false;
function spaceSprites() {
  if (spaceMapping) return spaceMapping;
  if (!spaceLoading) {
    spaceLoading = true;
    // Fetch the frame table, then build the atlas + mapping once. Until this
    // resolves spaceSprites returns null and drawShape stays vector; the image
    // decode inside loadAtlas gates drawSprite the same way after.
    fetch(assetUrl("assets/space/sheet.xml"))
      .then(r => r.text())
      .then(xml => {
        const atlas = loadAtlas("assets/space/sheet.png", xml);
        spaceMapping = {
          ship:    { atlas, frame: "playerShip1_blue.png" },
          runner:  { atlas, frame: "playerShip1_blue.png" }, // dodger player = a ship
          invader: { atlas, frame: "enemyBlack1.png" },
          dot:     { atlas, frame: "laserRed01.png" },
          spike:   { atlas, frame: "meteorBrown_big1.png" }  // hazards = meteors
        };
      })
      .catch(() => {}); // no art → stay vector
  }
  return spaceMapping;
}

// Stable per-card seed for procedural sprites: hash of the title+theme, so the
// same card always generates the same creatures/ships but different cards vary.
function procSeed(cfg) {
  const text = `${cfg.title}|${cfg.theme}`;
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0x7fffffff;
  return h || 1;
}

// Real sprite art for the platformer family (Kenney's Platformer Art Complete
// Pack, CC0). Two sheets load once, lazily, the first time a platformer-family
// game runs: the tile sheet (blocks/exit) and an alien character sheet (player).
// Same lazy/vector-until-ready contract as spaceSprites above. `flag`/`dot` are
// used by non-platformer games too, so the mapping is applied per-key (below).
// Ground/side-view family shares Kenney's platformer char + tile sheets: an alien
// hero, stone walls, a crate obstacle, a coin-box pickup, a door goal. Applied to
// every genre that reads as a person-on-ground game (runner/explore/frogger too),
// so photo themes get a real character + obstacle set beyond just platformer/maze.
// Kinds a game doesn't draw are simply never looked up; unmapped kinds (e.g.
// frogger's car — no vehicle sprite in these packs) fall through to vector.
const PLAT_KEYS = new Set(["platformer", "maze", "runner", "explore", "frogger"]);
let platMapping = null;
let platLoading = false;
function platSprites() {
  if (platMapping) return platMapping;
  if (!platLoading) {
    platLoading = true;
    Promise.all([
      fetch(assetUrl("assets/platformer/tiles.xml")).then(r => r.text()),
      fetch(assetUrl("assets/platformer/char.xml")).then(r => r.text())
    ])
      .then(([tilesXml, charXml]) => {
        const tiles = loadAtlas("assets/platformer/tiles.png", tilesXml);
        const char = loadAtlas("assets/platformer/char.png", charXml);
        platMapping = {
          runner: { atlas: char,  frame: "alienGreen_stand.png" }, // hero (runner/explore/frogger/platformer)
          dot:    { atlas: char,  frame: "alienGreen_stand.png" }, // maze player (drawn as a dot)
          wall:   { atlas: tiles, frame: "stoneCenter.png" },      // maze/explore wall tile
          block:  { atlas: tiles, frame: "box.png" },              // runner obstacle = crate
          target: { atlas: tiles, frame: "boxCoin.png" },          // pickup = coin box
          flag:   { atlas: tiles, frame: "door_openMid.png" }      // goal / exit door
        };
      })
      .catch(() => {}); // no art → stay vector
  }
  return platMapping;
}

function spritesFor(key) {
  if (SPACE_KEYS.has(key)) return spaceSprites();
  if (PLAT_KEYS.has(key)) return platSprites();
  return null;
}

// Generic shape-kind → procedural-sprite-kind map for `pixel` art themes. A pixel
// theme renders these kinds as procsprites.genSprite pixel art for ANY game (not
// just the few that used to opt in via game.proc); kinds not listed fall through
// to vector art painted in the pixel skin, so the whole board reads as one
// coherent pixel look. Every target kind here is supported by procsprites.template.
const PROC_MAP = {
  ship: "ship", invader: "invader", diamond: "enemy", runner: "player",
  block: "block", brick: "block", wall: "wall", car: "car",
  spike: "spike", target: "target", flag: "flag"
};

// Universal level progression. Every game that reaches a terminal "win" loops
// into a fresh, harder level instead of freezing — done generically here, with
// zero per-game code. Games whose status.won is never true (endless: shooter,
// snake, dodger, …) or that already level internally (breakout, platformer keep
// won:false) never trigger any of this and behave exactly as before.
export const LEVEL_START = Object.freeze({ level: 1, scoreBase: 0, speed: 1 });

// Per-level dt multiplier: ramps difficulty generically without touching an
// engine, capped so it never becomes unplayable and stacks safely with turbo
// (makeLoop re-clamps the composed dt).
export function levelSpeed(level) {
  return Math.min(2.2, 1 + 0.12 * (level - 1));
}

// Pure, deterministic level-advance decision (no Math.random / Date). prev is a
// progression state { level, scoreBase, speed }. A cleared stage (status.won)
// that is not a time-attack expiry advances: level++, cumulative score carried,
// speed ramped. A loss (over && !won) or a time-up leaves progression unchanged
// and the caller ends the run. Returns the next progression + an `advanced` flag.
export function stepLevel(prev, status, timeUp) {
  if (status.won && !timeUp) {
    const level = prev.level + 1;
    return { level, scoreBase: prev.scoreBase + status.score, speed: levelSpeed(level), advanced: true };
  }
  return { level: prev.level, scoreBase: prev.scoreBase, speed: prev.speed, advanced: false };
}

// Pure pointer→input mapping so a canvas tap/drag drives the whole catalog with
// no per-game code. Horizontal intent = pointer vs the canvas centre (a dead
// zone keeps a centred tap neutral); vertical from top/bottom bands; holding
// anywhere fires. Games read the same input.left/right/up/down/fire the keyboard
// sets, so every existing engine responds to touch unchanged.
export function pointerToInput(px, py, W, H) {
  const dz = W * 0.1;
  return {
    left:  px < W / 2 - dz,
    right: px > W / 2 + dz,
    up:    py < H * 0.4,
    down:  py > H * 0.6,
    fire:  true
  };
}

export function makeLoop(canvas, game, cfg) {
  const ctx = canvas.getContext("2d");
  const W = 400, H = 600; canvas.width = W; canvas.height = H;
  let state = game.engine.init(cfg);
  // Sprite source is chosen from the CURRENT THEME, not the game key, so shuffling
  // a theme swaps the whole art style AND its sprite source (see below in frame):
  //   art "pixel"  → procedural pixel-art (procsprites) via PROC_MAP for ANY game
  //   art "photo"  → the per-game photo atlas where it fits (space/platformer)
  //   art "vector" → pure drawShape vectors in the theme skin
  // A pixel theme uses one proc spec for the whole run: PROC_MAP is game-agnostic,
  // the seed is fixed per card so the art is deterministic, and the palette comes
  // from the theme. Unmapped kinds fall through to vector+skin in shapes.drawShape.
  const theme = getTheme(cfg.theme);
  const pal = theme.palette;
  const pixelProc = theme.art === "pixel"
    ? { map: PROC_MAP, seed: procSeed(cfg), palette: pal }
    : null;
  const input = {};
  const KEY = { ArrowUp:"up", ArrowDown:"down", ArrowLeft:"left", ArrowRight:"right", Space:"fire", KeyW:"up", KeyA:"left", KeyD:"right" };
  // A real key press marks the input source as keyboard so games that read BOTH
  // keys and a pointer tap (rhythm) don't treat pointer-synthesized direction
  // flags as a second lane press.
  const down = e => { if (KEY[e.code]) { input[KEY[e.code]] = true; input._pointer = false; e.preventDefault(); } unlockAudio(); };
  const up   = e => { if (KEY[e.code]) input[KEY[e.code]] = false; };
  // Pointer: `tap` is one-shot (whack/platformer read it on the frame it lands);
  // `input.pointerHeld` stays true from pointerdown to pointerup so stream games
  // (sand) paint continuously while dragging, not just on the initial tap. A HELD
  // pointer also drives directional + fire input via pointerToInput so touch plays
  // every game; move while held keeps steering; release clears the held intent
  // (keyboard is untouched — it never fires these). px/py are stored in GAME space
  // (inverse of the active geometric modifiers) so a tap lands on what's drawn;
  // pointerToInput reads raw screen x since applyInput already mirrors directions.
  const canvasXY = e => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height)
    };
  };
  const applyPointer = e => {
    const { x, y } = canvasXY(e);
    const g = pointerToGame(x, y, W, H, mods);
    input.px = g.x; input.py = g.y;
    input._pointer = true;
    Object.assign(input, pointerToInput(x, y, W, H));
  };
  const clearPointer = () => { input.left = input.right = input.up = input.down = input.fire = false; };
  const pdown  = e => { input.pointerHeld = true; input.tap = true; applyPointer(e); unlockAudio(); };
  const pmove  = e => { if (input.pointerHeld) applyPointer(e); };
  const pend   = () => { input.pointerHeld = false; input._pointer = false; clearPointer(); };
  window.addEventListener("keydown", down); window.addEventListener("keyup", up);
  canvas.addEventListener("pointerdown", pdown);
  canvas.addEventListener("pointermove", pmove);
  canvas.addEventListener("pointercancel", pend);
  window.addEventListener("pointerup", pend);
  const juice = makeJuice(W, H);
  // Rule modifiers: orthogonal, game-agnostic transforms (input remap, dt scale,
  // frame transform, global timer). Re-validated here so makeLoop stays crash-proof
  // whatever set cfg.modifiers. Empty array → every helper below is a no-op.
  const mods = validateModifiers(cfg.modifiers || []);
  // Level progression bookkeeping. baseTitle is captured once so each re-seed
  // hashes a fresh title (`${baseTitle}#L${n}`) → a new board for engines that
  // derive their seed from cfg.title (+theme), without any engine edits.
  const baseTitle = cfg.baseTitle || cfg.title || game.key;
  let prog = { ...LEVEL_START };
  let prevScore = 0, ended = false;
  let raf, last = 0, running = true, startT = 0;
  // SFX only when this game is genuinely active: the tab is visible AND the
  // canvas is on-screen (offsetParent null = overlay hidden / detached). Stops
  // background/other-tab games from making "random" sounds when not playing.
  const canSfx = () => (typeof document === "undefined" || document.visibilityState === "visible") && canvas.offsetParent !== null;
  // Optional side-effect drain: a game may push ids to state.closedIds and the
  // caller may pass cfg.onClose(id) to react once per new id (tabshooter closes
  // the matching real tab). Harmless for every other game — they set neither.
  let closeCursor = 0;
  function frame(t) {
    if (!running) return;
    if (!startT) startT = t;
    const elapsedMs = t - startT;
    const rawDt = last ? Math.min(2, (t - last) / 16.67) : 1; last = t;
    // Compose the per-level speed ramp with modifier dt-scaling, re-clamped so
    // the combination (e.g. late-turbo × a high level) can never tunnel.
    const dt = Math.min(4, scaleDt(rawDt, mods, elapsedMs) * prog.speed);
    // timeattack: once the clock hits 0 the game freezes (step no longer runs).
    const timeUp = timeAttackOver(mods, elapsedMs);
    if (!timeUp) {
      state = game.engine.step(state, applyInput(input, mods), dt);
      if (typeof cfg.onClose === "function" && Array.isArray(state.closedIds)) {
        while (closeCursor < state.closedIds.length) cfg.onClose(state.closedIds[closeCursor++]);
      }
    }
    input.tap = false; // one-shot
    setActiveSkin(theme.skin);
    // Photo themes keep the per-game atlas (called per frame so it picks up the
    // lazily-decoded sheet); pixel themes swap in procedural sprites; vector
    // themes use neither. Whatever the atlas/genSprite can't supply falls through
    // to vector+skin in drawShape, so the render is always safe (headless too).
    setActiveSprites(theme.art === "photo" ? spritesFor(game.key) : null);
    setActiveProc(theme.art === "pixel" ? pixelProc : null);
    juice.update(dt);
    let st = game.engine.status(state);
    // Cleared a stage? Re-seed a fresh, harder level in place of freezing. The
    // new board is drawn this same frame (no YOU-WIN flash), score carries over.
    const adv = stepLevel(prog, st, timeUp);
    if (adv.advanced) {
      prog = adv;
      state = game.engine.init({ ...cfg, baseTitle, title: `${baseTitle}#L${prog.level}` });
      st = game.engine.status(state);
      ended = false; prevScore = 0; closeCursor = 0;
      canvas.dataset.gameover = ""; canvas.dataset.won = ""; canvas.dataset.score = "";
      juice.burst(W / 2, H / 2, pal.fg, 30, 3);
      if (canSfx()) playSfx("level", theme.audio);
    }
    const over = st.over || timeUp;
    // World render: everything the modifiers geometrically transform (mirror /
    // flipv / zoom) is wrapped here; HUD + overlays below stay upright.
    ctx.save();
    preRender(ctx, W, H, mods);
    drawBackground(ctx, theme, W, H, elapsedMs);
    juice.drawAmbient(ctx, pal.particles);
    ctx.fillStyle = pal.fg;
    game.engine.draw(ctx, state, pal);
    // Juice: a spark puff on every score gain, one big burst when the run ends.
    if (st.score > prevScore) { juice.burst(W / 2, H * 0.28, pal.accent, 10); if (canSfx()) playSfx("score", theme.audio); }
    prevScore = st.score;
    if ((over || st.won) && !ended) { juice.burst(W / 2, H / 2, st.won ? pal.fg : pal.accent, 60, 5); if (canSfx()) playSfx(st.won ? "win" : "over", theme.audio); ended = true; }
    juice.drawSparks(ctx);
    ctx.restore();
    // Screen-space modifier overlays (fog, time-attack clock), upright.
    postRender(ctx, W, H, mods, elapsedMs);
    ctx.fillStyle = pal.hud; ctx.font = theme.font; ctx.textAlign = "left"; ctx.textBaseline = "top";
    const shownScore = prog.scoreBase + st.score;
    ctx.fillText(`Score ${shownScore}`, 10, 10);
    if (prog.level > 1) ctx.fillText(`Level ${prog.level}`, 10, 30);
    if (over || st.won) {
      ctx.textAlign = "center"; ctx.font = theme.font.replace(/^\d+px/, "40px");
      ctx.fillText(st.won ? "YOU WIN" : timeUp ? "TIME UP" : "GAME OVER", W/2, H/2);
      canvas.dataset.gameover = "1";
      canvas.dataset.won = st.won ? "1" : "";   // distinct from a loss
      canvas.dataset.score = String(shownScore);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return {
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerup", pend);
      canvas.removeEventListener("pointerdown", pdown);
      canvas.removeEventListener("pointermove", pmove);
      canvas.removeEventListener("pointercancel", pend);
    }
  };
}
