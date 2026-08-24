import { expect, test } from "bun:test";
import { buildRecentDialogueContext } from "./dialogue-context";
import { PersistedDialogueSource } from "./persisted-dialogue";

const firstPair = [{ player: "询问名字", gm: "你能替我记住一个名字吗？" }];

test("persisted dialogue stays unchanged until an ordered save succeeds", async () => {
  const source = new PersistedDialogueSource();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const order: string[] = [];

  const first = source.persist("branch", firstPair, async () => {
    order.push("first-start");
    markStarted();
    await gate;
    order.push("first-end");
  });
  const secondPair = [...firstPair, { player: "可以", gm: "她点了点头。" }];
  const second = source.persist("branch", secondPair, async () => {
    order.push("second");
  });

  await started;
  expect(source.recent("branch")).toEqual([]);
  expect(buildRecentDialogueContext(source.recent("branch"))).not.toContain("询问名字");
  expect(order).toEqual(["first-start"]);

  release();
  await Promise.all([first, second]);
  expect(order).toEqual(["first-start", "first-end", "second"]);
  expect(source.recent("branch")).toEqual(secondPair);
  expect(buildRecentDialogueContext(source.recent("branch"))).toContain("她点了点头。");
});

test("a rejected save never exposes its dialogue pair", async () => {
  const source = new PersistedDialogueSource();
  const failed = source.persist("branch", firstPair, async () => {
    throw new Error("disk full");
  });

  await expect(failed).rejects.toThrow("disk full");
  expect(source.recent("branch")).toEqual([]);
  expect(buildRecentDialogueContext(source.recent("branch"))).not.toContain("询问名字");
});
