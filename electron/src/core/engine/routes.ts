import type { Intent } from "./types";

/**
 * Turn routes from docs/05 10-application-runtime.
 * `query` is a local extra: it never commits, never needs a model.
 */
export type TurnRoute =
  | "query"
  | "clarification"
  | "roleplay_only"
  | "structured_action"
  | "free_action"
  | "mechanical_action";

export type TurnClassification = {
  route: TurnRoute;
  /** Fast path: program only. No Information / Memory / Director on this turn. */
  syncModels: Array<"gm">;
  background: {
    information: false;
    memory: false;
    director: false;
  };
};

/**
 * Deterministic fast path vs a single GM free-turn.
 * Unclear text is `free_action` (would be gm.handle_free_turn).
 * We do not run a separate interpret_action classify call.
 */
export function classifyIntent(intent: Intent): TurnClassification {
  const background = {
    information: false as const,
    memory: false as const,
    director: false as const,
  };
  if (intent.kind === "query") {
    return { route: "query", syncModels: [], background };
  }
  if (intent.kind === "unclear" || intent.kind === "free_action") {
    return { route: "free_action", syncModels: [], background };
  }
  if (intent.kind === "talk") {
    return { route: "roleplay_only", syncModels: [], background };
  }
  if (intent.kind === "unlock" || intent.kind === "investigation") {
    return { route: "mechanical_action", syncModels: [], background };
  }
  return { route: "structured_action", syncModels: [], background };
}
