import { getPalette, THEME_FIELD, THEME_IDS } from "./themes.js";

const W = 400, H = 600;
const THEME_CHOICES = THEME_IDS.join("|");
const PASS_Z = 5;        // z past the camera (at 0) → enemy reached the cockpit
const SPREAD = 8;        // world half-width the [-1,1] lateral spawn range maps to

// Deterministic PRNG (mulberry32): pure integer math, no Math.random/Date.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = n => Math.round(n * 100) / 100;

// PURE + deterministic: same (cfg, seed) → same config. No three, no
// Math.random, no Date — safe to import and unit-test under node. mount() reads
// this config and, once waves are exhausted, loops them with rising speed for
// endless play.
export function generate(cfg, seed) {
  const rng = mulberry32((seed | 0) ^ 0x5f3d);
  const waveCount = 6;
  const waves = [];
  for (let w = 0; w < waveCount; w++) {
    const count = cfg.waveSize + w * 2;
    const enemies = [];
    for (let i = 0; i < count; i++) {
      const asteroid = rng() < 0.4;
      enemies.push({
        kind: asteroid ? "asteroid" : "ship",
        x: r2(rng() * 2 - 1),
        y: r2(rng() * 2 - 1),
        z: -40 - Math.round(rng() * 60),
        hp: asteroid ? 2 : 1,
        speed: r2(cfg.enemySpeed * (0.6 + rng() * 0.8) + w * 0.15),
        spin: asteroid ? r2((rng() - 0.5)) : 0
      });
    }
    waves.push(enemies);
  }
  return {
    title: cfg.title,
    theme: cfg.theme,
    health: cfg.health,
    fireCooldown: Math.max(6, 18 - cfg.fireRate * 1.5),
    enemySpeed: cfg.enemySpeed,
    starCount: 800,
    waves,
    seed: seed | 0
  };
}

// A small DOM notice / HUD line shown near the canvas. Kept in the DOM (not the
// WebGL surface) so it works even when WebGL is unavailable.
function makeEl(cls, text) {
  const el = document.createElement("div");
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// Impure render layer. Lazy-imports three.js so base 2D games never pay for it.
// Returns a handle synchronously; teardown is race-safe if destroy() runs before
// the async setup finishes.
function mount(canvas, config, { onDone } = {}) {
  let raf = 0;
  let disposed = false;
  let cleanup = () => {};
  const handle = {
    destroy() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      cleanup();
    }
  };

  (async () => {
    let THREE;
    try {
      THREE = await import("../vendor/three.module.js");
    } catch (e) {
      console.error("space3d: three failed to load", e);
      return fail("3D engine unavailable.");
    }
    if (disposed) return;

    // Feature-detect WebGL on THIS canvas. A failed getContext does not taint the
    // canvas, so falling back to a DOM notice is safe.
    let gl = null;
    try { gl = canvas.getContext("webgl2") || canvas.getContext("webgl"); } catch { gl = null; }
    if (!gl) return fail("3D unavailable — WebGL not supported here.");

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true });
    } catch (e) {
      console.error("space3d: renderer init failed", e);
      return fail("3D unavailable — WebGL not supported here.");
    }

    const pal = getPalette(config.theme);
    const colFg = new THREE.Color(pal.fg);
    const colEnemy = new THREE.Color(pal.accent);
    const colStar = new THREE.Color(pal.particles || pal.hud);
    renderer.setSize(W, H, false);
    renderer.setClearColor(new THREE.Color(pal.bg), 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 200);
    camera.position.set(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(0.5, 1, 1);
    scene.add(key);

    // Starfield — a moving Points cloud for a sense of flight.
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(config.starCount * 3);
    for (let i = 0; i < config.starCount; i++) {
      starPos[i * 3] = (Math.random() * 2 - 1) * 60;
      starPos[i * 3 + 1] = (Math.random() * 2 - 1) * 60;
      starPos[i * 3 + 2] = -Math.random() * 120;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: colStar, size: 0.35 });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Reticle — a ring that tracks the aim point.
    const reticleGeo = new THREE.RingGeometry(0.12, 0.18, 24);
    const reticleMat = new THREE.MeshBasicMaterial({ color: colFg, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const reticle = new THREE.Mesh(reticleGeo, reticleMat);
    scene.add(reticle);

    // Shared enemy geometries (disposed once at teardown).
    const shipGeo = new THREE.ConeGeometry(0.9, 2, 8);
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const shipMat = new THREE.MeshStandardMaterial({ color: colEnemy, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: colEnemy, flatShading: true, roughness: 1 });
    const tracerMat = new THREE.LineBasicMaterial({ color: colFg });

    const enemies = [];
    const tracers = [];
    let waveIndex = 0;
    let loops = 0;

    function spawnWave() {
      const template = config.waves[waveIndex % config.waves.length];
      const boost = loops * 0.6;
      for (const t of template) {
        const geo = t.kind === "asteroid" ? rockGeo : shipGeo;
        const mat = t.kind === "asteroid" ? rockMat : shipMat;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(t.x * SPREAD, t.y * SPREAD, t.z);
        if (t.kind === "ship") mesh.rotation.x = Math.PI / 2; // cone nose toward camera
        scene.add(mesh);
        enemies.push({ mesh, hp: t.hp, speed: t.speed + boost, spin: t.spin });
      }
      waveIndex++;
      if (waveIndex % config.waves.length === 0) loops++;
    }
    spawnWave();

    // --- input ------------------------------------------------------------
    const aim = { x: 0, y: 0 };            // NDC-space aim (-1..1)
    const keys = {};
    let cooldown = 0;
    let health = config.health;
    let score = 0;
    let over = false;
    const raycaster = new THREE.Raycaster();

    const onMove = e => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      aim.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      aim.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    const KEY = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down", Space: "fire" };
    const onDown = e => { if (KEY[e.code]) { keys[KEY[e.code]] = true; e.preventDefault(); } };
    const onUp = e => { if (KEY[e.code]) keys[KEY[e.code]] = false; };
    const onPointerDown = () => { keys.fire = true; };
    const onPointerUp = () => { keys.fire = false; };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);

    // --- HUD --------------------------------------------------------------
    const hud = makeEl("three-hud");
    canvas.parentNode?.append(hud);
    const created = [hud];
    function renderHud() {
      hud.textContent = over ? `GAME OVER — Score ${score}` : `Score ${score}   Health ${health}`;
    }
    renderHud();

    function fire() {
      cooldown = config.fireCooldown;
      raycaster.setFromCamera({ x: aim.x, y: aim.y }, camera);
      const hits = raycaster.intersectObjects(enemies.map(e => e.mesh), false);
      const end = new THREE.Vector3();
      if (hits.length) {
        end.copy(hits[0].point);
        const target = enemies.find(e => e.mesh === hits[0].object);
        if (target) {
          target.hp -= 1;
          if (target.hp <= 0) {
            scene.remove(target.mesh);
            enemies.splice(enemies.indexOf(target), 1);
            score += 1;
            renderHud();
          }
        }
      } else {
        raycaster.ray.at(60, end);
      }
      // Brief tracer from the cockpit to the impact point.
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.5, -0.5), end]);
      const line = new THREE.Line(g, tracerMat);
      scene.add(line);
      tracers.push({ line, life: 6 });
    }

    function endGame() {
      if (over) return;
      over = true;
      renderHud();
      onDone?.({ solved: false, score });
    }

    let last = 0;
    function frame(t) {
      if (disposed) return;
      const dt = last ? Math.min(3, (t - last) / 16.67) : 1;
      last = t;

      if (!over) {
        // Aim via keys (held) in addition to pointer.
        if (keys.left) aim.x = Math.max(-1, aim.x - 0.03 * dt);
        if (keys.right) aim.x = Math.min(1, aim.x + 0.03 * dt);
        if (keys.up) aim.y = Math.min(1, aim.y + 0.03 * dt);
        if (keys.down) aim.y = Math.max(-1, aim.y - 0.03 * dt);

        cooldown = Math.max(0, cooldown - dt);
        if (keys.fire && cooldown <= 0) fire();

        // Stars drift toward the camera and wrap.
        const sp = starGeo.attributes.position.array;
        for (let i = 2; i < sp.length; i += 3) {
          sp[i] += 0.6 * dt;
          if (sp[i] > 2) sp[i] = -120;
        }
        starGeo.attributes.position.needsUpdate = true;

        // Enemies advance toward the cockpit.
        for (let i = enemies.length - 1; i >= 0; i--) {
          const e = enemies[i];
          e.mesh.position.z += e.speed * 0.12 * dt;
          if (e.spin) { e.mesh.rotation.x += e.spin * 0.05 * dt; e.mesh.rotation.y += e.spin * 0.05 * dt; }
          if (e.mesh.position.z > PASS_Z) {
            scene.remove(e.mesh);
            enemies.splice(i, 1);
            health -= 1;
            renderHud();
            if (health <= 0) endGame();
          }
        }
        if (enemies.length === 0 && !over) spawnWave();

        for (let i = tracers.length - 1; i >= 0; i--) {
          const tr = tracers[i];
          tr.life -= dt;
          if (tr.life <= 0) { scene.remove(tr.line); tr.line.geometry.dispose(); tracers.splice(i, 1); }
        }
      }

      // Reticle follows the aim ray.
      reticle.position.copy(new THREE.Vector3(aim.x, aim.y, 0.5).unproject(camera));
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    cleanup = () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      for (const el of created) el.remove();
      for (const tr of tracers) tr.line.geometry.dispose();
      shipGeo.dispose(); rockGeo.dispose(); shipMat.dispose(); rockMat.dispose();
      reticleGeo.dispose(); reticleMat.dispose(); starGeo.dispose(); starMat.dispose(); tracerMat.dispose();
      renderer.dispose();
    };

    // If destroy() landed while we were setting up, tear down now.
    if (disposed) cleanup();

    function fail(msg) {
      const notice = makeEl("three-notice", msg);
      canvas.parentNode?.append(notice);
      cleanup = () => notice.remove();
      if (disposed) cleanup();
    }
  })();

  return handle;
}

export default {
  key: "space3d",
  type: "three",
  meta: { label: "3D Space Shooter", keywords: ["3d", "three", "space", "shooter", "flight", "cockpit"] },
  schema: {
    fireRate:   { type: "number", min: 1, max: 10, default: 5 },
    enemySpeed: { type: "number", min: 1, max: 8,  default: 3 },
    waveSize:   { type: "number", min: 3, max: 12, default: 5 },
    health:     { type: "number", min: 1, max: 5,  default: 3 },
    theme:      THEME_FIELD,
    title:      { type: "string", default: "Forge 3D Space" }
  },
  skill: {
    system: `Configure a first-person 3D space shooter (cockpit view, incoming ships and asteroids). Fields: fireRate(1-10),enemySpeed(1-8),waveSize(3-12),health(1-5),theme(${THEME_CHOICES}),title. Return ONLY JSON.`,
    examples: [{ prompt: "fast 3d cockpit space flight shooter", json: { fireRate: 8, enemySpeed: 5, waveSize: 7, health: 3, theme: "scifi", title: "Void Run" } }]
  },
  three: { generate, mount }
};

// --- self-check (node --test or run directly) ---------------------------
export function _demo() {
  const cfg = { fireRate: 5, enemySpeed: 3, waveSize: 5, health: 3, theme: "scifi", title: "T" };
  const a = generate(cfg, 42), b = generate(cfg, 42);
  console.assert(JSON.stringify(a) === JSON.stringify(b), "generate is deterministic");
  console.assert(a.waves[0].length === 5, "first wave uses waveSize");
  console.assert(a.waves.every(w => w.every(e => e.x >= -1 && e.x <= 1 && e.y >= -1 && e.y <= 1)), "lateral spawn in range");
  console.assert(generate(cfg, 1).seed !== generate(cfg, 2).seed, "seed carried through");
}
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) _demo();
