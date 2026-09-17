import { createHash } from "node:crypto";
import type {
  AuditCase,
  CandidateStatus,
  DatasetUsage,
  DiagnosisCode,
} from "./types";
import type {
  DiagnosisConfidence,
  DiagnosisSeverity,
} from "./diagnosis";
import {
  collectPrivateAuditTexts,
  redactAuditText,
  redactAuditValue,
} from "./privacy";

export const AUDIT_CASE_SCHEMA_VERSION = "audit-case-v1" as const;

export type AuditExportSource = {
  candidate: {
    caseId: string;
    feedbackId: string;
    traceId: string;
    status: CandidateStatus;
    confirmedIssueTags: DiagnosisCode[];
    reviewNote: string | null;
    correctedOutput: string | null;
    datasetUsage: DatasetUsage | null;
    reviewedAt: string | null;
    exportBatchId: string | null;
  };
  audit: AuditCase;
  playerInput: string;
  finalOutput: string;
  feedback: { rating: "dissatisfied"; note: string | null };
  diagnoses: Array<{
    code: DiagnosisCode;
    confidence: DiagnosisConfidence;
    severity: DiagnosisSeverity;
    explanation: string;
    evidenceSpanIds: string[];
    ruleVersion: string;
  }>;
};

export type AuditCaseV1 = {
  schema_version: typeof AUDIT_CASE_SCHEMA_VERSION;
  case_id: string;
  trace_id: string;
  turn: {
    player_input: string;
    base_state_version: number;
    committed_state_version: number | null;
  };
  model_calls: unknown[];
  program_steps: unknown[];
  final_output: string;
  feedback: { rating: "dissatisfied"; note: string | null };
  diagnoses: Array<{
    code: DiagnosisCode;
    confidence: DiagnosisConfidence;
    severity: DiagnosisSeverity;
    explanation: string;
    evidence_span_ids: string[];
    rule_version: string;
  }>;
  manual_review: {
    confirmed_tags: DiagnosisCode[];
    review_note: string | null;
    corrected_output: string | null;
    dataset_usage: Exclude<DatasetUsage, "discard">;
    reviewed_at: string | null;
  };
};

export type AuditExportManifest = {
  schemaVersion: typeof AUDIT_CASE_SCHEMA_VERSION;
  count: number;
  sha256: string;
  caseIds: string[];
};

export function exportAuditCases(sources: AuditExportSource[]): {
  jsonl: string;
  manifest: AuditExportManifest;
} {
  const eligible = sources.filter(isEligible).sort((left, right) =>
    compareText(left.candidate.caseId, right.candidate.caseId));
  const cases = eligible.map(toAuditCaseV1);
  const jsonl = cases.length > 0 ? `${cases.map(stableJson).join("\n")}\n` : "";
  return {
    jsonl,
    manifest: {
      schemaVersion: AUDIT_CASE_SCHEMA_VERSION,
      count: cases.length,
      sha256: sha256(jsonl),
      caseIds: cases.map((item) => item.case_id),
    },
  };
}

export function parseAuditCaseLine(line: string): AuditCaseV1 {
  const value = JSON.parse(line) as Partial<AuditCaseV1>;
  if (value.schema_version !== AUDIT_CASE_SCHEMA_VERSION || typeof value.case_id !== "string") {
    throw new Error("audit.export_invalid_line");
  }
  return value as AuditCaseV1;
}

function isEligible(source: AuditExportSource): boolean {
  if (!["curated", "exported"].includes(source.candidate.status)
    || source.audit.run.completeness !== "complete") return false;
  const usage = source.candidate.datasetUsage;
  if (!usage || usage === "discard") return false;
  if ((usage === "sft" || usage === "preference") && !source.candidate.correctedOutput?.trim()) return false;
  return source.candidate.traceId === source.audit.run.traceId
    && source.audit.run.finalNarrationId !== null
    && source.audit.run.turnId !== null;
}

function toAuditCaseV1(source: AuditExportSource): AuditCaseV1 {
  const privateTexts = collectPrivateAuditTexts(source.audit.spans);
  const modelCalls = source.audit.spans.filter((span) => span.kind === "model").map((span) => ({
    span_id: span.spanId,
    parent_span_id: span.parentSpanId,
    sequence: span.sequence,
    stage: span.stage,
    task_type: span.taskType,
    attempt: span.attempt,
    causal: span.causal,
    model_task_id: span.modelTaskId,
    model_id: span.modelId,
    prompt_version: span.promptVersion,
    based_on_state_version: span.basedOnStateVersion,
    input: redactAuditValue(span.input, privateTexts),
    output: redactAuditValue(span.output, privateTexts),
    status: span.status,
    error_code: span.errorCode,
    tokens: {
      prompt: span.promptTokens,
      completion: span.completionTokens,
      cached: span.cachedTokens,
    },
    evidence_id: span.payloadSha256,
  }));
  const programSteps = source.audit.spans.filter((span) => span.kind !== "model").map((span) => ({
    span_id: span.spanId,
    parent_span_id: span.parentSpanId,
    sequence: span.sequence,
    kind: span.kind,
    stage: span.stage,
    task_type: span.taskType,
    causal: span.causal,
    based_on_state_version: span.basedOnStateVersion,
    input: redactAuditValue(span.input, privateTexts),
    output: redactAuditValue(span.output, privateTexts),
    status: span.status,
    error_code: span.errorCode,
    evidence_id: span.payloadSha256,
  }));
  return {
    schema_version: AUDIT_CASE_SCHEMA_VERSION,
    case_id: source.candidate.caseId,
    trace_id: source.audit.run.traceId,
    turn: {
      player_input: redactAuditText(source.playerInput, privateTexts),
      base_state_version: source.audit.run.baseStateVersion,
      committed_state_version: source.audit.run.committedStateVersion,
    },
    model_calls: modelCalls,
    program_steps: programSteps,
    final_output: redactAuditText(source.finalOutput, privateTexts),
    feedback: {
      rating: source.feedback.rating,
      note: source.feedback.note === null ? null : redactAuditText(source.feedback.note, privateTexts),
    },
    diagnoses: source.diagnoses.map((diagnosis) => ({
      code: diagnosis.code,
      confidence: diagnosis.confidence,
      severity: diagnosis.severity,
      explanation: redactAuditText(diagnosis.explanation, privateTexts),
      evidence_span_ids: diagnosis.evidenceSpanIds,
      rule_version: diagnosis.ruleVersion,
    })),
    manual_review: {
      confirmed_tags: source.candidate.confirmedIssueTags,
      review_note: source.candidate.reviewNote === null
        ? null
        : redactAuditText(source.candidate.reviewNote, privateTexts),
      corrected_output: source.candidate.correctedOutput === null
        ? null
        : redactAuditText(source.candidate.correctedOutput, privateTexts),
      dataset_usage: source.candidate.datasetUsage as Exclude<DatasetUsage, "discard" | null>,
      reviewed_at: source.candidate.reviewedAt,
    },
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, sortObjectKeys(entry)]),
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
