import { indexPack, pack, type Pack } from "./pack";
import type { GameState } from "./types";

export type KernelIssue = {
  code: string;
  message: string;
};

const INVENTORY = "inv.pc";

/**
 * Deterministic fact kernel: schema, refs, resource bounds, one PC location.
 * No domain Analyzer. Illegal state is an engine bug, not a model opinion.
 */
export function inspectKernel(state: GameState, scenarioPack: Pack = pack): KernelIssue[] {
  const issues: KernelIssue[] = [];
  const packIndex = indexPack(scenarioPack);
  const roomOk = (id: string) => Boolean(packIndex.room(id));
  if (!roomOk(state.pcAt)) {
    issues.push({ code: "CHARACTER_LOCATION_INVALID", message: `pcAt ${state.pcAt} is not a room` });
  }
  for (const [npc, at] of Object.entries(state.npcAt)) {
    if (!packIndex.npc(npc)) {
      issues.push({ code: "CHARACTER_NOT_FOUND", message: `unknown npc ${npc}` });
    }
    if (!roomOk(at)) {
      issues.push({ code: "CHARACTER_LOCATION_INVALID", message: `${npc} at ${at}` });
    }
  }
  for (const [item, at] of Object.entries(state.itemAt)) {
    if (!packIndex.item(item)) {
      issues.push({ code: "ITEM_NOT_FOUND", message: `unknown item ${item}` });
    }
    if (at !== INVENTORY && !roomOk(at)) {
      issues.push({ code: "ITEM_LOCATION_CONFLICT", message: `${item} at ${at}` });
    }
  }
  if (state.hp < 0 || state.hp > state.hpMax) {
    issues.push({ code: "CHARACTER_RESOURCE_OUT_OF_RANGE", message: `hp ${state.hp}/${state.hpMax}` });
  }
  if (state.san < 0 || state.san > state.sanMax) {
    issues.push({ code: "CHARACTER_RESOURCE_OUT_OF_RANGE", message: `san ${state.san}/${state.sanMax}` });
  }
  for (const fact of state.known) {
    if (!scenarioPack.facts.some((entry) => entry.id === fact)) {
      issues.push({ code: "CHARACTER_FACT_SOURCE_REQUIRED", message: `unknown fact ${fact}` });
    }
  }
  for (const lockId of Object.keys(state.unlocked)) {
    if (!scenarioPack.locks.some((lock) => lock.id === lockId)) {
      issues.push({ code: "SCENE_FEATURE_UNKNOWN", message: `unknown lock ${lockId}` });
    }
  }
  return issues;
}

export function assertKernel(state: GameState, scenarioPack: Pack = pack): void {
  const issues = inspectKernel(state, scenarioPack);
  if (issues.length === 0) return;
  throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
}
