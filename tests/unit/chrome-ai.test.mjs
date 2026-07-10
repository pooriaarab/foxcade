import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ChromeAIModel } from "../../src/pipeline/model.js";

const originalLanguageModel = globalThis.LanguageModel;
const originalAi = globalThis.ai;

afterEach(() => {
  if (originalLanguageModel === undefined) delete globalThis.LanguageModel;
  else globalThis.LanguageModel = originalLanguageModel;
  if (originalAi === undefined) delete globalThis.ai;
  else globalThis.ai = originalAi;
});

test("ChromeAIModel returns text from global LanguageModel", async () => {
  globalThis.LanguageModel = {
    async availability() {
      return "available";
    },
    async create() {
      return {
        async prompt(text) {
          assert.equal(text, "system prompt\n\nRequest: user prompt");
          return "chrome prompt response";
        }
      };
    }
  };

  const model = new ChromeAIModel();

  assert.equal(await model.generateAsync("system prompt", "user prompt"), "chrome prompt response");
});

test("ChromeAIModel throws when Chrome Prompt API is absent", async () => {
  delete globalThis.LanguageModel;
  delete globalThis.ai;
  const model = new ChromeAIModel();

  await assert.rejects(
    () => model.generateAsync("system prompt", "user prompt"),
    /Chrome built-in AI Prompt API is unavailable/
  );
});
