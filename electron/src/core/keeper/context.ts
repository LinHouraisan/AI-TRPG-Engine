import { indexPack, pack, packIndex, type Pack } from "@core/engine/pack";
import { allowedInvestigationSkills, visibleInvestigations, type InvestigationProfile } from "@core/engine/investigation";
import { itemsInRoom, npcsInRoom, visibleItemsInRoom } from "@core/engine/state";
import type { GameEvent, GameState } from "@core/engine/types";
import { DEFAULT_CONTEXT_BUDGET_CHARS } from "./config";
import {
  buildNpcDialogueContext,
  buildRecentDialogueContext,
  disclosableNpcFactIds,
  resolveDialogueNpcId,
  type DialogueTurn,
} from "./dialogue-context";

/**
 * 喂给主持人的上下文。
 *
 * 只放玩家此刻感知得到的东西：当前房间、看得见的道具、背包、已知线索、
 * 调查员数值，以及本回合刚刚提交的公开事件。
 * 守秘人备注（keeperNote）与还没拿到的秘密线索永远不进这里——
 * 模型说不出它没见过的东西，这是结构上的保证，不是靠提示词求它别说。
 *
 * 模组一大，公开经过和已知线索会把窗口撑爆。超预算时按下面的次序裁，
 * 裁错了模型就会在缺依据的情况下编——所以这个顺序比裁剪代码本身更要紧：
 *
 * 1. 久远的公开经过。这一回合用不上，缺了最多少一点背景。
 * 2. 较早拿到的线索。还在状态里，但眼下用得着的多半是刚确认的那几条。
 * 3. 本回合事实、当前房间、在场的人。这一回合叙述的依据，宁可超预算
 *    也不许为了数字把它们裁没。
 *
 * 被裁掉的部分会留「已略去」的痕迹。不留的话，模型会把节选当成全部，
 * 进而编出与事实冲突的叙述。
 *
 * 裁剪只删已经合法进场的内容。守秘人备注、没拿到的秘密线索、藏着的道具，
 * 任何预算下都不许进提示词——这比预算重要得多。
 */
/** 分栏顺序与装配顺序一致。空栏也占位，界面清单才不会忽长忽短。 */
export const CONTEXT_COLUMN_NAMES = [
  "场景与出口",
  "看得见的东西",
  "背包",
  "在场的人",
  "已知线索",
  "调查员",
  "经过",
  "本回合已提交的事实",
  "作者写好的句子",
  "NPC 对话",
] as const;

export type ContextColumnName = (typeof CONTEXT_COLUMN_NAMES)[number];

export type ContextColumnUsage = {
  name: ContextColumnName;
  /** 这一栏拼进 text 的字符数；没拼进去就是 0 */
  chars: number;
  /** 这一栏被裁掉的条数。裁剪不是故障，数字是给观察窗看的。 */
  dropped: number;
};

/**
 * 给已经合法进场的内容称重。只读装配结果，不另开一条取数路径——
 * 否则统计里迟早会出现提示词里没有的东西。
 */
export type ContextUsage = {
  budgetChars: number;
  usedChars: number;
  columns: ContextColumnUsage[];
};

export type KeeperContext = {
  text: string;
  /** 叙述里允许出现的专有名词。用来事后查它有没有编人编物 */
  allowedNames: string[];
  /** 叙述可以明说的作者事实编号；guard 据此拦截其他 NPC 的知识。 */
  allowedFactIds: string[];
  /** 分栏用量。界面只读这份，不要自己再数一遍。 */
  usage?: ContextUsage;
};

/** 上下文里给模型看的略去痕迹。测试按这个原文断言。 */
export const CONTEXT_OMISSION = {
  history: "更早的经过已略去",
  clues: "更早的线索已略去",
} as const;

export function buildContext(params: {
  state: GameState;
  events: GameEvent[];
  recentTurns?: DialogueTurn[];
  profile?: InvestigationProfile | null;
  spoken?: string;
  scenarioPack?: Pack;
  budgetChars?: number;
}): KeeperContext {
  const { state } = params;
  const budgetChars = params.budgetChars ?? DEFAULT_CONTEXT_BUDGET_CHARS;
  const { prior, current } = splitByTurn(params.events);
  const room = packIndex.room(state.pcAt);
  // 锁着的东西不进上下文，模型也就不可能提前把它说出来。
  const here = visibleItemsInRoom(state, state.pcAt);
  const bag = itemsInRoom(state, "inv.pc");
  const people = npcsInRoom(state, state.pcAt);

  const allowedNames = new Set<string>();
  if (room) allowedNames.add(room.title);
  for (const exit of room?.exits ?? []) {
    const target = packIndex.room(exit.to);
    if (target && state.visited[target.id]) allowedNames.add(target.title);
    allowedNames.add(exit.via);
  }
  for (const id of [...here, ...bag]) {
    const item = packIndex.item(id);
    if (item) allowedNames.add(item.title);
  }
  for (const id of people) {
    const npc = packIndex.npc(id);
    if (npc) allowedNames.add(npc.title);
  }
  // 本回合刚提交的事实里出现过的人和物，玩家这一刻正在被告知，自然可以讲。
  // 更早的经过不往这里加：人不在场了还让模型提名字，体检会放行它编。
  for (const event of current) {
    for (const name of namesIn(event)) allowedNames.add(name);
  }

  const visible = here.map((id) => {
    const item = packIndex.item(id);
    if (!item) return id;
    // 没观察过的东西只给名字，观察之后才给作者写的说明。
    return state.observed[id] ? `${item.title}（${item.observed}）` : item.title;
  });
  const bagNames = bag.map((id) => packIndex.item(id)?.title ?? id);
  const peopleNames = people.map((id) => packIndex.npc(id)?.title ?? id);
  const recentTurns = params.recentTurns ?? [];
  const npcId = resolveDialogueNpcId({
    state,
    recentTurns,
    spoken: params.spoken,
    scenarioPack: params.scenarioPack,
  });
  const npcDialogue = npcId
    ? buildNpcDialogueContext({
        npcId,
        state,
        recentTurns,
        profile: params.profile ?? null,
        scenarioPack: params.scenarioPack,
    })
    : buildRecentDialogueContext(recentTurns);
  const scenarioPack = params.scenarioPack ?? pack;
  const scenarioIndex = indexPack(scenarioPack);
  const publicKnown = state.known.filter((id) => scenarioIndex.fact(id)?.visibility === "public");
  const clueIds = npcId ? publicKnown : state.known;
  const clueItems = clueIds.map((id) => scenarioIndex.fact(id)?.title ?? id);
  const visiblePrior = npcId ? prior.filter((event) => event.visibility === "public") : prior;
  const visibleCurrent = npcId ? current.filter((event) => event.visibility === "public") : current;
  const historyItems = perceivedSummaries(visiblePrior);
  const thisTurnFacts = perceivedSummaries(visibleCurrent);
  const authored = visibleCurrent.map((event) => event.narration).filter(Boolean);
  const allowedFactIds = new Set(npcId ? publicKnown : state.known);
  if (npcId) {
    for (const id of disclosableNpcFactIds({ npcId, state, scenarioPack })) {
      allowedFactIds.add(id);
    }
  }
  for (const event of current) {
    if (event.payload.type === "fact_known") allowedFactIds.add(event.payload.fact);
  }

  const historyHad = historyItems.length > 0;
  let historyDropped = 0;
  let cluesDropped = 0;

  /**
   * 字数跟着装配走：每一栏的 chars 就是即将 join 进去的那一段的长度。
   * 不能事后对着状态再数一遍——裁过的、略去痕迹、栏内换行，另数迟早对不上。
   *
   * 有内容的栏用一个换行拼起来，所以：
   *   Σ chars + (有内容的栏数 − 1) === text.length
   * 空栏 chars 为 0，不贡献分隔符；栏内自己的换行已经算进该栏 chars。
   */
  const assemble = (): { text: string; usage: ContextUsage } => {
    const parts: string[] = [];
    const columns: ContextColumnUsage[] = [];

    const weigh = (name: ContextColumnName, body: string, dropped: number) => {
      columns.push({ name, chars: body.length, dropped });
      if (body.length > 0) parts.push(body);
    };

    const sceneLine =
      `【场景】${room?.title ?? "未知"}｜团内时间 +${state.clock} 分钟｜状态版本 v${state.version}`;
    const exitLine = room
      ? `【出口】${room.exits.map((e) => `${e.via}通往${roomName(e.to, state)}`).join("；")}`
      : "";
    weigh("场景与出口", exitLine ? `${sceneLine}\n${exitLine}` : sceneLine, 0);
    weigh(
      "看得见的东西",
      `【看得见的东西】${visible.length > 0 ? visible.join("；") : "没有值得一提的"}`,
      0,
    );
    weigh("背包", `【背包】${bagNames.length > 0 ? bagNames.join("、") : "空的"}`, 0);
    weigh(
      "在场的人",
      `【在场的人】${peopleNames.length > 0 ? peopleNames.join("、") : "只有你自己"}`,
      0,
    );
    weigh("已知线索", `【已知线索】${renderClues(clueItems, cluesDropped)}`, cluesDropped);
    weigh(
      "调查员",
      `【调查员】生命 ${state.hp}/${state.hpMax}，理智 ${state.san}/${state.sanMax}`,
      0,
    );
    weigh("经过", historyHad ? renderHistory(historyItems, historyDropped) : "", historyDropped);
    weigh(
      "本回合已提交的事实",
      `【本回合已提交的事实】\n${
        thisTurnFacts.length > 0 ? thisTurnFacts.map((s) => `- ${s}`).join("\n") : "- 无"
      }`,
      0,
    );
    weigh(
      "作者写好的句子",
      authored.length > 0
        ? [
            "【作者写好的句子，必须用上，可以改写语气但不能改事实】",
            ...authored.map((t) => `- ${t}`),
          ].join("\n")
        : "",
      0,
    );
    weigh("NPC 对话", npcDialogue, 0);

    const text = parts.join("\n");
    return {
      text,
      usage: { budgetChars, usedChars: text.length, columns },
    };
  };

  let assembled = assemble();
  while (assembled.text.length > budgetChars) {
    if (historyItems.length > 0) {
      historyItems.shift();
      historyDropped += 1;
      assembled = assemble();
      continue;
    }
    if (clueItems.length > 0) {
      clueItems.shift();
      cluesDropped += 1;
      assembled = assemble();
      continue;
    }
    // 核心场面到此为止。再裁，模型就没有这一回合的依据了。
    break;
  }

  return {
    text: assembled.text,
    allowedNames: [...allowedNames],
    allowedFactIds: [...allowedFactIds],
    usage: assembled.usage,
  };
}

function renderClues(items: string[], dropped: number): string {
  if (items.length === 0 && dropped === 0) return "还没确认任何事";
  const note = dropped > 0 ? `（${CONTEXT_OMISSION.clues}）` : "";
  if (items.length === 0) return note;
  return `${note}${items.join("；")}`;
}

function renderHistory(items: string[], dropped: number): string {
  const note = dropped > 0 ? `（${CONTEXT_OMISSION.history}）` : "";
  const body = items.map((s) => `- ${s}`).join("\n");
  if (body.length === 0) return `【经过】\n${note}`;
  return note ? `【经过】\n${note}\n${body}` : `【经过】\n${body}`;
}

/**
 * 调用方可能只传本回合，也可能把整份事件记录塞进来。
 * 最后一条的回合编号当作「这一回合」——调用方按时间追加，这个约定才成立。
 */
function splitByTurn(events: GameEvent[]): { prior: GameEvent[]; current: GameEvent[] } {
  if (events.length === 0) return { prior: [], current: [] };
  const turnId = events[events.length - 1]!.turnId;
  const prior: GameEvent[] = [];
  const current: GameEvent[] = [];
  for (const event of events) {
    if (event.turnId === turnId) current.push(event);
    else prior.push(event);
  }
  return { prior, current };
}

function perceivedSummaries(events: GameEvent[]): string[] {
  return events
    .filter((event) => event.visibility === "public" || isPerceived(event))
    .map((event) => event.summary);
}

/** 一条事件牵涉到哪些专有名词。 */
function namesIn(event: GameEvent): string[] {
  const payload = event.payload;
  switch (payload.type) {
    case "moved":
      return [packIndex.room(payload.to)?.title, payload.via].filter(isName);
    case "observed":
      return [packIndex.item(payload.item)?.title].filter(isName);
    case "check_resolved":
      return [
        packIndex.lock(payload.target)?.title,
        packIndex.item(payload.target)?.title,
        packIndex.investigation(payload.target)?.title,
      ].filter(isName);
    case "lock_opened":
      return [packIndex.lock(payload.lock)?.title].filter(isName);
    case "item_moved":
      return [packIndex.item(payload.item)?.title, packIndex.room(payload.from)?.title].filter(
        isName,
      );
    case "npc_moved":
      return [packIndex.npc(payload.npc)?.title, packIndex.room(payload.to)?.title].filter(isName);
    default:
      return [];
  }
}

function isName(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

/** 秘密事件只有当它是玩家自己触发的（读到、观察到）才算他感知过。 */
function isPerceived(event: GameEvent): boolean {
  return event.cause.startsWith("player:");
}

function roomName(id: string, state: GameState): string {
  const room = packIndex.room(id);
  if (!room) return id;
  return state.visited[id] ? room.title : "还没去过的地方";
}

/** 路由用的备选清单：模型只能从这些编号里挑，挑不出就追问。 */
export function buildRouteContext(
  state: GameState,
  profile?: InvestigationProfile | null,
  scenarioPack: Pack = pack,
  recentTurns: DialogueTurn[] = [],
  spoken = "",
): string {
  const room = packIndex.room(state.pcAt);
  const here = visibleItemsInRoom(state, state.pcAt);
  const bag = itemsInRoom(state, "inv.pc");
  const lines: string[] = [];

  lines.push(`【当前房间】${room?.id}（${room?.title}）`);
  lines.push(
    `【可以去的地方】${(room?.exits ?? [])
      .map((e) => `${e.to}（${packIndex.room(e.to)?.title}，经${e.via}）`)
      .join("；")}`,
  );
  lines.push(
    `【房间里的东西】${
      here.map((id) => `${id}（${packIndex.item(id)?.title}）`).join("；") || "无"
    }`,
  );
  lines.push(
    `【背包里的东西】${bag.map((id) => `${id}（${packIndex.item(id)?.title}）`).join("；") || "无"}`,
  );
  lines.push(
    `【这里的锁】${
      pack.locks
        .filter((lock) => lock.at === state.pcAt && !state.unlocked[lock.id])
        .map((lock) => `${lock.id}（${lock.title}，需要${lock.skill}）`)
        .join("；") || "无"
    }`,
  );
  lines.push(
    `【在场的人】${
      npcsInRoom(state, state.pcAt)
        .map((id) => `${id}（${packIndex.npc(id)?.title}）`)
        .join("；") || "无"
    }`,
  );
  const investigationProfile = profile ?? null;
  const investigationLines = investigationProfile
    ? visibleInvestigations(state, investigationProfile, scenarioPack)
        .map((entry) => `${entry.id}（${entry.description}；技能：${allowedInvestigationSkills(entry, investigationProfile).join("、")}；措辞：${entry.phrases.join("、")}）`)
    : [];
  lines.push(
    `【可用调查入口】${
      investigationLines.join("；") || "无"
    }`,
  );
  const npcId = resolveDialogueNpcId({ state, recentTurns, spoken, scenarioPack });
  const dialogue = npcId
    ? buildNpcDialogueContext({ npcId, state, recentTurns, profile: profile ?? null, scenarioPack })
    : buildRecentDialogueContext(recentTurns);
  if (dialogue) lines.push(dialogue);
  return lines.join("\n");
}
