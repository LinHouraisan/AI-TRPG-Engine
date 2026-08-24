import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock } from "../main/clock";
import { CredentialStore, type SafeStorage } from "../main/credentials";
import { resolvePaths } from "../main/paths";
import { openBun } from "../main/persist/bun-driver";
import { checksum } from "../main/persist/migrate";
import { CampaignService } from "../main/services/campaigns";
import { TurnService } from "../main/services/turns";
import { applyInit } from "../main/persist/migrate";
import { setSetting, getSetting } from "../main/persist/catalog";
import { ensureDefaultProvider, listProviders, listTaskRoutes } from "../main/persist/providers";
import { asBranchId, asStateVersion, type EntityId } from "../shared/ids";
import { loadGameEvents } from "../main/persist/turns";
import { hashProfile, loadInvestigator } from "../main/persist/investigator";
import { restoreCheckpointCopy } from "../main/persist/checkpoints";
import { replay } from "../../demo/src/engine/runtime";
import { initialState } from "../../demo/src/engine/state";

function xorSafeStorage(available: boolean): SafeStorage {
  const mask = 0xa5;
  return {
    isEncryptionAvailable: () => available,
    encryptString(plain) {
      const bytes = Buffer.from(plain, "utf8");
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = (bytes[i] ?? 0) ^ mask;
      }
      return bytes;
    },
    decryptString(cipher) {
      const bytes = Buffer.from(cipher);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = (bytes[i] ?? 0) ^ mask;
      }
      return bytes.toString("utf8");
    },
  };
}

const actor = "pc.linwan" as EntityId;

const root = mkdtempSync(join(tmpdir(), "ai-trpg-electron-"));
const clock = fixedClock("2026-08-19T00:00:00.000Z");
const paths = resolvePaths(root);
const settingsSql = readFileSync(join(import.meta.dir, "../sql/settings.sql"), "utf8");
const campaignSql = readFileSync(join(import.meta.dir, "../sql/campaign.sql"), "utf8");
const memorySql = readFileSync(join(import.meta.dir, "../sql/campaign-0002-memory.sql"), "utf8");
const checkpointSql = readFileSync(
  join(import.meta.dir, "../sql/campaign-0003-checkpoint-tests.sql"),
  "utf8",
);
const investigatorSql = readFileSync(
  join(import.meta.dir, "../sql/campaign-0004-investigator.sql"),
  "utf8",
);
const checkpointRecapSql = readFileSync(
  join(import.meta.dir, "../sql/campaign-0005-checkpoint-recaps.sql"),
  "utf8",
);

let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`✓ ${label}`);
  else {
    failed += 1;
    console.log(`✗ ${label}`);
  }
}

try {
  const settings = openBun(paths.settingsDb);
  applyInit(settings, clock, settingsSql, "0001_init");
  const migrated = settings.get<{ checksum: string }>(
    "SELECT checksum FROM schema_migrations WHERE migration_id = ?",
    ["0001_init"],
  );
  assert(migrated?.checksum === checksum(settingsSql), "settings 迁移写入校验和");

  applyInit(settings, clock, settingsSql, "0001_init");
  assert(true, "重复 applyInit 幂等");

  let mismatch = false;
  try {
    applyInit(settings, clock, `${settingsSql}\n-- tamper`, "0001_init");
  } catch (error) {
    mismatch = error instanceof Error && error.message === "DB_MIGRATION_CHECKSUM_MISMATCH";
  }
  assert(mismatch, "改过的 SQL 触发 DB_MIGRATION_CHECKSUM_MISMATCH");

  const campaigns = new CampaignService(settings, paths, clock, openBun, campaignSql, [
    { id: "0002_memory", sql: memorySql },
    { id: "0003_checkpoint_tests", sql: checkpointSql },
    { id: "0004_investigator", sql: investigatorSql },
    { id: "0005_checkpoint_recaps", sql: checkpointRecapSql },
  ]);
  const bad = campaigns.create("   ");
  assert(!bad.ok && bad.error.code === "IPC_INVALID_REQUEST", "空名字拒收");

  const created = campaigns.create("寄宿公寓试玩");
  assert(created.ok && created.value.name === "寄宿公寓试玩", "创建战役写入目录");
  if (!created.ok) throw new Error("create failed");

  const listed = campaigns.list({ limit: 20 });
  assert(listed.ok && listed.value.items.length === 1, "列表只看见未删除的战役");

  const opened = campaigns.open(created.value.campaignId);
  assert(opened.ok && opened.value.headBranchId === created.value.headBranchId, "打开战役对得上主线");

  const investigatorCampaign = campaigns.create("调查员持久化探测");
  assert(investigatorCampaign.ok, "另开一场确认调查员");
  if (!investigatorCampaign.ok) throw new Error("investigator campaign create failed");
  const confirmed = campaigns.confirmInvestigator({
    campaignId: investigatorCampaign.value.campaignId,
    branchId: investigatorCampaign.value.headBranchId,
    allocation: {
      name: "林晚",
      lifeHistoryId: "history.archive-correspondent",
      occupationPoints: { 侦查: 55, 聆听: 35, 图书馆使用: 50, 话术: 70, 心理学: 70 },
      interestPoints: { 侦查: 7, 聆听: 35, 图书馆使用: 9, 开锁: 89 },
    },
  });
  assert(confirmed.ok && confirmed.value.stateVersion === 1, "确认调查员原子提交初始事件");
  if (!confirmed.ok) throw new Error("investigator confirmation failed");
  const confirmedDb = campaigns.driver(investigatorCampaign.value.campaignId);
  const originalRecord = confirmedDb
    ? loadInvestigator(confirmedDb, investigatorCampaign.value.headBranchId)
    : null;
  assert(Boolean(originalRecord), "主分支绑定调查员档案");
  const initialEvents = confirmedDb
    ? loadGameEvents(confirmedDb, investigatorCampaign.value.headBranchId)
    : [];
  const projected = replay(initialState(), initialEvents);
  assert(
    projected.pcName === "林晚" &&
      projected.lifeHistoryId === "history.archive-correspondent" &&
      projected.characteristics?.EDU === 70,
    "事件重放恢复调查员投影",
  );
  campaigns.close(investigatorCampaign.value.campaignId);
  campaigns.open(investigatorCampaign.value.campaignId);
  const reopenedDb = campaigns.driver(investigatorCampaign.value.campaignId);
  const reopenedRecord = reopenedDb
    ? loadInvestigator(reopenedDb, investigatorCampaign.value.headBranchId)
    : null;
  const reopenedProfile = campaigns.getInvestigator(investigatorCampaign.value.campaignId);
  assert(
    reopenedRecord?.profileJson === originalRecord?.profileJson &&
      reopenedRecord?.profileHash === originalRecord?.profileHash &&
      reopenedProfile.ok &&
      reopenedProfile.value !== null &&
      hashProfile(reopenedProfile.value) === originalRecord?.profileHash,
    "关闭重开后规范 JSON 和 SHA-256 不变",
  );
  const restoredInvestigator = reopenedDb
    ? restoreCheckpointCopy(
        reopenedDb,
        confirmed.value.checkpointId,
        "正式开局前副本",
        clock.nowIso(),
      )
    : null;
  const restoredRecord = restoredInvestigator && reopenedDb
    ? loadInvestigator(reopenedDb, restoredInvestigator.branchId)
    : null;
  assert(
    restoredRecord?.profileJson === originalRecord?.profileJson &&
      restoredRecord?.profileHash === originalRecord?.profileHash,
    "检查点副本继承同一调查员 JSON 和 SHA-256",
  );

  const campaignDb = openBun(paths.campaignFile(created.value.campaignId));
  const tables = campaignDb
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .map((row) => row.name);
  for (const name of [
    "branches",
    "turns",
    "operations",
    "events",
    "state_entities",
    "rule_decisions",
    "narrations",
    "checkpoints",
    "checkpoint_recaps",
    "checkpoint_restore_sources",
    "memory_entries",
    "memory_cursors",
    "director_frontier",
    "investigator_profiles",
    "branch_investigator_bindings",
  ]) {
    assert(tables.includes(name), `战役库有 ${name}`);
  }

  const branch = campaignDb.get<{ branch_id: string }>(
    "SELECT branch_id FROM branches WHERE label = ?",
    ["主线"],
  );
  assert(Boolean(branch), "默认主线分支");

  campaignDb.run(
    `INSERT INTO turns (
      turn_id, branch_id, command_id, actor_id, controller_id, input_text, status,
      base_state_version, committed_state_version, operation_id, failure_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'received', 0, NULL, ?, NULL, ?, ?)`,
    ["t1", branch?.branch_id, "cmd1", "actor", "pl", "开锁", "op1", clock.nowIso(), clock.nowIso()],
  );
  campaignDb.run(
    `INSERT INTO events (
      event_id, branch_id, sequence, turn_id, event_type, entity_type, entity_id,
      state_version, schema_version, source_json, audience_json, payload_json, occurred_at
    ) VALUES (?, ?, 1, 't1', 'action_rejected', NULL, NULL, 1, 1, '{}', '{}', ?, ?)`,
    [
      "e1",
      branch?.branch_id,
      JSON.stringify({
        payload: { type: "action_rejected", reason: "probe" },
        summary: "探测不可变",
        cause: "test",
        id: "e1",
        seq: 0,
        turnId: "t1",
        versionAfter: 1,
        clock: 0,
        visibility: "public",
      }),
      clock.nowIso(),
    ],
  );

  let immutable = false;
  try {
    campaignDb.run("UPDATE events SET event_type = 'x' WHERE event_id = 'e1'");
  } catch {
    immutable = true;
  }
  assert(immutable, "events 改不动");

  let undeletable = false;
  try {
    campaignDb.run("DELETE FROM events WHERE event_id = 'e1'");
  } catch {
    undeletable = true;
  }
  assert(undeletable, "events 删不掉");
  campaignDb.close();

  setSetting(settings, "locale", "zh-CN", clock.nowIso());
  assert(getSetting(settings, "locale") === "zh-CN", "app_settings 读写");

  ensureDefaultProvider(settings, clock.nowIso(), "qwen3.8:latest", "http://127.0.0.1:11434");
  assert(listProviders(settings).length === 1, "默认 Ollama provider");
  assert(listTaskRoutes(settings).length >= 8, "默认 task_routes");

  campaigns.moveToTrash(created.value.campaignId);
  const afterTrash = campaigns.list({ limit: 20 });
  assert(
    afterTrash.ok &&
      !afterTrash.value.items.some((item) => item.campaignId === created.value.campaignId),
    "进回收站后目标战役从列表消失",
  );
  campaigns.restoreFromTrash(created.value.campaignId);
  const afterRestore = campaigns.list({ limit: 20 });
  assert(
    afterRestore.ok &&
      afterRestore.value.items.some((item) => item.campaignId === created.value.campaignId),
    "恢复之后目标战役重新出现",
  );

  const turnCredentials = new CredentialStore(
    join(root, "turn-credentials.json"),
    clock,
    xorSafeStorage(true),
  );
  const turns = new TurnService(campaigns, turnCredentials, clock);
  const fresh = campaigns.create("回合探测");
  assert(fresh.ok, "另开一场做回合探测");
  const live = fresh.ok ? fresh.value : undefined;
  if (live) {
    const conflict = await turns.submit({
      campaignId: live.campaignId,
      branchId: live.headBranchId,
      actorId: actor,
      controllerId: "player",
      expectedStateVersion: asStateVersion(99),
      commandId: "cmd-conflict",
      text: "往书房走",
    });
    assert(!conflict.ok && conflict.error.code === "TURN_VERSION_CONFLICT", "版本对不上就拒写");

    const moved = await turns.submit({
      campaignId: live.campaignId,
      branchId: asBranchId(live.headBranchId),
      actorId: actor,
      controllerId: "player",
      expectedStateVersion: asStateVersion(live.headStateVersion),
      commandId: "cmd-move-study",
      text: "往书房走",
    });
    assert(moved.ok, "主进程提交移动");
    if (moved.ok) {
      const again = await turns.submit({
        campaignId: live.campaignId,
        branchId: live.headBranchId,
        actorId: actor,
        controllerId: "player",
        expectedStateVersion: asStateVersion(live.headStateVersion),
        commandId: "cmd-move-study",
        text: "往书房走",
      });
      assert(
        again.ok && again.value.operationId === moved.value.operationId,
        "同一 commandId 幂等",
      );
      const view = turns.get(moved.value.operationId, live.campaignId);
      assert(view.ok && view.value.kind === "committed" && view.value.events.length > 0, "operation.get 带回已提交事件");
      const db = campaigns.driver(live.campaignId);
      const events = db ? loadGameEvents(db, live.headBranchId) : [];
      assert(events.some((event) => event.payload.type === "moved"), "events 表里有 moved");
      const memCount = db?.get<{ n: number }>("SELECT count(*) AS n FROM memory_entries");
      assert((memCount?.n ?? 0) >= 1, "提交后写入 memory_entries");
      const frontierRow = db?.get<{ n: number }>("SELECT count(*) AS n FROM director_frontier");
      assert((frontierRow?.n ?? 0) === 1, "提交后写入 director_frontier");

      const collected: Array<{ type: string; sequence?: number }> = [];
      const subId = turns.subscribe(moved.value.operationId, (event) => {
        collected.push({
          type: event.type,
          sequence: event.type === "narration.delta" ? event.sequence : undefined,
        });
      });
      await turns.waitForNarration(moved.value.operationId);
      assert(
        collected.some((event) => event.type === "operation.status"),
        "subscribe 回放 operation.status",
      );
      assert(
        collected.some((event) => event.type === "narration.delta" && event.sequence === 0),
        "subscribe 回放 narration.delta sequence=0",
      );
      assert(
        collected.some((event) => event.type === "narration.completed"),
        "subscribe 回放 narration.completed",
      );
      assert(
        collected.some((event) => event.type === "campaign.changed"),
        "subscribe 回放 campaign.changed",
      );
      turns.unsubscribe(subId);

      const finalView = turns.get(moved.value.operationId, live.campaignId);
      assert(
        finalView.ok &&
          finalView.value.narration.length > 0 &&
          finalView.value.narrationKind === "模板",
        "operation.get 带回定稿叙述和 kind",
      );
      const narrationRow = db?.get<{ n: number; status: string }>(
        "SELECT count(*) AS n, max(status) AS status FROM narrations WHERE turn_id = ?",
        [moved.value.turnId],
      );
      assert(narrationRow?.n === 1 && narrationRow.status === "final", "narrations 表有一条 final");

      const againCount = db?.get<{ n: number }>(
        "SELECT count(*) AS n FROM narrations WHERE turn_id = ?",
        [moved.value.turnId],
      );
      assert(againCount?.n === 1, "同一 commandId 不重复写 narration");
    }
  }

  const secret = "sk-live-persist-check-plaintext-secret";
  const credFile = join(root, "credentials.json");
  const store = new CredentialStore(credFile, clock, xorSafeStorage(true));
  const saved = store.set({ value: secret });
  assert(saved.ok, "CredentialStore.set");
  const credentialId = saved.ok ? saved.value.credentialId : "";
  const present = store.has(credentialId);
  assert(present.ok && present.value.present, "CredentialStore.has");
  let used = "";
  const usedResult = store.use(credentialId, (plain) => {
    used = plain;
    return "ok";
  });
  assert(usedResult.ok && used === secret, "CredentialStore.use 看到明文");
  assert(existsSync(credFile), "credentials.json 已写入");
  const serialized = readFileSync(credFile, "utf8");
  assert(!serialized.includes(secret), "落盘文件不含明文");
  const parsed: unknown = JSON.parse(serialized);
  const rows = Array.isArray(parsed) ? parsed : [];
  assert(rows.length === 1, "落盘是 blob 数组");
  const blob = (rows[0] ?? {}) as Record<string, unknown>;
  const blobKeys = Object.keys(blob).sort().join(",");
  assert(
    blobKeys === "ciphertext,createdAt,credentialId,updatedAt",
    "blob 只有 credentialId/ciphertext/createdAt/updatedAt",
  );
  const reloaded = new CredentialStore(credFile, clock, xorSafeStorage(true));
  let roundtrip = "";
  reloaded.use(credentialId, (plain) => {
    roundtrip = plain;
  });
  assert(roundtrip === secret, "重开 store 仍能解密");
  const removed = store.delete(credentialId);
  assert(removed.ok, "CredentialStore.delete");
  const afterDelete = store.has(credentialId);
  assert(afterDelete.ok && !afterDelete.value.present, "delete 后 has 为 false");
  assert(!readFileSync(credFile, "utf8").includes(credentialId), "delete 后文件不再含该 id");

  const sessionFile = join(root, "credentials-session.json");
  const unavailable = new CredentialStore(sessionFile, clock, xorSafeStorage(false));
  const refused = unavailable.set({ value: secret });
  assert(
    !refused.ok && refused.error.code === "CREDENTIAL_STORAGE_UNAVAILABLE",
    "不可用时拒绝持久化",
  );
  assert(!existsSync(sessionFile), "拒绝持久化不写文件");
  const session = unavailable.set({ value: secret, persist: false });
  assert(session.ok, "不可用时允许会话密钥");
  assert(!existsSync(sessionFile), "会话密钥不落盘");
  let sessionPlain = "";
  if (session.ok) {
    unavailable.use(session.value.credentialId, (plain) => {
      sessionPlain = plain;
    });
  }
  assert(sessionPlain === secret, "会话密钥 use 看到明文");

  campaigns.dispose();
  settings.close();
} finally {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    const busyUntilBunExits =
      process.platform === "win32" &&
      error instanceof Error &&
      "code" in error &&
      error.code === "EBUSY";
    if (!busyUntilBunExits) throw error;
    console.warn(`Windows 上 bun:sqlite 会持锁到进程退出，临时目录留给系统清理：${root}`);
  }
}

if (failed) {
  console.log(`\n失败 ${failed} 项。`);
  process.exit(1);
}
console.log("\n全部通过。");
