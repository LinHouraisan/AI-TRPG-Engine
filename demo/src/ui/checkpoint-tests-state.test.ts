import { expect, test } from "bun:test";
import {
  checkpointLabel,
  partitionCheckpoints,
  restoreNeedsConfirmation,
} from "./checkpoint-tests-state";

test("存档默认分成当前分支和历史分支", () => {
  const rows = [
    { checkpointId: "main", branchId: "branch-main" },
    { checkpointId: "copy", branchId: "branch-copy" },
  ];

  expect(partitionCheckpoints(rows, "branch-copy")).toEqual({
    current: [rows[1]],
    history: [rows[0]],
  });
});

test("只有恢复到更低版本时要求确认", () => {
  expect(restoreNeedsConfirmation(2, 0)).toBe(true);
  expect(restoreNeedsConfirmation(2, 2)).toBe(false);
  expect(restoreNeedsConfirmation(2, 3)).toBe(false);
});

test("存档名称使用真实版本和本地时间", () => {
  expect(checkpointLabel(2, new Date("2026-08-23T14:56:36.000Z"))).toContain("手动检查点 v2");
  expect(checkpointLabel(2, new Date("2026-08-23T14:56:36.000Z"))).not.toContain("178749");
});
