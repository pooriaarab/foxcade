import { test } from "node:test";
import assert from "node:assert/strict";
import worldmap, { generate, snapToRoad } from "../../src/games/citymap-real.js";
import { validate } from "../../src/pipeline/validate.js";
import { THEME_IDS } from "../../src/games/themes.js";

const cfg = validate({ place: "", vehicle: "taxi", view: "3d", jobs: 4, zoom: 14, carSpeed: 5, fuel: 140, lives: 3, timePerJob: 25, deliveriesPerLevel: 3, theme: "neon", title: "World Run" }, worldmap.schema);

test("worldmap is a map game type with no 2D engine and no three", () => {
  assert.equal(worldmap.type, "map");
  assert.equal(worldmap.engine, undefined, "must not expose a 2D engine");
  assert.equal(worldmap.three, undefined, "must not be a three game");
  assert.equal(typeof worldmap.map.generate, "function");
  assert.equal(typeof worldmap.map.mount, "function");
});

test("generate is pure and deterministic from the seed", () => {
  assert.deepEqual(generate(cfg, 42), generate(cfg, 42));
  assert.notDeepEqual(generate(cfg, 1), generate(cfg, 2));
});

test("the pure path imports no maplibre (module loads fine under node)", () => {
  // If generate() reached for the vendored UMD, importing this module or calling
  // generate() under node (no DOM, no globalThis.maplibregl) would throw.
  assert.equal(globalThis.maplibregl, undefined, "no maplibre global leaked into node");
  assert.doesNotThrow(() => generate(cfg, 7));
});

test("vehicle, view and mechanics fields are carried through with sane defaults", () => {
  const c = generate(cfg, 7);
  assert.equal(c.vehicle, "taxi", "vehicle honoured");
  assert.equal(c.view, "3d", "view honoured");
  assert.equal(c.lives, cfg.lives);
  assert.equal(c.timePerJob, cfg.timePerJob);
  assert.equal(c.deliveriesPerLevel, cfg.deliveriesPerLevel);
  // Unknown enums fall back to the schema/generate defaults, never crash.
  assert.equal(generate({ ...cfg, vehicle: "spaceship" }, 1).vehicle, "car", "unknown vehicle → car");
  assert.equal(generate({ ...cfg, view: "weird" }, 1).view, "3d", "unknown view → 3d");
  const d = validate({}, worldmap.schema);
  assert.equal(d.vehicle, "car");
  assert.equal(d.view, "3d");
  assert.equal(d.lives, worldmap.schema.lives.default);
});

test("generate produces the requested number of jobs, each a pickup + dropoff", () => {
  const c = generate(cfg, 7);
  assert.ok(Array.isArray(c.jobs) && c.jobs.length === cfg.jobs, "job count honoured");
  for (const j of c.jobs) {
    for (const p of [j.pickup, j.dropoff]) {
      assert.equal(typeof p.lat, "number");
      assert.equal(typeof p.lng, "number");
      // Jobs sit within the jitter radius of the chosen city centre.
      assert.ok(Math.abs(p.lat - c.lat) <= 0.006 + 1e-9, "pickup/dropoff near centre lat");
      assert.ok(Math.abs(p.lng - c.lng) <= 0.006 + 1e-9, "pickup/dropoff near centre lng");
    }
  }
});

test("location is a real place; a named place is honoured", () => {
  const c = generate(cfg, 3);
  assert.equal(typeof c.place, "string");
  assert.ok(c.place.length > 0, "place is set");
  assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lng), "real coordinates");
  const named = validate({ place: "tokyo", jobs: 2, theme: "neon", title: "T" }, worldmap.schema);
  assert.equal(generate(named, 999).place, "Tokyo", "case-insensitive named place wins over the seed");
});

test("scalar tuning is carried through from cfg", () => {
  const c = generate(cfg, 3);
  assert.equal(c.theme, cfg.theme);
  assert.equal(c.title, cfg.title);
  assert.equal(c.zoom, cfg.zoom);
  assert.equal(c.fuel, cfg.fuel);
  assert.ok(THEME_IDS.includes(c.theme), "theme is a known id");
});

test("schema defaults validate to a playable config", () => {
  const d = validate({}, worldmap.schema);
  const c = generate(d, 1);
  assert.equal(c.jobs.length, worldmap.schema.jobs.default);
  assert.equal(c.fuel, worldmap.schema.fuel.default);
  assert.equal(c.zoom, worldmap.schema.zoom.default);
});

test("snapToRoad projects a delivery pin onto the nearest road, and no-ops without roads", () => {
  // A due-east road; a pin 0.002deg north of it at lng 0.005 should snap onto it
  // (lat -> 0) while keeping its along-road position (lng ~0.005). This is what
  // placeJobMarkers does so pickups/dropoffs never sit in water/parks off-street.
  const road = { geometry: { type: "LineString", coordinates: [[0, 0], [0.01, 0]] } };
  const snapped = snapToRoad({ lng: 0.005, lat: 0.002 }, [road]);
  assert.ok(Math.abs(snapped.lat - 0) < 1e-4, "snapped onto the road centreline (lat->0)");
  assert.ok(Math.abs(snapped.lng - 0.005) < 1e-4, "kept its along-road position");
  // No queryable road geometry (roads not loaded / truly road-less) -> graceful
  // fallback: the raw pin is returned unchanged (same reference).
  const raw = { lng: 0.005, lat: 0.002 };
  assert.equal(snapToRoad(raw, []), raw, "no roads -> raw pin (fallback path)");
});

test("mini-GTA fields (police/boost/timeOfDay) carry through, clamp, and don't shift jobs", () => {
  const d = validate({}, worldmap.schema);
  const c = generate(d, 5);
  assert.equal(c.police, worldmap.schema.police.default);
  assert.equal(c.boost, worldmap.schema.boost.default);
  assert.equal(c.timeOfDay, worldmap.schema.timeOfDay.default);
  // Clamp + enum fallback via validate.
  assert.equal(validate({ police: 99 }, worldmap.schema).police, 4);
  assert.equal(validate({ boost: 9 }, worldmap.schema).boost, 2);
  assert.equal(validate({ timeOfDay: "dusk" }, worldmap.schema).timeOfDay, "auto");
  // The new fields consume no rng: jobs + traffic stay identical to the baseline.
  const base = generate(cfg, 42);
  const withGta = generate({ ...cfg, police: 4, boost: 2, timeOfDay: "night" }, 42);
  assert.deepEqual(withGta.jobs, base.jobs, "jobs unchanged by mini-GTA fields");
  assert.deepEqual(withGta.traffic, base.traffic, "traffic unchanged by mini-GTA fields");
});
