import type { Predicate } from "./schema";
import type { GameState } from "./types";

/**
 * 条件求值：只读已经提交的状态。
 * 「气氛到了」这类没法检验的说法写不成条件，因此条件也永远不存在于模型的脑子里。
 */
export function evaluate(predicate: Predicate, state: GameState): boolean {
  if ("all" in predicate) return predicate.all.every((child) => evaluate(child, state));
  if ("any" in predicate) return predicate.any.some((child) => evaluate(child, state));
  if ("not" in predicate) return !evaluate(predicate.not, state);
  if ("flag" in predicate) return Boolean(state.flags[predicate.flag]);
  if ("unlocked" in predicate) return Boolean(state.unlocked[predicate.unlocked]);
  if ("observed" in predicate) return Boolean(state.observed[predicate.observed]);
  if ("has" in predicate) return state.itemAt[predicate.has] === "inv.pc";
  if ("pcAt" in predicate) return state.pcAt === predicate.pcAt;
  if ("npcAt" in predicate) return state.npcAt[predicate.npcAt.npc] === predicate.npcAt.room;
  if ("known" in predicate) return state.known.includes(predicate.known);
  if ("clockGte" in predicate) return state.clock >= predicate.clockGte;

  const { which, lte, gte } = predicate.resource;
  const value = which === "hp" ? state.hp : state.san;
  if (lte != null && value > lte) return false;
  if (gte != null && value < gte) return false;
  return lte != null || gte != null;
}
