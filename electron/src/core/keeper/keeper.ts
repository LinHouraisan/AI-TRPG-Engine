import { pack, packIndex, type Pack } from "@core/engine/pack";
import {
  allowedInvestigationSkills,
  investigationProfileFromState,
  visibleInvestigations,
  type InvestigationProfile,
} from "@core/engine/investigation";
import { itemsInRoom, npcsInRoom, visibleItemsInRoom } from "@core/engine/state";
import type { GameEvent, GameState, Intent, QueryTopic } from "@core/engine/types";
import { askKeeper, KeeperError } from "./client";
import type { KeeperConfig } from "./config";
import {
  narrationJsonSchema,
  narrationReplySchema,
  routeJsonSchema,
  routeReplySchema,
  type NarrationReply,
  type RouteReply,
} from "./contract";
import { buildContext, buildRouteContext, type ContextUsage } from "./context";
import {
  checkNarration,
  checkNarrationQuality,
  type NarrationQualityMode,
} from "./guard";
import type { DialogueTurn } from "./dialogue-context";

const NARRATE_SYSTEM = [
  "你是《克苏鲁的呼唤》的守秘人，主持一场简体中文的跑团。",
  "结构化行动只能复述【已提交的事实】。自由行动可以补充不改变权威状态、可随时修正的感官与互动细节，但不得凭空发放线索、道具、成功结果或永久变化。",
  "具体来说——",
  "1. 不许出现上下文里没有的人、东西、房间、声音来源；想不出细节就写得含糊些，不要编。",
  "2. 不许报出没有掷出来的数字，也不许判断成败：成败已经由程序定好，写在事实里了。",
  "3. 不许替玩家决定他下一步做什么，也不许替他说话或者动。",
  "4. 【作者写好的句子】必须体现出来，可以调整语气，但事实不能改。",
  "5. 第二人称，具体、有现场感，不要用列表，不要加引号包住整段。调查、对话、自由检定和探索以220至500个中文字符为目标；优先补足感官细节、NPC动作、行动造成的现场反馈和可继续追查的具体抓手，绝不重复同一条线索凑字。关键剧情最多900字。",
  "6. 先分别起草 feedback（玩家行动的现场反馈）、reaction（NPC或环境的具体反应）和 interactionPoints（一个或多个自然、非菜单式的继续互动点），再把三者写成连贯的 text。feedback、reaction 和 interactionPoints 的每项都必须作为完整短句明确出现在 text 中；可以调整标点，不能只藏在结构字段里。",
  "7. interactionPoints 必须描述现场仍可观察或回应的人、物、动作和悬而未决的信息，不得写成菜单或给玩家的指令。不要编号，不要写“选项”“接下来请调查”“然后前往”“你可以/你能”“不妨查看”“继续追问”等命令句。玩家只会看到 text。",
  "只输出 JSON：{\"feedback\":\"现场反馈\",\"reaction\":\"NPC或环境反应\",\"interactionPoints\":[\"自然互动点\"],\"text\":\"连贯叙述\"}",
].join("\n");

const QUERY_TOPICS: readonly QueryTopic[] = ["inventory", "sheet", "clues", "time", "exits", "recap"];

const ROUTE_SYSTEM = [
  "你是跑团程序的一道输入路由。玩家说了一句话，你要判断他想做的是哪一个动作。",
  "动词从这些里选：move（去某处）、observe（观察某物）、unlock（撬锁或开锁）、take（拿走某物）、read（阅读某物）、talk（说话）、query（询问已知信息，不是行动）、free（合理但不属于上述固定动作的自由尝试）、unclear（连玩家想做什么都看不出来）。",
  "query 用在玩家只是在问自己已经知道的事，例如背包、人物卡、线索、团内时间、出口、刚才发生了什么。此时 target 只能是 inventory、sheet、clues、time、exits、recap 之一，query 不掷骰、也不改状态。",
  "move、observe、unlock、take、read 的 target 必须原样抄用备选清单里的编号。free、talk、unclear 的 target 留空。玩家明确表达了剧本外尝试时选 free，不要仅因清单里没有目标而选 unclear。",
  "玩家的方法明确对应【可用调查入口】时，输出 kind=investigation、原样抄写 investigationId，并从该入口列出的技能中选择 skill；approach 用一句话概括玩家做法。不可见或清单外的调查入口绝不能输出。",
  "玩家在当前现场进行没有作者专用入口的搜索、交涉或局部破坏，而且结果存在不确定性时，输出 kind=free_check。mode 只能是 explore、social、damage；target 必须是当前场景、在场 NPC 或可见物品的编号；skill 必须来自调查员技能；difficulty 通常用 regular，明显困难才用 hard，极端冒险才用 extreme；approach 概括具体做法。",
  "普通交谈仍选 talk。只有可能改变对方态度、迫使对方让步或套取信息时才用 social 检定。破坏只限当前可见物品或当前场景，不能用它直接宣布发现秘密、进入不存在的地点或完成结局。",
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
 * 网络层可以流式收取模型输出，但安全与质量体检完成前不会向界面发送草稿。
 * onStream 只收到一条 { kind: "final" }，Promise 的返回值就是那条定稿。
 */
export async function keeperNarrate(params: {
  config: KeeperConfig;
  state: GameState;
  events: GameEvent[];
  intent: Intent;
  spoken: string;
  recentTurns?: DialogueTurn[];
  profile?: InvestigationProfile | null;
  scenarioPack?: Pack;
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
    recentTurns: params.recentTurns,
    profile: params.profile,
    spoken: params.spoken,
    scenarioPack: params.scenarioPack,
    budgetChars: params.config.contextBudgetChars,
  });
  const done = (result: Omit<NarrationResult, "usage">): NarrationResult =>
    finish({ ...result, usage: context.usage });
  const base = [context.text, "", `【玩家这一步】${params.spoken}`].join("\n");
  const qualityMode = narrationQualityMode(params.intent);

  let complaint = "";
  let lastReason = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { value, ms } = await askKeeper({
        config,
        system: NARRATE_SYSTEM,
        user: complaint ? `${base}\n\n【上一次不合格】${complaint}，重写一遍。` : base,
        schema: narrationReplySchema,
        jsonSchema: narrationJsonSchema,
        maxTokens: 1200,
        signal: params.signal,
        stream: config.stream,
        onContent: undefined,
      });

      const quality = checkNarrationQuality(value, qualityMode);
      if (!quality.ok) {
        lastReason = quality.reason;
        complaint = qualityComplaint(quality.reason);
        continue;
      }

      const verdict = checkNarration({
        text: value.text,
        allowedNames: context.allowedNames,
        allowedFactIds: context.allowedFactIds,
        events: params.events,
        scenarioPack: params.scenarioPack,
      });
      if (!verdict.ok) {
        lastReason = verdict.reason;
        complaint = "叙述包含未经授权的事实或未提交结果";
        continue;
      }

      return done({ text: value.text.trim(), source: "模型", ms });
    } catch (error) {
      const reason = error instanceof KeeperError ? error.message : String(error);
      return done({ text: fallback, source: "模板", note: reason });
    }
  }

  return done({
    text: fallback,
    source: "模板",
    note: `叙述两次都没过体检：${lastReason || complaint}`,
  });
}

function narrationQualityMode(intent: Intent): NarrationQualityMode {
  switch (intent.kind) {
    case "query":
      return "simple";
    case "investigation":
      return "investigation";
    case "talk":
      return "dialogue";
    default:
      return "exploration";
  }
}

function qualityComplaint(reason: string): string {
  return reason === "repeated_padding"
    ? "叙述存在重复填充"
    : "叙述结构不完整或互动点没有写进正文";
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
  profile?: InvestigationProfile | null;
  scenarioPack?: Pack;
  currentStateVersion?: () => number;
  spoken: string;
  recentTurns?: DialogueTurn[];
  signal?: AbortSignal;
}): Promise<RouteResult> {
  const { config, state, spoken } = params;
  if (!config.enabled) return { intent: { kind: "unclear", text: spoken }, source: "程序" };

  try {
    const { value } = await askKeeper({
      config,
      system: ROUTE_SYSTEM,
      user: `${buildRouteContext(state, params.profile ?? investigationProfileFromState(state), params.scenarioPack, params.recentTurns, spoken)}\n\n【玩家说】${spoken}`,
      schema: routeReplySchema,
      jsonSchema: routeJsonSchema,
      maxTokens: 160,
      signal: params.signal,
    });

    if ((params.currentStateVersion?.() ?? state.version) !== state.version) {
      return {
        intent: { kind: "unclear", text: spoken },
        source: "模型",
        note: `模型候选基于状态版本 ${state.version}，当前版本已经变化，已作废`,
      };
    }

    const intent = toIntent(
      value,
      spoken,
      state,
      params.profile ?? investigationProfileFromState(state),
      params.scenarioPack ?? pack,
    );
    if (!intent) {
      const target = "kind" in value
        ? value.kind === "investigation" ? value.investigationId : value.target
        : value.target;
      return {
        intent: { kind: "unclear", text: "kind" in value ? spoken : value.text || spoken },
        source: "模型",
        note: "kind" in value
          ? `模型给的调查入口 ${target} 此刻不可用，已作废`
          : `模型给的目标 ${target || "（空）"} 不在场，已作废`,
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
  reply: RouteReply,
  spoken: string,
  state: GameState,
  profile: InvestigationProfile | null,
  scenarioPack: Pack,
): Intent | undefined {
  if ("kind" in reply) {
    if (reply.kind === "free_check") {
      if (state.skills[reply.skill] == null) return undefined;
      const here = visibleItemsInRoom(state, state.pcAt);
      const present = npcsInRoom(state, state.pcAt);
      const targetIsValid = reply.mode === "explore"
        ? reply.target === state.pcAt || here.includes(reply.target)
        : reply.mode === "social"
          ? present.includes(reply.target)
          : reply.target === state.pcAt || here.includes(reply.target);
      return targetIsValid
        ? {
            kind: "free_check",
            mode: reply.mode,
            target: reply.target,
            skill: reply.skill,
            difficulty: reply.difficulty,
            approach: reply.approach,
          }
        : undefined;
    }
    if (!profile) return undefined;
    const investigation = visibleInvestigations(state, profile, scenarioPack)
      .find((candidate) => candidate.id === reply.investigationId);
    return investigation && allowedInvestigationSkills(investigation, profile).includes(reply.skill)
      ? {
          kind: "investigation",
          investigationId: investigation.id,
          skill: reply.skill,
          approach: reply.approach,
          stateVersion: state.version,
        }
      : undefined;
  }

  const { verb, target } = reply;
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
    case "free":
      return { kind: "free_action", text: spoken };
    case "query":
      return isQueryTopic(target) ? { kind: "query", topic: target } : undefined;
    default:
      return undefined;
  }
}

function isQueryTopic(value: string): value is QueryTopic {
  return (QUERY_TOPICS as readonly string[]).includes(value);
}
