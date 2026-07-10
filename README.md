# foxcade

foxcade is a Manifest V3 browser extension that turns a short text prompt into a playable canvas mini-game — generated on your device. It runs on Firefox and Chrome, with no server, no accounts, and no data leaving the browser.

Where the browser exposes a built-in on-device AI (Firefox's experimental `browser.trial.ml`, or Chrome's Prompt API), foxcade uses it to interpret the prompt. The language model **never writes game code** — it only routes the prompt to a hand-written game engine and fills a bounded JSON schema. Validation clamps and repairs that config, so a game always runs even when model output is missing or malformed. When no model is available, a local heuristic generator keeps everything fully playable.

## Features

- **29 games** across arcade, puzzle, platformer, shooters, a pseudo-3D raycaster, a WebGL 3D scene, a real-map driving game, falling-sand, rhythm, and a composable "sandbox" where you assemble mechanics from primitives.
- **Endless, escalating levels** and a **daily challenge** with a shareable result.
- **12 themes** that restyle the art — sprites and backgrounds — not just the colors.
- **Cross-browser** from a single package (Firefox + Chrome).
- **Private by design** — generation and play happen locally.

## Install (development)

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → pick `src/manifest.json`. Or `npm start` to launch a scratch Firefox with it loaded.

**Chrome** — `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select the `src/` folder.

For the on-device AI path (`trial.ml`), use Firefox Nightly with `browser.ml.enable=true` and grant the `trialML` permission when prompted. Without it, foxcade falls back to the heuristic generator (still fully playable) or, on Chrome, the built-in Prompt API.

## Development

```bash
npm install
npx playwright install chromium
npm run test:unit
npm run test:e2e
npm run lint
npm run build     # → web-ext-artifacts/foxcade-<version>.zip
```

`npm run shots` regenerates the store screenshots (headless capture + framing).

## How it works

`probe()` picks the best available model path:

- `mock` — e2e tests inject `window.__FORGE_MODEL__`.
- `local-ai` — the browser exposes on-device generation and the user grants permission.
- `heuristic` — no model available; routing falls back to keywords and validation produces default playable configs.

Every engine implements a small contract (`init`/`step`/`draw`) and is pure and deterministic (no `Math.random`/`Date` in gameplay), so runs are reproducible and screenshots are stable.

## Privacy

foxcade collects no data. See [PRIVACY.md](PRIVACY.md). The only network request any feature makes is the optional map-tile fetch used by the driving game (public tiles, no personal data).

## License

MIT — see [LICENSE](LICENSE).
