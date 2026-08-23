import { lintPack, loadPackById } from "@/engine/pack";

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
  console.log(`✓ ${message}`);
}

const pack = loadPackById("mist-harbor");
assert(lintPack(pack).filter((item) => item.level === "错误").length === 0, "资料包引用完整");
assert(pack.rooms.length >= 7 && pack.rooms.length <= 9, "场景数量为 7–9");
assert(pack.npcs.length === 5, "主要 NPC 为 5 个");
assert(pack.items.length >= 12 && pack.items.length <= 16, "关键道具为 12–16 件");
assert(pack.facts.length >= 15 && pack.facts.length <= 20, "线索为 15–20 条");
const endings = pack.story.filter((node) => node.id.startsWith("node.ending_"));
assert(endings.length >= 3, "至少三个正式结局");
assert(endings.some((node) => node.id === "node.ending_bargain"), "存在自由行动隐藏路线");
const conclusions = ["fact.old_line", "fact.memory_fuel", "fact.bell_anchor"];
for (const fact of conclusions) {
  const sources = pack.items.filter((item) => item.observeGrants === fact).length +
    pack.conditions.filter((condition) => JSON.stringify(condition.effects).includes(fact)).length;
  assert(sources >= 1, `${fact} 有结构化来源`);
}
console.log("雾港末班车内容规模与结局检查通过。");
