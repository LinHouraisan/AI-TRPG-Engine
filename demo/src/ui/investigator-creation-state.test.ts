import { expect, test } from "bun:test";
import { loadPackById } from "@/engine/pack";
import { creationReducer, initialCreationState } from "./investigator-creation-state";

const rules = loadPackById("mist-harbor").manifest.creation;
if (!rules) throw new Error("Mist Harbor must define investigator creation rules");

test("cannot advance from skills until both point pools are exactly spent", () => {
  const state = initialCreationState(rules);
  const next = creationReducer(state, { type: "go", step: "history" });

  expect(next.step).toBe("skills");
  expect(next.issues.some((issue) => issue.code === "POINTS_REMAINING")).toBe(true);
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
