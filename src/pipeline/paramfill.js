export async function fill(prompt, game, model, nudge = "") {
  const shots = (game.skill.examples || [])
    .map(e => `Request: ${e.prompt}\nJSON: ${JSON.stringify(e.json)}`)
    .join("\n\n");
  const system = `${game.skill.system}\nReturn ONLY a JSON object. No prose.${shots ? "\n\nExamples:\n" + shots : ""}`;
  const user = nudge ? `${prompt}\n\n(Adjust: ${nudge})` : prompt;
  return await model.generateAsync(system, user);
}
