import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock } from "../clock";
import { openBun } from "../persist/bun-driver";
import { applyInit } from "../persist/migrate";
import {
  appendAuditSpan,
  bindAuditRun,
  finalizeAuditRun,
  linkFinalNarration,
  startAuditRun,
} from "../persist/audit";
import { resolvePaths } from "../paths";
import { CampaignService } from "./campaigns";
import { AuditService } from "./audit-service";

const now = "2026-09-17T10:00:00.000Z";

test("repeated dissatisfaction reuses one feedback and candidate", () => {
  const fixture = auditFixture();
  try {
    const first = fixture.audit.submitDissatisfied({
      campaignId: fixture.campaignId,
      narrationId: fixture.narrationId,
      note: "不符合上一轮上下文",
    });
    const second = fixture.audit.submitDissatisfied({
      campaignId: fixture.campaignId,
      narrationId: fixture.narrationId,
      note: "重复点击不应新增",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("feedback failed");
    expect(second.value).toMatchObject({
      feedbackId: first.value.feedbackId,
      caseId: first.value.caseId,
      status: "pending_review",
    });
    expect(fixture.db.get<{ count: number }>("SELECT count(*) AS count FROM user_feedback")?.count).toBe(1);
    expect(fixture.db.get<{ count: number }>("SELECT count(*) AS count FROM dataset_candidates")?.count).toBe(1);
    expect(fixture.db.get<{ count: number }>("SELECT count(*) AS count FROM diagnosis_results")?.count).toBe(1);
  } finally {
    fixture.close();
  }
});

test("diagnosis failure keeps the atomic captured feedback pair", () => {
  const fixture = auditFixture(() => { throw new Error("diagnosis unavailable"); });
  try {
    const result = fixture.audit.submitDissatisfied({
      campaignId: fixture.campaignId,
      narrationId: fixture.narrationId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("feedback failed");
    expect(result.value.status).toBe("captured");
    expect(fixture.db.get<{ count: number }>("SELECT count(*) AS count FROM user_feedback")?.count).toBe(1);
    expect(fixture.db.get<{ status: string }>("SELECT status FROM dataset_candidates")?.status).toBe("captured");
    expect(fixture.db.get<{ count: number }>("SELECT count(*) AS count FROM diagnosis_results")?.count).toBe(0);
  } finally {
    fixture.close();
  }
});

test("review rejects uncorrected training data and incomplete curated runs", () => {
  const fixture = auditFixture();
  try {
    const submitted = fixture.audit.submitDissatisfied({
      campaignId: fixture.campaignId,
      narrationId: fixture.narrationId,
    });
    if (!submitted.ok) throw new Error("feedback failed");

    for (const datasetUsage of ["sft", "preference"] as const) {
      const rejected = fixture.audit.reviewCandidate({
        campaignId: fixture.campaignId,
        caseId: submitted.value.caseId,
        status: "reviewed",
        confirmedIssueTags: ["UNKNOWN"],
        datasetUsage,
        correctedOutput: "   ",
      });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.error.code).toBe("AUDIT_CORRECTED_OUTPUT_REQUIRED");
    }

    fixture.db.run("UPDATE audit_runs SET completeness = 'partial' WHERE trace_id = ?", [fixture.traceId]);
    const incomplete = fixture.audit.reviewCandidate({
      campaignId: fixture.campaignId,
      caseId: submitted.value.caseId,
      status: "curated",
      confirmedIssueTags: ["UNKNOWN"],
      datasetUsage: "evaluation_only",
    });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) expect(incomplete.error.code).toBe("AUDIT_RUN_INCOMPLETE");
  } finally {
    fixture.close();
  }
});

function auditFixture(diagnose?: ConstructorParameters<typeof AuditService>[2]) {
  const root = mkdtempSync(join(tmpdir(), "audit-service-"));
  const clock = fixedClock(now);
  const paths = resolvePaths(root);
  const settings = openBun(paths.settingsDb);
  const sqlDir = join(import.meta.dir, "../../../sql");
  applyInit(settings, clock, readFileSync(join(sqlDir, "settings.sql"), "utf8"), "0001_init");
  const campaigns = new CampaignService(
    settings,
    paths,
    clock,
    openBun,
    readFileSync(join(sqlDir, "campaign.sql"), "utf8"),
    [
      { id: "0002_memory", sql: readFileSync(join(sqlDir, "campaign-0002-memory.sql"), "utf8") },
      { id: "0003_checkpoint_tests", sql: readFileSync(join(sqlDir, "campaign-0003-checkpoint-tests.sql"), "utf8") },
      { id: "0004_investigator", sql: readFileSync(join(sqlDir, "campaign-0004-investigator.sql"), "utf8") },
      { id: "0005_checkpoint_recaps", sql: readFileSync(join(sqlDir, "campaign-0005-checkpoint-recaps.sql"), "utf8") },
      { id: "0006_checkpoint_dialogue_members", sql: readFileSync(join(sqlDir, "campaign-0006-checkpoint-dialogue-members.sql"), "utf8") },
      { id: "0007_investigator_recreation", sql: readFileSync(join(sqlDir, "campaign-0007-investigator-recreation.sql"), "utf8") },
      { id: "0008_turn_audit", sql: readFileSync(join(sqlDir, "campaign-0008-turn-audit.sql"), "utf8") },
    ],
  );
  const created = campaigns.create("审计服务测试");
  if (!created.ok) throw new Error("campaign create failed");
  const opened = campaigns.ensureOpen(created.value.campaignId);
  if (!opened.ok) throw new Error("campaign not open");
  const db = opened.value;
  const turnId = "turn-audit-service";
  const operationId = "operation-audit-service";
  const narrationId = "narration-audit-service";
  const traceId = "trace-audit-service";
  db.run(
    `INSERT INTO turns (
      turn_id, branch_id, command_id, actor_id, controller_id, input_text, status,
      base_state_version, committed_state_version, operation_id, failure_code, created_at, updated_at
    ) VALUES (?, ?, 'command-audit', 'pc.linwan', 'player', '看看四周', 'completed', 1, 1, ?, NULL, ?, ?)`,
    [turnId, created.value.headBranchId, operationId, now, now],
  );
  db.run(
    `INSERT INTO operations (
      operation_id, operation_type, campaign_id, branch_id, turn_id, status,
      progress_json, result_json, error_code, created_at, updated_at, completed_at
    ) VALUES (?, 'turn.submitAction', ?, ?, ?, 'succeeded', '{}', '{}', NULL, ?, ?, ?)`,
    [operationId, created.value.campaignId, created.value.headBranchId, turnId, now, now, now],
  );
  db.run(
    `INSERT INTO narrations (
      narration_id, branch_id, turn_id, based_on_state_version,
      model_task_id, prompt_version, text, status, created_at
    ) VALUES (?, ?, ?, 1, 'program', 'program-w0', '这里暂时没有新的变化。', 'final', ?)`,
    [narrationId, created.value.headBranchId, turnId, now],
  );
  startAuditRun(db, {
    traceId,
    campaignId: created.value.campaignId,
    branchId: created.value.headBranchId,
    operationId,
    baseStateVersion: 1,
    startedAt: now,
    schemaVersion: "turn-audit-v1",
  });
  bindAuditRun(db, traceId, { turnId, committedStateVersion: 1 });
  appendAuditSpan(db, {
    spanId: "span-final-selection",
    traceId,
    sequence: 1,
    kind: "program",
    stage: "narration.select",
    taskType: "gm.narrate_result",
    attempt: 1,
    causal: true,
    basedOnStateVersion: 1,
    input: {},
    output: { source: "程序", narrationId },
    status: "succeeded",
    createdAt: now,
    completedAt: now,
  });
  linkFinalNarration(db, traceId, narrationId);
  finalizeAuditRun(db, traceId, { completeness: "complete", gapCodes: [], finalizedAt: now });
  const audit = new AuditService(campaigns, clock, diagnose);
  return {
    audit,
    campaigns,
    db,
    campaignId: created.value.campaignId,
    narrationId,
    traceId,
    close() {
      campaigns.dispose();
      settings.close();
      try { rmSync(root, { recursive: true, force: true }); } catch { /* SQLite handle */ }
    },
  };
}
