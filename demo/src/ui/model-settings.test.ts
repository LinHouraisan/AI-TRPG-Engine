import { expect, test } from "bun:test";
import { deepSeekPreset, providerPatchForType, secretStateAfterSave } from "./model-settings-state";

test("DeepSeek preset uses the OpenAI-compatible endpoint and current flash model", () => {
  expect(deepSeekPreset()).toEqual({
    providerType: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    modelId: "deepseek-v4-flash",
  });
});

test("saving a secret clears its plaintext from renderer state", () => {
  expect(secretStateAfterSave("sk-test-secret")).toBe("");
});

test("selecting DeepSeek also replaces stale Ollama connection fields", () => {
  expect(providerPatchForType("deepseek")).toEqual(deepSeekPreset());
});
