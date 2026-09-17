import type { DatasetUsage } from "@core/audit/types";

export type FeedbackUiState =
  | { status: "idle" }
  | { status: "saving"; narrationId: string }
  | { status: "saved"; narrationId: string; caseId: string; diagnosis?: string }
  | { status: "failed"; narrationId: string; error: string };

export type FeedbackUiAction =
  | { type: "saving"; narrationId: string }
  | { type: "saved"; narrationId: string; caseId: string; diagnosis?: string }
  | { type: "failed"; narrationId: string; error: string }
  | { type: "reset" };

export const initialFeedbackState: FeedbackUiState = { status: "idle" };

export function feedbackReducer(
  _state: FeedbackUiState,
  action: FeedbackUiAction,
): FeedbackUiState {
  if (action.type === "reset") return initialFeedbackState;
  if (action.type === "saving") return { status: "saving", narrationId: action.narrationId };
  if (action.type === "saved") {
    return {
      status: "saved",
      narrationId: action.narrationId,
      caseId: action.caseId,
      ...(action.diagnosis ? { diagnosis: action.diagnosis } : {}),
    };
  }
  return { status: "failed", narrationId: action.narrationId, error: action.error };
}

export function isFeedbackSubmissionBlocked(state: FeedbackUiState, narrationId: string): boolean {
  return (state.status === "saving" || state.status === "saved")
    && state.narrationId === narrationId;
}

export function validateCandidateReview(input: {
  datasetUsage: DatasetUsage;
  correctedOutput?: string;
}): string | null {
  if ((input.datasetUsage === "sft" || input.datasetUsage === "preference")
    && !input.correctedOutput?.trim()) {
    return "SFT 或偏好数据必须填写人工修订后的正确回复。";
  }
  return null;
}
