import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixedClock } from "../main/clock";
import { createCheckpoint, listCheckpoints, restoreCheckpointCopy } from "../main/persist/checkpoints";
import { openBun } from "../main/persist/bun-driver";
import { applyInit, applyMigration } from "../main/persist/migrate";
import { loadBranchHistory } from "../main/persist/turns";

function assert(ok: unknown, label: string): asserts ok {
  if (!ok) throw new Error(label);
  console.log(`✓ ${label}`);
}

const db = openBun(":memory:");
const clock = fixedClock("2026-08-23T00:00:00.000Z");
const sqlDir = join(import.meta.dir, "../sql");
applyInit(db, clock, readFileSync(join(sqlDir, "campaign.sql"), "utf8"), "0001_init");
applyMigration(db, clock, readFileSync(join(sqlDir, "campaign-0003-checkpoint-tests.sql"), "utf8"), "0003_checkpoint_tests");
applyMigration(db, clock, readFileSync(join(sqlDir, "campaign-0004-investigator.sql"), "utf8"), "0004_investigator");
applyMigration(db, clock, readFileSync(join(sqlDir, "campaign-0005-checkpoint-recaps.sql"), "utf8"), "0005_checkpoint_recaps");
db.run("INSERT INTO campaign_metadata VALUES ('camp','test',?,?,1,1)", [clock.nowIso(), clock.nowIso()]);
db.run("INSERT INTO branches VALUES ('main',NULL,NULL,'主线',0,0,?,NULL)", [clock.nowIso()]);
db.run(
  "INSERT INTO investigator_profiles VALUES ('profile', ?, 'hash', '0.1.0', ?)",
  [JSON.stringify({ name: "林晚", lifeHistoryId: "history.archive-correspondent", contentVersion: "0.1.0" }), clock.nowIso()],
);
db.run("INSERT INTO branch_investigator_bindings VALUES ('main', 'profile')");

function insertTurn(input: {
  id: string;
  player: string;
  gm?: string;
  stateVersion: number;
  createdAt: string;
  event?: { sequence: number; summary: string; visibility: "public" | "secret" };
}): void {
  db.run(
    `INSERT INTO turns (
      turn_id, branch_id, command_id, actor_id, controller_id, input_text, status,
      base_state_version, committed_state_version, operation_id, failure_code, created_at, updated_at
    ) VALUES (?, 'main', ?, 'pc.linwan', 'player', ?, 'completed', ?, ?, ?, NULL, ?, ?)`,
    [input.id, `command-${input.id}`, input.player, input.stateVersion, input.stateVersion, `operation-${input.id}`, input.createdAt, input.createdAt],
  );
  if (input.event) {
    const event = {
      id: `event-${input.id}`,
      turnId: input.id,
      seq: input.event.sequence - 1,
      versionAfter: input.stateVersion,
      clock: input.stateVersion,
      summary: input.event.summary,
      visibility: input.event.visibility,
      cause: "checkpoint-regression",
      payload: { type: "fact_known", fact: `fact.${input.id}` },
    };
    db.run(
      `INSERT INTO events (
        event_id, branch_id, sequence, turn_id, event_type, entity_type, entity_id,
        state_version, schema_version, source_json, audience_json, payload_json, occurred_at
      ) VALUES (?, 'main', ?, ?, 'fact_known', NULL, NULL, ?, 1, '{}', ?, ?, ?)`,
      [event.id, input.event.sequence, input.id, input.stateVersion, JSON.stringify({ kind: input.event.visibility === "public" ? "public" : "gm_only" }), JSON.stringify(event), input.createdAt],
    );
  }
  if (input.gm) {
    db.run(
      `INSERT INTO narrations (
        narration_id, branch_id, turn_id, based_on_state_version, model_task_id,
        prompt_version, text, status, created_at
      ) VALUES (?, 'main', ?, ?, ?, 'test', ?, 'final', ?)`,
      [`narration-${input.id}`, input.id, input.stateVersion, `model-${input.id}`, input.gm, input.createdAt],
    );
  }
}

insertTurn({ id: "turn-1", player: "查看名单", gm: "名单第四十八格是空的。", stateVersion: 1, createdAt: "2026-08-23T00:01:00.000Z", event: { sequence: 1, summary: "末班车名单第四十八格有异常。", visibility: "public" } });
insertTurn({ id: "turn-2", player: "询问罗姨", gm: "罗姨说这一格本来有名字。", stateVersion: 1, createdAt: "2026-08-23T00:02:00.000Z" });
insertTurn({ id: "turn-3", player: "检查票根", gm: "票根沾着海水和煤灰。", stateVersion: 2, createdAt: "2026-08-23T00:03:00.000Z", event: { sequence: 2, summary: "守秘人秘密。", visibility: "secret" } });
insertTurn({ id: "turn-4", player: "再问一次", gm: "罗姨让你去站台找许澄。", stateVersion: 2, createdAt: "2026-08-23T00:03:30.000Z" });
insertTurn({ id: "turn-crossing", player: "这辆车要去哪里？", stateVersion: 2, createdAt: "2026-08-23T00:03:45.000Z" });
db.run("UPDATE branches SET head_sequence = 2, head_state_version = 2 WHERE branch_id = 'main'");

const checkpoint = createCheckpoint(db, {
  branchId: "main",
  label: "第三幕前",
  now: "2026-08-23T00:04:00.000Z",
  purpose: "验证 Figure 3 恢复",
  steps: ["创建战役"],
  expected: { version: 2 },
  actual: { version: 2 },
  passed: true,
});
assert((checkpoint as { recap?: string }).recap?.startsWith("林晚因沈鹭"), "检查点持久化调查员前情");
assert((checkpoint as { recap?: string }).recap?.includes("末班车名单第四十八格有异常"), "前情包含边界内公开事件");
assert(!(checkpoint as { recap?: string }).recap?.includes("守秘人秘密"), "前情不泄露秘密事件");
assert(listCheckpoints(db)[0]?.purpose === "验证 Figure 3 恢复", "测试检查点可查看");

db.run(
  `INSERT INTO narrations (
    narration_id, branch_id, turn_id, based_on_state_version, model_task_id,
    prompt_version, text, status, created_at
  ) VALUES ('narration-crossing', 'main', 'turn-crossing', 2, 'model-crossing', 'test', '这是检查点后才完成的回答。', 'final', '2026-08-23T00:05:00.000Z')`,
);
insertTurn({ id: "turn-later", player: "登上末班车", gm: "车门在身后合拢。", stateVersion: 3, createdAt: "2026-08-23T00:06:00.000Z", event: { sequence: 3, summary: "林晚已经登上末班车。", visibility: "public" } });
db.run("UPDATE branches SET head_sequence = 3, head_state_version = 3 WHERE branch_id = 'main'");
const sourceCounts = {
  turns: db.get<{ count: number }>("SELECT count(*) AS count FROM turns WHERE branch_id = 'main'")?.count,
  events: db.get<{ count: number }>("SELECT count(*) AS count FROM events WHERE branch_id = 'main'")?.count,
  narrations: db.get<{ count: number }>("SELECT count(*) AS count FROM narrations WHERE branch_id = 'main'")?.count,
};
const boundedSourceHistory = loadBranchHistory(db, "main", {
  stateVersion: checkpoint.stateVersion,
  eventSequence: checkpoint.eventSequence,
});
assert(!boundedSourceHistory.recentTurns.some((turn) => turn.player === "这辆车要去哪里？" || turn.player === "登上末班车"), "显式上界不读取来源分支的检查点后对话");
assert(loadBranchHistory(db, "main").recentTurns.some((turn) => turn.player === "登上末班车"), "当前来源分支仍可读取自己的后续对话");

const restored = restoreCheckpointCopy(db, checkpoint.checkpointId, "第三幕前恢复副本", "2026-08-23T00:07:00.000Z");
const history = loadBranchHistory(db, restored.branchId, {
  stateVersion: checkpoint.stateVersion,
  eventSequence: checkpoint.eventSequence,
});
assert(restored.branchId !== "main", "恢复创建新分支");
assert(db.get<{ parent_branch_id: string }>("SELECT parent_branch_id FROM branches WHERE branch_id = ?", [restored.branchId])?.parent_branch_id === "main", "新分支保留来源");
assert(history.recap === (checkpoint as { recap?: string }).recap, "恢复使用检查点持久化前情");
assert(history.restoredFrom === "第三幕前", "恢复提示指向原检查点");
assert(history.recentTurns.map((turn) => turn.player).join("|") === "询问罗姨|检查票根|再问一次", "恢复只带回边界前最近三个完整对话");
assert(!history.recentTurns.some((turn) => turn.player === "这辆车要去哪里？" || turn.player === "登上末班车"), "检查点后对话不进入恢复历史");
assert(!history.recap.includes("林晚已经登上末班车"), "检查点后事件不进入持久化前情");
assert(db.get<{ head_state_version: number }>("SELECT head_state_version FROM branches WHERE branch_id = 'main'")?.head_state_version === 3, "来源分支版本不变");
assert(db.get<{ count: number }>("SELECT count(*) AS count FROM turns WHERE branch_id = 'main'")?.count === sourceCounts.turns, "来源分支回合不变");
assert(db.get<{ count: number }>("SELECT count(*) AS count FROM events WHERE branch_id = 'main'")?.count === sourceCounts.events, "来源分支事件不变");
assert(db.get<{ count: number }>("SELECT count(*) AS count FROM narrations WHERE branch_id = 'main'")?.count === sourceCounts.narrations, "来源分支叙述不变");
db.close();

const legacy = openBun(":memory:");
applyInit(legacy, clock, readFileSync(join(sqlDir, "campaign.sql"), "utf8"), "0001_init");
applyMigration(legacy, clock, readFileSync(join(sqlDir, "campaign-0003-checkpoint-tests.sql"), "utf8"), "0003_checkpoint_tests");
applyMigration(legacy, clock, readFileSync(join(sqlDir, "campaign-0004-investigator.sql"), "utf8"), "0004_investigator");
legacy.run("INSERT INTO branches VALUES ('legacy-main', NULL, NULL, '主线', 0, 0, ?, NULL)", [clock.nowIso()]);
legacy.run(
  "INSERT INTO investigator_profiles VALUES ('legacy-profile', ?, 'hash', '0.1.0', ?)",
  [JSON.stringify({ name: "林晚", lifeHistoryId: "history.archive-correspondent", contentVersion: "0.1.0" }), clock.nowIso()],
);
legacy.run("INSERT INTO branch_investigator_bindings VALUES ('legacy-main', 'legacy-profile')");
legacy.run("INSERT INTO checkpoints VALUES ('legacy-checkpoint', 'legacy-main', 0, 0, NULL, '旧检查点', 'manual', ?)", [clock.nowIso()]);
applyMigration(legacy, clock, readFileSync(join(sqlDir, "campaign-0005-checkpoint-recaps.sql"), "utf8"), "0005_checkpoint_recaps");
const legacyCheckpoint = listCheckpoints(legacy)[0];
assert(legacyCheckpoint?.checkpointId === "legacy-checkpoint", "升级不丢失已应用 0003 时创建的检查点");
assert(legacyCheckpoint.recap.startsWith("林晚因沈鹭"), "0005 为旧检查点回填持久化前情");
legacy.close();
console.log("检查点复制恢复全部通过。");
