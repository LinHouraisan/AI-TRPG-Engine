import type { AuditCompleteness, AuditSpanSink } from "@core/audit/types";
import { uuidv7 } from "../../shared/ids";
import type { Clock } from "../clock";
import {
  appendAuditSpan,
  bindAuditRun,
  finalizeAuditRun,
  linkFinalNarration,
  startAuditRun,
  startAuditSpan,
  finishAuditSpan,
} from "../persist/audit";
import type { Driver } from "../persist/driver";

export interface TurnAuditRecorder extends AuditSpanSink {
  readonly traceId: string;
  readonly operationId: string;
  bindTurn(input: { turnId: string; committedStateVersion: number | null }): void;
  linkFinalNarration(input: { narrationId: string; sourceSpanId?: string }): void;
  finalize(completeness?: Exclude<AuditCompleteness, "open">): void;
}

export function beginTurnAudit(input: {
  db: Driver;
  clock: Clock;
  campaignId: string;
  branchId: string;
  operationId: string;
  baseStateVersion: number;
  traceId?: string;
}): TurnAuditRecorder {
  const traceId = input.traceId ?? uuidv7();
  const gaps = new Set<string>();
  let sequence = 0;
  let runStarted = false;
  let finalized = false;

  try {
    startAuditRun(input.db, {
      traceId,
      campaignId: input.campaignId,
      branchId: input.branchId,
      operationId: input.operationId,
      baseStateVersion: input.baseStateVersion,
      startedAt: input.clock.nowIso(),
      schemaVersion: "turn-audit-v1",
    });
    runStarted = true;
  } catch {
    gaps.add("AUDIT_RUN_START_FAILED");
  }

  const gap = (code: string) => {
    gaps.add(code);
  };

  const start: AuditSpanSink["start"] = (span) => {
    if (!runStarted || finalized) return undefined;
    sequence += 1;
    const spanId = uuidv7();
    try {
      startAuditSpan(input.db, {
        ...span,
        spanId,
        traceId,
        sequence,
        createdAt: input.clock.nowIso(),
      });
      return spanId;
    } catch {
      gaps.add("AUDIT_SPAN_START_FAILED");
      return undefined;
    }
  };

  const finish: AuditSpanSink["finish"] = (spanId, span) => {
    if (!runStarted || finalized) return;
    try {
      finishAuditSpan(input.db, spanId, { ...span, completedAt: input.clock.nowIso() });
    } catch {
      gaps.add("AUDIT_SPAN_FINISH_FAILED");
    }
  };

  const append: AuditSpanSink["append"] = (span) => {
    if (!runStarted || finalized) return undefined;
    sequence += 1;
    const spanId = uuidv7();
    try {
      appendAuditSpan(input.db, {
        ...span,
        spanId,
        traceId,
        sequence,
        createdAt: input.clock.nowIso(),
        completedAt: input.clock.nowIso(),
      });
      return spanId;
    } catch {
      gaps.add("AUDIT_SPAN_APPEND_FAILED");
      return undefined;
    }
  };

  return {
    traceId,
    operationId: input.operationId,
    start,
    finish,
    append,
    gap,
    bindTurn(binding) {
      if (!runStarted || finalized) return;
      try {
        bindAuditRun(input.db, traceId, binding);
      } catch {
        gaps.add("AUDIT_RUN_BIND_FAILED");
      }
    },
    linkFinalNarration(link) {
      if (!runStarted || finalized) return;
      try {
        linkFinalNarration(input.db, traceId, link.narrationId);
      } catch {
        gaps.add("AUDIT_NARRATION_LINK_FAILED");
      }
    },
    finalize(completeness = "complete") {
      if (!runStarted || finalized) return;
      const resolved = gaps.size > 0 && completeness === "complete" ? "partial" : completeness;
      try {
        finalizeAuditRun(input.db, traceId, {
          completeness: resolved,
          gapCodes: [...gaps],
          finalizedAt: input.clock.nowIso(),
        });
        finalized = true;
      } catch {
        gaps.add("AUDIT_RUN_FINALIZE_FAILED");
      }
    },
  };
}
