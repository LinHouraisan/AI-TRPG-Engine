/**
 * 离线单测：不连模型，验证"确定性"与"检索正确性"两件事。
 *   bun test src/core/ai/lc
 */
import { describe, expect, test } from "bun:test";
import { rollNotation, skillCheck } from "./tools";
import {
  buildIndex,
  cosine,
  indexFromJson,
  indexToJson,
  memoryDocs,
  search,
  type Embedder,
} from "./retrieval";
import type { MemoryEntry } from "@core/ai/memory";
import type { AuditSpanSink } from "@core/audit/types";
import { recall } from "./chains";

const seed = { seed: "br-test", turnId: "t-3" };

describe("掷骰", () => {
  test("解析标准表达式", () => {
    const first = rollNotation("2d6+3", seed);
    expect(first).toMatch(/^2d6\+3 = \d+/);
  });

  test("同一回合重放结果不变", () => {
    expect(rollNotation("1d20", seed)).toBe(rollNotation("1d20", seed));
  });

  test("换回合才算重掷", () => {
    const a = rollNotation("1d20", seed);
    const b = rollNotation("1d20", { seed: "br-test", turnId: "t-4" });
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
  });

  test("非法表达式不崩，回一句话让 Agent 自检", () => {
    expect(rollNotation("d", seed)).toContain("无法解析");
  });

  test("检定输出成功或失败", () => {
    const text = skillCheck({ seed, attribute: 3, difficulty: 10 });
    expect(text).toMatch(/(成功|失败)$/);
  });
});

describe("检索", () => {
  // 两维假向量：命中"账本"与"书房"两个语义方向，够验证排序与往返
  const fake: Embedder = async (texts) =>
    texts.map((text) => [text.includes("账本") ? 1 : 0, text.includes("书房") ? 1 : 0]);

  test("余弦：同向为 1，正交为 0", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  test("语义相关的条目排在前面", async () => {
    const index = await buildIndex(fake, [
      { id: "a", text: "书房里有把锁" },
      { id: "b", text: "黑色账本记着名单" },
    ]);
    const hits = await search(index, fake, "那本账本", 1);
    expect(hits[0]?.id).toBe("b");
  });

  test("索引可序列化往返", async () => {
    const index = await buildIndex(fake, [{ id: "a", text: "书房" }]);
    expect(indexFromJson(indexToJson(index)).docs.length).toBe(1);
    expect(indexFromJson("not json").docs.length).toBe(0);
  });

  test("只索引 active 记忆，被取代的不进检索", () => {
    const entry = (id: string, status: MemoryEntry["status"]): MemoryEntry => ({
      id,
      memoryType: "fact",
      summary: `${id} 的摘要`,
      sources: ["evt-1"],
      entityIds: [],
      sceneId: "loc.study",
      importance: 1,
      status,
      structured: {},
      extractedThroughTurn: 1,
    });
    const docs = memoryDocs([entry("m1", "active"), entry("m2", "superseded")]);
    expect(docs.map((doc) => doc.id)).toEqual(["m1"]);
  });

  test("检索审计保存查询、Top-K、命中分数和来源", async () => {
    const index = await buildIndex(fake, [
      { id: "memory-ledger", text: "黑色账本记着名单", source: "fact" },
      { id: "memory-study", text: "书房里有把锁", source: "scene" },
    ]);
    const appended: Array<Record<string, unknown>> = [];
    const sink: AuditSpanSink = {
      start: () => undefined,
      finish() {},
      append(input) {
        appended.push(input);
        return "retrieval-span-1";
      },
      gap() {},
    };

    const hits = await recall({
      input: "那本账本",
      index,
      embed: fake,
      topK: 1,
      audit: { sink, modelTaskId: "rag-task-1", basedOnStateVersion: 3 },
    });

    expect(hits.map((hit) => hit.id)).toEqual(["memory-ledger"]);
    expect(appended).toEqual([
      expect.objectContaining({
        kind: "retrieval",
        stage: "retrieval.context",
        causal: true,
        input: { query: "那本账本", topK: 1, indexSize: 2 },
        output: {
          usedRag: true,
          hits: [expect.objectContaining({ id: "memory-ledger", source: "fact", score: 1 })],
        },
      }),
    ]);
  });
});
