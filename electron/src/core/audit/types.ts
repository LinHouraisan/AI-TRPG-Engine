export type AuditCompleteness = "open" | "complete" | "partial" | "aborted" | "not_applicable";

export type AuditSpanKind =
  | "program"
  | "model"
  | "retrieval"
  | "tool"
  | "guard"
  | "persistence";

export type AuditSpanStatus =
  | "started"
  | "succeeded"
  | "rejected"
  | "failed"
  | "aborted"
  | "skipped";

export type CandidateStatus =
  | "captured"
  | "auto_diagnosed"
  | "pending_review"
  | "reviewed"
  | "curated"
  | "exported"
  | "discarded";

export type DatasetUsage = "evaluation_only" | "sft" | "preference" | "discard";

export type DiagnosisCode =
  | "PROVIDER_FAILURE"
  | "CONTRACT_FAILURE"
  | "GUARD_REJECTION"
  | "STALE_STATE"
  | "ROUTE_INVALID"
  | "ROUTE_UNCERTAIN"
  | "CONTEXT_TRUNCATED"
  | "CONTEXT_MISSING"
  | "RETRIEVAL_MISS"
  | "RETRIEVAL_NOISE"
  | "EVENT_NARRATION_MISMATCH"
  | "GENERATION_DRIFT"
  | "STYLE_OR_PREFERENCE"
  | "UNKNOWN";

export type JsonObject = Record<string, unknown>;

export interface AuditRunStart {
  traceId: string;
  campaignId: string;
  branchId: string;
  operationId: string;
  baseStateVersion: number;
  startedAt: string;
  schemaVersion: string;
}

export interface AuditRunRecord extends AuditRunStart {
  turnId: string | null;
  committedStateVersion: number | null;
  finalNarrationId: string | null;
  completeness: AuditCompleteness;
  gapCodes: string[];
  finalizedAt: string | null;
}

export interface AuditSpanStart {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  sequence: number;
  kind: AuditSpanKind;
  stage: string;
  taskType: string;
  attempt: number;
  causal: boolean;
  modelTaskId?: string;
  basedOnStateVersion?: number;
  promptVersion?: string;
  modelId?: string;
  input: JsonObject;
  createdAt: string;
}

export interface AuditSpanFinish {
  status: Exclude<AuditSpanStatus, "started">;
  output?: JsonObject;
  errorCode?: string;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  completedAt: string;
}

export interface AuditSpanAppend extends AuditSpanStart, AuditSpanFinish {}

export interface AuditSpanRecord extends Omit<
  AuditSpanStart,
  "parentSpanId" | "modelTaskId" | "basedOnStateVersion" | "promptVersion" | "modelId"
> {
  parentSpanId: string | null;
  modelTaskId: string | null;
  basedOnStateVersion: number | null;
  promptVersion: string | null;
  modelId: string | null;
  output: JsonObject | null;
  status: AuditSpanStatus;
  errorCode: string | null;
  durationMs: number | null;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  completedAt: string | null;
  payloadSha256: string;
}

export interface AuditCase {
  run: AuditRunRecord;
  spans: AuditSpanRecord[];
}

export interface AuditSpanSink {
  start(input: Omit<AuditSpanStart, "spanId" | "traceId" | "sequence" | "createdAt">):
    | string
    | undefined;
  finish(spanId: string, input: Omit<AuditSpanFinish, "completedAt">): void;
  append(
    input: Omit<AuditSpanAppend, "spanId" | "traceId" | "sequence" | "createdAt" | "completedAt">,
  ): string | undefined;
  gap(code: string): void;
}
