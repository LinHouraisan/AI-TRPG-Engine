import { expect, test } from "bun:test";
import { createInvestigatorConfirmationGate, createSubmissionGate } from "./submission-gate";

test("一次被会话拒绝的提交不会永久锁住后续自由输入", async () => {
  const gate = createSubmissionGate();
  const rejected = await gate.run(async () => false);
  const accepted = await gate.run(async () => true);

  expect(rejected).toBe(false);
  expect(accepted).toBe(true);
});

test("提交抛错后也会释放本地锁", async () => {
  const gate = createSubmissionGate();
  await expect(gate.run(async () => { throw new Error("failed"); })).rejects.toThrow("failed");

  expect(await gate.run(async () => true)).toBe(true);
});

test("游戏回合锁住时仍可独立确认尚未开局的调查员", async () => {
  const turnGate = createSubmissionGate();
  const confirmationGate = createInvestigatorConfirmationGate();
  let releaseTurn!: () => void;
  const turnPending = turnGate.run(() => new Promise<boolean>((resolve) => {
    releaseTurn = () => resolve(true);
  }));

  expect(await confirmationGate.run(async () => true)).toBe(true);

  releaseTurn();
  expect(await turnPending).toBe(true);
});
