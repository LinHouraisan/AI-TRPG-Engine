import { evaluate } from "./conditions";
import { itemVisibility, pack, packIndex } from "./pack";
import type { GameState } from "./types";

export function initialState(): GameState {
  const investigator = pack.manifest.investigator;

  const npcAt: Record<string, string> = {};
  for (const npc of pack.npcs) npcAt[npc.id] = npc.startAt;

  const itemAt: Record<string, string> = {};
  for (const item of pack.items) itemAt[item.id] = item.at;

  return {
    version: 0,
    turn: 0,
    clock: 0,
    pcAt: investigator.startAt,
    npcAt,
    itemAt,
    unlocked: {},
    observed: {},
    visited: { [investigator.startAt]: true },
    flags: {},
    known: [],
    hp: investigator.hp,
    hpMax: investigator.hp,
    san: investigator.san,
    sanMax: investigator.sanMax,
    skills: { ...investigator.skills },
  };
}

export function itemsInRoom(state: GameState, roomId: string): string[] {
  return Object.entries(state.itemAt)
    .filter(([, at]) => at === roomId)
    .map(([id]) => id);
}

/**
 * 这件东西此刻藏着没有。规则写在资料包里（见 itemVisibility），这里只负责执行。
 * 只挡「拿不走」是不够的——名字一旦出现在场景里，就等于提前泄了底。
 */
export function isHidden(state: GameState, itemId: string): boolean {
  const item = packIndex.item(itemId);
  if (!item) return false;
  // 已经拿在手上的东西，没有再藏的道理。
  if (state.itemAt[itemId] === "inv.pc") return false;

  const visibility = itemVisibility(item);
  if (visibility.kind === "always") return false;
  if (visibility.kind === "never") return true;
  return !evaluate(visibility.when, state);
}

/** 玩家此刻真看得见的东西。除了「有没有开锁」这类判断，其余地方一律用这个。 */
export function visibleItemsInRoom(state: GameState, roomId: string): string[] {
  return itemsInRoom(state, roomId).filter((id) => !isHidden(state, id));
}

export function inventory(state: GameState): string[] {
  return itemsInRoom(state, "inv.pc");
}

export function npcsInRoom(state: GameState, roomId: string): string[] {
  return Object.entries(state.npcAt)
    .filter(([, at]) => at === roomId)
    .map(([id]) => id);
}

/** 当前房间里有哪些锁，由资料包里的位置决定。 */
export function locksInRoom(roomId: string) {
  return pack.locks.filter((lock) => lock.at === roomId);
}
