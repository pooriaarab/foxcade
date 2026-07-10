import { getPalette } from "./themes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const COLS = 5;
const MAX_GUESSES = 6;
const THEME_CHOICES = THEME_IDS.join("|");

// Curated common 5-letter answers, embedded for offline/heuristic play. When a
// model is available it may propose the daily answer (schema `answer`), but the
// validator gates it to this list (enum), so an off-list pick falls back to the
// deterministic seed pick below.
export const ANSWERS = [
  "ABOUT","ALERT","ARGUE","BEACH","BADGE","BLADE","BLAME","BLANK","BLAST","BLEND",
  "BLIND","BLOCK","BLOOM","BOARD","BOOST","BOUND","BRAIN","BRAND","BRAVE","BREAD",
  "BREAK","BRICK","BRIEF","BRING","BROAD","BROWN","BRUSH","BUILD","BUILT","CABLE",
  "CANDY","CATCH","CAUSE","CHAIN","CHAIR","CHARM","CHART","CHASE","CHEAP","CHECK",
  "CHESS","CHEST","CHIEF","CHILD","CIVIL","CLAIM","CLASS","CLEAN","CLEAR","CLICK",
  "CLIMB","CLOCK","CLOSE","CLOTH","CLOUD","COACH","COAST","COURT","COVER","CRACK",
  "CRAFT","CRANE","CRASH","CRAZY","CREAM","CRIME","CROSS","CROWD","CROWN","CRUDE",
  "CURVE","CYCLE","DAILY","DANCE","DEALT","DELAY","DEPTH","DOUBT","DOZEN","DRAFT",
  "DRAIN","DRAMA","DRANK","DREAM","DRESS","DRIFT","DRINK","DRIVE","DROVE","EAGER",
  "EARLY","EARTH","EMPTY","ENJOY","ENTER","EQUAL","EVENT","EXACT","EXIST","EXTRA",
  "FAITH","FALSE","FANCY","FAULT","FAVOR","FENCE","FIBER","FIELD","FIFTH","FIFTY",
  "FIGHT","FINAL","FIRST","FIXED","FLAME","FLASH","FLEET","FLESH","FLOAT","FLOOR",
  "FLOUR","FLUID","FOCUS","FORCE","FORGE","FORTH","FORTY","FORUM","FOUND","FRAME",
  "FRANK","FRAUD","FRESH","FRONT","FROST","FRUIT","FULLY","FUNNY","GHOST","GIANT",
  "GIVEN","GLASS","GLOBE","GLORY","GRACE","GRADE","GRAIN","GRAND","GRANT","GRAPH",
  "GRASS","GRAVE","GREAT","GREEN","GREET","GRIEF","GROSS","GROUP","GROWN","GUARD",
  "GUESS","GUEST","GUIDE","HAPPY","HARSH","HEART","HEAVY","HORSE","HOTEL","HOUSE",
  "HUMAN","IDEAL","IMAGE","INDEX","INNER","INPUT","ISSUE","IVORY","JOINT","JUDGE",
  "JUICE","KNOCK","KNOWN","LABEL","LARGE","LASER","LATER","LAUGH","LAYER","LEARN",
  "LEASE","LEAST","LEAVE","LEGAL","LEVEL","LIGHT","LIMIT","LOCAL","LOGIC","LOOSE",
  "LOWER","LOYAL","LUCKY","LUNCH","MAGIC","MAJOR","MAKER","MARCH","MATCH","MAYBE",
  "MAYOR","MEANT","MEDAL","MERIT","METAL","METER","MIGHT","MINOR","MINUS","MIXED",
  "MODEL","MONEY","MONTH","MORAL","MOTOR","MOUNT","MOUSE","MOUTH","MOVIE","MUSIC",
  "NEVER","NIGHT","NOBLE","NOISE","NORTH","NOVEL","NURSE","OCEAN","OFFER","ORDER",
  "OTHER","PAINT","PANEL","PAPER","PARTY","PATCH","PEACE","PEARL","PHASE","PHONE",
  "PHOTO","PIANO","PIECE","PILOT","PITCH","PLACE","PLAIN","PLANE","PLANT","PLATE",
  "POINT","POUND","POWER","PRESS","PRICE","PRIDE","PRIME","PRINT","PRIOR","PRIZE",
  "PROOF","PROUD","PROVE","QUEEN","QUICK","QUIET","QUITE","RADIO","RAISE","RANGE"
];

// Pure: guess -> per-letter status with the standard duplicate-letter rule.
// Greens are marked first and consume a copy of that letter from the answer;
// only remaining copies can turn a later occurrence yellow, so surplus repeats
// in the guess stay gray. Both inputs are upper-cased so casing never matters.
export function scoreGuess(guess, answer) {
  const g = String(guess).toUpperCase();
  const a = String(answer).toUpperCase();
  const result = new Array(COLS).fill("gray");
  const remaining = {};
  for (const c of a) remaining[c] = (remaining[c] || 0) + 1;
  for (let i = 0; i < COLS; i++) {
    if (g[i] === a[i]) { result[i] = "green"; remaining[g[i]]--; }
  }
  for (let i = 0; i < COLS; i++) {
    if (result[i] === "green") continue;
    if (remaining[g[i]] > 0) { result[i] = "yellow"; remaining[g[i]]--; }
  }
  return result;
}

// Deterministic answer from a seed (no Date/Math.random).
export function pickAnswer(seed) {
  const n = ANSWERS.length;
  return ANSWERS[(((seed | 0) % n) + n) % n];
}

// Rank so keyboard hints only ever upgrade (gray < yellow < green).
const RANK = { gray: 0, yellow: 1, green: 2 };
const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

export default {
  key: "wordle",
  type: "puzzle",
  meta: { label: "Wordle", keywords: ["wordle","word","letters","guess","spell","vocab"] },
  schema: {
    theme: THEME_FIELD,
    title: { type: "string", default: "Forge Wordle" },
    // Optional model-chosen answer, gated by the validator to the embedded list.
    answer: { type: "string", enum: ANSWERS, default: "" }
  },
  skill: {
    system: `Configure a 5-letter word-guessing puzzle. Fields: theme(${THEME_CHOICES}),title,answer. "answer" must be a common uppercase 5-letter English word; leave it out to let the game choose. Return ONLY JSON.`,
    examples: [{ prompt: "spooky word puzzle", json: { theme: "horror", title: "Dread Words", answer: "GHOST" } }]
  },
  puzzle: {
    // PURE + deterministic: same (cfg, seed) -> same answer. Model-picked answer
    // wins only if the validator kept it in ANSWERS; otherwise seed decides.
    generate(cfg, seed) {
      const answer = ANSWERS.includes(cfg.answer) ? cfg.answer : pickAnswer(seed);
      return { answer, rows: MAX_GUESSES, cols: COLS, theme: cfg.theme, title: cfg.title };
    },
    mount(container, state, { onDone } = {}) {
      const answer = state.answer.toUpperCase();
      const pal = getPalette(state.theme);
      container.classList.add("puzzle", "wordle");
      container.style.background = pal.bg;
      container.style.color = pal.fg;

      const title = el("p", "puzzle-title", state.title || "Wordle");
      const grid = el("div", "wordle-grid");
      const tiles = [];
      for (let r = 0; r < state.rows; r++) {
        const rowEl = el("div", "wordle-row");
        const cells = [];
        for (let c = 0; c < state.cols; c++) {
          const t = el("div", "wordle-tile");
          rowEl.append(t); cells.push(t);
        }
        grid.append(rowEl); tiles.push(cells);
      }
      const status = el("p", "puzzle-status", "Guess the 5-letter word.");
      const keyboard = el("div", "wordle-keyboard");
      const keyEls = {};
      for (const line of KEY_ROWS) {
        const krow = el("div", "wordle-krow");
        if (line === "ZXCVBNM") krow.append(makeKey("ENTER", "wide"));
        for (const ch of line) {
          const k = makeKey(ch);
          keyEls[ch] = k; krow.append(k);
        }
        if (line === "ZXCVBNM") krow.append(makeKey("BACK", "wide"));
        keyboard.append(krow);
      }
      container.append(title, grid, status, keyboard);

      let row = 0, cur = "", done = false;
      const keyRank = {};

      function render() {
        for (let c = 0; c < state.cols; c++) {
          tiles[row][c].textContent = cur[c] || "";
          tiles[row][c].classList.toggle("filled", Boolean(cur[c]));
        }
      }
      function finish(solved, score) {
        done = true;
        status.textContent = solved
          ? `Solved in ${score}!`
          : `Out of guesses. The word was ${answer}.`;
        onDone?.({ solved, score });
      }
      function submit() {
        if (cur.length !== state.cols) { status.textContent = "Need 5 letters."; return; }
        const marks = scoreGuess(cur, answer);
        for (let c = 0; c < state.cols; c++) {
          const t = tiles[row][c];
          t.classList.add(marks[c]);
          const ch = cur[c];
          if (!keyRank[ch] || RANK[marks[c]] > RANK[keyRank[ch]]) {
            keyRank[ch] = marks[c];
            keyEls[ch].classList.remove("green", "yellow", "gray");
            keyEls[ch].classList.add(marks[c]);
          }
        }
        if (cur === answer) return finish(true, row + 1);
        row++; cur = "";
        if (row >= state.rows) return finish(false, null);
        status.textContent = `Guess ${row + 1} of ${state.rows}.`;
      }
      function typeKey(key) {
        if (done) return;
        if (key === "ENTER") return submit();
        if (key === "BACK") { cur = cur.slice(0, -1); render(); return; }
        if (/^[A-Z]$/.test(key) && cur.length < state.cols) { cur += key; render(); }
      }

      // On-screen keyboard (delegated: one listener, cleaned up on destroy).
      const onClick = e => {
        const btn = e.target.closest("button[data-key]");
        if (btn) typeKey(btn.dataset.key);
      };
      keyboard.addEventListener("click", onClick);
      const onKeyDown = e => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const k = e.key === "Enter" ? "ENTER"
          : e.key === "Backspace" ? "BACK"
          : e.key.length === 1 ? e.key.toUpperCase() : "";
        if (k === "ENTER" || k === "BACK" || /^[A-Z]$/.test(k)) { e.preventDefault(); typeKey(k); }
      };
      window.addEventListener("keydown", onKeyDown);

      return {
        destroy() {
          window.removeEventListener("keydown", onKeyDown);
          keyboard.removeEventListener("click", onClick);
          container.textContent = "";
          container.classList.remove("puzzle", "wordle");
          container.removeAttribute("style");
        }
      };
    }
  }
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function makeKey(key, extra = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `wordle-key ${extra}`.trim();
  b.dataset.key = key;
  b.textContent = key === "BACK" ? "Del" : key === "ENTER" ? "Enter" : key;
  return b;
}

// --- self-check (node --test or run directly) ---------------------------
export function _demo() {
  console.assert(ANSWERS.every(w => /^[A-Z]{5}$/.test(w)), "all answers are 5 uppercase letters");
  console.assert(new Set(ANSWERS).size === ANSWERS.length, "answers are unique");
  console.assert(scoreGuess("CRANE", "CRANE").every(m => m === "green"), "exact guess all green");
  // duplicate rule: CRANE has one E; the green consumes it, so EERIE's leading E's stay gray.
  console.assert(
    scoreGuess("EERIE", "CRANE").join() === "gray,gray,yellow,gray,green",
    "duplicate letters respect answer counts"
  );
  console.assert(pickAnswer(7) === pickAnswer(7), "seed pick is deterministic");
  console.assert(ANSWERS.includes(pickAnswer(123456)), "seed pick stays in the list");
}
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) _demo();
