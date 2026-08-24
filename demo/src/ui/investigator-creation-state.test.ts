import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadPackById } from "@/engine/pack";
import { InvestigatorCreation } from "./InvestigatorCreation";
import {
  canSubmitConfirmation,
  confirmationReducer,
  creationReducer,
  initialConfirmationState,
  initialCreationState,
  openingGate,
} from "./investigator-creation-state";

const rules = loadPackById("mist-harbor").manifest.creation;
if (!rules) throw new Error("Mist Harbor must define investigator creation rules");

test("cannot advance from skills until both point pools are exactly spent", () => {
  const state = initialCreationState(rules);
  const next = creationReducer(state, { type: "go", step: "history" });

  expect(next.step).toBe("skills");
  expect(next.issues.some((issue) => issue.code === "POINTS_REMAINING")).toBe(true);
});

test("selected occupation starts with its authored occupation point allocation", () => {
  const state = initialCreationState(rules);

  expect(state.allocation.occupationPoints).toEqual({
    侦查: 55,
    聆听: 35,
    图书馆使用: 50,
    话术: 70,
    心理学: 70,
  });
});

test("point editing clamps immediately to the pool remainder and final skill cap", () => {
  const initial = initialCreationState(rules);
  const interestCapped = creationReducer(initial, {
    type: "set-points",
    pool: "interest",
    skill: "侦查",
    value: 999,
  });
  expect(interestCapped.allocation.interestPoints.侦查).toBe(10);

  const occupationCapped = creationReducer(initial, {
    type: "set-points",
    pool: "occupation",
    skill: "侦查",
    value: 999,
  });
  expect(occupationCapped.allocation.occupationPoints.侦查).toBe(55);
});

test("valid allocation can advance to life history", () => {
  const state = {
    ...initialCreationState(rules),
    allocation: {
      name: "林晚",
      lifeHistoryId: "history.archive-correspondent",
      occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
      interestPoints: { 侦查: 10, 聆听: 20, 图书馆使用: 20, 话术: 15, 心理学: 10, 开锁: 65 },
    },
  };

  const next = creationReducer(state, { type: "go", step: "history" });

  expect(next.step).toBe("history");
  expect(next.issues).toEqual([]);
});

test("profile gate never mounts play for a pack without creation rules", () => {
  expect(openingGate(false, false)).toBe("unsupported");
  expect(openingGate(false, true)).toBe("creation");
  expect(openingGate(true, false)).toBe("play");
});

test("rejected confirmation exposes an error and the next attempt clears it for retry", () => {
  const rejected = confirmationReducer(initialConfirmationState, {
    type: "rejected",
    error: "调查员确认失败",
  });
  expect(rejected.error).toBe("调查员确认失败");

  const retrying = confirmationReducer(rejected, { type: "attempted" });
  expect(retrying.error).toBeNull();
});

test("rejected confirmation renders a visible alert without disabling retry", () => {
  const html = renderToStaticMarkup(createElement(InvestigatorCreation, {
    rules,
    busy: false,
    ready: true,
    error: "调查员确认失败：investigator.allocation_invalid",
    onConfirm: async () => false,
  }));

  expect(html).toContain('role="alert"');
  expect(html).toContain("调查员确认失败：investigator.allocation_invalid");
  expect(canSubmitConfirmation({ ready: true, busy: false, issueCount: 0 })).toBe(true);
});
