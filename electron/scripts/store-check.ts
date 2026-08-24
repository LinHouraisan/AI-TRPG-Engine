/**
 * 存储层测试。
 *
 * 要证明的是四件事：事件写进去之后改不动也删不掉；重放能从事件把状态原样算回来；
 * 回滚不改历史，而是分出一条新分支；导出再导入到另一个库，状态哈希仍然一致。
 *
 * 浏览器里用的是 sqlite-wasm，这里用的是 bun:sqlite，但 SQL 是同一份。
 *
 * 运行：cd demo && bun run store:check
 */
import { pack } from "@core/engine/pack";
import { resolveIntent } from "@core/engine/resolve";
import { commit, replay, stateHash } from "@core/engine/runtime";
import { initialState } from "@core/engine/state";
import type { GameEvent, GameState, Intent } from "@core/engine/types";
import { createBunDriver } from "@renderer/store/bun";
import { Store } from "@renderer/store/repo";

let passed = 0;

function assert(ok: boolean, label: string) {
  if (!ok) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✓ ${label}`);
}

async function throws(fn: () => Promise<unknown>, label: string) {
  try {
    await fn();
  } catch {
    assert(true, label);
    return;
  }
  assert(false, label);
}

const store = await Store.open(createBunDriver());
console.log(`存储后端：${store.backend}`);

const start = initialState();
const handle = await store.openCampaign({
  packRef: pack.ref,
  title: pack.manifest.title,
  initialState: start,
});
assert(handle.fresh, "第一次打开是新开的一场");

// 跑几个回合，每提交一次就落一次盘。
let state: GameState = start;
let log: GameEvent[] = [];

async function step(intent: Intent) {
  const turnId = `turn-${state.turn + 1}`;
  const { drafts } = resolveIntent({ intent, state, turnId });
  const result = commit({ state, log, drafts, turnId });
  state = result.state;
  log = result.log;
  await store.appendEvents(handle.branchId, result.committed);
  await store.saveCheckpoint({
    branchId: handle.branchId,
    cursor: log.length - 1,
    stateVersion: state.version,
    stateHash: stateHash(state),
    packRef: pack.ref,
  });
  return result.committed;
}

await step({ kind: "move", to: "loc.study" });
await step({ kind: "observe", target: "item.desk_lock" });
const forkPoint = log.length - 1;
const versionAtFork = state.version;
const stateAtFork = stateHash(state);

let guard = 0;
while (!state.unlocked["lock.desk"] && guard < 12) {
  guard += 1;
  await step({ kind: "unlock", lock: "lock.desk" });
}
await step({ kind: "take", item: "item.ledger" });
assert(state.itemAt["item.ledger"] === "inv.pc", "跑到了拿走账本这一步");

console.log("\n— 事件只追加 —");
// 另开一个库专门用来撞墙：改、删、重复写，三条路都得堵死。
const rawDriver = createBunDriver();
const probe = await Store.open(rawDriver);
const probeHandle = await probe.openCampaign({
  packRef: pack.ref,
  title: "改不动",
  initialState: start,
});
await probe.appendEvents(probeHandle.branchId, log.slice(0, 1));
await throws(
  () =>
    rawDriver.run(`UPDATE event SET summary = '偷偷改一句' WHERE branch_id = ?`, [
      probeHandle.branchId,
    ]),
  "改事件被触发器挡住",
);
await throws(
  () => rawDriver.run(`DELETE FROM event WHERE branch_id = ?`, [probeHandle.branchId]),
  "删事件被触发器挡住",
);
await throws(
  () => probe.appendEvents(probeHandle.branchId, log.slice(0, 1)),
  "同一条事件写第二次被主键挡住",
);
await probe.close();

console.log("\n— 从事件重放 —");
const loaded = await store.loadEvents(handle.branchId);
assert(loaded.length === log.length, `读回来 ${loaded.length} 条事件`);
const replayed = replay(start, loaded);
assert(stateHash(replayed) === stateHash(state), `重放出来的状态哈希一致（${stateHash(replayed)}）`);

const checkpoint = await store.latestCheckpoint(handle.branchId);
assert(checkpoint?.stateHash === stateHash(state), "检查点记的哈希与当场一致");
assert(checkpoint?.packRef === pack.ref, `检查点记着资料包 ${checkpoint?.packRef}`);

console.log("\n— 回滚开分支，旧分支不动 —");
const branchId = await store.fork({
  campaignId: handle.campaignId,
  fromBranch: handle.branchId,
  throughSeq: forkPoint,
  title: `回到 v${versionAtFork}`,
});
const forkEvents = await store.loadEvents(branchId);
const forkState = replay(start, forkEvents);
assert(stateHash(forkState) === stateAtFork, "新分支重放出的是当时那一版");
assert(forkState.unlocked["lock.desk"] !== true, "新分支上书桌还锁着");
assert((await store.loadEvents(handle.branchId)).length === log.length, "旧分支一条事件都没少");
assert(state.unlocked["lock.desk"] === true, "旧分支上锁仍然是开的");

const branches = await store.listBranches(handle.campaignId);
assert(branches.length === 2, `这一场现在有 ${branches.length} 条分支`);

console.log("\n— 导出再导入 —");
const payload = await store.exportCampaign(handle.campaignId);
const other = await Store.open(createBunDriver());
const imported = await other.importCampaign(payload);
const importedEvents = await other.loadEvents(
  (await other.listBranches(imported.campaignId)).find((b) => b.parentBranch === null)!.id,
);
assert(
  stateHash(replay(imported.initialState, importedEvents)) === stateHash(state),
  "换一个库导入之后，重放出来的哈希还是一样",
);
await other.close();

console.log("\n— 老库的通知不会被洗白成对话 —");
const oldDriver = createBunDriver();
await oldDriver.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE campaign (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  pack_ref TEXT NOT NULL,
  initial_state TEXT NOT NULL,
  head_branch TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE branch (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaign(id),
  title TEXT NOT NULL,
  parent_branch TEXT REFERENCES branch(id),
  fork_seq INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE message (
  branch_id TEXT NOT NULL REFERENCES branch(id),
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  source TEXT,
  note TEXT,
  check_json TEXT,
  PRIMARY KEY (branch_id, seq)
);
`);
await oldDriver.run(
  `INSERT INTO campaign (id, title, pack_ref, initial_state, head_branch, created_at)
   VALUES ('c1', '老库', 'boarding-house@0.2.0', '{}', 'b1', 1)`,
);
await oldDriver.run(
  `INSERT INTO branch (id, campaign_id, title, parent_branch, fork_seq, created_at)
   VALUES ('b1', 'c1', '主线', NULL, NULL, 1)`,
);
const resume = "已续上上一场：重放 2 条事件，回到版本 v2，哈希 b5b64d98。";
await oldDriver.run(
  `INSERT INTO message (branch_id, seq, role, text, state_version, source, note, check_json)
   VALUES ('b1', 0, 'kp', '你推开书房门。', 1, '模板', NULL, NULL)`,
);
await oldDriver.run(
  `INSERT INTO message (branch_id, seq, role, text, state_version, source, note, check_json)
   VALUES ('b1', 1, 'pl', '我撬这把锁', 1, NULL, NULL, NULL)`,
);
for (const seq of [2, 3, 4]) {
  await oldDriver.run(
    `INSERT INTO message (branch_id, seq, role, text, state_version, source, note, check_json)
     VALUES ('b1', ?, 'system', ?, 2, NULL, NULL, NULL)`,
    [seq, resume],
  );
}
const colsBefore = await oldDriver.all<{ name: string }>(`PRAGMA table_info(message)`);
assert(
  !colsBefore.some((col) => String(col.name) === "kind"),
  "探测用的老库本来没有 kind 列",
);

const oldStore = await Store.open(oldDriver);
const colsAfter = await oldDriver.all<{ name: string }>(`PRAGMA table_info(message)`);
assert(
  colsAfter.some((col) => String(col.name) === "kind"),
  "打开老库时补上了 kind 列",
);

const fromOld = await oldStore.loadMessages("b1");
assert(fromOld.length === 2, `读回来时污染行已被滤掉（剩 ${fromOld.length} 条）`);
assert(
  fromOld.every((message) => message.role !== "system"),
  "读回来的没有 system 通知",
);

await oldStore.saveMessages("b1", fromOld);
const rawAfter = await oldDriver.all<{ role: string; text: string; kind: string | null }>(
  `SELECT role, text, kind FROM message WHERE branch_id = 'b1'`,
);
assert(
  rawAfter.every((row) => row.role !== "system"),
  "把读到的原样写回去之后，库里没有 system 行",
);
assert(
  rawAfter.every((row) => !String(row.text).includes("已续上上一场")),
  "写回去之后续场提示没有被洗白成 play",
);
assert(
  rawAfter.length === 2 && rawAfter.every((row) => row.kind === "play"),
  "留下的两条对话标成 play",
);

await oldStore.saveMessages("b1", [
  ...fromOld,
  { role: "system", text: resume, stateVersion: 2 },
]);
const rawForced = await oldDriver.all<{ role: string }>(
  `SELECT role FROM message WHERE branch_id = 'b1'`,
);
assert(
  rawForced.every((row) => row.role !== "system"),
  "saveMessages 拒写 system，即使没有 kind",
);

await oldStore.close();

{
  const memStore = await Store.open(createBunDriver());
  const handle = await memStore.openCampaign({
    packRef: pack.ref,
    title: "memory",
    initialState: start,
  });
  const { emptyMemory } = await import("@core/ai/memory");
  let memory = emptyMemory();
  memory = {
    cursor: { rawRecordedThroughTurn: 1, memoryProcessedThroughTurn: 1 },
    entries: [
      {
        id: "fact:e1",
        memoryType: "fact",
        summary: "moved",
        sources: ["e1"],
        entityIds: ["loc.study"],
        sceneId: "loc.study",
        importance: 1,
        status: "active",
        structured: { type: "moved" },
        extractedThroughTurn: 1,
      },
    ],
  };
  await memStore.saveMemory(handle.branchId, memory);
  const loaded = await memStore.loadMemory(handle.branchId);
  assert(loaded.entries.length === 1 && loaded.entries[0]?.sources[0] === "e1", "memory 落盘再读回来");
  await memStore.saveFrontier(handle.branchId, {
    basedOnStateVersion: 1,
    lastAssessedEventId: "e1",
    activeArcIds: [],
    blockedArcIds: [],
    dormantArcIds: [],
    openOpportunityIds: [],
    clueCoverageGaps: [],
    playerGoalMemoryIds: [],
  });
  const frontier = await memStore.loadFrontier(handle.branchId);
  assert(frontier?.lastAssessedEventId === "e1", "director frontier 落盘再读回来");
  await memStore.close();
}

await store.close();

console.log(`\n全部通过（${passed} 项）。`);
