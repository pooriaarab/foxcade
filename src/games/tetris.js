import { getPalette } from "./engine-base.js";
import { drawShape } from "./shapes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const COLS = 10, ROWS = 20;
const CELL = 20;
const OX = (W - COLS * CELL) / 2; // 100
const OY = (H - ROWS * CELL) / 2; // 100
const THEME_CHOICES = THEME_IDS.join("|");

// Each tetromino: one entry per rotation, cells as [dx,dy] within a 4-wide box.
const PIECES = {
  I: [[[0,1],[1,1],[2,1],[3,1]], [[2,0],[2,1],[2,2],[2,3]], [[0,2],[1,2],[2,2],[3,2]], [[1,0],[1,1],[1,2],[1,3]]],
  O: [[[1,0],[2,0],[1,1],[2,1]]],
  T: [[[1,0],[0,1],[1,1],[2,1]], [[1,0],[1,1],[2,1],[1,2]], [[0,1],[1,1],[2,1],[1,2]], [[1,0],[0,1],[1,1],[1,2]]],
  S: [[[1,0],[2,0],[0,1],[1,1]], [[1,0],[1,1],[2,1],[2,2]]],
  Z: [[[0,0],[1,0],[1,1],[2,1]], [[2,0],[1,1],[2,1],[1,2]]],
  J: [[[0,0],[0,1],[1,1],[2,1]], [[1,0],[2,0],[1,1],[1,2]], [[0,1],[1,1],[2,1],[2,2]], [[1,0],[1,1],[0,2],[1,2]]],
  L: [[[2,0],[0,1],[1,1],[2,1]], [[1,0],[1,1],[1,2],[2,2]], [[0,1],[1,1],[2,1],[0,2]], [[0,0],[1,0],[1,1],[1,2]]]
};
const TYPES = Object.keys(PIECES);

function seedFromConfig(c) {
  const text = `${c.title}|${c.theme}`;
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed + text.charCodeAt(i) * (i + 1)) % 9973;
  return seed || 1;
}

// Deterministic 7-bag: seeded Fisher-Yates so every piece appears once per bag
// and the sequence is reproducible from the seed. No Math.random.
function refillBag(s) {
  const bag = TYPES.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    s.rng = (s.rng * 1103515245 + 12345) & 0x7fffffff;
    const j = s.rng % (i + 1);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  s.bag = bag;
}

function spawnPiece(s) {
  if (!s.bag || s.bag.length === 0) refillBag(s);
  return { type: s.bag.pop(), rot: 0, x: 3, y: 0 };
}

function pieceCells(p) {
  const states = PIECES[p.type];
  return states[p.rot % states.length].map(([dx, dy]) => [p.x + dx, p.y + dy]);
}

function collides(board, p) {
  return pieceCells(p).some(([x, y]) =>
    x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x]));
}

function tryMove(s, dx, dy) {
  const moved = { ...s.piece, x: s.piece.x + dx, y: s.piece.y + dy };
  if (collides(s.board, moved)) return false;
  s.piece = moved;
  return true;
}

function tryRotate(s) {
  const rotated = { ...s.piece, rot: (s.piece.rot + 1) % PIECES[s.piece.type].length };
  if (!collides(s.board, rotated)) s.piece = rotated;
}

function lockAndClear(s) {
  for (const [x, y] of pieceCells(s.piece)) if (y >= 0) s.board[y][x] = 1;
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (s.board[y].every(c => c)) {
      s.board.splice(y, 1);
      s.board.unshift(new Array(COLS).fill(0));
      cleared++;
      y++; // re-check this index: rows above shifted down into it
    }
  }
  s.lines += cleared;
  s.score += cleared;
  s.piece = spawnPiece(s);
  if (collides(s.board, s.piece)) s.dead = true;
}

export default {
  key: "tetris",
  meta: { label: "Block Stacker", keywords: ["tetris","blocks","stack","puzzle","lines","tetromino"] },
  schema: {
    speed: { type:"number", min:1, max:10, default:5 },
    theme: THEME_FIELD,
    title: { type:"string", default:"Forge Blocks" }
  },
  skill: {
    system: `Configure a falling-block stacker. Fields: speed(1-10),theme(${THEME_CHOICES}),title.`,
    examples: [{ prompt:"fast neon block stacker", json:{ speed:9, theme:"neon", title:"Neon Stacker" } }]
  },
  engine: {
    init(cfg) {
      const s = {
        cfg,
        cols: COLS, rows: ROWS,
        board: Array.from({ length: ROWS }, () => new Array(COLS).fill(0)),
        rng: seedFromConfig(cfg),
        bag: [],
        tick: 0,
        lines: 0,
        score: 0,
        prev: { left:false, right:false, up:false },
        dead: false
      };
      s.piece = spawnPiece(s);
      return s;
    },
    step(s, input, dt) {
      if (s.dead) return s;
      const interval = Math.max(2, 14 - s.cfg.speed);
      // Edge-triggered horizontal move + rotate: one action per fresh press, so a
      // held (or single-frame tapped) key can't slam the piece across the board or
      // spin it every frame. Soft-drop (down) stays continuous on purpose.
      if (!s.prev) s.prev = { left:false, right:false, up:false };
      const p = s.prev;
      if (input.left && !p.left) tryMove(s, -1, 0);
      else if (input.right && !p.right) tryMove(s, 1, 0);
      if (input.up && !p.up) tryRotate(s);
      s.prev = { left:!!input.left, right:!!input.right, up:!!input.up };

      s.tick += dt;
      if (input.down) s.tick += dt; // soft drop
      if (s.tick >= interval) {
        s.tick = 0;
        if (!tryMove(s, 0, 1)) lockAndClear(s);
      }
      return s;
    },
    status(s) { return { score:s.score, over:s.dead, won:false }; },
    draw(ctx, s, palette) {
      const pal = palette || getPalette(s.cfg.theme);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (s.board[y][x]) drawShape(ctx, "block", OX + x * CELL + CELL / 2, OY + y * CELL + CELL / 2, CELL - 1, pal.accent);
        }
      }
      for (const [x, y] of pieceCells(s.piece)) {
        if (y >= 0) drawShape(ctx, "block", OX + x * CELL + CELL / 2, OY + y * CELL + CELL / 2, CELL - 1, pal.fg);
      }
    }
  }
};
