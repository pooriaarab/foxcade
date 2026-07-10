export async function route(prompt, model, registry) {
  const keys = Object.keys(registry);
  const sys = `Pick the single best game type for the user's request. Reply with EXACTLY one of: ${keys.join(", ")}. No other text.`;
  const answer = ((await model.generateAsync(sys, prompt)) || "").trim().toLowerCase();
  if (keys.includes(answer)) return answer;

  const p = prompt.toLowerCase();
  let best = keys[0], bestScore = 0;
  for (const key of keys) {
    const words = [key, ...(registry[key].meta?.keywords || []), (registry[key].meta?.label || "")].join(" ").toLowerCase().split(/\W+/);
    const score = words.reduce((s, w) => s + (w && p.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return best;
}
