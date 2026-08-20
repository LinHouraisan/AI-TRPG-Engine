import type { GameEvent, GameState, Intent } from "@/engine/types";
import type { KeeperConfig } from "./config";
import { narrationReplySchema, routeReplySchema } from "./contract";
import {
  keeperNarrate,
  keeperRoute,
  type NarrationResult,
  type NarrationStreamEvent,
  type RouteResult,
} from "./keeper";

/**
 * `gm.handle_free_turn`：一次逻辑任务，两个可能的 HTTP 阶段。
 *
 * 快路径不走这里。结构化 / 机械行动仍是 playTurn 提交之后单独调
 * `gm.narrate_result`（`keeperNarrate`）。只有 `free_action` / `roleplay_only`
 * 且主持人开着时，调用方才用这一对函数。
 *
 * 调用方生成一个 `modelTaskId`，先 `handleFreeTurn`（intent），程序提交事实后再
 * `narrateFreeTurn`。两阶段共享同一 id；叙述复用 `keeperNarrate` 里的
 * `buildContext`，不另装一份完整上下文。
 *
 * 工具调用闭环（clarification / context_request / action_intent）还不在这一层。
 */
export type FreeTurnPhase = "intent" | "narrate";

/** Intent 阶段沿用路由契约；叙述阶段沿用叙述契约。不另写一份。 */
export const freeTurnIntentSchema = routeReplySchema;
export const freeTurnNarrationSchema = narrationReplySchema;

export type FreeTurnIntentResult = RouteResult & { modelTaskId: string };
export type FreeTurnNarrationResult = NarrationResult & { modelTaskId: string };

export function newFreeTurnTaskId(): string {
  return crypto.randomUUID();
}

/**
 * 阶段 `intent`：听懂自由文本。内部就是今天的 `keeperRoute`，
 * `modelTaskId` 只在返回值上挂着，不传进路由层。
 */
export async function handleFreeTurn(params: {
  config: KeeperConfig;
  state: GameState;
  spoken: string;
  modelTaskId: string;
  signal?: AbortSignal;
}): Promise<FreeTurnIntentResult> {
  const routed = await keeperRoute({
    config: params.config,
    state: params.state,
    spoken: params.spoken,
    signal: params.signal,
  });
  return { modelTaskId: params.modelTaskId, ...routed };
}

/**
 * 阶段 `narrate`：同一逻辑任务、提交之后。内部就是 `keeperNarrate`
 *（由它装配上下文），把同一个 `modelTaskId` 原样带回去。
 */
export async function narrateFreeTurn(params: {
  config: KeeperConfig;
  modelTaskId: string;
  state: GameState;
  events: GameEvent[];
  intent: Intent;
  spoken: string;
  fallback: string;
  signal?: AbortSignal;
  onStream?: (event: NarrationStreamEvent) => void;
}): Promise<FreeTurnNarrationResult> {
  const result = await keeperNarrate({
    config: params.config,
    state: params.state,
    events: params.events,
    intent: params.intent,
    spoken: params.spoken,
    fallback: params.fallback,
    signal: params.signal,
    onStream: params.onStream,
  });
  return { ...result, modelTaskId: params.modelTaskId };
}
