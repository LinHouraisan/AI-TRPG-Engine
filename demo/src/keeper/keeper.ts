import { pack, packIndex } from "@/engine/pack";
import { itemsInRoom, npcsInRoom, visibleItemsInRoom } from "@/engine/state";
import type { GameEvent, GameState, Intent, QueryTopic } from "@/engine/types";
import { askKeeper, extractNarrationDraft, KeeperError } from "./client";
import type { KeeperConfig } from "./config";
import {
  narrationJsonSchema,
  narrationReplySchema,
  routeJsonSchema,
  routeReplySchema,
} from "./contract";
import { buildContext, buildRouteContext, type ContextUsage } from "./context";
import { checkNarration } from "./guard";

const NARRATE_SYSTEM = [
  "你是《克苏鲁的呼唤》的守秘人，主持一场简体中文的跑团。",
  "规矩只有一条，但没有例外：你只能复述【已提交的事实】，不能新增任何事实。",
  "具体来说——",
  "1. 不许出现上下文里没有的人、东西、房间、声音来源；想不出细节就写得含糊些，不要编。",
  "2. 不许报出没有掷出来的数字，也不许判断成败：成败已经由程序定好，写在事实里了。",
  "3. 不许替玩家决定他下一步做什么，也不许替他说话或者动。",
  "4. 【作者写好的句子】必须体现出来，可以调整语气，但事实不能改。",
  "5. 两到四句，第二人称，克制、具体、不抒情。不要用列表，不要加引号包住整段。",
  "只输出 JSON：{\"text\": \"你的叙述\"}",
].join("\n");

const QUERY_TOPICS: readonly QueryTopic[] = ["inventory", "sheet", "clues", "time", "exits", "recap"];

const ROUTE_SYSTEM = [
  "你是跑团程序的一道输入路由。玩家说了一句话，你要判断他想做的是哪一个动作。",
  "动词只能从这些里选：move（去某处）、observe（观察某物）、unlock（撬锁或开锁）、take（拿走某物）、read（阅读某物）、talk（说话）、query（询问已知信息，不是行动）、unclear（看不出来）。",
  "query 用在玩家只是在问自己已经知道的事，例如背包、人物卡、线索、团内时间、出口、刚才发生了什么。此时 target 只能是 inventory、sheet、clues、time、exits、recap 之一，query 不掷骰、也不改状态。",
  "除 query 以外，target 必须原样抄用备选清单里的编号（例如 loc.study、item.ledger、lock.desk）。清单里没有的编号一律不许写。",
  "只要有一点拿不准，就返回 unclear，并在 text 里写一句反问玩家的话——猜错比问一句代价大得多。",
  "talk 不需要 target。unclear 时 target 留空。",
  "只输出 JSON。",
].join("\n");

export type NarrationResult = {
  text: string;
  source: "模型" | "模板";
  note?: string;
  ms?: number;
  /** 这一次叙述真正装配进去的用量。主持人关掉时没装配，也就没有。 */
  usage?: ContextUsage;
};

/**
 * 流式过程中的草稿。体检通过之前不算定稿，不写进消息记录、不落盘。
 * 字段用 draft 而不是 text，免得和定稿混在同一个形状里。
 */
export type NarrationDraft = {
  kind: "draft";
  draft: string;
};

/** 已经过体检（或已经退回模板）的定稿。text 才是可以落笔的叙述。 */
export type NarrationFinal = NarrationResult & { kind: "final" };

export type NarrationStreamEvent = NarrationDraft | NarrationFinal;

/**
 * 主持人叙述。模型只负责把已经提交的事实讲成人话；
 * 讲错了、超时了、连不上，都退回确定性模板，一场团不会因为模型而卡住。
 *
 * 打开 config.stream 时，onStream 会先收到若干 { kind: "draft" }，
 * 最后一定收到一条 { kind: "final" }。Promise 的返回值就是那条定稿，
 * 与非流式路径在同一输入下应得到相同的 text。
 */
export async function keeperNarrate(params: {
  config: KeeperConfig;
  state: GameState;
  events: GameEvent[];
  intent: Intent;
  spoken: string;
  fallback: string;
  signal?: AbortSignal;
  onStream?: (event: NarrationStreamEvent) => void;
}): Promise<NarrationResult> {
  const { config, fallback } = params;
  const finish = (result: NarrationResult): NarrationResult => {
    params.onStream?.({ kind: "final", ...result });
    return result;
  };

  if (!config.enabled) return finish({ text: fallback, source: "模板" });

  const context = buildContext({
    state: params.state,
    events: params.events,
    budgetChars: params.config.contextBudgetChars,
  });
  const done = (result: Omit<NarrationResult, "usage">): NarrationResult =>
    finish({ ...result, usage: context.usage });
  const base = [context.text, "", `【玩家这一步】${params.spoken}`].join("\n");

  let complaint = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { value, ms } = await askKeeper({
        config,
        system: NARRATE_SYSTEM,
        user: complaint ? `${base}\n\n【上一次不合格】${complaint}，重写一遍。` : base,
        schema: narrationReplySchema,
        jsonSchema: narrationJsonSchema,
        signal: params.signal,
        stream: config.stream,
        onContent: config.stream
          ? (json) => {
              const draft = extractNarrationDraft(json);
              if (!draft) return;
              params.onStream?.({ kind: "draft", draft });
            }
          : undefined,
      });

      const verdict = checkNarration({
        text: value.text,
        allowedNames: context.allowedNames,
        events: params.events,
      });
      if (verdict.ok) return done({ text: value.text.trim(), source: "模型", ms });

      complaint = verdict.reason;
    } catch (error) {
      const reason = error instanceof KeeperError ? error.message : String(error);
      return done({ text: fallback, source: "模板", note: reason });
    }
  }

  return done({
    text: fallback,
    source: "模板",
    note: `叙述两次都没过体检：${complaint}`,
  });
}

export type RouteResult = {
  intent: Intent;
  source: "程序" | "模型";
  note?: string;
};

/**
 * 只有保守路由认不出来的时候，才轮到模型。
 * 而且模型给的编号仍然要过一遍在场检查：它挑了一个不在这儿的东西，照样作废。
 */
export async function keeperRoute(params: {
  config: KeeperConfig;
  state: GameState;
  spoken: string;
  signal?: AbortSignal;
}): Promise<RouteResult> {
  const { config, state, spoken } = params;
  if (!config.enabled) return { intent: { kind: "unclear", text: spoken }, source: "程序" };

  try {
    const { value } = await askKeeper({
      config,
      system: ROUTE_SYSTEM,
      user: `${buildRouteContext(state)}\n\n【玩家说】${spoken}`,
      schema: routeReplySchema,
      jsonSchema: routeJsonSchema,
      maxTokens: 160,
      signal: params.signal,
    });

    const intent = toIntent(value.verb, value.target, spoken, state);
    if (!intent) {
      return {
        intent: { kind: "unclear", text: value.text || spoken },
        source: "模型",
        note: `模型给的目标 ${value.target || "（空）"} 不在场，已作废`,
      };
    }
    return { intent, source: "模型" };
  } catch (error) {
    const reason = error instanceof KeeperError ? error.message : String(error);
    return { intent: { kind: "unclear", text: spoken }, source: "程序", note: reason };
  }
}

/** 把模型给的动词与编号翻成意图；编号不在场就返回空，交回追问。 */
function toIntent(
  verb: string,
  target: string,
  spoken: string,
  state: GameState,
): Intent | undefined {
  const here = visibleItemsInRoom(state, state.pcAt);
  const bag = itemsInRoom(state, "inv.pc");

  switch (verb) {
    case "move": {
      const room = packIndex.room(state.pcAt);
      return room?.exits.some((exit) => exit.to === target) ? { kind: "move", to: target } : undefined;
    }
    case "observe":
      if (target === state.pcAt) return { kind: "observe", target };
      return here.includes(target) || bag.includes(target)
        ? { kind: "observe", target }
        : undefined;
    case "unlock":
      return pack.locks.some((lock) => lock.id === target && lock.at === state.pcAt)
        ? { kind: "unlock", lock: target }
        : undefined;
    case "take":
      return here.includes(target) ? { kind: "take", item: target } : undefined;
    case "read":
      return bag.includes(target) || here.includes(target) ? { kind: "read", item: target } : undefined;
    case "talk":
      return npcsInRoom(state, state.pcAt).length > 0 ? { kind: "talk", text: spoken } : undefined;
    case "query":
      return isQueryTopic(target) ? { kind: "query", topic: target } : undefined;
    default:
      return undefined;
  }
}

function isQueryTopic(value: string): value is QueryTopic {
  return (QUERY_TOPICS as readonly string[]).includes(value);
}
