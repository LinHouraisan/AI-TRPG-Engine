import { pack, packIndex } from "../engine/pack";
import type { RecentRecord } from "../engine/recent";
import { npcsInRoom, visibleItemsInRoom } from "../engine/state";
import type { StoryMonitorView } from "../engine/story-monitor";
import type { EventPayload, GameEvent, GameState } from "../engine/types";
import { newModelTaskId, type ContextPlan, type FactProposal } from "./tasks";

export type { ContextPlan, FactProposal } from "./tasks";

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}

/** Pack entity only. Inventory slots and free text are not invented as entities. */
function isPackEntity(id: string): boolean {
  return Boolean(
    packIndex.room(id) ||
      packIndex.item(id) ||
      packIndex.npc(id) ||
      packIndex.lock(id) ||
      packIndex.fact(id) ||
      pack.story.some((node) => node.id === id),
  );
}

function entityIdsFromPayload(payload: EventPayload): string[] {
  switch (payload.type) {
    case "moved":
      return [payload.to];
    case "observed":
      return [payload.item];
    case "check_resolved":
      return [payload.target];
    case "lock_opened":
      return [payload.lock];
    case "item_moved":
      return [payload.item, payload.from, payload.to];
    case "fact_known":
      return [payload.fact];
    case "resource_changed":
    case "flag_set":
    case "action_rejected":
    case "sheet_applied":
      return [];
    case "relationship_established":
      return [payload.npc];
    case "npc_moved":
      return [payload.npc, payload.to];
    case "node_done":
      return [payload.node];
  }
}

/**
 * Deterministic next-turn context_plan. Never calls a model. Never writes state.
 * `recent` is accepted for the contract; natural language is not ranked here.
 */
export function informationPlan(
  state: GameState,
  story: StoryMonitorView,
  _recent: RecentRecord[],
): { plan: ContextPlan; taskType: "information.plan"; modelTaskId: string; usedModel: false } {
  const load = unique(
    [
      state.pcAt,
      ...visibleItemsInRoom(state, state.pcAt),
      ...npcsInRoom(state, state.pcAt),
      ...state.known,
      ...story.changedNodeIds,
    ].filter(isPackEntity),
  );
  const preload = unique(
    story.clueCoverageGaps.flatMap((gap) => gap.missingClueIds).filter((id) => packIndex.fact(id)),
  );
  return {
    taskType: "information.plan",
    modelTaskId: newModelTaskId(),
    usedModel: false,
    plan: {
      load,
      keep: load,
      demote: [],
      drop: [],
      preload,
    },
  };
}

/**
 * One fact proposal per committed public event. Candidates only; confirmed is always false.
 */
export function informationPropose(
  _state: GameState,
  events: GameEvent[],
): { proposals: FactProposal[]; usedModel: false } {
  const proposals: FactProposal[] = [];
  for (const event of events) {
    if (event.visibility !== "public") continue;
    proposals.push({
      entityIds: unique(entityIdsFromPayload(event.payload).filter(isPackEntity)),
      summary: event.summary,
      kind: "fact",
      sources: [{ kind: "event", id: event.id }],
      confirmed: false,
    });
  }
  return { proposals, usedModel: false };
}
