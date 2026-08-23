import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import { askKeeper } from "./client";
import type { KeeperConfig } from "./config";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("OpenAI-compatible keeper sends bearer auth and parses chat completions", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"text":"雨声压低了屋里的呼吸。"}' } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const config: KeeperConfig = {
    enabled: true,
    protocol: "openai_compatible",
    baseUrl: "https://api.deepseek.com/",
    apiKey: "test-secret",
    disableThinking: true,
    model: "deepseek-v4-flash",
    timeoutMs: 1000,
    temperature: 0.7,
    contextBudgetChars: 4000,
    stream: false,
    debugTrace: false,
  };

  const result = await askKeeper({
    config,
    system: "system",
    user: "user",
    schema: z.object({ text: z.string() }),
    jsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  });

  expect(result.value.text).toBe("雨声压低了屋里的呼吸。");
  expect(requestUrl).toBe("https://api.deepseek.com/chat/completions");
  expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer test-secret");
  const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  expect(body.model).toBe("deepseek-v4-flash");
  expect(body.response_format).toEqual({ type: "json_object" });
  expect(body.thinking).toEqual({ type: "disabled" });
});
