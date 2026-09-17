import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import type { AuditSpanSink } from "@core/audit/types";
import type { KeeperConfig } from "@core/keeper/config";
import { askStructured } from "./live";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("after-commit model calls are audited as non-causal spans", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"ok":true}' } }],
  }), { status: 200 })) as unknown as typeof fetch;
  const started: Array<Record<string, unknown>> = [];
  const sink: AuditSpanSink = {
    start(input) {
      started.push(input);
      return "live-model-span-1";
    },
    finish() {},
    append: () => undefined,
    gap() {},
  };

  const result = await askStructured({
    config: config(),
    task: "information.plan",
    schema: z.object({ ok: z.boolean() }),
    jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
    system: "system",
    user: "user",
    audit: { sink, modelTaskId: "turn-2:information.plan", basedOnStateVersion: 2 },
  });

  expect(result).toEqual({ ok: true });
  expect(started).toEqual([
    expect.objectContaining({
      kind: "model",
      stage: "background.information.plan",
      taskType: "information.plan",
      modelTaskId: "turn-2:information.plan",
      basedOnStateVersion: 2,
      causal: false,
    }),
  ]);
});

function config(): KeeperConfig {
  return {
    enabled: true,
    protocol: "openai_compatible",
    baseUrl: "https://keeper.test",
    apiKey: "test-secret",
    model: "test-model",
    timeoutMs: 1000,
    temperature: 0,
    contextBudgetChars: 4000,
    stream: false,
    debugTrace: false,
  };
}
