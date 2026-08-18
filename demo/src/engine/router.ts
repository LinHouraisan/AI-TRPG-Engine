import { items, locks, rooms } from "@/data/boarding-house";
import { itemsInRoom } from "./state";
import type { GameState, Intent } from "./types";

/**
 * 回合路由：把玩家那句白话，保守地匹配成一个意图。
 * 宁可匹配不上、转去追问，也不能靠几个关键词就猜着执行。
 * 真正接上模型之后，这里只处理 1、2 级快路径，含糊的一律交给主持人澄清。
 */

const MOVE_WORDS = ["去", "进", "走", "回", "推开", "上", "下", "前往", "离开"];
const OBSERVE_WORDS = ["看", "观察", "检查", "查看", "打量", "瞧"];
const UNLOCK_WORDS = ["撬", "开锁", "解锁", "开开", "撬开", "打开"];
const TAKE_WORDS = ["拿", "取", "收", "装", "塞", "捡", "带走"];
const READ_WORDS = ["读", "翻", "阅读", "念"];
const TALK_WORDS = ["问", "说", "聊", "喊", "打招呼", "搭话"];

function hit(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

/** 玩家提到的是不是这件道具：本名或者别名，命中一个就算。 */
function mentions(text: string, itemId: string): boolean {
  const item = items[itemId];
  if (!item) return false;
  return hit(text, [item.title, ...(item.aliases ?? [])]);
}

export function route(text: string, state: GameState): Intent {
  const input = text.trim();
  if (!input) return { kind: "unclear", text };

  const room = rooms.find((r) => r.id === state.pcAt);
  const here = itemsInRoom(state, state.pcAt);
  const bag = itemsInRoom(state, "inv.pc");

  // 移动：目标房间必须是当前房间的出口，或者出口本身的名字（房门、楼梯）。
  if (hit(input, MOVE_WORDS) && room) {
    const exits = room.exits.filter((exit) => {
      const target = rooms.find((r) => r.id === exit.to);
      return (target && input.includes(target.title)) || input.includes(exit.via);
    });
    if (exits.length === 1) return { kind: "move", to: exits[0].to };
    if (exits.length > 1) return { kind: "unclear", text };
  }

  // 阅读要排在观察前面：「读账本」和「看账本」想做的事情不一样。
  if (hit(input, READ_WORDS)) {
    const readable = [...bag, ...here].filter((id) => mentions(input, id));
    if (readable.length === 1) return { kind: "read", item: readable[0] };
  }

  if (hit(input, UNLOCK_WORDS)) {
    const candidates = Object.values(locks).filter(
      (lock) => here.includes(lock.opens) || here.some((id) => items[id]?.title === lock.title),
    );
    const named = candidates.filter((lock) => input.includes(lock.title) || input.includes("锁"));
    if (named.length === 1) return { kind: "unlock", lock: named[0].id };
  }

  if (hit(input, TAKE_WORDS)) {
    const takeable = here.filter((id) => items[id]?.portable && mentions(input, id));
    if (takeable.length === 1) return { kind: "take", item: takeable[0] };
  }

  if (hit(input, OBSERVE_WORDS)) {
    const visible = [...here, ...bag].filter((id) => mentions(input, id));
    if (visible.length === 1) return { kind: "observe", target: visible[0] };
    // 「看看四周」这类，就当成观察房间本身
    if (visible.length === 0 && (input.includes("四周") || input.includes("周围") || input.includes("房间"))) {
      return { kind: "observe", target: state.pcAt };
    }
  }

  if (hit(input, TALK_WORDS)) return { kind: "talk", text: input };

  return { kind: "unclear", text: input };
}
