export class MockModel {
  constructor(fixtures = {}) { this.fixtures = fixtures; }
  async generateAsync(system, user) { return this.generate(system, user); }
  generate(system, user) {
    if (user in this.fixtures) return this.fixtures[user];
    return this.fixtures.__default ?? "";
  }
}
export class HeuristicModel {
  generate() { return ""; }
  async generateAsync() { return ""; }
}
export class ChromeAIModel {
  constructor() { this.session = null; }
  static promptApi() {
    const ai = globalThis.ai;
    const candidates = [
      globalThis.LanguageModel,
      ai?.languageModel,
      ai?.LanguageModel,
      ai
    ];
    return candidates.find(api =>
      api && typeof api.availability === "function" && typeof api.create === "function"
    ) ?? null;
  }
  // Only "available"/"readily" mean the model is ready NOW. "downloadable" /
  // "after-download" would make create() kick off a multi-GB Gemini-Nano download
  // with no progress UI — the user just sees a hang — so we treat those as
  // unavailable and let probe() fall back to the heuristic model instead.
  static isReady(availability) {
    const a = String(availability).toLowerCase();
    return a === "available" || a === "readily";
  }
  static async isAvailable() {
    const api = ChromeAIModel.promptApi();
    if (!api) return false;
    try {
      return ChromeAIModel.isReady(await api.availability());
    } catch {
      return false;
    }
  }
  async ensure() {
    if (this.session) return this.session;
    const api = ChromeAIModel.promptApi();
    if (!api) throw new Error("Chrome built-in AI Prompt API is unavailable");
    const availability = await api.availability();
    if (!ChromeAIModel.isReady(availability)) {
      throw new Error("Chrome built-in AI Prompt API is unavailable");
    }
    const session = await api.create();
    if (!session || typeof session.prompt !== "function") {
      throw new Error("Chrome built-in AI Prompt API is unavailable");
    }
    this.session = session;
    return session;
  }
  async generateAsync(system, user) {
    const session = await this.ensure();
    const prompt = user == null ? system : `${system}\n\nRequest: ${user}`;
    const res = await session.prompt(prompt);
    return typeof res === "string" ? res : String(res ?? "");
  }
  generate() { throw new Error("ChromeAIModel is async-only; use generateAsync"); }
}
export class RealModel {
  // Model must be from a Firefox-blessed HF org (Mozilla/Xenova) AND ship an ONNX
  // file for the chosen dtype. Qwen1.5-0.5B-Chat is small, chat-tuned, and has a
  // q4 build (onnx/model_q4.onnx). dtype MUST match an existing file — the engine
  // otherwise defaults to model_quantized.onnx, which many newer repos don't have.
  constructor(modelId = "Xenova/Qwen1.5-0.5B-Chat", onProgress, dtype = "q4") {
    this.modelId = modelId; this.ready = false; this.onProgress = onProgress; this.dtype = dtype;
  }
  async ensure() {
    if (this.ready) return;
    const api = globalThis.browser;
    if (!api?.trial?.ml?.createEngine) throw new Error("Browser trial ML is unavailable");
    if (this.onProgress && api.trial.ml.onProgress?.addListener) api.trial.ml.onProgress.addListener(this.onProgress);
    await api.trial.ml.createEngine({
      modelHub: "huggingface", taskName: "text-generation", modelId: this.modelId, dtype: this.dtype
    });
    this.ready = true;
  }
  async generateAsync(system, user) {
    await this.ensure();
    const api = globalThis.browser;
    if (!api?.trial?.ml?.runEngine) throw new Error("Browser trial ML is unavailable");
    const prompt = `${system}\n\nRequest: ${user}\nJSON:`;
    const res = await api.trial.ml.runEngine({ args: [prompt] });
    return typeof res === "string" ? res : (res?.[0]?.generated_text ?? res?.generated_text ?? JSON.stringify(res));
  }
  generate() { throw new Error("RealModel is async-only; use generateAsync"); }
}
