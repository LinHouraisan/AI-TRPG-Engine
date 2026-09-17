import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AuditCase, AuditSpanRecord, DatasetUsage } from "./types";
import { exportAuditCases, parseAuditCaseLine, type AuditExportSource } from "./export";

test("exports only eligible curated complete cases as stable safe JSONL", () => {
  const sources = [
    source("case-eval", "evaluation_only"),
    source("case-sft", "sft", { correctedOutput: "修订后的正确回复" }),
    source("case-not-curated", "evaluation_only", { status: "reviewed" }),
    source("case-incomplete", "evaluation_only", { completeness: "partial" }),
    source("case-bad-sft", "sft"),
  ];
  const exported = exportAuditCases(sources);
  expect(exported.manifest.schemaVersion).toBe("audit-case-v1");
  expect(exported.manifest.count).toBe(2);
  expect(sha256(exported.jsonl)).toBe(exported.manifest.sha256);
  expect(exported.jsonl.endsWith("\n")).toBe(true);
  expect(exported.manifest.caseIds).toEqual(["case-eval", "case-sft"]);
  for (const line of exported.jsonl.trimEnd().split("\n")) {
    expect(parseAuditCaseLine(line).schema_version).toBe("audit-case-v1");
  }
  expect(exported.jsonl).not.toMatch(/authorization|api[_-]?key|credential/i);
  expect(exported.jsonl).not.toContain("隐藏正文");
  expect(exported.jsonl).not.toContain("秘密上下文正文");
  expect(exported.jsonl).toContain("gm_only");
  expect(exported.jsonl).toContain("secret-source");
});

test("serialization is deterministic regardless of source order", () => {
  const one = source("case-a", "evaluation_only");
  const two = source("case-b", "preference", { correctedOutput: "chosen" });
  expect(exportAuditCases([two, one])).toEqual(exportAuditCases([one, two]));
});

function source(
  caseId: string,
  datasetUsage: DatasetUsage,
  overrides: { correctedOutput?: string; status?: AuditExportSource["candidate"]["status"]; completeness?: AuditCase["run"]["completeness"] } = {},
): AuditExportSource {
  const audit = auditCase(caseId, overrides.completeness ?? "complete");
  return {
    candidate: {
      caseId,
      feedbackId: `feedback-${caseId}`,
      traceId: audit.run.traceId,
      status: overrides.status ?? "curated",
      confirmedIssueTags: ["UNKNOWN"],
      reviewNote: "已复核",
      correctedOutput: overrides.correctedOutput ?? null,
      datasetUsage,
      reviewedAt: "2026-09-17T10:05:00.000Z",
      exportBatchId: null,
    },
    audit,
    playerInput: "看看四周",
    finalOutput: "原始回复",
    feedback: { rating: "dissatisfied", note: "上下文不对" },
    diagnoses: [{
      code: "UNKNOWN",
      confidence: "low",
      severity: "info",
      explanation: "证据不足",
      evidenceSpanIds: ["span-model"],
      ruleVersion: "turn-diagnosis-v1",
    }],
  };
}

function auditCase(caseId: string, completeness: AuditCase["run"]["completeness"]): AuditCase {
  return {
    run: {
      traceId: `trace-${caseId}`,
      campaignId: "campaign-1",
      branchId: "branch-1",
      turnId: `turn-${caseId}`,
      operationId: `operation-${caseId}`,
      baseStateVersion: 1,
      committedStateVersion: 2,
      finalNarrationId: `narration-${caseId}`,
      completeness,
      gapCodes: [],
      startedAt: "2026-09-17T10:00:00.000Z",
      finalizedAt: "2026-09-17T10:00:01.000Z",
      schemaVersion: "turn-audit-v1",
    },
    spans: [modelSpan(caseId)],
  };
}

function modelSpan(caseId: string): AuditSpanRecord {
  return {
    spanId: "span-model",
    traceId: `trace-${caseId}`,
    parentSpanId: null,
    sequence: 1,
    kind: "model",
    stage: "gm.narrate",
    taskType: "gm.narrate_result",
    attempt: 1,
    causal: true,
    modelTaskId: "task-1",
    basedOnStateVersion: 2,
    promptVersion: "keeper-w0",
    modelId: "local-model",
    input: {
      authorization: "Bearer secret",
      apiKey: "secret",
      messages: [{ role: "user", content: "公开输入\n秘密上下文正文" }],
      request: { messages: [{ role: "user", content: "公开输入\n秘密上下文正文" }] },
      manifest: {
        finalText: "公开上下文\n秘密上下文正文",
        entries: [
          { visibility: "gm_only", sourceId: "secret-1", text: "隐藏正文" },
          { visibility: "secret", sourceId: "secret-source", text: "秘密上下文正文" },
        ],
      },
    },
    output: { rawContent: "原始回复", parsed: { text: "原始回复" } },
    status: "succeeded",
    errorCode: null,
    durationMs: 10,
    promptTokens: 20,
    completionTokens: 10,
    cachedTokens: 0,
    createdAt: "2026-09-17T10:00:00.000Z",
    completedAt: "2026-09-17T10:00:00.010Z",
    payloadSha256: "span-sha",
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
