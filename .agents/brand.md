# foxcade brand

This document records the product identity already present in the repository.
Use it with `.agents/design.md` when changing user-facing work.

## Product

- Write the product name as **foxcade** in lowercase.
- Describe foxcade as a browser extension that turns prompts into mini-games.
- Explain that generation runs on the user's device.
- Mention the local heuristic path when an on-device model is unavailable.
- Describe the hand-written engines and bounded configuration when implementation detail matters.
- Do not imply that a language model writes or executes game code.

The extension has no accounts or server-side inference. The real-map game can
load public tiles from OpenFreeMap. Do not claim that every feature is offline.

## Voice

Use direct, playful language. Lead with the action a person can take: describe,
forge, play, remix, or share. Keep privacy claims factual and specific.

Examples from the product include “Describe a game,” “Forge,” “Harder,” “New
theme,” “Different look,” and “Play today.”

Do not use broad security claims. Do not describe cloud services, accounts, or
remote inference as product features.

## Logo

The source logo is `src/assets/logo.svg` on a `128 × 128` view box.

- The rounded badge uses a vertical `#ff9a2e` to `#f0472e` gradient.
- The fox head and ears use `#1c1230`.
- The eyes use `#ff9a2e`.
- The white snout is a right-pointing play triangle.
- Keep the geometry and colors together. Do not redraw individual parts.

Use the PNG icon sizes listed in `src/manifest.json` for browser surfaces.
Use the SVG as the editable source for other approved product artwork.

## Product boundary

Keep the shell identity separate from each game's visual theme. The shell uses
one stable dark interface. Games can use any theme defined in
`src/games/themes.js`.

This repository packages a browser extension. It does not declare or deploy a
product website.
