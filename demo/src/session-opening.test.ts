import { expect, test } from "bun:test";
import { initialState } from "@/engine/state";
import { createOpening } from "@/session";

test("续场开场消息使用实际恢复版本", () => {
  const restored = { ...initialState(), version: 28, turn: 28 };

  expect(createOpening(restored).every((message) => message.stateVersion === 28)).toBe(true);
});
