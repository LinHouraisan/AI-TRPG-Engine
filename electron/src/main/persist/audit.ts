import { createHash } from "node:crypto";
import type {
  AuditCase,
  AuditCompleteness,
  AuditRunRecord,
  AuditRunStart,
  AuditSpanAppend,
  AuditSpanFinish,
  AuditSpanRecord,
  AuditSpanStart,
  CandidateStatus,
  DatasetUsage,
  DiagnosisCode,
  JsonObject,
} from "@core/audit/types";
import type { TurnDiagnosis } from "@core/audit/diagnosis";
import type { Driver } from "./driver";

type AuditRunRow = {
  trace_id: string;
  campaign_id: string;
  branch_id: string;
  turn_id: string | null;
  operation_id: string;
  base_state_version: number;
  committed_state_version: number | null;
  final_narration_id: string | null;
  completeness: AuditCompleteness;
  gap_codes_json: string;
  started_at: string;
  finalized_at: string | null;
  schema_version: string;
};

type AuditSpanRow = {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  sequence: number;
  kind: AuditSpanRecord["kind"];
  stage: string;
  task_type: string;
  attempt: number;
  causal: number;
  model_task_id: string | null;
  based_on_state_version: number | null;
  prompt_version: string | null;
  model_id: string | null;
  input_json: string;
  output_json: string | null;
  status: AuditSpanRecord["status"];
  error_code: string | null;
  duration_ms: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  created_at: string;
  completed_at: string | null;
  payload_sha256: string;
};

export type FeedbackRecord = {
  feedbackId: string;
  traceId: string;
  turnId: string;
  narrationId: string;
  rating: "dissatisfied";
  note: string | null;
  createdAt: string;
};

export type DiagnosisRecord = TurnDiagnosis & {
  diagnosisId: string;
  feedbackId: string;
  source: "rule" | "local_judge";
  createdAt: string;
};

export type DatasetCandidateRecord = {
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

export function startAuditRun(db: Driver, input: AuditRunStart): void {
  db.run(
    `INSERT INTO audit_runs (
      trace_id, campaign_id, branch_id, turn_id, operation_id,
      base_state_version, committed_state_version, final_narration_id,
      completeness, gap_codes_json, started_at, finalized_at, schema_version
    ) VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, 'open', '[]', ?, NULL, ?)`,
    [
      input.traceId,
      input.campaignId,
      input.branchId,
      input.operationId,
      input.baseStateVersion,
      input.startedAt,
      input.schemaVersion,
    ],
  );
}

export function bindAuditRun(
  db: Driver,
  traceId: string,
  input: { turnId: string; committedStateVersion: number | null },
): void {
  db.run(
    `UPDATE audit_runs
     SET turn_id = ?, committed_state_version = ?
     WHERE trace_id = ? AND completeness = 'open'`,
    [input.turnId, input.committedStateVersion, traceId],
  );
}

export function linkFinalNarration(db: Driver, traceId: string, narrationId: string): void {
  db.run(
    `UPDATE audit_runs SET final_narration_id = ?
     WHERE trace_id = ? AND completeness = 'open'`,
    [narrationId, traceId],
  );
}

export function finalizeAuditRun(
  db: Driver,
  traceId: string,
  input: { completeness: Exclude<AuditCompleteness, "open">; gapCodes: string[]; finalizedAt: string },
): void {
  db.run(
    `UPDATE audit_runs
     SET completeness = ?, gap_codes_json = ?, finalized_at = ?
     WHERE trace_id = ? AND completeness = 'open'`,
    [input.completeness, canonicalJson(input.gapCodes), input.finalizedAt, traceId],
  );
}

export function startAuditSpan(db: Driver, input: AuditSpanStart): string {
  const inputJson = canonicalJson(input.input);
  db.run(
    `INSERT INTO audit_spans (
      span_id, trace_id, parent_span_id, sequence, kind, stage, task_type,
      attempt, causal, model_task_id, based_on_state_version, prompt_version,
      model_id, input_json, output_json, status, error_code, duration_ms,
      prompt_tokens, completion_tokens, cached_tokens, created_at, completed_at, payload_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'started', NULL, NULL, 0, 0, 0, ?, NULL, ?)`,
    [
      input.spanId,
      input.traceId,
      input.parentSpanId ?? null,
      input.sequence,
      input.kind,
      input.stage,
      input.taskType,
      input.attempt,
      input.causal ? 1 : 0,
      input.modelTaskId ?? null,
      input.basedOnStateVersion ?? null,
      input.promptVersion ?? null,
      input.modelId ?? null,
      inputJson,
      input.createdAt,
      sha256(inputJson),
    ],
  );
  return input.spanId;
}

export function finishAuditSpan(db: Driver, spanId: string, input: AuditSpanFinish): void {
  const existing = db.get<{ status: string; input_json: string }>(
    "SELECT status, input_json FROM audit_spans WHERE span_id = ?",
    [spanId],
  );
  if (!existing) throw new Error("audit.span_not_found");
  if (existing.status !== "started") throw new Error("audit.span_already_finished");
  const outputJson = input.output === undefined ? null : canonicalJson(input.output);
  const payloadSha256 = sha256(
    canonicalJson({ input: JSON.parse(existing.input_json), output: input.output ?? null }),
  );
  db.run(
    `UPDATE audit_spans
     SET output_json = ?, status = ?, error_code = ?, duration_ms = ?,
         prompt_tokens = ?, completion_tokens = ?, cached_tokens = ?,
         completed_at = ?, payload_sha256 = ?
     WHERE span_id = ? AND status = 'started'`,
    [
      outputJson,
      input.status,
      input.errorCode ?? null,
      input.durationMs ?? null,
      input.promptTokens ?? 0,
      input.completionTokens ?? 0,
      input.cachedTokens ?? 0,
      input.completedAt,
      payloadSha256,
      spanId,
    ],
  );
}

export function appendAuditSpan(db: Driver, input: AuditSpanAppend): string {
  startAuditSpan(db, input);
  finishAuditSpan(db, input.spanId, input);
  return input.spanId;
}

export function recoverInterruptedAudits(db: Driver, now: string): void {
  db.transaction(() => {
    db.run(
      `UPDATE audit_spans
       SET status = 'aborted', error_code = 'PROCESS_INTERRUPTED', completed_at = ?
       WHERE status = 'started'`,
      [now],
    );
    db.run(
      `UPDATE audit_runs
       SET completeness = CASE WHEN final_narration_id IS NULL THEN 'aborted' ELSE 'partial' END,
           finalized_at = COALESCE(finalized_at, ?)
       WHERE completeness = 'open'`,
      [now],
    );
  });
}

export function loadAuditCase(db: Driver, traceId: string): AuditCase {
  const run = db.get<AuditRunRow>("SELECT * FROM audit_runs WHERE trace_id = ?", [traceId]);
  if (!run) throw new Error("audit.run_not_found");
  const spans = db.all<AuditSpanRow>(
    "SELECT * FROM audit_spans WHERE trace_id = ? ORDER BY sequence ASC",
    [traceId],
  );
  return { run: mapRun(run), spans: spans.map(mapSpan) };
}

export function findAuditTraceByOperation(db: Driver, operationId: string): string | undefined {
  return db.get<{ trace_id: string }>(
    "SELECT trace_id FROM audit_runs WHERE operation_id = ? ORDER BY started_at DESC LIMIT 1",
    [operationId],
  )?.trace_id;
}

export function findAuditCaseByNarration(db: Driver, narrationId: string): AuditCase | undefined {
  const traceId = db.get<{ trace_id: string }>(
    "SELECT trace_id FROM audit_runs WHERE final_narration_id = ?",
    [narrationId],
  )?.trace_id;
  return traceId ? loadAuditCase(db, traceId) : undefined;
}

export function captureDissatisfaction(db: Driver, input: {
  feedbackId: string;
  caseId: string;
  traceId: string;
  turnId: string;
  narrationId: string;
  note?: string;
  createdAt: string;
}): { feedback: FeedbackRecord; candidate: DatasetCandidateRecord } {
  return db.transaction(() => {
    db.run(
      `INSERT OR IGNORE INTO user_feedback (
        feedback_id, trace_id, turn_id, narration_id, rating, note, created_at
      ) VALUES (?, ?, ?, ?, 'dissatisfied', ?, ?)`,
      [
        input.feedbackId,
        input.traceId,
        input.turnId,
        input.narrationId,
        input.note?.trim() || null,
        input.createdAt,
      ],
    );
    const feedback = loadFeedbackByNarration(db, input.narrationId);
    if (!feedback) throw new Error("audit.feedback_insert_failed");
    db.run(
      `INSERT OR IGNORE INTO dataset_candidates (
        case_id, feedback_id, trace_id, status, confirmed_issue_tags_json,
        review_note, corrected_output, dataset_usage, reviewed_at, export_batch_id
      ) VALUES (?, ?, ?, 'captured', '[]', NULL, NULL, NULL, NULL, NULL)`,
      [input.caseId, feedback.feedbackId, feedback.traceId],
    );
    const candidate = loadCandidateByFeedback(db, feedback.feedbackId);
    if (!candidate) throw new Error("audit.candidate_insert_failed");
    return { feedback, candidate };
  });
}

export function saveRuleDiagnoses(db: Driver, input: {
  feedbackId: string;
  caseId: string;
  diagnoses: Array<TurnDiagnosis & { diagnosisId: string }>;
  createdAt: string;
}): DatasetCandidateRecord {
  return db.transaction(() => {
    for (const diagnosis of input.diagnoses) {
      db.run(
        `INSERT INTO diagnosis_results (
          diagnosis_id, feedback_id, source, code, confidence, severity,
          explanation, evidence_span_ids_json, rule_version, created_at
        ) VALUES (?, ?, 'rule', ?, ?, ?, ?, ?, ?, ?)`,
        [
          diagnosis.diagnosisId,
          input.feedbackId,
          diagnosis.code,
          diagnosis.confidence,
          diagnosis.severity,
          diagnosis.explanation,
          canonicalJson(diagnosis.evidenceSpanIds),
          diagnosis.ruleVersion,
          input.createdAt,
        ],
      );
    }
    db.run(
      `UPDATE dataset_candidates SET status = 'pending_review'
       WHERE case_id = ? AND status = 'captured'`,
      [input.caseId],
    );
    const candidate = loadCandidate(db, input.caseId);
    if (!candidate) throw new Error("audit.candidate_not_found");
    return candidate;
  });
}

export function loadFeedbackByNarration(db: Driver, narrationId: string): FeedbackRecord | undefined {
  const row = db.get<{
    feedback_id: string;
    trace_id: string;
    turn_id: string;
    narration_id: string;
    rating: "dissatisfied";
    note: string | null;
    created_at: string;
  }>("SELECT * FROM user_feedback WHERE narration_id = ? AND rating = 'dissatisfied'", [narrationId]);
  return row ? {
    feedbackId: row.feedback_id,
    traceId: row.trace_id,
    turnId: row.turn_id,
    narrationId: row.narration_id,
    rating: row.rating,
    note: row.note,
    createdAt: row.created_at,
  } : undefined;
}

export function loadFeedback(db: Driver, feedbackId: string): FeedbackRecord | undefined {
  const narrationId = db.get<{ narration_id: string }>(
    "SELECT narration_id FROM user_feedback WHERE feedback_id = ?",
    [feedbackId],
  )?.narration_id;
  return narrationId ? loadFeedbackByNarration(db, narrationId) : undefined;
}

export function loadCandidateByFeedback(db: Driver, feedbackId: string): DatasetCandidateRecord | undefined {
  const caseId = db.get<{ case_id: string }>(
    "SELECT case_id FROM dataset_candidates WHERE feedback_id = ?",
    [feedbackId],
  )?.case_id;
  return caseId ? loadCandidate(db, caseId) : undefined;
}

export function loadCandidate(db: Driver, caseId: string): DatasetCandidateRecord | undefined {
  const row = db.get<{
    case_id: string;
    feedback_id: string;
    trace_id: string;
    status: CandidateStatus;
    confirmed_issue_tags_json: string;
    review_note: string | null;
    corrected_output: string | null;
    dataset_usage: DatasetUsage | null;
    reviewed_at: string | null;
    export_batch_id: string | null;
  }>("SELECT * FROM dataset_candidates WHERE case_id = ?", [caseId]);
  return row ? {
    caseId: row.case_id,
    feedbackId: row.feedback_id,
    traceId: row.trace_id,
    status: row.status,
    confirmedIssueTags: JSON.parse(row.confirmed_issue_tags_json) as DiagnosisCode[],
    reviewNote: row.review_note,
    correctedOutput: row.corrected_output,
    datasetUsage: row.dataset_usage,
    reviewedAt: row.reviewed_at,
    exportBatchId: row.export_batch_id,
  } : undefined;
}

export function listCandidateRecords(db: Driver, input: {
  status?: CandidateStatus;
  cursor?: string;
  limit: number;
}): { items: DatasetCandidateRecord[]; nextCursor: string | null } {
  const limit = Math.max(1, Math.min(input.limit, 100));
  const rows = input.status
    ? db.all<{ case_id: string }>(
        `SELECT case_id FROM dataset_candidates
         WHERE status = ? AND (? IS NULL OR case_id > ?)
         ORDER BY case_id LIMIT ?`,
        [input.status, input.cursor ?? null, input.cursor ?? null, limit + 1],
      )
    : db.all<{ case_id: string }>(
        `SELECT case_id FROM dataset_candidates
         WHERE (? IS NULL OR case_id > ?)
         ORDER BY case_id LIMIT ?`,
        [input.cursor ?? null, input.cursor ?? null, limit + 1],
      );
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => loadCandidate(db, row.case_id)).filter((item): item is DatasetCandidateRecord => Boolean(item)),
    nextCursor: rows.length > limit ? page[page.length - 1]?.case_id ?? null : null,
  };
}

export function loadDiagnoses(db: Driver, feedbackId: string): DiagnosisRecord[] {
  return db.all<{
    diagnosis_id: string;
    feedback_id: string;
    source: "rule" | "local_judge";
    code: DiagnosisCode;
    confidence: DiagnosisRecord["confidence"];
    severity: DiagnosisRecord["severity"];
    explanation: string;
    evidence_span_ids_json: string;
    rule_version: typeof import("@core/audit/diagnosis").TURN_DIAGNOSIS_RULE_VERSION;
    created_at: string;
  }>(
    "SELECT * FROM diagnosis_results WHERE feedback_id = ? ORDER BY created_at, diagnosis_id",
    [feedbackId],
  ).map((row) => ({
    diagnosisId: row.diagnosis_id,
    feedbackId: row.feedback_id,
    source: row.source,
    code: row.code,
    confidence: row.confidence,
    severity: row.severity,
    explanation: row.explanation,
    evidenceSpanIds: JSON.parse(row.evidence_span_ids_json) as string[],
    ruleVersion: row.rule_version,
    createdAt: row.created_at,
  }));
}

export function updateCandidateReview(db: Driver, input: {
  caseId: string;
  status: "reviewed" | "curated" | "discarded";
  confirmedIssueTags: DiagnosisCode[];
  reviewNote?: string;
  correctedOutput?: string;
  datasetUsage: DatasetUsage;
  reviewedAt: string;
}): DatasetCandidateRecord {
  db.run(
    `UPDATE dataset_candidates
     SET status = ?, confirmed_issue_tags_json = ?, review_note = ?, corrected_output = ?,
         dataset_usage = ?, reviewed_at = ?
     WHERE case_id = ?`,
    [
      input.status,
      canonicalJson(input.confirmedIssueTags),
      input.reviewNote?.trim() || null,
      input.correctedOutput?.trim() || null,
      input.datasetUsage,
      input.reviewedAt,
      input.caseId,
    ],
  );
  const candidate = loadCandidate(db, input.caseId);
  if (!candidate) throw new Error("audit.candidate_not_found");
  return candidate;
}

export function loadFinalNarrationText(db: Driver, narrationId: string): string | undefined {
  return db.get<{ text: string }>(
    "SELECT text FROM narrations WHERE narration_id = ? AND status = 'final'",
    [narrationId],
  )?.text;
}

function mapRun(row: AuditRunRow): AuditRunRecord {
  return {
    traceId: row.trace_id,
    campaignId: row.campaign_id,
    branchId: row.branch_id,
    turnId: row.turn_id,
    operationId: row.operation_id,
    baseStateVersion: row.base_state_version,
    committedStateVersion: row.committed_state_version,
    finalNarrationId: row.final_narration_id,
    completeness: row.completeness,
    gapCodes: JSON.parse(row.gap_codes_json) as string[],
    startedAt: row.started_at,
    finalizedAt: row.finalized_at,
    schemaVersion: row.schema_version,
  };
}

function mapSpan(row: AuditSpanRow): AuditSpanRecord {
  return {
    spanId: row.span_id,
    traceId: row.trace_id,
    parentSpanId: row.parent_span_id,
    sequence: row.sequence,
    kind: row.kind,
    stage: row.stage,
    taskType: row.task_type,
    attempt: row.attempt,
    causal: row.causal === 1,
    modelTaskId: row.model_task_id,
    basedOnStateVersion: row.based_on_state_version,
    promptVersion: row.prompt_version,
    modelId: row.model_id,
    input: JSON.parse(row.input_json) as JsonObject,
    output: row.output_json === null ? null : JSON.parse(row.output_json) as JsonObject,
    status: row.status,
    errorCode: row.error_code,
    durationMs: row.duration_ms,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    cachedTokens: row.cached_tokens,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    payloadSha256: row.payload_sha256,
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
