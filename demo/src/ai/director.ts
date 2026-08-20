import { pack } from "../engine/pack";
import type { StoryMonitorView } from "../engine/story-monitor";

export type DirectorFrontier = {
  basedOnStateVersion: number;
  lastAssessedEventId: string | null;
  activeArcIds: string[];
  blockedArcIds: string[];
  dormantArcIds: string[];
  openOpportunityIds: string[];
  clueCoverageGaps: StoryMonitorView["clueCoverageGaps"];
  playerGoalMemoryIds: string[];
};

export type StoryOpportunity = {
  opportunityId: string;
  affectedNodeIds: string[];
  kind: string;
  status: "pending" | "accepted" | "rejected" | "expired" | "superseded";
  gmGuidance: { opportunity: string; doNotReveal: string[] };
};

/**
 * Rebuild from Story Monitor. No model.
 * Active = structurally reachable. Blocked = blocked arcs.
 * Dormant = completed nodes (changed this turn or already done) that are not reachable.
 */
export function rebuildFrontier(story: StoryMonitorView): DirectorFrontier {
  const reachable = new Set(story.structurallyReachableNodeIds);
  const blocked = new Set(story.blockedArcIds);
  const dormantFromPack = pack.story
    .map((node) => node.id)
    .filter((id) => !reachable.has(id) && !blocked.has(id));
  const dormantFromChanged = story.changedNodeIds.filter((id) => !reachable.has(id));
  return {
    basedOnStateVersion: story.stateVersion,
    lastAssessedEventId: story.sourceEventIds.at(-1) ?? null,
    activeArcIds: story.structurallyReachableNodeIds,
    blockedArcIds: story.blockedArcIds,
    dormantArcIds: [...new Set([...dormantFromChanged, ...dormantFromPack])],
    openOpportunityIds: [],
    clueCoverageGaps: story.clueCoverageGaps,
    playerGoalMemoryIds: [],
  };
}

/**
 * Director only when Story Monitor says directorDue.
 * This slice never calls a model: opportunities stay empty so runtime can record skipped_deterministic.
 */
export function directorJobs(story: StoryMonitorView): {
  due: boolean;
  frontier: DirectorFrontier;
  opportunities: StoryOpportunity[];
  usedModel: false;
} {
  return {
    due: story.directorDue,
    frontier: rebuildFrontier(story),
    opportunities: [],
    usedModel: false,
  };
}
