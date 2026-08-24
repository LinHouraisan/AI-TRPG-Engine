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

test("an immediate follow-up snapshot waits for the preceding successful save", async () => {
  const source = new PersistedDialogueSource();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pending = source.persist("branch", firstPair, async () => { await gate; });

  let settled = false;
  const snapshot = source.snapshot("branch").then((turns) => {
    settled = true;
    return turns;
  });
  await Promise.resolve();
  expect(settled).toBe(false);

  release();
  await pending;
  expect(await snapshot).toEqual(firstPair);
});

test("an immediate follow-up snapshot excludes a preceding failed save", async () => {
  const source = new PersistedDialogueSource();
  void source.persist("branch", firstPair, async () => {
    throw new Error("disk full");
  }).catch(() => undefined);

  expect(await source.snapshot("branch")).toEqual([]);
});
