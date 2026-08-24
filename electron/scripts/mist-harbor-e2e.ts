import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPackById } from "../../demo/src/engine/pack";
import { fixedClock } from "../main/clock";
import { CredentialStore } from "../main/credentials";
import { resolvePaths } from "../main/paths";
import { createCheckpoint, restoreCheckpointCopy } from "../main/persist/checkpoints";
import { openBun } from "../main/persist/bun-driver";
import { applyInit, applyMigration } from "../main/persist/migrate";
import { CampaignService } from "../main/services/campaigns";
import { TurnService } from "../main/services/turns";

function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
  console.log(`✓ ${label}`);
}

const scratch = mkdtempSync(join(tmpdir(), "mist-harbor-e2e-"));
const clock = fixedClock("2026-08-23T00:00:00.000Z");
const sqlDir = join(import.meta.dir, "../sql");
const settings = openBun(resolvePaths(scratch).settingsDb);
let campaigns: CampaignService | undefined;

try {
  applyInit(settings, clock, readFileSync(join(sqlDir, "settings.sql"), "utf8"), "0001_init");
  campaigns = new CampaignService(
    settings,
    resolvePaths(scratch),
    clock,
    openBun,
    readFileSync(join(sqlDir, "campaign.sql"), "utf8"),
    [
      { id: "0002_memory", sql: readFileSync(join(sqlDir, "campaign-0002-memory.sql"), "utf8") },
      { id: "0003_checkpoint_tests", sql: readFileSync(join(sqlDir, "campaign-0003-checkpoint-tests.sql"), "utf8") },
      { id: "0004_investigator", sql: readFileSync(join(sqlDir, "campaign-0004-investigator.sql"), "utf8") },
      { id: "0005_checkpoint_recaps", sql: readFileSync(join(sqlDir, "campaign-0005-checkpoint-recaps.sql"), "utf8") },
      { id: "0006_checkpoint_dialogue_members", sql: readFileSync(join(sqlDir, "campaign-0006-checkpoint-dialogue-members.sql"), "utf8") },
    ],
  );
  const created = campaigns.create("雾港 E2E");
  assert(created.ok, "全新战役可创建");
  const campaignId = created.value.campaignId;
  const mainBranch = created.value.headBranchId;
  const opened = campaigns.ensureOpen(campaignId);
  assert(opened.ok, "战役可打开");
  const checkpoint = createCheckpoint(opened.value, {
    branchId: mainBranch,
    label: "结局前",
    purpose: "切换另一结局",
    steps: ["恢复副本", "选择另一结局"],
    expected: { sourceUnchanged: true },
    actual: { sourceUnchanged: true },
    passed: true,
    now: clock.nowIso(),
  });
  const restored = restoreCheckpointCopy(opened.value, checkpoint.checkpointId, "另一结局", clock.nowIso());
  const credentials = new CredentialStore(join(scratch, "credentials.json"), clock, {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  });
  const turns = new TurnService(campaigns, credentials, clock);
  const mainTurn = await turns.submit({
    campaignId,
    branchId: mainBranch,
    actorId: "pc.linwan",
    controllerId: "player",
    expectedStateVersion: 0,
    commandId: "main-first-turn",
    text: "去书房",
  });
  assert(mainTurn.ok, "来源分支可提交第一回合");
  assert(
    opened.value.get<{ turn_id: string }>("SELECT turn_id FROM turns WHERE branch_id = ?", [mainBranch])?.turn_id === `${mainBranch}:turn-1`,
    "桌面回合 ID 包含所属分支",
  );
  campaigns.setBranchHead(campaignId, restored.branchId, restored.stateVersion);
  const restoredTurn = await turns.submit({
    campaignId,
    branchId: restored.branchId,
    actorId: "pc.linwan",
    controllerId: "player",
    expectedStateVersion: 0,
    commandId: "restored-first-turn",
    text: "去书房",
  });
  assert(restoredTurn.ok, "v0 恢复分支可提交建议行动的第一回合");
  assert(opened.value.get<{ head_state_version: number }>("SELECT head_state_version FROM branches WHERE branch_id = ?", [mainBranch])?.head_state_version === 1, "恢复分支行动不会改写来源分支");
  campaigns.close(campaignId);
  const reopened = campaigns.open(campaignId);
  assert(reopened.ok && reopened.value.headBranchId === restored.branchId, "恢复副本后关闭重开仍进入新分支");

  const fresh = campaigns.create("重开后的新局");
  assert(fresh.ok && fresh.value.headStateVersion === 0, "重开会创建版本为零的新战役");
  campaigns.moveToTrash(campaignId);
  const listed = campaigns.list({ limit: 20 });
  assert(
    listed.ok && listed.value.items.length === 1 && listed.value.items[0]?.campaignId === fresh.value.campaignId,
    "旧战役删除后不会再次自动续上",
  );

  const pack = loadPackById("mist-harbor");
  const endings = pack.story.filter((node) => node.id.startsWith("node.ending_"));
  assert(endings.length === 4, "三条公开结局与一条隐藏路线均可验收");
  assert(endings.every((node) => node.doneWhen), "每个结局都有结构化达成条件");
  console.log("雾港末班车桌面 E2E 通过。");
} finally {
  campaigns?.dispose();
  settings.close();
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* 失败用例可能仍有异步叙述持有 WAL。 */ }
}
