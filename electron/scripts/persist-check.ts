import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fixedClock } from "../main/clock";
import { resolvePaths } from "../main/paths";
import { openBun } from "../main/persist/bun-driver";
import { checksum } from "../main/persist/migrate";
import { CampaignService } from "../main/services/campaigns";
import { applyInit } from "../main/persist/migrate";
import { getSetting, setSetting } from "../main/persist/catalog";

const root = mkdtempSync(join(tmpdir(), "ai-trpg-electron-"));
const clock = fixedClock("2026-08-19T00:00:00.000Z");
const paths = resolvePaths(root);
const settingsSql = readFileSync(join(import.meta.dir, "../sql/settings.sql"), "utf8");
const campaignSql = readFileSync(join(import.meta.dir, "../sql/campaign.sql"), "utf8");

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

  const campaigns = new CampaignService(settings, paths, clock, openBun, campaignSql);
  const bad = campaigns.create("   ");
  assert(!bad.ok && bad.error.code === "IPC_INVALID_REQUEST", "空名字拒收");

  const created = campaigns.create("寄宿公寓试玩");
  assert(created.ok && created.value.name === "寄宿公寓试玩", "创建战役写入目录");
  if (!created.ok) throw new Error("create failed");

  const listed = campaigns.list({ limit: 20 });
  assert(listed.ok && listed.value.items.length === 1, "列表只看见未删除的战役");

  const opened = campaigns.open(created.value.campaignId);
  assert(opened.ok && opened.value.headBranchId === created.value.headBranchId, "打开战役对得上主线");

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
    ) VALUES (?, ?, 1, 't1', 'scene.entered', 'scene', 'loc.hall', 1, 1, '{}', '{}', '{}', ?)`,
    ["e1", branch?.branch_id, clock.nowIso()],
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

  campaigns.moveToTrash(created.value.campaignId);
  const afterTrash = campaigns.list({ limit: 20 });
  assert(afterTrash.ok && afterTrash.value.items.length === 0, "进回收站后列表为空");
  campaigns.restoreFromTrash(created.value.campaignId);
  const afterRestore = campaigns.list({ limit: 20 });
  assert(afterRestore.ok && afterRestore.value.items.length === 1, "恢复之后重新出现");

  campaigns.dispose();
  settings.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failed) {
  console.log(`\n失败 ${failed} 项。`);
  process.exit(1);
}
console.log("\n全部通过。");
