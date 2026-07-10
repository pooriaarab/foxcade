// Best-effort JSON extraction: pull first {...} block, then JSON.parse.
function coerceObject(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  const m = raw.match(/\{[\s\S]*\}/);
  const text = m ? m[0] : raw;
  try { return JSON.parse(text); } catch { return {}; }
}

export function validate(raw, schema) {
  const src = coerceObject(raw);
  const out = {};
  for (const [key, spec] of Object.entries(schema)) {
    const v = src[key];
    if (spec.type === "number") {
      const n = typeof v === "number" ? v : Number(v);
      out[key] = Number.isFinite(n)
        ? Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n))
        : spec.default;
    } else {
      const ok = typeof v === "string" && v.length > 0 && (!spec.enum || spec.enum.includes(v));
      out[key] = ok ? v : spec.default;
    }
  }
  return out;
}
