import { afterEach, expect, test } from "bun:test";
import { initialState } from "../engine/state";
import type { KeeperConfig } from "./config";
import type { NarrationStreamEvent } from "./keeper";
import { keeperNarrate } from "./keeper";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const config: KeeperConfig = {
  enabled: true,
  protocol: "ollama",
  baseUrl: "http://keeper.test",
  model: "test-model",
  timeoutMs: 1000,
  temperature: 0,
  contextBudgetChars: 4000,
  stream: true,
  debugTrace: false,
};

function streamReply(reply: unknown): void {
  const serialized = JSON.stringify(reply);
  globalThis.fetch = (async () => {
    const encoder = new TextEncoder();
    const pieces = Array.from({ length: Math.ceil(serialized.length / 5) }, (_, index) =>
      serialized.slice(index * 5, index * 5 + 5));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ message: { content: piece } })}\n`));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;
}

test("guarded streaming exposes only the validated fallback, never a fabricated outcome", async () => {
  const unsafe = "你伸手碰向车票，车票被你拿起并收进口袋。桌面只剩一圈潮湿印痕。";
  streamReply({
    text: unsafe,
    feedback: "你伸手碰向车票。",
    reaction: "车票被你拿起并收进口袋。",
    interactionPoints: ["桌面只剩一圈潮湿印痕"],
  });
  const events: NarrationStreamEvent[] = [];
  const fallback = "车票仍留在原处，潮气沿着纸边慢慢扩散。";

  const result = await keeperNarrate({
    config,
    state: initialState(),
    events: [],
    intent: { kind: "free_action", text: "碰一下车票" },
    spoken: "碰一下车票",
    fallback,
    onStream: (event) => events.push(event),
  });

  expect(result.text).toBe(fallback);
  expect(events.filter((event) => event.kind === "draft")).toEqual([]);
  expect(JSON.stringify(events)).not.toContain("收进口袋");
  expect(events).toHaveLength(1);
  expect(events[0]?.kind === "final" ? events[0].text : null).toBe(fallback);
});
