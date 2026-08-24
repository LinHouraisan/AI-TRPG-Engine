import type { ContextStore } from "../engine/context-store";
import type { StoryMonitorView } from "../engine/story-monitor";
import type { AfterCommitJobs } from "./jobs";
import type { LiveAfterCommitJobs } from "./live";
import type { ContextPlan, FactProposal } from "./tasks";
import type { DirectorFrontier, StoryOpportunity } from "./director";
import type { MemoryState } from "./memory";

export type JobStageKind = "program" | "model" | "skipped";

export type JobStage = {
  id: string;
  label: string;
  kind: JobStageKind;
  detail: string;
};

export type JobTrace = {
  turn: number;
  stateVersion: number;
  source: "local" | "desktop-replay";
  livePending: boolean;
  blockedTurn: false;
  stages: JobStage[];
  information: {
    usedModel: boolean;
    plan: ContextPlan;
    proposals: Array<Pick<FactProposal, "summary" | "kind" | "confirmed" | "entityIds">>;
  };
  director: {
    due: boolean;
    usedModel: boolean;
    frontier: DirectorFrontier;
    opportunities: StoryOpportunity[];
  };
  memory: {
    usedModel: boolean;
    cursor: MemoryState["cursor"];
    byType: Record<string, number>;
    active: number;
    sample: Array<{ id: string; memoryType: string; summary: string; sources: string[] }>;
  };
  context: {
    current: number;
    preparing: number;
    byRetention: { required: number; optional: number; prefetch: number };
  };
  story: {
    directorDue: boolean;
    changedNodeIds: string[];
    structurallyReachable: number;
    blockedArcs: number;
    turnsSinceProgress: number;
    clueGaps: number;
  };
};

type Jobs = AfterCommitJobs | LiveAfterCommitJobs;

export function traceFromJobs(params: {
  jobs: Jobs;
  story: StoryMonitorView;
  turn: number;
  stateVersion: number;
  source: JobTrace["source"];
  livePending?: boolean;
}): JobTrace {
  const { jobs, story } = params;
  const memoryUsed = "memoryUsedModel" in jobs ? jobs.memoryUsedModel : false;
  const infoUsed = jobs.information.usedModel;
  const directorUsed = jobs.director.usedModel;
  const livePending = params.livePending === true;

  return {
    turn: params.turn,
    stateVersion: params.stateVersion,
    source: params.source,
    livePending,
    blockedTurn: false,
    stages: [
      stage("commit", "提交", "program", "事实已落盘"),
      stage("base_load", "基础装载", "program", `${countEntries(jobs.context)} 条 required`),
      stage(
        "information.plan",
        "Information 计划",
        kind(infoUsed, livePending),
        `load ${jobs.information.plan.load.length} · preload ${jobs.information.plan.preload.length}`,
      ),
      stage(
        "information.propose",
        "Information 提案",
        kind(infoUsed, livePending),
        `${jobs.information.proposals.length} 条未确认`,
      ),
      stage("context.swap", "上下文切换", "program", jobs.context.preparing ? "preparing 未切" : "current 已换"),
      stage(
        "director",
        "Director",
        jobs.director.due ? kind(directorUsed, livePending) : "skipped",
        jobs.director.due
          ? `机会 ${jobs.director.opportunities.length}`
          : "Story Monitor 未叫",
      ),
      stage(
        "memory.extract",
        "Memory 提取",
        kind(memoryUsed, livePending),
        `游标 ${jobs.memory.cursor.memoryProcessedThroughTurn}`,
      ),
      stage(
        "memory.consolidate",
        "Memory 合并",
        kind(memoryUsed, livePending),
        `${jobs.memory.entries.filter((entry) => entry.memoryType === "scene").length} 条场景摘要`,
      ),
    ],
    information: {
      usedModel: infoUsed,
      plan: jobs.information.plan,
      proposals: jobs.information.proposals.map((item) => ({
        summary: item.summary,
        kind: item.kind,
        confirmed: item.confirmed,
        entityIds: item.entityIds,
      })),
    },
    director: {
      due: jobs.director.due,
      usedModel: directorUsed,
      frontier: jobs.director.frontier,
      opportunities: jobs.director.opportunities,
    },
    memory: summarizeMemory(jobs.memory, memoryUsed),
    context: summarizeContext(jobs.context),
    story: {
      directorDue: story.directorDue,
      changedNodeIds: story.changedNodeIds,
      structurallyReachable: story.structurallyReachableNodeIds.length,
      blockedArcs: story.blockedArcIds.length,
      turnsSinceProgress: story.turnsSinceProgress,
      clueGaps: story.clueCoverageGaps.length,
    },
  };
}

function kind(usedModel: boolean, livePending: boolean): JobStageKind {
  if (livePending && !usedModel) return "program";
  return usedModel ? "model" : "program";
}

function stage(id: string, label: string, kind: JobStageKind, detail: string): JobStage {
  return { id, label, kind, detail };
}

function countEntries(store: ContextStore): number {
  return store.current?.entries.filter((entry) => entry.retention === "required").length ?? 0;
}

function summarizeMemory(memory: MemoryState, usedModel: boolean): JobTrace["memory"] {
  const byType: Record<string, number> = {};
  let active = 0;
  for (const entry of memory.entries) {
    byType[entry.memoryType] = (byType[entry.memoryType] ?? 0) + 1;
    if (entry.status === "active") active += 1;
  }
  return {
    usedModel,
    cursor: memory.cursor,
    byType,
    active,
    sample: memory.entries.slice(-6).map((entry) => ({
      id: entry.id,
      memoryType: entry.memoryType,
      summary: entry.summary,
      sources: entry.sources,
    })),
  };
}

function summarizeContext(store: ContextStore): JobTrace["context"] {
  const entries = store.current?.entries ?? [];
  const byRetention = { required: 0, optional: 0, prefetch: 0 };
  for (const entry of entries) byRetention[entry.retention] += 1;
  return {
    current: entries.length,
    preparing: store.preparing?.entries.length ?? 0,
    byRetention,
  };
}
