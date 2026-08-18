/**
 * 金样冒烟：脚本化跑一遍《寄宿公寓账本》，检查三件事——
 * 1. 书桌还锁着的时候，取账本必须被拒绝；
 * 2. 开锁成功之后才能取走、才能读到夹页，理智相应扣掉；
 * 3. 拿事件记录重放一遍，状态哈希必须和当场的状态一致；
 * 4. 查询背包不推进团内时间、不追加事件、也不改状态版本。
 *
 * 运行：cd demo && bun scripts/smoke.ts
 */
import { answerQuery, narrate, suggest } from "@/engine/narrate";
import { resolveIntent } from "@/engine/resolve";
import { route } from "@/engine/router";
import { commit, replay, stateHash } from "@/engine/runtime";
import { initialState, visibleItemsInRoom } from "@/engine/state";
import type { GameEvent, GameState, Intent } from "@/engine/types";

let state: GameState = initialState();
let log: GameEvent[] = [];

function step(input: string): { intent: Intent; text: string } {
  const intent = route(input, state);
  if (intent.kind === "query") {
    return { intent, text: answerQuery({ state, log, topic: intent.topic }) };
  }
  const turnId = `turn-${state.turn + 1}`;
  const { drafts, clarification } = resolveIntent({ intent, state, turnId });
  if (clarification) return { intent, text: `【追问】${clarification}` };
  const result = commit({ state, log, drafts, turnId });
  state = result.state;
  log = result.log;
  return { intent, text: narrate({ state, events: result.committed, intent }) };
}

function assert(ok: boolean, label: string) {
  if (!ok) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  console.log(`✓ ${label}`);
}

console.log("— 门厅 → 书房 —");
console.log(step("我推开书房门").text);

console.log("\n— 观察书桌锁 —");
console.log(step("看看书桌锁").text);
assert(state.known.includes("fact.lock_scratched"), "观察之后拿到公开线索");

console.log("\n— 账本锁在写字台里，开锁之前不该露面 —");
assert(
  !visibleItemsInRoom(state, "loc.study").includes("item.ledger"),
  "开锁之前，账本不算看得见的东西",
);
assert(
  !suggest(state).some((suggestion) => suggestion.label.includes("账本")),
  "建议行动里也没有账本",
);
assert(
  !narrate({ state, events: [], intent: { kind: "unclear", text: "" } }).includes("账本"),
  "房间描述里同样只字未提账本",
);

console.log("\n— 锁还锁着就想拿账本 —");
const rejected = step("把黑色账本收进包里");
assert(rejected.intent.kind === "take", "「把黑色账本收进包里」仍然被认成拿取，而不是当作听不懂");
assert(
  log.some((e) => e.payload.type === "action_rejected"),
  "锁着的时候取走账本被拒绝，并且写进了事件记录",
);
console.log(rejected.text);

console.log("\n— 反复撬锁，直到开为止 —");
let attempts = 0;
while (!state.unlocked["lock.desk"] && attempts < 12) {
  attempts += 1;
  const out = step("我撬这把锁");
  console.log(`第 ${attempts} 次：${out.text.split("\n")[0]}`);
}
assert(state.unlocked["lock.desk"], `${attempts} 次之内把锁撬开了`);
assert(Boolean(state.flags["node.open_desk.done"]), "剧情节点「打开写字台」由条件判定为完成");

console.log("\n— 取走并阅读账本 —");
console.log(step("把黑色账本收进包里").text);
assert(state.itemAt["item.ledger"] === "inv.pc", "账本进了背包");

console.log("\n— 查询背包（不消耗团内时间）—");
const clockBeforeQuery = state.clock;
const logBeforeQuery = log.length;
const versionBeforeQuery = state.version;
const bagAsk = step("背包里有什么");
assert(bagAsk.intent.kind === "query", "「背包里有什么」被认成查询");
assert(
  state.clock === clockBeforeQuery &&
    log.length === logBeforeQuery &&
    state.version === versionBeforeQuery,
  "查询不推进团内时间、不追加事件、也不改状态版本",
);
assert(bagAsk.text.includes("黑色账本"), "回答里提到了背包里的账本");
console.log(bagAsk.text);

const sanBefore = state.san;
console.log(step("翻开账本读一读").text);
assert(state.san === sanBefore - 5, "读到夹页之后理智扣了 5 点");
assert(state.known.includes("fact.dock_time"), "拿到秘密线索：码头交易时间");
assert(Boolean(state.flags["node.read_ledger.done"]), "剧情节点「读懂交易时间」完成");

console.log("\n— 存档、读档、重放 —");
const live = stateHash(state);
const restored = replay(initialState(), log);
const rehashed = stateHash(restored);
assert(live === rehashed, `重放出来的状态哈希一致（${live}）`);
assert(restored.version === state.version, `版本号一致（v${state.version}）`);

console.log("\n— 另起一场：撬锁失败会惊动女房东 —");
state = initialState();
log = [];
step("我推开书房门");
// 来回走动，把团内时间推到三分钟以上，同时等一个会掷失败的回合。
let guard = 0;
while (guard < 20) {
  guard += 1;
  const before = state.turn;
  step("我撬这把锁");
  if (state.turn === before) break;
  if (state.flags["lock.desk.failed"]) break;
  if (state.unlocked["lock.desk"]) break;
  step("回门厅");
  step("进书房");
}
if (state.flags["lock.desk.failed"]) {
  assert(state.clock >= 3, "撬锁失败之后团内时间已经过了三分钟");
  assert(state.npcAt["npc.landlady"] === "loc.hall", "条件把女房东移到了门厅");
  assert(Boolean(state.flags["alarm.raised"]), "剧情标记「女房东警戒」被条件打开");
} else {
  console.log("（这条种子下没掷出失败，跳过警戒分支）");
}

console.log(
  `\n全部通过：事件 ${log.length} 条，团内时间 +${state.clock} 分钟，理智 ${state.san}。`,
);
