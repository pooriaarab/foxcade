import { RealModel, HeuristicModel, ChromeAIModel } from "./model.js";

function extensionApi() {
  return globalThis.browser ?? globalThis.chrome;
}

export async function probe(onProgress) {
  if (globalThis.__FORGE_MODEL__) return { model: globalThis.__FORGE_MODEL__, mode: "mock" };
  try {
    const api = extensionApi();
    if (api?.trial?.ml && api?.permissions?.request) {
      const granted = await api.permissions.request({ permissions: ["trialML"] });
      if (granted) return { model: new RealModel(undefined, onProgress), mode: "local-ai" };
    }
  } catch (e) { /* fall through */ }
  try {
    if (await ChromeAIModel.isAvailable()) return { model: new ChromeAIModel(), mode: "local-ai" };
  } catch (e) { /* fall through */ }
  // TODO: WebLLM/WebGPU portable backend
  return { model: new HeuristicModel(), mode: "heuristic" };
}
