import { expect, test } from "bun:test";
import type { InvestigatorProfile } from "@/character/types";
import { initialState } from "@/engine/state";
import { pack } from "@/engine/pack";
import { createOpening, createRestoredMessages } from "@/session";

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

test("续场开场消息使用实际恢复版本", () => {
  const restored = { ...initialState(), version: 28, turn: 28 };

  expect(createOpening(restored, confirmedProfile).every((message) => message.stateVersion === 28)).toBe(true);
});

test("恢复分支显示前情提要和最近三个完整回合，不显示默认开场", () => {
  const restored = { ...initialState(), version: 6, turn: 6 };
  const messages = createRestoredMessages(restored, {
    recap: "你已经进入公寓，并发现书桌上的锁有新划痕。",
    recentTurns: [
      { turnId: "t2", stateVersion: 2, player: "第二轮玩家", gm: "第二轮守秘人" },
      { turnId: "t3", stateVersion: 3, player: "第三轮玩家", gm: "第三轮守秘人" },
      { turnId: "t4", stateVersion: 4, player: "第四轮玩家", gm: "第四轮守秘人" },
    ],
    restoredFrom: "手动检查点 v4",
  });

  expect(messages.map((message) => message.text)).toEqual([
    "前情提要：你已经进入公寓，并发现书桌上的锁有新划痕。",
    "第二轮玩家",
    "第二轮守秘人",
    "第三轮玩家",
    "第三轮守秘人",
    "第四轮玩家",
    "第四轮守秘人",
    "已从「手动检查点 v4」创建恢复分支。原检查点仍然保留。",
  ]);
});
