export type AiTaskType =
  | "gm.handle_free_turn"
  | "gm.narrate_result"
  | "director.analyze_progress"
  | "context.rank_relevance"
  | "memory.extract"
  | "memory.consolidate"
  | "information.plan"
  | "information.propose";

export type TaskLimits = {
  timeoutMs: number;
  maxAttempts: number;
  blocksTurn: boolean;
};

/** Only gm.* tasks block the player turn. */
export const TASK_LIMITS: Record<AiTaskType, TaskLimits> = {
  "gm.handle_free_turn": { timeoutMs: 90_000, maxAttempts: 2, blocksTurn: true },
  "gm.narrate_result": { timeoutMs: 90_000, maxAttempts: 2, blocksTurn: true },
  "director.analyze_progress": { timeoutMs: 60_000, maxAttempts: 2, blocksTurn: false },
  "context.rank_relevance": { timeoutMs: 20_000, maxAttempts: 1, blocksTurn: false },
  "memory.extract": { timeoutMs: 60_000, maxAttempts: 2, blocksTurn: false },
  "memory.consolidate": { timeoutMs: 90_000, maxAttempts: 2, blocksTurn: false },
  "information.plan": { timeoutMs: 20_000, maxAttempts: 1, blocksTurn: false },
  "information.propose": { timeoutMs: 20_000, maxAttempts: 1, blocksTurn: false },
};

export function newModelTaskId(): string {
  return crypto.randomUUID();
}

export type SourceReference = { kind: string; id: string };

export type FactProposal = {
  entityIds: string[];
  summary: string;
  kind: "fact" | "cognition" | "intent" | "inference" | "prediction" | "unconfirmed";
  sources: SourceReference[];
  confirmed: false;
};

export type ContextPlan = {
  load: string[];
  keep: string[];
  demote: string[];
  drop: string[];
  preload: string[];
};
