import { evaluate } from "./conditions";
import { pack } from "./pack";
import type { Predicate } from "./schema";
import type { GameEvent, GameState } from "./types";

export type ClueCoverageGap = {
  nodeId: string;
  missingClueIds: string[];
};

export type StoryMonitorView = {
  stateVersion: number;
  changedNodeIds: string[];
  structurallyReachableNodeIds: string[];
  blockedArcIds: string[];
  clueCoverageGaps: ClueCoverageGap[];
  turnsSinceProgress: number;
  affectedEntityIds: string[];
  sourceEventIds: string[];
  /** True only if structure cannot explain the stall. We still do not call Director. */
  directorDue: boolean;
};

function cluesIn(predicate: Predicate, into: string[]): void {
  if ("known" in predicate) into.push(predicate.known);
  else if ("all" in predicate) for (const child of predicate.all) cluesIn(child, into);
  else if ("any" in predicate) for (const child of predicate.any) cluesIn(child, into);
  else if ("not" in predicate) cluesIn(predicate.not, into);
}

function nodeCompleted(state: GameState, nodeId: string): boolean {
  if (state.flags[`${nodeId}.done`]) return true;
  const node = pack.story.find((entry) => entry.id === nodeId);
  return node ? evaluate(node.doneWhen, state) : false;
}

function nodeFailed(state: GameState, nodeId: string): boolean {
  return Boolean(state.flags[`${nodeId}.failed`]);
}

function entityIdsFrom(events: GameEvent[]): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    const payload = event.payload;
    if (payload.type === "moved") ids.add(payload.to);
    if (payload.type === "item_moved") {
      ids.add(payload.item);
      ids.add(payload.to);
      ids.add(payload.from);
    }
    if (payload.type === "npc_moved") {
      ids.add(payload.npc);
      ids.add(payload.to);
    }
    if (payload.type === "observed") ids.add(payload.item);
    if (payload.type === "lock_opened") ids.add(payload.lock);
    if (payload.type === "fact_known") ids.add(payload.fact);
    if (payload.type === "node_done") ids.add(payload.node);
  }
  return [...ids];
}

function turnsSince(log: GameEvent[]): number {
  let last = -1;
  for (const event of log) {
    if (event.payload.type === "node_done") last = event.seq;
  }
  if (last < 0) {
    const turns = new Set(log.map((event) => event.turnId));
    return turns.size;
  }
  const after = new Set(log.filter((event) => event.seq > last).map((event) => event.turnId));
  return after.size;
}

/**
 * Scenario Runtime Story Monitor: derived, rebuildable, no model.
 * Director stays uncalled unless directorDue — and even then this slice only flags it.
 */
export function storyMonitor(params: {
  before: GameState;
  after: GameState;
  committed: GameEvent[];
  log: GameEvent[];
}): StoryMonitorView {
  const changedNodeIds: string[] = [];
  const structurallyReachableNodeIds: string[] = [];
  const blockedArcIds: string[] = [];
  const clueCoverageGaps: ClueCoverageGap[] = [];

  for (const node of pack.story) {
    const wasDone = nodeCompleted(params.before, node.id);
    const nowDone = nodeCompleted(params.after, node.id);
    const failed = nodeFailed(params.after, node.id);
    if (!wasDone && nowDone) changedNodeIds.push(node.id);
    if (failed) {
      blockedArcIds.push(node.id);
      continue;
    }
    if (!nowDone) {
      structurallyReachableNodeIds.push(node.id);
      const needed: string[] = [];
      cluesIn(node.doneWhen, needed);
      const missing = [...new Set(needed)].filter((id) => !params.after.known.includes(id));
      if (missing.length > 0) {
        clueCoverageGaps.push({ nodeId: node.id, missingClueIds: missing });
      }
    }
  }

  const progressThisTurn = params.committed.some((event) => event.payload.type === "node_done");
  return {
    stateVersion: params.after.version,
    changedNodeIds,
    structurallyReachableNodeIds,
    blockedArcIds,
    clueCoverageGaps,
    turnsSinceProgress: progressThisTurn ? 0 : turnsSince(params.log),
    affectedEntityIds: entityIdsFrom(params.committed),
    sourceEventIds: params.committed.map((event) => event.id),
    directorDue: blockedArcIds.length > 0 && structurallyReachableNodeIds.length === 0,
  };
}
