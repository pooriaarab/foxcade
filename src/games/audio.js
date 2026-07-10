// Tiny synthesized WebAudio SFX layer. No assets — every sound is an oscillator
// blip. Fully feature-detected: silent in headless Node (no AudioContext), when
// the browser has no AudioContext, and when muted. Autoplay-safe: the context is
// created lazily and resumed on the first user gesture (unlock, called by
// makeLoop's key/pointer handlers). Wired by makeLoop for score/level/over/win.

let ctx = null;
let muted = false;

function ac() {
  if (muted) return null;
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null; // headless / unsupported → no-op
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

export function setMuted(value) {
  muted = Boolean(value);
}

export function isMuted() {
  return muted;
}

// Resume a suspended context on a user gesture. Browsers start it suspended
// until the first interaction; calling this from a keydown/pointerdown clears
// the autoplay block. No-op everywhere it can't apply.
export function unlockAudio() {
  const c = ac();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

function tone(freq, dur, type, gain) {
  const c = ac();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(g);
    g.connect(c.destination);
    const t = c.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t);
    osc.stop(t + dur);
  } catch {
    /* any WebAudio hiccup stays silent */
  }
}

// Loose per-theme flavor: the theme.audio id nudges waveform + base pitch so
// moods sound a little different. Unknown/"silent" ids map to a muted profile.
const PROFILES = {
  synth:  { type: "sawtooth", base: 1 },
  arcade: { type: "square",   base: 1.1 },
  chip:   { type: "square",   base: 1.2 },
  drone:  { type: "triangle", base: 0.7 },
  ambient:{ type: "sine",     base: 0.85 },
  soft:   { type: "sine",     base: 1 },
  bubbly: { type: "triangle", base: 1.15 },
  hum:    { type: "sine",     base: 0.8 },
  foley:  { type: "triangle", base: 1 },
  silent: null
};

// event: "score" | "level" | "win" | "over". audioId: theme.audio.
export function playSfx(event, audioId) {
  const profile = audioId in PROFILES ? PROFILES[audioId] : PROFILES.synth;
  if (!profile) return; // silent theme
  const b = profile.base;
  const type = profile.type;
  if (event === "score") tone(660 * b, 0.08, type, 0.05);
  else if (event === "level") tone(880 * b, 0.18, type, 0.06);
  else if (event === "win") tone(990 * b, 0.35, type, 0.07);
  else if (event === "over") tone(160 * b, 0.4, type, 0.07);
}

// Police siren: a short two-tone wail (~0.5s). Call it repeatedly (~2x/sec)
// from a game loop while a chase is active AND audible — stop calling to
// silence it, so no persistent node needs tearing down. Gated by the caller
// (document visibility + on-screen), like the rest of this layer.
export function siren(audioId) {
  const profile = audioId in PROFILES ? PROFILES[audioId] : PROFILES.synth;
  if (!profile) return; // silent theme
  const c = ac();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sawtooth";
    osc.connect(g);
    g.connect(c.destination);
    const t = c.currentTime;
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.linearRampToValueAtTime(940, t + 0.25);
    osc.frequency.linearRampToValueAtTime(600, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.start(t);
    osc.stop(t + 0.52);
  } catch {
    /* any WebAudio hiccup stays silent */
  }
}
