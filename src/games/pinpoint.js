import { getPalette } from "./themes.js";
import { THEME_FIELD, THEME_IDS } from "./themes.js";

const CLUE_COUNT = 5;
const THEME_CHOICES = THEME_IDS.join("|");

// Embedded content set. Each puzzle reveals clues[] one at a time; the player
// guesses which category the clues belong to from options[] (the correct one is
// always the `category`). Generic, no PII.
export const CONTENT = [
  { category: "Planets",        clues: ["Mercury","Venus","Mars","Jupiter","Saturn"],           options: ["Planets","Moons","Constellations","Comets"] },
  { category: "Primary colors", clues: ["Red","Blue","Yellow","(mix for green)","(mix for orange)"], options: ["Primary colors","Metals","Fruits","Emotions"] },
  { category: "Chess pieces",   clues: ["Pawn","Knight","Bishop","Rook","Queen"],               options: ["Chess pieces","Card suits","Dance moves","Tools"] },
  { category: "Oceans",         clues: ["Pacific","Atlantic","Indian","Arctic","Southern"],     options: ["Oceans","Rivers","Deserts","Mountain ranges"] },
  { category: "Musical notes",  clues: ["Do","Re","Mi","Fa","Sol"],                             options: ["Musical notes","Greek letters","Zodiac signs","Vitamins"] },
  { category: "Programming languages", clues: ["Python","Java","Ruby","Rust","Go"],             options: ["Programming languages","Snakes","Gemstones","Board games"] },
  { category: "Continents",     clues: ["Asia","Africa","Europe","Antarctica","Australia"],     options: ["Continents","Countries","Time zones","Languages"] },
  { category: "Shades of blue", clues: ["Navy","Teal","Azure","Cobalt","Cyan"],                 options: ["Shades of blue","Shades of red","Cat breeds","Wines"] },
  { category: "Days of the week", clues: ["Monday","Tuesday","Wednesday","Thursday","Friday"],  options: ["Days of the week","Months","Planets","Seasons"] },
  { category: "Fruits",         clues: ["Apple","Banana","Cherry","Grape","Mango"],             options: ["Fruits","Vegetables","Trees","Flowers"] }
];

// Deterministic pick from a seed (no Date/Math.random).
export function pickPuzzle(seed) {
  const n = CONTENT.length;
  return CONTENT[(((seed | 0) % n) + n) % n];
}

// Fewer clues used -> higher score. First-clue guess scores CLUE_COUNT; the
// last clue scores 1; a wrong finish scores 0.
export function pinpointScore(cluesUsed) {
  if (!Number.isInteger(cluesUsed) || cluesUsed < 1 || cluesUsed > CLUE_COUNT) return 0;
  return CLUE_COUNT - cluesUsed + 1;
}

// A run is LOSABLE: fewer clues than the wrong-guess budget used to make the answer
// forced (4 options, 5 clues → the last option was always deducible). Now MAX_WRONG
// wrong guesses ends the run as a loss, so finishing unsolved is reachable.
export const MAX_WRONG = 3;

// Pure puzzle core (no DOM) so the win/lose logic is unit-testable. `cluesUsed`
// starts at 1 because the first clue is shown up front. A correct guess wins
// (scored by clues used); MAX_WRONG wrong guesses — or exhausting the clues —
// loses with score 0.
export function initProgress() {
  return { cluesUsed: 1, wrong: 0, done: false, solved: false, score: 0 };
}
export function guess(puzzle, progress, option) {
  if (progress.done) return progress;
  if (option === puzzle.answer) {
    return { ...progress, done: true, solved: true, score: pinpointScore(progress.cluesUsed) };
  }
  const wrong = progress.wrong + 1;
  if (wrong >= MAX_WRONG || progress.cluesUsed >= puzzle.maxClues) {
    return { ...progress, wrong, done: true, solved: false, score: 0 };
  }
  return { ...progress, wrong, cluesUsed: progress.cluesUsed + 1 };
}

export default {
  key: "pinpoint",
  type: "puzzle",
  meta: { label: "Pinpoint", keywords: ["pinpoint","category","clue","trivia","guess","connect"] },
  schema: {
    theme: THEME_FIELD,
    title: { type: "string", default: "Forge Pinpoint" }
  },
  skill: {
    system: `Configure a category-guessing puzzle where clues are revealed one at a time. Fields: theme(${THEME_CHOICES}),title. Return ONLY JSON.`,
    examples: [{ prompt: "cosmic category guessing game", json: { theme: "scifi", title: "Cosmic Pinpoint" } }]
  },
  puzzle: {
    // PURE + deterministic: same seed -> same puzzle. Options order is preserved
    // from the content set (also deterministic).
    generate(cfg, seed) {
      const p = pickPuzzle(seed);
      return {
        category: p.category,
        clues: p.clues.slice(0, CLUE_COUNT),
        options: p.options.slice(),
        answer: p.category,
        maxClues: CLUE_COUNT,
        theme: cfg.theme,
        title: cfg.title
      };
    },
    mount(container, state, { onDone } = {}) {
      const pal = getPalette(state.theme);
      container.classList.add("puzzle", "pinpoint");
      container.style.background = pal.bg;
      container.style.color = pal.fg;

      const title = el("p", "puzzle-title", state.title || "Pinpoint");
      const hint = el("p", "puzzle-status", "Which category do these belong to?");
      const clueList = el("ol", "pinpoint-clues");
      const optionsEl = el("div", "pinpoint-options");
      const optionEls = {};
      for (const opt of state.options) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pinpoint-option";
        b.dataset.option = opt;
        b.textContent = opt;
        optionsEl.append(b);
        optionEls[opt] = b;
      }
      container.append(title, clueList, hint, optionsEl);

      // Thin binding over the pure core: reflect revealed clues + finish state.
      let progress = initProgress();
      function renderClues() {
        while (clueList.childElementCount < progress.cluesUsed) {
          clueList.append(el("li", "pinpoint-clue", state.clues[clueList.childElementCount]));
        }
      }
      renderClues(); // start with the first clue

      const onClick = e => {
        if (progress.done) return;
        const btn = e.target.closest("button[data-option]");
        if (!btn || btn.disabled) return;
        progress = guess(state, progress, btn.dataset.option);
        if (!progress.solved) { btn.disabled = true; btn.classList.add("wrong"); }
        renderClues();
        if (progress.done) {
          for (const b of Object.values(optionEls)) b.disabled = true;
          hint.textContent = progress.solved
            ? `Correct in ${progress.cluesUsed} clue${progress.cluesUsed === 1 ? "" : "s"} — score ${progress.score}.`
            : `Out of guesses. It was ${state.answer}.`;
          onDone?.({ solved: progress.solved, score: progress.score });
        } else {
          const left = state.maxClues - progress.cluesUsed;
          hint.textContent = `Not it. ${left} clue${left === 1 ? "" : "s"} left.`;
        }
      };
      optionsEl.addEventListener("click", onClick);

      return {
        destroy() {
          optionsEl.removeEventListener("click", onClick);
          container.textContent = "";
          container.classList.remove("puzzle", "pinpoint");
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

// --- self-check (node --test or run directly) ---------------------------
export function _demo() {
  console.assert(CONTENT.every(p => p.clues.length === CLUE_COUNT), "each puzzle has 5 clues");
  console.assert(CONTENT.every(p => p.options.includes(p.category)), "options contain the answer");
  console.assert(pickPuzzle(3) === pickPuzzle(3), "seed pick is deterministic");
  console.assert(pinpointScore(1) === 5 && pinpointScore(5) === 1, "fewer clues -> higher score");
  console.assert(pinpointScore(1) > pinpointScore(3) && pinpointScore(3) > pinpointScore(5), "monotonic decreasing");
  console.assert(pinpointScore(9) === 0 && pinpointScore(0) === 0, "out-of-range scores 0");
  // Losable: MAX_WRONG wrong guesses ends the run unsolved.
  const puz = { answer: "A", maxClues: CLUE_COUNT };
  let pr = initProgress();
  for (let i = 0; i < MAX_WRONG; i++) pr = guess(puz, pr, "X");
  console.assert(pr.done && !pr.solved && pr.score === 0, "wrong guesses can lose the run");
  console.assert(guess(puz, initProgress(), "A").solved, "the correct option wins");
}
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) _demo();
