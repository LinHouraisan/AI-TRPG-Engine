/**
 * 用主进程 TurnService 再跑一遍寄宿公寓金样。
 * 哈希必须和 scripts/smoke.ts 当场算出来的一样。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replay, stateHash } from "@core/engine/runtime";
import { initialState, visibleItemsInRoom } from "@core/engine/state";
import { fixedClock } from "../src/main/clock";
import { CredentialStore } from "../src/main/credentials";
import { resolvePaths } from "../src/main/paths";
import { openBun } from "../src/main/persist/bun-driver";
import { applyInit } from "../src/main/persist/migrate";
import { loadGameEvents } from "../src/main/persist/turns";
import { CampaignService } from "../src/main/services/campaigns";
import { TurnService } from "../src/main/services/turns";
import { asBranchId, asStateVersion, type EntityId } from "../src/shared/ids";

const root = mkdtempSync(join(tmpdir(), "ai-trpg-gold-"));
const clock = fixedClock("2026-08-19T00:00:00.000Z");
const paths = resolvePaths(root);
const settingsSql = readFileSync(join(import.meta.dir, "../sql/settings.sql"), "utf8");
const campaignSql = readFileSync(join(import.meta.dir, "../sql/campaign.sql"), "utf8");
const memorySql = readFileSync(join(import.meta.dir, "../sql/campaign-0002-memory.sql"), "utf8");
const actor = "pc.linwan" as EntityId;

let failed = 0;
function assert(ok: boolean, label: string): void {
  if (ok) console.log(`✓ ${label}`);
  else {
    failed += 1;
    console.log(`✗ ${label}`);
  }
}

try {
  const settings = openBun(paths.settingsDb);
  applyInit(settings, clock, settingsSql, "0001_init");
  // 寄宿公寓金样刻意只装载通用内核迁移，不启用雾港调查员持久化契约。
  // 雾港产品路径由 mist-harbor-e2e 覆盖，并且必须先绑定可重放的调查员。
  const campaigns = new CampaignService(settings, paths, clock, openBun, campaignSql, [
    { id: "0002_memory", sql: memorySql },
  ]);
  const credentials = new CredentialStore(join(root, "credentials.json"), clock, {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(plain),
    decryptString: (cipher) => cipher.toString(),
  });
  const turns = new TurnService(campaigns, credentials, clock);
  const created = campaigns.create("金样");
  if (!created.ok) throw new Error("create failed");
  const campaignId = created.value.campaignId;
  const opened = campaigns.ensureOpen(campaignId);
  if (!opened.ok) throw new Error("open failed");
  // 金样必须固定检定 seed；只改仍为空白的临时分支身份，不替换生产 RNG。
  opened.value.run("UPDATE branches SET branch_id = 'main' WHERE branch_id = ?", [created.value.headBranchId]);
  settings.run("UPDATE campaign_catalog SET head_branch_id = 'main' WHERE campaign_id = ?", [campaignId]);
  const branchId = asBranchId("main");
  let version = 0;
  let command = 0;
  const operationIds: string[] = [];

  async function say(text: string) {
    command += 1;
    const result = await turns.submit({
      campaignId,
      branchId,
      actorId: actor,
      controllerId: "player",
      expectedStateVersion: asStateVersion(version),
      commandId: `gold-${command}`,
      text,
    });
    if (!result.ok) throw new Error(`${text}: ${result.error.code}`);
    operationIds.push(result.value.operationId);
    const view = turns.get(result.value.operationId, campaignId);
    if (!view.ok) throw new Error("operation.get failed");
    version = view.value.stateVersion;
    return view.value;
  }

  function desk() {
    const db = campaigns.driver(campaignId);
    if (!db) throw new Error("campaign closed");
    const log = loadGameEvents(db, branchId);
    return { log, state: replay(initialState(), log) };
  }

  console.log((await say("我推开书房门")).narration);
  console.log((await say("看看书桌锁")).narration);
  let { state, log } = desk();
  assert(state.known.includes("fact.lock_scratched"), "观察之后拿到公开线索");
  assert(!visibleItemsInRoom(state, "loc.study").includes("item.ledger"), "开锁前账本看不见");

  await say("把黑色账本收进包里");
  ({ state, log } = desk());
  assert(
    log.some((event) => event.payload.type === "action_rejected"),
    "锁着时取账本被拒绝并落盘",
  );

  let attempts = 0;
  while (!state.unlocked["lock.desk"] && attempts < 12) {
    attempts += 1;
    await say("我撬这把锁");
    ({ state } = desk());
  }
  assert(Boolean(state.unlocked["lock.desk"]), `${attempts} 次之内把锁撬开了`);

  await say("把黑色账本收进包里");
  const bag = await say("背包里有什么");
  ({ state, log } = desk());
  assert(state.itemAt["item.ledger"] === "inv.pc", "账本进了背包");
  assert(bag.kind === "query", "背包询问是 query，不改版本");
  assert(bag.narration.includes("黑色账本"), "回答里提到账本");

  const sanBefore = state.san;
  await say("翻开账本读一读");
  ({ state, log } = desk());
  assert(state.san === sanBefore - 5, "读到夹页之后理智扣了 5 点");
  assert(state.known.includes("fact.dock_time"), "拿到码头交易时间");
  assert(Boolean(state.flags["node.read_ledger.done"]), "读懂交易时间节点完成");

  const live = stateHash(state);
  const restored = replay(initialState(), log);
  assert(live === stateHash(restored), `主进程重放哈希一致（${live}）`);
  assert(live === "b6506aeb", `与 Demo 金样哈希相同（${live}）`);

  await Promise.all(operationIds.map((operationId) => turns.waitForNarration(operationId)));

  campaigns.dispose();
  settings.close();
} finally {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows 上 Bun SQLite 可能延迟释放文件句柄。 */ }
}

if (failed) {
  console.log(`\n失败 ${failed} 项。`);
  process.exit(1);
}
console.log("\n主进程金样全部通过。");
