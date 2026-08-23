import { afterEach, expect, test } from "bun:test";
import { initialState } from "../engine/state";
import { handleFreeTurn } from "./free-turn";
import type { KeeperConfig } from "./config";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const config: KeeperConfig = {
  enabled: true,
  protocol: "openai_compatible",
  baseUrl: "https://api.deepseek.com",
  apiKey: "test-secret",
  model: "deepseek-v4-flash",
  timeoutMs: 1000,
  temperature: 0,
  contextBudgetChars: 4000,
  stream: false,
  debugTrace: false,
};

test("free-turn keeps one task id and accepts only a visible target", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"verb":"move","target":"loc.study","text":""}' } }],
  }), { status: 200 })) as unknown as typeof fetch;
  const result = await handleFreeTurn({
    config,
    state: initialState(),
    spoken: "我绕到书房门口，先贴门听一听再进去",
    modelTaskId: "task-one",
  });
  expect(result.modelTaskId).toBe("task-one");
  expect(result.intent).toEqual({ kind: "move", to: "loc.study" });
});

test("free-turn rejects a hidden model target", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"verb":"take","target":"item.ledger","text":""}' } }],
  }), { status: 200 })) as unknown as typeof fetch;
  const result = await handleFreeTurn({
    config,
    state: initialState(),
    spoken: "把藏起来的东西拿走",
    modelTaskId: "task-hidden",
  });
  expect(result.intent.kind).toBe("unclear");
  expect(result.note).toContain("不在场");
});

test("free-turn accepts an off-script action instead of forcing clarification", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"verb":"free","target":"","text":""}' } }],
  }), { status: 200 })) as unknown as typeof fetch;
  const result = await handleFreeTurn({
    config,
    state: initialState(),
    spoken: "我拆下窗帘布，试着做一个临时绳索",
    modelTaskId: "task-free",
  });
  expect(result.intent).toEqual({
    kind: "free_action",
    text: "我拆下窗帘布，试着做一个临时绳索",
  });
});
