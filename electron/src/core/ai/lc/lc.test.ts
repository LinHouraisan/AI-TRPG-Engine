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
});
