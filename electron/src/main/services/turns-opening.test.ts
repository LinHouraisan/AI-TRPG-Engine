import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OperationEvent } from "../../shared/api";

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

test("Mist Harbor rejects an unbound formal turn before model, RNG, or persistence", async () => {
  const fixture = await turnFixture();
  const rngModule = await import("@core/engine/rng");
  let rngCalls = 0;
  const rngSpy = spyOn(rngModule, "rngFrom").mockImplementation(() => () => {
    rngCalls += 1;
    return 0.5;
  });
  let modelCalls = 0;
  globalThis.fetch = (async () => {
    modelCalls += 1;
    return new Response(JSON.stringify({ message: { content: '{"verb":"talk","target":"","text":""}' } }), { status: 200 });
  }) as typeof fetch;

  try {
    const created = fixture.campaigns.create("未确认调查员");
    if (!created.ok) throw new Error("campaign create failed");
    fixture.setSetting("keeper.enabled", true);

    const result = await fixture.turns.submit({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      actorId: "pc.linwan" as never,
      controllerId: "player",
      expectedStateVersion: 0 as never,
      commandId: "unbound-turn",
      text: "可以",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVESTIGATOR_REQUIRED");
    expect(modelCalls).toBe(0);
    expect(rngCalls).toBe(0);
    expect(fixture.campaigns.driver(created.value.campaignId)
      ?.get<{ count: number }>("SELECT count(*) AS count FROM turns")?.count).toBe(0);
  } finally {
    rngSpy.mockRestore();
    fixture.close();
  }
});

test("Mist Harbor rejects a binding whose profile is absent from replayed state", async () => {
  const fixture = await turnFixture();
  try {
    const [{ validateAllocation }, { loadPackById }, { bindInvestigator, hashProfile, saveInvestigator }] =
      await Promise.all([
        import("@core/character/creation"),
        import("@core/engine/pack"),
        import("../persist/investigator"),
      ]);
    const created = fixture.campaigns.create("绑定与重放不一致");
    if (!created.ok) throw new Error("campaign create failed");
    const opened = fixture.campaigns.ensureOpen(created.value.campaignId);
    if (!opened.ok) throw new Error("campaign not open");
    const db = opened.value;
    const rules = loadPackById("mist-harbor").manifest.creation;
    if (!rules) throw new Error("creation rules missing");
    const validated = validateAllocation(rules, validAllocation("林晚"));
    if (!validated.ok) throw new Error("allocation invalid");
    const record = saveInvestigator(db, {
      profile: validated.profile,
      profileHash: hashProfile(validated.profile),
      createdAt: fixture.now,
    });
    bindInvestigator(db, created.value.headBranchId, record.profileId);

    const result = await fixture.turns.submit({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      actorId: "pc.linwan" as never,
      controllerId: "player",
      expectedStateVersion: 0 as never,
      commandId: "inconsistent-turn",
      text: "去七号站台",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVESTIGATOR_REPLAY_MISMATCH");
    expect(db.get<{ count: number }>("SELECT count(*) AS count FROM turns")?.count).toBe(0);
  } finally {
    fixture.close();
  }
});

test("rejected streamed secrets never reach desktop narration delta events", async () => {
  const fixture = await turnFixture();
  let modelCalls = 0;
  try {
    const created = fixture.campaigns.create("流式秘密隔离");
    if (!created.ok) throw new Error("campaign create failed");
    const confirmed = fixture.campaigns.confirmInvestigator({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      allocation: validAllocation("林晚"),
    });
    if (!confirmed.ok) throw new Error("investigator confirmation failed");
    fixture.setSetting("keeper.enabled", true);
    fixture.setSetting("keeper.baseUrl", "http://keeper.test");
    const unsafe = JSON.stringify({
      feedback: "你走进站台，潮气贴上衣袖。",
      reaction: "无名女孩抬起头说，我叫许遥。",
      interactionPoints: ["她的手仍按着那张潮湿车票"],
      text: "你走进站台，潮气贴上衣袖。无名女孩抬起头说，我叫许遥。她的手仍按着那张潮湿车票。",
    });
    globalThis.fetch = (async () => {
      modelCalls += 1;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let offset = 0; offset < unsafe.length; offset += 5) {
            const content = unsafe.slice(offset, offset + 5);
            controller.enqueue(encoder.encode(`${JSON.stringify({ message: { content } })}\n`));
          }
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const submitted = await fixture.turns.submit({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      actorId: "pc.linwan" as never,
      controllerId: "player",
      expectedStateVersion: confirmed.value.stateVersion as never,
      commandId: "safe-stream-turn",
      text: "去七号站台",
    });
    if (!submitted.ok) throw new Error(`turn failed: ${submitted.error.code}`);
    const events: OperationEvent[] = [];
    const subscriptionId = fixture.turns.subscribe(
      submitted.value.operationId,
      (event) => events.push(event),
    );
    await fixture.turns.waitForNarration(submitted.value.operationId);
    fixture.turns.unsubscribe(subscriptionId);

    const final = fixture.turns.get(submitted.value.operationId, created.value.campaignId);
    expect(final.ok).toBe(true);
    if (!final.ok) throw new Error("final operation missing");
    expect(modelCalls).toBe(2);
    expect(final.value.narrationKind).toBe("模板");
    expect(final.value.narration).not.toContain("许遥");
    expect(JSON.stringify(events)).not.toContain("许遥");
    expect(events.some((event) => event.type === "narration.delta")).toBe(true);
  } finally {
    fixture.close();
  }
});

function validAllocation(name: string) {
  return {
    name,
    lifeHistoryId: "history.archive-correspondent",
    occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
    interestPoints: { 侦查: 7, 聆听: 35, 图书馆使用: 9, 开锁: 89 },
  };
}

async function turnFixture() {
  const [
    { fixedClock },
    { CredentialStore },
    { resolvePaths },
    { openBun },
    { applyInit },
    { setSetting },
    { CampaignService },
    { TurnService },
  ] = await Promise.all([
    import("../clock"),
    import("../credentials"),
    import("../paths"),
    import("../persist/bun-driver"),
    import("../persist/migrate"),
    import("../persist/catalog"),
    import("./campaigns"),
    import("./turns"),
  ]);
  const root = mkdtempSync(join(tmpdir(), "turn-opening-gate-"));
  const now = "2026-08-24T00:00:00.000Z";
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
    ],
  );
  const credentials = new CredentialStore(join(root, "credentials.json"), clock, {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  });
  const turns = new TurnService(campaigns, credentials, clock);
  return {
    now,
    campaigns,
    turns,
    setSetting(key: string, value: unknown) { setSetting(settings, key, value, now); },
    close() {
      campaigns.dispose();
      settings.close();
      try { rmSync(root, { recursive: true, force: true }); } catch { /* SQLite handle */ }
    },
  };
}
