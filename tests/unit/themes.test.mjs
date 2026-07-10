import { test } from "node:test";
import assert from "node:assert/strict";
import { ART_SOURCES, getTheme, SCENES, THEME_FIELD, THEME_IDS, themeForSeed } from "../../src/games/themes.js";

const PALETTE_FIELDS = ["bg", "fg", "accent", "hud", "particles"];
const THEME_FIELDS = ["palette", "skin", "art", "sprites", "bg", "audio", "font"];
const SKINS = ["glow", "sharp", "round", "flat", "pixel", "sketch"];

test("getTheme returns a complete theme for every known id", () => {
  for (const id of THEME_IDS) {
    const theme = getTheme(id);

    for (const field of THEME_FIELDS) {
      assert.ok(field in theme, `${id} should include ${field}`);
    }
    for (const field of PALETTE_FIELDS) {
      assert.equal(typeof theme.palette[field], "string", `${id}.palette.${field} should be a string`);
      assert.ok(theme.palette[field].length > 0, `${id}.palette.${field} should not be empty`);
    }
    assert.equal(typeof theme.skin, "string", `${id}.skin should be a string`);
    assert.ok(theme.skin.length > 0, `${id}.skin should not be empty`);
    assert.equal(theme.sprites, null, `${id}.sprites should stay null until the sprite batch`);
    assert.equal(typeof theme.bg, "string", `${id}.bg should be a string`);
    assert.equal(typeof theme.audio, "string", `${id}.audio should be a string`);
    assert.equal(typeof theme.font, "string", `${id}.font should be a string`);
  }
});

test("getTheme returns the retro fallback for an unknown id", () => {
  assert.deepEqual(getTheme("garbage-theme-id"), getTheme("retro"));
});

test("themeForSeed is deterministic and returns known ids", () => {
  assert.equal(themeForSeed(123456, 4), themeForSeed(123456, 4));

  for (const seed of [0, 1, 123456, 0xffffffff]) {
    for (let index = 0; index < THEME_IDS.length * 2; index++) {
      assert.ok(THEME_IDS.includes(themeForSeed(seed, index)));
    }
  }
});

test("THEME_FIELD gates to the shared theme id list", () => {
  assert.equal(THEME_FIELD.type, "string");
  assert.equal(THEME_FIELD.enum, THEME_IDS);
  assert.equal(THEME_FIELD.default, "retro");
});

// Shuffle must change the ART STYLE + SPRITE SOURCE per theme, not just colors:
// every theme carries a valid art source and a valid, known skin.
test("every theme has a valid art source and a known skin", () => {
  for (const id of THEME_IDS) {
    const theme = getTheme(id);
    assert.ok(ART_SOURCES.includes(theme.art), `${id}.art (${theme.art}) should be one of ${ART_SOURCES.join("/")}`);
    assert.ok(SKINS.includes(theme.skin), `${id}.skin (${theme.skin}) should be a known skin`);
  }
  assert.deepEqual(ART_SOURCES, ["vector", "pixel", "photo"]);
});

// Every theme names a real background scene (asset image) drawn behind the game;
// the id must be one the renderer knows, so drawBackground can load it or fall
// back to the palette. This is the pure half of the background upgrade.
test("every theme maps to a known background scene", () => {
  assert.ok(SCENES.length > 0, "there is at least one scene");
  for (const id of THEME_IDS) {
    const theme = getTheme(id);
    assert.equal(typeof theme.scene, "string", `${id}.scene should be a string`);
    assert.ok(SCENES.includes(theme.scene), `${id}.scene (${theme.scene}) should be a known scene`);
  }
});

// Shuffling should be dramatic: the 12 themes must span multiple art sources and
// multiple skins, so consecutive cards look clearly different, not recolored.
test("themes span multiple art sources and skins", () => {
  const arts = new Set(THEME_IDS.map(id => getTheme(id).art));
  const skins = new Set(THEME_IDS.map(id => getTheme(id).skin));
  for (const a of ART_SOURCES) assert.ok(arts.has(a), `at least one theme should use art "${a}"`);
  assert.ok(skins.size >= 4, `themes should use several distinct skins (got ${skins.size})`);
});
