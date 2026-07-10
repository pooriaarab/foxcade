# Packaging & distribution

foxcade is a Manifest V3 web extension that runs on Firefox and Chrome. Everything is local — no server, no backend.

## Build the package

```
npm run build      # → web-ext-artifacts/foxcade-<version>.zip
npm run lint       # web-ext lint (0 errors expected; 1 known cross-browser warning)
```

The one lint warning (`/background/service_worker is not supported`) is expected: the manifest carries both `service_worker` (Chrome) and `scripts` (Firefox) so a single package loads on both. Each browser reads the key it supports.

## Install for development

**Firefox** — `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `src/manifest.json`. Or `npm start` (web-ext run) to launch a scratch Firefox with it loaded. Temporary add-ons are removed on restart.

For the on-device AI (`trial.ml`), use **Firefox Nightly** with prefs `browser.ml.enable=true` and `extensions.experiments.enabled=true`; grant the `trialML` permission when prompted. Without it, the extension falls back to the heuristic generator (still fully playable) or, on Chrome, the built-in Prompt API.

**Chrome** — `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `src/` folder.

## Distribute to users

**Firefox (AMO — addons.mozilla.org):**
1. Create a Firefox add-on developer account.
2. Developer Hub → **Submit a New Add-on** → upload `web-ext-artifacts/foxcade-<version>.zip`.
3. Choose listed (public, appears on AMO) or unlisted (self-hosted).
4. Mozilla reviews and **signs** it; signed add-ons install with one click and auto-update.
5. Review notes: state that all AI runs on-device (`trial.ml`), no user data leaves the browser — the privacy story eases review. Declare `alarms` (daily reminder) and the optional `trialML`/`notifications`. One exception to disclose: the **World Run** game (`type:"map"`) fetches free, no-key map tiles from OpenFreeMap at runtime — the sole network access, covered by the `host_permissions` + `connect-src` for `*.openfreemap.org`. It sends no user data (only tile coordinates); every other game stays fully local.

**Chrome (Chrome Web Store):** one-time developer registration ($5), then upload the same zip.

## Release checklist

- Bump `version` in `src/manifest.json`.
- `npm test` green (unit + e2e), `npm run lint` clean.
- `npm run build`, then upload the zip.
- Tag the release in git.

## Icons

`src/assets/icon-{16,32,48,96,128}.png` are rasterized from `src/assets/logo.svg`. To regenerate after editing the SVG, re-run the rasterizer (Playwright renders the SVG at each size).
