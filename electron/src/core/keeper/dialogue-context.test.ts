import { afterEach, expect, test } from "bun:test";
import { loadPackById, type Pack } from "../engine/pack";
import { initialState } from "../engine/state";
import type { KeeperConfig } from "./config";
import { checkNarration } from "./guard";
import {
  buildNpcDialogueContext,
  disclosableNpcFactIds,
} from "./dialogue-context";
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

function narrationReply(params: {
  text: string;
  feedback: string;
  reaction: string;
  interactionPoint: string;
}): string {
  return JSON.stringify({
    text: params.text,
    feedback: params.feedback,
    reaction: params.reaction,
    interactionPoints: [params.interactionPoint],
  });
}

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
  expect(context).not.toContain("无名女孩真正的名字是许遥");
  expect(context).not.toContain("列车员许澄必须送满四十八名乘客才能离开");
});

test("NPC knowledge is not disclosure authority until discovery or an authored condition", () => {
  const scenarioPack = dialoguePack();
  const hidden = {
    ...initialState(),
    pcAt: "loc.carriage",
    npcAt: { "npc.girl": "loc.carriage" },
  };
  expect(disclosableNpcFactIds({ npcId: "npc.girl", state: hidden, scenarioPack }))
    .not.toContain("fact.child_name");

  expect(disclosableNpcFactIds({
    npcId: "npc.girl",
    state: { ...hidden, known: ["fact.child_name"] },
    scenarioPack,
  })).toContain("fact.child_name");

  const authored = {
    ...scenarioPack,
    npcs: scenarioPack.npcs.map((npc) => npc.id === "npc.girl"
      ? {
          ...npc,
          disclosures: [{ fact: "fact.child_name", when: { flag: "girl.name_disclosable" } }],
        }
      : npc),
  } as Pack;
  expect(disclosableNpcFactIds({
    npcId: "npc.girl",
    state: { ...hidden, flags: { "girl.name_disclosable": true } },
    scenarioPack: authored,
  })).toContain("fact.child_name");
});

test("the girl's undiscovered name stays out of her prompt and is rejected after bare agreement", async () => {
  const prompts: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    prompts.push(body.messages.find((message) => message.role === "user")?.content ?? "");
    return new Response(JSON.stringify({
      choices: [{ message: { content: narrationReply({
        text: "她听见你答应后抬起眼睛，轻声说：‘我叫许遥。’她的手仍按着那张潮湿车票。",
        feedback: "她听见你答应后抬起眼睛。",
        reaction: "轻声说：‘我叫许遥。’",
        interactionPoint: "她的手仍按着那张潮湿车票",
      }) } }],
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
    intent: { kind: "talk", text: "可以" },
    spoken: "可以",
    recentTurns: [{ player: "询问女孩的名字", gm: "你能替我记住一个名字吗？" }],
    scenarioPack: dialoguePack(),
    fallback: "她只是认真地点了点头，没有说出那个名字。",
  });

  expect(result.source).toBe("模板");
  expect(result.text).not.toContain("许遥");
  expect(result.note).toContain("未授权的事实");
  expect(prompts).toHaveLength(2);
  expect(prompts.every((prompt) => !prompt.includes("许遥"))).toBe(true);
});

test("a discovered name can be disclosed by the girl", () => {
  const scenarioPack = dialoguePack();
  const allowedFactIds = disclosableNpcFactIds({
    npcId: "npc.girl",
    state: {
      ...initialState(),
      pcAt: "loc.carriage",
      npcAt: { "npc.girl": "loc.carriage" },
      known: ["fact.child_name"],
    },
    scenarioPack,
  });

  expect(checkNarration({
    text: "女孩终于说：‘我叫许遥。’",
    allowedNames: ["无名女孩"],
    events: [],
    scenarioPack,
    allowedFactIds,
  })).toEqual({ ok: true });
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
  const prompts: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    prompts.push(body.messages.find((message) => message.role === "user")?.content ?? "");
    return new Response(JSON.stringify({
      choices: [{ message: { content: narrationReply({
        text: "她听见了你的回答，轻轻点头，仍等着你继续说下去。",
        feedback: "她听见了你的回答。",
        reaction: "轻轻点头。",
        interactionPoint: "仍等着你继续说下去",
      }) } }],
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
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("你能替我记住一个名字吗？");
  expect(prompts[0]).not.toContain("列车员许澄必须送满四十八名乘客才能离开");
});

test("narration rejects another NPC's secret even when its name is omitted", async () => {
  const prompts: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    prompts.push(body.messages.find((message) => message.role === "user")?.content ?? "");
    return new Response(JSON.stringify({
      choices: [{ message: { content: narrationReply({
        text: "她听见了你的追问，压低声音说：必须送满四十八名乘客才能离开。她的目光仍停在你脸上。",
        feedback: "她听见了你的追问。",
        reaction: "压低声音。",
        interactionPoint: "她的目光仍停在你脸上",
      }) } }],
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
