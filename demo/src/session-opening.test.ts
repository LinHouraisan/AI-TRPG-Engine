import { expect, test } from "bun:test";
import type { InvestigatorProfile } from "@/character/types";
import { initialState } from "@/engine/state";
import { loadPackById, pack } from "@/engine/pack";
import { replay } from "@/engine/runtime";
import type { Message } from "@/session";
import {
  activeCheckPreviewReducer,
  createOpening,
  createRestoredMessages,
  projectInvestigatorConfirmation,
  recentDialogueTurns,
} from "@/session";

const base = initialState();
const confirmedProfile: InvestigatorProfile = {
  name: pack.manifest.investigator.name,
  occupation: pack.manifest.investigator.occupation,
  characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 },
  baseSkills: { ...base.skills },
  occupationPoints: {},
  interestPoints: {},
  skills: { ...base.skills },
  hp: base.hpMax,
  san: base.san,
  sanMax: base.sanMax,
  lifeHistoryId: "history.test",
  contentVersion: pack.manifest.version,
};

test("formal opening is absent until investigator confirmation", () => {
  expect(createOpening(initialState(), null).map((message) => message.text).join(" "))
    .not.toContain(pack.manifest.opening);
});

test("check preview resolves and clears on the next unrelated action", () => {
  const candidate = {
    title: "书桌抽屉",
    skill: "开锁",
    skillValue: 40,
    difficulty: "hard" as const,
    threshold: 20,
  };
  const pending = activeCheckPreviewReducer(null, { type: "began", check: candidate });
  expect(pending).toEqual({ kind: "candidate", check: candidate });

  const check = { ...candidate, roll: 18, level: "困难成功" as const, ok: true };
  const resolved = activeCheckPreviewReducer(pending, { type: "resolved", check });
  expect(resolved).toEqual({ kind: "resolved", check });
  expect(activeCheckPreviewReducer(resolved, { type: "began", check: null })).toBeNull();
});

test("browser confirmation projects replayable profile, grant, and relationship events", () => {
  const mist = loadPackById("mist-harbor");
  const rules = mist.manifest.creation;
  if (!rules) throw new Error("Mist Harbor must define investigator creation rules");
  const start = initialState();
  const projected = projectInvestigatorConfirmation({
    state: start,
    log: [],
    rules,
    itemLocations: Object.fromEntries(mist.items.map((item) => [item.id, item.at])),
    allocation: {
      name: "林晚",
      lifeHistoryId: "history.archive-correspondent",
      occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
      interestPoints: { 侦查: 10, 聆听: 20, 图书馆使用: 20, 话术: 15, 心理学: 10, 开锁: 65 },
    },
  });
  if (!projected) throw new Error("Browser confirmation fixture must be valid");

  expect(projected.committed.map((event) => event.payload.type)).toEqual([
    "sheet_applied",
    "fact_known",
    "relationship_established",
  ]);
  expect(projected.state.relationships?.["npc.shen"]).toBe("沈鹭信任你会把她的名字写进档案。");
  expect(replay(start, projected.committed)).toEqual(projected.state);
});

test("续场开场消息使用实际恢复版本", () => {
  const restored = { ...initialState(), version: 28, turn: 28 };

  expect(createOpening(restored, confirmedProfile).every((message) => message.stateVersion === 28)).toBe(true);
});

test("restored view renders recap then exactly the real latest three turns", () => {
  const restored = { ...initialState(), version: 6, turn: 6 };
  const turns = [
    { turnId: "t1", stateVersion: 1, player: "第一轮玩家", gm: "第一轮守秘人" },
    { turnId: "t2", stateVersion: 2, player: "第二轮玩家", gm: "第二轮守秘人" },
    { turnId: "t3", stateVersion: 3, player: "第三轮玩家", gm: "第三轮守秘人" },
    { turnId: "t4", stateVersion: 4, player: "第四轮玩家", gm: "第四轮守秘人" },
  ];
  const messages = createRestoredMessages(restored, {
    recap: "林晚因沈鹭寄来的车票来到雾港站，并发现末班车名单有异常。",
    recentTurns: turns.slice(-3),
    restoredFrom: "第三幕前",
  });

  expect(messages[0]?.text).toStartWith("前情提要：林晚因沈鹭");
  expect(messages.filter((message) => message.role === "pl")).toHaveLength(3);
  expect(messages.some((message) => message.text === pack.manifest.opening)).toBe(false);
  expect(messages.map((message) => message.text)).toEqual([
    "前情提要：林晚因沈鹭寄来的车票来到雾港站，并发现末班车名单有异常。",
    "第二轮玩家",
    "第二轮守秘人",
    "第三轮玩家",
    "第三轮守秘人",
    "第四轮玩家",
    "第四轮守秘人",
    "已从「第三幕前」创建恢复分支。原检查点仍然保留。",
  ]);
});

test("restored view keeps two real turns without opening padding", () => {
  const messages = createRestoredMessages(initialState(), {
    recap: "林晚刚到雾港站。",
    recentTurns: [
      { turnId: "t1", stateVersion: 1, player: "第一问", gm: "第一答" },
      { turnId: "t2", stateVersion: 1, player: "第二问", gm: "第二答" },
    ],
    restoredFrom: "开场后",
  });

  expect(messages.filter((message) => message.role === "pl").map((message) => message.text)).toEqual([
    "第一问",
    "第二问",
  ]);
  expect(messages.filter((message) => message.role === "kp").map((message) => message.text)).toEqual([
    "第一答",
    "第二答",
  ]);
  expect(messages.some((message) => message.text === pack.manifest.opening)).toBe(false);
});

test("recent dialogue ignores an unmatched player message", () => {
  const messages: Message[] = [
    { id: "p1", role: "pl", text: "第一问", stateVersion: 1 },
    { id: "g1", role: "kp", text: "第一答", stateVersion: 1 },
    { id: "p2", role: "pl", text: "尚未回答", stateVersion: 1 },
  ];

  expect(recentDialogueTurns(messages)).toEqual([
    { player: "第一问", gm: "第一答" },
  ]);
});
