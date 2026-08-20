import type { z } from "zod";
import { askKeeper } from "../keeper/client";
import type { KeeperConfig } from "../keeper/config";
import { packIndex } from "../engine/pack";
import { applyPlan, baseLoad, beginPreparing, commitPreparing } from "../engine/context-store";
import { factDeltas } from "../engine/fact-delta";
import type { GameEvent, GameState } from "../engine/types";
import type { RecentRecord } from "../engine/recent";
import type { StoryMonitorView } from "../engine/story-monitor";
import {
  contextPlanJsonSchema,
  contextPlanSchema,
  directorAnalyzeJsonSchema,
  directorAnalyzeSchema,
  informationProposeJsonSchema,
  informationProposeSchema,
  memoryConsolidateJsonSchema,
  memoryConsolidateSchema,
  memoryExtractJsonSchema,
  memoryExtractSchema,
} from "./contracts";
import { directorJobs, type DirectorFrontier, type StoryOpportunity } from "./director";
import { runAfterCommit, type AfterCommitJobs } from "./jobs";
import {
  consolidateMemory,
  extractMemory,
  type MemoryEntry,
  type MemoryState,
  type MemoryType,
} from "./memory";
import { TASK_LIMITS, type AiTaskType, type ContextPlan, type FactProposal } from "./tasks";

const ENTITY_PREFIXES = ["loc.", "item.", "npc.", "pc.", "lock.", "fact.", "node."] as const;

export type LiveAfterCommitJobs = Omit<AfterCommitJobs, "information" | "director"> & {
  information: { plan: ContextPlan; proposals: FactProposal[]; usedModel: boolean };
  director: {
    due: boolean;
    frontier: DirectorFrontier;
    opportunities: StoryOpportunity[];
    usedModel: boolean;
  };
  memoryUsedModel: boolean;
};

/**
 * After-commit jobs with optional model calls. Never blocks the player turn:
 * callers must not await this before returning control. Model failure keeps
 * the deterministic result. Proposals stay unconfirmed. Natural language
 * never becomes a fact memory.
 */
export async function runAfterCommitLive(params: {
  taskId: string;
  branchId: string;
  state: GameState;
  committed: GameEvent[];
  recent: RecentRecord[];
  story: StoryMonitorView;
  memory: MemoryState;
  context: AfterCommitJobs["context"];
  config: KeeperConfig;
}): Promise<LiveAfterCommitJobs> {
  const baseline = runAfterCommit({
    taskId: params.taskId,
    branchId: params.branchId,
    state: params.state,
    committed: params.committed,
    recent: params.recent,
    story: params.story,
    memory: params.memory,
    context: params.context,
  });

  if (!params.config.enabled) {
    return { ...baseline, memoryUsedModel: false };
  }

  let plan = baseline.information.plan;
  let planUsed = false;
  const planned = await askStructured({
    config: params.config,
    task: "information.plan",
    schema: contextPlanSchema,
    jsonSchema: contextPlanJsonSchema,
    system: INFORMATION_PLAN_SYSTEM,
    user: informationPlanUser(params),
  });
  if (planned) {
    plan = {
      load: unique([...baseline.information.plan.load, ...planned.load]),
      keep: unique([...baseline.information.plan.keep, ...planned.keep]),
      demote: [],
      drop: planned.drop.filter((id) => !baseline.information.plan.load.includes(id)),
      preload: unique([...baseline.information.plan.preload, ...planned.preload]),
    };
    planUsed = true;
  }

  const base = baseLoad({
    taskId: params.taskId,
    branchId: params.branchId,
    state: params.state,
    events: params.committed,
    turn: params.state.turn,
    story: params.story,
  });
  let context = beginPreparing(params.context, base);
  if (context.preparing) {
    context = {
      ...context,
      preparing: applyPlan(
        context.preparing,
        { load: plan.load, drop: plan.drop, preload: plan.preload },
        params.state,
      ),
    };
  }
  context = commitPreparing(context);

  let proposals = baseline.information.proposals;
  let proposeUsed = false;
  const proposed = await askStructured({
    config: params.config,
    task: "information.propose",
    schema: informationProposeSchema,
    jsonSchema: informationProposeJsonSchema,
    system: INFORMATION_PROPOSE_SYSTEM,
    user: informationProposeUser(params),
  });
  if (proposed) {
    const extra = proposed.proposals
      .map((item) => ({
        ...item,
        confirmed: false as const,
        entityIds: item.entityIds.filter(isPackEntity),
        sources: item.sources.filter((source) => allowedSource(source.id, params)),
      }))
      .filter((item) => item.sources.length > 0);
    proposals = [...proposals, ...extra];
    proposeUsed = extra.length > 0 || proposed.proposals.length === 0;
  }

  const director = directorJobs(params.story);
  let opportunities = director.opportunities;
  let frontier = director.frontier;
  let directorUsed = false;
  if (director.due) {
    const analyzed = await askStructured({
      config: params.config,
      task: "director.analyze_progress",
      schema: directorAnalyzeSchema,
      jsonSchema: directorAnalyzeJsonSchema,
      system: DIRECTOR_SYSTEM,
      user: directorUser(params, frontier),
    });
    if (analyzed) {
      directorUsed = true;
      const knownNodes = new Set(params.story.changedNodeIds.concat(params.story.structurallyReachableNodeIds));
      opportunities = analyzed.opportunities.map((item) => ({
        opportunityId: item.opportunityId,
        affectedNodeIds: item.affectedNodeIds.filter((id) => knownNodes.has(id) || id.startsWith("node.")),
        kind: item.kind,
        status: "pending" as const,
        gmGuidance: item.gmGuidance,
      }));
      frontier = {
        ...frontier,
        openOpportunityIds: opportunities.map((item) => item.opportunityId),
        playerGoalMemoryIds: analyzed.playerGoalMemoryIds.filter((id) =>
          baseline.memory.entries.some((entry) => entry.id === id),
        ),
      };
    }
  }

  let memory = extractMemory({
    memory: baseline.memory,
    deltas: factDeltas(params.committed),
    recent: params.recent,
    turnNumber: params.state.turn,
    sceneId: params.state.pcAt,
  });
  let memoryUsedModel = false;
  const extracted = await askStructured({
    config: params.config,
    task: "memory.extract",
    schema: memoryExtractSchema,
    jsonSchema: memoryExtractJsonSchema,
    system: MEMORY_EXTRACT_SYSTEM,
    user: memoryExtractUser(params),
  });
  if (extracted) {
    const allowed = new Set(params.committed.map((event) => event.id));
    const added: MemoryEntry[] = [];
    for (const item of extracted.entries) {
      const sources = item.sources.filter((id) => allowed.has(id));
      if (sources.length === 0) continue;
      added.push({
        id: `live:${item.memoryType}:${sources.join(",")}:${item.summary.slice(0, 24)}`,
        memoryType: item.memoryType as MemoryType,
        summary: item.summary,
        sources,
        entityIds: item.entityIds.filter((id) => ENTITY_PREFIXES.some((prefix) => id.startsWith(prefix))),
        sceneId: params.state.pcAt,
        importance: item.importance,
        status: "active",
        structured: { origin: "memory.extract" },
        extractedThroughTurn: params.state.turn,
      });
    }
    if (added.length > 0) {
      memory = { ...memory, entries: [...memory.entries, ...added] };
      memoryUsedModel = true;
    }
  }

  memory = consolidateMemory(memory, params.state.pcAt);
  const consolidated = await askStructured({
    config: params.config,
    task: "memory.consolidate",
    schema: memoryConsolidateSchema,
    jsonSchema: memoryConsolidateJsonSchema,
    system: MEMORY_CONSOLIDATE_SYSTEM,
    user: memoryConsolidateUser(memory, params.state.pcAt),
  });
  if (consolidated) {
    const sources = unique(
      consolidated.sources.filter((id) => memory.entries.some((entry) => entry.sources.includes(id))),
    );
    if (sources.length > 0) {
      memoryUsedModel = true;
      const extractedThroughTurn = params.state.turn;
      const next: MemoryEntry = {
        id: `scene:${params.state.pcAt}:${extractedThroughTurn}:live`,
        memoryType: "scene",
        summary: consolidated.summary,
        sources,
        entityIds: unique(
          memory.entries
            .filter((entry) => entry.sceneId === params.state.pcAt && entry.status === "active")
            .flatMap((entry) => entry.entityIds),
        ),
        sceneId: params.state.pcAt,
        importance: 2,
        status: "active",
        structured: { origin: "memory.consolidate" },
        extractedThroughTurn,
      };
      memory = {
        ...memory,
        entries: [
          ...memory.entries.map((entry) =>
            entry.memoryType === "scene" && entry.sceneId === params.state.pcAt && entry.status === "active"
              ? { ...entry, status: "superseded" as const }
              : entry,
          ),
          next,
        ],
      };
    }
  }

  return {
    information: { plan, proposals, usedModel: planUsed || proposeUsed },
    director: {
      due: director.due,
      frontier,
      opportunities,
      usedModel: directorUsed,
    },
    memory,
    context,
    blockedTurn: false,
    memoryUsedModel,
  };
}

async function askStructured<T>(params: {
  config: KeeperConfig;
  task: AiTaskType;
  schema: z.ZodType<T>;
  jsonSchema: unknown;
  system: string;
  user: string;
}): Promise<T | undefined> {
  const limits = TASK_LIMITS[params.task];
  try {
    const result = await askKeeper<T>({
      config: {
        ...params.config,
        temperature: 0.1,
        timeoutMs: Math.min(params.config.timeoutMs, limits.timeoutMs),
      },
      system: params.system,
      user: params.user,
      schema: params.schema,
      jsonSchema: params.jsonSchema,
      maxTokens: 800,
    });
    return result.value;
  } catch {
    return undefined;
  }
}

function isPackEntity(id: string): boolean {
  return Boolean(
    packIndex.room(id) || packIndex.item(id) || packIndex.npc(id) || packIndex.lock(id) || packIndex.fact(id),
  );
}

function allowedSource(id: string, params: { committed: GameEvent[] }): boolean {
  return params.committed.some((event) => event.id === id);
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}

function informationPlanUser(params: {
  state: GameState;
  story: StoryMonitorView;
  recent: RecentRecord[];
}): string {
  return [
    `stateVersion ${params.state.version} turn ${params.state.turn} pcAt ${params.state.pcAt}`,
    `known ${params.state.known.join(",") || "none"}`,
    `changedNodes ${params.story.changedNodeIds.join(",") || "none"}`,
    `recent ${params.recent.map((row) => `${row.kind}:${row.text}`).join(" | ").slice(0, 1200)}`,
    "Return a context_plan. Only pack entity ids. Do not invent ids.",
  ].join("\n");
}

function informationProposeUser(params: { committed: GameEvent[] }): string {
  return params.committed
    .map((event) => `${event.id} ${event.payload.type} ${event.summary}`)
    .join("\n");
}

function directorUser(params: { story: StoryMonitorView; committed: GameEvent[] }, frontier: DirectorFrontier): string {
  return [
    `directorDue ${params.story.directorDue}`,
    `reachable ${params.story.structurallyReachableNodeIds.join(",")}`,
    `blocked ${params.story.blockedArcIds.join(",")}`,
    `changed ${params.story.changedNodeIds.join(",")}`,
    `frontier ${JSON.stringify(frontier)}`,
    `events ${params.committed.map((event) => event.id).join(",")}`,
    "Opportunities must cite existing node ids. Do not reveal secrets to the player.",
  ].join("\n");
}

function memoryExtractUser(params: { committed: GameEvent[]; recent: RecentRecord[] }): string {
  return [
    "FACT CHANNEL (already extracted by the program; do not repeat as fact):",
    params.committed.map((event) => `${event.id} ${event.summary}`).join("\n"),
    "SEMANTIC CHANNEL (commitment/goal/unresolved/relation/causal only; sources must be event ids):",
    params.recent
      .filter((row) => row.kind !== "event")
      .map((row) => `${row.kind}: ${row.text}`)
      .join("\n"),
  ].join("\n");
}

function memoryConsolidateUser(memory: MemoryState, sceneId: string): string {
  const facts = memory.entries.filter(
    (entry) => entry.status === "active" && entry.sceneId === sceneId,
  );
  return facts.map((entry) => `${entry.sources.join(",")} ${entry.summary}`).join("\n");
}

const INFORMATION_PLAN_SYSTEM =
  "You rank optional context for the next GM task. Output JSON context_plan only. Never write state. Never invent entity ids. Required room/items/npcs/resources stay loaded even if you drop them.";

const INFORMATION_PROPOSE_SYSTEM =
  "You propose unconfirmed structured facts from committed public events. confirmed must be false. sources must be event ids. No database operations.";

const DIRECTOR_SYSTEM =
  "You are Director. Analyze story feasibility. Do not write nodes. Opportunities are candidates. gmGuidance.doNotReveal lists secrets the GM must not say.";

const MEMORY_EXTRACT_SYSTEM =
  "Extract long-term memory candidates from semantic text. Never emit memoryType fact. Every source must be a committed event id. No unsourced claims.";

const MEMORY_CONSOLIDATE_SYSTEM =
  "Write one scene summary from existing memory. sources must be event ids already on those memories. Do not invent facts.";
