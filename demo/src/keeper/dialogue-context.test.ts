import { afterEach, expect, test } from "bun:test";
import { loadPackById, type Pack } from "../engine/pack";
import { initialState } from "../engine/state";
import type { KeeperConfig } from "./config";
import { checkNarration } from "./guard";
import { buildNpcDialogueContext } from "./dialogue-context";
import { keeperNarrate } from "./keeper";

const mist = loadPackById("mist-harbor");
const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

const config: KeeperConfig = {
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

function dialoguePack(): Pack {
  return {
    ...mist,
    npcs: mist.npcs.map((npc) => {
      if (npc.id === "npc.girl") return { ...npc, knownFacts: ["fact.child_name"] };
      if (npc.id === "npc.conductor") return { ...npc, knownFacts: ["fact.conductor_oath"] };
      return npc;
    }),
  };
}

test("NPC dialogue context keeps only the latest three persisted pairs", () => {
  const context = buildNpcDialogueContext({
    npcId: "npc.girl",
    state: {
      ...initialState(),
      pcAt: "loc.carriage",
      npcAt: { "npc.girl": "loc.carriage" },
      known: ["fact.conductor_oath"],
      lifeHistoryId: "history.tide-photographer",
      relationships: { "npc.girl": "女孩觉得你或许真的记得她曾经站在那里。" },
    },
    recentTurns: [
      { player: "最早的一轮", gm: "最早的回答" },
      { player: "第二轮", gm: "第二个回答" },
      { player: "询问女孩的名字", gm: "你能替我记住一个名字吗？" },
      { player: "可以", gm: "她等着你继续。" },
    ],
    profile: { lifeHistoryId: "history.tide-photographer" },
    scenarioPack: dialoguePack(),
  });

  expect(context).not.toContain("最早的一轮");
  expect(context).toContain("第二轮");
  expect(context).toContain("你能替我记住一个名字吗？");
  expect(context).toContain("女孩觉得你或许真的记得她曾经站在那里。");
  expect(context).toContain("无名女孩真正的名字是许遥");
  expect(context).not.toContain("列车员许澄必须送满四十八名乘客才能离开");
});

test("the girl receives neither another NPC's secret nor a narration that claims it", () => {
  const scenarioPack = dialoguePack();
  const context = buildNpcDialogueContext({
    npcId: "npc.girl",
    state: {
      ...initialState(),
      pcAt: "loc.carriage",
      npcAt: { "npc.girl": "loc.carriage" },
    },
    recentTurns: [{ player: "询问女孩的名字", gm: "你能替我记住一个名字吗？" }],
    profile: null,
    scenarioPack,
  });

  expect(context).not.toContain("列车员许澄必须送满四十八名乘客才能离开");
  expect(checkNarration({
    text: "女孩低声说：必须送满四十八名乘客才能离开。",
    allowedNames: ["无名女孩"],
    events: [],
    scenarioPack,
    allowedFactIds: ["fact.child_name"],
  })).toEqual({
    ok: false,
    reason: "叙述声称了上下文未授权的事实",
  });
});

test("an NPC opening line is not injected before it is actually spoken", () => {
  const context = buildNpcDialogueContext({
    npcId: "npc.girl",
    state: {
      ...initialState(),
      pcAt: "loc.carriage",
      npcAt: { "npc.girl": "loc.carriage" },
    },
    recentTurns: [],
    profile: null,
    scenarioPack: dialoguePack(),
  });

  expect(context).not.toContain("你能替我记住一个名字吗？");
});

test("narration receives recent dialogue without another NPC's authored secret", async () => {
  let prompt = "";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"text":"她轻轻点头，等着你继续说下去。"}' } }],
    }), { status: 200 });
  }) as typeof fetch;

  const result = await keeperNarrate({
    config,
    state: {
      ...initialState(),
      pcAt: "loc.carriage",
      npcAt: { "npc.girl": "loc.carriage" },
      lifeHistoryId: "history.tide-photographer",
    },
    events: [],
    intent: { kind: "talk", text: "可以" },
    spoken: "可以",
    recentTurns: [{ player: "询问女孩的名字", gm: "你能替我记住一个名字吗？" }],
    scenarioPack: dialoguePack(),
    fallback: "她看着你。",
  });

  expect(result.source).toBe("模型");
  expect(prompt).toContain("你能替我记住一个名字吗？");
  expect(prompt).not.toContain("列车员许澄必须送满四十八名乘客才能离开");
});

test("narration rejects another NPC's secret even when its name is omitted", async () => {
  const prompts: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    prompts.push(body.messages.find((message) => message.role === "user")?.content ?? "");
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"text":"她低声说：必须送满四十八名乘客才能离开。"}' } }],
    }), { status: 200 });
  }) as typeof fetch;

  const result = await keeperNarrate({
    config,
    state: {
      ...initialState(),
      pcAt: "loc.carriage",
      npcAt: { "npc.girl": "loc.carriage" },
    },
    events: [],
    intent: { kind: "talk", text: "继续问她" },
    spoken: "继续问她",
    recentTurns: [{ player: "询问女孩的名字", gm: "你能替我记住一个名字吗？" }],
    scenarioPack: dialoguePack(),
    fallback: "她没有回答。",
  });

  expect(result.source).toBe("模板");
  expect(result.note).toContain("未授权的事实");
  expect(prompts).toHaveLength(2);
  expect(prompts.every((prompt) => !prompt.includes("必须送满四十八名乘客才能离开"))).toBe(true);
});
