import { expect, test } from "bun:test";
import { investigatorAllocationInputSchema } from "./input-validation";

const points = {
  occupationPoints: { 侦查: 280 },
  interestPoints: { 开锁: 140 },
};

test("strict IPC allocation parsing normalizes a padded investigator name", () => {
  const parsed = investigatorAllocationInputSchema.parse({
    name: "  林晚  ",
    lifeHistoryId: "history.archive-correspondent",
    ...points,
  });
  expect(parsed.name).toBe("林晚");
});

test("strict IPC allocation parsing rejects whitespace-only names and extra fields", () => {
  expect(investigatorAllocationInputSchema.safeParse({
    name: "   ",
    lifeHistoryId: "history.archive-correspondent",
    ...points,
  }).success).toBe(false);
  expect(investigatorAllocationInputSchema.safeParse({
    name: "林晚",
    lifeHistoryId: "history.archive-correspondent",
    ...points,
    editExisting: true,
  }).success).toBe(false);
});
