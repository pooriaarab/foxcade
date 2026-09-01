# foxcade design system

## Overview

foxcade has two visual layers. The extension shell stays dark and consistent.
Game canvases use one of twelve themes from `src/games/themes.js`.

The shell contains the prompt view, generated game feed, daily card, game
cards, overlays, and DOM-based puzzle boards. Keep shell rules in `src/ui.css`.
Keep game art rules in the theme and renderer modules.

## Colors

Use these shell colors as implemented:

| Role | Value |
| --- | --- |
| Page | `#101114` |
| Header and game card | `#17191f` |
| Input | `#0f1117` |
| Primary text | `#f4f2ea` |
| Secondary text | `#c6cad3` |
| Mode text | `#a9b0bd` |
| Primary action | `#e6c75c` |
| Primary action hover | `#f0d974` |
| Secondary action | `#252a33` |
| Secondary action hover | `#303642` |
| Overlay scrim | `#050609cc` |

Borders range from `#30333a` on headers to `#4d5361` on play surfaces.
Use `#e6c75c55` for the implemented focus ring and outline.

Each game theme defines `bg`, `fg`, `accent`, `hud`, and `particles` roles.
Do not copy those values into shell CSS. The twelve themes are neon, retro,
mono, horror, cozy, vaporwave, pastel, eightbit, handdrawn, scifi, nature,
and candy.

## Typography

The shell uses this local system stack:

`Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

Use `24px` for feed and daily headings. Use `15px` for inputs and card titles.
Use `14px` for status and descriptive text. Use `13px` for compact labels.
The daily kicker uses `12px`, weight `800`, and uppercase text.

Canvas HUD fonts belong to themes. Most use `18px` or `20px` monospace,
Georgia, Trebuchet MS, Courier New, or Comic Sans MS as declared by each theme.

## Layout

The forge main area is centered and capped at `560px`. The feed main area is
capped at `1180px`. Play stages are capped at `400px` and use a `2 / 3` aspect
ratio. Feed thumbnails are capped at `168px` with the same ratio.

The feed grid uses `repeat(auto-fill, minmax(184px, 1fr))` with a `14px` gap.
The daily card uses content and action columns with a `16px` gap. The remix
panel uses four equal columns with an `8px` gap.

At `520px`, headers wrap and remix actions use two columns. At `620px`, the
feed header stretches and the daily card becomes one column.

## Elevation & Depth

Create shell depth with nested fills and one-pixel borders. The shell does not
use cast shadows. Focused play stages use a three-pixel gold translucent ring.
The daily card uses the same color as an outline with a two-pixel offset.

The fixed play overlay uses `z-index: 10` and the `#050609cc` scrim. Game depth
belongs inside canvases. Themes can add grids, scanlines, gradients, a vignette,
or dimmed scene images through the central background renderer.

## Shapes

Use `8px` corners for inputs, buttons, main cards, play stages, and puzzle
boards. Use `6px` corners for feed thumbnails. Wordle tiles use `4px` corners.
Puzzle thumbnail cells use `3px` corners.

Game silhouettes use the active theme's `glow`, `pixel`, `flat`, `sketch`,
`round`, or `sharp` skin. Do not make those skins shell component styles.

## Components

**Prompt input:** Use a `42px` height, `12px` horizontal padding, an `8px`
radius, and the `#0f1117` fill.

**Primary action:** Use the gold fill, dark text, `42px` height, and weight
`700`. The Forge and overlay actions use this treatment.

**Secondary action:** Use the dark action fill with light text. Remix controls,
feed controls, and Pinpoint options use this treatment.

**Daily card:** Keep the kicker, title, metadata, streak, and actions distinct.
Stack its columns at the mobile breakpoint.

**Game card:** Pair a portrait preview with a title and muted metadata. Keep
the entire card as the play target.

**Play surface:** Support canvas, WebGL, map, and DOM puzzle variants within
the same `400px` portrait boundary.

**Puzzle state:** Keep Wordle's green `#538d4e`, yellow `#b59f3b`, and gray
`#3a3a3c` states. Pinpoint wrong answers use `#6b2b2b`.

## Do's and Don'ts

### Do

- Preserve the stable shell and dynamic game-theme boundary.
- Use theme role values through `src/games/themes.js`.
- Keep play surfaces at the implemented portrait ratio.
- Keep visible focus states on keyboard targets.
- Test both forge and feed layouts after shell changes.

### Don't

- Do not apply game palettes to the extension shell.
- Do not hardcode a theme inside an individual game engine.
- Do not add remote fonts to the extension shell.
- Do not remove small-screen layout changes.
- Do not claim that every feature works without network access.
