import { diagnoseTurn, type TurnDiagnosis } from "@core/audit/diagnosis";
import { exportAuditCases, type AuditExportSource } from "@core/audit/export";
import type {
  AuditCase,
  CandidateStatus,
} from "@core/audit/types";
import type {
  AuditCaseView,
  AuditExportResult,
  CandidateListInput,
  DatasetCandidateView,
  FeedbackReceipt,
  ReviewCandidateInput,
} from "../../shared/api";
import { uuidv7, type CampaignId } from "../../shared/ids";
import { fail, ok, type Result } from "../../shared/result";
import type { Clock } from "../clock";
import {
  captureDissatisfaction,
  findAuditCaseByNarration,
  listCandidateRecords,
  listExportableCandidates,
  loadAuditCase,
  loadCandidate,
  loadDiagnoses,
  loadFeedback,
  loadFinalNarrationText,
  loadPlayerInput,
  recordAuditExportBatch,
  saveRuleDiagnoses,
  updateCandidateReview,
  type DatasetCandidateRecord,
} from "../persist/audit";
import type { Driver } from "../persist/driver";
import type { CampaignService } from "./campaigns";

type Diagnose = (input: AuditCase) => TurnDiagnosis[];

export class AuditService {
  private readonly diagnose: Diagnose;

  constructor(
    private readonly campaigns: CampaignService,
    private readonly clock: Clock,
    diagnose?: Diagnose,
  ) {
    this.diagnose = diagnose ?? diagnoseTurn;
  }

  submitDissatisfied(input: {
    campaignId: CampaignId;
    narrationId: string;
    note?: string;
  }): Result<FeedbackReceipt> {
    const opened = this.campaigns.ensureOpen(input.campaignId);
    if (!opened.ok) return opened;
    const db = opened.value;
    const audit = findAuditCaseByNarration(db, input.narrationId);
    if (!audit || !audit.run.turnId || audit.run.finalNarrationId !== input.narrationId) {
      return fail({
        code: "AUDIT_NARRATION_NOT_FOUND",
        messageKey: "audit.narration_not_found",
        retryable: false,
      });
    }
    const captured = captureDissatisfaction(db, {
      feedbackId: uuidv7(),
      caseId: uuidv7(),
      traceId: audit.run.traceId,
      turnId: audit.run.turnId,
      narrationId: input.narrationId,
      note: input.note,
      createdAt: this.clock.nowIso(),
    });
    let candidate = captured.candidate;
    if (candidate.status === "captured") {
      try {
        const diagnoses = this.diagnose(audit);
        candidate = saveRuleDiagnoses(db, {
          feedbackId: captured.feedback.feedbackId,
          caseId: candidate.caseId,
          diagnoses: diagnoses.map((diagnosis) => ({ ...diagnosis, diagnosisId: uuidv7() })),
          createdAt: this.clock.nowIso(),
        });
      } catch {
        // Feedback capture is intentionally durable even if post-capture diagnosis fails.
      }
    }
    return ok({
      feedbackId: captured.feedback.feedbackId,
      caseId: candidate.caseId,
      traceId: candidate.traceId,
      status: candidate.status,
      diagnoses: loadDiagnoses(db, captured.feedback.feedbackId),
    });
  }

  listCandidates(input: CandidateListInput): Result<import("../../shared/api").Page<DatasetCandidateView>> {
    const opened = this.campaigns.ensureOpen(input.campaignId);
    if (!opened.ok) return opened;
    const page = listCandidateRecords(opened.value, input);
    return ok({
      items: page.items.map((candidate) => this.toCandidateView(opened.value, candidate)),
      nextCursor: page.nextCursor,
    });
  }

  getCandidate(input: { campaignId: CampaignId; caseId: string }): Result<AuditCaseView> {
    const opened = this.campaigns.ensureOpen(input.campaignId);
    if (!opened.ok) return opened;
    const db = opened.value;
    const candidate = loadCandidate(db, input.caseId);
    if (!candidate) return candidateNotFound();
    const feedback = loadFeedback(db, candidate.feedbackId);
    if (!feedback) return candidateNotFound();
    const audit = loadAuditCase(db, candidate.traceId);
    const narrationId = audit.run.finalNarrationId;
    const finalOutput = narrationId ? loadFinalNarrationText(db, narrationId) : undefined;
    if (!finalOutput) return candidateNotFound();
    return ok({
      audit,
      feedback,
      candidate: this.toCandidateView(db, candidate),
      finalOutput,
    });
  }

  reviewCandidate(input: ReviewCandidateInput): Result<DatasetCandidateView> {
    const correctedOutput = input.correctedOutput?.trim();
    if ((input.datasetUsage === "sft" || input.datasetUsage === "preference") && !correctedOutput) {
      return fail({
        code: "AUDIT_CORRECTED_OUTPUT_REQUIRED",
        messageKey: "audit.corrected_output_required",
        retryable: false,
      });
    }
    const opened = this.campaigns.ensureOpen(input.campaignId);
    if (!opened.ok) return opened;
    const db = opened.value;
    const candidate = loadCandidate(db, input.caseId);
    if (!candidate) return candidateNotFound();
    if (!canReview(candidate.status, input.status)) {
      return fail({
        code: "AUDIT_INVALID_STATUS_TRANSITION",
        messageKey: "audit.invalid_status_transition",
        retryable: false,
      });
    }
    const audit = loadAuditCase(db, candidate.traceId);
    if (input.status === "curated" && audit.run.completeness !== "complete") {
      return fail({
        code: "AUDIT_RUN_INCOMPLETE",
        messageKey: "audit.run_incomplete",
        retryable: false,
      });
    }
    const updated = updateCandidateReview(db, {
      caseId: input.caseId,
      status: input.status,
      confirmedIssueTags: input.confirmedIssueTags,
      reviewNote: input.reviewNote,
      correctedOutput,
      datasetUsage: input.datasetUsage,
      reviewedAt: this.clock.nowIso(),
    });
    return ok(this.toCandidateView(db, updated));
  }

  exportCandidates(input: {
    campaignId: CampaignId;
    caseIds?: string[];
  }): Result<AuditExportResult> {
    const opened = this.campaigns.ensureOpen(input.campaignId);
    if (!opened.ok) return opened;
    const exported = exportCandidateBatch(opened.value, this.clock.nowIso(), input.caseIds);
    if (!exported) {
      return fail({
        code: "AUDIT_NO_ELIGIBLE_CANDIDATES",
        messageKey: "audit.no_eligible_candidates",
        retryable: false,
      });
    }
    return ok(exported);
  }

  private toCandidateView(
    db: Parameters<typeof loadDiagnoses>[0],
    candidate: DatasetCandidateRecord,
  ): DatasetCandidateView {
    const audit = loadAuditCase(db, candidate.traceId);
    const feedback = loadFeedback(db, candidate.feedbackId);
    return {
      ...candidate,
      diagnoses: loadDiagnoses(db, candidate.feedbackId),
      createdAt: feedback?.createdAt ?? audit.run.startedAt,
      taskTypes: unique(audit.spans.map((span) => span.taskType)),
      modelIds: unique(audit.spans.map((span) => span.modelId).filter((value): value is string => Boolean(value))),
      promptVersions: unique(audit.spans.map((span) => span.promptVersion).filter((value): value is string => Boolean(value))),
    };
  }
}

export function exportCandidateBatch(
  db: Driver,
  createdAt: string,
  caseIds?: string[],
): AuditExportResult | null {
  const candidates = listExportableCandidates(db, caseIds);
  const sources: AuditExportSource[] = [];
  for (const candidate of candidates) {
    const audit = loadAuditCase(db, candidate.traceId);
    const feedback = loadFeedback(db, candidate.feedbackId);
    const turnId = audit.run.turnId;
    const narrationId = audit.run.finalNarrationId;
    if (!feedback || !turnId || !narrationId) continue;
    const playerInput = loadPlayerInput(db, turnId);
    const finalOutput = loadFinalNarrationText(db, narrationId);
    if (playerInput === undefined || finalOutput === undefined) continue;
    sources.push({
      candidate,
      audit,
      playerInput,
      finalOutput,
      feedback: { rating: feedback.rating, note: feedback.note },
      diagnoses: loadDiagnoses(db, feedback.feedbackId).map((diagnosis) => ({
        code: diagnosis.code,
        confidence: diagnosis.confidence,
        severity: diagnosis.severity,
        explanation: diagnosis.explanation,
        evidenceSpanIds: diagnosis.evidenceSpanIds,
        ruleVersion: diagnosis.ruleVersion,
      })),
    });
  }
  const exported = exportAuditCases(sources);
  if (exported.manifest.count === 0) return null;
  const exportBatchId = uuidv7();
  recordAuditExportBatch(db, {
    exportBatchId,
    filters: { caseIds: caseIds ?? null },
    schemaVersion: exported.manifest.schemaVersion,
    caseIds: exported.manifest.caseIds,
    sha256: exported.manifest.sha256,
    createdAt,
  });
  return {
    fileName: `audit-cases-${exportBatchId}.jsonl`,
    jsonl: exported.jsonl,
    manifest: {
      exportBatchId,
      ...exported.manifest,
      createdAt,
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function canReview(
  current: CandidateStatus,
  target: ReviewCandidateInput["status"],
): boolean {
  if (current === target) return true;
  if (current === "pending_review") return true;
  return current === "reviewed" && (target === "curated" || target === "discarded");
}

function candidateNotFound(): Result<never> {
  return fail({
    code: "AUDIT_CANDIDATE_NOT_FOUND",
    messageKey: "audit.candidate_not_found",
    retryable: false,
  });
}
