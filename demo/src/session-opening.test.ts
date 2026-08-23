import { expect, test } from "bun:test";
import { initialState } from "@/engine/state";
import { createOpening, createRestoredMessages } from "@/session";

test("续场开场消息使用实际恢复版本", () => {
  const restored = { ...initialState(), version: 28, turn: 28 };

  expect(createOpening(restored).every((message) => message.stateVersion === 28)).toBe(true);
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
