import { afterEach, expect, test } from "bun:test";
import { initialState } from "../engine/state";
import { handleFreeTurn } from "./free-turn";
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
