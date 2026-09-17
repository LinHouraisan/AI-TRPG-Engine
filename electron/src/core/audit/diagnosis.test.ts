import { expect, test } from "bun:test";
import type { AuditCase, AuditSpanRecord, DiagnosisCode, JsonObject } from "./types";
import { diagnoseTurn } from "./diagnosis";

test("dissatisfaction alone produces UNKNOWN instead of generation drift", () => {
  expect(diagnoseTurn(auditCase(span({ stage: "narration.select", output: { source: "模型" } })))).toEqual([
    expect.objectContaining({
      code: "UNKNOWN",
      confidence: "low",
      ruleVersion: "turn-diagnosis-v1",
    }),
  ]);
});

test("structured causal evidence maps to the ordered diagnosis codes", () => {
  const cases: Array<[DiagnosisCode, AuditSpanRecord]> = [
    ["PROVIDER_FAILURE", span({ kind: "model", stage: "gm.narrate", status: "failed", errorCode: "TIMEOUT" })],
    ["CONTRACT_FAILURE", span({ kind: "model", stage: "gm.narrate", status: "failed", errorCode: "CONTRACT" })],
    ["GUARD_REJECTION", span({ kind: "guard", stage: "guard.facts", status: "rejected", errorCode: "UNAUTHORIZED_FACT" })],
    ["STALE_STATE", span({ kind: "guard", stage: "route.validate", status: "rejected", errorCode: "STALE_STATE" })],
    ["ROUTE_INVALID", span({ kind: "guard", stage: "route.validate", status: "rejected", errorCode: "ROUTE_INVALID" })],
    ["ROUTE_UNCERTAIN", span({ stage: "route.validate", output: { finalIntent: { kind: "unclear" } } })],
    ["CONTEXT_TRUNCATED", span({ stage: "context.build", output: { manifest: { entries: [{ included: false, dropReason: "budget" }] } } })],
    ["CONTEXT_MISSING", span({ stage: "context.build", output: { missingRequiredSourceIds: ["npc.clerk"] } })],
    ["RETRIEVAL_MISS", span({ kind: "retrieval", stage: "retrieval.context", output: { expectedFactIds: ["fact.one"], hits: [] } })],
    ["RETRIEVAL_NOISE", span({ kind: "retrieval", stage: "retrieval.context", output: { noisyHitIds: ["doc.old"] } })],
    ["EVENT_NARRATION_MISMATCH", span({ kind: "guard", stage: "narration.consistency", status: "rejected", output: { eventMismatch: true } })],
    ["GENERATION_DRIFT", span({ kind: "guard", stage: "narration.consistency", status: "rejected", output: { semanticDrift: true } })],
    ["STYLE_OR_PREFERENCE", span({ kind: "guard", stage: "narration.consistency", output: { preferenceIssue: true } })],
  ];

  for (const [code, evidence] of cases) {
    expect(diagnoseTurn(auditCase(evidence)).map((item) => item.code)).toContain(code);
  }
});

test("every diagnosis cites an existing causal span", () => {
  const input = auditCase(span({
    kind: "model",
    stage: "gm.narrate",
    status: "failed",
    errorCode: "NETWORK",
  }));
  const known = new Set(input.spans.filter((item) => item.causal).map((item) => item.spanId));
  for (const diagnosis of diagnoseTurn(input)) {
    expect(diagnosis.evidenceSpanIds.length).toBeGreaterThan(0);
    expect(diagnosis.evidenceSpanIds.every((id) => known.has(id))).toBe(true);
  }
});

test("non-causal evidence and free-text keywords do not create diagnoses", () => {
  const evidence = span({
    causal: false,
    stage: "narration.consistency",
    output: { semanticDrift: true, preferenceIssue: true },
    input: { note: "风格不好而且跑偏" },
  });
  expect(diagnoseTurn(auditCase(evidence)).map((item) => item.code)).toEqual(["UNKNOWN"]);
});

function auditCase(...spans: AuditSpanRecord[]): AuditCase {
  const finalSelection = spans.find((item) => item.stage === "narration.select")
    ?? span({ spanId: "span-final", sequence: spans.length + 1, stage: "narration.select" });
  return {
    run: {
      traceId: "trace-1",
      campaignId: "campaign-1",
      branchId: "branch-1",
      turnId: "turn-1",
      operationId: "operation-1",
      baseStateVersion: 1,
      committedStateVersion: 2,
      finalNarrationId: "narration-1",
      completeness: "complete",
      gapCodes: [],
      startedAt: "2026-09-17T10:00:00.000Z",
      finalizedAt: "2026-09-17T10:00:01.000Z",
      schemaVersion: "turn-audit-v1",
    },
    spans: spans.includes(finalSelection) ? spans : [...spans, finalSelection],
  };
}

function span(overrides: Partial<AuditSpanRecord> = {}): AuditSpanRecord {
  return {
    spanId: overrides.spanId ?? "span-1",
    traceId: "trace-1",
    parentSpanId: null,
    sequence: overrides.sequence ?? 1,
    kind: overrides.kind ?? "program",
    stage: overrides.stage ?? "turn.received",
    taskType: "turn.submitAction",
    attempt: 1,
    causal: overrides.causal ?? true,
    modelTaskId: null,
    basedOnStateVersion: 1,
    promptVersion: null,
    modelId: null,
    input: overrides.input ?? {},
    output: (overrides.output ?? {}) as JsonObject,
    status: overrides.status ?? "succeeded",
    errorCode: overrides.errorCode ?? null,
    durationMs: 1,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    createdAt: "2026-09-17T10:00:00.000Z",
    completedAt: "2026-09-17T10:00:00.001Z",
    payloadSha256: "sha",
  };
}
