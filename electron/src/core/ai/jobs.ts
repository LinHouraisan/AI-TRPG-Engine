import { directorJobs, type DirectorFrontier, type StoryOpportunity } from "./director";
import { informationPlan, informationPropose } from "./information";
import { consolidateMemory, extractMemory, recordRaw, type MemoryState } from "./memory";
import { TASK_LIMITS, type ContextPlan, type FactProposal } from "./tasks";
import { factDeltas } from "../engine/fact-delta";
import {
  applyPlan,
  baseLoad,
  beginPreparing,
  commitPreparing,
  type ContextStore,
} from "../engine/context-store";
import type { RecentRecord } from "../engine/recent";
import type { StoryMonitorView } from "../engine/story-monitor";
import type { GameEvent, GameState } from "../engine/types";

export type AfterCommitJobs = {
  information: { plan: ContextPlan; proposals: FactProposal[]; usedModel: false };
  director: {
    due: boolean;
    frontier: DirectorFrontier;
    opportunities: StoryOpportunity[];
    usedModel: false;
  };
  memory: MemoryState;
  context: ContextStore;
  blockedTurn: false;
};

/**
 * Cold jobs after a committed turn. Never blocks the player.
 * Priority: required context swap → Information plan → Director flag → Memory extract → consolidate.
 */
export function runAfterCommit(params: {
  taskId: string;
  branchId: string;
  state: GameState;
  committed: GameEvent[];
  recent: RecentRecord[];
  story: StoryMonitorView;
  memory: MemoryState;
  context: ContextStore;
}): AfterCommitJobs {
  void TASK_LIMITS; // registry exists; these jobs are deterministic and non-blocking
  const base = baseLoad({
    taskId: params.taskId,
    branchId: params.branchId,
    state: params.state,
    events: params.committed,
    turn: params.state.turn,
    story: params.story,
  });
  let context = beginPreparing(params.context, base);
  const information = informationPlan(params.state, params.story, params.recent);
  const proposals = informationPropose(params.state, params.committed);
  if (context.preparing) {
    context = {
      ...context,
      preparing: applyPlan(
        context.preparing,
        {
          load: information.plan.load,
          drop: information.plan.drop,
          preload: information.plan.preload,
        },
        params.state,
      ),
    };
  }
  context = commitPreparing(context);

  const director = directorJobs(params.story);
  let memory = recordRaw(params.memory, params.state.turn);
  memory = extractMemory({
    memory,
    deltas: factDeltas(params.committed),
    recent: params.recent,
    turnNumber: params.state.turn,
    sceneId: params.state.pcAt,
  });
  memory = consolidateMemory(memory, params.state.pcAt);

  return {
    information: { plan: information.plan, proposals: proposals.proposals, usedModel: false },
    director: {
      due: director.due,
      frontier: director.frontier,
      opportunities: director.opportunities,
      usedModel: false,
    },
    memory,
    context,
    blockedTurn: false,
  };
}
