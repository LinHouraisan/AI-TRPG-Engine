import { expect, test } from "bun:test";
import { initialState } from "../engine/state";
import type { GameEvent } from "../engine/types";
import { buildContext } from "./context";

test("context manifest records included current evidence and budget-dropped history", () => {
  const prior = event({
    id: "event-prior",
    turnId: "turn-1",
    summary: `旧雨夜的经过：${"潮湿的长廊。".repeat(80)}`,
  });
  const current = event({
    id: "event-current",
    turnId: "turn-2",
    summary: "你刚刚确认门锁上留着新鲜划痕。",
  });

  const context = buildContext({
    state: { ...initialState(), version: 2 },
    events: [prior, current],
    budgetChars: 280,
  });

  expect(context.manifest.finalText).toBe(context.text);
  expect(context.manifest.entries).toContainEqual(expect.objectContaining({
    column: "本回合已提交的事实",
    sourceKind: "current_event",
    sourceId: "event-current",
    included: true,
  }));
  expect(context.manifest.entries).toContainEqual(expect.objectContaining({
    column: "经过",
    sourceKind: "prior_event",
    sourceId: "event-prior",
    included: false,
    dropReason: "budget",
  }));
  expect(context.manifest.columns).toEqual(context.usage?.columns);
});

function event(input: { id: string; turnId: string; summary: string }): GameEvent {
  return {
    id: input.id,
    seq: input.turnId === "turn-1" ? 1 : 2,
    turnId: input.turnId,
    versionAfter: input.turnId === "turn-1" ? 1 : 2,
    clock: 0,
    visibility: "public",
    cause: "player:test",
    summary: input.summary,
    payload: { type: "flag_set", flag: input.id, value: true },
  };
}
