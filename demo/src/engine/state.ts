import { investigator, itemPlacement, npcs } from "@/data/boarding-house";
import type { GameState } from "./types";

export function initialState(): GameState {
  const npcAt: Record<string, string> = {};
  for (const npc of Object.values(npcs)) npcAt[npc.id] = npc.startAt;

  return {
    version: 0,
    turn: 0,
    clock: 0,
    pcAt: investigator.startAt,
    npcAt,
    itemAt: { ...itemPlacement },
    unlocked: {},
    observed: {},
    visited: { [investigator.startAt]: true },
    flags: {},
    known: [],
    hp: investigator.hp,
    hpMax: investigator.hp,
    san: investigator.san,
    sanMax: 99,
    skills: { ...investigator.skills },
  };
}

export function itemsInRoom(state: GameState, roomId: string): string[] {
  return Object.entries(state.itemAt)
    .filter(([, at]) => at === roomId)
    .map(([id]) => id);
}

export function inventory(state: GameState): string[] {
  return itemsInRoom(state, "inv.pc");
}

export function npcsInRoom(state: GameState, roomId: string): string[] {
  return Object.entries(state.npcAt)
    .filter(([, at]) => at === roomId)
    .map(([id]) => id);
}
