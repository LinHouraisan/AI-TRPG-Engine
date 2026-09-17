import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixedClock } from "../clock";
import { openBun } from "./bun-driver";
import { applyInit, applyMigration } from "./migrate";
import {
  finishAuditSpan,
  loadAuditCase,
  recoverInterruptedAudits,
  startAuditRun,
  startAuditSpan,
} from "./audit";

const now = "2026-09-17T10:00:00.000Z";

test("audit spans preserve sequence and can enter a terminal state only once", () => {
  const fixture = auditFixture();
  try {
    startAuditRun(fixture.db, fixture.run);
    const spanId = startAuditSpan(fixture.db, {
      spanId: "span-route-1",
      traceId: fixture.run.traceId,
      sequence: 1,
      kind: "model",
      stage: "gm.route",
      taskType: "gm.handle_free_turn",
      attempt: 1,
      causal: true,
      input: { messages: [{ role: "user", content: "查看门锁" }] },
      createdAt: now,
    });

    finishAuditSpan(fixture.db, spanId, {
      status: "succeeded",
      output: { rawContent: '{"verb":"observe","target":"lock.front"}' },
      durationMs: 12,
      promptTokens: 8,
      completionTokens: 4,
      cachedTokens: 0,
      completedAt: now,
    });

    expect(() =>
      finishAuditSpan(fixture.db, spanId, {
        status: "failed",
        errorCode: "NETWORK",
        completedAt: now,
      }),
    ).toThrow("audit.span_already_finished");
    const loaded = loadAuditCase(fixture.db, fixture.run.traceId);
    expect(loaded.spans).toHaveLength(1);
    expect(loaded.spans[0]).toMatchObject({
      spanId,
      sequence: 1,
      status: "succeeded",
      input: { messages: [{ role: "user", content: "查看门锁" }] },
      output: { rawContent: '{"verb":"observe","target":"lock.front"}' },
      promptTokens: 8,
      completionTokens: 4,
    });
    expect(loaded.spans[0]?.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
  } finally {
    fixture.db.close();
  }
});

test("startup recovery aborts unfinished spans and runs", () => {
  const fixture = auditFixture();
  try {
    startAuditRun(fixture.db, fixture.run);
    startAuditSpan(fixture.db, {
      spanId: "span-narrate-1",
      traceId: fixture.run.traceId,
      sequence: 1,
      kind: "model",
      stage: "gm.narrate",
      taskType: "gm.narrate_result",
      attempt: 1,
      causal: true,
      input: {},
      createdAt: now,
    });

    recoverInterruptedAudits(fixture.db, "2026-09-17T10:01:00.000Z");

    const loaded = loadAuditCase(fixture.db, fixture.run.traceId);
    expect(loaded.run.completeness).toBe("aborted");
    expect(loaded.run.finalizedAt).toBe("2026-09-17T10:01:00.000Z");
    expect(loaded.spans[0]).toMatchObject({
      status: "aborted",
      errorCode: "PROCESS_INTERRUPTED",
      completedAt: "2026-09-17T10:01:00.000Z",
    });
  } finally {
    fixture.db.close();
  }
});

function auditFixture() {
  const db = openBun(":memory:");
  const clock = fixedClock(now);
  const sqlDir = join(import.meta.dir, "../../../sql");
  applyInit(db, clock, readFileSync(join(sqlDir, "campaign.sql"), "utf8"), "0001_init");
  applyMigration(
    db,
    clock,
    readFileSync(join(sqlDir, "campaign-0008-turn-audit.sql"), "utf8"),
    "0008_turn_audit",
  );
  db.run("INSERT INTO branches VALUES ('main', NULL, NULL, '主线', 0, 0, ?, NULL)", [now]);
  return {
    db,
    run: {
      traceId: "trace-1",
      campaignId: "campaign-1",
      branchId: "main",
      operationId: "operation-1",
      baseStateVersion: 0,
      startedAt: now,
      schemaVersion: "turn-audit-v1",
    },
  };
}
