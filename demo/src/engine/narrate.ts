import { facts, items, locks, npcs, rooms } from "@/data/boarding-house";
import { itemsInRoom, npcsInRoom } from "./state";
import type { GameEvent, GameState, Intent, Suggestion } from "./types";

/**
 * 守秘人叙述。
 *
 * 这个 Demo 里它是一段确定性的模板：只读已经提交的事件和状态，
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
    const payload = event.payload;
    switch (payload.type) {
      case "moved": {
        const room = rooms.find((r) => r.id === payload.to);
        if (!room) break;
        const firstTime = !firstVisitDone(state, events, payload.to);
        lines.push(firstTime ? room.intro : `你回到${room.title}。`);
        lines.push(describeRoom(state, payload.to));
        break;
      }
      case "observed": {
        const item = items[payload.item];
        if (item) lines.push(item.observed);
        break;
      }
      case "check_resolved": {
        const lock = locks[payload.target];
        const check = payload.check;
        if (check.ok) {
          lines.push(`你屏住呼吸，锁芯咔的一声让开了。${lock?.title ?? "锁"}开了。`);
        } else if (check.level === "大失败") {
          lines.push("铁片在锁孔里一崴，断了半截。声音在空屋子里传得很远。");
        } else {
          lines.push("锁芯只往回弹。你手上使不上劲，反而磕出一声响。");
        }
        break;
      }
      case "lock_opened":
        break;
      case "item_moved": {
        const item = items[payload.item];
        if (item && payload.to === "inv.pc") {
          lines.push(`你把${item.title}塞进外套内袋。`);
        }
        break;
      }
      case "fact_known": {
        if (payload.fact === "fact.dock_time") {
          lines.push("夹页上是一行铅笔字：码头，凌晨三点。字迹被人描过两遍。");
        }
        break;
      }
      case "resource_changed": {
        if (payload.resource === "san" && payload.delta < 0) {
          lines.push("你盯着那行字看了太久，胃里一阵发凉。");
        }
        break;
      }
      case "npc_moved": {
        const npc = npcs[payload.npc];
        const room = rooms.find((r) => r.id === payload.to);
        if (npc && room) {
          lines.push(`楼梯上传来脚步声。${npc.title}走下来，站在${room.title}，朝你这边看了一眼。`);
        }
        break;
      }
      case "action_rejected":
        lines.push(payload.reason);
        break;
      case "flag_set":
      case "node_done":
        break;
    }
  }

  if (intent.kind === "talk") {
    const present = npcsInRoom(state, state.pcAt).map((id) => npcs[id]?.title ?? id);
    if (present.length > 0) {
      lines.push(
        `${present[0]}没有停下手里的活："这个点了还不歇着？楼上的水管一响，我可管不了。"`,
      );
    }
  }

  if (lines.length === 0) lines.push(describeRoom(state, state.pcAt));
  return lines.join("\n");
}

function firstVisitDone(state: GameState, events: GameEvent[], roomId: string): boolean {
  const arrivals = events.filter(
    (e) => e.payload.type === "moved" && e.payload.to === roomId,
  ).length;
  // 当前这一次移动本身也算在 visited 里，所以要减掉它。
  return Boolean(state.visited[roomId]) && arrivals === 0;
}

function describeRoom(state: GameState, roomId: string): string {
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return "";
  const here = itemsInRoom(state, roomId)
    .map((id) => items[id]?.title)
    .filter(Boolean);
  const people = npcsInRoom(state, roomId).map((id) => npcs[id]?.title ?? id);
  const parts: string[] = [];
  if (here.length > 0) parts.push(`看得见的东西：${here.join("、")}。`);
  if (people.length > 0) parts.push(`在场的人：${people.join("、")}。`);
  parts.push(`出口：${room.exits.map((e) => `${e.via}通往${roomTitle(e.to)}`).join("；")}。`);
  return parts.join("");
}

function roomTitle(id: string): string {
  return rooms.find((r) => r.id === id)?.title ?? id;
}

/**
 * 建议行动只是给玩家省事，不是一张合法动词表。
 * 没出现在这里的合理行动，同样要能被承接。
 */
export function suggest(state: GameState): Suggestion[] {
  const out: Suggestion[] = [];
  const room = rooms.find((r) => r.id === state.pcAt);
  const here = itemsInRoom(state, state.pcAt);
  const bag = itemsInRoom(state, "inv.pc");

  for (const id of here) {
    const item = items[id];
    if (item && !state.observed[id]) {
      out.push({ label: `看看${item.title}`, intent: { kind: "observe", target: id } });
    }
  }

  for (const lock of Object.values(locks)) {
    if (here.includes(lock.opens) && !state.unlocked[lock.id]) {
      out.push({ label: `撬开${lock.title}`, intent: { kind: "unlock", lock: lock.id } });
    }
  }

  for (const id of here) {
    const item = items[id];
    if (!item?.portable) continue;
    if (item.lockedBy && !state.unlocked[item.lockedBy]) continue;
    out.push({ label: `拿走${item.title}`, intent: { kind: "take", item: id } });
  }

  for (const id of bag) {
    if (id === "item.ledger" && !state.flags["ledger.read"]) {
      out.push({ label: "翻开账本", intent: { kind: "read", item: id } });
    }
  }

  for (const exit of room?.exits ?? []) {
    out.push({ label: `去${roomTitle(exit.to)}`, intent: { kind: "move", to: exit.to } });
  }

  return out.slice(0, 6);
}

export function factTitle(id: string): string {
  return facts[id]?.title ?? id;
}
