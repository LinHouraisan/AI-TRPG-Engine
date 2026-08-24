import { afterEach, expect, test } from "bun:test";
import { initialState } from "../engine/state";
import { freeTurnNarrationSchema, handleFreeTurn, narrateFreeTurn } from "./free-turn";
import type { KeeperConfig } from "./config";
import { loadPackById } from "../engine/pack";

const mist = loadPackById("mist-harbor");

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

test("searching for leverage on the conductor selects an authored Spot Hidden check", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      kind: "investigation",
      investigationId: "investigation.conductor-leverage",
      skill: "侦查",
      approach: "寻找能让列车员开口的细节",
    }) } }],
  }), { status: 200 })) as unknown as typeof fetch;
  const result = await handleFreeTurn({
    config,
    state: { ...initialState(), pcAt: "loc.platform", npcAt: { "npc.conductor": "loc.platform" }, lifeHistoryId: "history.archive-correspondent" },
    spoken: "查看四周，重点注意是否有可以让列车员回答问题的办法",
    modelTaskId: "task-figure-one",
    scenarioPack: mist,
  });
  expect(result.intent).toEqual({
    kind: "investigation",
    investigationId: "investigation.conductor-leverage",
    skill: "侦查",
    approach: "寻找能让列车员开口的细节",
    stateVersion: 0,
  });
});

test("free-turn rejects hidden, wrong-room, unknown, and history-ineligible investigations", async () => {
  const cases = [
    {
      id: "investigation.conductor-leverage",
      state: { ...initialState(), pcAt: "loc.platform", npcAt: { "npc.conductor": "loc.platform" }, known: ["fact.conductor_oath"], lifeHistoryId: "history.archive-correspondent" },
    },
    { id: "investigation.conductor-leverage", state: { ...initialState(), lifeHistoryId: "history.archive-correspondent" } },
    { id: "investigation.missing", state: { ...initialState(), pcAt: "loc.platform", npcAt: { "npc.conductor": "loc.platform" }, lifeHistoryId: "history.archive-correspondent" } },
    {
      id: "investigation.archive-correspondent",
      state: { ...initialState(), pcAt: "loc.baggage-car", lifeHistoryId: "history.old-line-reporter" },
    },
  ];

  for (const candidate of cases) {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        kind: "investigation",
        investigationId: candidate.id,
        skill: "侦查",
        approach: "寻找线索",
      }) } }],
    }), { status: 200 })) as unknown as typeof fetch;
    const result = await handleFreeTurn({
      config,
      state: candidate.state,
      spoken: "寻找线索",
      modelTaskId: `task-${candidate.id}`,
      scenarioPack: mist,
    });
    expect(result.intent.kind).toBe("unclear");
    expect(result.note).toContain("调查入口");
  }
});

test("free-turn rejects an investigation proposed for a stale state version", async () => {
  const state = {
    ...initialState(),
    pcAt: "loc.platform",
    npcAt: { "npc.conductor": "loc.platform" },
    lifeHistoryId: "history.archive-correspondent",
  };
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      kind: "investigation",
      investigationId: "investigation.conductor-leverage",
      skill: "侦查",
      approach: "寻找能让列车员开口的细节",
    }) } }],
  }), { status: 200 })) as unknown as typeof fetch;
  const result = await handleFreeTurn({
    config,
    state,
    scenarioPack: mist,
    spoken: "寻找列车员的破绽",
    modelTaskId: "task-stale",
    currentStateVersion: () => state.version + 1,
  });
  expect(result.intent.kind).toBe("unclear");
  expect(result.note).toContain("状态版本");
});

test("Figure 2 followups continue the girl's previous question", async () => {
  const recentTurns = [{ player: "询问女孩的名字", gm: "你能替我记住一个名字吗？" }];
  for (const spoken of ["可以", "继续问她", "刚才那个名字"]) {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
      const content = prompt.includes("你能替我记住一个名字吗？")
        ? '{"verb":"talk","target":"","text":""}'
        : '{"verb":"unclear","target":"","text":"你指什么？"}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as typeof fetch;

    const result = await handleFreeTurn({
      config,
      state: {
        ...initialState(),
        pcAt: "loc.carriage",
        npcAt: { "npc.girl": "loc.carriage" },
        lifeHistoryId: "history.tide-photographer",
      },
      scenarioPack: mist,
      spoken,
      recentTurns,
      modelTaskId: `task-figure-two-${spoken}`,
    });

    expect(result.intent.kind).toBe("talk");
  }
});

test("free-turn narration requires structured quality fields and displays only cohesive text", async () => {
  const text = "你把问题放轻，像怕惊动玻璃上的雾。女孩先是望向空着的邻座，指尖沿座椅裂纹慢慢停住；车轮碾过接缝时，她才重新看你，确认你并没有催促。她说那个名字像一张被雨泡过的车票，字还在，却没人肯承认见过。她仍在等你说出那个名字，也没有阻止你追问那张车票来自哪里；窗外短暂掠过一盏昏黄站灯，让她的影子在过道里多停了一瞬。";
  const feedback = "你放轻的问题没有惊动她，她确认你没有催促。";
  const reaction = "女孩望向空座，随后重新看你。";
  const interactionPoint = "她仍在等你说出那个名字";
  const prompts: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    prompts.push(body.messages.find((message) => message.role === "system")?.content ?? "");
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        text,
        feedback,
        reaction,
        interactionPoints: [interactionPoint],
      }) } }],
    }), { status: 200 });
  }) as typeof fetch;

  expect(freeTurnNarrationSchema.safeParse({ text }).success).toBe(false);
  const result = await narrateFreeTurn({
    config,
    modelTaskId: "task-structured-narration",
    state: {
      ...initialState(),
      pcAt: "loc.carriage",
      npcAt: { "npc.girl": "loc.carriage" },
    },
    events: [],
    intent: { kind: "talk", text: "那个名字是什么？" },
    spoken: "那个名字是什么？",
    scenarioPack: mist,
    fallback: "她没有回答。",
  });

  expect(result.text).toBe(text);
  expect(result.source).toBe("模型");
  expect(result).not.toHaveProperty("feedback");
  expect(result).not.toHaveProperty("reaction");
  expect(result).not.toHaveProperty("interactionPoints");
  expect(prompts[0]).toContain("interactionPoints");
});

test("two semantically invalid narration attempts use the safe fallback", async () => {
  const prompts: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    prompts.push(body.messages.find((message) => message.role === "user")?.content ?? "");
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        text: "她看着你。",
        feedback: "",
        reaction: "她没有回答。",
        interactionPoints: ["你可以继续追问。"],
      }) } }],
    }), { status: 200 });
  }) as typeof fetch;

  const result = await narrateFreeTurn({
    config,
    modelTaskId: "task-invalid-narration",
    state: {
      ...initialState(),
      pcAt: "loc.carriage",
      npcAt: { "npc.girl": "loc.carriage" },
    },
    events: [],
    intent: { kind: "talk", text: "继续问她" },
    spoken: "继续问她",
    scenarioPack: mist,
    fallback: "她没有回答。",
  });

  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("叙述结构不完整");
  expect(prompts[1]).not.toContain("missing_feedback");
  expect(result).toMatchObject({ text: "她没有回答。", source: "模板" });
});
