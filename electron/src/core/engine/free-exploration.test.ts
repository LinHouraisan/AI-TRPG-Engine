import { expect, test } from "bun:test";
import { loadPackById } from "./pack";
import { playTurn } from "./play-turn";
import { route } from "./router";
import { initialState } from "./state";
import { answerQuery, narrate } from "./narrate";
import type { GameEvent } from "./types";

const mist = loadPackById("mist-harbor");

function mistState() {
  const investigator = mist.manifest.investigator;
  return {
    ...initialState(),
    pcAt: investigator.startAt,
    npcAt: Object.fromEntries(mist.npcs.map((npc) => [npc.id, npc.startAt])),
    itemAt: Object.fromEntries(mist.items.map((item) => [item.id, item.at])),
    visited: { [investigator.startAt]: true },
    skills: { ...investigator.skills },
    hp: investigator.hp,
    hpMax: investigator.hp,
    san: investigator.san,
    sanMax: investigator.sanMax,
  };
}

test("searching for omissions is an exploratory check instead of a clue recap", () => {
  const state = {
    ...mistState(),
    pcAt: "loc.concourse",
    known: ["fact.reporter_note"],
    skills: { ...mist.manifest.investigator.skills },
  };

  const intent = route("搜索可能有遗漏", state);
  expect(intent).toMatchObject({
    kind: "free_check",
    mode: "explore",
    target: "loc.concourse",
    skill: "侦查",
  });

  const outcome = playTurn({ text: "搜索可能有遗漏", state, log: [], intent, scenarioPack: mist });
  expect(outcome.kind).toBe("committed");
  if (outcome.kind !== "committed") throw new Error("expected committed outcome");
  expect(outcome.check?.skill).toBe("侦查");
  expect(outcome.committed[0]?.payload.type).toBe("check_resolved");
  expect(outcome.narration).toContain("雾港站大厅");
  expect(outcome.narration).not.toBe("你已经记下：记者顾弦曾在旧线事故中失去姐姐。");
});

test("a successful destructive check records a local reversible scene flag", () => {
  const state = {
    ...mistState(),
    pcAt: "loc.carriage",
    itemAt: { "item.emergency_hammer": "loc.carriage" },
    skills: { 侦查: 100 },
  };
  const intent = {
    kind: "free_check" as const,
    mode: "damage" as const,
    target: "item.emergency_hammer",
    skill: "侦查",
    difficulty: "regular" as const,
    approach: "拆下紧急锤并破坏固定架",
  };

  const outcome = playTurn({ text: intent.approach, state, log: [], intent, scenarioPack: mist, turnId: "damage-demo" });
  expect(outcome.kind).toBe("committed");
  if (outcome.kind !== "committed") throw new Error("expected committed outcome");
  expect(outcome.check?.ok).toBe(true);
  expect(outcome.state.flags["free.damage.item.emergency_hammer"]).toBe(true);
});

test("a named NPC question takes precedence over recap keywords", () => {
  const state = { ...mistState(), pcAt: "loc.ticket", npcAt: { "npc.clerk": "loc.ticket" } };
  expect(route("询问罗姨刚才发生了什么事情", state)).toEqual({
    kind: "talk",
    text: "询问罗姨刚才发生了什么事情",
  });
});

test("recap renders player-facing facts instead of internal event summaries", () => {
  const state = { ...mistState(), known: ["fact.reporter_note"] };
  const event: GameEvent = {
    id: "e1",
    seq: 1,
    turnId: "t1",
    versionAfter: 1,
    clock: 0,
    visibility: "public",
    cause: "player:observe",
    payload: { type: "fact_known", fact: "fact.reporter_note" },
    summary: "得到线索：[fact.reporter_note]，状态版本 v3。",
  };
  const recap = answerQuery({ state, log: [event], topic: "recap", scenarioPack: mist });
  expect(recap).toContain("顾弦");
  expect(recap).not.toContain("fact.");
  expect(recap).not.toContain("状态版本");
});

test("template observation still provides enough scene information", () => {
  const state = { ...mistState(), observed: { "item.watch": true } };
  const event: GameEvent = {
    id: "e1",
    seq: 1,
    turnId: "t1",
    versionAfter: 1,
    clock: 0,
    visibility: "public",
    cause: "player:observe",
    payload: { type: "observed", item: "item.watch" },
    summary: "观察停走怀表。",
    narration: "秒针每十三分钟退回原处。",
  };
  const text = narrate({ state, events: [event], intent: { kind: "observe", target: "item.watch" }, scenarioPack: mist });
  expect(text.length).toBeGreaterThanOrEqual(120);
  expect(text).toContain("记者顾弦");
  expect(text).toContain("通往");
});
