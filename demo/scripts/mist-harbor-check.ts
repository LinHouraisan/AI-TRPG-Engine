import { lintPack, loadPackById } from "@/engine/pack";

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
  console.log(`✓ ${message}`);
}

const pack = loadPackById("mist-harbor");
assert(lintPack(pack).filter((item) => item.level === "错误").length === 0, "资料包引用完整");
const creation = pack.manifest.creation;
if (!creation) throw new Error("雾港末班车缺少调查员创建规则");
assert(creation.maxSkill === 90, "调查员最终技能上限为 90");
assert(creation.lifeHistories.length === 4, "恰有四项作者编写的人生经历");
const endings = pack.story.filter((node) => node.id.startsWith("node.ending_"));
for (const history of creation.lifeHistories) {
  const grantExists = history.initialGrant.kind === "fact"
    ? pack.facts.some((fact) => fact.id === history.initialGrant.id)
    : pack.items.some((item) => item.id === history.initialGrant.id);
  assert(grantExists, `${history.id} 的初始赠与存在`);
  assert(pack.npcs.some((npc) => npc.id === history.relationship.npcId), `${history.id} 的关系 NPC 存在`);
  assert(
    pack.investigations.some((investigation) => investigation.id === history.investigationId),
    `${history.id} 的调查入口存在`,
  );
  assert(
    !endings.some((ending) => JSON.stringify(ending.doneWhen).includes(history.initialGrant.id)),
    `${history.id} 不直接赠送结局条件`,
  );
}
assert(pack.rooms.length >= 7 && pack.rooms.length <= 9, "场景数量为 7–9");
assert(pack.npcs.length === 5, "主要 NPC 为 5 个");
assert(pack.items.length >= 12 && pack.items.length <= 16, "关键道具为 12–16 件");
assert(pack.facts.length >= 15 && pack.facts.length <= 20, "线索为 15–20 条");
assert(endings.length >= 3, "至少三个正式结局");
assert(endings.some((node) => node.id === "node.ending_bargain"), "存在自由行动隐藏路线");
const conclusions = ["fact.old_line", "fact.memory_fuel", "fact.bell_anchor"];
for (const fact of conclusions) {
  const sources = pack.items.filter((item) => item.observeGrants === fact).length +
    pack.conditions.filter((condition) => JSON.stringify(condition.effects).includes(fact)).length;
  assert(sources >= 1, `${fact} 有结构化来源`);
}
console.log("雾港末班车内容规模与结局检查通过。");
