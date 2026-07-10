import { THEME_FIELD, THEME_IDS, getPalette, THEMES } from "./themes.js";
import { assetUrl } from "./atlas.js";
import { siren, unlockAudio } from "./audio.js";

const THEME_CHOICES = THEME_IDS.join("|");
const VEHICLE_IDS = ["car", "taxi", "bike", "truck", "scooter"];
const VEHICLE_CHOICES = VEHICLE_IDS.join("|");
const VIEW_CHOICES = "flat|3d";

// A small built-in list of real places. generate() picks one deterministically
// from the seed (or by name if the prompt names one), so the pure path never
// needs the network — only mount() fetches live map tiles.
const LOCATIONS = [
  { name: "San Francisco", lat: 37.7749, lng: -122.4194 },
  { name: "New York", lat: 40.7128, lng: -74.006 },
  { name: "London", lat: 51.5074, lng: -0.1278 },
  { name: "Paris", lat: 48.8566, lng: 2.3522 },
  { name: "Tokyo", lat: 35.6762, lng: 139.6503 },
  { name: "Berlin", lat: 52.52, lng: 13.405 },
  { name: "Amsterdam", lat: 52.3676, lng: 4.9041 },
  { name: "Sydney", lat: -33.8688, lng: 151.2093 },
  { name: "Barcelona", lat: 41.3874, lng: 2.1686 },
  { name: "Rome", lat: 41.9028, lng: 12.4964 },
  { name: "Chicago", lat: 41.8781, lng: -87.6298 },
  { name: "Toronto", lat: 43.6532, lng: -79.3832 },
  { name: "Mexico City", lat: 19.4326, lng: -99.1332 },
  { name: "Sao Paulo", lat: -23.5558, lng: -46.6396 },
  { name: "Buenos Aires", lat: -34.6037, lng: -58.3816 },
  { name: "Cairo", lat: 30.0444, lng: 31.2357 },
  { name: "Istanbul", lat: 41.0082, lng: 28.9784 },
  { name: "Dubai", lat: 25.2048, lng: 55.2708 },
  { name: "Mumbai", lat: 19.076, lng: 72.8777 },
  { name: "Singapore", lat: 1.3521, lng: 103.8198 },
  { name: "Hong Kong", lat: 22.3193, lng: 114.1694 },
  { name: "Seoul", lat: 37.5665, lng: 126.978 }
];

// Deterministic PRNG (mulberry32): pure integer math, no Math.random/Date.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r5 = n => Math.round(n * 1e5) / 1e5;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Scoring + world knobs. Positions are in degrees so they compose directly with
// the map's lng/lat. Distances are treated as planar at city scale — lng is
// scaled by cos(lat) (LNG_SCALE) wherever a real distance matters.
// ponytail: flat degree stepping, no great-circle math — fine at city scale;
// upgrade to metres if a location near the poles ever feels off.
const REACH = 0.0009;   // deg: how close counts as "arrived" (~100m; forgiving)
const JITTER = 0.006;   // deg: max job offset from the city centre (~600m)
const REFUEL = 60;      // fuel restored per completed delivery / life loss
const DRAIN = 4.8;      // fuel burned per second while driving (base level)
const CRASH_FUEL = 18;  // fuel lost when hitting a traffic car

function pickLocation(place, rng) {
  if (typeof place === "string" && place.trim()) {
    const q = place.trim().toLowerCase();
    const hit = LOCATIONS.find(l => l.name.toLowerCase().includes(q));
    if (hit) return hit;
  }
  return LOCATIONS[Math.floor(rng() * LOCATIONS.length) % LOCATIONS.length];
}

// Seeded point near the centre: rng in [0,1) → offset in [-JITTER, JITTER].
function near(center, rng) {
  return {
    lat: r5(center.lat + (rng() * 2 - 1) * JITTER),
    lng: r5(center.lng + (rng() * 2 - 1) * JITTER)
  };
}

// PURE + deterministic: same (cfg, seed) → same config. No maplibre import, no
// Math.random, no Date — safe to import and unit-test under node. mount() reads
// this config; once the job pool is exhausted it loops from the top. Traffic is
// generated AFTER jobs so job positions stay stable regardless of density.
export function generate(cfg, seed) {
  const rng = mulberry32((seed | 0) ^ 0x7a11);
  const loc = pickLocation(cfg.place, rng);
  const center = { lat: loc.lat, lng: loc.lng };
  const jobs = [];
  const count = Math.max(1, Math.round(cfg.jobs));
  for (let i = 0; i < count; i++) {
    jobs.push({ pickup: near(center, rng), dropoff: near(center, rng) });
  }
  const trafficN = clamp(Math.round(cfg.trafficDensity ?? 3), 0, 8);
  const traffic = [];
  for (let i = 0; i < trafficN; i++) {
    const p = near(center, rng);
    traffic.push({ lat: p.lat, lng: p.lng, dir: r5(rng() * 360), spd: r5(0.5 + rng() * 0.5) });
  }
  const vehicle = VEHICLE_IDS.includes(cfg.vehicle) ? cfg.vehicle : "car";
  const view = cfg.view === "flat" ? "flat" : "3d";
  // Mini-GTA fields. These consume NO rng, so jobs + traffic positions above stay
  // byte-identical regardless of these values. Police spawn dynamically in the
  // render layer (seeded from `seed`), so none are generated here.
  const police = clamp(Math.round(cfg.police ?? 2), 0, 4);
  const timeOfDay = ["day", "night", "auto"].includes(cfg.timeOfDay) ? cfg.timeOfDay : "auto";
  const boost = clamp(cfg.boost ?? 1.6, 1, 2);
  return {
    title: cfg.title,
    theme: cfg.theme,
    place: loc.name,
    lat: center.lat,
    lng: center.lng,
    zoom: cfg.zoom ?? 17,
    view,
    vehicle,
    carSpeed: cfg.carSpeed ?? 4,
    fuel: Math.round(cfg.fuel ?? 120),
    lives: Math.round(cfg.lives ?? 3),
    timePerJob: Math.round(cfg.timePerJob ?? 30),
    deliveriesPerLevel: Math.round(cfg.deliveriesPerLevel ?? 3),
    trafficDensity: trafficN,
    police,
    timeOfDay,
    boost: r5(boost),
    jobs,
    traffic,
    seed: seed | 0
  };
}

// A small DOM overlay near the map. Kept in the DOM (not on the WebGL map
// surface) so it still shows when tiles or WebGL are unavailable.
function makeEl(cls, text) {
  const el = document.createElement("div");
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// Per-vehicle silhouette: a plain HTML/CSS shape (no emoji, no image request).
// A nose triangle points in the travel direction (marker rotation follows the
// car's heading). Colour + proportions differ per vehicle so each reads
// distinctly. `color` comes from the theme palette.
const VEHICLE_SPEC = {
  car:     { w: 16, h: 26, radius: 5, tint: p => p.fg },
  taxi:    { w: 16, h: 26, radius: 5, tint: () => "#f5c518" },
  bike:    { w: 8,  h: 22, radius: 4, tint: p => p.accent },
  truck:   { w: 20, h: 34, radius: 3, tint: p => p.hud },
  scooter: { w: 9,  h: 20, radius: 6, tint: p => p.particles || p.accent }
};

function vehicleEl(vehicle, pal) {
  const spec = VEHICLE_SPEC[vehicle] || VEHICLE_SPEC.car;
  const color = spec.tint(pal);
  const el = makeEl("worldmap-vehicle");
  el.style.cssText =
    `width:${spec.w}px;height:${spec.h}px;background:${color};border:2px solid #050609;` +
    `border-radius:${spec.radius}px;box-shadow:0 0 0 2px #ffffffaa;position:relative`;
  const nose = document.createElement("div");
  nose.style.cssText =
    `position:absolute;left:50%;top:-8px;transform:translateX(-50%);width:0;height:0;` +
    `border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid ${color}`;
  el.append(nose);
  return el;
}

// AI traffic car: a fixed amber body with NO nose and NO white halo, so it never
// reads as the player's vehicle regardless of theme.
function trafficEl() {
  const el = makeEl("worldmap-traffic");
  el.style.cssText =
    "width:14px;height:22px;background:#e8a33d;border:2px solid #050609;border-radius:4px";
  return el;
}

// Police car: a dark-blue body with a light bar that flashes red/blue (toggled
// each frame in movePolice). Distinct from the amber traffic + the player car.
function policeEl() {
  const el = makeEl("worldmap-police");
  el.style.cssText =
    "position:relative;width:15px;height:23px;background:#16305f;border:2px solid #050609;border-radius:4px";
  const bar = document.createElement("div");
  bar.className = "worldmap-lightbar";
  bar.style.cssText =
    "position:absolute;left:50%;top:3px;transform:translateX(-50%);width:11px;height:5px;border-radius:2px;background:#ff2b2b";
  el.append(bar);
  return el;
}

// Waiting passenger (pickup): a little head + body figure, distinct from the
// destination pin.
function personEl(color) {
  const el = makeEl("worldmap-person");
  el.style.cssText = "position:relative;width:14px;height:22px";
  const head = document.createElement("div");
  head.style.cssText =
    `position:absolute;left:50%;top:0;transform:translateX(-50%);width:8px;height:8px;` +
    `border-radius:50%;background:${color};border:2px solid #050609`;
  const body = document.createElement("div");
  body.style.cssText =
    `position:absolute;left:50%;top:8px;transform:translateX(-50%);width:12px;height:14px;` +
    `border-radius:6px 6px 4px 4px;background:${color};border:2px solid #050609;box-shadow:0 0 0 2px #ffffffaa`;
  el.append(body, head);
  return el;
}

// Drop-off destination: a classic teardrop map pin.
function destEl(color) {
  const el = makeEl("worldmap-dest");
  el.style.cssText =
    `width:16px;height:16px;background:${color};border:2px solid #050609;` +
    `border-radius:50% 50% 50% 0;transform:rotate(45deg);box-shadow:0 0 0 2px #ffffffaa`;
  return el;
}

const DEG = 180 / Math.PI;
const LNG_SCALE = lat => Math.cos(lat * Math.PI / 180) || 1; // east-west metric
const KMH = 400748; // deg/sec → km/h (≈111.319 km/deg × 3.6) for the speedometer

// Shortest signed turn (deg) from a to b, in (-180, 180].
function angleDiff(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
const emptyLine = () => ({ type: "Feature", geometry: { type: "LineString", coordinates: [] } });

// Nearest point on segment ab to p, all in a scaled-planar {x,y} space. Returns
// the projected point and the clamped parameter t.
function nearestOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: ax + t * dx, y: ay + t * dy };
}

// Nearest point across a set of queried road line features to (lng,lat).
// Returns { lng, lat, dist(deg), dir(deg heading of the segment) } or null when
// no usable road geometry is nearby. Handles LineString + MultiLineString; lng
// is scaled by cos(lat) so `dist` is a fair planar degree distance.
function nearestOnRoads(lng, lat, feats) {
  const s = LNG_SCALE(lat);
  const px = lng * s, py = lat;
  let best = null;
  for (const f of feats) {
    const g = f?.geometry;
    if (!g) continue;
    const lines = g.type === "LineString" ? [g.coordinates]
      : g.type === "MultiLineString" ? g.coordinates : null;
    if (!lines) continue;
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        const n = nearestOnSeg(px, py, a[0] * s, a[1], b[0] * s, b[1]);
        const d = Math.hypot(px - n.x, py - n.y);
        if (!best || d < best.d) {
          best = { d, x: n.x, y: n.y, dir: Math.atan2(b[0] - a[0], b[1] - a[1]) * DEG };
        }
      }
    }
  }
  return best ? { lng: best.x / s, lat: best.y, dist: best.d, dir: best.dir } : null;
}

// Project a job pin ({lng,lat}) onto the nearest road so pickups/dropoffs always
// sit ON a street (never in water/parks/plazas that a car can't reach). Pure and
// deterministic; returns the raw point unchanged when no road geometry is nearby
// (roads not yet loaded, or a truly road-less spot) so it degrades gracefully.
export function snapToRoad(pt, feats) {
  const r = nearestOnRoads(pt.lng, pt.lat, feats);
  return r ? { lng: r5(r.lng), lat: r5(r.lat) } : pt;
}

// Impure render layer. Lazy-imports the vendored MapLibre GL **CSP build** (UMD
// → global `maplibregl`) so base games never pay for the ~700KB bundle.
// MapLibre normally runs its tile worker from a blob: URL, which the extension
// CSP blocks; the CSP build ships the worker as a SEPARATE FILE, and we point
// setWorkerUrl at the packaged same-origin copy BEFORE creating the map, so it
// passes worker-src 'self' in dev AND packaged. This is the ONE game that
// touches the network: OpenFreeMap serves free, no-key vector tiles. Any
// failure (import, WebGL, engine, road query) degrades to a graceful fallback —
// the feed never crashes. Teardown is race-safe if destroy() runs before the
// async import.
function mount(container, config, { onDone } = {}) {
  let disposed = false;
  let raf = 0;
  let cleanup = () => {};
  const handle = {
    destroy() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      cleanup();
    }
  };

  const fail = msg => {
    const notice = makeEl("three-notice", msg);
    container.parentNode?.append(notice);
    cleanup = () => notice.remove();
    if (disposed) cleanup();
  };

  (async () => {
    // Inject the MapLibre stylesheet once (map/control/marker layout needs it).
    if (!document.getElementById("maplibre-css")) {
      const link = document.createElement("link");
      link.id = "maplibre-css";
      link.rel = "stylesheet";
      link.href = assetUrl("vendor/maplibre-gl.css");
      document.head.append(link);
    }

    // Feature-detect WebGL up front so a device without it gets a clean notice
    // instead of a MapLibre throw.
    let gl = null;
    try {
      const probe = document.createElement("canvas");
      gl = probe.getContext("webgl2") || probe.getContext("webgl");
    } catch { gl = null; }
    if (!gl) return fail("Map unavailable — WebGL not supported here.");

    let maplibregl;
    try {
      await import("../vendor/maplibre-gl-csp.js"); // UMD side-effect → global
      maplibregl = globalThis.maplibregl;
    } catch (e) {
      console.error("worldmap: maplibre failed to load", e);
      return fail("Map engine unavailable.");
    }
    if (disposed) return;
    if (!maplibregl?.Map) return fail("Map engine unavailable.");

    // Same-origin worker → passes worker-src 'self'. MUST be set before new Map.
    try { maplibregl.setWorkerUrl(assetUrl("vendor/maplibre-gl-csp-worker.js")); }
    catch (e) { console.warn("worldmap: setWorkerUrl", e); }

    const pal = getPalette(config.theme);
    const is3D = config.view !== "flat";
    const PITCH = is3D ? 65 : 0;
    let map;
    try {
      map = new maplibregl.Map({
        container,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [config.lng, config.lat],
        zoom: config.zoom,
        pitch: PITCH,
        bearing: 0,
        attributionControl: true
      });
      // Tile/style/network failures surface here, NOT as uncaught errors.
      map.on("error", e => console.warn("worldmap: map error", e?.error || e));
    } catch (e) {
      console.error("worldmap: map init failed", e);
      return fail("Map unavailable here.");
    }

    // Seat the car in the lower third of the view so the road ahead is visible
    // (chase-cam framing). Padding is applied on every camera update below.
    const padTop = Math.round((container.clientHeight || 600) * 0.34);

    // --- markers ----------------------------------------------------------
    const car = { lat: config.lat, lng: config.lng };
    const carMarker = new maplibregl.Marker({ element: vehicleEl(config.vehicle, pal), rotationAlignment: "map" })
      .setLngLat([car.lng, car.lat]).addTo(map);
    const pickupMarker = new maplibregl.Marker({ element: personEl(pal.accent), anchor: "bottom" })
      .setLngLat([car.lng, car.lat]).addTo(map);
    const dropoffMarker = new maplibregl.Marker({ element: destEl(pal.hud), anchor: "bottom" })
      .setLngLat([car.lng, car.lat]).addTo(map);

    // Deterministic AI traffic. Positions/headings come from generate(); they
    // move along roads at runtime (snapped like the player) and cost the player
    // on contact. Bounded by trafficDensity so the marker/query load stays small.
    const trafficCars = config.traffic.map(t => ({
      lng: t.lng, lat: t.lat, heading: t.dir, spd: t.spd,
      marker: new maplibregl.Marker({ element: trafficEl(), rotationAlignment: "map" })
        .setLngLat([t.lng, t.lat]).setRotation(t.dir).addTo(map)
    }));

    // --- overlays (DOM, layered over the map; clipped by #stagemap overflow) --
    // Positioned children of the map container. All pointer-events:none so they
    // never steal map interaction; removed in cleanup().
    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    // Night tint: a translucent dark veil whose opacity tracks nightFactor().
    const nightVeil = makeEl("worldmap-night");
    nightVeil.style.cssText =
      "position:absolute;inset:0;pointer-events:none;z-index:2;opacity:0;" +
      "background:radial-gradient(circle at 50% 60%, rgba(6,10,28,0) 20%, rgba(6,10,28,0.9) 100%)";
    container.append(nightVeil);

    // Minimap radar: car centred + heading up, blips for target/traffic/police.
    // Redrawn each frame — cheap 2D canvas, NOT a second GL map.
    const RADAR = 132, RADAR_RANGE = 0.0032; // deg mapped to the radar edge
    const radar = document.createElement("canvas");
    radar.width = radar.height = RADAR;
    radar.className = "worldmap-radar";
    radar.style.cssText =
      `position:absolute;right:8px;top:8px;width:${RADAR / 2}px;height:${RADAR / 2}px;` +
      "border-radius:50%;border:2px solid #ffffff55;background:#0a0e18cc;pointer-events:none;z-index:4";
    container.append(radar);
    const rctx = radar.getContext("2d");

    // Speedometer: big current-speed readout, bottom-centre.
    const speedo = makeEl("worldmap-speedo");
    speedo.style.cssText =
      "position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:4;" +
      "font:700 20px monospace;color:#fff;text-shadow:0 1px 3px #000;pointer-events:none;text-align:center;line-height:1";
    container.append(speedo);

    // Headlight cone (shown at night). Child of the car element so it rotates
    // with the car's heading (marker uses rotationAlignment: "map").
    const carEl = carMarker.getElement();
    const headlight = document.createElement("div");
    headlight.style.cssText =
      "position:absolute;left:50%;top:-6px;transform:translate(-50%,-100%);width:48px;height:64px;pointer-events:none;opacity:0;" +
      "background:radial-gradient(ellipse at 50% 100%, rgba(255,244,180,0.6), rgba(255,244,180,0) 72%);" +
      "clip-path:polygon(50% 100%, 0 0, 100% 0)";
    carEl.append(headlight);

    // Seeded PRNG for police spawn geometry — deterministic from the run seed, so
    // no Math.random/Date leaks into gameplay (only per-frame timing is wall-clock).
    const prng = mulberry32((config.seed | 0) ^ 0x9e37);
    const audioId = THEMES[config.theme]?.audio || "synth";
    const canSfx = () =>
      (typeof document === "undefined" || document.visibilityState === "visible") &&
      container.offsetParent !== null;

    // Day/night: "day"/"night" pin the tint; "auto" cycles it smoothly.
    const NIGHT_MODE = config.timeOfDay;
    const DAY_CYCLE = 75; // seconds for a full auto day↔night↔day
    function nightFactor(el) {
      if (NIGHT_MODE === "day") return 0;
      if (NIGHT_MODE === "night") return 1;
      const pos = (el % DAY_CYCLE) / DAY_CYCLE;      // 0..1
      return 0.5 - 0.5 * Math.cos(pos * Math.PI * 2); // 0→1→0
    }

    // --- game state -------------------------------------------------------
    let jobIndex = 0;
    let phase = "pickup";
    let score = 0;
    let fuel = config.fuel;
    let lives = config.lives;
    let level = 1;
    let deliveredThisLevel = 0;
    let combo = 0;
    let over = false;
    let ready = false;              // style + game layers loaded
    let roadLayerIds = [];          // road line layers to constrain the car onto
    let snappedEver = false;        // did road-constraint ever engage? (diagnostic)
    const trailCoords = [];         // recent path behind the car (fading trail)
    let camBearing = 0;
    let heading = 0;                // where the car's nose points (deg, 0 = north)
    let moveHeading = 0;            // velocity direction (lags heading → drift)
    let speed = 0;                  // signed scalar speed (deg/sec)
    let crashCd = 0;                // brief immunity after a traffic hit
    let trafficTurn = 0;            // round-robin index for throttled traffic snap
    let elapsed = 0;               // total seconds driven (day/night clock)
    let heat = 0;                  // wanted accumulator (speeding + crashes)
    let wanted = 0;                // wanted stars, floor(heat), for HUD/radar
    let sirenCd = 0;               // throttles the looping siren SFX
    const police = [];             // active pursuers (spawned when wanted rises)

    // Arcade driving feel. All in deg / deg-per-sec. MAXV is the headline tuning
    // knob: per carSpeed unit at full throttle (≈44 km/h per carSpeed unit → a
    // fast, fun top end that still steps stably at zoom 17 under the clamped dt).
    // ponytail: single feel constant — bump if driving feels sluggish/floaty.
    const MAXV = 0.00011;
    const maxSpeed = MAXV * config.carSpeed;
    const boostMul = config.boost;     // extra top speed while boosting (Shift)
    const accel = maxSpeed / 1.5;      // ~1.5s to top speed (snappy)
    const brakeDec = maxSpeed / 0.7;   // strong brake
    const revMax = maxSpeed * 0.4;
    const fric = maxSpeed / 3.2;       // coasting deceleration
    const MAXTURN = 165;               // deg/sec steer rate at speed

    // Road-constraint knobs (deg). Loosened so roads GUIDE, not cage: a wide
    // tolerance and a very gentle centreline pull that never fights the steer;
    // off-road slows softly instead of yanking the car back.
    const ONROAD_TOL = 0.0006;   // ~lane+shoulder half-width (wider = freer)
    const SNAP_ON = 0.04;    // very gentle pull toward the centreline while on it
    const OFF_RETURN = 0.06; // soft nudge back when off-road (loose: player can punch off-road to a stranded pin)
    const OFF_DRAG = 0.965;  // speed retained per off-road frame (gentle penalty)
    const COLLIDE = 0.00026; // traffic contact radius (~28m)
    const CATCH = 0.00028;   // police contact radius → caught (~31m)
    const MAX_STARS = 4;     // wanted ceiling

    // Timer + difficulty scale with the level. Floors keep late levels playable.
    const jobTime = () => Math.max(6, config.timePerJob * Math.pow(0.85, level - 1));
    const drainRate = () => DRAIN * (1 + (level - 1) * 0.15);
    const needed = () => config.deliveriesPerLevel + (level - 1);
    let timeLeft = jobTime();

    function currentJob() { return config.jobs[jobIndex % config.jobs.length]; }
    function target() { return phase === "pickup" ? currentJob().pickup : currentJob().dropoff; }
    // Snap this job's pickup + dropoff onto the nearest road (once roads are
    // queryable) so the timer target always sits on a driveable street. Mutating
    // the job in place keeps target()/dist() consistent with the marker. Idempotent
    // (re-snapping an on-road point stays put) and a no-op before the style loads
    // (roadsNear returns [] → snapToRoad returns the raw point).
    function placeJobMarkers() {
      const job = currentJob();
      job.pickup = snapToRoad(job.pickup, roadsNear(job.pickup.lng, job.pickup.lat));
      job.dropoff = snapToRoad(job.dropoff, roadsNear(job.dropoff.lng, job.dropoff.lat));
      pickupMarker.setLngLat([job.pickup.lng, job.pickup.lat]);
      dropoffMarker.setLngLat([job.dropoff.lng, job.dropoff.lat]);
    }
    placeJobMarkers();

    // Query road geometry within a small screen box around a lng/lat. Returns
    // [] on any failure (query can race style reloads) so callers degrade to the
    // soft constraint and never throw.
    function roadsNear(lng, lat, px = 70) {
      if (!ready || !roadLayerIds.length) return [];
      try {
        const p = map.project([lng, lat]);
        return map.queryRenderedFeatures(
          [[p.x - px, p.y - px], [p.x + px, p.y + px]],
          { layers: roadLayerIds }
        );
      } catch { return []; }
    }

    // --- 3D buildings + fading trail (once the vector style is loaded) ------
    map.on("load", () => {
      if (disposed) return;
      try {
        const style = map.getStyle();
        const layers = style?.layers || [];

        // 3D city: extrude building footprints. The Liberty style usually ships
        // its own fill-extrusion layer; only add ours if none exists and the
        // openmaptiles source is present. Guarded so a style without buildings
        // (or in flat view) never throws.
        if (is3D && map.getSource("openmaptiles") && !layers.some(l => l.type === "fill-extrusion")) {
          const firstSymbol = layers.find(l => l.type === "symbol")?.id;
          map.addLayer({
            id: "worldmap-3d-buildings",
            source: "openmaptiles",
            "source-layer": "building",
            type: "fill-extrusion",
            minzoom: 13,
            paint: {
              "fill-extrusion-color": pal.hud,
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 8],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
              "fill-extrusion-opacity": 0.6
            }
          }, firstSymbol);
        }

        // Fading trail: a short polyline of the car's RECENT path only. line-
        // gradient (needs lineMetrics) fades the old tail (progress 0) to bright
        // at the car (progress 1). Not the whole street network.
        map.addSource("worldmap-trail", { type: "geojson", lineMetrics: true, data: emptyLine() });
        map.addLayer({
          id: "worldmap-trail", type: "line", source: "worldmap-trail",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-width": 5,
            "line-gradient": ["interpolate", ["linear"], ["line-progress"],
              0, "rgba(0,0,0,0)", 0.6, pal.accent, 1, pal.fg]
          }
        });

        // Road line layers in the Liberty/OpenMapTiles schema live on the
        // "transportation" source-layer. If none are found we skip snapping and
        // driving stays free (still fully playable).
        roadLayerIds = layers
          .filter(l => l.type === "line" && l["source-layer"] === "transportation" && map.getLayer(l.id))
          .map(l => l.id);
        ready = true;
        // Roads are queryable now → re-place the first job's markers snapped onto
        // a street (the initial placeJobMarkers ran before the style loaded).
        placeJobMarkers();
      } catch (e) {
        console.warn("worldmap: layer setup failed, driving without road snapping", e);
      }
    });

    // --- input ------------------------------------------------------------
    const keys = {};
    const KEY = {
      ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
      KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down",
      ShiftLeft: "boost", ShiftRight: "boost"
    };
    const onDown = e => { if (KEY[e.code]) { keys[KEY[e.code]] = true; e.preventDefault(); unlockAudio(); } };
    const onUp = e => { if (KEY[e.code]) keys[KEY[e.code]] = false; };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);

    // --- HUD + countdown bar ---------------------------------------------
    const hud = makeEl("three-hud");
    container.parentNode?.append(hud);
    const timerWrap = makeEl("worldmap-timer");
    timerWrap.style.cssText = "width:min(100%,400px);height:8px;background:#2a2f3a;border-radius:4px;overflow:hidden;margin-top:4px";
    const timerBar = document.createElement("div");
    timerBar.style.cssText = `height:100%;background:${pal.accent};width:100%`;
    timerWrap.append(timerBar);
    container.parentNode?.append(timerWrap);

    function renderHud() {
      if (over) {
        hud.textContent = `GAME OVER - ${config.place} - Level ${level} - Score ${score}`;
        timerBar.style.width = "0%";
        speedo.textContent = "";
        return;
      }
      const comboTxt = combo > 0 ? ` - Combo x${(1 + combo * 0.5).toFixed(1)}` : "";
      // police:0 disables the wanted system, so never show the Wanted HUD then.
      const wantedTxt = (config.police > 0 && wanted > 0) ? ` - Wanted ${"*".repeat(wanted)}` : "";
      hud.textContent =
        `${config.place} - Lv ${level} - Score ${score} - Lives ${lives} - Fuel ${Math.ceil(fuel)} - ` +
        `${phase === "pickup" ? "pick up passenger" : "drop off passenger"}${comboTxt}${wantedTxt}`;
      timerBar.style.width = `${Math.max(0, Math.min(100, (timeLeft / jobTime()) * 100))}%`;
      speedo.textContent = `${Math.round(Math.abs(speed) * KMH)} km/h`;
    }
    renderHud();

    function dist(a, b) {
      const s = LNG_SCALE(a.lat);
      return Math.hypot((a.lng - b.lng) * s, a.lat - b.lat);
    }

    function endGame() {
      if (over) return;
      over = true;
      renderHud();
      onDone?.({ solved: false, score });
    }

    // Advance to the next job after a completed delivery or a lost life.
    function nextJob() {
      jobIndex++;
      phase = "pickup";
      timeLeft = jobTime();
      placeJobMarkers();
    }

    function loseLife() {
      combo = 0;
      lives -= 1;
      if (lives <= 0) { endGame(); return; }
      fuel = config.fuel;  // refill so a fuel-out isn't an instant re-death
      nextJob();
    }

    function completeDelivery() {
      const fast = timeLeft > jobTime() * 0.5;  // fast run → build the combo
      combo = fast ? combo + 1 : 0;
      score += Math.round(10 * (1 + combo * 0.5));
      fuel = Math.min(config.fuel, fuel + REFUEL);
      deliveredThisLevel += 1;
      if (deliveredThisLevel >= needed()) { level += 1; deliveredThisLevel = 0; }
      nextJob();
    }

    // Integrate arcade physics for one step: throttle/brake/reverse + speed-
    // scaled steering + friction + a slight drift (moveHeading lags heading).
    function drive(dt) {
      // Boost (Shift) raises the throttle ceiling AND the acceleration so nitro
      // feels punchy. Releasing it lets friction bleed the extra speed back down.
      const topFwd = keys.boost ? maxSpeed * boostMul : maxSpeed;
      if (keys.up) speed = Math.min(topFwd, speed + accel * (keys.boost ? 1.7 : 1) * dt);
      else if (keys.down) {
        if (speed > 0) speed = Math.max(0, speed - brakeDec * dt);
        else speed = Math.max(-revMax, speed - accel * dt);
      } else if (speed > 0) speed = Math.max(0, speed - fric * dt);
      else if (speed < 0) speed = Math.min(0, speed + fric * dt);

      // Steering: needs some speed to bite (can't spin in place); direction of
      // the turn follows travel so reversing steers intuitively.
      const grip = Math.min(1, Math.abs(speed) / (maxSpeed * 0.35));
      const turn = MAXTURN * grip * dt * Math.sign(speed || 1);
      if (keys.left) heading -= turn;
      if (keys.right) heading += turn;
      heading = ((heading % 360) + 360) % 360;
      moveHeading += angleDiff(moveHeading, heading) * Math.min(1, dt * 7);

      const rad = moveHeading / DEG;
      const cosLat = LNG_SCALE(car.lat);
      car.lat = clamp(car.lat + speed * Math.cos(rad) * dt, -85, 85);
      car.lng += speed * Math.sin(rad) * dt / cosLat;
    }

    // Constrain the car onto real streets. Snaps gently toward the road centre-
    // line while on a road; off-road (drove into a block) it slows the car and
    // gently nudges it back — loose enough to punch off-road to a stranded pin.
    // Degrades to a no-op soft constraint when no road
    // geometry is queryable — always playable, never freezes.
    function constrainToRoads() {
      const road = nearestOnRoads(car.lng, car.lat, roadsNear(car.lng, car.lat));
      if (!road) return;
      snappedEver = true;
      if (road.dist <= ONROAD_TOL) {
        car.lng += (road.lng - car.lng) * SNAP_ON;
        car.lat += (road.lat - car.lat) * SNAP_ON;
      } else {
        speed *= OFF_DRAG;
        car.lng += (road.lng - car.lng) * OFF_RETURN;
        car.lat += (road.lat - car.lat) * OFF_RETURN;
      }
    }

    // Move AI traffic along streets. Each car advances on its heading every
    // frame; one car per frame (round-robin) is snapped to the nearest road and
    // realigned to its direction, so queries stay bounded regardless of density.
    function updateTraffic(dt) {
      if (!trafficCars.length) return;
      const center = { lng: config.lng, lat: config.lat };
      for (const tc of trafficCars) {
        const v = maxSpeed * 0.55 * tc.spd;
        const rad = tc.heading / DEG;
        const cosLat = LNG_SCALE(tc.lat);
        tc.lat += v * Math.cos(rad) * dt;
        tc.lng += v * Math.sin(rad) * dt / cosLat;
        // Soft leash: keep traffic within play if it wanders off the network.
        if (dist(tc, center) > JITTER * 3) {
          const home = Math.atan2(center.lng - tc.lng, center.lat - tc.lat) * DEG;
          tc.heading += angleDiff(tc.heading, home) * 0.1;
        }
      }
      const tc = trafficCars[trafficTurn % trafficCars.length];
      trafficTurn++;
      const road = nearestOnRoads(tc.lng, tc.lat, roadsNear(tc.lng, tc.lat, 60));
      if (road) {
        tc.lng += (road.lng - tc.lng) * 0.4;
        tc.lat += (road.lat - tc.lat) * 0.4;
        let rd = road.dir;
        if (Math.abs(angleDiff(tc.heading, rd)) > 90) rd += 180; // keep moving forward
        tc.heading += angleDiff(tc.heading, rd) * 0.5;
      }
      for (const t of trafficCars) t.marker.setLngLat([t.lng, t.lat]).setRotation(t.heading);
    }

    // Spawn a police car at a seeded bearing/radius around the player, just off
    // screen. Deterministic from `prng` (seeded by config.seed).
    function spawnPolice() {
      const ang = prng() * Math.PI * 2;
      const radius = 0.0022 + prng() * 0.0012;
      const cosLat = LNG_SCALE(car.lat);
      const lng = car.lng + Math.sin(ang) * radius / cosLat;
      const lat = car.lat + Math.cos(ang) * radius;
      const marker = new maplibregl.Marker({ element: policeEl(), rotationAlignment: "map" })
        .setLngLat([lng, lat]).addTo(map);
      const p = { lng, lat, heading: 0, flash: 0, marker, bar: marker.getElement().querySelector(".worldmap-lightbar") };
      police.push(p);
    }
    function despawnAllPolice() {
      for (const p of police) p.marker.remove();
      police.length = 0;
    }

    // Wanted level: speeding heats it up, crashing spikes it, and it cools while
    // driving calmly (evasion). Police count tracks min(stars, config.police).
    function updateWanted(dt) {
      const fast = Math.abs(speed) > maxSpeed * 0.75;
      if (fast) heat = Math.min(MAX_STARS + 0.9, heat + 0.22 * dt);
      else heat = Math.max(0, heat - 0.14 * dt);
      wanted = Math.min(MAX_STARS, Math.floor(heat));
      const want = Math.min(config.police, wanted);
      while (police.length < want) spawnPolice();
      while (police.length > want) police.pop().marker.remove();
    }

    // Pursue: each police car seeks the player (slightly slower than a boosting
    // player so it's escapable), flashing its light bar red/blue.
    // ponytail: crow-drives toward the player, no per-car road snap — arcade feel,
    // add a round-robin snap like traffic if they cut corners too visibly.
    function movePolice(dt) {
      if (!police.length) return;
      const cosLat = LNG_SCALE(car.lat);
      const v = maxSpeed * 0.85;
      for (const p of police) {
        const toCar = Math.atan2((car.lng - p.lng) * cosLat, car.lat - p.lat) * DEG;
        p.heading += angleDiff(p.heading, toCar) * Math.min(1, dt * 3);
        const rad = p.heading / DEG;
        p.lat += v * Math.cos(rad) * dt;
        p.lng += v * Math.sin(rad) * dt / cosLat;
        p.flash += dt;
        if (p.bar) p.bar.style.background = (p.flash % 0.4 < 0.2) ? "#ff2b2b" : "#2b6bff";
        p.marker.setLngLat([p.lng, p.lat]).setRotation(p.heading);
      }
    }

    // Radar: car centred + heading up, blips for target / traffic / police.
    function drawRadar() {
      if (!rctx) return;
      const c = RADAR / 2, reach = c - 6;
      rctx.clearRect(0, 0, RADAR, RADAR);
      rctx.strokeStyle = "#ffffff22"; rctx.lineWidth = 1;
      rctx.beginPath(); rctx.arc(c, c, c - 4, 0, Math.PI * 2); rctx.stroke();
      const cosLat = LNG_SCALE(car.lat);
      const rad = heading / DEG, cos = Math.cos(rad), sin = Math.sin(rad);
      const plot = (lng, lat, color, size) => {
        const sx = (lng - car.lng) * cosLat / RADAR_RANGE * reach;
        const sy = (lat - car.lat) / RADAR_RANGE * reach;
        const rx = sx * cos - sy * sin, ry = sx * sin + sy * cos; // rotate → heading up
        if (Math.hypot(rx, ry) > reach) return;                   // outside range
        rctx.fillStyle = color;
        rctx.beginPath(); rctx.arc(c + rx, c - ry, size, 0, Math.PI * 2); rctx.fill();
      };
      const tgt = target();
      plot(tgt.lng, tgt.lat, phase === "pickup" ? pal.accent : pal.hud, 3.5);
      for (const tc of trafficCars) plot(tc.lng, tc.lat, "#e8a33d", 2.2);
      for (const p of police) plot(p.lng, p.lat, (p.flash % 0.4 < 0.2) ? "#ff3b3b" : "#3b7bff", 2.6);
      rctx.fillStyle = "#ffffff"; // car at centre, pointing up
      rctx.beginPath();
      rctx.moveTo(c, c - 5); rctx.lineTo(c - 4, c + 4); rctx.lineTo(c + 4, c + 4);
      rctx.closePath(); rctx.fill();
    }

    let last = 0;
    function frame(t) {
      if (disposed) return;
      const dt = last ? Math.min(0.1, (t - last) / 1000) : 0.016; // seconds, clamped
      last = t;

      if (!over) {
        crashCd = Math.max(0, crashCd - dt);

        // Day/night: advance the clock and darken the veil + raise the headlight.
        elapsed += dt;
        const nf = nightFactor(elapsed);
        nightVeil.style.opacity = (nf * 0.72).toFixed(3);
        headlight.style.opacity = nf > 0.45 ? Math.min(1, (nf - 0.45) / 0.5).toFixed(3) : "0";

        // Countdown — expiry costs a life and rolls to the next job.
        timeLeft -= dt;
        if (timeLeft <= 0) { loseLife(); renderHud(); }

        if (!over) {
          const prevLng = car.lng, prevLat = car.lat;
          drive(dt);
          if (ready) constrainToRoads();
          const moved = Math.abs(car.lng - prevLng) > 1e-9 || Math.abs(car.lat - prevLat) > 1e-9;

          if (moved) {
            carMarker.setLngLat([car.lng, car.lat]).setRotation(heading);

            // Chase cam: in 3D swing the bearing toward the heading so travel is
            // "up", the car sits low in frame, and buildings sweep past. In flat
            // just recenter. Per-frame jumpTo (not easeTo) → no stacked
            // animations; padding seats the car in the lower third of the view.
            if (is3D) {
              camBearing += angleDiff(camBearing, heading) * Math.min(1, dt * 3);
              map.jumpTo({ center: [car.lng, car.lat], bearing: camBearing, pitch: PITCH, zoom: config.zoom, padding: { top: padTop } });
            } else {
              map.setCenter([car.lng, car.lat]);
            }

            fuel = Math.max(0, fuel - drainRate() * dt);
            if (fuel <= 0) { loseLife(); renderHud(); }

            // Fading trail behind the car (recent path only).
            if (ready && !over) {
              const lastPt = trailCoords[trailCoords.length - 1];
              if (!lastPt || Math.hypot(car.lng - lastPt[0], car.lat - lastPt[1]) > REACH * 0.35) {
                trailCoords.push([car.lng, car.lat]);
                if (trailCoords.length > 45) trailCoords.shift();
                if (trailCoords.length > 1) {
                  map.getSource("worldmap-trail")?.setData({ type: "Feature", geometry: { type: "LineString", coordinates: trailCoords } });
                }
              }
            }
          }

          if (ready && !over) updateTraffic(dt);

          // Wanted + police pursuit. Siren loops (~2/sec) only while a chase is
          // on AND audible (visibility + on-screen), then falls silent by simply
          // not being called — no persistent audio node to tear down.
          if (!over) {
            updateWanted(dt);
            if (police.length) {
              movePolice(dt);
              sirenCd -= dt;
              if (sirenCd <= 0 && canSfx()) { siren(audioId); sirenCd = 0.55; }
            }
          }

          // Traffic collision: big slowdown + fuel penalty + a wanted spike (brief
          // immunity so a single contact doesn't drain repeatedly).
          if (!over && crashCd <= 0) {
            for (const tc of trafficCars) {
              if (dist(car, tc) < COLLIDE) {
                speed *= 0.15;
                combo = 0;
                fuel = Math.max(0, fuel - CRASH_FUEL);
                heat = Math.min(MAX_STARS + 0.9, heat + 1);
                crashCd = 1.2;
                if (fuel <= 0) { loseLife(); }
                break;
              }
            }
          }

          // Police catch: costs a life, clears the heat and disperses the chase
          // (fresh start). Shares crashCd so it isn't an instant double-hit.
          if (!over && crashCd <= 0 && police.length) {
            for (const p of police) {
              if (dist(car, p) < CATCH) {
                heat = 0; wanted = 0; despawnAllPolice();
                speed *= 0.3; crashCd = 1.5;
                loseLife();
                break;
              }
            }
          }

          if (!over && dist(car, target()) < REACH) {
            if (phase === "pickup") phase = "dropoff";
            else completeDelivery();
          }
          drawRadar();
          renderHud();
        }
      }
      // Once the run is over, stop rescheduling — the map is static until the
      // card is closed (destroy()), so there's no idle per-frame CPU churn.
      if (!over) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    cleanup = () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      hud.remove();
      timerWrap.remove();
      nightVeil.remove(); radar.remove(); speedo.remove();
      carMarker.remove(); pickupMarker.remove(); dropoffMarker.remove();
      for (const tc of trafficCars) tc.marker.remove();
      despawnAllPolice();
      try { map.remove(); } catch (e) { console.warn("worldmap: map teardown", e); } // frees GL context + listeners
    };

    // Expose a diagnostic for tests/debug: did road snapping ever engage?
    handle.roadSnapEngaged = () => snappedEver;

    // If destroy() landed while we were setting up, tear down now.
    if (disposed) cleanup();
  })();

  return handle;
}

export default {
  key: "worldmap",
  type: "map",
  meta: { label: "World Run", keywords: ["map", "real", "world", "gps", "drive", "delivery", "city", "street", "3d", "traffic"] },
  schema: {
    place: { type: "string", default: "" },
    vehicle: { type: "string", enum: VEHICLE_IDS, default: "car" },
    view: { type: "string", enum: ["flat", "3d"], default: "3d" },
    jobs:  { type: "number", min: 1, max: 8, default: 4 },
    zoom:  { type: "number", min: 14, max: 18, default: 17 },
    carSpeed: { type: "number", min: 2, max: 8, default: 4 },
    fuel:  { type: "number", min: 60, max: 240, default: 120 },
    lives: { type: "number", min: 1, max: 5, default: 3 },
    timePerJob: { type: "number", min: 10, max: 90, default: 30 },
    deliveriesPerLevel: { type: "number", min: 2, max: 6, default: 3 },
    trafficDensity: { type: "number", min: 0, max: 8, default: 3 },
    police: { type: "number", min: 0, max: 4, default: 2 },
    boost: { type: "number", min: 1, max: 2, default: 1.6 },
    timeOfDay: { type: "string", enum: ["day", "night", "auto"], default: "auto" },
    theme: THEME_FIELD,
    title: { type: "string", default: "World Run" }
  },
  skill: {
    system: `Configure a real-world 3D map delivery DRIVING game — a mini open-world — rendered on live vector map tiles (real streets + 3D buildings). You DRIVE a vehicle with FAST arcade physics (throttle/brake/reverse + speed-scaled steering + momentum, with a Shift NITRO boost) and the roads GUIDE you (a soft, loose snap, not a cage). Pick up a waiting passenger, then drive them to the drop-off, over and over, racing a per-delivery timer before fuel or lives run out. A steep chase camera sits behind the car and swings to its heading; a live SPEEDOMETER and a corner MINIMAP/radar (car, target, traffic, police blips) show what's around you; a fading trail marks the recent path. Deterministic AI traffic drives the streets — hitting one costs fuel, kills the combo and raises your WANTED level. Drive recklessly (speeding, crashes) and POLICE cars spawn and chase you with a flashing light bar + siren; drive calmly to shake them. A DAY/NIGHT cycle darkens the city and switches on the car's headlights at night. Consecutive fast deliveries build a combo multiplier; clearing the per-level quota advances to a harder level (shorter timer, faster fuel drain). Fields: place(a real city name like "Tokyo","Barcelona","Dubai" or "" to pick randomly),vehicle(${VEHICLE_CHOICES}),view(${VIEW_CHOICES}; 3d tilts the chase camera and extrudes buildings),jobs(1-8 passengers),zoom(14-18; 17-18 feels street-level),carSpeed(2-8; higher = faster top speed),fuel(60-240),lives(1-5),timePerJob(10-90 seconds, scales down per level),deliveriesPerLevel(2-6),trafficDensity(0-8 AI cars),police(0-4 max pursuers; 0 disables the wanted system),boost(1-2 nitro top-speed multiplier),timeOfDay(day|night|auto cycle),theme(${THEME_CHOICES}),title. Return ONLY JSON.`,
    examples: [{ prompt: "3d taxi delivery driving game around tokyo at night with heavy traffic, aggressive police and tight timers", json: { place: "Tokyo", vehicle: "taxi", view: "3d", jobs: 5, zoom: 17, carSpeed: 6, fuel: 140, lives: 3, timePerJob: 25, deliveriesPerLevel: 3, trafficDensity: 6, police: 3, boost: 1.7, timeOfDay: "night", theme: "neon", title: "Tokyo Run" } }]
  },
  map: { generate, mount }
};

// --- self-check (node --test or run directly) ---------------------------
export function _demo() {
  const cfg = { place: "", vehicle: "taxi", view: "3d", jobs: 4, zoom: 17, carSpeed: 4, fuel: 120, lives: 3, timePerJob: 30, deliveriesPerLevel: 3, trafficDensity: 3, theme: "neon", title: "T" };
  const a = generate(cfg, 42), b = generate(cfg, 42);
  console.assert(JSON.stringify(a) === JSON.stringify(b), "generate is deterministic");
  console.assert(a.jobs.length === 4, "job count honoured");
  console.assert(a.traffic.length === 3 && a.trafficDensity === 3, "traffic count honoured");
  console.assert(a.vehicle === "taxi" && a.view === "3d", "vehicle + view carried through");
  console.assert(a.lives === 3 && a.timePerJob === 30 && a.deliveriesPerLevel === 3, "mechanics fields present");
  console.assert(generate({ ...cfg, vehicle: "spaceship" }, 1).vehicle === "car", "unknown vehicle → default car");
  console.assert(generate({ ...cfg, view: "weird" }, 1).view === "3d", "unknown view → default 3d");
  console.assert(generate({ ...cfg, trafficDensity: 99 }, 1).traffic.length === 8, "traffic density clamped");

  // Mini-GTA fields: defaults, clamping and enum fallback.
  console.assert(generate({}, 1).police === 2 && generate({}, 1).boost === 1.6 && generate({}, 1).timeOfDay === "auto", "mini-gta defaults");
  console.assert(generate({ ...cfg, police: 99 }, 1).police === 4, "police clamped to 4");
  console.assert(generate({ ...cfg, boost: 9 }, 1).boost === 2, "boost clamped to 2");
  console.assert(generate({ ...cfg, timeOfDay: "dusk" }, 1).timeOfDay === "auto", "unknown timeOfDay → auto");
  // The new fields consume no rng: jobs + traffic stay byte-identical.
  console.assert(
    JSON.stringify(generate(cfg, 42).jobs) === JSON.stringify(generate({ ...cfg, police: 4, boost: 2, timeOfDay: "night" }, 42).jobs) &&
    JSON.stringify(generate(cfg, 42).traffic) === JSON.stringify(generate({ ...cfg, police: 4 }, 42).traffic),
    "mini-gta fields don't shift jobs/traffic positions");
  console.assert(LOCATIONS.some(l => l.name === a.place), "place is a real location");
  console.assert(generate({ ...cfg, place: "tokyo" }, 1).place === "Tokyo", "named place is honoured");
  console.assert(a.jobs.every(j => Math.abs(j.pickup.lat - a.lat) <= JITTER + 1e-9), "jobs near centre");

  // Nearest-point-on-road geometry: a point beside a due-east road snaps onto it
  // at the right place with an eastward heading.
  const line = { geometry: { type: "LineString", coordinates: [[0, 0], [0.01, 0]] } };
  const n = nearestOnRoads(0.005, 0.002, [line]);
  console.assert(n && Math.abs(n.lat - 0) < 1e-6 && Math.abs(n.lng - 0.005) < 1e-4, "snaps onto the road line");
  console.assert(Math.abs(angleDiff(n.dir, 90)) < 1, "road heading is east (90)");
  console.assert(nearestOnRoads(0, 0, []) === null, "no roads → null (soft-constraint path)");
}
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) _demo();
