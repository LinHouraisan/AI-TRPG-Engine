import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("a same-branch commit during candidate publish conflicts before adjudication", async () => {
  const rngModule = await import("@core/engine/rng");
  const originalRngFrom = rngModule.rngFrom;
  let rngCalls = 0;
  const rngSpy = spyOn(rngModule, "rngFrom").mockImplementation((seed) => {
    const next = originalRngFrom(seed);
    return () => {
      rngCalls += 1;
      return next();
    };
  });
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
  const root = mkdtempSync(join(tmpdir(), "turn-candidate-race-"));
  const clock = fixedClock("2026-08-24T00:00:00.000Z");
  const paths = resolvePaths(root);
  const settings = openBun(paths.settingsDb);
  let campaigns: InstanceType<typeof CampaignService> | undefined;
  try {
    const sqlDir = join(import.meta.dir, "../../../sql");
    applyInit(settings, clock, readFileSync(join(sqlDir, "settings.sql"), "utf8"), "0001_init");
    campaigns = new CampaignService(
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
    const created = campaigns.create("候选竞态");
    if (!created.ok) throw new Error("campaign create failed");
    const confirmed = campaigns.confirmInvestigator({
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      allocation: {
        name: "林晚",
        lifeHistoryId: "history.archive-correspondent",
        occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
        interestPoints: { 侦查: 7, 聆听: 35, 图书馆使用: 9, 开锁: 89 },
      },
    });
    if (!confirmed.ok) throw new Error("investigator confirmation failed");
    const credentials = new CredentialStore(join(root, "credentials.json"), clock, {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "",
    });
    const turns = new TurnService(campaigns, credentials, clock);
    const base = {
      campaignId: created.value.campaignId,
      branchId: created.value.headBranchId,
      actorId: "pc.linwan" as const,
      controllerId: "player" as const,
    };
    const arrived = await turns.submit({
      ...base,
      expectedStateVersion: 1,
      commandId: "arrive-platform",
      text: "去七号站台",
    });
    expect(arrived.ok).toBe(true);

    setSetting(settings, "keeper.enabled", true, clock.nowIso());
    setSetting(settings, "keeper.baseUrl", "http://keeper.test", clock.nowIso());
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const routing = body.messages[0]?.content.includes("输入路由");
      const content = routing
        ? JSON.stringify({
            kind: "investigation",
            investigationId: "investigation.conductor-leverage",
            skill: "侦查",
            approach: "寻找能让列车员开口的细节",
          })
        : JSON.stringify({ text: "你完成了这一步，周围仍然安静。" });
      return new Response(JSON.stringify({ message: { content } }), { status: 200 });
    }) as typeof fetch;

    const sequence: string[] = [];
    let competing: ReturnType<typeof turns.submit> | undefined;
    const raced = await turns.submit(
      {
        ...base,
        expectedStateVersion: 2,
        commandId: "stale-investigation",
        text: "查看四周，重点注意是否有可以让列车员回答问题的办法",
      },
      {
        onCandidate: () => {
          sequence.push("candidate");
          competing = turns.submit({
            ...base,
            expectedStateVersion: 2,
            commandId: "concurrent-return",
            text: "去雾港站大厅",
          });
        },
      },
    );
    if (competing) expect((await competing).ok).toBe(true);
    sequence.push(raced.ok ? "resolved" : raced.error.code);

    expect(raced.ok).toBe(false);
    if (!raced.ok) expect(raced.error.code).toBe("TURN_VERSION_CONFLICT");
    expect(sequence).toEqual(["candidate", "TURN_VERSION_CONFLICT"]);
    expect(rngCalls).toBe(0);
    const db = campaigns.driver(created.value.campaignId);
    expect(db?.get<{ count: number }>(
      `SELECT count(*) AS count FROM rule_decisions d
       JOIN turns t ON t.turn_id = d.turn_id
       WHERE t.command_id = 'stale-investigation'`,
    )?.count).toBe(0);

    const returned = await turns.submit({
      ...base,
      expectedStateVersion: 3,
      commandId: "return-platform",
      text: "去七号站台",
    });
    if (!returned.ok) throw new Error("return to platform failed");
    const normalSequence: string[] = [];
    const normal = await turns.submit(
      {
        ...base,
        expectedStateVersion: 4,
        commandId: "normal-investigation",
        text: "查看四周，重点注意是否有可以让列车员回答问题的办法",
      },
      { onCandidate: () => normalSequence.push("candidate") },
    );
    expect(normal.ok).toBe(true);
    if (!normal.ok) throw new Error("normal investigation failed");
    const view = turns.get(normal.value.operationId, created.value.campaignId);
    expect(view.ok && view.value.kind === "committed" && view.value.check !== undefined).toBe(true);
    normalSequence.push("resolved");
    expect(normalSequence).toEqual(["candidate", "resolved"]);
    expect(rngCalls).toBe(1);
  } finally {
    rngSpy.mockRestore();
    campaigns?.dispose();
    settings.close();
    try { rmSync(root, { recursive: true, force: true }); } catch { /* SQLite may retain a Windows handle. */ }
  }
});
