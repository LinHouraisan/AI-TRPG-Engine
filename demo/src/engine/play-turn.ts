import { answerQuery, narrate } from "./narrate";
import { recentFromTurn } from "./recent";
import { resolveIntent } from "./resolve";
import { classifyIntent, type TurnClassification } from "./routes";
import { route } from "./router";
import { commit } from "./runtime";
import { storyMonitor, type StoryMonitorView } from "./story-monitor";
import type { CheckResult, GameEvent, GameState, Intent } from "./types";

export type PlayTurnOutcome =
  | { kind: "query"; text: string; intent: Intent; classification: TurnClassification }
  | { kind: "clarification"; text: string; intent: Intent; classification: TurnClassification }
  | {
      kind: "committed";
      intent: Intent;
      state: GameState;
      log: GameEvent[];
      committed: GameEvent[];
      check?: CheckResult;
      narration: string;
      classification: TurnClassification;
      story: StoryMonitorView;
      recent: ReturnType<typeof recentFromTurn>;
    };

/**
 * 无界面的一回合：路由 → 裁定 → 提交 → 模板叙述。
 * 模型听懂／润色不在这里；主进程和 session 都走这一份，免得两套规则。
 */
export function playTurn(params: {
  text: string;
  state: GameState;
  log: GameEvent[];
  intent?: Intent;
}): PlayTurnOutcome {
  const intent = params.intent ?? route(params.text, params.state);
  const classification = classifyIntent(intent);
  if (intent.kind === "query") {
    return {
      kind: "query",
      intent,
      classification,
      text: answerQuery({ state: params.state, log: params.log, topic: intent.topic }),
    };
  }

  const turnId = `turn-${params.state.turn + 1}`;
  const resolved = resolveIntent({ intent, state: params.state, turnId });
  if (resolved.clarification) {
    return {
      kind: "clarification",
      intent,
      classification: { ...classification, route: "clarification" },
      text: resolved.clarification,
    };
  }

  const result = commit({
    state: params.state,
    log: params.log,
    drafts: resolved.drafts,
    turnId,
  });
  const narration = narrate({
    state: result.state,
    events: result.committed,
    intent,
  });
  return {
    kind: "committed",
    intent,
    state: result.state,
    log: result.log,
    committed: result.committed,
    check: resolved.check,
    narration,
    classification,
    story: storyMonitor({
      before: params.state,
      after: result.state,
      committed: result.committed,
      log: result.log,
    }),
    recent: recentFromTurn({
      player: params.text,
      gm: narration,
      committed: result.committed,
      stateVersion: result.state.version,
    }),
  };
}
