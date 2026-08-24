import type { GameState } from "@core/engine/types";

const ENDINGS = [
  ["node.ending_rescue.done", "带沈鹭归来", "你用仍被记住的姓名，把一个人从旧终点带回现实。"],
  ["node.ending_loop.done", "完成循环", "名单被补全，末班车终于驶过它迟到了三十年的清晨。"],
  ["node.ending_break.done", "斩断旧线", "铜铃与列车失去联系，所有被借走的记忆同时回到人群。"],
  ["node.ending_bargain.done", "以记忆换门", "你留下了一段真实记忆，换来旧终点只开启一次的门。"],
] as const;

export function EndingSummary({ state }: { state: GameState }) {
  const ending = ENDINGS.find(([flag]) => state.flags[flag]);
  if (!ending) return null;
  return <section className="border-b border-brass/50 bg-ink-3 p-4"><p className="text-xs text-muted">战役结局</p><h2 className="mt-1 font-serif text-xl text-brass">{ending[1]}</h2><p className="mt-2">{ending[2]}</p><p className="mt-2 text-xs text-muted">可以从检查点复制新分支，尝试另一种选择。</p></section>;
}
