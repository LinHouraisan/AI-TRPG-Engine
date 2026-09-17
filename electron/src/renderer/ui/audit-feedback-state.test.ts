import { expect, test } from "bun:test";
import {
  feedbackReducer,
  initialFeedbackState,
  isFeedbackSubmissionBlocked,
  validateCandidateReview,
} from "./audit-feedback-state";

test("feedback state moves from idle to saving and saved", () => {
  const saving = feedbackReducer(initialFeedbackState, {
    type: "saving",
    narrationId: "narration-1",
  });
  expect(saving).toEqual({ status: "saving", narrationId: "narration-1" });
  expect(isFeedbackSubmissionBlocked(saving, "narration-1")).toBe(true);

  const saved = feedbackReducer(saving, {
    type: "saved",
    narrationId: "narration-1",
    caseId: "case-1",
    diagnosis: "UNKNOWN",
  });
  expect(saved).toEqual({
    status: "saved",
    narrationId: "narration-1",
    caseId: "case-1",
    diagnosis: "UNKNOWN",
  });
  expect(isFeedbackSubmissionBlocked(saved, "narration-1")).toBe(true);
  expect(isFeedbackSubmissionBlocked(saved, "narration-2")).toBe(false);
});

test("feedback failure can be retried", () => {
  const failed = feedbackReducer(
    { status: "saving", narrationId: "narration-1" },
    { type: "failed", narrationId: "narration-1", error: "保存失败" },
  );
  expect(failed).toEqual({ status: "failed", narrationId: "narration-1", error: "保存失败" });
  expect(isFeedbackSubmissionBlocked(failed, "narration-1")).toBe(false);
});

test("training and preference review require corrected output", () => {
  for (const datasetUsage of ["sft", "preference"] as const) {
    expect(validateCandidateReview({ datasetUsage, correctedOutput: "  " })).toBe(
      "SFT 或偏好数据必须填写人工修订后的正确回复。",
    );
  }
  expect(validateCandidateReview({ datasetUsage: "evaluation_only", correctedOutput: "" })).toBeNull();
});
