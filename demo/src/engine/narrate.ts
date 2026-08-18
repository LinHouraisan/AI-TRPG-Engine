import { pack, packIndex } from "./pack";
import { itemsInRoom, locksInRoom, npcsInRoom, visibleItemsInRoom } from "./state";
import type { GameEvent, GameState, Intent, QueryTopic, Suggestion } from "./types";

/**
 * 守秘人叙述。
 *
 * 这个 Demo 里它是一段确定性的组装：先用资料包里作者写好的句子，
 * 作者没写的地方才退回通用模板。它只读已经提交的事件和状态，
 * 因此不可能编出一个不存在的点数，也不可能说出玩家还没感知到的秘密。
 * 接上模型之后，这个函数会换成一次「主持人调用」，但输入输出的约束不变：
 * 进来的是已提交事实，出去的只有叙述和建议行动。
 */
export function narrate(params: {
  state: GameState;
  events: GameEvent[];
  intent: Intent;
}): string {
  const { state, events, intent } = params;
  const lines: string[] = [];

  for (const event of events) {
    if (event.narration) {
      lines.push(event.narration);
      if (event.payload.type === "moved") lines.push(describeRoom(state, event.payload.to));
      continue;
    }

    const payload = event.payload;
    switch (payload.type) {
      case "moved": {
        const room = packIndex.room(payload.to);
        if (!room) break;
        const firstTime = !firstVisitDone(state, events, payload.to);
        lines.push(firstTime ? room.intro : `你回到${room.title}。`);
        lines.push(describeRoom(state, payload.to));
        break;
      }
      case "observed": {
        const item = packIndex.item(payload.item);
        if (item) lines.push(item.observed);
        break;
      }
      case "item_moved": {
        const item = packIndex.item(payload.item);
        if (item && payload.to === "inv.pc") lines.push(`你把${item.title}收了起来。`);
        break;
      }
      case "npc_moved": {
        const npc = packIndex.npc(payload.npc);
        const room = packIndex.room(payload.to);
        if (npc && room) lines.push(`${npc.title}走进了${room.title}。`);
        break;
      }
      case "action_rejected":
        lines.push(payload.reason);
        break;
      case "lock_opened": {
        // 开锁这一刻，里面的东西才第一次出现在玩家眼前。
        const revealed = packIndex.item(packIndex.lock(payload.lock)?.opens ?? "");
        if (revealed) lines.push(`锁开了，里面是${revealed.title}。`);
        break;
      }
      case "check_resolved":
      case "fact_known":
      case "resource_changed":
      case "flag_set":
      case "node_done":
        break;
    }
  }

  if (intent.kind === "talk") {
    const present = npcsInRoom(state, state.pcAt);
    const npc = present[0] ? packIndex.npc(present[0]) : undefined;
    if (npc) lines.push(`${npc.title}没有停下手里的活：${npc.line}`);
  }

  if (lines.length === 0) lines.push(describeRoom(state, state.pcAt));
  return lines.filter(Boolean).join("\n");
}

function firstVisitDone(state: GameState, events: GameEvent[], roomId: string): boolean {
  const arrivals = events.filter(
    (e) => e.payload.type === "moved" && e.payload.to === roomId,
  ).length;
  // 当前这一次移动本身也算在 visited 里，所以要减掉它。
  return Boolean(state.visited[roomId]) && arrivals === 0;
}

function describeRoom(state: GameState, roomId: string): string {
  const room = packIndex.room(roomId);
  if (!room) return "";
  const here = visibleItemsInRoom(state, roomId)
    .map((id) => packIndex.item(id)?.title)
    .filter(Boolean);
  const people = npcsInRoom(state, roomId).map((id) => packIndex.npc(id)?.title ?? id);
  const parts: string[] = [];
  if (here.length > 0) parts.push(`看得见的东西：${here.join("、")}。`);
  if (people.length > 0) parts.push(`在场的人：${people.join("、")}。`);
  parts.push(`出口：${room.exits.map((e) => `${e.via}通往${roomTitle(e.to)}`).join("；")}。`);
  return parts.join("");
}

function roomTitle(id: string): string {
  return packIndex.room(id)?.title ?? id;
}

/**
 * 建议行动只是给玩家省事，不是一张合法动词表。
 * 没出现在这里的合理行动，同样要能被承接。
 */
export function suggest(state: GameState): Suggestion[] {
  const out: Suggestion[] = [];
  const room = packIndex.room(state.pcAt);
  // 建议里绝不能出现锁着的东西——那等于把答案摆在玩家眼前。
  const here = visibleItemsInRoom(state, state.pcAt);
  const bag = itemsInRoom(state, "inv.pc");

  for (const id of here) {
    const item = packIndex.item(id);
    if (item && !state.observed[id]) {
      out.push({ label: `看看${item.title}`, intent: { kind: "observe", target: id } });
    }
  }

  for (const lock of locksInRoom(state.pcAt)) {
    if (!state.unlocked[lock.id]) {
      out.push({ label: `撬开${lock.title}`, intent: { kind: "unlock", lock: lock.id } });
    }
  }

  for (const id of here) {
    const item = packIndex.item(id);
    if (!item?.portable) continue;
    if (item.lockedBy && !state.unlocked[item.lockedBy]) continue;
    out.push({ label: `拿走${item.title}`, intent: { kind: "take", item: id } });
  }

  for (const id of bag) {
    const item = packIndex.item(id);
    if (item?.read && !state.flags[item.read.flag]) {
      out.push({ label: `翻开${item.title}`, intent: { kind: "read", item: id } });
    }
  }

  for (const exit of room?.exits ?? []) {
    out.push({ label: `去${roomTitle(exit.to)}`, intent: { kind: "move", to: exit.to } });
  }

  return out.slice(0, 6);
}

export function factTitle(id: string): string {
  return packIndex.fact(id)?.title ?? id;
}

/**
 * 查询只把玩家已经知道的事再讲一遍，句子是确定的，不掷骰也不改状态。
 */
export function answerQuery(params: { state: GameState; log: GameEvent[]; topic: QueryTopic }): string {
  const { state, log, topic } = params;
  switch (topic) {
    case "inventory": {
      const names = itemsInRoom(state, "inv.pc")
        .map((id) => packIndex.item(id)?.title)
        .filter((title): title is string => Boolean(title));
      if (names.length === 0) return "你摸了摸外套口袋，里面什么也没有。";
      return `你翻了翻口袋，里面装着${names.join("、")}。`;
    }
    case "sheet": {
      const skills = Object.entries(state.skills)
        .map(([name, value]) => `${name} ${value}`)
        .join("、");
      return `你这张调查员卡上写着：生命 ${state.hp}／${state.hpMax}，理智 ${state.san}／${state.sanMax}。技能是${skills}。`;
    }
    case "clues": {
      if (state.known.length === 0) return "你还没抓住任何能说得清的线索。";
      return `你已经记下：${state.known.map((id) => factTitle(id)).join("、")}。`;
    }
    case "time":
      return `从开场到现在，团内时间过了 ${state.clock} 分钟；当前状态是第 ${state.version} 版。`;
    case "exits": {
      const room = packIndex.room(state.pcAt);
      if (!room) return "你说不清自己身在何处，更看不见往哪走。";
      const exits = room.exits
        .map((exit) => `${exit.via}通往${knownRoomTitle(exit.to, state)}`)
        .join("；");
      return `你现在在${room.title}。出口：${exits}。`;
    }
    case "recap": {
      const recent = log.filter((event) => event.visibility === "public").slice(-8);
      if (recent.length === 0) return "到现在还没什么可回顾的。";
      return `刚才发生的事情，按时间顺序是这些：${recent.map((event) => event.summary).join(" ")}`;
    }
  }
}

function knownRoomTitle(id: string, state: GameState): string {
  const room = packIndex.room(id);
  if (!room) return "未知的地方";
  return state.visited[id] ? room.title : "还没去过的地方";
}

export function openingLine(): string {
  return pack.manifest.opening;
}
