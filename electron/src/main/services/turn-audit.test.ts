import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock } from "../clock";
import { CredentialStore } from "../credentials";
import { loadAuditCase } from "../persist/audit";
import { openBun } from "../persist/bun-driver";
import type { Driver } from "../persist/driver";
import { setSetting } from "../persist/catalog";
import { applyInit } from "../persist/migrate";
import { resolvePaths } from "../paths";
import { parseAuditCaseLine } from "@core/audit/export";

const now = "2026-09-17T10:00:00.000Z";
const originalFetch = globalThis.fetch;
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => "mist-harbor" },
});

afterEach(() => { globalThis.fetch = originalFetch; });
afterAll(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("a program reply persists one complete causal audit run", async () => {
  const fixture = await turnFixture();
  try {
    const created = fixture.campaigns.create("程序回复审计");
    if (!created.ok) throw new Error("campaign create failed");
    const confirmed = fixture.campaigns.confirmInvestigator({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      allocation: validAllocation(),
    });
    if (!confirmed.ok) throw new Error("investigator confirmation failed");

    const submitted = await fixture.turns.submit({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      actorId: "pc.linwan" as never,
      controllerId: "player",
      expectedStateVersion: confirmed.value.stateVersion as never,
      commandId: "audit-program-turn",
      text: "现在几点",
    });
    if (!submitted.ok) throw new Error(`turn failed: ${submitted.error.code}`);
    await fixture.turns.waitForNarration(submitted.value.operationId);

    const db = fixture.campaigns.driver(created.value.campaignId);
    if (!db) throw new Error("campaign not open");
    const audit = loadAuditCase(db, submitted.value.traceId);
    expect(audit.run).toMatchObject({
      traceId: submitted.value.traceId,
      turnId: submitted.value.turnId,
      operationId: submitted.value.operationId,
      baseStateVersion: 1,
      committedStateVersion: 1,
      completeness: "complete",
    });
    expect(audit.run.finalNarrationId).toBeString();
    expect(audit.spans.map((span) => span.stage)).toEqual([
      "turn.received",
      "route.deterministic",
      "rule.resolve",
      "state.commit",
      "narration.select",
    ]);
    expect(audit.spans.every((span) => span.causal)).toBe(true);

    const final = fixture.turns.get(submitted.value.operationId, created.value.campaignId);
    expect(final.ok).toBe(true);
    if (!final.ok) throw new Error("final operation missing");
    expect(final.value).toMatchObject({
      traceId: submitted.value.traceId,
      turnId: submitted.value.turnId,
      narrationId: audit.run.finalNarrationId,
    });
    const { loadBranchHistory } = await import("../persist/turns");
    expect(loadBranchHistory(db, created.value.headBranchId).recentTurns[0]).toMatchObject({
      turnId: submitted.value.turnId,
      narrationId: audit.run.finalNarrationId,
    });
  } finally {
    fixture.close();
  }
});

test("free text keeps route and narration calls in one model task", async () => {
  const fixture = await turnFixture();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const content = calls === 1
      ? '{"verb":"free","target":"","text":""}'
      : JSON.stringify({
          feedback: "你把手伸向窗帘边缘，粗糙布料在指间绷紧。",
          reaction: "窗框轻轻震了一下，积灰从木缝间落下。",
          interactionPoints: ["褪色布面上的针脚仍清晰可辨。"],
          text: "你把手伸向窗帘边缘，粗糙布料在指间绷紧。窗框轻轻震了一下，积灰从木缝间落下。褪色布面上的针脚仍清晰可辨。",
        });
    return new Response(JSON.stringify({ message: { content } }), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    const created = fixture.campaigns.create("自由回合审计");
    if (!created.ok) throw new Error("campaign create failed");
    const confirmed = fixture.campaigns.confirmInvestigator({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      allocation: validAllocation(),
    });
    if (!confirmed.ok) throw new Error("investigator confirmation failed");
    fixture.setSetting("keeper.enabled", true);
    fixture.setSetting("keeper.baseUrl", "http://keeper.test");

    const submitted = await fixture.turns.submit({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      actorId: "pc.linwan" as never,
      controllerId: "player",
      expectedStateVersion: confirmed.value.stateVersion as never,
      commandId: "audit-free-turn",
      text: "我拆下窗帘布，试着做一个临时绳索",
    });
    if (!submitted.ok) throw new Error(`turn failed: ${submitted.error.code}`);
    await fixture.turns.waitForNarration(submitted.value.operationId);

    const db = fixture.campaigns.driver(created.value.campaignId);
    if (!db) throw new Error("campaign not open");
    const audit = loadAuditCase(db, submitted.value.traceId);
    const routeSpans = audit.spans.filter((span) => span.stage === "gm.route");
    const narrationSpans = audit.spans.filter((span) => span.stage === "gm.narrate");
    expect(routeSpans.length).toBeGreaterThan(0);
    expect(narrationSpans.length).toBeGreaterThan(0);
    expect(new Set([...routeSpans, ...narrationSpans].map((span) => span.modelTaskId)).size).toBe(1);
    expect(routeSpans[0]?.modelTaskId).toBeString();
    expect(audit.run).toMatchObject({
      traceId: submitted.value.traceId,
      turnId: submitted.value.turnId,
      completeness: "complete",
    });
    expect(audit.run.finalNarrationId).toBeString();
    expect(audit.spans.find((span) => span.stage === "state.commit")?.output).toMatchObject({
      beforeVersion: confirmed.value.stateVersion,
      afterVersion: confirmed.value.stateVersion,
    });
  } finally {
    fixture.close();
  }
});

test("a deterministic action records commit, context, model, and final selection", async () => {
  const fixture = await turnFixture();
  globalThis.fetch = (async () => new Response(JSON.stringify({
    message: { content: JSON.stringify({
      feedback: "你踏上七号站台，鞋底碾过潮湿的水泥地。",
      reaction: "远处的灯管闪烁两次，空站里只留下细微电流声。",
      interactionPoints: ["站牌下方的旧时刻表仍贴在原处。"],
      text: "你踏上七号站台，鞋底碾过潮湿的水泥地。远处的灯管闪烁两次，空站里只留下细微电流声。站牌下方的旧时刻表仍贴在原处。",
    }) },
  }), { status: 200 })) as unknown as typeof fetch;

  try {
    const created = fixture.campaigns.create("确定性回合审计");
    if (!created.ok) throw new Error("campaign create failed");
    const confirmed = fixture.campaigns.confirmInvestigator({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      allocation: validAllocation(),
    });
    if (!confirmed.ok) throw new Error("investigator confirmation failed");
    fixture.setSetting("keeper.enabled", true);
    fixture.setSetting("keeper.baseUrl", "http://keeper.test");

    const submitted = await fixture.turns.submit({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      actorId: "pc.linwan" as never,
      controllerId: "player",
      expectedStateVersion: confirmed.value.stateVersion as never,
      commandId: "audit-deterministic-turn",
      text: "去七号站台",
    });
    if (!submitted.ok) throw new Error(`turn failed: ${submitted.error.code}`);
    await fixture.turns.waitForNarration(submitted.value.operationId);

    const db = fixture.campaigns.driver(created.value.campaignId);
    if (!db) throw new Error("campaign not open");
    const audit = loadAuditCase(db, submitted.value.traceId);
    const causal = audit.spans.filter((span) => span.causal);
    expect(causal.map((span) => span.sequence)).toEqual(
      [...causal.map((span) => span.sequence)].sort((a, b) => a - b),
    );
    expect(audit.spans.map((span) => span.stage)).toEqual(expect.arrayContaining([
      "turn.received",
      "route.deterministic",
      "rule.resolve",
      "state.commit",
      "context.build",
      "gm.narrate",
      "narration.select",
    ]));
    expect(audit.spans.find((span) => span.stage === "state.commit")?.output).toMatchObject({
      beforeVersion: confirmed.value.stateVersion,
      afterVersion: confirmed.value.stateVersion + 1,
    });
  } finally {
    fixture.close();
  }
});

test("a disliked guarded retry becomes a curated preference export", async () => {
  const fixture = await turnFixture();
  let calls = 0;
  const selectedText = "你把手伸向窗帘边缘，粗糙布料在指间绷紧。窗框随即轻轻震了一下，积灰从木缝间落下。褪色布面上的针脚仍清晰可辨。";
  globalThis.fetch = (async () => {
    calls += 1;
    const content = calls === 1
      ? '{"verb":"free","target":"","text":""}'
      : calls === 2
        ? JSON.stringify({
            text: "她看着你。",
            feedback: "",
            reaction: "她没有回答。",
            interactionPoints: ["你可以继续追问。"],
          })
        : JSON.stringify({
            text: selectedText,
            feedback: "你把手伸向窗帘边缘，粗糙布料在指间绷紧。",
            reaction: "窗框随即轻轻震了一下，积灰从木缝间落下。",
            interactionPoints: ["褪色布面上的针脚仍清晰可辨。"],
          });
    return new Response(JSON.stringify({ message: { content } }), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    const created = fixture.campaigns.create("端到端坏例审计");
    if (!created.ok) throw new Error("campaign create failed");
    const confirmed = fixture.campaigns.confirmInvestigator({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      allocation: validAllocation(),
    });
    if (!confirmed.ok) throw new Error("investigator confirmation failed");
    fixture.setSetting("keeper.enabled", true);
    fixture.setSetting("keeper.baseUrl", "http://keeper.test");

    const submitted = await fixture.turns.submit({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      actorId: "pc.linwan" as never,
      controllerId: "player",
      expectedStateVersion: confirmed.value.stateVersion as never,
      commandId: "audit-e2e-preference",
      text: "我拆下窗帘布，试着做一个临时绳索",
    });
    if (!submitted.ok) throw new Error("turn failed");
    await fixture.turns.waitForNarration(submitted.value.operationId);
    const final = fixture.turns.get(submitted.value.operationId, created.value.campaignId);
    if (!final.ok || !final.value.narrationId) throw new Error("final narration missing");
    expect(final.value.narration).toBe(selectedText);

    const db = fixture.campaigns.driver(created.value.campaignId);
    if (!db) throw new Error("campaign not open");
    const audit = loadAuditCase(db, submitted.value.traceId);
    const modelSpans = audit.spans.filter((span) => span.stage === "gm.route" || span.stage === "gm.narrate");
    expect(new Set(modelSpans.map((span) => span.modelTaskId)).size).toBe(1);
    expect(audit.spans.filter((span) => span.stage === "guard.quality").map((span) => span.status))
      .toEqual(["rejected", "succeeded"]);
    expect(audit.run).toMatchObject({
      traceId: submitted.value.traceId,
      turnId: submitted.value.turnId,
      finalNarrationId: final.value.narrationId,
    });

    const disliked = fixture.audits.submitDissatisfied({
      campaignId: created.value.campaignId,
      narrationId: final.value.narrationId,
      note: "第二次回复仍不符合我想要的节奏",
    });
    if (!disliked.ok) throw new Error("feedback failed");
    const corrected = "你松开窗帘，先检查布料承重与固定点，再决定是否拆下。";
    const reviewed = fixture.audits.reviewCandidate({
      campaignId: created.value.campaignId,
      caseId: disliked.value.caseId,
      status: "curated",
      confirmedIssueTags: ["GUARD_REJECTION"],
      datasetUsage: "preference",
      correctedOutput: corrected,
    });
    if (!reviewed.ok) throw new Error("review failed");
    const exported = fixture.audits.exportCandidates({
      campaignId: created.value.campaignId,
      caseIds: [disliked.value.caseId],
    });
    if (!exported.ok) throw new Error("export failed");
    const line = parseAuditCaseLine(exported.value.jsonl.trimEnd());
    expect(line).toMatchObject({
      case_id: disliked.value.caseId,
      trace_id: submitted.value.traceId,
      final_output: selectedText,
      manual_review: {
        corrected_output: corrected,
        dataset_usage: "preference",
      },
    });
  } finally {
    fixture.close();
  }
});

test("one audit span write failure leaves gameplay complete and marks the run partial", async () => {
  const fixture = await turnFixture(true);
  try {
    const created = fixture.campaigns.create("审计失败隔离");
    if (!created.ok) throw new Error("campaign create failed");
    const confirmed = fixture.campaigns.confirmInvestigator({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      allocation: validAllocation(),
    });
    if (!confirmed.ok) throw new Error("investigator confirmation failed");
    const submitted = await fixture.turns.submit({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      actorId: "pc.linwan" as never,
      controllerId: "player",
      expectedStateVersion: confirmed.value.stateVersion as never,
      commandId: "audit-gap-turn",
      text: "现在几点",
    });
    if (!submitted.ok) throw new Error("turn failed");
    await fixture.turns.waitForNarration(submitted.value.operationId);
    expect(fixture.turns.get(submitted.value.operationId, created.value.campaignId).ok).toBe(true);
    const db = fixture.campaigns.driver(created.value.campaignId);
    if (!db) throw new Error("campaign not open");
    expect(loadAuditCase(db, submitted.value.traceId).run).toMatchObject({
      completeness: "partial",
      gapCodes: ["AUDIT_SPAN_APPEND_FAILED"],
    });
  } finally {
    fixture.close();
  }
});

function validAllocation() {
  return {
    name: "林晚",
    lifeHistoryId: "history.archive-correspondent",
    occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
    interestPoints: { 侦查: 7, 聆听: 35, 图书馆使用: 9, 开锁: 89 },
  };
}

async function turnFixture(failOneAuditSpan = false) {
  const [{ CampaignService }, { TurnService }, { AuditService }] = await Promise.all([
    import("./campaigns"),
    import("./turns"),
    import("./audit-service"),
  ]);
  const root = mkdtempSync(join(tmpdir(), "turn-audit-"));
  const clock = fixedClock(now);
  const paths = resolvePaths(root);
  const settings = openBun(paths.settingsDb);
  const sqlDir = join(import.meta.dir, "../../../sql");
  applyInit(settings, clock, readFileSync(join(sqlDir, "settings.sql"), "utf8"), "0001_init");
  const migrations = [
    ["0002_memory", "campaign-0002-memory.sql"],
    ["0003_checkpoint_tests", "campaign-0003-checkpoint-tests.sql"],
    ["0004_investigator", "campaign-0004-investigator.sql"],
    ["0005_checkpoint_recaps", "campaign-0005-checkpoint-recaps.sql"],
    ["0006_checkpoint_dialogue_members", "campaign-0006-checkpoint-dialogue-members.sql"],
    ["0007_investigator_recreation", "campaign-0007-investigator-recreation.sql"],
    ["0008_turn_audit", "campaign-0008-turn-audit.sql"],
  ].map(([id, file]) => ({ id, sql: readFileSync(join(sqlDir, file), "utf8") }));
  const campaigns = new CampaignService(
    settings,
    paths,
    clock,
    failOneAuditSpan ? openWithOneAuditSpanFailure : openBun,
    readFileSync(join(sqlDir, "campaign.sql"), "utf8"),
    migrations,
  );
  const credentials = new CredentialStore(join(root, "credentials.json"), clock, {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  });
  const turns = new TurnService(campaigns, credentials, clock);
  const audits = new AuditService(campaigns, clock);
  return {
    campaigns,
    turns,
    audits,
    setSetting(key: string, value: unknown) { setSetting(settings, key, value, now); },
    close() {
      campaigns.dispose();
      settings.close();
      try { rmSync(root, { recursive: true, force: true }); } catch { /* SQLite handle */ }
    },
  };
}

function openWithOneAuditSpanFailure(path: string): Driver {
  const db = openBun(path);
  let pending = true;
  return {
    ...db,
    run(sql, params) {
      if (pending && sql.includes("INSERT INTO audit_spans")) {
        pending = false;
        throw new Error("simulated audit write failure");
      }
      db.run(sql, params);
    },
  };
}
