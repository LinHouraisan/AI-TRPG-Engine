import { expect, test } from "bun:test";
import type { CheckCandidate } from "./types";
import { publishCheckCandidate } from "./check-preview";
import { activeCheckPreviewReducer, type ActiveCheckPreview } from "../session";

test("candidate state is published and yielded before resolution continues", async () => {
  const candidate: CheckCandidate = {
    title: "寻找让列车员开口的破绽",
    skill: "侦查",
    skillValue: 65,
    difficulty: "regular",
    threshold: 65,
  };
  const sequence: string[] = [];
  let preview: ActiveCheckPreview = null;

  await publishCheckCandidate({
    candidate,
    onCandidate: (published) => {
      preview = activeCheckPreviewReducer(preview, { type: "began", check: published });
      sequence.push(preview?.kind ?? "none");
    },
    yieldControl: async () => {
      sequence.push("yield");
    },
  });
  preview = activeCheckPreviewReducer(preview, {
    type: "resolved",
    check: {
      skill: "侦查",
      skillValue: 65,
      difficulty: "regular",
      threshold: 65,
      roll: 40,
      level: "成功",
      ok: true,
    },
  });
  sequence.push(preview?.kind ?? "none");

  expect(sequence).toEqual(["candidate", "yield", "resolved"]);
});

test("an action without a candidate does not add an artificial delay", async () => {
  const sequence: string[] = [];
  await publishCheckCandidate({
    candidate: null,
    onCandidate: () => sequence.push("candidate"),
    yieldControl: async () => {
      sequence.push("yield");
    },
  });
  sequence.push("resolved");
  expect(sequence).toEqual(["resolved"]);
});
