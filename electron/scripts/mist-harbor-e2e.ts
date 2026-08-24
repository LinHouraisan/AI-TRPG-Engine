import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
  console.log(`✓ ${label}`);
}

const originalFetch = globalThis.fetch;
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => "mist-harbor" },
});

const [
  { loadPackById }, { fixedClock }, { CredentialStore }, { resolvePaths },
  { createCheckpoint, restoreCheckpointCopy }, { hashProfile, loadInvestigator },
  { loadGameEvents }, { openBun }, { applyInit }, { setSetting },
  { CampaignService }, { TurnService },
] = await Promise.all([
  import("../../demo/src/engine/pack"), import("../main/clock"),
  import("../main/credentials"), import("../main/paths"),
  import("../main/persist/checkpoints"), import("../main/persist/investigator"),
  import("../main/persist/turns"), import("../main/persist/bun-driver"),
  import("../main/persist/migrate"), import("../main/persist/catalog"),
  import("../main/services/campaigns"), import("../main/services/turns"),
]);

const scratch = mkdtempSync(join(tmpdir(), "mist-harbor-e2e-"));
const clock = fixedClock("2026-08-24T00:00:00.000Z");
const sqlDir = join(import.meta.dir, "../sql");
const settings = openBun(resolvePaths(scratch).settingsDb);
let campaigns: InstanceType<typeof CampaignService> | undefined;

try {
  applyInit(settings, clock, readFileSync(join(sqlDir, "settings.sql"), "utf8"), "0001_init");
  campaigns = new CampaignService(
    settings, resolvePaths(scratch), clock, openBun,
    readFileSync(join(sqlDir, "campaign.sql"), "utf8"),
    [
      { id: "0002_memory", sql: readFileSync(join(sqlDir, "campaign-0002-memory.sql"), "utf8") },
      { id: "0003_checkpoint_tests", sql: readFileSync(join(sqlDir, "campaign-0003-checkpoint-tests.sql"), "utf8") },
      { id: "0004_investigator", sql: readFileSync(join(sqlDir, "campaign-0004-investigator.sql"), "utf8") },
      { id: "0005_checkpoint_recaps", sql: readFileSync(join(sqlDir, "campaign-0005-checkpoint-recaps.sql"), "utf8") },
      { id: "0006_checkpoint_dialogue_members", sql: readFileSync(join(sqlDir, "campaign-0006-checkpoint-dialogue-members.sql"), "utf8") },
    ],
  );

  const created = campaigns.create("雾港三图集成验收");
  assert(created.ok, "全新雾港战役可创建");
  const campaignId = created.value.campaignId;
  const mainBranch = created.value.headBranchId;
  const allocation = {
    name: "林晚",
    lifeHistoryId: "history.tide-photographer",
    occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
    interestPoints: { 侦查: 7, 聆听: 35, 图书馆使用: 9, 开锁: 89 },
  };
  assert(
    Object.values(allocation.occupationPoints).reduce((sum, value) => sum + value, 0) === 280 &&
      Object.values(allocation.interestPoints).reduce((sum, value) => sum + value, 0) === 140,
    "职业点 280 与兴趣点 140 恰好全部分配",
  );
  const confirmed = campaigns.confirmInvestigator({ campaignId, branchId: mainBranch, allocation });
  assert(
    confirmed.ok && confirmed.value.profile.lifeHistoryId === "history.tide-photographer" &&
      confirmed.value.profile.skills.侦查 === 87,
    "选择潮汐合影摄影师经历并确认完整调查员",
  );
  if (!confirmed.ok) throw new Error("investigator confirmation failed");
  const confirmedProfileHash = hashProfile(confirmed.value.profile);

  campaigns.close(campaignId);
  const reopened = campaigns.open(campaignId);
  assert(
    reopened.ok && reopened.value.headBranchId === mainBranch && reopened.value.headStateVersion === 1,
    "确认调查员后关闭重开仍进入原分支",
  );

  setSetting(settings, "keeper.enabled", true, clock.nowIso());
  setSetting(settings, "keeper.baseUrl", "http://keeper.test", clock.nowIso());
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((message) => message.role === "system")?.content ?? "";
    const user = body.messages.find((message) => message.role === "user")?.content ?? "";
    let content: string;
    if (system.includes("输入路由")) {
      const spoken = user.match(/【玩家说】([^\n]*)$/)?.[1] ?? "";
      content = spoken === "查看四周，重点注意是否有可以让列车员回答问题的办法"
        ? JSON.stringify({
            kind: "investigation",
            investigationId: "investigation.conductor-leverage",
            skill: "侦查",
            approach: "寻找能让列车员开口的细节",
          })
        : JSON.stringify({ verb: "talk", target: "", text: "" });
    } else if (user.includes("【玩家这一步】询问女孩")) {
      content = JSON.stringify({
        feedback: "你把问题递到女孩面前",
        reaction: "女孩抬起眼睛",
        interactionPoints: ["她的指尖仍停在潮湿的车票边缘"],
        text: "你把问题递到女孩面前。女孩抬起眼睛，问：“你能替我记住一个名字吗？”她的指尖仍停在潮湿的车票边缘。",
      });
    } else if (user.includes("【玩家这一步】可以")) {
      content = JSON.stringify({
        feedback: "你的答应让她放松下来",
        reaction: "女孩轻轻点头",
        interactionPoints: ["她把潮湿车票翻到没有字的一面"],
        text: "你的答应让她放松下来。女孩轻轻点头，却没有说出不该提前公开的答案；她把潮湿车票翻到没有字的一面，安静等着你把问题说得更具体。",
      });
    } else {
      content = JSON.stringify({
        feedback: "你的行动在现场留下了清楚结果",
        reaction: "周围的人和环境随之回应",
        interactionPoints: ["眼前仍留着可以继续观察的细节"],
        text: "你的行动在现场留下了清楚结果。周围的人和环境随之回应，眼前仍留着可以继续观察的细节。",
      });
    }
    return new Response(JSON.stringify({ message: { content } }), { status: 200 });
  }) as typeof fetch;

  const credentials = new CredentialStore(join(scratch, "credentials.json"), clock, {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  });
  const turns = new TurnService(campaigns, credentials, clock);
  let version = 1;
  let command = 0;
  async function say(
    text: string,
    onCandidate?: Parameters<InstanceType<typeof TurnService>["submit"]>[1]["onCandidate"],
  ) {
    command += 1;
    const submitted = await turns.submit(
      {
        campaignId, branchId: mainBranch, actorId: "pc.linwan", controllerId: "player",
        expectedStateVersion: version, commandId: `mist-e2e-${command}`, text,
      },
      { onCandidate },
    );
    assert(submitted.ok, `提交回合：${text}`);
    await turns.waitForNarration(submitted.value.operationId);
    const final = turns.get(submitted.value.operationId, campaignId);
    assert(final.ok, `取得定稿：${text}`);
    version = final.value.stateVersion;
    return final.value;
  }

  await say("去七号站台");
  let figureOneCandidate: unknown;
  const figureOne = await say(
    "查看四周，重点注意是否有可以让列车员回答问题的办法",
    (candidate) => { figureOneCandidate = candidate; },
  );
  assert(
    JSON.stringify(figureOneCandidate) === JSON.stringify({
      commandId: "mist-e2e-2",
      intent: {
        kind: "investigation", investigationId: "investigation.conductor-leverage",
        skill: "侦查", approach: "寻找能让列车员开口的细节", stateVersion: 2,
      },
      check: {
        title: "寻找让列车员开口的破绽", skill: "侦查", skillValue: 87,
        difficulty: "regular", threshold: 87,
      },
    }) && figureOne.kind === "committed" && figureOne.check?.skill === "侦查" &&
      figureOne.check.skillValue === 87 && figureOne.check.threshold === 87 &&
      campaigns.driver(campaignId)?.get<{ count: number }>(
        `SELECT count(*) AS count FROM rule_decisions d
         JOIN turns t ON t.turn_id = d.turn_id
         WHERE t.command_id = 'mist-e2e-2'`,
      )?.count === 1,
    "Figure 1 精确匹配侦查 87／普通 87 并提交可追溯检定",
  );

  await say("去三号车厢");
  const girlQuestion = await say("询问女孩，她愿意让我记住哪个名字");
  assert(girlQuestion.narration.includes("你能替我记住一个名字吗？"), "Figure 2 女孩提出原问题");
  const girlAnswer = await say("可以");
  assert(
    girlAnswer.intent.kind === "talk" && !girlAnswer.narration.includes("许遥") &&
      !girlAnswer.narration.includes("四十八名乘客") && !girlAnswer.narration.includes("记忆为燃料"),
    "Figure 2 的“可以”承接最近对话且不泄露隐藏事实",
  );

  const db = campaigns.driver(campaignId);
  assert(db, "重开后的战役数据库仍可读取");
  const checkpoint = createCheckpoint(db, {
    branchId: mainBranch,
    label: "Figure 3 三轮对话",
    purpose: "验证恢复视图只包含检查点内最近三轮",
    steps: ["完成 Figure 1", "完成女孩问答", "复制并恢复"],
    expected: { recentTurns: 3, sourceUnchanged: true },
    actual: { recentTurns: 3, sourceUnchanged: true },
    passed: true,
    now: clock.nowIso(),
  });
  assert(
    db.get<{ count: number }>(
      "SELECT count(*) AS count FROM checkpoint_dialogue_members WHERE checkpoint_id = ?",
      [checkpoint.checkpointId],
    )!.count >= 3,
    "检查点创建时已有至少三轮完整玩家／GM 对话",
  );
  const sourceEventCount = loadGameEvents(db, mainBranch).length;
  const sourceProfile = loadInvestigator(db, mainBranch);

  const laterTurn = await say("去七号站台");
  assert(laterTurn.stateVersion > checkpoint.stateVersion, "检查点后继续推进来源分支");
  const sourceHeadAfterAdvance = db.get<{ head_state_version: number }>(
    "SELECT head_state_version FROM branches WHERE branch_id = ?", [mainBranch],
  )!.head_state_version;

  const restored = restoreCheckpointCopy(db, checkpoint.checkpointId, "Figure 3 恢复副本", clock.nowIso());
  campaigns.setBranchHead(campaignId, restored.branchId, restored.stateVersion);
  const restoredTimeline = turns.timeline(campaignId, restored.branchId, 100);
  assert(restoredTimeline.ok, "恢复副本时间线可读取");
  const recentInputs = restoredTimeline.value.recentTurns.map((turn) => turn.player);
  assert(
    restoredTimeline.value.restoredFrom === "Figure 3 三轮对话" && recentInputs.length === 3 &&
      recentInputs.includes("询问女孩，她愿意让我记住哪个名字") && recentInputs.includes("可以") &&
      recentInputs.filter((input) => input === "去七号站台").length === 0,
    "Figure 3 恰好保留检查点内最近三轮并排除后续回合",
  );
  assert(
    restoredTimeline.value.recap === checkpoint.recap && checkpoint.recap.includes("林晚") &&
      checkpoint.recap.includes("站员合影"),
    "Figure 3 保留调查员前情提要",
  );
  const restoredProfile = loadInvestigator(db, restored.branchId);
  assert(
    restoredProfile?.profileHash === confirmedProfileHash && restoredProfile.profileJson === sourceProfile?.profileJson,
    "恢复副本保留同一调查员档案和哈希",
  );
  assert(
    loadGameEvents(db, mainBranch).length === sourceEventCount + laterTurn.events.length &&
      db.get<{ head_state_version: number }>(
        "SELECT head_state_version FROM branches WHERE branch_id = ?", [mainBranch],
      )?.head_state_version === sourceHeadAfterAdvance,
    "复制恢复不改写来源分支",
  );

  campaigns.close(campaignId);
  const restoredReopened = campaigns.open(campaignId);
  assert(
    restoredReopened.ok && restoredReopened.value.headBranchId === restored.branchId,
    "Figure 3 恢复副本关闭重开后仍为当前分支",
  );

  const pack = loadPackById("mist-harbor");
  const endings = pack.story.filter((node) => node.id.startsWith("node.ending_"));
  assert(endings.length === 4, "三条公开结局与一条隐藏路线均可验收");
  assert(endings.every((node) => node.doneWhen), "每个结局都有结构化达成条件");
  console.log("雾港末班车调查员驱动桌面 E2E 通过。");
} finally {
  globalThis.fetch = originalFetch;
  if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
  campaigns?.dispose();
  settings.close();
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* 失败用例可能仍有异步叙述持有 WAL。 */ }
}
